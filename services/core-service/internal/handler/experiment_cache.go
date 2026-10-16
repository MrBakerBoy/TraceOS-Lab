package handler

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/middleware"
)

// ExperimentCacheHandler handles reading/writing experiment result caches.
type ExperimentCacheHandler struct {
	db *pgxpool.Pool
}

// NewExperimentCacheHandler creates a new cache handler.
func NewExperimentCacheHandler(db *pgxpool.Pool) *ExperimentCacheHandler {
	return &ExperimentCacheHandler{db: db}
}

// GetExperimentCache returns all cached results for experiment + user.
// GET /api/v1/experiments/:id/cache
func (h *ExperimentCacheHandler) GetExperimentCache(c *gin.Context) {
	experimentID := c.Param("id")
	userID := middleware.GetUserID(c)

	results := make(map[string]interface{})

	rows, err := h.db.Query(c.Request.Context(), `
		SELECT cache_type, data, submission_id, created_at, expires_at
		FROM experiment_cache
		WHERE experiment_id = $1 AND user_id = $2 AND expires_at > NOW()
		ORDER BY created_at DESC
	`, experimentID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query cache"})
		return
	}
	defer rows.Close()

	for rows.Next() {
		var cacheType string
		var data json.RawMessage
		var submissionID string
		var createdAt, expiresAt time.Time
		if err := rows.Scan(&cacheType, &data, &submissionID, &createdAt, &expiresAt); err != nil {
			continue
		}
		results[cacheType] = map[string]interface{}{
			"data":          data,
			"submission_id": submissionID,
			"created_at":    createdAt,
			"expires_at":    expiresAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{"caches": results})
}

// SaveCache handles POST /api/v1/experiments/:id/cache
func (h *ExperimentCacheHandler) SaveCache(c *gin.Context) {
	experimentID := c.Param("id")
	userID := middleware.GetUserID(c)

	var req struct {
		SubmissionID string          `json:"submission_id"`
		CacheType    string          `json:"cache_type" binding:"required"`
		Data         json.RawMessage `json:"data" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	validTypes := map[string]bool{
		"flamegraph": true, "ebpf_trace": true, "code_audit": true,
		"waterfall": true, "memory3d": true, "live_perf": true, "ai_analysis": true,
	}
	if !validTypes[req.CacheType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cache_type"})
		return
	}

	_, err := h.db.Exec(c.Request.Context(), `
		INSERT INTO experiment_cache (experiment_id, submission_id, user_id, cache_type, data, data_size_bytes, expires_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, octet_length($5::text), NOW() + INTERVAL '3 days', NOW())
		ON CONFLICT (experiment_id, submission_id, cache_type, user_id)
		DO UPDATE SET data = $5, data_size_bytes = octet_length($5::text), expires_at = NOW() + INTERVAL '3 days', updated_at = NOW()
	`, experimentID, req.SubmissionID, userID, req.CacheType, req.Data)
	if err != nil {
		log.Printf("[cache] Save failed for type=%s experiment=%s: %v", req.CacheType, experimentID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save cache"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "cached", "type": req.CacheType})
}

// DeleteCache handles DELETE /api/v1/experiments/:id/cache
func (h *ExperimentCacheHandler) DeleteCache(c *gin.Context) {
	experimentID := c.Param("id")
	userID := middleware.GetUserID(c)

	_, err := h.db.Exec(c.Request.Context(), `
		DELETE FROM experiment_cache WHERE experiment_id = $1 AND user_id = $2
	`, experimentID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete cache"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "cleared"})
}

// SaveTypedCache is a helper for other handlers to save cache programmatically.
func (h *ExperimentCacheHandler) SaveTypedCache(ctx context.Context, experimentID, submissionID, userID, cacheType string, data interface{}) {
	dataJSON, err := json.Marshal(data)
	if err != nil {
		log.Printf("[cache] marshal failed for type=%s: %v", cacheType, err)
		return
	}

	_, err = h.db.Exec(ctx, `
		INSERT INTO experiment_cache (experiment_id, submission_id, user_id, cache_type, data, data_size_bytes, expires_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, octet_length($5::text), NOW() + INTERVAL '3 days', NOW())
		ON CONFLICT (experiment_id, submission_id, cache_type, user_id)
		DO UPDATE SET data = $5, data_size_bytes = octet_length($5::text), expires_at = NOW() + INTERVAL '3 days', updated_at = NOW()
	`, experimentID, submissionID, userID, cacheType, dataJSON)
	if err != nil {
		log.Printf("[cache] save failed for type=%s experiment=%s: %v", cacheType, experimentID, err)
	}
}

// StartCacheCleanup starts a background goroutine that cleans expired cache entries every hour.
func (h *ExperimentCacheHandler) StartCacheCleanup() {
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			result, err := h.db.Exec(context.Background(), `
				DELETE FROM experiment_cache WHERE expires_at < NOW()
			`)
			if err != nil {
				log.Printf("[cache] cleanup failed: %v", err)
			} else {
				log.Printf("[cache] cleanup completed, rows deleted: %d", result.RowsAffected())
			}
		}
	}()
	log.Println("[cache] cleanup goroutine started (hourly)")
}
