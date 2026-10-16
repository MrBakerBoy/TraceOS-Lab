package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/observability/internal/repository"
)

type TraceHandler struct {
	repo *repository.TimescaleRepo
}

func NewTraceHandler(repo *repository.TimescaleRepo) *TraceHandler {
	return &TraceHandler{repo: repo}
}

func (h *TraceHandler) GetTraces(c *gin.Context) {
	submissionID := c.Param("submission_id")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "500"))
	errorsOnly := c.Query("errors_only") == "true"

	if limit > 2000 {
		limit = 2000
	}

	traces, summary, err := h.repo.GetSyscallTraces(c, submissionID, limit, errorsOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"submission_id": submissionID,
		"summary":       summary,
		"traces":        traces,
	})
}

func (h *TraceHandler) GetMetrics(c *gin.Context) {
	submissionID := c.Param("submission_id")

	events, err := h.repo.GetPerformanceMetrics(c, submissionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"submission_id": submissionID,
		"metrics":       events,
		"total":         len(events),
	})
}

func (h *TraceHandler) GetResources(c *gin.Context) {
	submissionID := c.Param("submission_id")

	points, err := h.repo.GetResourceUsage(c, submissionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"submission_id": submissionID,
		"points":        points,
		"total":         len(points),
	})
}
