package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/middleware"
)

type WorkspaceHandler struct {
	db *pgxpool.Pool
}

func NewWorkspaceHandler(db *pgxpool.Pool) *WorkspaceHandler {
	return &WorkspaceHandler{db: db}
}

type saveDraftRequest struct {
	Code        string   `json:"code"`
	Language    string   `json:"language"`
	CursorLine  int      `json:"cursor_line"`
	CursorCol   int       `json:"cursor_col"`
	SelectedTab string   `json:"selected_tab"`
	PinnedTools []string `json:"pinned_tools"`
	AITabState  string   `json:"ai_tab_state"`
}

func (h *WorkspaceHandler) GetDraft(c *gin.Context) {
	experimentID := c.Param("id")
	userID := middleware.GetUserID(c)

	var draft struct {
		ID          string    `json:"id"`
		Code        string    `json:"code"`
		Language    string    `json:"language"`
		CursorLine  int       `json:"cursor_line"`
		CursorCol   int       `json:"cursor_col"`
		SelectedTab string    `json:"selected_tab"`
		PinnedTools []string  `json:"pinned_tools"`
		AITabState  string    `json:"ai_tab_state"`
		UpdatedAt   time.Time `json:"updated_at"`
	}

	err := h.db.QueryRow(c,
		`SELECT id, code, COALESCE(language,'c'), COALESCE(cursor_line,0), COALESCE(cursor_col,0),
		        COALESCE(selected_tab,'editor'), COALESCE(pinned_tools,'{}'),
		        COALESCE(ai_tab_state::text,'{}'), updated_at
		 FROM workspace_drafts
		 WHERE user_id = $1 AND experiment_id = $2`,
		userID, experimentID,
	).Scan(&draft.ID, &draft.Code, &draft.Language, &draft.CursorLine, &draft.CursorCol,
		&draft.SelectedTab, &draft.PinnedTools, &draft.AITabState, &draft.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"code":        "",
			"language":    "c",
			"cursor_line": 0,
			"cursor_col":  0,
			"has_draft":   false,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":           draft.ID,
		"code":         draft.Code,
		"language":     draft.Language,
		"cursor_line":  draft.CursorLine,
		"cursor_col":   draft.CursorCol,
		"selected_tab": draft.SelectedTab,
		"pinned_tools": draft.PinnedTools,
		"ai_tab_state": draft.AITabState,
		"updated_at":   draft.UpdatedAt,
		"has_draft":    true,
	})
}

func (h *WorkspaceHandler) SaveDraft(c *gin.Context) {
	experimentID := c.Param("id")
	userID := middleware.GetUserID(c)

	var req saveDraftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据格式不正确"})
		return
	}

	pinnedTools := req.PinnedTools
	if pinnedTools == nil {
		pinnedTools = []string{"diagnosis", "chat"}
	}

	_, err := h.db.Exec(c,
		`INSERT INTO workspace_drafts (user_id, experiment_id, code, language, cursor_line, cursor_col, selected_tab, pinned_tools, ai_tab_state)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE(NULLIF($9,'')::jsonb, '{}'::jsonb))
		 ON CONFLICT (user_id, experiment_id)
		 DO UPDATE SET code = $3, language = $4, cursor_line = $5, cursor_col = $6,
		               selected_tab = $7, pinned_tools = $8, ai_tab_state = COALESCE(NULLIF($9,'')::jsonb, '{}'::jsonb),
		               updated_at = NOW()`,
		userID, experimentID, req.Code, req.Language, req.CursorLine, req.CursorCol,
		req.SelectedTab, pinnedTools, req.AITabState,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存草稿失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"saved": true, "timestamp": time.Now()})
}

func (h *WorkspaceHandler) DeleteDraft(c *gin.Context) {
	experimentID := c.Param("id")
	userID := middleware.GetUserID(c)

	_, err := h.db.Exec(c,
		`DELETE FROM workspace_drafts WHERE user_id = $1 AND experiment_id = $2`,
		userID, experimentID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除草稿失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": true})
}


// =============================================================================
// AI Chat persistence
// =============================================================================

func (h *WorkspaceHandler) GetAIChat(c *gin.Context) {
	experimentID := c.Param("id")
	userID := middleware.GetUserID(c)

	var messages []byte
	err := h.db.QueryRow(c,
		`SELECT messages FROM workspace_ai_chats WHERE user_id = $1 AND experiment_id = $2`,
		userID, experimentID,
	).Scan(&messages)

	if err != nil {
		c.JSON(http.StatusOK, gin.H{"messages": []interface{}{}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"messages": string(messages)})
}

func (h *WorkspaceHandler) SaveAIChat(c *gin.Context) {
	experimentID := c.Param("id")
	userID := middleware.GetUserID(c)

	var req struct {
		Messages json.RawMessage `json:"messages"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	messagesJSON := req.Messages
	if messagesJSON == nil {
		messagesJSON = json.RawMessage("[]")
	}
	_, err := h.db.Exec(c,
		`INSERT INTO workspace_ai_chats (user_id, experiment_id, messages)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, experiment_id)
		 DO UPDATE SET messages = $3, updated_at = now()`,
		userID, experimentID, messagesJSON,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save chat"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "saved"})
}

// =============================================================================
// Diagnosis persistence
// =============================================================================

func (h *WorkspaceHandler) GetDiagnosis(c *gin.Context) {
	submissionID := c.Param("id")

	var data []byte
	err := h.db.QueryRow(c,
		`SELECT diagnosis_data FROM workspace_diagnoses WHERE submission_id = $1 ORDER BY created_at DESC LIMIT 1`,
		submissionID,
	).Scan(&data)

	if err != nil {
		c.JSON(http.StatusOK, gin.H{"diagnosis": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"diagnosis": string(data)})
}

func (h *WorkspaceHandler) SaveDiagnosis(c *gin.Context) {
	submissionID := c.Param("id")
	userID := middleware.GetUserID(c)

	var req struct {
		DiagnosisData json.RawMessage `json:"diagnosis_data"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, err := h.db.Exec(c,
		`INSERT INTO workspace_diagnoses (user_id, submission_id, diagnosis_data)
		 VALUES ($1, $2, $3)
		 ON CONFLICT DO NOTHING`,
		userID, submissionID, req.DiagnosisData,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save diagnosis"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "saved"})
}

// =============================================================================
// Dock state (extended draft)
// =============================================================================

type dockStateRequest struct {
	DockVisible      bool     `json:"dock_visible"`
	ActiveDockTool   string   `json:"active_dock_tool"`
	SecondaryDockTool string  `json:"secondary_dock_tool"`
	PinnedTools      []string `json:"pinned_tools"`
	ParallelMode     bool     `json:"parallel_mode"`
}

func (h *WorkspaceHandler) SaveDockState(c *gin.Context) {
	experimentID := c.Param("id")
	userID := middleware.GetUserID(c)

	var req dockStateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, err := h.db.Exec(c,
		`INSERT INTO workspace_drafts (user_id, experiment_id, dock_visible, active_dock_tool,
		 secondary_dock_tool, pinned_tools)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (user_id, experiment_id)
		 DO UPDATE SET dock_visible = $3, active_dock_tool = $4,
		 secondary_dock_tool = $5, pinned_tools = $6, updated_at = now()`,
		userID, experimentID, req.DockVisible, req.ActiveDockTool,
		req.SecondaryDockTool, req.PinnedTools,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save dock state"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "saved"})
}
