package handler

import (
	"context"
	"log"
	"math"
	"net/http"
	"runtime/debug"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/evaluator"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/model"
	"github.com/traceos-lab/core-service/internal/nats"
	"github.com/traceos-lab/core-service/internal/repository"
)

type SubmissionHandler struct {
	subRepo    *repository.SubmissionRepo
	expRepo    *repository.ExperimentRepo
	pipeline   *evaluator.Pipeline
	eventBus   nats.EventBus
	workerPool *evaluator.WorkerPool
}

func NewSubmissionHandler(subRepo *repository.SubmissionRepo, expRepo *repository.ExperimentRepo, pipeline *evaluator.Pipeline, eventBus nats.EventBus, workerPool *evaluator.WorkerPool) *SubmissionHandler {
	return &SubmissionHandler{subRepo: subRepo, expRepo: expRepo, pipeline: pipeline, eventBus: eventBus, workerPool: workerPool}
}

type SubmitRequest struct {
	ExperimentID    string `json:"experiment_id" binding:"required"`
	Language        string `json:"language" binding:"required,oneof=c cpp python rust go"`
	Code            string `json:"code" binding:"required"`
	CompetitionMode string `json:"competition_mode" binding:"omitempty,oneof=high low"`
}

func (h *SubmissionHandler) Submit(c *gin.Context) {
	var req SubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	studentID := middleware.GetUserID(c)

	competitionMode := req.CompetitionMode
	if competitionMode == "" {
		competitionMode = "high"
	}

	exp, err := h.expRepo.GetByID(c, req.ExperimentID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "experiment not found"})
		return
	}

	num, err := h.subRepo.GetNextNumber(c, req.ExperimentID, studentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Check submission count (not submission_number) against the limit so
	// gaps or anomalies in numbering don't block new submissions.
	count, err := h.subRepo.GetSubmissionCount(c, req.ExperimentID, studentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if count >= exp.MaxSubmissions {
		c.JSON(http.StatusForbidden, gin.H{"error": "max submissions reached"})
		return
	}

	sub := &model.Submission{
		ExperimentID:     req.ExperimentID,
		StudentID:        studentID,
		Code:             req.Code,
		Language:         req.Language,
		SubmissionNumber: num,
		Status:           "pending",
		CompetitionMode:  competitionMode,
	}

	if err := h.subRepo.Create(c, sub); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Submit to worker pool for concurrent evaluation
	if h.workerPool != nil {
		task := evaluator.Task{
			SubmissionID: sub.ID,
			ExperimentID: req.ExperimentID,
			StudentID:    studentID,
		}
		if !h.workerPool.Submit(task) {
			log.Printf("[SubmissionHandler] worker pool queue full, falling back to direct eval")
			go h.safeEvaluate(sub.ID, req.ExperimentID, studentID)
		}
	} else {
		go h.safeEvaluate(sub.ID, req.ExperimentID, studentID)
	}

	c.JSON(http.StatusCreated, gin.H{
		"submission_id":     sub.ID,
		"status":            sub.Status,
		"submission_number": sub.SubmissionNumber,
		"created_at":        sub.CreatedAt,
	})
}

// safeEvaluate wraps the evaluation call with panic recovery.
func (h *SubmissionHandler) safeEvaluate(submissionID, experimentID, studentID string) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[SubmissionHandler] PANIC in evaluation goroutine for %s: %v\n%s",
				submissionID, r, string(debug.Stack()))
			errMsg := "internal evaluation error"
			h.subRepo.UpdateResult(context.Background(), submissionID, "failed", 0, 100, 0, 0, nil, &errMsg, nil, nil)
		}
	}()
	h.evaluate(submissionID, experimentID, studentID)
}

func (h *SubmissionHandler) GetResult(c *gin.Context) {
	id := c.Param("id")
	sub, err := h.subRepo.GetByID(c, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "submission not found"})
		return
	}

	userID := middleware.GetUserID(c)
	role := middleware.GetUserRole(c)
	if sub.StudentID != userID && role == "student" {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return
	}

	c.JSON(http.StatusOK, sub)
}

func (h *SubmissionHandler) List(c *gin.Context) {
	experimentID := c.Param("id")
	if experimentID == "" {
		experimentID = c.Query("experiment_id")
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}

	role := middleware.GetUserRole(c)
	var studentID *string
	if role == "student" {
		id := middleware.GetUserID(c)
		studentID = &id
	} else if sid := c.Query("student_id"); sid != "" {
		studentID = &sid
	}

	// Teacher/admin: use ListWithStudent to include student name info
	if role == "teacher" || role == "admin" {
		subs, total, err := h.subRepo.ListWithStudent(c, experimentID, studentID, page, pageSize)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, model.PaginatedResponse{
			Data:       subs,
			Total:      total,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: int(math.Ceil(float64(total) / float64(pageSize))),
		})
		return
	}

	subs, total, err := h.subRepo.List(c, experimentID, studentID, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, model.PaginatedResponse{
		Data:       subs,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: int(math.Ceil(float64(total) / float64(pageSize))),
	})
}

// evaluate runs the real evaluation pipeline (called in a goroutine).
func (h *SubmissionHandler) evaluate(submissionID, experimentID, studentID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 600*time.Second)
	defer cancel()

	if err := h.pipeline.Run(ctx, submissionID, experimentID, studentID); err != nil {
		// Pipeline returned an error — ensure submission status is updated
		errMsg := err.Error()
		h.subRepo.UpdateResult(context.Background(), submissionID, "failed", 0, 100, 0, 0, nil, &errMsg, nil, nil)
		return
	}

	// Diagnosis is triggered by the evaluation.completed NATS event,
	// published by the pipeline. No HTTP fallback here.
}

func (h *SubmissionHandler) ListAll(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}

	var courseID, experimentID, studentID *string
	if cid := c.Query("course_id"); cid != "" {
		courseID = &cid
	}
	if eid := c.Query("experiment_id"); eid != "" {
		experimentID = &eid
	}

	role := middleware.GetUserRole(c)
	if role == "student" {
		id := middleware.GetUserID(c)
		studentID = &id
	} else if sid := c.Query("student_id"); sid != "" {
		studentID = &sid
	}

	subs, total, err := h.subRepo.ListAll(c, courseID, experimentID, studentID, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, model.PaginatedResponse{
		Data:       subs,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: int(math.Ceil(float64(total) / float64(pageSize))),
	})
}

// GetTraces returns syscall trace records for a submission.
// GET /api/v1/submissions/:id/traces?limit=500&errors_only=true
func (h *SubmissionHandler) GetTraces(c *gin.Context) {
	id := c.Param("id")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "500"))
	errorsOnly := c.Query("errors_only") == "true"

	traces, err := h.subRepo.GetSyscallTraces(c, id, limit, errorsOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if traces == nil {
		traces = []repository.SyscallTraceRecord{}
	}
	c.JSON(http.StatusOK, gin.H{"submission_id": id, "traces": traces})
}
