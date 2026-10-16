package services

import (
	"sort"
	"time"
)

// EventCorrelator implements Datadog-style event overlay correlation.
// Links events from different sources (syscall, memory, lock, resource)
// into a coherent timeline with cross-references.
type EventCorrelator struct {
	correlations []EventCorrelation
}

// EventCorrelation links events from different sources.
type EventCorrelation struct {
	Timestamp     time.Time              `json:"timestamp"`
	Source        string                 `json:"source"`      // syscall|memory|lock|resource
	Event         string                 `json:"event"`
	RelatedEvents []RelatedEvent         `json:"related_events"`
	Severity      string                 `json:"severity"`
}

// RelatedEvent links an event to a correlated event in another module.
type RelatedEvent struct {
	Source    string                 `json:"source"`
	Module    string                 `json:"module"`    // flamegraph|trace|memory3d|ebpf|resource
	EventType string                 `json:"event_type"`
	OffsetMs  float64                `json:"offset_ms"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// CorrelatedResourceEvent correlates resource spikes with syscall events.
type CorrelatedResourceEvent struct {
	ResourceType string    `json:"resource_type"` // cpu|mem|io|fd
	SyscallEvent string    `json:"syscall_event"`
	Timestamp    time.Time `json:"timestamp"`
	SyscallTS    time.Time `json:"syscall_timestamp"`
	Severity     string    `json:"severity"`
	Description  string    `json:"description"`
}

// NewEventCorrelator creates a new correlator.
func NewEventCorrelator() *EventCorrelator {
	return &EventCorrelator{}
}

// CorrelateResourceWithSyscalls links resource metric changes to specific syscalls.
// Design reference: Datadog Event Overlay — "what operation caused this resource spike?"
func (ec *EventCorrelator) CorrelateResourceWithSyscalls(
	resources []ResourceMetricInput,
	syscalls []SyscallTraceInput,
	timeWindowMs float64,
) []CorrelatedResourceEvent {
	var results []CorrelatedResourceEvent

	sort.Slice(resources, func(i, j int) bool {
		return resources[i].Timestamp.Before(resources[j].Timestamp)
	})

	for i := 1; i < len(resources); i++ {
		prev := resources[i-1]
		curr := resources[i]

		// Detect resource spikes
		var correlation *CorrelatedResourceEvent

		if curr.CPUPercent-prev.CPUPercent > 20 {
			correlation = &CorrelatedResourceEvent{
				ResourceType: "cpu",
				Timestamp:    curr.Timestamp,
				Description:  "CPU 使用率飙升",
				Severity:     "warning",
			}
		}
		if curr.MemRSS > prev.MemRSS*2 && curr.MemRSS > 10*1024*1024 {
			correlation = &CorrelatedResourceEvent{
				ResourceType: "mem",
				Timestamp:    curr.Timestamp,
				Description:  "内存使用翻倍",
				Severity:     "warning",
			}
		}

		if correlation == nil {
			continue
		}

		// Find nearest syscall event within time window
		var nearestSyscall *SyscallTraceInput
		var nearestDist float64
		for j := range syscalls {
			s := &syscalls[j]
			dist := ec.absTimeDiff(curr.Timestamp, s.Timestamp)
			if dist <= timeWindowMs {
				if nearestSyscall == nil || dist < nearestDist {
					nearestSyscall = s
					nearestDist = dist
				}
			}
		}

		if nearestSyscall != nil {
			correlation.SyscallEvent = nearestSyscall.Syscall
			correlation.SyscallTS = nearestSyscall.Timestamp
			correlation.Description += " → 对应 syscall: " + nearestSyscall.Syscall
		}

		results = append(results, *correlation)
	}

	return results
}

// DetectAnomalyPatterns identifies multi-signal anomaly patterns.
// Design reference: Netdata ML — multi-metric consensus anomaly detection.
func (ec *EventCorrelator) DetectAnomalyPatterns(
	resources []ResourceMetricInput,
	syscalls []SyscallTraceInput,
) []string {
	if len(resources) < 5 || len(syscalls) < 5 {
		return nil
	}

	var patterns []string

	// Pattern: CPU + Memory + Syscalls all spiking simultaneously
	cpuSpiking := false
	memSpiking := false

	// Check last 3 samples
	last := resources[len(resources)-3:]
	if len(last) >= 2 {
		cpuSpiking = last[2].CPUPercent > last[0].CPUPercent*1.5
		memSpiking = last[2].MemRSS > last[0].MemRSS*2
	}

	if cpuSpiking && memSpiking {
		patterns = append(patterns, "多指标组合异常: CPU和内存同时飙升，可能是密集计算+大量分配")
	}

	// Pattern: high error syscalls + CPU throttling
	errorCount := 0
	for _, s := range syscalls {
		if s.ErrorCode != 0 {
			errorCount++
		}
	}

	recent := resources[len(resources)-1]
	if errorCount > len(syscalls)/3 && recent.CFSThrottledUs > 0 {
		patterns = append(patterns, "错误调用+CPU节流: 大量失败syscall导致CPU配额耗尽")
	}

	return patterns
}

func (ec *EventCorrelator) absTimeDiff(a, b time.Time) float64 {
	diff := a.Sub(b)
	if diff < 0 {
		diff = -diff
	}
	return float64(diff.Milliseconds())
}
