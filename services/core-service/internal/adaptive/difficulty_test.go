package adaptive

import (
	"math"
	"testing"
)

func TestExpectedScore(t *testing.T) {
	tests := []struct {
		name          string
		studentELO    float64
		variantDiff   float64
		expectedRange [2]float64 // [min, max]
		exactValue    float64    // non-zero means exact match
	}{
		{
			name:          "equal ELO → 0.5",
			studentELO:    1500,
			variantDiff:   1500,
			expectedRange: [2]float64{0.49, 0.51},
			exactValue:    0.5,
		},
		{
			name:          "student stronger → >0.5",
			studentELO:    1600,
			variantDiff:   1500,
			expectedRange: [2]float64{0.5, 1.0},
		},
		{
			name:          "student weaker → <0.5",
			studentELO:    1400,
			variantDiff:   1500,
			expectedRange: [2]float64{0.0, 0.5},
		},
		{
			name:          "ELO diff 400 → ~0.09",
			studentELO:    1100,
			variantDiff:   1500,
			expectedRange: [2]float64{0.08, 0.10},
			exactValue:    0.0909,
		},
		{
			name:          "ELO diff -400 → ~0.91",
			studentELO:    1900,
			variantDiff:   1500,
			expectedRange: [2]float64{0.90, 0.92},
			exactValue:    0.9091,
		},
		{
			name:          "strong student, high difficulty",
			studentELO:    2400,
			variantDiff:   2400,
			expectedRange: [2]float64{0.49, 0.51},
			exactValue:    0.5,
		},
		{
			name:          "weak student, low difficulty",
			studentELO:    800,
			variantDiff:   800,
			expectedRange: [2]float64{0.49, 0.51},
			exactValue:    0.5,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ExpectedScore(tt.studentELO, tt.variantDiff)
			if tt.exactValue != 0 {
				tolerance := 0.001
				if math.Abs(got-tt.exactValue) > tolerance {
					t.Errorf("ExpectedScore(%g, %g) = %g, want ~%g (±%g)",
						tt.studentELO, tt.variantDiff, got, tt.exactValue, tolerance)
				}
			}
			if got < tt.expectedRange[0] || got > tt.expectedRange[1] {
				t.Errorf("ExpectedScore(%g, %g) = %g, expected range [%g, %g]",
					tt.studentELO, tt.variantDiff, got, tt.expectedRange[0], tt.expectedRange[1])
			}
		})
	}
}

func TestUpdateELO(t *testing.T) {
	tests := []struct {
		name             string
		currentELO       float64
		variantDiff      float64
		actualScore      float64
		submissionCount  int
		expectedIncrease bool    // should increase
		expectedDecrease bool    // should decrease
		expectedExact    float64 // exact after rounding
	}{
		{
			name:             "perfect score → ELO rises",
			currentELO:       1500,
			variantDiff:      1500,
			actualScore:      1.0,
			submissionCount:  10,
			expectedIncrease: true,
			expectedExact:    1516.0, // 1500 + 32*(1.0-0.5) = 1516
		},
		{
			name:             "zero score → ELO falls",
			currentELO:       1500,
			variantDiff:      1500,
			actualScore:      0.0,
			submissionCount:  10,
			expectedDecrease: true,
			expectedExact:    1484.0, // 1500 + 32*(0.0-0.5) = 1484
		},
		{
			name:             "K fast for new student (≤3 subs)",
			currentELO:       1500,
			variantDiff:      1500,
			actualScore:      1.0,
			submissionCount:  2,
			expectedIncrease: true,
			expectedExact:    1524.0, // 1500 + 48*(1.0-0.5) = 1524
		},
		{
			name:             "K slow for veteran (>20 subs)",
			currentELO:       1500,
			variantDiff:      1500,
			actualScore:      1.0,
			submissionCount:  25,
			expectedIncrease: true,
			expectedExact:    1508.0, // 1500 + 16*(1.0-0.5) = 1508
		},
		{
			name:             "K factor edge: exactly 3 subs uses fast",
			currentELO:       1500,
			variantDiff:      1500,
			actualScore:      0.5,
			submissionCount:  3,
			expectedExact:    1500.0, // 1500 + 48*(0.5-0.5) = 1500
		},
		{
			name:             "K factor edge: 4 subs uses default",
			currentELO:       1500,
			variantDiff:      1500,
			actualScore:      0.5,
			submissionCount:  4,
			expectedExact:    1500.0, // 1500 + 32*(0.5-0.5) = 1500
		},
		{
			name:             "K factor edge: exactly 20 subs uses default",
			currentELO:       1500,
			variantDiff:      1500,
			actualScore:      1.0,
			submissionCount:  20,
			expectedIncrease: true,
			expectedExact:    1516.0, // 1500 + 32*(1.0-0.5) = 1516
		},
		{
			name:             "K factor: 21 subs uses slow",
			currentELO:       1500,
			variantDiff:      1500,
			actualScore:      1.0,
			submissionCount:  21,
			expectedIncrease: true,
			expectedExact:    1508.0, // 1500 + 16*(1.0-0.5) = 1508
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := UpdateELO(tt.currentELO, tt.variantDiff, tt.actualScore, tt.submissionCount)
			if tt.expectedIncrease && got <= tt.currentELO {
				t.Errorf("UpdateELO(%g, %g, %g, %d) = %g, expected > %g",
					tt.currentELO, tt.variantDiff, tt.actualScore, tt.submissionCount, got, tt.currentELO)
			}
			if tt.expectedDecrease && got >= tt.currentELO {
				t.Errorf("UpdateELO(%g, %g, %g, %d) = %g, expected < %g",
					tt.currentELO, tt.variantDiff, tt.actualScore, tt.submissionCount, got, tt.currentELO)
			}
			if tt.expectedExact != 0 && got != tt.expectedExact {
				t.Errorf("UpdateELO(%g, %g, %g, %d) = %g, want %g",
					tt.currentELO, tt.variantDiff, tt.actualScore, tt.submissionCount, got, tt.expectedExact)
			}
		})
	}
}

func TestUpdateELOClamping(t *testing.T) {
	// Verify ELO never goes below 800 or above 2400 for any inputs.
	// The clamping logic exists in the code; test boundary conditions.
	inputs := []struct {
		currentELO      float64
		variantDiff     float64
		actualScore     float64
		submissionCount int
	}{
		// Try to push below 800
		{800, 2400, 0, 1},
		{800, 2400, 0, 10},
		{810, 2400, 0, 1},
		// Try to push above 2400
		{2400, 800, 1, 1},
		{2400, 800, 1, 10},
		{2390, 800, 1, 1},
		// Extreme values
		{500, 3000, 0, 1},
		{3000, 500, 1, 1},
	}

	for _, in := range inputs {
		result := UpdateELO(in.currentELO, in.variantDiff, in.actualScore, in.submissionCount)
		if result < 800 {
			t.Errorf("UpdateELO(%g, %g, %g, %d) = %g, should be ≥ 800",
				in.currentELO, in.variantDiff, in.actualScore, in.submissionCount, result)
		}
		if result > 2400 {
			t.Errorf("UpdateELO(%g, %g, %g, %d) = %g, should be ≤ 2400",
				in.currentELO, in.variantDiff, in.actualScore, in.submissionCount, result)
		}
	}
}

func TestSelectVariant(t *testing.T) {
	variants := []ExperimentVariant{
		{ID: "v1", DifficultyScore: 1000, VariantName: "easy"},
		{ID: "v2", DifficultyScore: 1400, VariantName: "mid-low"},
		{ID: "v3", DifficultyScore: 1600, VariantName: "mid-high"},
		{ID: "v4", DifficultyScore: 2000, VariantName: "hard"},
	}

	tests := []struct {
		name       string
		studentELO float64
		wantID     string
	}{
		{"ELO 900 → v1", 900, "v1"},
		{"ELO 1350 → v2", 1350, "v2"},
		{"ELO 1550 → v3", 1550, "v3"},
		{"ELO 2100 → v4", 2100, "v4"},
		// At ELO 1200: |1200-1000|=200, |1200-1400|=200 — tie, first wins (v1)
		{"ELO 1200 tie → v1 (first match wins)", 1200, "v1"},
		{"ELO 1199 → v1 (closer to 1000 than 1400)", 1199, "v1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SelectVariant(variants, tt.studentELO)
			if got.ID != tt.wantID {
				t.Errorf("SelectVariant(..., %g) = %s, want %s",
					tt.studentELO, got.ID, tt.wantID)
			}
		})
	}
}

func TestSelectVariantEmpty(t *testing.T) {
	got := SelectVariant([]ExperimentVariant{}, 1500)
	if got.ID != "" || got.VariantName != "" {
		t.Errorf("SelectVariant(empty, 1500) should return zero variant, got %+v", got)
	}
}

func TestDetermineAdaptiveHintStrategy(t *testing.T) {
	tests := []struct {
		name       string
		studentELO float64
		want       string
	}{
		{"low ELO 800 → generous", 800, "generous"},
		{"low ELO 1199 → generous", 1199, "generous"},
		{"edge 1200 → moderate", 1200, "moderate"},
		{"mid ELO 1400 → moderate", 1400, "moderate"},
		{"edge 1599 → moderate", 1599, "moderate"},
		{"edge 1600 → restricted", 1600, "restricted"},
		{"high ELO 2000 → restricted", 2000, "restricted"},
		{"high ELO 2400 → restricted", 2400, "restricted"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := DetermineAdaptiveHintStrategy(tt.studentELO)
			if got != tt.want {
				t.Errorf("DetermineAdaptiveHintStrategy(%g) = %q, want %q",
					tt.studentELO, got, tt.want)
			}
		})
	}
}

func TestCategoryELO(t *testing.T) {
	p := &StudentProfile{
		ProcessELO:   1400,
		ThreadELO:    1450,
		MemoryELO:    1300,
		FsELO:        1550,
		SchedulerELO: 1200,
		DeadlockELO:  1100,
	}

	tests := []struct {
		category string
		want     float64
	}{
		{"process", 1400},
		{"thread", 1450},
		{"memory", 1300},
		{"fs", 1550},
		{"scheduler", 1200},
		{"deadlock", 1100},
		{"unknown", DefaultELO},
	}

	for _, tt := range tests {
		t.Run("category:"+tt.category, func(t *testing.T) {
			got := p.CategoryELO(tt.category)
			if got != tt.want {
				t.Errorf("CategoryELO(%q) = %g, want %g", tt.category, got, tt.want)
			}
		})
	}
}

func TestSetCategoryELO(t *testing.T) {
	p := &StudentProfile{}
	p.SetCategoryELO("process", 1234)
	if p.ProcessELO != 1234 {
		t.Errorf("SetCategoryELO(process, 1234): got %g", p.ProcessELO)
	}
	p.SetCategoryELO("thread", 567)
	if p.ThreadELO != 567 {
		t.Errorf("SetCategoryELO(thread, 567): got %g", p.ThreadELO)
	}
	// invalid category should not panic
	p.SetCategoryELO("nonexistent", 999)
}
