package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/model"
)

type SubmissionRepo struct {
	db *pgxpool.Pool
}

func NewSubmissionRepo(db *pgxpool.Pool) *SubmissionRepo {
	return &SubmissionRepo{db: db}
}

func (r *SubmissionRepo) GetNextNumber(ctx context.Context, experimentID, studentID string) (int, error) {
	var num int
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(MAX(submission_number), 0) + 1
		FROM submissions WHERE experiment_id = $1 AND student_id = $2
	`, experimentID, studentID).Scan(&num)
	return num, err
}

// GetSubmissionCount returns the number of submissions for a student in an experiment.
func (r *SubmissionRepo) GetSubmissionCount(ctx context.Context, experimentID, studentID string) (int, error) {
	var count int
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM submissions WHERE experiment_id = $1 AND student_id = $2
	`, experimentID, studentID).Scan(&count)
	return count, err
}

func (r *SubmissionRepo) Create(ctx context.Context, sub *model.Submission) error {
	return r.db.QueryRow(ctx, `
		INSERT INTO submissions (experiment_id, student_id, code, language, submission_number, status, competition_mode)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at
	`, sub.ExperimentID, sub.StudentID, sub.Code, sub.Language, sub.SubmissionNumber, sub.Status, sub.CompetitionMode).
		Scan(&sub.ID, &sub.CreatedAt)
}

// submissionSelectColumns is the canonical column list shared by all
// submission read queries. Keep it in sync with scanSubmission.
const submissionSelectColumns = `
	id, experiment_id, student_id, code, language, submission_number, status,
	score, total_score, passed_test_cases, total_test_cases,
	compile_error, runtime_error, execution_time, memory_usage,
	created_at, completed_at, COALESCE(diagnosis_status, 'none'),
	is_qualified, core_score, edge_score,
	COALESCE(test_points, '[]'::jsonb),
	COALESCE(competition_mode, 'high'),
	COALESCE(checklist, '[]'::jsonb)
`

// rowScanner abstracts pgx.Row and pgx.Rows so a single scan helper can serve
// both single-row and multi-row queries.
type rowScanner interface {
	Scan(dest ...any) error
}

// scanSubmission scans a row using submissionSelectColumns into a model.
func scanSubmission(row rowScanner, s *model.Submission) error {
	var testPointsRaw []byte
	var checklistRaw []byte
	if err := row.Scan(
		&s.ID, &s.ExperimentID, &s.StudentID, &s.Code, &s.Language,
		&s.SubmissionNumber, &s.Status, &s.Score, &s.TotalScore,
		&s.PassedTestCases, &s.TotalTestCases, &s.CompileError, &s.RuntimeError,
		&s.ExecutionTime, &s.MemoryUsage, &s.CreatedAt, &s.CompletedAt,
		&s.DiagnosisStatus, &s.IsQualified, &s.CoreScore, &s.EdgeScore, &testPointsRaw,
		&s.CompetitionMode, &checklistRaw,
	); err != nil {
		return err
	}
	if len(testPointsRaw) > 0 {
		_ = json.Unmarshal(testPointsRaw, &s.TestPoints)
	}
	if len(checklistRaw) > 0 {
		_ = json.Unmarshal(checklistRaw, &s.Checklist)
	}
	return nil
}

// submissionSelectColumnsAliased is submissionSelectColumns with the `s.` alias
// for joined queries.
const submissionSelectColumnsAliased = `
	s.id, s.experiment_id, s.student_id, s.code, s.language, s.submission_number, s.status,
	s.score, s.total_score, s.passed_test_cases, s.total_test_cases,
	s.compile_error, s.runtime_error, s.execution_time, s.memory_usage,
	s.created_at, s.completed_at, COALESCE(s.diagnosis_status, 'none'),
	s.is_qualified, s.core_score, s.edge_score,
	COALESCE(s.test_points, '[]'::jsonb),
	COALESCE(s.competition_mode, 'high'),
	COALESCE(s.checklist, '[]'::jsonb)
`

// scanSubmissionWithStudent scans submissionSelectColumnsAliased plus the two
// student display columns into a SubmissionWithStudent.
func scanSubmissionWithStudent(row rowScanner, s *model.SubmissionWithStudent) error {
	var testPointsRaw []byte
	var checklistRaw []byte
	if err := row.Scan(
		&s.ID, &s.ExperimentID, &s.StudentID, &s.Code, &s.Language,
		&s.SubmissionNumber, &s.Status, &s.Score, &s.TotalScore,
		&s.PassedTestCases, &s.TotalTestCases, &s.CompileError, &s.RuntimeError,
		&s.ExecutionTime, &s.MemoryUsage, &s.CreatedAt, &s.CompletedAt,
		&s.DiagnosisStatus, &s.IsQualified, &s.CoreScore, &s.EdgeScore, &testPointsRaw,
		&s.CompetitionMode, &checklistRaw,
		&s.StudentName, &s.StudentUsername,
	); err != nil {
		return err
	}
	if len(testPointsRaw) > 0 {
		_ = json.Unmarshal(testPointsRaw, &s.TestPoints)
	}
	if len(checklistRaw) > 0 {
		_ = json.Unmarshal(checklistRaw, &s.Checklist)
	}
	return nil
}

func (r *SubmissionRepo) GetByID(ctx context.Context, id string) (*model.Submission, error) {
	s := &model.Submission{}
	err := scanSubmission(r.db.QueryRow(ctx,
		`SELECT `+submissionSelectColumns+` FROM submissions WHERE id = $1`, id), s)
	if err != nil {
		return nil, fmt.Errorf("get submission: %w", err)
	}
	return s, nil
}

func (r *SubmissionRepo) List(ctx context.Context, experimentID string, studentID *string, page, pageSize int) ([]model.Submission, int, error) {
	args := []interface{}{experimentID}
	where := "experiment_id = $1"
	argIdx := 2

	if studentID != nil {
		where += fmt.Sprintf(" AND student_id = $%d", argIdx)
		args = append(args, *studentID)
		argIdx++
	}

	var total int
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	if err := r.db.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM submissions WHERE %s`, where), countArgs...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, pageSize, (page-1)*pageSize)
	query := fmt.Sprintf(`
		SELECT %s
		FROM submissions WHERE %s
		ORDER BY created_at DESC LIMIT $%d OFFSET $%d
	`, submissionSelectColumns, where, argIdx, argIdx+1)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var subs []model.Submission
	for rows.Next() {
		var s model.Submission
		if err := scanSubmission(rows, &s); err != nil {
			return nil, 0, err
		}
		subs = append(subs, s)
	}
	return subs, total, nil
}

func (r *SubmissionRepo) UpdateResult(ctx context.Context, id string, status string, score, totalScore, passed, total int, compileErr, runtimeErr *string, execTime *int, memUsage *int64) error {
	_, err := r.db.Exec(ctx, `
		UPDATE submissions SET status=$2, score=$3, total_score=$4,
			passed_test_cases=$5, total_test_cases=$6,
			compile_error=$7, runtime_error=$8,
			execution_time=$9, memory_usage=$10,
			completed_at=NOW(),
			diagnosis_status = CASE WHEN diagnosis_status = 'none' THEN 'pending' ELSE diagnosis_status END
		WHERE id=$1
	`, id, status, score, totalScore, passed, total, compileErr, runtimeErr, execTime, memUsage)
	return err
}

// UpdateResultV2 persists the full v2 scoring result in one atomic write,
// including core/edge breakdown, qualification flag and per-test-point detail.
func (r *SubmissionRepo) UpdateResultV2(ctx context.Context, id, status string, score, totalScore, passed, total, coreScore, edgeScore int, isQualified bool, compileErr, runtimeErr *string, execTime *int, memUsage *int64, testPoints []byte, checklist []byte) error {
	_, err := r.db.Exec(ctx, `
		UPDATE submissions SET status=$2, score=$3, total_score=$4,
			passed_test_cases=$5, total_test_cases=$6,
			core_score=$7, edge_score=$8, is_qualified=$9,
			compile_error=$10, runtime_error=$11,
			execution_time=$12, memory_usage=$13,
			test_points=$14, checklist=$15,
			completed_at=NOW(),
			diagnosis_status = CASE WHEN diagnosis_status = 'none' THEN 'pending' ELSE diagnosis_status END
		WHERE id=$1
	`, id, status, score, totalScore, passed, total,
		coreScore, edgeScore, isQualified, compileErr, runtimeErr, execTime, memUsage, testPoints, checklist)
	return err
}

// UpdateIsQualified sets the is_qualified flag on a submission.
func (r *SubmissionRepo) UpdateIsQualified(ctx context.Context, id string, qualified bool) error {
	_, err := r.db.Exec(ctx, `UPDATE submissions SET is_qualified=$2 WHERE id=$1`, id, qualified)
	return err
}

// UpdateChecklist persists only the derived verification checklist.
// Used for terminal states (e.g. compile_error) where the full v2 result
// is not written via UpdateResultV2.
func (r *SubmissionRepo) UpdateChecklist(ctx context.Context, id string, checklist []byte) error {
	_, err := r.db.Exec(ctx, `UPDATE submissions SET checklist=$2 WHERE id=$1`, id, checklist)
	return err
}

// Update student progress after submission
func (r *SubmissionRepo) UpdateProgress(ctx context.Context, sub *model.Submission) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO student_progress (student_id, experiment_id, best_score, total_submissions, first_submission_at, last_submission_at)
		VALUES ($1, $2, $3, 1, $4, $4)
		ON CONFLICT (student_id, experiment_id) DO UPDATE SET
			best_score = GREATEST(student_progress.best_score, $3),
			total_submissions = student_progress.total_submissions + 1,
			last_submission_at = $4
	`, sub.StudentID, sub.ExperimentID, sub.Score, sub.CreatedAt)
	return err
}

// HasPassedSubmission checks if a student has a passing submission for an experiment
func (r *SubmissionRepo) HasPassedSubmission(ctx context.Context, experimentID, studentID string) (bool, error) {
	var count int
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM submissions
		WHERE experiment_id = $1 AND student_id = $2 AND status = 'completed' AND score >= total_score * 0.6
	`, experimentID, studentID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// ListWithStudent returns submissions with student name for teacher view.
func (r *SubmissionRepo) ListWithStudent(ctx context.Context, experimentID string, studentID *string, page, pageSize int) ([]model.SubmissionWithStudent, int, error) {
	args := []interface{}{experimentID}
	where := "s.experiment_id = $1"
	argIdx := 2

	if studentID != nil {
		where += fmt.Sprintf(" AND s.student_id = $%d", argIdx)
		args = append(args, *studentID)
		argIdx++
	}

	var total int
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	if err := r.db.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM submissions s WHERE %s`, where), countArgs...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, pageSize, (page-1)*pageSize)
	query := fmt.Sprintf(`
		SELECT %s,
		       COALESCE(u.full_name, u.username) AS student_name, u.username AS student_username
		FROM submissions s
		JOIN users u ON u.id = s.student_id
		WHERE %s
		ORDER BY s.created_at DESC LIMIT $%d OFFSET $%d
	`, submissionSelectColumnsAliased, where, argIdx, argIdx+1)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var subs []model.SubmissionWithStudent
	for rows.Next() {
		var s model.SubmissionWithStudent
		if err := scanSubmissionWithStudent(rows, &s); err != nil {
			return nil, 0, err
		}
		subs = append(subs, s)
	}
	return subs, total, nil
}

// SyscallTraceRecord represents a single syscall trace entry for bulk insert.
type SyscallTraceRecord struct {
	Time         time.Time              `json:"time"`
	SubmissionID string                 `json:"submission_id"`
	PID          int                    `json:"pid"`
	SyscallName  string                 `json:"syscall_name"`
	Args         map[string]interface{} `json:"args,omitempty"`
	ReturnValue  int64                  `json:"return_value"`
	ErrorName    string                 `json:"error_name"`
	DurationNs   int64                  `json:"duration_ns"`
	SourceLine   *int                   `json:"source_line,omitempty"`
}

// InsertSyscallTraces bulk inserts syscall trace records.
func (r *SubmissionRepo) InsertSyscallTraces(ctx context.Context, traces []SyscallTraceRecord) error {
	if len(traces) == 0 {
		return nil
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, t := range traces {
		var errCode *int
		var errName *string
		if t.ErrorName != "" {
			code := int(t.ReturnValue)
			errCode = &code
			errName = &t.ErrorName
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO syscall_traces (time, submission_id, pid, syscall_name, args, return_value, error_code, error_name, duration_ns)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, t.Time, t.SubmissionID, t.PID, t.SyscallName, t.Args, t.ReturnValue, errCode, errName, t.DurationNs)
		if err != nil {
			return fmt.Errorf("insert trace: %w", err)
		}
	}

	return tx.Commit(ctx)
}

// ListAll returns all submissions across experiments with pagination, optional filters.
func (r *SubmissionRepo) ListAll(ctx context.Context, courseID, experimentID, studentID *string, page, pageSize int) ([]model.SubmissionWithStudent, int, error) {
	args := []interface{}{}
	where := "1=1"
	argIdx := 1

	if courseID != nil {
		where += fmt.Sprintf(" AND e.course_id = $%d", argIdx)
		args = append(args, *courseID)
		argIdx++
	}
	if experimentID != nil {
		where += fmt.Sprintf(" AND s.experiment_id = $%d", argIdx)
		args = append(args, *experimentID)
		argIdx++
	}
	if studentID != nil {
		where += fmt.Sprintf(" AND s.student_id = $%d", argIdx)
		args = append(args, *studentID)
		argIdx++
	}

	var total int
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM submissions s LEFT JOIN experiments e ON e.id = s.experiment_id WHERE %s", where)
	if err := r.db.QueryRow(ctx, countQuery, countArgs...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, pageSize, (page-1)*pageSize)
	query := fmt.Sprintf(`
		SELECT %s,
		       COALESCE(u.full_name, u.username) AS student_name, u.username AS student_username
		FROM submissions s
		LEFT JOIN experiments e ON e.id = s.experiment_id
		JOIN users u ON u.id = s.student_id
		WHERE %s
		ORDER BY s.created_at DESC LIMIT $%d OFFSET $%d
	`, submissionSelectColumnsAliased, where, argIdx, argIdx+1)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var subs []model.SubmissionWithStudent
	for rows.Next() {
		var s model.SubmissionWithStudent
		if err := scanSubmissionWithStudent(rows, &s); err != nil {
			return nil, 0, err
		}
		subs = append(subs, s)
	}
	return subs, total, nil
}

// GetSyscallTraces returns syscall trace records for a submission.
func (r *SubmissionRepo) GetSyscallTraces(ctx context.Context, submissionID string, limit int, errorsOnly bool) ([]SyscallTraceRecord, error) {
	if limit <= 0 {
		limit = 500
	}
	if limit > 5000 {
		limit = 5000
	}

	query := `SELECT time, submission_id, pid, syscall_name, return_value, COALESCE(error_name, ''), duration_ns, source_line
		FROM syscall_traces WHERE submission_id = $1`
	if errorsOnly {
		query += ` AND error_name != ''`
	}
	query += ` ORDER BY time ASC LIMIT $2`

	rows, err := r.db.Query(ctx, query, submissionID, limit)
	if err != nil {
		return nil, fmt.Errorf("query syscall traces: %w", err)
	}
	defer rows.Close()

	var traces []SyscallTraceRecord
	for rows.Next() {
		var t SyscallTraceRecord
		if err := rows.Scan(&t.Time, &t.SubmissionID, &t.PID, &t.SyscallName, &t.ReturnValue, &t.ErrorName, &t.DurationNs, &t.SourceLine); err != nil {
			return nil, fmt.Errorf("scan syscall trace: %w", err)
		}
		traces = append(traces, t)
	}
	return traces, nil
}

// RecoverStaleSubmissions marks all pending/running submissions as failed on startup.
func (r *SubmissionRepo) RecoverStaleSubmissions(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx,
		"UPDATE submissions SET status='failed', score=0, created_at=NOW() WHERE status IN ('pending','running')")
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// StoreTraceDiff stores the trace diff result JSON for a submission.
func (r *SubmissionRepo) StoreTraceDiff(ctx context.Context, submissionID string, diffJSON []byte) error {
	_, err := r.db.Exec(ctx, "UPDATE submissions SET trace_diff = $2 WHERE id = $1", submissionID, diffJSON)
	return err
}

// MemoryLayoutRecord is the write-side representation of a memory-layout snapshot.
// MmapRegions carries the pre-marshalled JSONB payload for the mmap_regions column.
type MemoryLayoutRecord struct {
	SubmissionID string
	Timestamp    time.Time
	TextStart    uint64
	TextSize     uint64
	DataStart    uint64
	DataSize     uint64
	BSSStart     uint64
	BSSSize      uint64
	HeapStart    uint64
	HeapSize     uint64
	StackStart   uint64
	StackSize    uint64
	MmapRegions  []byte // pre-marshalled JSONB
}

// InsertMemoryLayouts bulk inserts memory-layout snapshots for a submission.
func (r *SubmissionRepo) InsertMemoryLayouts(ctx context.Context, records []MemoryLayoutRecord) error {
	if len(records) == 0 {
		return nil
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, rec := range records {
		regions := rec.MmapRegions
		if regions == nil {
			regions = []byte("[]")
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO memory_layouts
			    (submission_id, timestamp, text_start, text_size, data_start, data_size,
			     bss_start, bss_size, heap_start, heap_size, stack_start, stack_size, mmap_regions)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		`, rec.SubmissionID, rec.Timestamp,
			int64(rec.TextStart), int64(rec.TextSize),
			int64(rec.DataStart), int64(rec.DataSize),
			int64(rec.BSSStart), int64(rec.BSSSize),
			int64(rec.HeapStart), int64(rec.HeapSize),
			int64(rec.StackStart), int64(rec.StackSize),
			regions,
		); err != nil {
			return fmt.Errorf("insert memory_layouts: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// GetMemoryLayouts returns memory-layout snapshots for a submission.
func (r *SubmissionRepo) GetMemoryLayouts(ctx context.Context, submissionID string, limit int) ([]MemoryLayoutRecord, error) {
	if limit <= 0 {
		limit = 500
	}
	if limit > 5000 {
		limit = 5000
	}

	rows, err := r.db.Query(ctx, `
		SELECT timestamp, text_start, text_size, data_start, data_size,
		       bss_start, bss_size, heap_start, heap_size,
		       stack_start, stack_size, COALESCE(mmap_regions, '[]'::jsonb)
		FROM memory_layouts WHERE submission_id = $1 ORDER BY timestamp ASC LIMIT $2
	`, submissionID, limit)
	if err != nil {
		return nil, fmt.Errorf("query memory_layouts: %w", err)
	}
	defer rows.Close()

	var records []MemoryLayoutRecord
	for rows.Next() {
		var rec MemoryLayoutRecord
		rec.SubmissionID = submissionID
		var textStart, textSize, dataStart, dataSize int64
		var bssStart, bssSize, heapStart, heapSize int64
		var stackStart, stackSize int64
		var regions []byte
		if err := rows.Scan(
			&rec.Timestamp,
			&textStart, &textSize,
			&dataStart, &dataSize,
			&bssStart, &bssSize,
			&heapStart, &heapSize,
			&stackStart, &stackSize,
			&regions,
		); err != nil {
			return nil, fmt.Errorf("scan memory_layouts: %w", err)
		}
		rec.TextStart = uint64(textStart)
		rec.TextSize = uint64(textSize)
		rec.DataStart = uint64(dataStart)
		rec.DataSize = uint64(dataSize)
		rec.BSSStart = uint64(bssStart)
		rec.BSSSize = uint64(bssSize)
		rec.HeapStart = uint64(heapStart)
		rec.HeapSize = uint64(heapSize)
		rec.StackStart = uint64(stackStart)
		rec.StackSize = uint64(stackSize)
		rec.MmapRegions = regions
		records = append(records, rec)
	}
	return records, nil
}


// ResourceUsageRecord represents a resource-usage data point for bulk insert.
type ResourceUsageRecord struct {
	SubmissionID  string
	Time          time.Time
	PID           int
	CPUPercent    float64
	MemoryBytes   int64
	MemoryPercent float64
	DiskReadBytes int64
	DiskWriteBytes int64
}

// InsertResourceUsage bulk inserts resource-usage snapshots for a submission.
func (r *SubmissionRepo) InsertResourceUsage(ctx context.Context, records []ResourceUsageRecord) error {
	if len(records) == 0 {
		return nil
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, rec := range records {
		if _, err := tx.Exec(ctx, `
			INSERT INTO resource_usage (time, submission_id, pid, cpu_percent, memory_bytes, memory_percent, disk_read_bytes, disk_write_bytes)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, rec.Time, rec.SubmissionID, rec.PID, rec.CPUPercent, rec.MemoryBytes, rec.MemoryPercent, rec.DiskReadBytes, rec.DiskWriteBytes); err != nil {
			return fmt.Errorf("insert resource_usage: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// GetResourceUsage returns resource-usage data points for a submission.
func (r *SubmissionRepo) GetResourceUsage(ctx context.Context, submissionID string) ([]ResourceUsageRecord, error) {
	rows, err := r.db.Query(ctx, `
		SELECT time, submission_id, pid, cpu_percent, memory_bytes, memory_percent, disk_read_bytes, disk_write_bytes
		FROM resource_usage WHERE submission_id = $1 ORDER BY time ASC
	`, submissionID)
	if err != nil {
		return nil, fmt.Errorf("query resource_usage: %w", err)
	}
	defer rows.Close()

	var records []ResourceUsageRecord
	for rows.Next() {
		var r ResourceUsageRecord
		if err := rows.Scan(&r.Time, &r.SubmissionID, &r.PID, &r.CPUPercent, &r.MemoryBytes, &r.MemoryPercent, &r.DiskReadBytes, &r.DiskWriteBytes); err != nil {
			return nil, fmt.Errorf("scan resource_usage: %w", err)
		}
		records = append(records, r)
	}
	return records, nil
}
