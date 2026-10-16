package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/observability/internal/repository"
)

// AnalysisHandler provides analytical endpoints for trace data.
type AnalysisHandler struct {
	repo *repository.TimescaleRepo
}

// NewAnalysisHandler creates a new analysis handler.
func NewAnalysisHandler(repo *repository.TimescaleRepo) *AnalysisHandler {
	return &AnalysisHandler{repo: repo}
}

// FDLeakAnalysis analyzes file descriptor operations for leaks.
// GET /api/obs/analysis/fd-leak/:submission_id
func (h *AnalysisHandler) FDLeakAnalysis(c *gin.Context) {
	submissionID := c.Param("submission_id")
	traces, _, err := h.repo.GetSyscallTraces(c, submissionID, 5000, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	opens := 0
	closes := 0
	openDetails := make([]map[string]interface{}, 0)
	closeDetails := make([]map[string]interface{}, 0)

	for _, t := range traces {
		switch t.SyscallName {
		case "open", "openat", "creat", "socket", "pipe", "pipe2", "dup", "dup2", "dup3":
			opens++
			if t.ErrorName == nil || *t.ErrorName == "" {
				openDetails = append(openDetails, map[string]interface{}{
					"syscall": t.SyscallName, "pid": t.PID,
					"return_value": t.ReturnValue, "time": t.Time,
				})
			}
		case "close":
			closes++
			if t.ErrorName != nil && *t.ErrorName != "" {
				closeDetails = append(closeDetails, map[string]interface{}{
					"syscall": t.SyscallName, "pid": t.PID,
					"error": t.ErrorName, "time": t.Time,
				})
			}
		}
	}

	leaked := opens - closes
	hasLeak := opens > 0 && closes < opens

	c.JSON(http.StatusOK, gin.H{
		"submission_id": submissionID,
		"opens":         opens,
		"closes":        closes,
		"leaked":        leaked,
		"has_leak":      hasLeak,
		"open_details":  openDetails,
		"close_details": closeDetails,
	})
}

// MemoryAnalysis analyzes memory allocation/deallocation patterns.
// GET /api/obs/analysis/memory/:submission_id
func (h *AnalysisHandler) MemoryAnalysis(c *gin.Context) {
	submissionID := c.Param("submission_id")
	traces, _, err := h.repo.GetSyscallTraces(c, submissionID, 5000, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	allocs := 0
	frees := 0
	var allocSizes []int64
	var freeSizes []int64

	for _, t := range traces {
		switch t.SyscallName {
		case "brk", "mmap", "mmap2":
			allocs++
			if t.ReturnValue > 0 {
				allocSizes = append(allocSizes, t.ReturnValue)
			}
		case "munmap", "munmap2":
			frees++
			if t.ReturnValue == 0 {
				freeSizes = append(freeSizes, 1) // successful munmap
			}
		}
	}

	totalAlloc := int64(0)
	for _, s := range allocSizes {
		totalAlloc += s
	}

	imbalance := false
	if allocs > 0 && frees < allocs {
		ratio := float64(frees) / float64(allocs)
		imbalance = ratio < 0.5
	}

	c.JSON(http.StatusOK, gin.H{
		"submission_id": submissionID,
		"allocations":   allocs,
		"deallocations": frees,
		"total_alloc_size": totalAlloc,
		"has_imbalance":    imbalance,
	})
}

// ProcessAnalysis analyzes process creation/reaping patterns.
// GET /api/obs/analysis/process/:submission_id
func (h *AnalysisHandler) ProcessAnalysis(c *gin.Context) {
	submissionID := c.Param("submission_id")
	traces, _, err := h.repo.GetSyscallTraces(c, submissionID, 5000, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	forks := 0
	waits := 0
	var childPIDs []int

	for _, t := range traces {
		switch t.SyscallName {
		case "fork", "vfork", "clone", "clone3":
			forks++
			if t.ReturnValue > 0 {
				childPIDs = append(childPIDs, int(t.ReturnValue))
			}
		case "wait4", "waitid", "waitpid":
			waits++
		}
	}

	hasZombieRisk := forks > 0 && waits < forks

	c.JSON(http.StatusOK, gin.H{
		"submission_id": submissionID,
		"fork_count":    forks,
		"wait_count":    waits,
		"child_pids":    childPIDs,
		"zombie_risk":   hasZombieRisk,
	})
}

// SyscallPatterns provides a comprehensive pattern analysis for a submission.
// GET /api/obs/analysis/patterns/:submission_id
func (h *AnalysisHandler) SyscallPatterns(c *gin.Context) {
	submissionID := c.Param("submission_id")
	errorsOnly := c.Query("errors_only") == "true"
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "5000"))
	if limit > 10000 {
		limit = 10000
	}

	traces, summary, err := h.repo.GetSyscallTraces(c, submissionID, limit, errorsOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Build per-syscall error distribution
	errorDist := make(map[string]map[string]int)
	for _, t := range traces {
		if t.ErrorName != nil && *t.ErrorName != "" {
			if errorDist[t.SyscallName] == nil {
				errorDist[t.SyscallName] = make(map[string]int)
			}
			errorDist[t.SyscallName][*t.ErrorName]++
		}
	}

	// Detect patterns
	patterns := []gin.H{}
	analyzeFDPatterns(traces, &patterns)
	analyzeMemoryPatterns(traces, &patterns)
	analyzeProcessPatterns(traces, &patterns)

	c.JSON(http.StatusOK, gin.H{
		"submission_id":  submissionID,
		"summary":        summary,
		"error_distribution": errorDist,
		"patterns":       patterns,
	})
}

func analyzeFDPatterns(traces []repository.SyscallTrace, patterns *[]gin.H) {
	opens := 0
	closes := 0
	for _, t := range traces {
		switch t.SyscallName {
		case "open", "openat", "creat", "socket", "pipe", "pipe2", "dup", "dup2", "dup3":
			opens++
		case "close":
			closes++
		}
	}
	if opens > 0 && closes < opens {
		*patterns = append(*patterns, gin.H{
			"type": "fd_leak", "severity": "medium",
			"detail": gin.H{"opens": opens, "closes": closes, "difference": opens - closes},
		})
	}
}

func analyzeMemoryPatterns(traces []repository.SyscallTrace, patterns *[]gin.H) {
	allocs := 0
	frees := 0
	for _, t := range traces {
		switch t.SyscallName {
		case "brk", "mmap", "mmap2":
			allocs++
		case "munmap", "munmap2":
			frees++
		}
	}
	if allocs > 0 && frees < allocs && float64(frees)/float64(allocs) < 0.5 {
		*patterns = append(*patterns, gin.H{
			"type": "memory_leak", "severity": "high",
			"detail": gin.H{"allocations": allocs, "deallocations": frees},
		})
	}
}

func analyzeProcessPatterns(traces []repository.SyscallTrace, patterns *[]gin.H) {
	forks := 0
	waits := 0
	for _, t := range traces {
		switch t.SyscallName {
		case "fork", "vfork", "clone", "clone3":
			forks++
		case "wait4", "waitid", "waitpid":
			waits++
		}
	}
	if forks > 0 && waits < forks {
		*patterns = append(*patterns, gin.H{
			"type": "zombie_risk", "severity": "high",
			"detail": gin.H{"forks": forks, "waits": waits},
		})
	}
}
