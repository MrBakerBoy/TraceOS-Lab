package adaptive

import "time"

// StudentProfile represents a student's learning profile for adaptive difficulty.
type StudentProfile struct {
	ID                      string    `json:"id"`
	StudentID               string    `json:"student_id"`
	ProcessELO              float64   `json:"process_elo"`
	ThreadELO               float64   `json:"thread_elo"`
	MemoryELO               float64   `json:"memory_elo"`
	FsELO                   float64   `json:"fs_elo"`
	SchedulerELO            float64   `json:"scheduler_elo"`
	DeadlockELO             float64   `json:"deadlock_elo"`
	AvgSubmissionsPerExp    float64   `json:"avg_submissions_per_exp"`
	AvgTimeSpentSeconds     float64   `json:"avg_time_spent_seconds"`
	PreferredDifficulty     string    `json:"preferred_difficulty"`
	WeakConcepts            []string  `json:"weak_concepts"`
	MasteredConcepts        []string  `json:"mastered_concepts"`
	LearningPace            string    `json:"learning_pace"`
	LastActivityAt          *time.Time `json:"last_activity_at,omitempty"`
}

// ExperimentVariant represents a difficulty variant of an experiment.
type ExperimentVariant struct {
	ID                  string                 `json:"id"`
	ExperimentID        string                 `json:"experiment_id"`
	VariantName         string                 `json:"variant_name"`
	DifficultyLevel     string                 `json:"difficulty_level"`
	DifficultyScore     float64                `json:"difficulty_score"`
	Parameters          map[string]interface{} `json:"parameters"`
	TestCaseIDs         []string               `json:"test_case_ids"`
	OutputWeight        float64                `json:"output_weight"`
	StructureWeight     float64                `json:"structure_weight"`
	BehaviorWeight      float64                `json:"behavior_weight"`
	TimeLimitOverride   *int                   `json:"time_limit_override,omitempty"`
	MemoryLimitOverride *int64                 `json:"memory_limit_override,omitempty"`
	HintStrategy        string                 `json:"hint_strategy"`
	Prerequisite        map[string]interface{} `json:"prerequisite"`
	IsActive            bool                   `json:"is_active"`
	SortOrder           int                    `json:"sort_order"`
}

// AdaptationLog records an adaptive difficulty decision.
type AdaptationLog struct {
	ID                string  `json:"id"`
	StudentID         string  `json:"student_id"`
	ExperimentID      string  `json:"experiment_id"`
	SelectedVariantID *string `json:"selected_variant_id,omitempty"`
	StudentELO        float64 `json:"student_elo"`
	VariantDifficulty float64 `json:"variant_difficulty"`
	DecisionReason    string  `json:"decision_reason"`
	DecisionType      string  `json:"decision_type"`
	ScoreAchieved     *int    `json:"score_achieved,omitempty"`
	PassedTestCases   *int    `json:"passed_test_cases,omitempty"`
	TotalTestCases    *int    `json:"total_test_cases,omitempty"`
}

// VariantAssignment is the result of adaptive variant selection.
type VariantAssignment struct {
	Variant      ExperimentVariant `json:"variant"`
	StudentELO   float64           `json:"student_elo"`
	DecisionType string            `json:"decision_type"`
	Reason       string            `json:"reason"`
}
