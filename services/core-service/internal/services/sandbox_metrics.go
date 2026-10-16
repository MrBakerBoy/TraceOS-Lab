package services

import (
	"sync"
	"time"
)

// SandboxMetricsCollector implements cAdvisor-style fine-grained sandbox resource monitoring.
// Design references:
//   - cAdvisor per-container metrics (90+ Prometheus indicators)
//   - /sys/fs/cgroup filesystem polling
//   - OOM event timeline correlation
type SandboxMetricsCollector struct {
	mu       sync.RWMutex
	metrics  []SandboxMetric
	pid      int
	cgroupPath string
}

// SandboxMetric represents a single resource metric collection point.
type SandboxMetric struct {
	Timestamp       time.Time `json:"timestamp"`
	CPUPercent      float64   `json:"cpu_percent"`
	CPUUser         float64   `json:"cpu_user"`
	CPUSystem       float64   `json:"cpu_system"`
	CPUShares       uint64    `json:"cpu_shares"`
	CFSQuota        int64     `json:"cfs_quota_us"`
	CFSPeriod       int64     `json:"cfs_period_us"`
	CFSThrottled    uint64    `json:"cfs_throttled_us"`
	MemRSS          uint64    `json:"mem_rss"`
	MemCache        uint64    `json:"mem_cache"`
	MemWorkingSet   uint64    `json:"mem_working_set"`
	MemLimit        uint64    `json:"mem_limit"`
	MemOOMCount     int       `json:"oom_count"`
	MemFailCount    int       `json:"mem_fail_count"`
	SwapUsage       uint64    `json:"swap_usage"`
	IOReadBytes     uint64    `json:"io_read_bytes"`
	IOWriteBytes    uint64    `json:"io_write_bytes"`
	IOReadOps       uint64    `json:"io_read_ops"`
	IOWriteOps      uint64    `json:"io_write_ops"`
	FDCount         int       `json:"fd_count"`
	FDLimit         int       `json:"fd_limit"`
	ThreadCount     int       `json:"thread_count"`
	TaskStates      map[string]int `json:"task_states"` // running/sleeping/stopped/zombie
	PageFaultMin    uint64    `json:"page_fault_min"`
	PageFaultMaj    uint64    `json:"page_fault_maj"`
	ContextSwitches uint64    `json:"context_switches"`
	NetRxBytes      uint64    `json:"net_rx_bytes"`
	NetTxBytes      uint64    `json:"net_tx_bytes"`
	NetRxPackets    uint64    `json:"net_rx_packets"`
	NetTxPackets    uint64    `json:"net_tx_packets"`
	OOMScore        int       `json:"oom_score"`
	OOMScoreAdj     int       `json:"oom_score_adj"`
}

// SandboxAlert represents a resource alert condition.
type SandboxAlert struct {
	Timestamp   time.Time `json:"timestamp"`
	Type        string    `json:"type"`       // oom_kill|cpu_throttle|fd_limit|mem_pressure
	Severity    string    `json:"severity"`   // critical|warning|info
	Message     string    `json:"message"`
	CurrentValue float64  `json:"current_value"`
	LimitValue   float64  `json:"limit_value"`
}

// NewSandboxMetricsCollector creates a collector for a specific sandbox PID.
func NewSandboxMetricsCollector(pid int) *SandboxMetricsCollector {
	return &SandboxMetricsCollector{
		pid: pid,
		metrics: make([]SandboxMetric, 0, 100),
	}
}

// Record stores a metrics snapshot.
func (smc *SandboxMetricsCollector) Record(m SandboxMetric) {
	smc.mu.Lock()
	defer smc.mu.Unlock()
	smc.metrics = append(smc.metrics, m)
}

// GetHistory returns the full metrics history.
func (smc *SandboxMetricsCollector) GetHistory() []SandboxMetric {
	smc.mu.RLock()
	defer smc.mu.RUnlock()
	result := make([]SandboxMetric, len(smc.metrics))
	copy(result, smc.metrics)
	return result
}

// GetLatest returns the most recent metric snapshot.
func (smc *SandboxMetricsCollector) GetLatest() *SandboxMetric {
	smc.mu.RLock()
	defer smc.mu.RUnlock()
	if len(smc.metrics) == 0 {
		return nil
	}
	latest := smc.metrics[len(smc.metrics)-1]
	return &latest
}

// CheckAlerts evaluates resource metrics against predefined thresholds.
// Design reference: cAdvisor OOM detection + Netdata ML anomaly probability.
func (smc *SandboxMetricsCollector) CheckAlerts(latest SandboxMetric) []SandboxAlert {
	var alerts []SandboxAlert

	// OOM risk: working_set > 80% of memory limit
	if latest.MemLimit > 0 {
		oomRisk := float64(latest.MemWorkingSet) / float64(latest.MemLimit)
		if oomRisk > 0.90 {
			alerts = append(alerts, SandboxAlert{
				Timestamp:    latest.Timestamp,
				Type:         "oom_kill",
				Severity:     "critical",
				Message:      "内存使用超过90%限制，OOM Kill风险极高",
				CurrentValue: oomRisk * 100,
				LimitValue:   100,
			})
		} else if oomRisk > 0.80 {
			alerts = append(alerts, SandboxAlert{
				Timestamp:    latest.Timestamp,
				Type:         "mem_pressure",
				Severity:     "warning",
				Message:      "内存使用超过80%限制",
				CurrentValue: oomRisk * 100,
				LimitValue:   100,
			})
		}
	}

	// OOM events
	if latest.MemOOMCount > 0 {
		alerts = append(alerts, SandboxAlert{
			Timestamp:    latest.Timestamp,
			Type:         "oom_kill",
			Severity:     "critical",
			Message:      "检测到 OOM Kill 事件",
			CurrentValue: float64(latest.MemOOMCount),
		})
	}

	// CFS throttling: CPU quota exceeded
	if latest.CFSThrottled > 0 {
		alerts = append(alerts, SandboxAlert{
			Timestamp:    latest.Timestamp,
			Type:         "cpu_throttle",
			Severity:     "warning",
			Message:      "CPU配额耗尽，CFS调度器已节流",
			CurrentValue: float64(latest.CFSThrottled) / 1e6,
		})
	}

	// FD limit approaching
	if latest.FDLimit > 0 && float64(latest.FDCount)/float64(latest.FDLimit) > 0.80 {
		alerts = append(alerts, SandboxAlert{
			Timestamp:    latest.Timestamp,
			Type:         "fd_limit",
			Severity:     "warning",
			Message:      "文件描述符使用超过80%限制",
			CurrentValue: float64(latest.FDCount),
			LimitValue:   float64(latest.FDLimit),
		})
	}

	return alerts
}

// AnalyzeTrend detects sustained resource growth patterns.
// Return: "growing" | "stable" | "shrinking"
func (smc *SandboxMetricsCollector) AnalyzeTrend(metric string) string {
	smc.mu.RLock()
	defer smc.mu.RUnlock()

	if len(smc.metrics) < 5 {
		return "stable"
	}

	// Take last 5 samples
	samples := smc.metrics[len(smc.metrics)-5:]

	increases := 0
	decreases := 0

	for i := 1; i < len(samples); i++ {
		var prev, curr uint64
		switch metric {
		case "mem":
			prev, curr = samples[i-1].MemWorkingSet, samples[i].MemWorkingSet
		case "fd":
			prev, curr = uint64(samples[i-1].FDCount), uint64(samples[i].FDCount)
		case "cpu":
			if samples[i].CPUPercent > samples[i-1].CPUPercent {
				increases++
			} else if samples[i].CPUPercent < samples[i-1].CPUPercent {
				decreases++
			}
			continue
		}
		if curr > prev {
			increases++
		} else if curr < prev {
			decreases++
		}
	}

	if increases >= 3 {
		return "growing"
	}
	if decreases >= 3 {
		return "shrinking"
	}
	return "stable"
}
