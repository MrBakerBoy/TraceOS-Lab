package model

import "time"

type User struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	Email       string     `json:"email"`
	FullName    *string    `json:"full_name,omitempty"`
	Role        string     `json:"role"`
	IsActive    bool       `json:"is_active"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	StudentNo       *string   `json:"student_no,omitempty"`
	ClassName       *string   `json:"class_name,omitempty"`
	TeachingClasses []string  `json:"teaching_classes,omitempty"`
}

type UserPreferences struct {
	UserID               string `json:"user_id"`
	Theme                string `json:"theme"`
	Language             string `json:"language"`
	EditorTheme          string `json:"editor_theme"`
	EditorFontSize       int    `json:"editor_font_size"`
	NotificationsEnabled bool   `json:"notifications_enabled"`
}

type Course struct {
	ID          string    `json:"id"`
	Code        string    `json:"code"`
	Name        string    `json:"name"`
	Description *string   `json:"description,omitempty"`
	TeacherID   *string   `json:"teacher_id,omitempty"`
	IsPublished bool      `json:"is_published"`
	CreatedAt   time.Time `json:"created_at"`
}

type Experiment struct {
	ID                string    `json:"id"`
	CourseID          *string   `json:"course_id,omitempty"`
	Category          string    `json:"category"`
	Name              string    `json:"name"`
	Title             string    `json:"title"`
	Description       *string   `json:"description,omitempty"`
	Instructions      *string   `json:"instructions,omitempty"`
	StarterCode       *string   `json:"starter_code,omitempty"`
	ReferenceSolution *string   `json:"reference_solution,omitempty"`
	Templates         []CodeTemplate `json:"templates,omitempty"`
	AnswerExplanation *string   `json:"answer_explanation,omitempty"`
	Difficulty        string    `json:"difficulty"`
	TimeLimit         int       `json:"time_limit"`
	MemoryLimit       int64     `json:"memory_limit"`
	SandboxLevel      int       `json:"sandbox_level"`
	SandboxBackend    string    `json:"sandbox_backend,omitempty"` // "nsjail" or "docker", empty = strategy default
	MaxSubmissions    int       `json:"max_submissions"`
	IsPublished       bool      `json:"is_published"`
	DeletedAt         *time.Time `json:"deleted_at,omitempty"`
	CreatedBy         *string   `json:"created_by,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type TestCase struct {
	ID             string `json:"id"`
	ExperimentID   string `json:"experiment_id"`
	Name           string `json:"name"`
	Type           string `json:"type"`
	CompareMode    string `json:"compare_mode"`
	InputData      string `json:"input_data"`
	ExpectedOutput string `json:"expected_output"`
	IsPublic       bool   `json:"is_public"`
	ScoreWeight    int    `json:"score_weight"`
	OrderIndex     int    `json:"order_index"`
	ExpectedPatterns  *string `json:"expected_patterns,omitempty"`
	ExpectedSyscalls  *string `json:"expected_syscalls,omitempty"`
	ForbiddenSyscalls *string `json:"forbidden_syscalls,omitempty"`
}

type Submission struct {
	ID               string     `json:"id"`
	ExperimentID     string     `json:"experiment_id"`
	StudentID        string     `json:"student_id"`
	Code             string     `json:"code"`
	Language         string     `json:"language"`
	SubmissionNumber int        `json:"submission_number"`
	Status           string     `json:"status"`
	Score            *int       `json:"score,omitempty"`
	TotalScore       *int       `json:"total_score,omitempty"`
	PassedTestCases  int        `json:"passed_test_cases"`
	TotalTestCases   int        `json:"total_test_cases"`
	CompileError     *string    `json:"compile_error,omitempty"`
	RuntimeError     *string    `json:"runtime_error,omitempty"`
	ExecutionTime    *int       `json:"execution_time,omitempty"`
	MemoryUsage      *int64     `json:"memory_usage,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	CompletedAt       *time.Time `json:"completed_at,omitempty"`
	DiagnosisStatus  string     `json:"diagnosis_status,omitempty"`
	IsQualified      *bool      `json:"is_qualified,omitempty"`     // v2 scoring: true if all core test points passed
	CoreScore        *int       `json:"core_score,omitempty"`       // v2 scoring: weighted sum of passed core test points
	EdgeScore        *int       `json:"edge_score,omitempty"`       // v2 scoring: weighted sum of passed edge test points
	TestPoints       []TestPointData `json:"test_points,omitempty"` // v2 scoring: per-test-point evaluation detail
	CompetitionMode  string          `json:"competition_mode,omitempty"` // "high" | "low", chosen by student at submit time
	Checklist        []ChecklistItem `json:"checklist,omitempty"`        // v2 evaluation: derived verification checklist
}

// ChecklistItem is one entry in the evaluation-derived verification checklist.
// Status is one of: passed | failed | unknown.
type ChecklistItem struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

// TestPointData is the persisted/API shape of a single test point evaluation.
// It is shared across the evaluator, repository, NATS events and the HTTP API.
type TestPointData struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Type           string            `json:"type"` // "core" | "edge"
	Weight         int               `json:"weight"`
	Passed         bool              `json:"passed"`
	FailReason     string            `json:"fail_reason,omitempty"`
	ExecTimeMs     int64             `json:"exec_time_ms"`
	RuntimeError   *string           `json:"runtime_error,omitempty"`
	ActualOutput   string            `json:"actual_output,omitempty"`
	ExpectedOutput string            `json:"expected_output,omitempty"`
	Assertions     []AssertionDetail `json:"assertions,omitempty"`
}

// AssertionDetail is the evaluation result of a single assertion rule within a
// test point. Category is one of: exit_code | output | syscall | behavior | numeric.
type AssertionDetail struct {
	Category string `json:"category"`
	Passed   bool   `json:"passed"`
	Detail   string `json:"detail"`
}

type StudentProgress struct {
	ID                string     `json:"id"`
	StudentID         string     `json:"student_id"`
	ExperimentID      string     `json:"experiment_id"`
	BestScore         int        `json:"best_score"`
	TotalSubmissions  int        `json:"total_submissions"`
	FirstSubmissionAt *time.Time `json:"first_submission_at,omitempty"`
	LastSubmissionAt  *time.Time `json:"last_submission_at,omitempty"`
	TimeSpent         int        `json:"time_spent"`
}

// Request/Response types
type RegisterRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
	FullName string `json:"full_name"`
	Role     string `json:"role"`
}


// AdminCreateUserRequest is the body for admin one-click user creation.
type AdminCreateUserRequest struct {
	Username        string   `json:"username"`
	Email           string   `json:"email"`
	Password        string   `json:"password"`
	FullName        string   `json:"full_name"`
	Role            string   `json:"role"`
	StudentNo       string   `json:"student_no"`
	ClassName       string   `json:"class_name"`
	TeachingClasses []string `json:"teaching_classes"`
}

// AdminUpdateUserRequest is the body for editing a user.
type AdminUpdateUserRequest struct {
	Email           *string  `json:"email,omitempty"`
	FullName        *string  `json:"full_name,omitempty"`
	Role            *string  `json:"role,omitempty"`
	StudentNo       *string  `json:"student_no,omitempty"`
	ClassName       *string  `json:"class_name,omitempty"`
	TeachingClasses []string `json:"teaching_classes,omitempty"`
}

// AdminListUsersQuery holds filters for listing users.
type AdminListUsersQuery struct {
	Page     int
	PageSize int
	Role     string
	Class    string
	Q        string
	IsActive *bool
}

// AdminUserItem is a row in the admin user list.
type AdminUserItem struct {
	ID               string     `json:"id"`
	Username         string     `json:"username"`
	Email            string     `json:"email"`
	FullName         *string    `json:"full_name,omitempty"`
	Role             string     `json:"role"`
	IsActive         bool       `json:"is_active"`
	IsOnline         bool       `json:"is_online"`
	LastLoginAt      *time.Time `json:"last_login_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	StudentNo        *string    `json:"student_no,omitempty"`
	ClassName        *string    `json:"class_name,omitempty"`
	TeachingClasses  []string   `json:"teaching_classes,omitempty"`
	TotalSubmissions int        `json:"total_submissions"`
	AvgScore         float64    `json:"avg_score"`
}

// ResetPasswordRequest is the body for resetting a user's password.
type ResetPasswordRequest struct {
	Password string `json:"password"`
}

// SetStatusRequest is the body for enabling/disabling a user.
type SetStatusRequest struct {
	IsActive bool `json:"is_active"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

type PaginatedResponse struct {
	Data       interface{} `json:"data"`
	Total      int         `json:"total"`
	Page       int         `json:"page"`
	PageSize   int         `json:"page_size"`
	TotalPages int         `json:"total_pages"`
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

// Comment represents a discussion comment on an experiment.
type Comment struct {
	ID           string     `json:"id"`
	ExperimentID string     `json:"experiment_id"`
	UserID       string     `json:"user_id"`
	ParentID     *string    `json:"parent_id,omitempty"`
	Content      string     `json:"content"`
	IsPinned     bool       `json:"is_pinned"`
	IsAI         bool       `json:"is_ai"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	User         *User      `json:"user,omitempty"`
	Replies      []Comment  `json:"replies,omitempty"`
}

// ── Invite Code ────────────────────────────────────────────────────
type InviteCode struct {
	ID          string     `json:"id"`
	CourseID    string     `json:"course_id"`
	Code        string     `json:"code"`
	CreatedBy   string     `json:"created_by"`
	MaxUses     int        `json:"max_uses"`
	CurrentUses int        `json:"current_uses"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	IsActive    bool       `json:"is_active"`
	CreatedAt   time.Time  `json:"created_at"`
	CourseName  string     `json:"course_name,omitempty"`
}

type CreateInviteCodeRequest struct {
	CourseID  string     `json:"course_id"`
	MaxUses   int        `json:"max_uses"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

type JoinByInviteCodeRequest struct {
	Code string `json:"code"`
}

// ── Course Requests ────────────────────────────────────────────────
type CreateCourseRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// ── Submission with student info ──────────────────────────────────
type SubmissionWithStudent struct {
	Submission
	StudentName string `json:"student_name"`
	StudentUsername string `json:"student_username"`
}

// ── Audit Log ─────────────────────────────────────────────────────
type AuditLogEntry struct {
	ID             string     `json:"id"`
	UserID         *string    `json:"user_id,omitempty"`
	Username       string     `json:"username,omitempty"`
	Action         string     `json:"action"`
	ResourceType   *string    `json:"resource_type,omitempty"`
	ResourceID     *string    `json:"resource_id,omitempty"`
	IPAddress      *string    `json:"ip_address,omitempty"`
	UserAgent      *string    `json:"user_agent,omitempty"`
	RequestData    *string    `json:"request_data,omitempty"`
	ResponseStatus *int       `json:"response_status,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// ── Audit Log Filter ──────────────────────────────────────────────
type AuditLogFilter struct {
	UserID       string `json:"user_id"`
	Action       string `json:"action"`
	ResourceType string `json:"resource_type"`
	DateFrom     string `json:"date_from"`
	DateTo       string `json:"date_to"`
	Page         int    `json:"page"`
	PageSize     int    `json:"page_size"`
}

// CodeTemplate stores per-language starter_code and reference_solution.
type CodeTemplate struct {
	ID                string    `json:"id"`
	ExperimentID      string    `json:"experiment_id"`
	Language          string    `json:"language"`
	StarterCode       *string   `json:"starter_code,omitempty"`
	ReferenceSolution *string   `json:"reference_solution,omitempty"`
	Templates         []CodeTemplate `json:"templates,omitempty"`
	IsPublished       bool      `json:"is_published"`
	CreatedAt         time.Time `json:"created_at"`
}
