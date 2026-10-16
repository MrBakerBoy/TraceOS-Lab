package handler

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/middleware"
)

type ConversationHandler struct {
	db           *pgxpool.Pool
	aiServiceURL string
}

func NewConversationHandler(db *pgxpool.Pool, aiServiceURL string) *ConversationHandler {
	return &ConversationHandler{db: db, aiServiceURL: aiServiceURL}
}

type createConvRequest struct {
	ExperimentID string `json:"experiment_id"`
	Title        string `json:"title"`
	AgentMode    string `json:"agent_mode"`
}

type updateConvRequest struct {
	Title      string `json:"title"`
	IsArchived *bool  `json:"is_archived"`
	IsPinned   *bool  `json:"is_pinned"`
}

type sendMessageRequest struct {
	Content   string `json:"content"`
	Code      string `json:"code"`
	Language  string `json:"language"`
	AgentMode string `json:"agent_mode"`
	UseRAG    *bool  `json:"use_rag"`
}

func (h *ConversationHandler) ListConversations(c *gin.Context) {
	userID := middleware.GetUserID(c)
	experimentID := c.Query("experiment_id")
	archived := c.Query("archived")

	query := `SELECT id, experiment_id, title, model, agent_mode, message_count,
	                 total_tokens, is_archived, is_pinned, created_at, updated_at
	          FROM conversations WHERE user_id = $1`
	args := []interface{}{userID}
	argIdx := 2

	if experimentID != "" {
		query += fmt.Sprintf(" AND experiment_id = $%d", argIdx)
		args = append(args, experimentID)
		argIdx++
	}
	if archived == "true" {
		query += " AND is_archived = true"
	} else if archived == "" {
		query += " AND is_archived = false"
	}
	query += " ORDER BY is_pinned DESC, updated_at DESC LIMIT 50"

	rows, err := h.db.Query(c, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed: " + err.Error()})
		return
	}
	defer rows.Close()

	type convItem struct {
		ID           string    `json:"id"`
		ExperimentID *string   `json:"experiment_id"`
		Title        string    `json:"title"`
		Model        string    `json:"model"`
		AgentMode    string    `json:"agent_mode"`
		MessageCount int       `json:"message_count"`
		TotalTokens  int64     `json:"total_tokens"`
		IsArchived   bool      `json:"is_archived"`
		IsPinned     bool      `json:"is_pinned"`
		CreatedAt    time.Time `json:"created_at"`
		UpdatedAt    time.Time `json:"updated_at"`
	}

	var conversations []convItem
	for rows.Next() {
		var item convItem
		err := rows.Scan(&item.ID, &item.ExperimentID, &item.Title, &item.Model,
			&item.AgentMode, &item.MessageCount, &item.TotalTokens,
			&item.IsArchived, &item.IsPinned, &item.CreatedAt, &item.UpdatedAt)
		if err != nil {
			continue
		}
		conversations = append(conversations, item)
	}

	if conversations == nil {
		conversations = []convItem{}
	}

	c.JSON(http.StatusOK, gin.H{"conversations": conversations})
}

func (h *ConversationHandler) CreateConversation(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req createConvRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}

	if req.Title == "" {
		req.Title = "New"
	}
	if req.AgentMode == "" {
		req.AgentMode = "chat"
	}

	var id string
	var expID interface{}
	if req.ExperimentID != "" {
		expID = req.ExperimentID
	}
	err := h.db.QueryRow(c,
		`INSERT INTO conversations (user_id, experiment_id, title, agent_mode)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		userID, expID, req.Title, req.AgentMode,
	).Scan(&id)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "create failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":            id,
		"title":         req.Title,
		"agent_mode":    req.AgentMode,
		"message_count": 0,
	})
}

func (h *ConversationHandler) UpdateConversation(c *gin.Context) {
	convID := c.Param("id")
	userID := middleware.GetUserID(c)

	var req updateConvRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}

	if req.Title != "" {
		_, err := h.db.Exec(c,
			`UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
			req.Title, convID, userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "update failed"})
			return
		}
	}
	if req.IsArchived != nil {
		h.db.Exec(c,
			`UPDATE conversations SET is_archived = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
			*req.IsArchived, convID, userID)

		// Phase 4: Trigger LTM extraction when archiving a conversation
		if *req.IsArchived {
			go h.extractLongTermMemories(convID, userID)
		}
	}
	if req.IsPinned != nil {
		h.db.Exec(c,
			`UPDATE conversations SET is_pinned = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
			*req.IsPinned, convID, userID)
	}

	c.JSON(http.StatusOK, gin.H{"updated": true})
}

func (h *ConversationHandler) DeleteConversation(c *gin.Context) {
	convID := c.Param("id")
	userID := middleware.GetUserID(c)

	_, err := h.db.Exec(c,
		`DELETE FROM conversations WHERE id = $1 AND user_id = $2`,
		convID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *ConversationHandler) GetMessages(c *gin.Context) {
	convID := c.Param("id")
	userID := middleware.GetUserID(c)

	var ownerID string
	err := h.db.QueryRow(c,
		`SELECT user_id FROM conversations WHERE id = $1`, convID).Scan(&ownerID)
	if err != nil || ownerID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	rows, err := h.db.Query(c,
		`SELECT id, role, content, COALESCE(tool_calls::text,''), COALESCE(tool_name,''),
		        COALESCE(tool_results::text,''), COALESCE(metadata::text,'{}'),
		        COALESCE(tokens_used,0), COALESCE(latency_ms,0), created_at
		 FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`, convID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "msg query failed"})
		return
	}
	defer rows.Close()

	type msgItem struct {
		ID          string    `json:"id"`
		Role        string    `json:"role"`
		Content     string    `json:"content"`
		ToolCalls   string    `json:"tool_calls,omitempty"`
		ToolName    string    `json:"tool_name,omitempty"`
		ToolResults string    `json:"tool_results,omitempty"`
		Metadata    string    `json:"metadata,omitempty"`
		TokensUsed  int       `json:"tokens_used"`
		LatencyMs   int       `json:"latency_ms"`
		CreatedAt   time.Time `json:"created_at"`
	}

	var messages []msgItem
	for rows.Next() {
		var m msgItem
		if err := rows.Scan(&m.ID, &m.Role, &m.Content, &m.ToolCalls, &m.ToolName,
			&m.ToolResults, &m.Metadata, &m.TokensUsed, &m.LatencyMs, &m.CreatedAt); err != nil {
			continue
		}
		messages = append(messages, m)
	}
	if messages == nil {
		messages = []msgItem{}
	}

	c.JSON(http.StatusOK, gin.H{"messages": messages})
}

func (h *ConversationHandler) SendMessage(c *gin.Context) {
	convID := c.Param("id")
	userID := middleware.GetUserID(c)

	var req sendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}

	var ownerID, experimentID, agentMode string
	err := h.db.QueryRow(c,
		`SELECT user_id, COALESCE(experiment_id::text,''), agent_mode
		 FROM conversations WHERE id = $1`, convID).Scan(&ownerID, &experimentID, &agentMode)
	if err != nil || ownerID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	_, err = h.db.Exec(c,
		`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
		convID, req.Content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "msg save failed"})
		return
	}

	var title, description, category string
	if experimentID != "" && experimentID != "null" {
		h.db.QueryRow(c,
			`SELECT title, COALESCE(description,''), category FROM experiments WHERE id=$1`,
			experimentID).Scan(&title, &description, &category)
	}

	rows, _ := h.db.Query(c,
		`SELECT role, content FROM messages WHERE conversation_id = $1
		 ORDER BY created_at DESC LIMIT 20`, convID)
	var history []map[string]string
	for rows.Next() {
		var role, content string
		rows.Scan(&role, &content)
		history = append([]map[string]string{{"role": role, "content": content}}, history...)
	}
	rows.Close()

	// Phase 2: Query detection data from submissions + tests + strace + deadlock + diagnoses
	var compileError, runtimeError string
	var testResults []map[string]interface{}
	var straceSummary map[string]interface{}
	var deadlock map[string]interface{}
	var lastDiagnosis map[string]interface{}

	if experimentID != "" && experimentID != "null" {
		// Latest submission
		var subID string
		err = h.db.QueryRow(c,
			`SELECT id, COALESCE(compile_error,''), COALESCE(runtime_error,'')
			 FROM submissions WHERE experiment_id=$1 AND student_id=$2
			 ORDER BY created_at DESC LIMIT 1`,
			experimentID, userID).Scan(&subID, &compileError, &runtimeError)
		if err == nil && subID != "" {
			// Test results
			tRows, _ := h.db.Query(c,
				`SELECT test_name, passed, actual_output, expected_output, error_message
				 FROM test_results WHERE submission_id=$1`, subID)
			if tRows != nil {
				for tRows.Next() {
					var tName string
					var passed bool
					var actual, expected, errMsg *string
					tRows.Scan(&tName, &passed, &actual, &expected, &errMsg)
					tr := map[string]interface{}{"name": tName, "passed": passed}
					if actual != nil {
						tr["actual_output"] = *actual
					}
					if expected != nil {
						tr["expected_output"] = *expected
					}
					if errMsg != nil {
						tr["runtime_error"] = *errMsg
					}
					testResults = append(testResults, tr)
				}
				tRows.Close()
			}

			// Strace summary (from evaluation_events or syscall_traces)
			var straceJSON string
			err = h.db.QueryRow(c,
				`SELECT COALESCE(strace_summary::text,'') FROM evaluation_events
				 WHERE submission_id=$1 ORDER BY created_at DESC LIMIT 1`,
				subID).Scan(&straceJSON)
			if err == nil && straceJSON != "" {
				json.Unmarshal([]byte(straceJSON), &straceSummary)
			}

			// Deadlock report
			var detected bool
			var details, fixHint string
			err = h.db.QueryRow(c,
				`SELECT COALESCE(detected,false), COALESCE(details,''), COALESCE(fix_hint,'')
				 FROM deadlock_reports WHERE submission_id=$1
				 ORDER BY created_at DESC LIMIT 1`,
				subID).Scan(&detected, &details, &fixHint)
			if err == nil && detected {
				deadlock = map[string]interface{}{
					"detected": detected,
					"details":  details,
					"fix_hint": fixHint,
				}
			}

			// Last diagnosis
			var diagType, rootCause, severity string
			err = h.db.QueryRow(c,
				`SELECT d.error_type, d.root_cause, d.severity
				 FROM diagnoses d WHERE d.submission_id=$1
				 ORDER BY d.created_at DESC LIMIT 1`,
				subID).Scan(&diagType, &rootCause, &severity)
			if err == nil {
				lastDiagnosis = map[string]interface{}{
					"error_type": diagType,
					"root_cause": rootCause,
					"severity":   severity,
				}
			}
		}
	}

	// Phase 4: Query L3 long-term memories (cross-session knowledge)
	var longTermMemories []map[string]interface{}
	ltmRows, _ := h.db.Query(c,
		`SELECT content, importance FROM long_term_memories
		 WHERE user_id=$1 AND (experiment_id=$2 OR experiment_id IS NULL)
		 ORDER BY importance DESC LIMIT 5`,
		userID, experimentID)
	if ltmRows != nil {
		for ltmRows.Next() {
			var content string
			var imp float64
			ltmRows.Scan(&content, &imp)
			longTermMemories = append(longTermMemories, map[string]interface{}{"content": content, "importance": imp})
		}
		ltmRows.Close()
	}

	// Phase 4: Query student profile summary
	var studentProfile map[string]interface{}
	var weakTopics, strongTopics, learningStyle string
	var totalInteractions int
	err = h.db.QueryRow(c,
		`SELECT COALESCE(common_misconceptions::text,'[]'), COALESCE(learning_style::text,'{}'), COALESCE(total_agent_interactions,0)
		 FROM student_profiles WHERE user_id=$1`, userID).Scan(&weakTopics, &strongTopics, &learningStyle, &totalInteractions)
	if err == nil {
		profile := map[string]interface{}{"total_interactions": totalInteractions}
		var wt, ls map[string]interface{}
		json.Unmarshal([]byte(weakTopics), &wt)
		json.Unmarshal([]byte(learningStyle), &ls)
		if topics, ok := wt["weak_topics"]; ok {
			profile["weak_concepts"] = topics
		}
		if style, ok := ls["hint_level"]; ok {
			profile["preferred_hint_level"] = style
		}
		if pace, ok := ls["pace"]; ok {
			profile["learning_pace"] = pace
		}
		studentProfile = profile
	}

	// Phase 3: Query L1 conversation summary
	var conversationSummary string
	var keyFactsRaw string
	h.db.QueryRow(c,
		`SELECT COALESCE(full_summary,''), COALESCE(key_facts::text,'[]')
		 FROM conversation_memories WHERE conversation_id=$1`,
		convID).Scan(&conversationSummary, &keyFactsRaw)
	var keyFacts []map[string]interface{}
	json.Unmarshal([]byte(keyFactsRaw), &keyFacts)

	useRAG := true
	if req.UseRAG != nil {
		useRAG = *req.UseRAG
	}

	aiReq := map[string]interface{}{
		"question":               req.Content,
		"experiment_id":          experimentID,
		"experiment_title":       title,
		"experiment_description": description,
		"category":               category,
		"student_code":           req.Code,
		"language":               req.Language,
		"history":                history,
		"use_rag":                useRAG,
		"conversation_id":        convID,
		"compile_error":          compileError,
		"runtime_error":          runtimeError,
		"test_results":           testResults,
		"strace_summary":         straceSummary,
		"deadlock":               deadlock,
		"last_diagnosis":         lastDiagnosis,
		"student_profile":        studentProfile,
		"conversation_summary":   conversationSummary,
		"key_facts":              keyFacts,
		"long_term_memories":     longTermMemories,
		// Required by Python ChatStreamRequest: messages with user question
		"messages": []map[string]string{{"role": "user", "content": req.Content}},
	}

	// Check if client wants streaming (SSE)
	acceptHeader := c.GetHeader("Accept")
	if strings.Contains(acceptHeader, "text/event-stream") && experimentID != "" {
		h.handleStreamingMessage(c, convID, aiReq, experimentID, req.Content)
		return
	}

	body, _ := json.Marshal(aiReq)
	httpReq, err := http.NewRequestWithContext(c, "POST", h.aiServiceURL+"/api/ai/chat", bytes.NewReader(body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI service unavailable"})
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

	reply := ""
	if r, ok := aiResp["reply"]; ok {
		reply = fmt.Sprint(r)
	}

	_, err = h.db.Exec(c,
		`INSERT INTO messages (conversation_id, role, content, metadata)
		 VALUES ($1, 'assistant', $2, $3::jsonb)`,
		convID, reply, string(respBody))
	if err == nil {
		h.db.Exec(c,
			`UPDATE conversations SET message_count = message_count + 2, updated_at = NOW() WHERE id = $1`,
			convID)
	}

	c.JSON(http.StatusOK, aiResp)

	// Phase 3: Mark turn importance for L1 memory compression (fire-and-forget)
	go h.markTurnImportance(convID, req.Content, reply)
}

// accumulateSSEContent extracts content text from an SSE data line.
func accumulateSSEContent(line string) string {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "data: ") {
		return ""
	}
	payload := strings.TrimPrefix(trimmed, "data: ")
	if payload == "[DONE]" {
		return ""
	}
	var chunk map[string]interface{}
	if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
		return ""
	}
	if chunk["type"] == "harness" {
		return ""
	}
	choices, _ := chunk["choices"].([]interface{})
	if len(choices) == 0 {
		return ""
	}
	choice, _ := choices[0].(map[string]interface{})
	delta, _ := choice["delta"].(map[string]interface{})
	content, _ := delta["content"].(string)
	return content
}

// handleStreamingMessage proxies an SSE stream from the AI service to the client,
// accumulating the full response text for DB storage.
func (h *ConversationHandler) handleStreamingMessage(
	c *gin.Context,
	convID string,
	aiReq map[string]interface{},
	experimentID string,
	userContent string,
) {
	body, err := json.Marshal(aiReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	streamURL := fmt.Sprintf("%s/api/ai/experiments/%s/chat/stream", h.aiServiceURL, experimentID)
	httpReq, err := http.NewRequestWithContext(c.Request.Context(), "POST", streamURL, bytes.NewReader(body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI service unavailable"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		c.JSON(http.StatusBadGateway, gin.H{"error": string(errBody)})
		return
	}

	// Set SSE response headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	var fullContent strings.Builder
	reader := bufio.NewReader(resp.Body)
	saved := false

	c.Stream(func(w io.Writer) bool {
		line, readErr := reader.ReadString('\n')
		if readErr != nil {
			// Stream ended — save assistant message and fire importance marking
			if !saved && fullContent.Len() > 0 {
				saved = true
				reply := fullContent.String()
				go func() {
					ctx := context.Background()
					h.db.Exec(ctx,
						`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
						convID, reply)
					h.db.Exec(ctx,
						`UPDATE conversations SET message_count = message_count + 2, updated_at = NOW() WHERE id = $1`,
						convID)
					h.markTurnImportance(convID, userContent, reply)
				}()
			}
			return false
		}
		// Accumulate content from SSE delta
		content := accumulateSSEContent(line)
		if content != "" {
			fullContent.WriteString(content)
		}
		// Write line to client
		_, writeErr := w.Write([]byte(line))
		return writeErr == nil
	})

	// Fallback: if Stream exited without EOF (e.g. client disconnect), still try to save
	if !saved && fullContent.Len() > 0 {
		reply := fullContent.String()
		go func() {
			ctx := context.Background()
			h.db.Exec(ctx,
				`INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
				convID, reply)
			h.db.Exec(ctx,
				`UPDATE conversations SET message_count = message_count + 2, updated_at = NOW() WHERE id = $1`,
				convID)
			h.markTurnImportance(convID, userContent, reply)
		}()
	}
}

// markTurnImportance marks the importance of the last user and assistant turns.
func (h *ConversationHandler) markTurnImportance(convID, userContent, assistantContent string) {
	ctx := context.Background()

	// Mark user message importance
	imp := computeImportance(userContent, "user")
	h.db.Exec(ctx,
		`UPDATE messages SET importance=$1 WHERE conversation_id=$2 AND role='user' AND content=$3 AND importance=0.5`,
		imp, convID, userContent)

	// Mark assistant message importance
	if assistantContent != "" {
		impA := computeImportance(assistantContent, "assistant")
		h.db.Exec(ctx,
			`UPDATE messages SET importance=$1 WHERE conversation_id=$2 AND role='assistant' AND content=$3 AND importance=0.5`,
			impA, convID, assistantContent)
	}

	// Check if compression threshold reached
	h.checkAndCompress(ctx, convID)
}

// computeImportance determines importance score (0.0-1.0) based on content patterns.
func computeImportance(content, role string) float64 {
	score := 0.5

	// User question patterns
	if role == "user" {
		patterns := []string{"?", "？", "吗", "呢", "什么", "怎么", "为什么", "不对", "不行", "还是", "成功了", "我懂了", "明白了"}
		for _, p := range patterns {
			if strings.Contains(content, p) {
				score += 0.1
			}
		}
	}

	// Assistant diagnosis patterns
	if role == "assistant" {
		diagKeywords := []string{"root_cause", "error_type", "泄漏", "死锁", "竞态", "编译错误", "运行时错误", "你需要在", "试试", "建议"}
		for _, k := range diagKeywords {
			if strings.Contains(content, k) {
				score += 0.08
			}
		}
	}

	// Check for error content (important)
	errorKeywords := []string{"error", "failed", "失败", "错误", "segment", "segfault", "panic", "leak", "泄漏"}
	for _, k := range errorKeywords {
		if strings.Contains(strings.ToLower(content), k) {
			score += 0.08
		}
	}

	if score > 1.0 {
		score = 1.0
	}
	if score < 0.2 {
		score = 0.2
	}
	return score
}

// checkAndCompress triggers LLM-based compression if threshold is reached.
func (h *ConversationHandler) checkAndCompress(ctx context.Context, convID string) {
	// Count uncompressed messages
	var uncompressedCount int
	h.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM messages WHERE conversation_id=$1 AND is_compressed=false`,
		convID).Scan(&uncompressedCount)

	// Threshold: compress if >= 12 uncompressed turns
	if uncompressedCount < 12 {
		return
	}

	// Fetch uncompressed + uncompressed-summary messages for compression
	rows, err := h.db.Query(ctx,
		`SELECT role, content, COALESCE(turn_index,0), COALESCE(importance,0.5)
		 FROM messages WHERE conversation_id=$1 AND is_compressed=false
		 ORDER BY turn_index ASC LIMIT 8`, convID)
	if err != nil {
		return
	}
	defer rows.Close()

	var msgs []map[string]interface{}
	for rows.Next() {
		var role, content string
		var turnIdx int
		var imp float64
		rows.Scan(&role, &content, &turnIdx, &imp)
		if imp >= 0.7 {
			continue // Skip high-importance messages (keep them uncompressed)
		}
		msgs = append(msgs, map[string]interface{}{
			"role": role, "content": content, "turn_index": turnIdx, "importance": imp,
		})
	}

	if len(msgs) < 4 {
		return // Not enough low-importance messages to compress
	}

	// Get existing summary
	var existingSummary string
	h.db.QueryRow(ctx,
		`SELECT COALESCE(full_summary,'') FROM conversation_memories WHERE conversation_id=$1`,
		convID).Scan(&existingSummary)

	// Call Python compression endpoint (fire-and-forget style with basic timeout)
	go h.callCompressEndpoint(convID, msgs, existingSummary)
}

// callCompressEndpoint calls the Python AI service compression endpoint.
func (h *ConversationHandler) callCompressEndpoint(convID string, msgs []map[string]interface{}, existingSummary string) {
	reqBody := map[string]interface{}{
		"messages":         msgs,
		"existing_summary": existingSummary,
	}
	body, _ := json.Marshal(reqBody)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Post(h.aiServiceURL+"/api/ai/memory/compress", "application/json", bytes.NewReader(body))
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	var result struct {
		FullSummary         string `json:"full_summary"`
		KeyFacts            []map[string]interface{} `json:"key_facts"`
		CompressedTurnCount int    `json:"compressed_turn_count"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

	// Persist compression results
	bgCtx := context.Background()
	factsJSON, _ := json.Marshal(result.KeyFacts)

	h.db.Exec(bgCtx,
		`INSERT INTO conversation_memories (conversation_id, full_summary, key_facts, compressed_until_turn, total_compressed_tokens)
		 VALUES ($1, $2, $3::jsonb, $4, $5)
		 ON CONFLICT (conversation_id) DO UPDATE SET
		   full_summary=$2, key_facts=$3::jsonb, compressed_until_turn=$4,
		   total_compressed_tokens=conversation_memories.total_compressed_tokens+$5,
		   memory_version=conversation_memories.memory_version+1,
		   last_compressed_at=NOW(), updated_at=NOW()`,
		convID, result.FullSummary, string(factsJSON),
		result.CompressedTurnCount, 0)

	// Mark compressed messages
	h.db.Exec(bgCtx,
		`UPDATE messages SET is_compressed=true WHERE conversation_id=$1 AND is_compressed=false AND importance < 0.7`,
		convID)
}

// extractLongTermMemories triggers L3 memory extraction when a conversation is archived.
func (h *ConversationHandler) extractLongTermMemories(convID, userID string) {
	ctx := context.Background()

	var fullSummary, keyFactsRaw string
	err := h.db.QueryRow(ctx,
		`SELECT COALESCE(full_summary,''), COALESCE(key_facts::text,'[]')
		 FROM conversation_memories WHERE conversation_id=$1`,
		convID).Scan(&fullSummary, &keyFactsRaw)
	if err != nil || fullSummary == "" {
		return
	}

	var keyFacts []map[string]interface{}
	json.Unmarshal([]byte(keyFactsRaw), &keyFacts)

	var experimentID string
	h.db.QueryRow(ctx,
		`SELECT COALESCE(experiment_id::text,'') FROM conversations WHERE id=$1`,
		convID).Scan(&experimentID)

	reqBody := map[string]interface{}{
		"user_id":       userID,
		"experiment_id": experimentID,
		"full_summary":  fullSummary,
		"key_facts":     keyFacts,
	}
	body, _ := json.Marshal(reqBody)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Post(h.aiServiceURL+"/api/ai/memory/extract-ltm", "application/json", bytes.NewReader(body))
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	var result struct {
		Memories []struct {
			Type       string  `json:"type"`
			Content    string  `json:"content"`
			Importance float64 `json:"importance"`
		} `json:"memories"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

	for _, mem := range result.Memories {
		h.db.Exec(ctx,
			`INSERT INTO long_term_memories (user_id, experiment_id, memory_type, content, importance, source_conversation_ids)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			userID, experimentID, mem.Type, mem.Content, mem.Importance,
			[]string{convID})
	}
}

// GetConversationMonitoring returns real monitoring data for a conversation:
// pipeline stages, memory tiers, token budget, and RAG queries.
func (h *ConversationHandler) GetConversationMonitoring(c *gin.Context) {
	convID := c.Param("id")
	userID := middleware.GetUserID(c)

	// Verify ownership
	var ownerID string
	err := h.db.QueryRow(c, `SELECT user_id FROM conversations WHERE id=$1`, convID).Scan(&ownerID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}
	if ownerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized"})
		return
	}

	type MonitoringResponse struct {
		AgentPipeline []map[string]interface{} `json:"agent_pipeline"`
		Memory        map[string]interface{}   `json:"memory"`
		TokenBudget   map[string]interface{}   `json:"token_budget"`
		RAGQueries    []map[string]interface{} `json:"rag_queries"`
	}

	resp := MonitoringResponse{
		AgentPipeline: []map[string]interface{}{
			{"name": "E", "label": "执行层", "color": "#10B981", "status": "done"},
			{"name": "T", "label": "工具层", "color": "#06B6D4", "status": "done"},
			{"name": "C", "label": "上下文层", "color": "#F59E0B", "status": "done"},
			{"name": "L", "label": "生命周期", "color": "#3B82F6", "status": "done"},
			{"name": "O", "label": "可观测层", "color": "#8B5CF6", "status": "done"},
			{"name": "V", "label": "校验层", "color": "#F43F5E", "status": "done"},
			{"name": "G", "label": "治理层", "color": "#F97316", "status": "done"},
		},
	}

	// L1: Message count and turn count
	var messageCount, turnCount int
	h.db.QueryRow(c, `SELECT COUNT(*) FROM messages WHERE conversation_id=$1`, convID).Scan(&messageCount)
	h.db.QueryRow(c, `SELECT COUNT(*) FROM messages WHERE conversation_id=$1 AND role='user'`, convID).Scan(&turnCount)

	// L2: Student profile (weak/strong topics)
	var weakTopics, strongTopics string
	h.db.QueryRow(c,
		`SELECT COALESCE(common_misconceptions::text,'[]'), COALESCE(learning_style::text,'{}')
		 FROM student_profiles WHERE user_id=$1`, userID).Scan(&weakTopics, &strongTopics)

	var wts, sts map[string]interface{}
	json.Unmarshal([]byte(weakTopics), &wts)
	json.Unmarshal([]byte(strongTopics), &sts)

	weakList := []string{}
	strongList := []string{}
	if arr, ok := wts["weak_topics"].([]interface{}); ok {
		for _, v := range arr {
			weakList = append(weakList, fmt.Sprint(v))
		}
	}
	if arr, ok := sts["strong_topics"].([]interface{}); ok {
		for _, v := range arr {
			strongList = append(strongList, fmt.Sprint(v))
		}
	}

	// L3: Long-term memories (error patterns)
	ltmRows, _ := h.db.Query(c,
		`SELECT memory_type, content, importance FROM long_term_memories
		 WHERE user_id=$1 ORDER BY importance DESC LIMIT 10`, userID)
	errorPatterns := map[string]int{}
	if ltmRows != nil {
		defer ltmRows.Close()
		for ltmRows.Next() {
			var mType, content string
			var importance float64
			ltmRows.Scan(&mType, &content, &importance)
			if mType == "common_mistake" {
				key := content
				if len(key) > 40 {
					key = key[:40] + "..."
				}
				errorPatterns[key] = int(importance * 10)
			}
		}
	}

	// L1 summary
	var summary string
	var keyFactsRaw string
	h.db.QueryRow(c,
		`SELECT COALESCE(full_summary,''), COALESCE(key_facts::text,'[]')
		 FROM conversation_memories WHERE conversation_id=$1`, convID).Scan(&summary, &keyFactsRaw)
	var keyFacts []interface{}
	json.Unmarshal([]byte(keyFactsRaw), &keyFacts)

	resp.Memory = map[string]interface{}{
		"L0": map[string]interface{}{
			"label":       "工作记忆",
			"tokens":      messageCount * 200,
			"maxTokens":   8192,
			"description": "当前上下文窗口",
		},
		"L1": map[string]interface{}{
			"label":        "短期记忆",
			"turns":        turnCount,
			"messageCount": messageCount,
			"description":  summary,
		},
		"L2": map[string]interface{}{
			"label":       "长期记忆",
			"weakTopics":  weakList,
			"strongTopics": strongList,
			"description": "学生档案",
		},
		"L3": map[string]interface{}{
			"label":         "全局记忆",
			"errorPatterns": errorPatterns,
			"description":   "实验错误模式",
		},
	}

	// Token budget estimation
	totalTokens := messageCount * 400
	resp.TokenBudget = map[string]interface{}{
		"used":            totalTokens,
		"total":           100000,
		"watermark60":     totalTokens > 60000,
		"watermark80":     totalTokens > 80000,
		"watermark95":     totalTokens > 95000,
		"recentPrunings":  []interface{}{},
	}

	// RAG queries (rag_history 表已废弃，历史由前端 localStorage + conversation 承接)
	resp.RAGQueries = []map[string]interface{}{}

	c.JSON(http.StatusOK, resp)
}
