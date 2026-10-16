package handler

import (
	"math"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/model"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/middleware"
)

// MetricsHandler serves sandbox resource metrics derived from submission traces.
type MetricsHandler struct {
	subRepo *repository.SubmissionRepo
}

// NewMetricsHandler creates a new MetricsHandler.
func NewMetricsHandler(subRepo *repository.SubmissionRepo) *MetricsHandler {
	return &MetricsHandler{subRepo: subRepo}
}

// SandboxMetricsResponse mirrors sandbox_metrics.go SandboxMetric for API output.
type SandboxMetricsResponse struct {
	SubmissionID     string  `json:"submission_id"`
	ExperimentID     string  `json:"experiment_id"`
	CPUPercent       float64 `json:"cpu_percent"`
	MemPercent       float64 `json:"mem_percent"`
	MemRSSMB         float64 `json:"mem_rss_mb"`
	MemLimitMB       float64 `json:"mem_limit_mb"`
	MemOOMRisk       float64 `json:"mem_oom_risk"`
	MemOOMEvents     int     `json:"mem_oom_events"`
	IOReadBytes      int64   `json:"io_read_bytes"`
	IOWriteBytes     int64   `json:"io_write_bytes"`
	FDCount          int     `json:"fd_count"`
	FDSoftLimit      int     `json:"fd_soft_limit"`
	ThreadCount      int     `json:"thread_count"`
	ThreadRunning    int     `json:"thread_running"`
	ThreadSleeping   int     `json:"thread_sleeping"`
	PageFaultsMinor  int64   `json:"page_faults_minor"`
	PageFaultsMajor  int64   `json:"page_faults_major"`
	ContextSwitches  int64   `json:"context_switches"`
	CFSThrottledMs   float64 `json:"cfs_throttled_ms"`
	IOWaitPercent    float64 `json:"io_wait_percent"`
	MemWorkingSetBytes int64 `json:"mem_working_set_bytes"`
	MemLimitBytes    int64   `json:"mem_limit_bytes"`
	DurationSec      float64 `json:"duration_sec"`
	TraceCount       int     `json:"trace_count"`
	Trend            string  `json:"trend"`
	Alerts           []MetricAlert `json:"alerts"`
}

// MetricAlert represents a resource alert derived from traces.
type MetricAlert struct {
	Type        string  `json:"type"`
	Severity    string  `json:"severity"`
	Message     string  `json:"message"`
	CurrentValue float64 `json:"current_value"`
	LimitValue   float64  `json:"limit_value,omitempty"`
}

// GetSandboxMetrics handles GET /api/v1/submissions/:id/sandbox-metrics
func (h *MetricsHandler) GetSandboxMetrics(c *gin.Context) {
	submissionID := c.Param("id")

	sub, err := h.subRepo.GetByID(c, submissionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "submission not found"})
		return
	}

	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)
	if role != "teacher" && role != "admin" && sub.StudentID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return
	}

	traces, err := h.subRepo.GetSyscallTraces(c, submissionID, 2000, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch traces"})
		return
	}

	metrics := deriveMetrics(sub, traces)

	c.JSON(http.StatusOK, metrics)
}

func deriveMetrics(sub *model.Submission, traces []repository.SyscallTraceRecord) SandboxMetricsResponse {
	m := SandboxMetricsResponse{
		SubmissionID: sub.ID,
		ExperimentID: sub.ExperimentID,
		TraceCount:   len(traces),
		FDSoftLimit:  1024,
		MemLimitMB:   256,
	}

	if len(traces) == 0 {
		m.Trend = "stable"
		m.Alerts = []MetricAlert{}
		return m
	}

	// ── Thread analysis ──
	pidSet := make(map[int]bool)
	for _, t := range traces {
		pidSet[t.PID] = true
	}
	m.ThreadCount = len(pidSet)

	// ── FD analysis ──
	fdOpen := 0
	fdMax := 0
	for _, t := range traces {
		switch t.SyscallName {
		case "openat", "socket", "pipe2", "dup", "dup2", "dup3":
			fdOpen++
		case "close":
			fdOpen--
		}
		if fdOpen > fdMax {
			fdMax = fdOpen
		}
	}
	m.FDCount = fdMax
	if fdMax < 0 {
		m.FDCount = 0
	}

	// ── CPU: heuristic from trace density ──
	if len(traces) >= 2 {
		duration := traces[len(traces)-1].Time.Sub(traces[0].Time).Seconds()
		m.DurationSec = math.Round(duration*100) / 100
		if duration > 0 {
			m.CPUPercent = clampPct(float64(len(traces)) / duration / 50 * 100)
			m.CFSThrottledMs = math.Max(0, (m.CPUPercent-80)*duration/100*100)
		}
	}

	// ── Memory: analyze memory-related syscalls ──
	var memOps int
	for _, t := range traces {
		switch t.SyscallName {
		case "brk", "mmap", "munmap", "mprotect", "madvise":
			memOps++
		}
	}
	if len(traces) > 0 {
		m.MemPercent = clampPct(float64(memOps) / float64(len(traces)) * 200)
	}
	m.MemOOMRisk = m.MemPercent / 100

	// ── I/O analysis ──
	var ioRead, ioWrite int64
	var ioWait float64
	for _, t := range traces {
		if t.SyscallName == "read" {
			ioRead += t.ReturnValue
			ioWait += float64(t.DurationNs)
		}
		if t.SyscallName == "write" {
			ioWrite += t.ReturnValue
			ioWait += float64(t.DurationNs)
		}
	}
	m.IOReadBytes = ioRead
	m.IOWriteBytes = ioWrite
	if m.DurationSec > 0 {
		m.IOWaitPercent = clampPct(ioWait / 1e6 / (m.DurationSec * 10) * 100)
	}

	// ── Page faults & context switches: from trace patterns ──
	for _, t := range traces {
		if t.SyscallName == "mprotect" || t.SyscallName == "madvise" {
			m.PageFaultsMinor++
		}
		if t.SyscallName == "mmap" && t.ErrorName == "ENOMEM" {
			m.PageFaultsMajor++
		}
	}
	m.ContextSwitches = int64(len(traces)) // syscall count ≈ context switches

	// ── Thread states ──
	futexCount := 0
	for _, t := range traces {
		if t.SyscallName == "futex" {
			futexCount++
		}
	}
	m.ThreadRunning = (len(traces) - futexCount) / maxInt(len(pidSet), 1)
	m.ThreadSleeping = futexCount / maxInt(len(pidSet), 1)
	if m.ThreadRunning > m.ThreadCount {
		m.ThreadRunning = m.ThreadCount
	}
	if m.ThreadSleeping < 0 {
		m.ThreadSleeping = 0
	}

	// ── Working set & limits ──
	m.MemWorkingSetBytes = int64(m.MemPercent) * 1024 * 1024 // rough estimate
	m.MemLimitBytes = int64(m.MemLimitMB) * 1024 * 1024
	m.MemRSSMB = float64(m.MemWorkingSetBytes) / 1024 / 1024

	// ── Trend analysis ──
	m.Trend = analyzeResourceTrend(traces)

	// ── Alerts ──
	m.Alerts = generateMetricAlerts(m)

	return m
}

func generateMetricAlerts(m SandboxMetricsResponse) []MetricAlert {
	var alerts []MetricAlert

	if m.CPUPercent > 90 {
		alerts = append(alerts, MetricAlert{
			Type: "cpu_throttle", Severity: "warning",
			Message: "CPU 使用率异常高, 可能存在死循环", CurrentValue: m.CPUPercent,
		})
	}
	if m.MemPercent > 80 {
		alerts = append(alerts, MetricAlert{
			Type: "mem_pressure", Severity: "warning",
			Message: "内存使用超过 80%", CurrentValue: m.MemPercent,
		})
	}
	if m.MemOOMRisk > 0.9 {
		alerts = append(alerts, MetricAlert{
			Type: "oom_kill", Severity: "critical",
			Message: "OOM Kill 风险极高", CurrentValue: m.MemOOMRisk * 100, LimitValue: 100,
		})
	}
	if m.FDCount > m.FDSoftLimit*8/10 {
		alerts = append(alerts, MetricAlert{
			Type: "fd_limit", Severity: "warning",
			Message: "FD 接近上限", CurrentValue: float64(m.FDCount), LimitValue: float64(m.FDSoftLimit),
		})
	}
	if m.CFSThrottledMs > 0 {
		alerts = append(alerts, MetricAlert{
			Type: "cpu_throttle", Severity: "info",
			Message: "CFS 调度器已节流", CurrentValue: m.CFSThrottledMs,
		})
	}

	return alerts
}

func analyzeResourceTrend(traces []repository.SyscallTraceRecord) string {
	if len(traces) < 5 {
		return "stable"
	}
	// Simple heuristic: count error trend in last 10%
	split := len(traces) * 9 / 10
	earlyErrs := 0
	lateErrs := 0
	for i, t := range traces {
		if t.ErrorName != "" {
			if i < split {
				earlyErrs++
			} else {
				lateErrs++
			}
		}
	}
	if lateErrs > earlyErrs+2 {
		return "degrading"
	}
	if lateErrs < earlyErrs-2 {
		return "improving"
	}
	return "stable"
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
