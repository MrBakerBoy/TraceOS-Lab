package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/model"
)

type UserRepo struct {
	db *pgxpool.Pool
}

func NewUserRepo(db *pgxpool.Pool) *UserRepo {
	return &UserRepo{db: db}
}

func (r *UserRepo) Create(ctx context.Context, user *model.User, passwordHash string) error {
	err := r.db.QueryRow(ctx, `
		INSERT INTO users (username, email, password_hash, full_name, role, student_no, class_name, teaching_classes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at, updated_at
	`, user.Username, user.Email, passwordHash, user.FullName, user.Role,
		nullStr(user.StudentNo), nullStr(user.ClassName), user.TeachingClasses).
		Scan(&user.ID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create user: %w", err)
	}

	_, err = r.db.Exec(ctx, `
		INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING
	`, user.ID)
	return err
}

func (r *UserRepo) GetByID(ctx context.Context, id string) (*model.User, error) {
	user := &model.User{}
	err := r.db.QueryRow(ctx, `
		SELECT id, username, email, full_name, role, is_active, last_login_at, created_at, updated_at
		FROM users WHERE id = $1
	`, id).Scan(&user.ID, &user.Username, &user.Email, &user.FullName, &user.Role,
		&user.IsActive, &user.LastLoginAt, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	return user, nil
}

func (r *UserRepo) GetByUsername(ctx context.Context, username string) (*model.User, string, error) {
	user := &model.User{}
	var passwordHash string
	err := r.db.QueryRow(ctx, `
		SELECT id, username, email, password_hash, full_name, role, is_active, last_login_at, created_at, updated_at
		FROM users WHERE username = $1
	`, username).Scan(&user.ID, &user.Username, &user.Email, &passwordHash, &user.FullName,
		&user.Role, &user.IsActive, &user.LastLoginAt, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, "", fmt.Errorf("get user by username: %w", err)
	}
	return user, passwordHash, nil
}

// GetByEmailOrUsername looks up a user by username or email.
func (r *UserRepo) GetByEmailOrUsername(ctx context.Context, login string) (*model.User, string, error) {
	user := &model.User{}
	var passwordHash string
	err := r.db.QueryRow(ctx, `
		SELECT id, username, email, password_hash, full_name, role, is_active, last_login_at, created_at, updated_at
		FROM users WHERE username = $1 OR email = $1
		LIMIT 1
	`, login).Scan(&user.ID, &user.Username, &user.Email, &passwordHash, &user.FullName,
		&user.Role, &user.IsActive, &user.LastLoginAt, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, "", fmt.Errorf("get user by login: %w", err)
	}
	return user, passwordHash, nil
}

func (r *UserRepo) UpdateLastLogin(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `UPDATE users SET last_login_at = NOW() WHERE id = $1`, id)
	return err
}

func (r *UserRepo) List(ctx context.Context, page, pageSize int) ([]model.User, int, error) {
	var total int
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := r.db.Query(ctx, `
		SELECT id, username, email, full_name, role, is_active, last_login_at, created_at, updated_at
		FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2
	`, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var users []model.User
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.FullName, &u.Role,
			&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, 0, err
		}
		users = append(users, u)
	}
	return users, total, nil
}

// nullStr returns a *string suitable for nullable columns from a *string.
func nullStr(s *string) interface{} {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

// nullStrFromVal returns a *string or nil for a plain string.
func nullStrFromVal(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// GetByEmail looks up a user by email (returns error if not found).
func (r *UserRepo) GetByEmail(ctx context.Context, email string) (*model.User, error) {
	user := &model.User{}
	err := r.db.QueryRow(ctx, `
		SELECT id, username, email, full_name, role, is_active, last_login_at, created_at, updated_at
		FROM users WHERE email = $1
	`, email).Scan(&user.ID, &user.Username, &user.Email, &user.FullName, &user.Role,
		&user.IsActive, &user.LastLoginAt, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user by email: %w", err)
	}
	return user, nil
}

// Update applies editable fields to a user. Nil pointers leave fields unchanged.
func (r *UserRepo) Update(ctx context.Context, id string, email *string, fullName *string, role *string, studentNo *string, className *string, teachingClasses []string) error {
	setClauses := []string{}
	args := []interface{}{}
	idx := 1
	add := func(col string, val interface{}) {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", col, idx))
		args = append(args, val)
		idx++
	}
	if email != nil {
		add("email", *email)
	}
	if fullName != nil {
		add("full_name", *fullName)
	}
	if role != nil {
		add("role", *role)
	}
	if studentNo != nil {
		add("student_no", nullStr(studentNo))
	}
	if className != nil {
		add("class_name", nullStr(className))
	}
	if teachingClasses != nil {
		add("teaching_classes", teachingClasses)
	}
	if len(setClauses) == 0 {
		return nil
	}
	args = append(args, id)
	q := fmt.Sprintf("UPDATE users SET %s, updated_at = NOW() WHERE id = $%d", joinStr(setClauses, ", "), idx)
	_, err := r.db.Exec(ctx, q, args...)
	return err
}

func joinStr(parts []string, sep string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += sep
		}
		out += p
	}
	return out
}

// SetPassword updates a user's password hash.
func (r *UserRepo) SetPassword(ctx context.Context, id string, passwordHash string) error {
	_, err := r.db.Exec(ctx, `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, passwordHash, id)
	return err
}

// SetActive enables or disables a user.
func (r *UserRepo) SetActive(ctx context.Context, id string, active bool) error {
	_, err := r.db.Exec(ctx, `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2`, active, id)
	return err
}

// Delete physically removes a user.
func (r *UserRepo) Delete(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	return err
}

// GetTeachingClasses returns the teaching_classes array for a teacher.
func (r *UserRepo) GetTeachingClasses(ctx context.Context, teacherID string) ([]string, error) {
	var classes []string
	err := r.db.QueryRow(ctx, `SELECT teaching_classes FROM users WHERE id = $1`, teacherID).Scan(&classes)
	if err != nil {
		return nil, err
	}
	return classes, nil
}

// ListForAdmin returns a paginated, filtered list of users with submission stats.
func (r *UserRepo) ListForAdmin(ctx context.Context, q model.AdminListUsersQuery) ([]model.AdminUserItem, int, error) {
	where := []string{"1=1"}
	args := []interface{}{}
	idx := 1
	add := func(cond string, val interface{}) {
		where = append(where, fmt.Sprintf(cond, idx))
		args = append(args, val)
		idx++
	}
	if q.Role != "" {
		add("u.role = $%d", q.Role)
	}
	if q.Class != "" {
		add("u.class_name = $%d", q.Class)
	}
	if q.Q != "" {
		pat := "%" + q.Q + "%"
		where = append(where, fmt.Sprintf("(u.username ILIKE $%d OR u.email ILIKE $%d OR COALESCE(u.full_name,'') ILIKE $%d)", idx, idx, idx))
		args = append(args, pat)
		idx++
	}
	if q.IsActive != nil {
		add("u.is_active = $%d", *q.IsActive)
	}

	whereSQL := joinStr(where, " AND ")
	var total int
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM users u WHERE %s", whereSQL)
	if err := r.db.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 20
	}
	offset := (q.Page - 1) * q.PageSize
	listArgs := append(append([]interface{}{}, args...), q.PageSize, offset)
	listSQL := fmt.Sprintf(`
		SELECT u.id, u.username, u.email, u.full_name, u.role, u.is_active,
		       (u.last_login_at IS NOT NULL AND u.last_login_at > NOW() - INTERVAL '15 minutes') AS is_online,
		       u.last_login_at, u.created_at, u.student_no, u.class_name, u.teaching_classes,
		       COUNT(DISTINCT s.id),
		       COALESCE(AVG(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0)
		FROM users u
		LEFT JOIN submissions s ON s.student_id = u.id
		WHERE %s
		GROUP BY u.id
		ORDER BY u.created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereSQL, idx, idx+1)
	rows, err := r.db.Query(ctx, listSQL, listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []model.AdminUserItem
	for rows.Next() {
		var it model.AdminUserItem
		var studentNo, className *string
		var teachingClasses []string
		if err := rows.Scan(&it.ID, &it.Username, &it.Email, &it.FullName, &it.Role, &it.IsActive,
			&it.IsOnline, &it.LastLoginAt, &it.CreatedAt, &studentNo, &className, &teachingClasses,
			&it.TotalSubmissions, &it.AvgScore); err != nil {
			return nil, 0, err
		}
		it.StudentNo = studentNo
		it.ClassName = className
		if teachingClasses != nil {
			it.TeachingClasses = teachingClasses
		}
		items = append(items, it)
	}
	return items, total, nil
}

// ListStudentsForTeacher returns students whose class_name is in teacherClasses.
func (r *UserRepo) ListStudentsForTeacher(ctx context.Context, teacherClasses []string, page, pageSize int, q string) ([]model.AdminUserItem, int, error) {
	if len(teacherClasses) == 0 {
		return []model.AdminUserItem{}, 0, nil
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	where := []string{"u.role = 'student'", "u.class_name = ANY($1)"}
	args := []interface{}{teacherClasses}
	idx := 2
	if q != "" {
		where = append(where, fmt.Sprintf("(u.username ILIKE $%d OR u.email ILIKE $%d OR COALESCE(u.full_name,'') ILIKE $%d)", idx, idx, idx))
		args = append(args, "%"+q+"%")
		idx++
	}
	whereSQL := joinStr(where, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, fmt.Sprintf("SELECT COUNT(*) FROM users u WHERE %s", whereSQL), args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	listArgs := append(append([]interface{}{}, args...), pageSize, offset)
	listSQL := fmt.Sprintf(`
		SELECT u.id, u.username, u.email, u.full_name, u.role, u.is_active,
		       (u.last_login_at IS NOT NULL AND u.last_login_at > NOW() - INTERVAL '15 minutes') AS is_online,
		       u.last_login_at, u.created_at, u.student_no, u.class_name, u.teaching_classes,
		       COUNT(DISTINCT s.id),
		       COALESCE(AVG(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0)
		FROM users u
		LEFT JOIN submissions s ON s.student_id = u.id
		WHERE %s
		GROUP BY u.id
		ORDER BY u.username
		LIMIT $%d OFFSET $%d
	`, whereSQL, idx, idx+1)
	rows, err := r.db.Query(ctx, listSQL, listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []model.AdminUserItem
	for rows.Next() {
		var it model.AdminUserItem
		var studentNo, className *string
		var teachingClasses []string
		if err := rows.Scan(&it.ID, &it.Username, &it.Email, &it.FullName, &it.Role, &it.IsActive,
			&it.IsOnline, &it.LastLoginAt, &it.CreatedAt, &studentNo, &className, &teachingClasses,
			&it.TotalSubmissions, &it.AvgScore); err != nil {
			return nil, 0, err
		}
		it.StudentNo = studentNo
		it.ClassName = className
		if teachingClasses != nil {
			it.TeachingClasses = teachingClasses
		}
		items = append(items, it)
	}
	return items, total, nil
}

// GetStudentClass returns the class_name for a student (nil if not student/none).
func (r *UserRepo) GetStudentClass(ctx context.Context, studentID string) (*string, error) {
	var className *string
	err := r.db.QueryRow(ctx, `SELECT class_name FROM users WHERE id = $1 AND role = 'student'`, studentID).Scan(&className)
	if err != nil {
		return nil, err
	}
	return className, nil
}
