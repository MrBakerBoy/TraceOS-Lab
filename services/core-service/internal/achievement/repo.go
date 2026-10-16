package achievement

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository reads/writes achievement data from PostgreSQL.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// Stats is the snapshot of a user's activity used to evaluate achievements.
type Stats struct {
	TotalSubmissions    int
	QualifiedSubmissions int
	DistinctExperiments int
	DistinctCategories  int
	PerfectScores       int
	EdgeScoreTotal      int
	Languages           int
	HardQualified       int
	FirstTryQualified   bool
	DeadlockFound       bool
}

// ComputeStats aggregates a user's submission history into an evaluation snapshot.
func (r *Repository) ComputeStats(ctx context.Context, userID string) (Stats, error) {
	var s Stats

	err := r.db.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE is_qualified),
			COUNT(*) FILTER (WHERE status = 'completed'
				AND total_score IS NOT NULL AND total_score > 0
				AND score IS NOT NULL AND score = total_score),
			COALESCE(SUM(COALESCE(edge_score, 0)), 0),
			COUNT(DISTINCT language)
		FROM submissions
		WHERE student_id = $1
	`, userID).Scan(&s.TotalSubmissions, &s.QualifiedSubmissions, &s.PerfectScores, &s.EdgeScoreTotal, &s.Languages)
	if err != nil {
		return s, err
	}

	err = r.db.QueryRow(ctx, `
		SELECT
			COUNT(DISTINCT s.experiment_id),
			COUNT(DISTINCT e.category),
			COUNT(*) FILTER (WHERE s.is_qualified AND e.difficulty = 'hard')
		FROM submissions s
		JOIN experiments e ON e.id = s.experiment_id
		WHERE s.student_id = $1
	`, userID).Scan(&s.DistinctExperiments, &s.DistinctCategories, &s.HardQualified)
	if err != nil {
		return s, err
	}

	err = r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM submissions
			WHERE student_id = $1 AND submission_number = 1 AND is_qualified
		)
	`, userID).Scan(&s.FirstTryQualified)
	if err != nil {
		return s, err
	}

	err = r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM deadlock_reports dr
			JOIN submissions s ON s.id = dr.submission_id
			WHERE s.student_id = $1 AND dr.detected
		)
	`, userID).Scan(&s.DeadlockFound)
	if err != nil {
		return s, err
	}

	return s, nil
}

// UnlockedIDs returns the set of achievement IDs a user has already unlocked,
// mapped to the time they were unlocked.
func (r *Repository) UnlockedIDs(ctx context.Context, userID string) (map[string]time.Time, error) {
	rows, err := r.db.Query(ctx, `
		SELECT achievement_id, unlocked_at
		FROM user_achievements
		WHERE user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]time.Time)
	for rows.Next() {
		var id string
		var at time.Time
		if err := rows.Scan(&id, &at); err != nil {
			return nil, err
		}
		out[id] = at
	}
	return out, rows.Err()
}

// Unlock inserts an unlock record, ignoring duplicates. It returns true when a
// new row was inserted (i.e. the achievement was not already unlocked).
func (r *Repository) Unlock(ctx context.Context, userID, achievementID string) (bool, error) {
	ct, err := r.db.Exec(ctx, `
		INSERT INTO user_achievements (user_id, achievement_id)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING
	`, userID, achievementID)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() > 0, nil
}
