package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/adaptive"
)

type AdaptiveHandler struct {
	selector *adaptive.Selector
	profiler *adaptive.Profiler
}

func NewAdaptiveHandler(selector *adaptive.Selector, profiler *adaptive.Profiler) *AdaptiveHandler {
	return &AdaptiveHandler{selector: selector, profiler: profiler}
}

// GetVariant GET /api/v1/experiments/:id/variant
func (h *AdaptiveHandler) GetVariant(c *gin.Context) {
	experimentID := c.Param("id")
	studentID := c.GetString("user_id")

	assignment, err := h.selector.SelectVariantForStudent(c.Request.Context(), studentID, experimentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, assignment)
}

// GetProfile GET /api/v1/adaptive/profile
func (h *AdaptiveHandler) GetProfile(c *gin.Context) {
	studentID := c.GetString("user_id")

	result, err := h.profiler.BuildProfile(c.Request.Context(), studentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	radarData := map[string]interface{}{
		"profile": result.Profile,
		"radar": map[string]float64{
			"进程管理": result.Profile.ProcessELO,
			"线程同步": result.Profile.ThreadELO,
			"内存管理": result.Profile.MemoryELO,
			"文件系统": result.Profile.FsELO,
			"处理机调度": result.Profile.SchedulerELO,
			"死锁":    result.Profile.DeadlockELO,
		},
		"total_submissions": result.TotalSubmissions,
		"recent_scores":     result.RecentScores,
	}

	c.JSON(http.StatusOK, radarData)
}

// GetRecommendations GET /api/v1/adaptive/recommend
func (h *AdaptiveHandler) GetRecommendations(c *gin.Context) {
	studentID := c.GetString("user_id")
	recs, err := h.profiler.RecommendNext(c.Request.Context(), studentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"recommendations": recs})
}
