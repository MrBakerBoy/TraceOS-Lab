package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/model"
)

type CourseRepo struct {
	db *pgxpool.Pool
}

func NewCourseRepo(db *pgxpool.Pool) *CourseRepo {
	return &CourseRepo{db: db}
}

func (r *CourseRepo) List(ctx context.Context, page, pageSize int, teacherID *string) ([]model.Course, int, error) {
	var total int
	countQuery := `SELECT COUNT(*) FROM courses`
	args := []interface{}{}
	if teacherID != nil {
		countQuery += ` WHERE teacher_id = $1`
		args = append(args, *teacherID)
	}
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := `SELECT id, code, name, description, teacher_id, is_published, created_at FROM courses`
	queryArgs := []interface{}{pageSize, (page - 1) * pageSize}
	if teacherID != nil {
		query += ` WHERE teacher_id = $3`
		queryArgs = append(queryArgs, *teacherID)
	}
	query += ` ORDER BY created_at DESC LIMIT $1 OFFSET $2`

	rows, err := r.db.Query(ctx, query, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var courses []model.Course
	for rows.Next() {
		var c model.Course
		if err := rows.Scan(&c.ID, &c.Code, &c.Name, &c.Description, &c.TeacherID, &c.IsPublished, &c.CreatedAt); err != nil {
			return nil, 0, err
		}
		courses = append(courses, c)
	}
	return courses, total, nil
}

func (r *CourseRepo) GetByID(ctx context.Context, id string) (*model.Course, error) {
	c := &model.Course{}
	err := r.db.QueryRow(ctx, `
		SELECT id, code, name, description, teacher_id, is_published, created_at
		FROM courses WHERE id = $1
	`, id).Scan(&c.ID, &c.Code, &c.Name, &c.Description, &c.TeacherID, &c.IsPublished, &c.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get course: %w", err)
	}
	return c, nil
}

func (r *CourseRepo) Create(ctx context.Context, course *model.Course) error {
	return r.db.QueryRow(ctx, `
		INSERT INTO courses (code, name, description, teacher_id, is_published)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at
	`, course.Code, course.Name, course.Description, course.TeacherID, course.IsPublished).
		Scan(&course.ID, &course.CreatedAt)
}

func (r *CourseRepo) Enroll(ctx context.Context, courseID, studentID string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO course_enrollments (course_id, student_id) VALUES ($1, $2)
		ON CONFLICT (course_id, student_id) DO NOTHING
	`, courseID, studentID)
	return err
}

func (r *CourseRepo) GetEnrolledCourses(ctx context.Context, studentID string) ([]model.Course, error) {
	rows, err := r.db.Query(ctx, `
		SELECT c.id, c.code, c.name, c.description, c.teacher_id, c.is_published, c.created_at
		FROM courses c
		JOIN course_enrollments e ON e.course_id = c.id
		WHERE e.student_id = $1 AND c.is_published = true
		ORDER BY c.created_at DESC
	`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var courses []model.Course
	for rows.Next() {
		var c model.Course
		if err := rows.Scan(&c.ID, &c.Code, &c.Name, &c.Description, &c.TeacherID, &c.IsPublished, &c.CreatedAt); err != nil {
			return nil, err
		}
		courses = append(courses, c)
	}
	return courses, nil
}

// ── Invite Codes ────────────────────────────────────────────────────

func (r *CourseRepo) CreateInviteCode(ctx context.Context, ic *model.InviteCode) error {
	return r.db.QueryRow(ctx, `
		INSERT INTO invite_codes (course_id, code, created_by, max_uses, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at
	`, ic.CourseID, ic.Code, ic.CreatedBy, ic.MaxUses, ic.ExpiresAt).Scan(&ic.ID, &ic.CreatedAt)
}

func (r *CourseRepo) GetInviteCode(ctx context.Context, code string) (*model.InviteCode, error) {
	ic := &model.InviteCode{}
	err := r.db.QueryRow(ctx, `
		SELECT ic.id, ic.course_id, ic.code, ic.created_by, ic.max_uses, ic.current_uses,
		       ic.expires_at, ic.is_active, ic.created_at, c.name
		FROM invite_codes ic
		JOIN courses c ON c.id = ic.course_id
		WHERE ic.code = $1
	`, code).Scan(&ic.ID, &ic.CourseID, &ic.Code, &ic.CreatedBy, &ic.MaxUses, &ic.CurrentUses,
		&ic.ExpiresAt, &ic.IsActive, &ic.CreatedAt, &ic.CourseName)
	if err != nil {
		return nil, fmt.Errorf("get invite code: %w", err)
	}
	return ic, nil
}

func (r *CourseRepo) ListInviteCodes(ctx context.Context, courseID string) ([]model.InviteCode, error) {
	rows, err := r.db.Query(ctx, `
		SELECT ic.id, ic.course_id, ic.code, ic.created_by, ic.max_uses, ic.current_uses,
		       ic.expires_at, ic.is_active, ic.created_at, c.name
		FROM invite_codes ic
		JOIN courses c ON c.id = ic.course_id
		WHERE ic.course_id = $1
		ORDER BY ic.created_at DESC
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var codes []model.InviteCode
	for rows.Next() {
		var ic model.InviteCode
		if err := rows.Scan(&ic.ID, &ic.CourseID, &ic.Code, &ic.CreatedBy, &ic.MaxUses, &ic.CurrentUses,
			&ic.ExpiresAt, &ic.IsActive, &ic.CreatedAt, &ic.CourseName); err != nil {
			return nil, err
		}
		codes = append(codes, ic)
	}
	return codes, nil
}

func (r *CourseRepo) IncrementInviteCodeUse(ctx context.Context, code string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE invite_codes SET current_uses = current_uses + 1 WHERE code = $1
	`, code)
	return err
}

func (r *CourseRepo) DisableInviteCode(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `UPDATE invite_codes SET is_active = false WHERE id = $1`, id)
	return err
}

func (r *CourseRepo) GetCourseStudents(ctx context.Context, courseID string) ([]model.User, error) {
	rows, err := r.db.Query(ctx, `
		SELECT u.id, u.username, u.email, u.full_name, u.role, u.is_active, u.last_login_at, u.created_at, u.updated_at
		FROM users u
		JOIN course_enrollments e ON e.student_id = u.id
		WHERE e.course_id = $1
		ORDER BY u.username
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []model.User
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.FullName, &u.Role,
			&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}
