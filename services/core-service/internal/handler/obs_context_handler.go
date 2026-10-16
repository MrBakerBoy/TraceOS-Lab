package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/services"
	"github.com/traceos-lab/core-service/internal/middleware"
)

// ObsContextHandler serves aggregated observability context for a submission.
type ObsContextHandler struct {
	subRepo    *repository.SubmissionRepo
	builder    *services.ObsContextBuilder
	trigger    *services.CompositeTrigger
	linker     *services.EventLinker
	calibrator *services.TimelineCalibrator
}

// NewObsContextHandler creates a new ObsContextHandler.
func NewObsContextHandler(
	subRepo *repository.SubmissionRepo,
	builder *services.ObsContextBuilder,
	trigger *services.CompositeTrigger,
	linker *services.EventLinker,
	calibrator *services.TimelineCalibrator,
) *ObsContextHandler {
	return &ObsContextHandler{
		subRepo:    subRepo,
		builder:    builder,
		trigger:    trigger,
		linker:     linker,
		calibrator: calibrator,
	}
}

// GetObsContext handles GET /api/v1/submissions/:id/obs-context
// It aggregates syscall traces, memory layouts, and evaluation results
// into a unified ObsContext response for the frontend Tier visualization.
func (h *ObsContextHandler) GetObsContext(c *gin.Context) {
	submissionID := c.Param("id")

	sub, err := h.subRepo.GetByID(c, submissionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "submission not found"})
		return
	}

	// Auth check
	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)
	if role != "teacher" && role != "admin" && sub.StudentID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return
	}

	// Fetch syscall traces (up to 2000 events for analysis)
	traces, err := h.subRepo.GetSyscallTraces(c, submissionID, 2000, false)
	if err != nil {
		// Non-fatal: continue with empty traces
		traces = nil
	}

	// Dereference nullable score fields
	score := 0
	totalScore := 100
	if sub.Score != nil {
		score = *sub.Score
	}
	if sub.TotalScore != nil {
		totalScore = *sub.TotalScore
	}

	// Build BuildParams from submission + traces
	params := services.BuildParams{
		SubmissionID:   sub.ID,
		ExperimentID:   sub.ExperimentID,
		StudentID:      sub.StudentID,
		Language:       sub.Language,
		TimelineStart:  time.Now().Add(-5 * time.Minute),
		TimelineEnd:    time.Now(),
		Score:          score,
		TotalScore:     totalScore,
		PassedCases:    sub.PassedTestCases,
		TotalCases:     sub.TotalTestCases,
	}

	// Set compile/runtime errors
	if sub.CompileError != nil && *sub.CompileError != "" {
		params.CompileError = sub.CompileError
	}
	if sub.RuntimeError != nil && *sub.RuntimeError != "" {
		params.RuntimeError = sub.RuntimeError
	}

	// Convert syscall traces to service input format
	if traces != nil {
		for i, t := range traces {
			params.SyscallTraces = append(params.SyscallTraces, services.SyscallTraceInput{
				Timestamp:  t.Time,
				Syscall:    t.SyscallName,
				PID:        t.PID,
				TID:        t.PID, // fallback
				Ret:        t.ReturnValue,
				DurationNs: t.DurationNs,
				ErrorName:  t.ErrorName,
			})

			// Detect issues from error traces
			if t.ErrorName != "" {
				params.DetectedIssues = append(params.DetectedIssues, services.DetectedIssueInput{
					Category:    classifyError(t.SyscallName, t.ErrorName),
					Title:       t.SyscallName + " 返回错误: " + t.ErrorName,
					Severity:    "warning",
					Description: "系统调用 " + t.SyscallName + " 返回错误 " + t.ErrorName,
				})
			}

			// Use first/last trace timestamps for timeline
			if i == 0 {
				params.TimelineStart = t.Time
			}
			if i == len(traces)-1 {
				params.TimelineEnd = t.Time
			}
		}
	}

	// Load resource usage metrics for this submission
	resourceRecords, err := h.subRepo.GetResourceUsage(c, submissionID)
	if err != nil {
		// Non-fatal: continue without resource metrics
		resourceRecords = nil
	}
	for _, rec := range resourceRecords {
		params.ResourceMetrics = append(params.ResourceMetrics, services.ResourceMetricInput{
			Timestamp:    rec.Time,
			CPUPercent:   rec.CPUPercent,
			MemRSS:       uint64(rec.MemoryBytes),
			MemVirtual:   uint64(rec.MemoryBytes),
			IOReadBytes:  uint64(rec.DiskReadBytes),
			IOWriteBytes: uint64(rec.DiskWriteBytes),
			FDCount:      0,
			ThreadCount:  0,
		})
	}

	// Load memory-layout snapshots for this submission
	memRecords, err := h.subRepo.GetMemoryLayouts(c, submissionID, 500)
	if err != nil {
		// Non-fatal: continue without memory snapshots
		memRecords = nil
	}

	// Build ObsContext
	obsCtx := h.builder.Build(params)

	// Inject Tier-3 function-debug fields (race/deadlock/leak/span) inline
	// so the frontend T2 -> T3 drill-down has data without separate calls.
	if traces != nil {
		injectT3(obsCtx, traces)

		// Enrich T2/T3 datasets that are derived from syscall traces and are
		// not produced by the builder (lock events, flame graph, call chains,
		// source annotations).
		obsCtx.LockEvents = buildLockEvents(traces)
		if obsCtx.FlameGraph == nil {
			obsCtx.FlameGraph = buildSyscallFlameGraph(traces)
		}
		obsCtx.CallChains = buildCallChains(traces)
		obsCtx.SourceAnnotations = buildSourceAnnotations(traces)
	}
	if memRecords != nil {
		obsCtx.MemorySnapshots = buildMemorySnapshots(memRecords)
	}

	// Run composite trigger — multi-signal anomaly detection (Datadog Composite Monitor pattern)
	compositeResult := h.trigger.FeedObsContext(obsCtx)

	// Run event linker — cross-module correlation (Datadog Event Overlay pattern)
	crossLinks := h.linker.LinkAll(obsCtx)

	// Build calibrated timeline from all event sources
	calibratedTimeline := h.calibrator.Calibrate(
		obsCtx.SyscallTraces,
		obsCtx.LockEvents,
		obsCtx.MemorySnapshots,
		obsCtx.ResourceMetrics,
		obsCtx.PerfEvents,
		obsCtx.EventAnnotations,
	)

	c.JSON(http.StatusOK, gin.H{
		"submission_id":        sub.ID,
		"experiment_id":        sub.ExperimentID,
		"student_id":           sub.StudentID,
		"obs_context":          obsCtx,
		"trace_count":          len(traces),
		"composite_trigger":    compositeResult,
		"cross_module_links":   crossLinks,
		"calibrated_timeline":  calibratedTimeline,
	})
}

// classifyError maps syscall+error combinations to issue categories.
func classifyError(syscall, errName string) string {
	// Lock-related errors → deadlock category
	lockSyscalls := map[string]bool{
		"futex": true, "pthread_mutex_lock": true, "pthread_mutex_trylock": true,
		"pthread_rwlock_rdlock": true, "pthread_rwlock_wrlock": true,
		"sem_wait": true, "sem_trywait": true, "flock": true,
	}
	if lockSyscalls[syscall] {
		return "deadlock"
	}

	// Memory-related errors → leak/oom category
	memSyscalls := map[string]bool{
		"brk": true, "mmap": true, "munmap": true, "mprotect": true,
		"madvise": true, "sbrk": true,
	}
	if memSyscalls[syscall] {
		return "leak"
	}

	return "syscall_error"
}
