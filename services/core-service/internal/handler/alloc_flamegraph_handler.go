package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/services"
)

// AllocFlamegraphHandler serves memory allocation flame graph data.
type AllocFlamegraphHandler struct {
	subRepo *repository.SubmissionRepo
}

// NewAllocFlamegraphHandler creates a new AllocFlamegraphHandler.
func NewAllocFlamegraphHandler(subRepo *repository.SubmissionRepo) *AllocFlamegraphHandler {
	return &AllocFlamegraphHandler{subRepo: subRepo}
}

// GetAllocFlamegraph handles GET /api/v1/submissions/:id/alloc-flamegraph
func (h *AllocFlamegraphHandler) GetAllocFlamegraph(c *gin.Context) {
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

	traces, err := h.subRepo.GetSyscallTraces(c, submissionID, 5000, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch traces"})
		return
	}

	detector := services.NewLeakDetector()
	memEvents := extractMemoryEvents(traces)

	for _, evt := range memEvents {
		if evt.IsFree {
			detector.RecordFree(evt.Address, evt.Timestamp)
		} else {
			detector.RecordAlloc(evt.Address, evt.Size, evt.SourceFile, evt.SourceLine, nil, evt.Timestamp)
		}
	}

	detector.Analyze()

	topAllocators := detector.GetTopAllocators(20)
	summary := detector.GetHeaptrackSummary()

	type AllocFlamegraphResponse struct {
		SubmissionID  string                     `json:"submission_id"`
		ExperimentID  string                     `json:"experiment_id"`
		TopAllocators []services.TopAllocator    `json:"top_allocators"`
		Summary       *services.HeaptrackSummary `json:"summary"`
		TraceCount    int                        `json:"trace_count"`
		MemEventCount int                        `json:"mem_event_count"`
		GeneratedAt   time.Time                  `json:"generated_at"`
	}

	resp := AllocFlamegraphResponse{
		SubmissionID:  sub.ID,
		ExperimentID:  sub.ExperimentID,
		TopAllocators: topAllocators,
		Summary:       summary,
		TraceCount:    len(traces),
		MemEventCount: len(memEvents),
		GeneratedAt:   time.Now(),
	}

	c.JSON(http.StatusOK, resp)
}
