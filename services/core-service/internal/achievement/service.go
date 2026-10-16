package achievement

import (
	"context"
	"time"
)

// Service evaluates achievements against a user's activity and unlocks them.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// Evaluate computes the user's stats and unlocks every newly-satisfied
// achievement. It is idempotent: already-unlocked achievements are skipped.
// It returns the definitions that were newly unlocked by this call.
func (s *Service) Evaluate(ctx context.Context, userID string) ([]Definition, error) {
	if userID == "" {
		return nil, nil
	}
	stats, err := s.repo.ComputeStats(ctx, userID)
	if err != nil {
		return nil, err
	}
	unlocked, err := s.repo.UnlockedIDs(ctx, userID)
	if err != nil {
		return nil, err
	}

	var newly []Definition
	for _, def := range Definitions {
		if _, ok := unlocked[def.ID]; ok {
			continue
		}
		if !satisfied(def.ID, stats) {
			continue
		}
		inserted, err := s.repo.Unlock(ctx, userID, def.ID)
		if err != nil {
			return nil, err
		}
		if inserted {
			newly = append(newly, def)
		}
	}
	return newly, nil
}

// Unlocked returns the user's unlocked achievement IDs mapped to unlock time.
func (s *Service) Unlocked(ctx context.Context, userID string) (map[string]time.Time, error) {
	return s.repo.UnlockedIDs(ctx, userID)
}

// satisfied reports whether a given achievement's condition holds for stats.
func satisfied(id string, s Stats) bool {
	switch id {
	case "first_submission":
		return s.TotalSubmissions >= 1
	case "first_qualified":
		return s.QualifiedSubmissions >= 1
	case "first_try_win":
		return s.FirstTryQualified
	case "submit_10":
		return s.TotalSubmissions >= 10
	case "prolific":
		return s.TotalSubmissions >= 20
	case "submit_50":
		return s.TotalSubmissions >= 50
	case "qualified_5":
		return s.QualifiedSubmissions >= 5
	case "qualified_10":
		return s.QualifiedSubmissions >= 10
	case "perfect_score":
		return s.PerfectScores >= 1
	case "clean_sweep":
		return s.PerfectScores >= 3
	case "edge_master":
		return s.EdgeScoreTotal >= 50
	case "hard_mode":
		return s.HardQualified >= 1
	case "category_3":
		return s.DistinctCategories >= 3
	case "category_all":
		return s.DistinctCategories >= 6
	case "polyglot":
		return s.Languages >= 2
	case "lab_3":
		return s.DistinctExperiments >= 3
	case "lab_10":
		return s.DistinctExperiments >= 10
	case "deadlock_hunter":
		return s.DeadlockFound
	default:
		return false
	}
}
