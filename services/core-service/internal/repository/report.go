package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Report represents an experiment report submitted by a student.
type Report struct {
	ID           string    `json:"id"`
	SubmissionID string    `json:"submission_id"`
	StudentID    string    `json:"student_id"`
	Content      string    `json:"content"`
	FileURL      *string   `json:"file_url,omitempty"`
	Score        *int      `json:"score,omitempty"`
	Feedback     *string   `json:"feedback,omitempty"`
	Status            string    `json:"status"`
	AiScore           *int      `json:"ai_score,omitempty"`
	AiFeedback        *string   `json:"ai_feedback,omitempty"`
	AiDimensionScores *string   `json:"ai_dimension_scores,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// ReportRepo manages experiment report persistence.
type ReportRepo struct {
	db *pgxpool.Pool
}

// NewReportRepo creates a new report repository.
func NewReportRepo(db *pgxpool.Pool) *ReportRepo {
	return &ReportRepo{db: db}
}

// DB returns the underlying database pool for async operations.
func (r *ReportRepo) DB() *pgxpool.Pool {
	return r.db
}

// Create submits a new experiment report.
func (r *ReportRepo) Create(ctx context.Context, report *Report) error {
	return r.db.QueryRow(ctx, `
		INSERT INTO experiment_reports (submission_id, student_id, content, file_url)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (submission_id) DO UPDATE SET content = $3, file_url = $4, updated_at = NOW()
		RETURNING id, created_at, updated_at, status
	`, report.SubmissionID, report.StudentID, report.Content, report.FileURL).
		Scan(&report.ID, &report.CreatedAt, &report.UpdatedAt, &report.Status)
}

// GetBySubmission returns the report for a specific submission.
func (r *ReportRepo) GetBySubmission(ctx context.Context, submissionID string) (*Report, error) {
	report := &Report{}
	err := r.db.QueryRow(ctx, `
		SELECT id, submission_id, student_id, content, file_url, score, feedback, status, ai_score, ai_feedback, ai_dimension_scores, created_at, updated_at
		FROM experiment_reports WHERE submission_id = $1
	`, submissionID).Scan(&report.ID, &report.SubmissionID, &report.StudentID,
		&report.Content, &report.FileURL, &report.Score, &report.Feedback,
		&report.Status, &report.AiScore, &report.AiFeedback, &report.AiDimensionScores, &report.CreatedAt, &report.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get report: %w", err)
	}
	return report, nil
}

// ListByStudent returns all reports for a student.
func (r *ReportRepo) ListByStudent(ctx context.Context, studentID string, page, pageSize int) ([]Report, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}

	var total int
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM experiment_reports WHERE student_id = $1`, studentID).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	rows, err := r.db.Query(ctx, `
		SELECT id, submission_id, student_id, content, file_url, score, feedback, status, ai_score, ai_feedback, ai_dimension_scores, created_at, updated_at
		FROM experiment_reports WHERE student_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3
	`, studentID, pageSize, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list reports: %w", err)
	}
	defer rows.Close()

	var reports []Report
	for rows.Next() {
		var rep Report
		if err := rows.Scan(&rep.ID, &rep.SubmissionID, &rep.StudentID,
			&rep.Content, &rep.FileURL, &rep.Score, &rep.Feedback,
			&rep.Status, &rep.AiScore, &rep.AiFeedback, &rep.AiDimensionScores, &rep.CreatedAt, &rep.UpdatedAt); err != nil {
			return nil, 0, err
		}
		reports = append(reports, rep)
	}
	return reports, total, nil
}

// Grade updates the score and feedback for a report.
func (r *ReportRepo) Grade(ctx context.Context, id string, score int, feedback string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE experiment_reports SET score = $2, feedback = $3, status = 'graded', updated_at = NOW()
		WHERE id = $1
	`, id, score, feedback)
	return err
}
