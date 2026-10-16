package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/model"
	"github.com/traceos-lab/core-service/internal/repository"
)

type CommentHandler struct {
	commentRepo *repository.CommentRepo
	db          *pgxpool.Pool
	aiServiceURL string
}

func NewCommentHandler(commentRepo *repository.CommentRepo, db *pgxpool.Pool, aiServiceURL string) *CommentHandler {
	return &CommentHandler{
		commentRepo:  commentRepo,
		db:           db,
		aiServiceURL: aiServiceURL,
	}
}

func (h *CommentHandler) List(c *gin.Context) {
	experimentID := c.Param("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}

	comments, total, err := h.commentRepo.ListByExperiment(c, experimentID, page, 20)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  comments,
		"total": total,
		"page":  page,
	})
}

type createCommentRequest struct {
	Content  string  `json:"content" binding:"required"`
	ParentID *string `json:"parent_id"`
}

func (h *CommentHandler) Create(c *gin.Context) {
	experimentID := c.Param("id")
	userID := middleware.GetUserID(c)

	var req createCommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	comment := &model.Comment{
		ExperimentID: experimentID,
		UserID:       userID,
		ParentID:     req.ParentID,
		Content:      req.Content,
	}

	if err := h.commentRepo.Create(c, comment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, comment)
}

type updateCommentRequest struct {
	Content string `json:"content" binding:"required"`
}

// Update edits a comment. Owner can edit own; teacher/admin can edit any.
func (h *CommentHandler) Update(c *gin.Context) {
	commentID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetUserRole(c)

	comment, err := h.commentRepo.GetByID(c, commentID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "comment not found"})
		return
	}

	if comment.UserID != userID && role == "student" {
		c.JSON(http.StatusForbidden, gin.H{"error": "can only edit your own comments"})
		return
	}

	var req updateCommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.commentRepo.Update(c, commentID, req.Content); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

// Delete removes a comment. Owner can delete own; teacher/admin can delete any.
func (h *CommentHandler) Delete(c *gin.Context) {
	commentID := c.Param("id")
	userID := middleware.GetUserID(c)
	role := middleware.GetUserRole(c)

	comment, err := h.commentRepo.GetByID(c, commentID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "comment not found"})
		return
	}

	if comment.UserID != userID && role == "student" {
		c.JSON(http.StatusForbidden, gin.H{"error": "can only delete your own comments"})
		return
	}

	if err := h.commentRepo.Delete(c, commentID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

// TogglePin toggles the pinned status (teacher/admin only).
func (h *CommentHandler) TogglePin(c *gin.Context) {
	commentID := c.Param("id")
	if err := h.commentRepo.TogglePin(c, commentID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "toggled"})
}

type aiAskRequest struct {
	Question string  `json:"question" binding:"required"`
	ParentID *string `json:"parent_id"`
}

type aiReplyRequest struct {
	Question        string `json:"question"`
	ExperimentID    string `json:"experiment_id"`
	ExperimentTitle string `json:"experiment_title"`
	Category        string `json:"category"`
}

type aiReplyResponse struct {
	Reply string `json:"reply"`
}

// AIAsk handles a student @AI question: saves the user comment, calls AI service, saves AI reply.
func (h *CommentHandler) AIAsk(c *gin.Context) {
	experimentID := c.Param("id")
	userID := middleware.GetUserID(c)

	var req aiAskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get experiment info for context
	var title, category string
	err := h.db.QueryRow(c,
		`SELECT title, category FROM experiments WHERE id = $1`, experimentID,
	).Scan(&title, &category)
	if err != nil {
		title = "Unknown Experiment"
		category = ""
	}

	// Save the user question as a comment
	userComment := &model.Comment{
		ExperimentID: experimentID,
		UserID:       userID,
		ParentID:     req.ParentID,
		Content:      req.Question,
	}
	if err := h.commentRepo.Create(c, userComment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save question"})
		return
	}

	// Call AI service for reply
	aiReply, err := h.callAIReply(c, aiReplyRequest{
		Question:        req.Question,
		ExperimentID:    experimentID,
		ExperimentTitle: title,
		Category:        category,
	})
	if err != nil {
		c.JSON(http.StatusCreated, gin.H{
			"user_comment": userComment,
			"ai_error":     fmt.Sprintf("AI service unavailable: %v", err),
		})
		return
	}

	// Save AI reply as a child comment
	aiComment := &model.Comment{
		ExperimentID: experimentID,
		UserID:       userID,
		ParentID:     &userComment.ID,
		Content:      aiReply,
		IsAI:         true,
	}
	if err := h.commentRepo.Create(c, aiComment); err != nil {
		c.JSON(http.StatusCreated, gin.H{
			"user_comment": userComment,
			"ai_error":     "failed to save AI reply",
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"user_comment": userComment,
		"ai_comment":   aiComment,
	})
}

func (h *CommentHandler) callAIReply(c *gin.Context, req aiReplyRequest) (string, error) {
	if h.aiServiceURL == "" {
		return "", fmt.Errorf("AI service URL not configured")
	}

	body, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(c, "POST", h.aiServiceURL+"/api/ai/comment-reply", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("AI service call failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("AI service returned %d: %s", resp.StatusCode, string(respBody))
	}

	var aiResp aiReplyResponse
	if err := json.NewDecoder(resp.Body).Decode(&aiResp); err != nil {
		return "", fmt.Errorf("failed to decode AI response: %w", err)
	}

	if strings.TrimSpace(aiResp.Reply) == "" {
		return "", fmt.Errorf("AI returned empty reply")
	}

	return aiResp.Reply, nil
}
