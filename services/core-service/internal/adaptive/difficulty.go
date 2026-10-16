package adaptive

import "math"

// ELO constants
const (
	DefaultELO     = 1500.0
	KFactor        = 32.0  // How much each result affects the rating
	KFactorFast    = 48.0  // Higher K for fast learners (first few submissions)
	KFactorSlow    = 16.0  // Lower K for stable profiles
	ELOScaleFactor = 400.0 // Standard ELO scale factor
)

// CategoryELO maps experiment categories to their ELO fields in StudentProfile.
func (p *StudentProfile) CategoryELO(category string) float64 {
	switch category {
	case "process":
		return p.ProcessELO
	case "thread":
		return p.ThreadELO
	case "memory":
		return p.MemoryELO
	case "fs":
		return p.FsELO
	case "scheduler":
		return p.SchedulerELO
	case "deadlock":
		return p.DeadlockELO
	default:
		return DefaultELO
	}
}

// SetCategoryELO updates the ELO for a specific category.
func (p *StudentProfile) SetCategoryELO(category string, value float64) {
	switch category {
	case "process":
		p.ProcessELO = value
	case "thread":
		p.ThreadELO = value
	case "memory":
		p.MemoryELO = value
	case "fs":
		p.FsELO = value
	case "scheduler":
		p.SchedulerELO = value
	case "deadlock":
		p.DeadlockELO = value
	}
}

// ExpectedScore computes the expected score for a student against a variant.
// Standard ELO formula: E = 1 / (1 + 10^((d - θ) / 400))
func ExpectedScore(studentELO, variantDifficulty float64) float64 {
	diff := variantDifficulty - studentELO
	return 1.0 / (1.0 + math.Pow(10, diff/ELOScaleFactor))
}

// UpdateELO computes the new ELO after a submission result.
// θ_new = θ + K × (actualScore - expectedScore)
// actualScore: normalized score (0.0 to 1.0)
// submissionCount: total submissions so far (to adjust K)
func UpdateELO(currentELO float64, variantDifficulty float64, actualScore float64, submissionCount int) float64 {
	expected := ExpectedScore(currentELO, variantDifficulty)

	// Adjust K based on submission count
	k := KFactor
	if submissionCount <= 3 {
		k = KFactorFast // Rapid adjustment for new students
	} else if submissionCount > 20 {
		k = KFactorSlow // Stabilized profile
	}

	newELO := currentELO + k*(actualScore-expected)
	// Clamp to reasonable range
	if newELO < 800 {
		newELO = 800
	}
	if newELO > 2400 {
		newELO = 2400
	}
	return math.Round(newELO*100) / 100
}

// SelectVariant picks the best variant: the one whose difficulty score
// is closest to the student's current ELO (zone of proximal development).
func SelectVariant(variants []ExperimentVariant, studentELO float64) ExperimentVariant {
	if len(variants) == 0 {
		return ExperimentVariant{}
	}

	best := variants[0]
	bestDiff := math.Abs(studentELO - best.DifficultyScore)

	for _, v := range variants[1:] {
		diff := math.Abs(studentELO - v.DifficultyScore)
		if diff < bestDiff {
			bestDiff = diff
			best = v
		}
	}
	return best
}

// DetermineAdaptiveHintStrategy returns the hint strategy to use.
// Students with lower ELO get more generous hints.
func DetermineAdaptiveHintStrategy(studentELO float64) string {
	switch {
	case studentELO < 1200:
		return "generous"
	case studentELO < 1600:
		return "moderate"
	default:
		return "restricted"
	}
}
