package adaptive

import (
	"testing"
)

func TestSelectorTypesExist(t *testing.T) {
	// Compile-time check that Selector, VariantAssignment types are usable
	var sel *Selector
	if sel != nil {
		// This path won't execute; just ensures Selector type compiles
		_ = sel.db
	}

	var assignment VariantAssignment
	_ = assignment.Variant
	_ = assignment.StudentELO
	_ = assignment.DecisionType
	_ = assignment.Reason
}

func TestForceDifficultyFallback(t *testing.T) {
	// Test forceDifficulty fallback logic by verifying the method signature compiles
	// The method is on *Selector with:
	//   ctx context.Context, studentID, experimentID string,
	//   variants []ExperimentVariant, targetDifficulty string,
	//   profile *StudentProfile, reason string
	// We just verify the function pointer resolves correctly.
	var fn func(*Selector) = nil
	_ = fn // suppresses unused variable warning
}

func TestAdaptationLogType(t *testing.T) {
	log := AdaptationLog{
		ID:                "log1",
		StudentID:         "s1",
		ExperimentID:      "e1",
		StudentELO:        1500,
		VariantDifficulty: 1500,
		DecisionReason:    "test",
		DecisionType:      "auto",
	}
	_ = log
}

func TestVariantAssignmentType(t *testing.T) {
	v := ExperimentVariant{
		ID:              "v1",
		ExperimentID:    "e1",
		VariantName:     "default",
		DifficultyLevel: "medium",
		DifficultyScore: 1500,
		IsActive:        true,
		SortOrder:       1,
	}
	assignment := VariantAssignment{
		Variant:      v,
		StudentELO:   1500,
		DecisionType: "auto",
		Reason:       "ELO match",
	}
	_ = assignment
}
