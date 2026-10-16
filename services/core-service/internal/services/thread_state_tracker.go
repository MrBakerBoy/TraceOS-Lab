package services

import (
	"sync"
	"time"
)

// ThreadStateTracker implements thread lifecycle state machine visualization.
// Design reference: VisualVM thread state panel + Linux /proc task state.
type ThreadStateTracker struct {
	mu      sync.RWMutex
	threads map[int]*ThreadState
	events  []ThreadStateEvent
}

// ThreadState represents the lifecycle state of a single thread.
type ThreadState struct {
	TID         int               `json:"tid"`
	PID         int               `json:"pid"`
	Name        string            `json:"name"`
	StateHistory []StateTransition `json:"state_history"`
	CurrentState string           `json:"current_state"`
	TotalRunning time.Duration    `json:"total_running"`
	TotalBlocked time.Duration    `json:"total_blocked"`
	TotalWaiting time.Duration    `json:"total_waiting"`
}

// StateTransition records a state change event.
type StateTransition struct {
	Timestamp   time.Time     `json:"timestamp"`
	FromState   string        `json:"from_state"`
	ToState     string        `json:"to_state"`
	Duration    time.Duration `json:"duration"`  // time spent in from_state
	Reason      string        `json:"reason"`     // scheduled|io_block|lock_wait|sleep|exit
	SourceFile  string        `json:"source_file,omitempty"`
	SourceLine  int           `json:"source_line,omitempty"`
}

// ThreadStateEvent is a raw thread state event from eBPF/sched trace.
type ThreadStateEvent struct {
	Timestamp  time.Time
	TID        int
	PID        int
	OldState   string // R/S/D/T/Z
	NewState   string
	CPU        int
	IsMigration bool
}

// Possible states
const (
	StateRunning    = "R" // running or runnable
	StateSleeping   = "S" // interruptible sleep
	StateDiskSleep  = "D" // uninterruptible disk sleep
	StateStopped    = "T" // stopped by signal
	StateZombie     = "Z" // zombie
	StateDead       = "X" // dead
)

// NewThreadStateTracker creates a new tracker.
func NewThreadStateTracker() *ThreadStateTracker {
	return &ThreadStateTracker{
		threads: make(map[int]*ThreadState),
	}
}

// RecordEvent records a thread state change event (from sched trace or eBPF).
func (tst *ThreadStateTracker) RecordEvent(evt ThreadStateEvent) {
	tst.mu.Lock()
	defer tst.mu.Unlock()

	tst.events = append(tst.events, evt)

	ts, ok := tst.threads[evt.TID]
	if !ok {
		ts = &ThreadState{
			TID:          evt.TID,
			PID:          evt.PID,
			CurrentState: evt.NewState,
		}
		tst.threads[evt.TID] = ts
	}

	// Record state transition
	transition := StateTransition{
		Timestamp:   evt.Timestamp,
		FromState:   ts.CurrentState,
		ToState:     evt.NewState,
		Reason:      tst.inferReason(evt),
	}

	// Calculate duration of previous state if we have history
	if len(ts.StateHistory) > 0 {
		last := &ts.StateHistory[len(ts.StateHistory)-1]
		last.Duration = evt.Timestamp.Sub(last.Timestamp)
	}

	ts.StateHistory = append(ts.StateHistory, transition)
	ts.CurrentState = evt.NewState

	// Update cumulative times
	dur := time.Duration(0)
	if len(ts.StateHistory) > 1 {
		dur = ts.StateHistory[len(ts.StateHistory)-1].Duration
	}
	switch transition.FromState {
	case StateRunning:
		ts.TotalRunning += dur
	case StateSleeping, StateDiskSleep:
		ts.TotalBlocked += dur
	case StateStopped:
		ts.TotalWaiting += dur
	}
}

// GetSummary returns a summary of all tracked threads.
func (tst *ThreadStateTracker) GetSummary() []ThreadSummary {
	tst.mu.RLock()
	defer tst.mu.RUnlock()

	var summaries []ThreadSummary
	for _, ts := range tst.threads {
		total := ts.TotalRunning + ts.TotalBlocked + ts.TotalWaiting
		if total == 0 {
			continue
		}
		summaries = append(summaries, ThreadSummary{
			TID:        ts.TID,
			PID:        ts.PID,
			RunningPct: float64(ts.TotalRunning) / float64(total) * 100,
			BlockedPct: float64(ts.TotalBlocked) / float64(total) * 100,
			WaitingPct: float64(ts.TotalWaiting) / float64(total) * 100,
			Transitions: len(ts.StateHistory),
		})
	}
	return summaries
}

// GetThread returns full state history for a thread.
func (tst *ThreadStateTracker) GetThread(tid int) *ThreadState {
	tst.mu.RLock()
	defer tst.mu.RUnlock()
	return tst.threads[tid]
}

func (tst *ThreadStateTracker) inferReason(evt ThreadStateEvent) string {
	switch evt.NewState {
	case StateRunning:
		if evt.IsMigration {
			return "migration"
		}
		return "scheduled"
	case StateSleeping:
		return "io_block"
	case StateDiskSleep:
		return "disk_wait"
	case StateStopped:
		return "signal"
	case StateZombie, StateDead:
		return "exit"
	default:
		return "unknown"
	}
}

// ThreadSummary holds aggregate thread statistics.
type ThreadSummary struct {
	TID         int     `json:"tid"`
	PID         int     `json:"pid"`
	RunningPct  float64 `json:"running_pct"`
	BlockedPct  float64 `json:"blocked_pct"`
	WaitingPct  float64 `json:"waiting_pct"`
	Transitions int     `json:"transitions"`
}
