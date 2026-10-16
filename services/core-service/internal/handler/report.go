package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/repository"
)

// ReportHandler handles experiment report CRUD and grading.
type ReportHandler struct {
	repo *repository.ReportRepo
}

// NewReportHandler creates a new report handler.
func NewReportHandler(repo *repository.ReportRepo) *ReportHandler {
	return &ReportHandler{repo: repo}
}

type submitReportRequest struct {
	Content string  `json:"content" binding:"required"`
	FileURL *string `json:"file_url,omitempty"`
}

type gradeReportRequest struct {
	Score    int    `json:"score" binding:"required"`
	Feedback string `json:"feedback"`
}

// Submit creates or updates a report for a submission.
// POST /api/v1/submissions/:id/report
func (h *ReportHandler) Submit(c *gin.Context) {
	submissionID := c.Param("id")
	studentID := middleware.GetUserID(c)

	var req submitReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	report := &repository.Report{
		SubmissionID: submissionID,
		StudentID:    studentID,
		Content:      req.Content,
		FileURL:      req.FileURL,
	}

	if err := h.repo.Create(c, report); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Async trigger AI report evaluation
	go func(subID, content string) {
		aiServiceURL := os.Getenv("AI_SERVICE_URL")
		if aiServiceURL == "" {
			aiServiceURL = "http://ai-service:8000"
		}
		payload := map[string]interface{}{
			"report_content":     content,
			"experiment_title":   "",
			"experiment_category": "",
		}
		body, _ := json.Marshal(payload)
		httpReq, _ := http.NewRequest("POST", aiServiceURL+"/api/ai/report/evaluate", bytes.NewReader(body))
		httpReq.Header.Set("Content-Type", "application/json")
		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(httpReq)
		if err != nil {
			return
		}
		defer resp.Body.Close()
		var result map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&result)
		if score, ok := result["total_score"].(float64); ok {
			dbCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			dimJSON, _ := json.Marshal(result["dimension_scores"])
			feedback := ""
			if f, ok := result["feedback"].(string); ok {
				feedback = f
			}
			h.repo.DB().Exec(dbCtx,
				"UPDATE experiment_reports SET ai_score=$1, ai_feedback=$2, ai_dimension_scores=$3 WHERE submission_id=$4",
				int(score), feedback, dimJSON, subID)
		}
	}(submissionID, req.Content)

	c.JSON(http.StatusCreated, gin.H{"data": report})
}

// Get returns the report for a submission.
// GET /api/v1/submissions/:id/report
func (h *ReportHandler) Get(c *gin.Context) {
	submissionID := c.Param("id")
	report, err := h.repo.GetBySubmission(c, submissionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "report not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": report})
}

// Grade assigns a score and feedback to a report.
// PUT /api/v1/reports/:id/grade
func (h *ReportHandler) Grade(c *gin.Context) {
	var req gradeReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.repo.Grade(c, c.Param("id"), req.Score, req.Feedback); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "graded"})
}
