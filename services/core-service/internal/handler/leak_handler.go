package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/services"
)

// LeakHandler serves memory leak detection analysis from syscall traces.
// Uses a stateless approach: creates a fresh LeakDetector per request and feeds
// it simulated alloc/free events derived from mmap/munmap/brk syscall patterns.
type LeakHandler struct {
	subRepo *repository.SubmissionRepo
}

// NewLeakHandler creates a new LeakHandler.
func NewLeakHandler(subRepo *repository.SubmissionRepo) *LeakHandler {
	return &LeakHandler{subRepo: subRepo}
}

// GetLeakReport handles GET /api/v1/submissions/:id/leak-report
// Analyzes memory allocation/free patterns from syscall traces and
// produces a Valgrind/Heaptrack-style leak detection report.
func (h *LeakHandler) GetLeakReport(c *gin.Context) {
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

	// Create a fresh LeakDetector and feed it memory events derived from traces
	detector := services.NewLeakDetector()
	memEvents := extractMemoryEvents(traces)

	for _, evt := range memEvents {
		if evt.IsFree {
			detector.RecordFree(evt.Address, evt.Timestamp)
		} else {
			detector.RecordAlloc(evt.Address, evt.Size, evt.SourceFile, evt.SourceLine, nil, evt.Timestamp)
		}
	}

	// Run leak detection pipeline
	leaks := detector.Analyze()
	if leaks == nil {
		leaks = []services.LeakResult{}
	}
	summary := detector.GetHeaptrackSummary()
	history := detector.GetHeapHistory()

	// Categorize leaks
	var definite, indirect, possible, reachable int
	for _, l := range leaks {
		switch l.Severity {
		case services.DefinitelyLost:
			definite++
		case services.IndirectlyLost:
			indirect++
		case services.PossiblyLost:
			possible++
		case services.StillReachable:
			reachable++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"submission_id":     sub.ID,
		"experiment_id":     sub.ExperimentID,
		"trace_count":       len(traces),
		"mem_event_count":   len(memEvents),
		"leaks":             leaks,
		"heaptrack_summary": summary,
		"heap_history":      history,
		"leak_summary": gin.H{
			"definitely_lost": definite,
			"indirectly_lost": indirect,
			"possibly_lost":   possible,
			"still_reachable": reachable,
			"total_leaks":     len(leaks),
			"has_critical":    definite > 0,
		},
	})
}

// memoryEvent holds a parsed memory allocation or free event.
type memoryEvent struct {
	Address    uint64
	Size       uint64
	IsFree     bool
	Timestamp  time.Time
	SourceFile string
	SourceLine int
}

// extractMemoryEvents scans syscall traces for memory-related operations
// and converts them into simulated alloc/free events.
func extractMemoryEvents(traces []repository.SyscallTraceRecord) []memoryEvent {
	var events []memoryEvent
	// Track mmap addresses for pairing with munmap
	mmapAddrs := make(map[uint64]uint64) // addr → size

	for i, t := range traces {
		switch t.SyscallName {
		case "mmap", "mmap2":
			// mmap is a memory allocation
			addr := uint64(t.ReturnValue)
			if addr > 0 && addr != ^uint64(0) {
				// Estimate size from syscall arguments pattern
				size := estimateMmapSize(t)
				mmapAddrs[addr] = size
				events = append(events, memoryEvent{
					Address:    addr,
					Size:       size,
					IsFree:     false,
					Timestamp:  t.Time,
					SourceFile: "trace",
					SourceLine: i + 1,
				})
			}
		case "munmap":
			// munmap frees a mapping — pair with prior mmap
			addr := estimateMunmapAddr(t)
			if size, ok := mmapAddrs[addr]; ok {
				events = append(events, memoryEvent{
					Address:    addr,
					Size:       size,
					IsFree:     true,
					Timestamp:  t.Time,
					SourceFile: "trace",
					SourceLine: i + 1,
				})
				delete(mmapAddrs, addr)
			}
		case "brk":
			// brk syscall adjusts program break (heap boundary)
			if t.ReturnValue >= 0 {
				addr := uint64(t.ReturnValue)
				size := uint64(4096) // typical page size for brk
				events = append(events, memoryEvent{
					Address:    addr,
					Size:       size,
					IsFree:     false, // brk extends heap
					Timestamp:  t.Time,
					SourceFile: "trace",
					SourceLine: i + 1,
				})
			}
		}
	}

	return events
}

// estimateMmapSize estimates the size of an mmap allocation.
// In a real implementation this would parse the syscall arguments from strace.
func estimateMmapSize(t repository.SyscallTraceRecord) uint64 {
	// Default: estimate 4KB page for small mmap, 64KB for larger ones
	// If return value is large, it's likely a large mapping
	if t.ReturnValue > 0x10000000 {
		return uint64(1 << 20) // 1MB for large mappings
	}
	return uint64(1 << 16) // 64KB default
}

// estimateMunmapAddr estimates the address being unmmaped.
// In a real implementation this would parse the syscall arguments from strace.
func estimateMunmapAddr(t repository.SyscallTraceRecord) uint64 {
	// Use return value as address hint; 0 for success indicates free completed
	return uint64(t.ReturnValue) + 1 // simplified heuristic
}
