package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DeadlockReportRecord mirrors the deadlock_reports table row.
// It stores the eBPF (bpftrace futex tracepoint + Wait-For Graph) detection
// result so it survives the in-memory task TTL and can be replayed by the
// frontend / AI analysis after the observation finishes.
type DeadlockReportRecord struct {
	SubmissionID  string                   `json:"submission_id"`
	PID           int                      `json:"pid"`
	Detected      bool                     `json:"detected"`
	Cycle         []int                    `json:"cycle"`
	Details       []string                 `json:"details"`
	Fix           string                   `json:"fix"`
	LockGraph     map[string]interface{}   `json:"lock_graph"` // {threads:[], locks:[]}
	SyscallCounts map[string]int           `json:"syscall_counts"`
	MemSnapshots  []map[string]interface{} `json:"mem_snapshots"`
	Probes        []string                 `json:"probes"`
	Status        string                   `json:"status"`
}

type DeadlockReportRepo struct {
	db *pgxpool.Pool
}

func NewDeadlockReportRepo(db *pgxpool.Pool) *DeadlockReportRepo {
	return &DeadlockReportRepo{db: db}
}

// InsertDeadlockReport persists a single observation result.
// submission_id may be empty for ad-hoc live observations (column is nullable).
func (r *DeadlockReportRepo) InsertDeadlockReport(ctx context.Context, rec DeadlockReportRecord) (string, error) {
	cycleJSON, _ := json.Marshal(rec.Cycle)
	detailsJSON, _ := json.Marshal(rec.Details)
	graphJSON, _ := json.Marshal(rec.LockGraph)
	syscallJSON, _ := json.Marshal(rec.SyscallCounts)
	memJSON, _ := json.Marshal(rec.MemSnapshots)
	probesJSON, _ := json.Marshal(rec.Probes)

	var subID interface{}
	if rec.SubmissionID != "" {
		subID = rec.SubmissionID
	}

	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO deadlock_reports
			(submission_id, pid, detected, cycle, details, fix, lock_graph, syscall_counts, mem_snapshots, probes, status, start_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
		RETURNING id
	`,
		subID, rec.PID, rec.Detected, cycleJSON, detailsJSON, rec.Fix,
		graphJSON, syscallJSON, memJSON, probesJSON, rec.Status,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("insert deadlock report: %w", err)
	}
	return id, nil
}

// GetDeadlockReport fetches the most recent deadlock report for a submission.
func (r *DeadlockReportRepo) GetDeadlockReport(ctx context.Context, submissionID string) (*DeadlockReportRecord, error) {
	row := r.db.QueryRow(ctx, `
		SELECT submission_id, pid, detected, cycle, details, fix, lock_graph, syscall_counts, mem_snapshots, probes, status
		FROM deadlock_reports
		WHERE submission_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, submissionID)

	var rec DeadlockReportRecord
	var cycleJSON, detailsJSON, graphJSON, syscallJSON, memJSON, probesJSON []byte
	var subID *string
	if err := row.Scan(&subID, &rec.PID, &rec.Detected, &cycleJSON, &detailsJSON, &rec.Fix,
		&graphJSON, &syscallJSON, &memJSON, &probesJSON, &rec.Status); err != nil {
		return nil, fmt.Errorf("get deadlock report: %w", err)
	}
	if subID != nil {
		rec.SubmissionID = *subID
	}
	_ = json.Unmarshal(cycleJSON, &rec.Cycle)
	_ = json.Unmarshal(detailsJSON, &rec.Details)
	_ = json.Unmarshal(graphJSON, &rec.LockGraph)
	_ = json.Unmarshal(syscallJSON, &rec.SyscallCounts)
	_ = json.Unmarshal(memJSON, &rec.MemSnapshots)
	_ = json.Unmarshal(probesJSON, &rec.Probes)
	return &rec, nil
}
