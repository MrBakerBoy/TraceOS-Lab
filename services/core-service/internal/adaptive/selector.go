package adaptive

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Selector picks the appropriate experiment variant for a student.
type Selector struct {
	db       *pgxpool.Pool
	profiler *Profiler
}

// NewSelector creates a new variant selector.
func NewSelector(db *pgxpool.Pool, profiler *Profiler) *Selector {
	return &Selector{db: db, profiler: profiler}
}

// SelectVariantForStudent determines the best variant for a student on an experiment.
func (s *Selector) SelectVariantForStudent(ctx context.Context, studentID, experimentID string) (*VariantAssignment, error) {
	// 1. Get or build profile
	profile, err := s.profiler.GetProfile(ctx, studentID)
	if err != nil {
		log.Printf("[Selector] Building new profile for student %s", studentID)
		result, buildErr := s.profiler.BuildProfile(ctx, studentID)
		if buildErr != nil {
			return nil, fmt.Errorf("build profile: %w", buildErr)
		}
		profile = &result.Profile
	}

	// 2. Get experiment category
	category, err := s.getExperimentCategory(ctx, experimentID)
	if err != nil {
		return nil, fmt.Errorf("get category: %w", err)
	}

	// 3. Get available variants for this experiment
	variants, err := s.getVariants(ctx, experimentID)
	if err != nil {
		return nil, fmt.Errorf("get variants: %w", err)
	}
	if len(variants) == 0 {
		return nil, fmt.Errorf("no variants available for experiment %s", experimentID)
	}

	// 4. Get student ELO for this category
	studentELO := profile.CategoryELO(category); _ = studentELO

	// 5. Check for AI override conditions
	recentLogs, _ := s.getRecentLogs(ctx, studentID, experimentID, 3)
	if len(recentLogs) >= 3 {
		allFailed := true
		allPerfect := true
		for _, l := range recentLogs {
			if l.ScoreAchieved == nil {
				continue
			}
			if *l.ScoreAchieved > 60 {
				allFailed = false
			}
			if *l.ScoreAchieved < 100 {
				allPerfect = false
			}
		}
		if allFailed {
			// Force downgrade to easiest variant
			return s.forceDifficulty(ctx, studentID, experimentID, variants, "easy", profile,
				"连续3次低分 → 自动降级")
		}
		if allPerfect {
			// Ask AI whether to upgrade (return current for now, flag for AI)
			return s.selectStandard(ctx, studentID, experimentID, variants, profile,
				"连续3次满分 → 建议升级")
		}
	}

	// 6. Standard selection: closest ELO match
	return s.selectStandard(ctx, studentID, experimentID, variants, profile, "")
}

func (s *Selector) selectStandard(ctx context.Context, studentID, experimentID string,
	variants []ExperimentVariant, profile *StudentProfile, reason string) (*VariantAssignment, error) {

	category, _ := s.getExperimentCategory(ctx, experimentID)
	studentELO := profile.CategoryELO(category); _ = studentELO

	best := SelectVariant(variants, studentELO)

	if reason == "" {
		reason = fmt.Sprintf("ELO %.0f 最接近变体难度 %.0f (类别: %s)", studentELO, best.DifficultyScore, category)
	}

	// Log decision
	s.logDecision(ctx, studentID, experimentID, &best.ID, studentELO, best.DifficultyScore, reason, "auto")

	return &VariantAssignment{
		Variant:      best,
		StudentELO:   studentELO,
		DecisionType: "auto",
		Reason:       reason,
	}, nil
}

func (s *Selector) forceDifficulty(ctx context.Context, studentID, experimentID string,
	variants []ExperimentVariant, targetDifficulty string, profile *StudentProfile, reason string) (*VariantAssignment, error) {

	category, _ := s.getExperimentCategory(ctx, experimentID)
	studentELO := profile.CategoryELO(category); _ = studentELO

	var targetVariant ExperimentVariant
	for _, v := range variants {
		if v.DifficultyLevel == targetDifficulty {
			targetVariant = v
			break
		}
	}
	// Fallback to first variant
	if targetVariant.ID == "" {
		targetVariant = variants[0]
	}

	s.logDecision(ctx, studentID, experimentID, &targetVariant.ID, studentELO,
		targetVariant.DifficultyScore, reason, "ai_override")

	return &VariantAssignment{
		Variant:      targetVariant,
		StudentELO:   studentELO,
		DecisionType: "ai_override",
		Reason:       reason,
	}, nil
}

func (s *Selector) getExperimentCategory(ctx context.Context, experimentID string) (string, error) {
	var category string
	err := s.db.QueryRow(ctx, `SELECT category FROM experiments WHERE id = $1`, experimentID).Scan(&category)
	return category, err
}

func (s *Selector) getVariants(ctx context.Context, experimentID string) ([]ExperimentVariant, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, experiment_id, variant_name, difficulty_level, difficulty_score,
			COALESCE(parameters::text::json, '{}'), COALESCE(test_case_ids::text::json, '[]'),
			output_weight, structure_weight, behavior_weight,
			time_limit_override, memory_limit_override, hint_strategy,
			COALESCE(prerequisite::text::json, '{}'), is_active, sort_order
		FROM experiment_variants
		WHERE experiment_id = $1 AND is_active = true
		ORDER BY sort_order ASC, difficulty_score ASC
	`, experimentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var variants []ExperimentVariant
	for rows.Next() {
		var v ExperimentVariant
		var paramsJSON, testCaseJSON, prereqJSON []byte

		if err := rows.Scan(&v.ID, &v.ExperimentID, &v.VariantName, &v.DifficultyLevel,
			&v.DifficultyScore, &paramsJSON, &testCaseJSON,
			&v.OutputWeight, &v.StructureWeight, &v.BehaviorWeight,
			&v.TimeLimitOverride, &v.MemoryLimitOverride, &v.HintStrategy,
			&prereqJSON, &v.IsActive, &v.SortOrder); err != nil {
			return nil, err
		}
		json.Unmarshal(paramsJSON, &v.Parameters)
		json.Unmarshal(testCaseJSON, &v.TestCaseIDs)
		json.Unmarshal(prereqJSON, &v.Prerequisite)
		variants = append(variants, v)
	}
	return variants, nil
}

func (s *Selector) getRecentLogs(ctx context.Context, studentID, experimentID string, limit int) ([]AdaptationLog, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, student_id, experiment_id, selected_variant_id, student_elo, variant_difficulty,
			decision_reason, decision_type, score_achieved, passed_test_cases, total_test_cases
		FROM adaptation_log
		WHERE student_id = $1 AND experiment_id = $2
		ORDER BY created_at DESC LIMIT $3
	`, studentID, experimentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []AdaptationLog
	for rows.Next() {
		var l AdaptationLog
		if err := rows.Scan(&l.ID, &l.StudentID, &l.ExperimentID, &l.SelectedVariantID,
			&l.StudentELO, &l.VariantDifficulty, &l.DecisionReason, &l.DecisionType,
			&l.ScoreAchieved, &l.PassedTestCases, &l.TotalTestCases); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, nil
}

func (s *Selector) logDecision(ctx context.Context, studentID, experimentID string,
	variantID *string, studentELO, variantDiff float64, reason, decisionType string) {

	_, err := s.db.Exec(ctx, `
		INSERT INTO adaptation_log (student_id, experiment_id, selected_variant_id,
			student_elo, variant_difficulty, decision_reason, decision_type)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, studentID, experimentID, variantID, studentELO, variantDiff, reason, decisionType)
	if err != nil {
		log.Printf("[Selector] Failed to log decision: %v", err)
	}
}

// UpdateLogWithResult updates the adaptation log after evaluation completes.
func (s *Selector) UpdateLogWithResult(ctx context.Context, studentID, experimentID string,
	score, passed, total int) error {

	_, err := s.db.Exec(ctx, `
		UPDATE adaptation_log
		SET score_achieved = $1, passed_test_cases = $2, total_test_cases = $3
		WHERE student_id = $4 AND experiment_id = $5 AND score_achieved IS NULL
		ORDER BY created_at DESC LIMIT 1
	`, score, passed, total, studentID, experimentID)
	return err
}
