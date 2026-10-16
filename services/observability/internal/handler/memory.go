package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/observability/internal/model"
)

// MemoryLayoutFetcher abstracts the read-side repository so the handler can be
// unit-tested with a mock. *repository.TimescaleRepo satisfies this interface.
type MemoryLayoutFetcher interface {
	GetMemoryLayout(ctx context.Context, submissionID string) ([]model.MemoryLayoutSnapshot, error)
}

// MemoryLayoutHandler exposes memory-layout snapshots for a submission.
type MemoryLayoutHandler struct {
	fetcher MemoryLayoutFetcher
}

// NewMemoryLayoutHandler creates a handler backed by the given fetcher.
func NewMemoryLayoutHandler(fetcher MemoryLayoutFetcher) *MemoryLayoutHandler {
	return &MemoryLayoutHandler{fetcher: fetcher}
}

// GetMemoryLayout returns the ordered memory-layout snapshots.
// GET /api/obs/analysis/memory-layout/:submission_id
func (h *MemoryLayoutHandler) GetMemoryLayout(c *gin.Context) {
	submissionID := c.Param("submission_id")
	if submissionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "submission_id is required"})
		return
	}

	snapshots, err := h.fetcher.GetMemoryLayout(c.Request.Context(), submissionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"submission_id": submissionID,
		"snapshots":     snapshots,
		"total":         len(snapshots),
	})
}
