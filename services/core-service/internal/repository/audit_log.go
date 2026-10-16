package repository

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/model"
)

// AuditLogRepo manages audit log persistence.
type AuditLogRepo struct {
	db *pgxpool.Pool
}

// NewAuditLogRepo creates a new audit log repository.
func NewAuditLogRepo(db *pgxpool.Pool) *AuditLogRepo {
	return &AuditLogRepo{db: db}
}

// Create inserts a new audit log entry.
func (r *AuditLogRepo) Create(ctx context.Context, entry *model.AuditLogEntry) error {
	return r.db.QueryRow(ctx, `
		INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, request_data, response_status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at
	`, entry.UserID, entry.Action, entry.ResourceType, entry.ResourceID,
		entry.IPAddress, entry.UserAgent, entry.RequestData, entry.ResponseStatus).
		Scan(&entry.ID, &entry.CreatedAt)
}

// List returns paginated audit logs with optional filters.
func (r *AuditLogRepo) List(ctx context.Context, filter model.AuditLogFilter) ([]model.AuditLogEntry, int, error) {
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.PageSize < 1 || filter.PageSize > 200 {
		filter.PageSize = 50
	}

	where := "1=1"
	args := []interface{}{}
	argIdx := 1

	if filter.UserID != "" {
		where += " AND a.user_id = $" + strconv.Itoa(argIdx)
		args = append(args, filter.UserID)
		argIdx++
	}
	if filter.Action != "" {
		where += " AND a.action = $" + strconv.Itoa(argIdx)
		args = append(args, filter.Action)
		argIdx++
	}
	if filter.ResourceType != "" {
		where += " AND a.resource_type = $" + strconv.Itoa(argIdx)
		args = append(args, filter.ResourceType)
		argIdx++
	}
	if filter.DateFrom != "" {
		if t, err := time.Parse(time.RFC3339, filter.DateFrom); err == nil {
			where += " AND a.created_at >= $" + strconv.Itoa(argIdx)
			args = append(args, t)
			argIdx++
		}
	}
	if filter.DateTo != "" {
		if t, err := time.Parse(time.RFC3339, filter.DateTo); err == nil {
			where += " AND a.created_at <= $" + strconv.Itoa(argIdx)
			args = append(args, t)
			argIdx++
		}
	}

	// Count total
	var total int
	countQuery := "SELECT COUNT(*) FROM audit_logs a WHERE " + where
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count audit logs: %w", err)
	}

	// Fetch page
	offset := (filter.Page - 1) * filter.PageSize
	query := fmt.Sprintf(`
		SELECT a.id, a.user_id, COALESCE(u.username, ''), a.action, a.resource_type, a.resource_id,
		       a.ip_address::text, a.user_agent, COALESCE(a.request_data::text, ''), a.response_status, a.created_at
		FROM audit_logs a
		LEFT JOIN users u ON a.user_id = u.id
		WHERE %s
		ORDER BY a.created_at DESC
		LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1)
	args = append(args, filter.PageSize, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list audit logs: %w", err)
	}
	defer rows.Close()

	var entries []model.AuditLogEntry
	for rows.Next() {
		var e model.AuditLogEntry
		var ipStr, uaStr, reqDataStr string
		var respStatus *int
		if err := rows.Scan(&e.ID, &e.UserID, &e.Username, &e.Action,
			&e.ResourceType, &e.ResourceID, &ipStr, &uaStr, &reqDataStr,
			&respStatus, &e.CreatedAt); err != nil {
			if err == pgx.ErrNoRows {
				continue
			}
			return nil, 0, fmt.Errorf("scan audit log: %w", err)
		}
		if ipStr != "" {
			e.IPAddress = &ipStr
		}
		if uaStr != "" {
			e.UserAgent = &uaStr
		}
		if reqDataStr != "" {
			e.RequestData = &reqDataStr
		}
		e.ResponseStatus = respStatus
		entries = append(entries, e)
	}

	return entries, total, nil
}

// GetByID returns a single audit log entry.
func (r *AuditLogRepo) GetByID(ctx context.Context, id string) (*model.AuditLogEntry, error) {
	e := &model.AuditLogEntry{}
	var ipStr, uaStr, reqDataStr string
	err := r.db.QueryRow(ctx, `
		SELECT a.id, a.user_id, COALESCE(u.username, ''), a.action, a.resource_type, a.resource_id,
		       a.ip_address::text, a.user_agent, COALESCE(a.request_data::text, ''), a.response_status, a.created_at
		FROM audit_logs a
		LEFT JOIN users u ON a.user_id = u.id
		WHERE a.id = $1
	`, id).Scan(&e.ID, &e.UserID, &e.Username, &e.Action,
		&e.ResourceType, &e.ResourceID, &ipStr, &uaStr, &reqDataStr,
		&e.ResponseStatus, &e.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get audit log: %w", err)
	}
	if ipStr != "" {
		e.IPAddress = &ipStr
	}
	if uaStr != "" {
		e.UserAgent = &uaStr
	}
	if reqDataStr != "" {
		e.RequestData = &reqDataStr
	}
	return e, nil
}

// LogAction is a convenience helper for logging actions from handlers.
func (r *AuditLogRepo) LogAction(ctx context.Context, userID *string, action string, resourceType *string, resourceID *string, ip *string, ua *string, status *int) {
	entry := &model.AuditLogEntry{
		UserID:         userID,
		Action:         action,
		ResourceType:   resourceType,
		ResourceID:     resourceID,
		IPAddress:      ip,
		UserAgent:      ua,
		ResponseStatus: status,
	}
	if err := r.Create(ctx, entry); err != nil {
		// Non-fatal — audit log failures should not break the API
	}
}
