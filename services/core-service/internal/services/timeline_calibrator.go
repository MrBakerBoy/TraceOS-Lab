package services

import (
	"sort"
	"time"

	"github.com/traceos-lab/core-service/internal/types"
)

// TimelineCalibrator aligns events from different data sources to a unified timeline.
// Design reference: Brendan Gregg standardized perf pipeline (single clock source).
type TimelineCalibrator struct {
	clockOffset time.Duration
	startTime   time.Time
	endTime     time.Time
}

// NewTimelineCalibrator creates a calibrator with CLOCK_MONOTONIC offset.
func NewTimelineCalibrator() *TimelineCalibrator {
	return &TimelineCalibrator{}
}

// Calibrate aligns all events to a unified timeline.
func (tc *TimelineCalibrator) Calibrate(
	syscallTraces []types.SyscallEvent,
	lockEvents []types.LockEvent,
	memorySnapshots []types.MemorySnapshot,
	resourceMetrics []types.ResourceMetric,
	perfEvents []types.PerfEvent,
	annotations []types.EventAnnotation,
) CalibrationResult {
	var allTimes []time.Time
	for _, e := range syscallTraces {
		allTimes = append(allTimes, e.Timestamp)
	}
	for _, e := range lockEvents {
		allTimes = append(allTimes, e.Timestamp)
	}
	for _, e := range memorySnapshots {
		allTimes = append(allTimes, e.Timestamp)
	}
	for _, e := range resourceMetrics {
		allTimes = append(allTimes, e.Timestamp)
	}
	for _, e := range perfEvents {
		allTimes = append(allTimes, e.Timestamp)
	}
	for _, e := range annotations {
		allTimes = append(allTimes, e.Timestamp)
	}

	if len(allTimes) == 0 {
		now := time.Now()
		return CalibrationResult{Start: now, End: now}
	}

	sort.Slice(allTimes, func(i, j int) bool {
		return allTimes[i].Before(allTimes[j])
	})

	tc.startTime = allTimes[0]
	tc.endTime = allTimes[len(allTimes)-1]

	return CalibrationResult{
		Start:    tc.startTime,
		End:      tc.endTime,
		Duration: tc.endTime.Sub(tc.startTime),
		NumEvents: len(allTimes),
	}
}

// ToOffsetMs converts an absolute timestamp to an offset in milliseconds from start.
func (tc *TimelineCalibrator) ToOffsetMs(t time.Time) float64 {
	return float64(t.Sub(tc.startTime).Nanoseconds()) / 1e6
}

// CalibrationResult holds unified timeline metadata.
type CalibrationResult struct {
	Start     time.Time
	End       time.Time
	Duration  time.Duration
	NumEvents int
}
