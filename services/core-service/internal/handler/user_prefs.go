package handler

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/middleware"
)

type UserPrefsHandler struct {
	db *pgxpool.Pool
}

func NewUserPrefsHandler(db *pgxpool.Pool) *UserPrefsHandler {
	return &UserPrefsHandler{db: db}
}

func (h *UserPrefsHandler) Get(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var prefs struct {
		SidebarCollapsed bool            `json:"sidebar_collapsed"`
		ThemeMode        string          `json:"theme_mode"`
		EditorTheme      string          `json:"editor_theme"`
		EditorFontSize   int             `json:"editor_font_size"`
		Preferences      json.RawMessage `json:"preferences"`
	}

	err := h.db.QueryRow(c,
		`SELECT COALESCE(sidebar_collapsed, false), COALESCE(theme, 'dark'),
		        COALESCE(editor_theme, 'vs-dark'), COALESCE(editor_font_size, 14),
		        COALESCE(jsonb_preferences, '{}')
		 FROM user_preferences WHERE user_id = $1`,
		userID,
	).Scan(&prefs.SidebarCollapsed, &prefs.ThemeMode, &prefs.EditorTheme,
		&prefs.EditorFontSize, &prefs.Preferences)

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"sidebar_collapsed": false,
			"theme_mode":        "dark",
			"editor_theme":      "vs-dark",
			"editor_font_size":  14,
			"preferences":       "{}",
		})
		return
	}
	c.JSON(http.StatusOK, prefs)
}

func (h *UserPrefsHandler) Save(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req struct {
		SidebarCollapsed *bool   `json:"sidebar_collapsed"`
		ThemeMode        *string `json:"theme_mode"`
		EditorTheme      *string `json:"editor_theme"`
		EditorFontSize   *int    `json:"editor_font_size"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.db.Exec(c, `INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, userID)

	q := "UPDATE user_preferences SET updated_at = now()"
	args := []interface{}{}
	idx := 1

	if req.SidebarCollapsed != nil {
		idx++
		q += fmt.Sprintf(", sidebar_collapsed = $%d", idx)
		args = append(args, *req.SidebarCollapsed)
	}
	if req.ThemeMode != nil {
		idx++
		q += fmt.Sprintf(", theme = $%d", idx)
		args = append(args, *req.ThemeMode)
	}
	if req.EditorTheme != nil {
		idx++
		q += fmt.Sprintf(", editor_theme = $%d", idx)
		args = append(args, *req.EditorTheme)
	}
	if req.EditorFontSize != nil {
		idx++
		q += fmt.Sprintf(", editor_font_size = $%d", idx)
		args = append(args, *req.EditorFontSize)
	}
	q += " WHERE user_id = $1"
	args = append([]interface{}{userID}, args...)

	_, err := h.db.Exec(c, q, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "saved"})
}
