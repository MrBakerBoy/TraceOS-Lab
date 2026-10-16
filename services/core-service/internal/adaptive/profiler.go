package adaptive

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Profiler builds and updates student learning profiles.
type Profiler struct {
	db *pgxpool.Pool
}

// NewProfiler creates a new profiler.
func NewProfiler(db *pgxpool.Pool) *Profiler {
	return &Profiler{db: db}
}

// ProfileResult holds all computed metrics for a student.
type ProfileResult struct {
	Profile       StudentProfile `json:"profile"`
	TotalSubmissions int         `json:"total_submissions"`
	RecentScores     []int       `json:"recent_scores"`
}

// BuildProfile creates or updates a student's learning profile from historical data.
// Uses parallel goroutines to query multiple data sources concurrently.
func (p *Profiler) BuildProfile(ctx context.Context, studentID string) (*ProfileResult, error) {
	var (
		profile      StudentProfile
		submissions  []submissionSummary
		progresses   []progressSummary
		diagnoses    []diagnosisSummary
		errs         [3]error
		wg           sync.WaitGroup
	)

	// Parallel queries
	wg.Add(3)

	go func() {
		defer wg.Done()
		submissions, errs[0] = p.querySubmissions(ctx, studentID)
	}()

	go func() {
		defer wg.Done()
		progresses, errs[1] = p.queryProgress(ctx, studentID)
	}()

	go func() {
		defer wg.Done()
		diagnoses, errs[2] = p.queryDiagnoses(ctx, studentID)
	}()

	wg.Wait()

	for _, err := range errs {
		if err != nil {
			log.Printf("[Profiler] query error: %v", err)
		}
	}

	// Initialize profile
	profile.StudentID = studentID
	profile.ProcessELO = DefaultELO
	profile.ThreadELO = DefaultELO
	profile.MemoryELO = DefaultELO
	profile.FsELO = DefaultELO
	profile.SchedulerELO = DefaultELO
	profile.DeadlockELO = DefaultELO
	profile.LearningPace = "medium"
	profile.PreferredDifficulty = "medium"

	// Compute ELOS from submissions
	if len(submissions) > 0 {
		p.computeELOs(&profile, submissions)
		profile.AvgSubmissionsPerExp = p.computeAvgSubmissions(submissions)
		profile.AvgTimeSpentSeconds = p.computeAvgTime(progresses)
		profile.LearningPace = p.computeLearningPace(submissions)
		profile.PreferredDifficulty = p.computePreferredDifficulty(profile)
	}

	// Extract weak/mastered concepts from diagnoses
	weak, mastered := p.extractConcepts(diagnoses)
	profile.WeakConcepts = weak
	profile.MasteredConcepts = mastered

	// Save to DB
	if err := p.saveProfile(ctx, &profile); err != nil {
		return nil, fmt.Errorf("save profile: %w", err)
	}

	// Count recent scores
	recentScores := make([]int, 0, len(submissions))
	for _, s := range submissions {
		if s.Score != nil {
			recentScores = append(recentScores, *s.Score)
		}
	}

	return &ProfileResult{
		Profile:         profile,
		TotalSubmissions: len(submissions),
		RecentScores:    recentScores,
	}, nil
}

func (p *Profiler) computeELOs(profile *StudentProfile, submissions []submissionSummary) {
	// Group by category and compute ELO iteratively
	type categoryStats struct {
		elo     float64
		count   int
	}

	stats := make(map[string]*categoryStats)
	categories := []string{"process", "thread", "memory", "fs", "scheduler", "deadlock"}

	// Initialize
	for _, cat := range categories {
		stats[cat] = &categoryStats{elo: DefaultELO, count: 0}
	}

	// Process each submission chronologically
	for _, s := range submissions {
		st, ok := stats[s.Category]
		if !ok {
			continue
		}
		actualScore := 0.0
		if s.Score != nil && s.TotalScore != nil && *s.TotalScore > 0 {
			actualScore = float64(*s.Score) / float64(*s.TotalScore)
		} else if s.Score != nil {
			actualScore = float64(*s.Score) / 100.0
		}
		if actualScore > 1.0 {
			actualScore = 1.0
		}
		if actualScore < 0.0 {
			actualScore = 0.0
		}
		st.elo = UpdateELO(st.elo, DefaultELO, actualScore, st.count)
		st.count++
	}

	profile.ProcessELO = stats["process"].elo
	profile.ThreadELO = stats["thread"].elo
	profile.MemoryELO = stats["memory"].elo
	profile.FsELO = stats["fs"].elo
	profile.SchedulerELO = stats["scheduler"].elo
	profile.DeadlockELO = stats["deadlock"].elo
}

func (p *Profiler) computeAvgSubmissions(submissions []submissionSummary) float64 {
	if len(submissions) == 0 {
		return 0
	}
	// Count unique experiments
	expSet := make(map[string]int)
	for _, s := range submissions {
		expSet[s.ExperimentID]++
	}
	if len(expSet) == 0 {
		return 0
	}
	total := 0
	for _, count := range expSet {
		total += count
	}
	return float64(total) / float64(len(expSet))
}

func (p *Profiler) computeAvgTime(progresses []progressSummary) float64 {
	if len(progresses) == 0 {
		return 0
	}
	var total int64
	for _, pg := range progresses {
		total += int64(pg.TimeSpent)
	}
	return float64(total) / float64(len(progresses))
}

func (p *Profiler) computeLearningPace(submissions []submissionSummary) string {
	if len(submissions) < 3 {
		return "medium"
	}
	avgSubmissions := p.computeAvgSubmissions(submissions)
	switch {
	case avgSubmissions <= 2:
		return "fast"
	case avgSubmissions <= 5:
		return "medium"
	default:
		return "slow"
	}
}

func (p *Profiler) computePreferredDifficulty(profile StudentProfile) string {
	avg := (profile.ProcessELO + profile.ThreadELO + profile.MemoryELO +
		profile.FsELO + profile.SchedulerELO + profile.DeadlockELO) / 6.0
	switch {
	case avg < 1200:
		return "easy"
	case avg < 1700:
		return "medium"
	default:
		return "hard"
	}
}

func (p *Profiler) extractConcepts(diagnoses []diagnosisSummary) (weak, mastered []string) {
	weakCount := make(map[string]int)
	for _, d := range diagnoses {
		var concepts []string
		if d.RelatedConcepts != nil {
			json.Unmarshal(d.RelatedConcepts, &concepts)
		}
		for _, c := range concepts {
			weakCount[c]++
		}
	}
	// Top 5 most common = weak
	type kv struct {
		k string
		v int
	}
	var sorted []kv
	for k, v := range weakCount {
		sorted = append(sorted, kv{k, v})
	}
	// Simple sort by count descending
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].v > sorted[i].v {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	for i, item := range sorted {
		if i < 5 {
			weak = append(weak, item.k)
		}
	}
	return weak, mastered // mastered requires positive diagnoses — left empty for now
}

type submissionSummary struct {
	ExperimentID string `json:"experiment_id"`
	Category     string `json:"category"`
	Score        *int   `json:"score"`
	TotalScore   *int   `json:"total_score"`
	CreatedAt    time.Time `json:"created_at"`
}

type progressSummary struct {
	TimeSpent int `json:"time_spent"`
}

type diagnosisSummary struct {
	RelatedConcepts json.RawMessage `json:"related_concepts"`
}

func (p *Profiler) querySubmissions(ctx context.Context, studentID string) ([]submissionSummary, error) {
	rows, err := p.db.Query(ctx, `
		SELECT s.experiment_id, COALESCE(e.category, 'process'), s.score, s.total_score, s.created_at
		FROM submissions s
		LEFT JOIN experiments e ON s.experiment_id = e.id
		WHERE s.student_id = $1
		ORDER BY s.created_at ASC
	`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []submissionSummary
	for rows.Next() {
		var s submissionSummary
		if err := rows.Scan(&s.ExperimentID, &s.Category, &s.Score, &s.TotalScore, &s.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, nil
}

func (p *Profiler) queryProgress(ctx context.Context, studentID string) ([]progressSummary, error) {
	rows, err := p.db.Query(ctx, `
		SELECT COALESCE(time_spent, 0) FROM student_progress WHERE student_id = $1
	`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []progressSummary
	for rows.Next() {
		var pg progressSummary
		if err := rows.Scan(&pg.TimeSpent); err != nil {
			return nil, err
		}
		result = append(result, pg)
	}
	return result, nil
}

func (p *Profiler) queryDiagnoses(ctx context.Context, studentID string) ([]diagnosisSummary, error) {
	rows, err := p.db.Query(ctx, `
		SELECT COALESCE(related_concepts::text::json, '[]') FROM diagnoses WHERE student_id = $1
	`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []diagnosisSummary
	for rows.Next() {
		var d diagnosisSummary
		if err := rows.Scan(&d.RelatedConcepts); err != nil {
			return nil, err
		}
		result = append(result, d)
	}
	return result, nil
}

func (p *Profiler) saveProfile(ctx context.Context, profile *StudentProfile) error {
	weakJSON, _ := json.Marshal(profile.WeakConcepts)
	masteredJSON, _ := json.Marshal(profile.MasteredConcepts)

	_, err := p.db.Exec(ctx, `
		INSERT INTO student_profiles (student_id, process_elo, thread_elo, memory_elo, fs_elo, scheduler_elo, deadlock_elo,
			avg_submissions_per_exp, avg_time_spent_seconds, preferred_difficulty, weak_concepts, mastered_concepts,
			learning_pace, last_activity_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
		ON CONFLICT (student_id) DO UPDATE SET
			process_elo = EXCLUDED.process_elo,
			thread_elo = EXCLUDED.thread_elo,
			memory_elo = EXCLUDED.memory_elo,
			fs_elo = EXCLUDED.fs_elo,
			scheduler_elo = EXCLUDED.scheduler_elo,
			deadlock_elo = EXCLUDED.deadlock_elo,
			avg_submissions_per_exp = EXCLUDED.avg_submissions_per_exp,
			avg_time_spent_seconds = EXCLUDED.avg_time_spent_seconds,
			preferred_difficulty = EXCLUDED.preferred_difficulty,
			weak_concepts = EXCLUDED.weak_concepts,
			mastered_concepts = EXCLUDED.mastered_concepts,
			learning_pace = EXCLUDED.learning_pace,
			last_activity_at = NOW(),
			updated_at = NOW()
	`, profile.StudentID, profile.ProcessELO, profile.ThreadELO, profile.MemoryELO,
		profile.FsELO, profile.SchedulerELO, profile.DeadlockELO,
		profile.AvgSubmissionsPerExp, profile.AvgTimeSpentSeconds,
		profile.PreferredDifficulty, weakJSON, masteredJSON,
		profile.LearningPace)
	return err
}

// GetProfile retrieves an existing profile from DB.
func (p *Profiler) GetProfile(ctx context.Context, studentID string) (*StudentProfile, error) {
	var profile StudentProfile
	var weakJSON, masteredJSON []byte

	err := p.db.QueryRow(ctx, `
		SELECT id, student_id, process_elo, thread_elo, memory_elo, fs_elo, scheduler_elo, deadlock_elo,
			avg_submissions_per_exp, avg_time_spent_seconds, preferred_difficulty,
			COALESCE(weak_concepts::text::json, '[]'), COALESCE(mastered_concepts::text::json, '[]'),
			learning_pace, last_activity_at
		FROM student_profiles WHERE student_id = $1
	`, studentID).Scan(
		&profile.ID, &profile.StudentID,
		&profile.ProcessELO, &profile.ThreadELO, &profile.MemoryELO,
		&profile.FsELO, &profile.SchedulerELO, &profile.DeadlockELO,
		&profile.AvgSubmissionsPerExp, &profile.AvgTimeSpentSeconds,
		&profile.PreferredDifficulty, &weakJSON, &masteredJSON,
		&profile.LearningPace, &profile.LastActivityAt,
	)
	if err != nil {
		return nil, err
	}

	json.Unmarshal(weakJSON, &profile.WeakConcepts)
	json.Unmarshal(masteredJSON, &profile.MasteredConcepts)
	return &profile, nil
}

// UpdateAfterSubmission updates the profile after a new submission result.
func (p *Profiler) UpdateAfterSubmission(ctx context.Context, studentID, category string, score, totalScore int) error {
	profile, err := p.GetProfile(ctx, studentID)
	if err != nil {
		// No profile yet — build one
		_, err := p.BuildProfile(ctx, studentID)
		return err
	}

	actualScore := 0.0
	if totalScore > 0 {
		actualScore = float64(score) / float64(totalScore)
	} else {
		actualScore = float64(score) / 100.0
	}
	if actualScore > 1.0 {
		actualScore = 1.0
	}

	submissionCount := int(profile.AvgSubmissionsPerExp + 1) // approximate
	newELO := UpdateELO(profile.CategoryELO(category), DefaultELO, actualScore, submissionCount)
	profile.SetCategoryELO(category, newELO)

	return p.saveProfile(ctx, profile)
}
// RecommendedExperiment is returned by RecommendNext.
type RecommendedExperiment struct {
	ExperimentID string  `json:"experiment_id"`
	Title        string  `json:"title"`
	Category     string  `json:"category"`
	Difficulty   string  `json:"difficulty"`
	StudentELO   float64 `json:"student_elo"`
	Reason       string  `json:"reason"`
	Priority     int     `json:"priority"` // 1=recommended, 2=suggested, 3=review
}

// RecommendNext returns experiments suggested for the student.
func (p *Profiler) RecommendNext(ctx context.Context, studentID string) ([]RecommendedExperiment, error) {
	profile, err := p.GetProfile(ctx, studentID)
	if err != nil {
		// No profile yet — build one
		result, buildErr := p.BuildProfile(ctx, studentID)
		if buildErr != nil {
			return nil, fmt.Errorf("build profile: %w", buildErr)
		}
		profile = &result.Profile
	}

	// Find weakest category by ELO
	eloMap := map[string]float64{
		"process": profile.ProcessELO, "thread": profile.ThreadELO,
		"memory": profile.MemoryELO, "fs": profile.FsELO,
		"scheduler": profile.SchedulerELO, "deadlock": profile.DeadlockELO,
	}

	var weakestCat string
	weakestELO := 9999.0
	for cat, elo := range eloMap {
		if elo < weakestELO {
			weakestELO = elo
			weakestCat = cat
		}
	}

	// Query uncompleted experiments in weakest category, ordered by difficulty (easy first)
	rows, err := p.db.Query(ctx, `SELECT e.id, e.title, e.category, e.difficulty, e.sort_order FROM experiments e WHERE e.category = $1 AND e.is_published = true AND e.id NOT IN (SELECT sp.experiment_id FROM student_progress sp WHERE sp.student_id = $2 AND sp.best_score >= 60) ORDER BY CASE e.difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 WHEN 'hard' THEN 3 END, e.sort_order LIMIT 3`, weakestCat, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var recommendations []RecommendedExperiment
	for rows.Next() {
		var rec RecommendedExperiment
		var sortOrder int
		if rows.Scan(&rec.ExperimentID, &rec.Title, &rec.Category, &rec.Difficulty, &sortOrder) == nil {
			rec.StudentELO = eloMap[rec.Category]
			rec.Reason = fmt.Sprintf("你%s方面（ELO %.0f）较弱，建议从该实验开始", categoryLabel(rec.Category), rec.StudentELO)
			rec.Priority = 1
			recommendations = append(recommendations, rec)
		}
	}

	// Also suggest review for passed experiments where ELO is below threshold
	reviewRows, err := p.db.Query(ctx, `SELECT e.id, e.title, e.category, e.difficulty, e.sort_order FROM experiments e JOIN student_progress sp ON sp.experiment_id = e.id AND sp.student_id = $1 WHERE sp.best_score >= 60 AND sp.best_score < 80 ORDER BY sp.best_score ASC LIMIT 2`, studentID)
	if err == nil {
		defer reviewRows.Close()
		for reviewRows.Next() {
			var rec RecommendedExperiment
			var sortOrder int
			if reviewRows.Scan(&rec.ExperimentID, &rec.Title, &rec.Category, &rec.Difficulty, &sortOrder) == nil {
				rec.StudentELO = eloMap[rec.Category]
				rec.Reason = "已通过但分数不够高，建议巩固复习"
				rec.Priority = 3
				recommendations = append(recommendations, rec)
			}
		}
	}

	if recommendations == nil {
		recommendations = []RecommendedExperiment{}
	}
	return recommendations, nil
}

func categoryLabel(cat string) string {
	switch cat {
	case "process":
		return "进程管理"
	case "thread":
		return "线程同步"
	case "memory":
		return "内存管理"
	case "fs":
		return "文件系统"
	case "scheduler":
		return "处理机调度"
	case "deadlock":
		return "死锁"
	default:
		return cat
	}
}
