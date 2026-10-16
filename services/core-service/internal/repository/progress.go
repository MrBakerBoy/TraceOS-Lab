package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/model"
)

type ProgressRepo struct {
	db *pgxpool.Pool
}

func NewProgressRepo(db *pgxpool.Pool) *ProgressRepo {
	return &ProgressRepo{db: db}
}

func (r *ProgressRepo) Get(ctx context.Context, studentID, experimentID string) (*model.StudentProgress, error) {
	p := &model.StudentProgress{}
	err := r.db.QueryRow(ctx, `
		SELECT id, student_id, experiment_id, best_score, total_submissions,
		       first_submission_at, last_submission_at, time_spent
		FROM student_progress WHERE student_id = $1 AND experiment_id = $2
	`, studentID, experimentID).Scan(&p.ID, &p.StudentID, &p.ExperimentID,
		&p.BestScore, &p.TotalSubmissions, &p.FirstSubmissionAt, &p.LastSubmissionAt, &p.TimeSpent)
	if err != nil {
		return nil, err
	}
	return p, nil
}

func (r *ProgressRepo) GetByStudent(ctx context.Context, studentID string) ([]model.StudentProgress, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, student_id, experiment_id, best_score, total_submissions,
		       first_submission_at, last_submission_at, time_spent
		FROM student_progress WHERE student_id = $1
		ORDER BY last_submission_at DESC NULLS LAST
	`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var progress []model.StudentProgress
	for rows.Next() {
		var p model.StudentProgress
		if err := rows.Scan(&p.ID, &p.StudentID, &p.ExperimentID,
			&p.BestScore, &p.TotalSubmissions, &p.FirstSubmissionAt, &p.LastSubmissionAt, &p.TimeSpent); err != nil {
			return nil, err
		}
		progress = append(progress, p)
	}
	return progress, nil
}

// ProgressWithDetails includes student and experiment info for teacher/admin views.
type ProgressWithDetails struct {
	model.StudentProgress
	StudentName     string  `json:"student_name"`
	StudentUsername string  `json:"student_username"`
	ExperimentTitle string  `json:"experiment_title"`
	CourseID        *string `json:"course_id,omitempty"`
	CourseName      *string `json:"course_name,omitempty"`
}

// GetByCourse returns progress for all students in a course, with student names.
func (r *ProgressRepo) GetByCourse(ctx context.Context, courseID string) ([]ProgressWithDetails, error) {
	rows, err := r.db.Query(ctx, `
		SELECT sp.id, sp.student_id, sp.experiment_id, sp.best_score, sp.total_submissions,
		       sp.first_submission_at, sp.last_submission_at, sp.time_spent,
		       COALESCE(u.full_name, u.username) AS student_name,
		       u.username AS student_username,
		       e.title AS experiment_title,
		       c.id AS course_id, c.name AS course_name
		FROM student_progress sp
		LEFT JOIN course_enrollments ce ON ce.student_id = sp.student_id AND ce.course_id = $1
		JOIN users u ON u.id = sp.student_id
		JOIN experiments e ON e.id = sp.experiment_id
		JOIN courses c ON c.id = $1
		ORDER BY c.name, u.username, e.title
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ProgressWithDetails
	for rows.Next() {
		var p ProgressWithDetails
		if err := rows.Scan(&p.ID, &p.StudentID, &p.ExperimentID, &p.BestScore, &p.TotalSubmissions,
			&p.FirstSubmissionAt, &p.LastSubmissionAt, &p.TimeSpent,
			&p.StudentName, &p.StudentUsername, &p.ExperimentTitle,
			&p.CourseID, &p.CourseName); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, nil
}

// GetByTeacher returns progress for all students in all courses taught by a teacher.
func (r *ProgressRepo) GetByTeacher(ctx context.Context, teacherID string) ([]ProgressWithDetails, error) {
	rows, err := r.db.Query(ctx, `
		SELECT sp.id, sp.student_id, sp.experiment_id, sp.best_score, sp.total_submissions,
		       sp.first_submission_at, sp.last_submission_at, sp.time_spent,
		       COALESCE(u.full_name, u.username) AS student_name,
		       u.username AS student_username,
		       e.title AS experiment_title,
		       c.id AS course_id, c.name AS course_name
		FROM student_progress sp
		LEFT JOIN course_enrollments ce ON ce.student_id = sp.student_id
		JOIN courses c ON c.id = ce.course_id AND c.teacher_id = $1
		JOIN users u ON u.id = sp.student_id
		JOIN experiments e ON e.id = sp.experiment_id
		ORDER BY c.name, u.username, e.title
	`, teacherID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ProgressWithDetails
	for rows.Next() {
		var p ProgressWithDetails
		if err := rows.Scan(&p.ID, &p.StudentID, &p.ExperimentID, &p.BestScore, &p.TotalSubmissions,
			&p.FirstSubmissionAt, &p.LastSubmissionAt, &p.TimeSpent,
			&p.StudentName, &p.StudentUsername, &p.ExperimentTitle,
			&p.CourseID, &p.CourseName); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, nil
}

// GetAll returns all progress records (admin only).
func (r *ProgressRepo) GetAll(ctx context.Context) ([]ProgressWithDetails, error) {
	rows, err := r.db.Query(ctx, `
		SELECT sp.id, sp.student_id, sp.experiment_id, sp.best_score, sp.total_submissions,
		       sp.first_submission_at, sp.last_submission_at, sp.time_spent,
		       COALESCE(u.full_name, u.username) AS student_name,
		       u.username AS student_username,
		       e.title AS experiment_title,
		       c.id AS course_id, c.name AS course_name
		FROM student_progress sp
		JOIN users u ON u.id = sp.student_id
		JOIN experiments e ON e.id = sp.experiment_id
		LEFT JOIN course_enrollments ce ON ce.student_id = sp.student_id
		LEFT JOIN courses c ON c.id = ce.course_id
		ORDER BY c.name, u.username, e.title
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ProgressWithDetails
	for rows.Next() {
		var p ProgressWithDetails
		if err := rows.Scan(&p.ID, &p.StudentID, &p.ExperimentID, &p.BestScore, &p.TotalSubmissions,
			&p.FirstSubmissionAt, &p.LastSubmissionAt, &p.TimeSpent,
			&p.StudentName, &p.StudentUsername, &p.ExperimentTitle,
			&p.CourseID, &p.CourseName); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, nil
}

// GetProgressWithSubmissionStatus returns per-student, per-experiment progress
// grouped by course, suitable for the teacher/admin progress dashboard.
type CourseProgress struct {
	CourseID      string             `json:"course_id"`
	CourseName    string             `json:"course_name"`
	StudentProgress []StudentExpProgress `json:"students"`
}

type StudentExpProgress struct {
	StudentID        string  `json:"student_id"`
	StudentName      string  `json:"student_name"`
	StudentUsername   string  `json:"student_username"`
	ExperimentID     string  `json:"experiment_id"`
	ExperimentTitle  string  `json:"experiment_title"`
	BestScore        int     `json:"best_score"`
	TotalSubmissions int     `json:"total_submissions"`
	LastSubmissionAt *time.Time `json:"last_submission_at,omitempty"`
}

// GetGroupedByCourses returns progress grouped by course → student → experiment.
func (r *ProgressRepo) GetGroupedByCourses(ctx context.Context, teacherID *string) ([]CourseProgress, error) {
	var args []interface{}
	whereClause := ""
	if teacherID != nil {
		whereClause = " AND c.teacher_id = $1"
		args = append(args, *teacherID)
	}

	rows, err := r.db.Query(ctx, fmt.Sprintf(`
		SELECT c.id AS course_id, c.name AS course_name,
		       sp.student_id,
		       COALESCE(u.full_name, u.username) AS student_name,
		       u.username AS student_username,
		       sp.experiment_id,
		       e.title AS experiment_title,
		       sp.best_score, sp.total_submissions, sp.last_submission_at
		FROM student_progress sp
		LEFT JOIN course_enrollments ce ON ce.student_id = sp.student_id
		JOIN courses c ON c.id = ce.course_id
		JOIN users u ON u.id = sp.student_id
		JOIN experiments e ON e.id = sp.experiment_id
		WHERE 1=1 %s
		ORDER BY c.name, u.username, e.title
	`, whereClause), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	courseMap := make(map[string]*CourseProgress)
	var courseOrder []string

	for rows.Next() {
		var courseID, courseName, studentID, studentName, studentUsername, expID, expTitle string
		var bestScore, totalSubs int
		var lastSub *time.Time
		if err := rows.Scan(&courseID, &courseName, &studentID, &studentName, &studentUsername,
			&expID, &expTitle, &bestScore, &totalSubs, &lastSub); err != nil {
			return nil, err
		}

		cp, ok := courseMap[courseID]
		if !ok {
			cp = &CourseProgress{
				CourseID:   courseID,
				CourseName: courseName,
			}
			courseMap[courseID] = cp
			courseOrder = append(courseOrder, courseID)
		}

		cp.StudentProgress = append(cp.StudentProgress, StudentExpProgress{
			StudentID:        studentID,
			StudentName:      studentName,
			StudentUsername:   studentUsername,
			ExperimentID:     expID,
			ExperimentTitle:  expTitle,
			BestScore:        bestScore,
			TotalSubmissions: totalSubs,
			LastSubmissionAt: lastSub,
		})
	}

	var result []CourseProgress
	for _, cid := range courseOrder {
		result = append(result, *courseMap[cid])
	}
	return result, nil
}

// GetByStudentAndCourse returns progress for a student and filters by courses they're enrolled in.
func (r *ProgressRepo) GetByStudentAndCourse(ctx context.Context, studentID string) ([]ProgressWithDetails, error) {
	rows, err := r.db.Query(ctx, `
		SELECT sp.id, sp.student_id, sp.experiment_id, sp.best_score, sp.total_submissions,
		       sp.first_submission_at, sp.last_submission_at, sp.time_spent,
		       COALESCE(u.full_name, u.username) AS student_name,
		       u.username AS student_username,
		       e.title AS experiment_title,
		       c.id AS course_id, c.name AS course_name
		FROM student_progress sp
		JOIN users u ON u.id = sp.student_id
		JOIN experiments e ON e.id = sp.experiment_id
		WHERE sp.student_id = $1
		ORDER BY e.title
	`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ProgressWithDetails
	for rows.Next() {
		var p ProgressWithDetails
		if err := rows.Scan(&p.ID, &p.StudentID, &p.ExperimentID, &p.BestScore, &p.TotalSubmissions,
			&p.FirstSubmissionAt, &p.LastSubmissionAt, &p.TimeSpent,
			&p.StudentName, &p.StudentUsername, &p.ExperimentTitle,
			&p.CourseID, &p.CourseName); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, nil
}
