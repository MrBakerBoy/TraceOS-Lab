package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/services"
)

// RaceHandler serves data race detection analysis from syscall traces.
// Uses a stateless approach: creates a fresh RaceDetector per request and feeds
// it simulated memory access events derived from multi-thread syscall patterns.
type RaceHandler struct {
	subRepo *repository.SubmissionRepo
}

// NewRaceHandler creates a new RaceHandler.
func NewRaceHandler(subRepo *repository.SubmissionRepo) *RaceHandler {
	return &RaceHandler{subRepo: subRepo}
}

// GetRaceReport handles GET /api/v1/submissions/:id/race-report
// Analyzes concurrent memory access patterns from syscall traces using
// a TSan-style Happens-Before detection algorithm.
func (h *RaceHandler) GetRaceReport(c *gin.Context) {
	submissionID := c.Param("id")

	sub, err := h.subRepo.GetByID(c, submissionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "submission not found"})
		return
	}

	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)
	if role != "teacher" && role != "admin" && sub.StudentID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return
	}

	// Fetch syscall traces
	traces, err := h.subRepo.GetSyscallTraces(c, submissionID, 5000, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch traces"})
		return
	}

	// Create a fresh RaceDetector and feed it simulated access events
	detector := services.NewRaceDetector()
	accessEvents := extractAccessEvents(traces)

	// Track lock state per TID for futex operations
	tidLocked := make(map[int]bool)
	lockAddrs := make(map[int]uint64)

	for _, evt := range accessEvents {
		switch evt.EventType {
		case "futex_lock":
			detector.RecordLock(evt.Address, evt.TID)
			tidLocked[evt.TID] = true
			lockAddrs[evt.TID] = evt.Address
		case "futex_unlock":
			if lockAddr, ok := lockAddrs[evt.TID]; ok {
				detector.RecordUnlock(lockAddr, evt.TID)
			}
			tidLocked[evt.TID] = false
			delete(lockAddrs, evt.TID)
		case "shared_access":
			locked := tidLocked[evt.TID]
			detector.RecordAccess(evt.Address, evt.TID, evt.AccessType,
				evt.SourceFile, evt.SourceLine, evt.Timestamp, locked)
		}
	}

	// Run TSan-style race detection
	races, summary := detector.DetectRacesWithSummary()
	if races == nil {
		races = []services.RaceResult{}
	}

	c.JSON(http.StatusOK, gin.H{
		"submission_id": sub.ID,
		"experiment_id": sub.ExperimentID,
		"trace_count":   len(traces),
		"access_events": len(accessEvents),
		"races":         races,
		"race_summary":  summary,
		"has_races":     len(races) > 0,
		"thread_count":  detector.GetThreadCount(),
		"address_count": detector.GetUniqueAddressCount(),
	})
}

// accessEvent holds a parsed memory access event from syscall traces.
type accessEvent struct {
	Address    uint64
	TID        int
	AccessType string // "read" or "write"
	EventType  string // "futex_lock", "futex_unlock", "shared_access"
	Timestamp  time.Time
	SourceFile string
	SourceLine int
}

// extractAccessEvents scans syscall traces for multi-thread memory access patterns.
// Detects: clone (thread creation), futex (synchronization), shared file I/O.
func extractAccessEvents(traces []repository.SyscallTraceRecord) []accessEvent {
	var events []accessEvent

	// Mock memory addresses: assign unique addresses per unique (TID, syscall) pair
	addrMap := make(map[string]uint64)
	addrCounter := uint64(0x7f0000000000) // Start from a high address

	getOrCreateAddr := func(key string) uint64 {
		if addr, ok := addrMap[key]; ok {
			return addr
		}
		addrCounter += 64 // Simulate different addresses
		addrMap[key] = addrCounter
		return addrCounter
	}

	for i, t := range traces {
		tid := t.PID // Use PID as TID for process-level analysis
		if t.PID == 0 {
			tid = 1
		}

		switch t.SyscallName {
		case "futex":
			// futex may involve lock/unlock semantics
			if t.ReturnValue == 0 {
				// Successful futex operation — treat as lock acquisition
				lockAddr := getOrCreateAddr("futex_lock_" + string(rune(tid)))
				events = append(events, accessEvent{
					Address:    lockAddr,
					TID:        tid,
					AccessType: "write",
					EventType:  "futex_lock",
					Timestamp:  t.Time,
					SourceFile: "trace",
					SourceLine: i + 1,
				})
				// Also record the shared data access under lock
				dataAddr := getOrCreateAddr("shared_data_" + string(rune(tid%5)))
				events = append(events, accessEvent{
					Address:    dataAddr,
					TID:        tid,
					AccessType: "write",
					EventType:  "shared_access",
					Timestamp:  t.Time,
					SourceFile: "trace",
					SourceLine: i + 1,
				})
			} else if t.ErrorName != "" {
				// Failed futex — could be contention or EAGAIN
				lockAddr := getOrCreateAddr("futex_lock_" + string(rune(tid)))
				events = append(events, accessEvent{
					Address:    lockAddr,
					TID:        tid,
					AccessType: "write",
					EventType:  "futex_unlock",
					Timestamp:  t.Time,
					SourceFile: "trace",
					SourceLine: i + 1,
				})
			}
		case "clone":
			// Thread/process creation — new TID starts accessing shared memory
			newTID := tid + 1
			dataAddr := getOrCreateAddr("shared_" + string(rune(i)))
			events = append(events, accessEvent{
				Address:    dataAddr,
				TID:        newTID,
				AccessType: "write",
				EventType:  "shared_access",
				Timestamp:  t.Time,
				SourceFile: "trace",
				SourceLine: i + 1,
			})
		case "write", "read", "pread64", "pwrite64":
			// File I/O across threads can cause races on shared file descriptors
			dataAddr := getOrCreateAddr("fd_shared_" + string(rune(tid%3)))
			accessType := "read"
			if t.SyscallName == "write" || t.SyscallName == "pwrite64" {
				accessType = "write"
			}
			events = append(events, accessEvent{
				Address:    dataAddr,
				TID:        tid,
				AccessType: accessType,
				EventType:  "shared_access",
				Timestamp:  t.Time,
				SourceFile: "trace",
				SourceLine: i + 1,
			})
		}
	}

	return events
}
