package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/traceos-lab/observability/internal/model"
)

// GetMemoryLayout retrieves the ordered memory-layout snapshots for a submission.
func (r *TimescaleRepo) GetMemoryLayout(ctx context.Context, submissionID string) ([]model.MemoryLayoutSnapshot, error) {
	rows, err := r.db.Query(ctx, `
		SELECT timestamp, text_start, text_size, data_start, data_size,
		       bss_start, bss_size, heap_start, heap_size, stack_start, stack_size,
		       mmap_regions
		FROM memory_layouts
		WHERE submission_id = $1
		ORDER BY timestamp ASC
	`, submissionID)
	if err != nil {
		return nil, fmt.Errorf("query memory_layouts: %w", err)
	}
	defer rows.Close()

	var snapshots []model.MemoryLayoutSnapshot
	for rows.Next() {
		var s model.MemoryLayoutSnapshot
		var regionsRaw []byte
		if err := rows.Scan(
			&s.Timestamp, &s.TextStart, &s.TextSize, &s.DataStart, &s.DataSize,
			&s.BSSStart, &s.BSSSize, &s.HeapStart, &s.HeapSize, &s.StackStart, &s.StackSize,
			&regionsRaw,
		); err != nil {
			return nil, fmt.Errorf("scan memory_layouts: %w", err)
		}
		if len(regionsRaw) > 0 {
			if err := json.Unmarshal(regionsRaw, &s.MmapRegions); err != nil {
				return nil, fmt.Errorf("unmarshal mmap_regions: %w", err)
			}
		}
		snapshots = append(snapshots, s)
	}
	return snapshots, nil
}

// MemoryLayoutRecord is the write-side representation used by the evaluation
// pipeline when persisting collected snapshots.
type MemoryLayoutRecord struct {
	SubmissionID string
	Timestamp    time.Time
	Snapshot     model.MemoryLayoutSnapshot
}

// InsertMemoryLayouts bulk inserts memory-layout snapshots for a submission.
func (r *TimescaleRepo) InsertMemoryLayouts(ctx context.Context, records []MemoryLayoutRecord) error {
	if len(records) == 0 {
		return nil
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, rec := range records {
		regionsJSON, err := json.Marshal(rec.Snapshot.MmapRegions)
		if err != nil {
			return fmt.Errorf("marshal mmap_regions: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO memory_layouts
			    (submission_id, timestamp, text_start, text_size, data_start, data_size,
			     bss_start, bss_size, heap_start, heap_size, stack_start, stack_size, mmap_regions)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		`, rec.SubmissionID, rec.Timestamp,
			rec.Snapshot.TextStart, rec.Snapshot.TextSize,
			rec.Snapshot.DataStart, rec.Snapshot.DataSize,
			rec.Snapshot.BSSStart, rec.Snapshot.BSSSize,
			rec.Snapshot.HeapStart, rec.Snapshot.HeapSize,
			rec.Snapshot.StackStart, rec.Snapshot.StackSize,
			regionsJSON,
		); err != nil {
			return fmt.Errorf("insert memory_layouts: %w", err)
		}
	}
	return tx.Commit(ctx)
}
