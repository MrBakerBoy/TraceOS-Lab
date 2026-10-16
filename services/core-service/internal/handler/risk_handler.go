package handler

import (
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/services"
	"github.com/traceos-lab/core-service/internal/middleware"
)

// RiskHandler serves risk indicator computation.
type RiskHandler struct {
	subRepo *repository.SubmissionRepo
	risk    *services.RiskIndicator
}

// NewRiskHandler creates a new RiskHandler.
func NewRiskHandler(subRepo *repository.SubmissionRepo, risk *services.RiskIndicator) *RiskHandler {
	return &RiskHandler{subRepo: subRepo, risk: risk}
}

// GetRiskIndicators handles GET /api/v1/submissions/:id/risk-indicators
// Computes composite risk indicators from submission trace data.
func (h *RiskHandler) GetRiskIndicators(c *gin.Context) {
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

	// Fetch traces to derive metrics
	traces, err := h.subRepo.GetSyscallTraces(c, submissionID, 2000, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch traces"})
		return
	}

	// Derive metrics from traces
	cpuPct, memPct, connPct, fdPct := deriveMetricPcts(traces)
	syscallErrRate := deriveSyscallErrorRate(traces)
	ioLatencySpike := deriveIOLatencySpike(traces)
	backlogGrowth := deriveBacklogGrowth(traces)
	now := time.Now()

	// Compute risk indicators
	result, alerts := h.risk.ComputeWithAlerts(
		cpuPct, memPct, connPct, fdPct,
		syscallErrRate, ioLatencySpike, backlogGrowth,
		0, 0, now,
	)

	c.JSON(http.StatusOK, gin.H{
		"submission_id":  sub.ID,
		"experiment_id":  sub.ExperimentID,
		"trace_count":    len(traces),
		"risk_indicators": result,
		"anomaly_alerts":  alerts,
		"derived_metrics": gin.H{
			"cpu_pct":           cpuPct,
			"mem_pct":           memPct,
			"conn_pct":          connPct,
			"fd_pct":            fdPct,
			"syscall_err_rate":  syscallErrRate,
			"io_latency_spike":  ioLatencySpike,
			"backlog_growth":    backlogGrowth,
		},
	})
}

// ── Metric derivation from syscall traces ───────────────────────────────

func deriveMetricPcts(traces []repository.SyscallTraceRecord) (cpu, mem, conn, fd float64) {
	if len(traces) == 0 {
		return 0, 0, 0, 0
	}

	// Count by category
	cpuCount, memCount, connCount, fdCount := 0, 0, 0, 0
	for _, t := range traces {
		switch classifyMetricCategory(t.SyscallName) {
		case "cpu":
			cpuCount++
		case "mem":
			memCount++
		case "conn":
			connCount++
		case "fd":
			fdCount++
		}
	}

	total := len(traces)
	if total == 0 {
		return 0, 0, 0, 0
	}

	// Normalize to 0-100% based on proportional activity
	return clampPct(float64(cpuCount) / float64(total) * 100),
		clampPct(float64(memCount) / float64(total) * 100),
		clampPct(float64(connCount) / float64(total) * 100),
		clampPct(float64(fdCount) / float64(total) * 100)
}

func classifyMetricCategory(syscall string) string {
	cpuSet := map[string]bool{
		"clone": true, "execve": true, "exit": true, "exit_group": true,
		"prctl": true, "arch_prctl": true, "sched_yield": true, "getpid": true,
	}
	memSet := map[string]bool{
		"brk": true, "mmap": true, "munmap": true, "mprotect": true,
		"madvise": true, "mremap": true,
	}
	connSet := map[string]bool{
		"futex": true, "wait4": true, "kill": true, "rt_sigaction": true,
		"tgkill": true, "tkill": true, "rt_sigprocmask": true,
	}
	fdSet := map[string]bool{
		"openat": true, "close": true, "read": true, "write": true,
		"pipe2": true, "socket": true, "bind": true, "listen": true, "accept4": true,
		"dup": true, "dup2": true, "dup3": true, "fcntl": true,
	}

	if cpuSet[syscall] {
		return "cpu"
	}
	if memSet[syscall] {
		return "mem"
	}
	if connSet[syscall] {
		return "conn"
	}
	if fdSet[syscall] {
		return "fd"
	}
	return "other"
}

func deriveSyscallErrorRate(traces []repository.SyscallTraceRecord) float64 {
	if len(traces) == 0 {
		return 0
	}
	errors := 0
	for _, t := range traces {
		if t.ErrorName != "" {
			errors++
		}
	}
	return clampPct(float64(errors) / float64(len(traces)) * 100)
}

func deriveIOLatencySpike(traces []repository.SyscallTraceRecord) float64 {
	var totalDuration int64
	ioCount := 0
	for _, t := range traces {
		if t.SyscallName == "read" || t.SyscallName == "write" ||
			t.SyscallName == "openat" || t.SyscallName == "close" {
			totalDuration += t.DurationNs
			ioCount++
		}
	}
	if ioCount == 0 {
		return 0
	}
	avgMs := float64(totalDuration) / float64(ioCount) / 1e6
	// Spike = ratio of avg to reference (0.2ms = normal)
	spike := math.Min(100, (avgMs/0.2)*20)
	return clampPct(spike)
}

func deriveBacklogGrowth(traces []repository.SyscallTraceRecord) float64 {
	if len(traces) < 2 {
		return 0
	}
	// Count futex wait calls as backlog proxy
	futexWaits := 0
	for _, t := range traces {
		if t.SyscallName == "futex" && t.ErrorName == "" {
			futexWaits++
		}
	}
	duration := traces[len(traces)-1].Time.Sub(traces[0].Time).Seconds()
	if duration <= 0 {
		return 0
	}
	return clampPct(float64(futexWaits) / duration)
}

func clampPct(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return math.Round(v*10) / 10
}
