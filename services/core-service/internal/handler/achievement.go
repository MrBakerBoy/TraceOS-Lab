package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/achievement"
	"github.com/traceos-lab/core-service/internal/middleware"
)

type AchievementHandler struct {
	svc *achievement.Service
}

func NewAchievementHandler(svc *achievement.Service) *AchievementHandler {
	return &AchievementHandler{svc: svc}
}

type achievementItem struct {
	achievement.Definition
	Unlocked   bool       `json:"unlocked"`
	UnlockedAt *time.Time `json:"unlocked_at,omitempty"`
}

// List returns the full achievement catalog annotated with the current user's
// unlock status. It also evaluates pending unlocks first (idempotent catch-up),
// so the response always reflects the latest activity.
func (h *AchievementHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)

	// Evaluate first so the catalog reflects any newly-satisfied achievements.
	if userID != "" {
		_, _ = h.svc.Evaluate(c, userID)
	}

	unlocked, err := h.svc.Unlocked(c, userID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"achievements": []achievementItem{}, "unlocked_count": 0, "total": len(achievement.Definitions)})
		return
	}

	items := make([]achievementItem, 0, len(achievement.Definitions))
	for _, def := range achievement.Definitions {
		item := achievementItem{Definition: def}
		if at, ok := unlocked[def.ID]; ok {
			item.Unlocked = true
			t := at
			item.UnlockedAt = &t
		}
		items = append(items, item)
	}

	c.JSON(http.StatusOK, gin.H{
		"achievements":   items,
		"unlocked_count": len(unlocked),
		"total":          len(achievement.Definitions),
	})
}

// Evaluate forces an evaluation pass and returns any newly-unlocked
// achievements. The frontend calls this after a submission completes so it can
// render the Steam-style unlock toast without a full-list diff.
func (h *AchievementHandler) Evaluate(c *gin.Context) {
	userID := middleware.GetUserID(c)
	newly, err := h.svc.Evaluate(c, userID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"newly_unlocked": []achievement.Definition{}})
		return
	}
	if newly == nil {
		newly = []achievement.Definition{}
	}
	c.JSON(http.StatusOK, gin.H{"newly_unlocked": newly})
}
