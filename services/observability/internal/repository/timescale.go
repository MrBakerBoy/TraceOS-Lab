package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SyscallTrace 系统调用追踪记录
type SyscallTrace struct {
	Time          time.Time              `json:"time"`
	PID           int                    `json:"pid"`
	TID           *int                   `json:"tid,omitempty"`
	SyscallName   string                 `json:"syscall_name"`
	SyscallNumber *int                   `json:"syscall_number,omitempty"`
	Args          *map[string]interface{} `json:"args,omitempty"`
	ReturnValue   int64                  `json:"return_value"`
	ErrorCode     *int                   `json:"error_code,omitempty"`
	ErrorName     *string                `json:"error_name,omitempty"`
	DurationNs    int64                  `json:"duration_ns"`
	CpuID         *int                   `json:"cpu_id,omitempty"`
	SourceLine    *int                   `json:"source_line,omitempty"`
}

// SyscallSummary 追踪汇总
type SyscallSummary struct {
	TotalCount      int64            `json:"total_count"`
	ErrorCount      int64            `json:"error_count"`
	UniqueSyscalls  int64            `json:"unique_syscalls"`
	ExecutionTimeNs int64            `json:"execution_time_ns"`
	SyscallCounts   map[string]int64 `json:"syscall_counts"`
}

// PerfEvent 性能事件
type PerfEvent struct {
	Time      time.Time              `json:"time"`
	PID       int                    `json:"pid"`
	EventType string                 `json:"event_type"`
	EventName string                 `json:"event_name,omitempty"`
	Data      map[string]interface{} `json:"data"`
	CpuID     *int                   `json:"cpu_id,omitempty"`
}

// ResourceUsage 资源使用数据点
type ResourceUsage struct {
	Time            time.Time `json:"time"`
	CpuPercent      float64   `json:"cpu_percent"`
	MemoryBytes     int64     `json:"memory_bytes"`
	MemoryPercent   float64   `json:"memory_percent"`
	DiskReadBytes   int64     `json:"disk_read_bytes"`
	DiskWriteBytes  int64     `json:"disk_write_bytes"`
	NetworkRxBytes  int64     `json:"network_rx_bytes"`
	NetworkTxBytes  int64     `json:"network_tx_bytes"`
}

type TimescaleRepo struct {
	db *pgxpool.Pool
}

func NewTimescaleRepo(db *pgxpool.Pool) *TimescaleRepo {
	return &TimescaleRepo{db: db}
}

// resolveSubmissionID resolves short IDs to full UUIDs.
func (r *TimescaleRepo) resolveSubmissionID(ctx context.Context, id string) (string, error) {
	if len(id) == 36 && strings.Count(id, "-") == 4 {
		return id, nil
	}
	var fullID string
	err := r.db.QueryRow(ctx,
		"SELECT id FROM submissions WHERE id::text LIKE $1 LIMIT 1",
		id+"%").Scan(&fullID)
	if err != nil {
		return "", fmt.Errorf("resolve submission ID %q: %w", id, err)
	}
	return fullID, nil
}


// GetSyscallTraces 获取系统调用追踪
func (r *TimescaleRepo) GetSyscallTraces(ctx context.Context, submissionID string, limit int, errorsOnly bool) ([]SyscallTrace, *SyscallSummary, error) {
	var err error
	submissionID, err = r.resolveSubmissionID(ctx, submissionID)
	if err != nil {
		return nil, nil, err
	}

	where := "WHERE submission_id = $1"
	if errorsOnly {
		where += " AND error_code IS NOT NULL AND error_code != 0"
	}

	// 查询追踪数据
	query := fmt.Sprintf(`
		SELECT time, pid, tid, syscall_name, syscall_number, args,
		       return_value, error_code, error_name, duration_ns, cpu_id, source_line
		FROM syscall_traces %s
		ORDER BY time ASC LIMIT $2
	`, where)

	rows, err := r.db.Query(ctx, query, submissionID, limit)
	if err != nil {
		return nil, nil, fmt.Errorf("query syscall traces: %w", err)
	}
	defer rows.Close()

	var traces []SyscallTrace
	for rows.Next() {
		var t SyscallTrace
		if err := rows.Scan(&t.Time, &t.PID, &t.TID, &t.SyscallName, &t.SyscallNumber,
			&t.Args, &t.ReturnValue, &t.ErrorCode, &t.ErrorName, &t.DurationNs, &t.CpuID, &t.SourceLine); err != nil {
			return nil, nil, err
		}
		traces = append(traces, t)
	}

	// 查询汇总
	summary := &SyscallSummary{SyscallCounts: make(map[string]int64)}
	err = r.db.QueryRow(ctx, `
		SELECT COUNT(*),
		       COUNT(CASE WHEN error_code IS NOT NULL AND error_code != 0 THEN 1 END),
		       COUNT(DISTINCT syscall_name),
		       COALESCE(SUM(duration_ns), 0)
		FROM syscall_traces WHERE submission_id = $1
	`, submissionID).Scan(&summary.TotalCount, &summary.ErrorCount, &summary.UniqueSyscalls, &summary.ExecutionTimeNs)
	if err != nil {
		return traces, summary, nil // 返回追踪数据，汇总使用默认值
	}

	// 查询 syscall 分布
	rows2, _ := r.db.Query(ctx, `
		SELECT syscall_name, COUNT(*) FROM syscall_traces
		WHERE submission_id = $1 GROUP BY syscall_name ORDER BY COUNT(*) DESC LIMIT 20
	`, submissionID)
	if rows2 != nil {
		defer rows2.Close()
		for rows2.Next() {
			var name string
			var count int64
			rows2.Scan(&name, &count)
			summary.SyscallCounts[name] = count
		}
	}

	return traces, summary, nil
}

// GetPerformanceMetrics 获取性能指标
func (r *TimescaleRepo) GetPerformanceMetrics(ctx context.Context, submissionID string) ([]PerfEvent, error) {
	var err error
	submissionID, err = r.resolveSubmissionID(ctx, submissionID)
	if err != nil {
		return nil, err
	}

	rows, err := r.db.Query(ctx, `
		SELECT time, pid, event_type, event_name, data, cpu_id
		FROM perf_events WHERE submission_id = $1
		ORDER BY time ASC LIMIT 1000
	`, submissionID)
	if err != nil {
		return nil, fmt.Errorf("query perf events: %w", err)
	}
	defer rows.Close()

	var events []PerfEvent
	for rows.Next() {
		var e PerfEvent
		if err := rows.Scan(&e.Time, &e.PID, &e.EventType, &e.EventName, &e.Data, &e.CpuID); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}

// GetResourceUsage 获取资源使用
func (r *TimescaleRepo) GetResourceUsage(ctx context.Context, submissionID string) ([]ResourceUsage, error) {
	var err error
	submissionID, err = r.resolveSubmissionID(ctx, submissionID)
	if err != nil {
		return nil, err
	}

	rows, err := r.db.Query(ctx, `
		SELECT time, cpu_percent, memory_bytes, memory_percent,
		       disk_read_bytes, disk_write_bytes, network_rx_bytes, network_tx_bytes
		FROM resource_usage WHERE submission_id = $1
		ORDER BY time ASC LIMIT 1000
	`, submissionID)
	if err != nil {
		return nil, fmt.Errorf("query resource usage: %w", err)
	}
	defer rows.Close()

	var points []ResourceUsage
	for rows.Next() {
		var p ResourceUsage
		if err := rows.Scan(&p.Time, &p.CpuPercent, &p.MemoryBytes, &p.MemoryPercent,
			&p.DiskReadBytes, &p.DiskWriteBytes, &p.NetworkRxBytes, &p.NetworkTxBytes); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	return points, nil
}
