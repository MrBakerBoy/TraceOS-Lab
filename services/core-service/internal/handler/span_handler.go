package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/services"
	"github.com/traceos-lab/core-service/internal/middleware"
)

// SpanHandler serves span tree construction from syscall traces.
type SpanHandler struct {
	subRepo *repository.SubmissionRepo
	builder *services.SpanBuilder
}

// NewSpanHandler creates a new SpanHandler.
func NewSpanHandler(subRepo *repository.SubmissionRepo, builder *services.SpanBuilder) *SpanHandler {
	return &SpanHandler{subRepo: subRepo, builder: builder}
}

// GetSpanTree handles GET /api/v1/submissions/:id/span-tree
// Builds a hierarchical span tree from syscall traces.
func (h *SpanHandler) GetSpanTree(c *gin.Context) {
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

	// Convert traces to SyscallRecord
	records := make([]services.SyscallRecord, len(traces))
	for i, t := range traces {
		records[i] = services.SyscallRecord{
			Name:       t.SyscallName,
			Timestamp:  t.Time,
			DurationNs: t.DurationNs,
			PID:        t.PID,
			TID:        t.PID,
			ErrorName:  t.ErrorName,
		}
	}

	tree := h.builder.BuildFromRecords(records)

	// Count stats
	nodeCount, maxDepth := countTree(tree, 1)

	c.JSON(http.StatusOK, gin.H{
		"submission_id": sub.ID,
		"experiment_id": sub.ExperimentID,
		"trace_count":   len(traces),
		"node_count":    nodeCount,
		"max_depth":     maxDepth,
		"span_tree":     tree,
	})
}

// countTree counts total nodes and max depth recursively.
func countTree(node *services.SpanNode, depth int) (nodeCount int, maxDepth int) {
	if node == nil {
		return 0, 0
	}
	count := 1
	max := depth
	for _, child := range node.Children {
		cc, cd := countTree(child, depth+1)
		count += cc
		if cd > max {
			max = cd
		}
	}
	return count, max
}
