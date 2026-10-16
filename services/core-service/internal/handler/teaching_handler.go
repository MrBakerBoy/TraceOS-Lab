package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/services"
)

// TeachingHandler serves Supraptive Method teaching narratives and
// follow-up questions powered by the TeachingNarrativeEngine.
type TeachingHandler struct {
	subRepo *repository.SubmissionRepo
	engine  *services.TeachingNarrativeEngine
}

// NewTeachingHandler creates a new TeachingHandler.
func NewTeachingHandler(subRepo *repository.SubmissionRepo, engine *services.TeachingNarrativeEngine) *TeachingHandler {
	return &TeachingHandler{
		subRepo: subRepo,
		engine:  engine,
	}
}

// BuildNarrative handles POST /api/v1/submissions/:id/teaching-narrative
// Generates a story-based teaching narrative for a detected issue type.
// Request body: { issue_type: string, params: Record<string, string> }
func (h *TeachingHandler) BuildNarrative(c *gin.Context) {
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

	var req struct {
		IssueType string            `json:"issue_type" binding:"required"`
		Params    map[string]string `json:"params"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "issue_type is required"})
		return
	}

	if req.Params == nil {
		req.Params = make(map[string]string)
	}

	result := h.engine.BuildNarrative(req.IssueType, req.Params)

	c.JSON(http.StatusOK, gin.H{
		"submission_id": sub.ID,
		"narrative":     result,
	})
}

// GetFollowupQuestions handles POST /api/v1/submissions/:id/followup-questions
// Generates Socratic follow-up questions for an identified issue.
// Request body: { issue_type: string, os_concept?: string }
func (h *TeachingHandler) GetFollowupQuestions(c *gin.Context) {
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

	var req struct {
		IssueType string `json:"issue_type" binding:"required"`
		OSConcept string `json:"os_concept"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "issue_type is required"})
		return
	}

	questions := h.engine.GenerateFollowupQuestions(req.IssueType, req.OSConcept)

	c.JSON(http.StatusOK, gin.H{
		"submission_id": sub.ID,
		"issue_type":    req.IssueType,
		"os_concept":    req.OSConcept,
		"questions":     questions,
	})
}
