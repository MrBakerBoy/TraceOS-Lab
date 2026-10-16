package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/model"
)

type CodeTemplateRepo struct {
	db *pgxpool.Pool
}

func NewCodeTemplateRepo(db *pgxpool.Pool) *CodeTemplateRepo {
	return &CodeTemplateRepo{db: db}
}

// GetByExperiment returns all code templates for an experiment.
func (r *CodeTemplateRepo) GetByExperiment(ctx context.Context, experimentID string) ([]model.CodeTemplate, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, experiment_id, language, starter_code, reference_solution, is_published, created_at
		FROM experiment_code_templates
		WHERE experiment_id = $1
		ORDER BY
			CASE language
				WHEN 'c' THEN 0 WHEN 'cpp' THEN 1
				WHEN 'python' THEN 2 WHEN 'go' THEN 3 WHEN 'rust' THEN 4
				ELSE 5
			END
	`, experimentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var templates []model.CodeTemplate
	for rows.Next() {
		var t model.CodeTemplate
		if err := rows.Scan(&t.ID, &t.ExperimentID, &t.Language, &t.StarterCode, &t.ReferenceSolution, &t.IsPublished, &t.CreatedAt); err != nil {
			return nil, err
		}
		templates = append(templates, t)
	}
	return templates, nil
}

// GetTemplate returns a single template by experiment and language.
func (r *CodeTemplateRepo) GetTemplate(ctx context.Context, experimentID, language string) (*model.CodeTemplate, error) {
	t := &model.CodeTemplate{}
	err := r.db.QueryRow(ctx, `
		SELECT id, experiment_id, language, starter_code, reference_solution, is_published, created_at
		FROM experiment_code_templates
		WHERE experiment_id = $1 AND language = $2
	`, experimentID, language).Scan(&t.ID, &t.ExperimentID, &t.Language, &t.StarterCode, &t.ReferenceSolution, &t.IsPublished, &t.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get template: %w", err)
	}
	return t, nil
}

// Upsert inserts or updates a template.
func (r *CodeTemplateRepo) Upsert(ctx context.Context, experimentID, language string, starterCode, referenceSolution *string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published, updated_at)
		VALUES ($1, $2, $3, $4, true, NOW())
		ON CONFLICT (experiment_id, language)
		DO UPDATE SET starter_code = $3, reference_solution = $4, updated_at = NOW()
	`, experimentID, language, starterCode, referenceSolution)
	if err != nil {
		return fmt.Errorf("upsert template: %w", err)
	}
	return nil
}

// Delete removes a template.
func (r *CodeTemplateRepo) Delete(ctx context.Context, experimentID, language string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM experiment_code_templates WHERE experiment_id = $1 AND language = $2`, experimentID, language)
	return err
}
