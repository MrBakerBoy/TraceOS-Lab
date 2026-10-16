package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/model"
)

type CommentRepo struct {
	db *pgxpool.Pool
}

func NewCommentRepo(db *pgxpool.Pool) *CommentRepo {
	return &CommentRepo{db: db}
}

func (r *CommentRepo) GetByID(ctx context.Context, commentID string) (*model.Comment, error) {
	c := &model.Comment{}
	err := r.db.QueryRow(ctx, `
		SELECT id, experiment_id, user_id, parent_id, content, is_pinned, is_ai, created_at, updated_at
		FROM comments WHERE id = $1
	`, commentID).Scan(&c.ID, &c.ExperimentID, &c.UserID, &c.ParentID, &c.Content, &c.IsPinned, &c.IsAI, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get comment: %w", err)
	}
	return c, nil
}

func (r *CommentRepo) ListByExperiment(ctx context.Context, experimentID string, page, pageSize int) ([]model.Comment, int, error) {
	var total int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM comments WHERE experiment_id = $1 AND parent_id IS NULL`, experimentID,
	).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count comments: %w", err)
	}

	rows, err := r.db.Query(ctx, `
		SELECT c.id, c.experiment_id, c.user_id, c.parent_id, c.content, c.is_pinned, c.is_ai,
		       c.created_at, c.updated_at,
		       u.id, u.username, u.full_name, u.role
		FROM comments c
		JOIN users u ON u.id = c.user_id
		WHERE c.experiment_id = $1 AND c.parent_id IS NULL
		ORDER BY c.is_pinned DESC, c.created_at DESC
		LIMIT $2 OFFSET $3
	`, experimentID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, fmt.Errorf("list comments: %w", err)
	}
	defer rows.Close()

	var comments []model.Comment
	for rows.Next() {
		var c model.Comment
		var u model.User
		if err := rows.Scan(
			&c.ID, &c.ExperimentID, &c.UserID, &c.ParentID, &c.Content, &c.IsPinned, &c.IsAI,
			&c.CreatedAt, &c.UpdatedAt,
			&u.ID, &u.Username, &u.FullName, &u.Role,
		); err != nil {
			return nil, 0, fmt.Errorf("scan comment: %w", err)
		}
		c.User = &u
		replies, err := r.listReplies(ctx, c.ID)
		if err == nil {
			c.Replies = replies
		}
		comments = append(comments, c)
	}
	return comments, total, nil
}

func (r *CommentRepo) listReplies(ctx context.Context, parentID string) ([]model.Comment, error) {
	rows, err := r.db.Query(ctx, `
		SELECT c.id, c.experiment_id, c.user_id, c.parent_id, c.content, c.is_pinned, c.is_ai,
		       c.created_at, c.updated_at,
		       u.id, u.username, u.full_name, u.role
		FROM comments c
		JOIN users u ON u.id = c.user_id
		WHERE c.parent_id = $1
		ORDER BY c.created_at ASC
	`, parentID)
	if err != nil {
		return nil, fmt.Errorf("list replies: %w", err)
	}
	defer rows.Close()

	var replies []model.Comment
	for rows.Next() {
		var c model.Comment
		var u model.User
		if err := rows.Scan(
			&c.ID, &c.ExperimentID, &c.UserID, &c.ParentID, &c.Content, &c.IsPinned, &c.IsAI,
			&c.CreatedAt, &c.UpdatedAt,
			&u.ID, &u.Username, &u.FullName, &u.Role,
		); err != nil {
			return nil, fmt.Errorf("scan reply: %w", err)
		}
		c.User = &u
		replies = append(replies, c)
	}
	return replies, nil
}

func (r *CommentRepo) Create(ctx context.Context, c *model.Comment) error {
	return r.db.QueryRow(ctx, `
		INSERT INTO comments (experiment_id, user_id, parent_id, content, is_ai)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at, updated_at
	`, c.ExperimentID, c.UserID, c.ParentID, c.Content, c.IsAI).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
}

func (r *CommentRepo) Update(ctx context.Context, commentID, content string) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE comments SET content = $1, updated_at = NOW() WHERE id = $2
	`, content, commentID)
	if err != nil {
		return fmt.Errorf("update comment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("comment not found")
	}
	return nil
}

func (r *CommentRepo) Delete(ctx context.Context, commentID string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM comments WHERE id = $1`, commentID)
	return err
}

func (r *CommentRepo) TogglePin(ctx context.Context, commentID string) error {
	_, err := r.db.Exec(ctx, `UPDATE comments SET is_pinned = NOT is_pinned WHERE id = $1`, commentID)
	return err
}
