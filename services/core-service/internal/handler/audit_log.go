package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/model"
	"github.com/traceos-lab/core-service/internal/repository"
)

// AuditLogHandler handles admin audit log queries.
type AuditLogHandler struct {
	repo *repository.AuditLogRepo
}

// NewAuditLogHandler creates a new audit log handler.
func NewAuditLogHandler(repo *repository.AuditLogRepo) *AuditLogHandler {
	return &AuditLogHandler{repo: repo}
}

// List returns paginated audit logs with filters.
// GET /api/v1/admin/logs?page=1&page_size=50&user_id=&action=&resource_type=&date_from=&date_to=
func (h *AuditLogHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))

	filter := model.AuditLogFilter{
		UserID:       c.Query("user_id"),
		Action:       c.Query("action"),
		ResourceType: c.Query("resource_type"),
		DateFrom:     c.Query("date_from"),
		DateTo:       c.Query("date_to"),
		Page:         page,
		PageSize:     pageSize,
	}

	entries, total, err := h.repo.List(c, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, model.PaginatedResponse{
		Data:       entries,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: (total + pageSize - 1) / pageSize,
	})
}

// GetByID returns a single audit log entry.
// GET /api/v1/admin/logs/:id
func (h *AuditLogHandler) GetByID(c *gin.Context) {
	entry, err := h.repo.GetByID(c, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, entry)
}
