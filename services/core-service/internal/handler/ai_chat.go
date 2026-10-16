package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/middleware"
)

type AIChatHandler struct {
	db           *pgxpool.Pool
	aiServiceURL string
}

func NewAIChatHandler(db *pgxpool.Pool, aiServiceURL string) *AIChatHandler {
	return &AIChatHandler{db: db, aiServiceURL: aiServiceURL}
}

type aiChatRequest struct {
	Question string              `json:"question" binding:"required"`
	Code     string              `json:"code"`
	Language string              `json:"language"`
	History  []map[string]string `json:"history"`
}

func (h *AIChatHandler) Chat(c *gin.Context) {
	experimentID := c.Param("id")
	_ = middleware.GetUserID(c)

	var req aiChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get experiment info
	var title, description, category string
	err := h.db.QueryRow(c,
		`SELECT title, COALESCE(description, ''), category FROM experiments WHERE id = $1`,
		experimentID,
	).Scan(&title, &description, &category)
	if err != nil {
		title = "Unknown"
	}

	// Build request to AI service
	aiReq := map[string]interface{}{
		"question":               req.Question,
		"experiment_id":          experimentID,
		"experiment_title":       title,
		"experiment_description": description,
		"category":               category,
		"student_code":           req.Code,
		"language":               req.Language,
		"history":                req.History,
	}

	body, _ := json.Marshal(aiReq)
	httpReq, err := http.NewRequestWithContext(c, "POST", h.aiServiceURL+"/api/ai/chat", bytes.NewReader(body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("AI service unavailable: %v", err)})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadGateway, gin.H{"error": string(respBody)})
		return
	}

	var aiResp map[string]interface{}
	json.Unmarshal(respBody, &aiResp)
	c.JSON(http.StatusOK, aiResp)
}
