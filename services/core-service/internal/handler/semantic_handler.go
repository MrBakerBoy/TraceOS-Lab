package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/services"
	"github.com/traceos-lab/core-service/internal/middleware"
)

// SemanticHandler serves semantic analysis of syscall traces.
type SemanticHandler struct {
	subRepo *repository.SubmissionRepo
	engine  *services.SemanticEngine
}

// NewSemanticHandler creates a new SemanticHandler.
func NewSemanticHandler(subRepo *repository.SubmissionRepo, engine *services.SemanticEngine) *SemanticHandler {
	return &SemanticHandler{
		subRepo: subRepo,
		engine:  engine,
	}
}

// Analyze handles GET /api/v1/submissions/:id/semantic/analyze
// It fetches syscall traces and runs semantic pattern analysis.
func (h *SemanticHandler) Analyze(c *gin.Context) {
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

	// Fetch syscall traces
	traces, err := h.subRepo.GetSyscallTraces(c, submissionID, 2000, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch traces"})
		return
	}

	// Convert to string slice for SemanticEngine
	syscalls := make([]string, len(traces))
	for i, t := range traces {
		syscalls[i] = t.SyscallName
	}

	// Run semantic analysis
	results := h.engine.Analyze(syscalls)

	// Build per-syscall classification summary
	classifications := make([]gin.H, len(traces))
	for i, t := range traces {
		label, concept, severity := h.engine.ClassifyEvent(t.SyscallName)
		classifications[i] = gin.H{
			"index":     i,
			"syscall":   t.SyscallName,
			"label":     label,
			"concept":   concept,
			"severity":   severity,
			"error":     t.ErrorName,
			"pid":       t.PID,
			"ret":       t.ReturnValue,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"submission_id":   sub.ID,
		"experiment_id":   sub.ExperimentID,
		"student_id":      sub.StudentID,
		"trace_count":     len(traces),
		"pattern_count":   len(results),
		"patterns":        results,
		"classifications": classifications,
	})
}

// Classify handles GET /api/v1/submissions/:id/semantic/classify?syscall=write
// It classifies a single syscall name without requiring trace data.
func (h *SemanticHandler) Classify(c *gin.Context) {
	syscall := strings.TrimSpace(c.Query("syscall"))
	if syscall == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "syscall query parameter is required"})
		return
	}

	label, concept, severity := h.engine.ClassifyEvent(syscall)
	matched := h.engine.MatchSingle(syscall)

	var teachingNote string
	if matched != nil {
		teachingNote = matched.TeachingNote
	}

	c.JSON(http.StatusOK, gin.H{
		"syscall":        syscall,
		"label":          label,
		"concept":        concept,
		"severity":       severity,
		"teaching_note":  teachingNote,
		"has_match":      matched != nil,
	})
}
