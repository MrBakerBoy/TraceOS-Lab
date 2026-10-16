package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/ast"
)

// CodeAuditHandler handles code audit endpoints.
type CodeAuditHandler struct {
	analyzer     *ast.Analyzer
	db           *pgxpool.Pool
	aiServiceURL string
	cacheHandler *ExperimentCacheHandler
}

// NewCodeAuditHandler creates a new code audit handler.
func NewCodeAuditHandler(db *pgxpool.Pool, aiServiceURL string, cacheHandler *ExperimentCacheHandler) *CodeAuditHandler {
	return &CodeAuditHandler{
		analyzer:     ast.NewAnalyzer(),
		db:           db,
		aiServiceURL: aiServiceURL,
		cacheHandler: cacheHandler,
	}
}

// AuditRequest is the request body for code audit.
type AuditRequest struct {
	Code         string `json:"code" binding:"required"`
	Language     string `json:"language"`
	ExperimentID string `json:"experiment_id"`
	SubmissionID string `json:"submission_id"`
}

// AuditCode performs code analysis and optionally calls AI for deep audit.
// POST /api/v1/code-audit
func (h *CodeAuditHandler) AuditCode(c *gin.Context) {
	var req AuditRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	studentID := c.GetString("user_id")

	// Phase 1: Fast pattern-based analysis (no LLM, <10ms)
	result := h.analyzer.Analyze(req.Code)

	// Save to DB with 'pending' status (AI deep audit will update it)
	if req.SubmissionID != "" {
		h.saveAuditResult(c, req.SubmissionID, studentID, result)
		// Also save to unified experiment cache for frontend memory feature.
		// The payload must match the frontend CodeAuditResult shape; a flat
		// {issues, summary} payload makes the panel render an empty overview.
		if req.ExperimentID != "" && h.cacheHandler != nil {
			h.cacheHandler.SaveTypedCache(c.Request.Context(),
				req.ExperimentID, req.SubmissionID, studentID,
				"code_audit",
				buildAuditCachePayload(result, req.Code, true, nil, "pending"))
		}
	}

	// Return quick results immediately with ai_pending = true
	c.JSON(http.StatusOK, gin.H{
		"audit":       result,
		"code_length": len(req.Code),
		"analyzer":    "pattern-detector",
		"ai_pending":  true,
	})

	// Phase 2: Asynchronously call AI service for deep audit
	if req.SubmissionID != "" && h.aiServiceURL != "" {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
			defer cancel()
			if err := h.DeepAuditWithAI(ctx, req.SubmissionID, studentID, req.Code, req.ExperimentID); err != nil {
				log.Printf("[code-audit] DeepAuditWithAI failed for submission %s: %v", req.SubmissionID, err)
				_, _ = h.db.Exec(ctx,
					`UPDATE code_audits SET status = 'failed', completed_at = NOW() WHERE submission_id = $1 AND status = 'pending'`,
					req.SubmissionID)
			}
		}()
	}
}

// GetAuditResult retrieves a previous audit result.
// GET /api/v1/code-audit/:submission_id
func (h *CodeAuditHandler) GetAuditResult(c *gin.Context) {
	submissionID := c.Param("submission_id")

	var status, issuesJSON, summaryJSON, aiResultJSON string

	err := h.db.QueryRow(c.Request.Context(), `
		SELECT status,
		       COALESCE(issues::text, '[]'),
		       COALESCE(summary::text, '{}'),
		       COALESCE(ai_result::text, '{}')
		FROM code_audits WHERE submission_id = $1 ORDER BY created_at DESC LIMIT 1
	`, submissionID).Scan(&status, &issuesJSON, &summaryJSON, &aiResultJSON)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "audit not found"})
		return
	}

	var issues []ast.CodeIssue
	var summary ast.AuditSummary
	var aiResult map[string]interface{}
	json.Unmarshal([]byte(issuesJSON), &issues)
	json.Unmarshal([]byte(summaryJSON), &summary)
	json.Unmarshal([]byte(aiResultJSON), &aiResult)

	aiPending := status == "pending" || status == "analyzing"

	c.JSON(http.StatusOK, gin.H{
		"audit": gin.H{
			"issues":      issues,
			"summary":     summary,
			"annotations": []ast.LineAnnotation{},
		},
		"code_length": 0,
		"analyzer":    "pattern-detector",
		"ai_pending":  aiPending,
		"ai_result":   aiResult,
		"status":      status,
	})
}

// DeepAuditWithAI sends the code + annotations to AI service for deep analysis.
func (h *CodeAuditHandler) DeepAuditWithAI(ctx context.Context, submissionID, studentID, code, experimentID string) error {
	if h.aiServiceURL == "" {
		return fmt.Errorf("AI service URL not configured")
	}

	result := h.analyzer.Analyze(code)

	var annotations []ast.LineAnnotation
	if result.Annotations != nil {
		annotations = result.Annotations
	} else {
		annotations = []ast.LineAnnotation{}
	}
	var issues []ast.CodeIssue
	if result.Issues != nil {
		issues = result.Issues
	} else {
		issues = []ast.CodeIssue{}
	}

	payload := map[string]interface{}{
		"code":            code,
		"annotations":     annotations,
		"issues":          issues,
		"experiment_id":   experimentID,
		"experiment_type": "process",
		"submission_id":   submissionID,
		"student_id":      studentID,
	}

	body, _ := json.Marshal(payload)
	resp, err := http.Post(
		h.aiServiceURL+"/api/ai/code-audit/deep",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return fmt.Errorf("AI service call failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed reading AI response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("AI service returned status %d: %s", resp.StatusCode, string(respBody))
	}

	var aiResult map[string]interface{}
	if err := json.Unmarshal(respBody, &aiResult); err != nil {
		return fmt.Errorf("failed parsing AI response JSON: %w", err)
	}

	aiResultJSON, _ := json.Marshal(aiResult)

	_, err = h.db.Exec(ctx, `
		UPDATE code_audits
		SET ai_result = $1, status = 'completed', completed_at = NOW()
		WHERE submission_id = $2 AND status IN ('pending', 'analyzing')
	`, aiResultJSON, submissionID)

	// Update the unified cache with full AI-enhanced result
	if h.cacheHandler != nil && experimentID != "" {
		h.cacheHandler.SaveTypedCache(ctx, experimentID, submissionID, studentID, "code_audit",
			buildAuditCachePayload(result, code, false, aiResult, "completed"))
	}

	return err
}

func (h *CodeAuditHandler) saveAuditResult(c *gin.Context, submissionID, studentID string, result *ast.AuditResult) {
	issuesJSON, _ := json.Marshal(result.Issues)
	summaryJSON, _ := json.Marshal(result.Summary)

	_, err := h.db.Exec(c.Request.Context(), `
		INSERT INTO code_audits (submission_id, student_id, status, issues, summary, execution_time_ms)
		VALUES ($1, $2, 'pending', $3, $4, 0)
		ON CONFLICT DO NOTHING
	`, submissionID, studentID, issuesJSON, summaryJSON)
	if err != nil {
		_ = err
	}
}

// buildAuditCachePayload builds the code_audit cache payload in the same
// nested shape the frontend CodeAuditResult type expects. Both the immediate
// POST response and the async DeepAuditWithAI update must use this shape,
// otherwise the panel hydrates from cache with audit.issues/audit.summary
// missing and renders an empty overview and issue list.
func buildAuditCachePayload(result *ast.AuditResult, code string, aiPending bool, aiResult map[string]interface{}, status string) map[string]interface{} {
	annotations := result.Annotations
	if annotations == nil {
		annotations = []ast.LineAnnotation{}
	}
	issues := result.Issues
	if issues == nil {
		issues = []ast.CodeIssue{}
	}

	audit := map[string]interface{}{
		"issues":      issues,
		"summary":     result.Summary,
		"annotations": annotations,
	}

	payload := map[string]interface{}{
		"audit":       audit,
		"code_length": len(code),
		"analyzer":    "pattern-detector",
		"ai_pending":  aiPending,
		"status":      status,
	}
	if aiResult != nil {
		payload["ai_result"] = aiResult
	}
	return payload
}
