package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/model"
)

type ExperimentRepo struct {
	db *pgxpool.Pool
}

func NewExperimentRepo(db *pgxpool.Pool) *ExperimentRepo {
	return &ExperimentRepo{db: db}
}

func (r *ExperimentRepo) List(ctx context.Context, filters map[string]string, page, pageSize int) ([]model.Experiment, int, error) {
	where := []string{"1=1", "deleted_at IS NULL"}
	args := []interface{}{}
	argIdx := 1

	if v, ok := filters["category"]; ok && v != "" {
		where = append(where, fmt.Sprintf("category = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v, ok := filters["difficulty"]; ok && v != "" {
		where = append(where, fmt.Sprintf("difficulty = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v, ok := filters["course_id"]; ok && v != "" {
		where = append(where, fmt.Sprintf("course_id = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v, ok := filters["is_published"]; ok && v != "" {
		where = append(where, fmt.Sprintf("is_published = $%d", argIdx))
		args = append(args, v == "true")
		argIdx++
	}

	whereClause := strings.Join(where, " AND ")

	var total int
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	if err := r.db.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM experiments WHERE %s`, whereClause), countArgs...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT id, course_id, category, name, title, description, instructions,
		       starter_code, reference_solution, answer_explanation, difficulty, time_limit, memory_limit,
		       sandbox_level, max_submissions, is_published, deleted_at, created_by, created_at, updated_at
		FROM experiments WHERE %s
		ORDER BY created_at DESC LIMIT $%d OFFSET $%d
	`, whereClause, argIdx, argIdx+1)
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var experiments []model.Experiment
	for rows.Next() {
		var e model.Experiment
		if err := rows.Scan(&e.ID, &e.CourseID, &e.Category, &e.Name, &e.Title,
			&e.Description, &e.Instructions, &e.StarterCode, &e.ReferenceSolution,
			&e.AnswerExplanation, &e.Difficulty, &e.TimeLimit, &e.MemoryLimit, &e.SandboxLevel,
			&e.MaxSubmissions, &e.IsPublished, &e.DeletedAt, &e.CreatedBy, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, 0, err
		}
		experiments = append(experiments, e)
	}
	return experiments, total, nil
}

func (r *ExperimentRepo) GetByID(ctx context.Context, id string) (*model.Experiment, error) {
	e := &model.Experiment{}
	err := r.db.QueryRow(ctx, `
		SELECT id, course_id, category, name, title, description, instructions,
		       starter_code, reference_solution, answer_explanation, difficulty, time_limit, memory_limit,
		       sandbox_level, max_submissions, is_published, deleted_at, created_by, created_at, updated_at
		FROM experiments WHERE id::text = $1 AND deleted_at IS NULL
	`, id).Scan(&e.ID, &e.CourseID, &e.Category, &e.Name, &e.Title,
		&e.Description, &e.Instructions, &e.StarterCode, &e.ReferenceSolution,
		&e.AnswerExplanation, &e.Difficulty, &e.TimeLimit, &e.MemoryLimit, &e.SandboxLevel,
		&e.MaxSubmissions, &e.IsPublished, &e.DeletedAt, &e.CreatedBy, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get experiment: %w", err)
	}
	return e, nil
}

func (r *ExperimentRepo) GetTestCases(ctx context.Context, experimentID string) ([]model.TestCase, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, experiment_id, name, type, compare_mode, input_data, expected_output, is_public, score_weight, order_index, COALESCE(expected_patterns::text, ''), COALESCE(expected_syscalls::text, ''), COALESCE(forbidden_syscalls::text, '')
		FROM test_cases WHERE experiment_id = $1 ORDER BY order_index
	`, experimentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cases []model.TestCase
	for rows.Next() {
		var tc model.TestCase
		if err := rows.Scan(&tc.ID, &tc.ExperimentID, &tc.Name, &tc.Type, &tc.CompareMode,
			&tc.InputData, &tc.ExpectedOutput, &tc.IsPublic, &tc.ScoreWeight, &tc.OrderIndex, &tc.ExpectedPatterns, &tc.ExpectedSyscalls, &tc.ForbiddenSyscalls); err != nil {
			return nil, err
		}
		cases = append(cases, tc)
	}
	return cases, nil
}

type CreateExperimentInput struct {
	CourseID          *string `json:"course_id"`
	Category          string  `json:"category" binding:"required"`
	Name              string  `json:"name" binding:"required"`
	Title             string  `json:"title" binding:"required"`
	Description       *string `json:"description"`
	Instructions      *string `json:"instructions"`
	StarterCode       *string `json:"starter_code"`
	ReferenceSolution *string `json:"reference_solution"`
	Difficulty        string  `json:"difficulty"`
	TimeLimit         int     `json:"time_limit"`
	MemoryLimit       int64   `json:"memory_limit"`
	SandboxLevel      int     `json:"sandbox_level"`
	MaxSubmissions    int     `json:"max_submissions"`
	AnswerExplanation *string `json:"answer_explanation"`
}

func (r *ExperimentRepo) Create(ctx context.Context, input *CreateExperimentInput, createdBy string) (*model.Experiment, error) {
	e := &model.Experiment{}
	difficulty := input.Difficulty
	if difficulty == "" {
		difficulty = "medium"
	}
	timeLimit := input.TimeLimit
	if timeLimit == 0 {
		timeLimit = 300
	}
	memoryLimit := input.MemoryLimit
	if memoryLimit == 0 {
		memoryLimit = 268435456
	}
	sandboxLevel := input.SandboxLevel
	if sandboxLevel == 0 {
		sandboxLevel = 1
	}
	maxSubmissions := input.MaxSubmissions
	if maxSubmissions == 0 {
		maxSubmissions = 100
	}

	err := r.db.QueryRow(ctx, `
		INSERT INTO experiments (course_id, category, name, title, description, instructions,
			starter_code, reference_solution, answer_explanation, difficulty, time_limit, memory_limit,
			sandbox_level, max_submissions, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		RETURNING id, is_published, deleted_at, created_at, updated_at
	`, input.CourseID, input.Category, input.Name, input.Title, input.Description,
		input.Instructions, input.StarterCode, input.ReferenceSolution, input.AnswerExplanation,
		difficulty, timeLimit, memoryLimit, sandboxLevel, maxSubmissions, createdBy).
		Scan(&e.ID, &e.IsPublished, &e.DeletedAt, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create experiment: %w", err)
	}

	e.CourseID = input.CourseID
	e.Category = input.Category
	e.Name = input.Name
	e.Title = input.Title
	e.Description = input.Description
	e.Instructions = input.Instructions
	e.StarterCode = input.StarterCode
	e.ReferenceSolution = input.ReferenceSolution
	e.AnswerExplanation = input.AnswerExplanation
	e.Difficulty = difficulty
	e.TimeLimit = timeLimit
	e.MemoryLimit = memoryLimit
	e.SandboxLevel = sandboxLevel
	e.MaxSubmissions = maxSubmissions
	return e, nil
}

func (r *ExperimentRepo) Update(ctx context.Context, id string, updates map[string]interface{}) (*model.Experiment, error) {
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	for k, v := range updates {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", k, argIdx))
		args = append(args, v)
		argIdx++
	}
	if len(setClauses) == 0 {
		return r.GetByID(ctx, id)
	}

	args = append(args, id)
	query := fmt.Sprintf(`
		UPDATE experiments SET %s WHERE id = $%d
	`, strings.Join(setClauses, ", "), argIdx)

	if _, err := r.db.Exec(ctx, query, args...); err != nil {
		return nil, fmt.Errorf("update experiment: %w", err)
	}
	return r.GetByID(ctx, id)
}

// SoftDelete marks an experiment as deleted by setting deleted_at.
func (r *ExperimentRepo) SoftDelete(ctx context.Context, id string) error {
	result, err := r.db.Exec(ctx, `UPDATE experiments SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("soft delete experiment: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("experiment not found or already deleted")
	}
	return nil
}

// ── Test Case CRUD ──────────────────────────────────────────────────────

type CreateTestCaseInput struct {
	ExperimentID   string `json:"experiment_id" binding:"required"`
	Name           string `json:"name" binding:"required"`
	Type           string `json:"type"`
	CompareMode    string `json:"compare_mode"`
	InputData      string `json:"input_data"`
	ExpectedOutput string `json:"expected_output"`
	IsPublic       bool   `json:"is_public"`
	ScoreWeight    int    `json:"score_weight"`
	OrderIndex     int    `json:"order_index"`
}

func (r *ExperimentRepo) CreateTestCase(ctx context.Context, input *CreateTestCaseInput) (*model.TestCase, error) {
	tc := &model.TestCase{}
	if input.Type == "" {
		input.Type = "core"
	}
	if input.CompareMode == "" {
		input.CompareMode = "normalized_contains"
	}
	if input.ScoreWeight == 0 {
		input.ScoreWeight = 10
	}
	err := r.db.QueryRow(ctx, `
		INSERT INTO test_cases (experiment_id, name, type, compare_mode, input_data, expected_output, is_public, score_weight, order_index)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id, experiment_id, name, type, compare_mode, input_data, expected_output, is_public, score_weight, order_index
	`, input.ExperimentID, input.Name, input.Type, input.CompareMode, input.InputData,
		input.ExpectedOutput, input.IsPublic, input.ScoreWeight, input.OrderIndex).
		Scan(&tc.ID, &tc.ExperimentID, &tc.Name, &tc.Type, &tc.CompareMode,
			&tc.InputData, &tc.ExpectedOutput, &tc.IsPublic, &tc.ScoreWeight, &tc.OrderIndex)
	if err != nil {
		return nil, fmt.Errorf("create test case: %w", err)
	}
	return tc, nil
}

func (r *ExperimentRepo) UpdateTestCase(ctx context.Context, id string, updates map[string]interface{}) (*model.TestCase, error) {
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	for k, v := range updates {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", k, argIdx))
		args = append(args, v)
		argIdx++
	}
	if len(setClauses) == 0 {
		return nil, fmt.Errorf("no fields to update")
	}

	args = append(args, id)
	query := fmt.Sprintf(`
		UPDATE test_cases SET %s WHERE id = $%d
		RETURNING id, experiment_id, name, type, compare_mode, input_data, expected_output, is_public, score_weight, order_index
	`, strings.Join(setClauses, ", "), argIdx)

	tc := &model.TestCase{}
	err := r.db.QueryRow(ctx, query, args...).Scan(
		&tc.ID, &tc.ExperimentID, &tc.Name, &tc.Type, &tc.CompareMode,
		&tc.InputData, &tc.ExpectedOutput, &tc.IsPublic, &tc.ScoreWeight, &tc.OrderIndex)
	if err != nil {
		return nil, fmt.Errorf("update test case: %w", err)
	}
	return tc, nil
}

func (r *ExperimentRepo) DeleteTestCase(ctx context.Context, id string) error {
	result, err := r.db.Exec(ctx, `DELETE FROM test_cases WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete test case: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("test case not found")
	}
	return nil
}

// RubricRow is the raw rubric row from the database.
type RubricRow struct {
	ExperimentID string
	Version      string
	Category     string
	RubricJSON   []byte
}

// GetRubric loads the active rubric for a given experiment category.
func (r *ExperimentRepo) GetRubric(ctx context.Context, category string) ([]byte, error) {
	var data []byte
	err := r.db.QueryRow(ctx, `
		SELECT rubric_json FROM experiment_rubrics
		WHERE category = $1 AND is_active = true
		ORDER BY version DESC LIMIT 1
	`, category).Scan(&data)
	if err != nil {
		return nil, err
	}
	return data, nil
}
