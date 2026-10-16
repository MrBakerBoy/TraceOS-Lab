package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/services"
)

// MemoryTrendHandler serves memory trend analysis data.
type MemoryTrendHandler struct {
	subRepo *repository.SubmissionRepo
}

// NewMemoryTrendHandler creates a new MemoryTrendHandler.
func NewMemoryTrendHandler(subRepo *repository.SubmissionRepo) *MemoryTrendHandler {
	return &MemoryTrendHandler{subRepo: subRepo}
}

// GetMemoryTrend handles GET /api/v1/submissions/:id/memory-trend
func (h *MemoryTrendHandler) GetMemoryTrend(c *gin.Context) {
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

	_ = detector.Analyze()

	heapHistory := detector.GetHeapHistory()
	trend := detector.GetTrendAnalysis()

	type HeapTimelinePoint struct {
		Timestamp     time.Time `json:"timestamp"`
		HeapSize      uint64    `json:"heap_size"`
		PeakHeap      uint64    `json:"peak_heap"`
		AllocCount    int       `json:"alloc_count"`
		FreeCount     int       `json:"free_count"`
		AllocRateMbps float64   `json:"alloc_rate_mbps"`
		FreeRateMbps  float64   `json:"free_rate_mbps"`
	}

	// Downsample heap history to at most 100 points for the frontend
	timeline := make([]HeapTimelinePoint, 0, len(heapHistory))
	step := 1
	if len(heapHistory) > 100 {
		step = len(heapHistory) / 100
	}
	for i := 0; i < len(heapHistory); i += step {
		snap := heapHistory[i]
		timeline = append(timeline, HeapTimelinePoint{
			Timestamp:  snap.Timestamp,
			HeapSize:   snap.HeapSize,
			PeakHeap:   snap.PeakHeap,
			AllocCount: snap.AllocCount,
			FreeCount:  snap.FreeCount,
		})
	}
	// Always include the last point
	if len(heapHistory) > 0 && step > 1 {
		last := heapHistory[len(heapHistory)-1]
		timeline = append(timeline, HeapTimelinePoint{
			Timestamp: last.Timestamp,
			HeapSize:  last.HeapSize,
			PeakHeap:  last.PeakHeap,
		})
	}

	type MemoryTrendResponse struct {
		SubmissionID string              `json:"submission_id"`
		ExperimentID string              `json:"experiment_id"`
		Timeline     []HeapTimelinePoint `json:"heap_timeline"`
		Summary      struct {
			TrendDirection string    `json:"trend_direction"`
			GrowthRateMbps float64   `json:"growth_rate_mbps"`
			PeakHeapBytes  uint64    `json:"peak_heap_bytes"`
			PeakTime       time.Time `json:"peak_time"`
			StillAllocated uint64    `json:"still_allocated"`
		} `json:"summary"`
		TraceCount    int       `json:"trace_count"`
		MemEventCount int       `json:"mem_event_count"`
		GeneratedAt   time.Time `json:"generated_at"`
	}

	resp := MemoryTrendResponse{
		SubmissionID: sub.ID,
		ExperimentID: sub.ExperimentID,
		Timeline:     timeline,
		Summary: struct {
			TrendDirection string    `json:"trend_direction"`
			GrowthRateMbps float64   `json:"growth_rate_mbps"`
			PeakHeapBytes  uint64    `json:"peak_heap_bytes"`
			PeakTime       time.Time `json:"peak_time"`
			StillAllocated uint64    `json:"still_allocated"`
		}{
			TrendDirection: trend.TrendDirection,
			GrowthRateMbps: trend.GrowthRateMbps,
			PeakHeapBytes:  trend.PeakHeapBytes,
			PeakTime:       trend.PeakTime,
			StillAllocated: trend.StillAllocated,
		},
		TraceCount:    len(traces),
		MemEventCount: len(memEvents),
		GeneratedAt:   time.Now(),
	}

	c.JSON(http.StatusOK, resp)
}
