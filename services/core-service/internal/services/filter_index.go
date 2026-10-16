package services

import (
	"fmt"
	"sort"
	"sync"

	"github.com/traceos-lab/core-service/internal/types"
)

// FilterIndex provides an in-memory inverted index for cross-panel event filtering.
// Design reference: Datadog Template Variables (Field:Value filter chips).
//
// Supported dimensions:
//   syscall:*    — filter by syscall name (e.g. syscall:fork, syscall:futex)
//   severity:*   — filter by severity (e.g. severity:critical, severity:warning)
//   process:*    — filter by PID (e.g. process:100)
//   thread:*     — filter by TID (e.g. thread:245)
//   source:*     — filter by source panel (e.g. source:lock, source:memory)
//   type:*       — filter by event type (e.g. type:lock, type:annotation)
//   fd:*         — filter by file descriptor operations
type FilterIndex struct {
	mu        sync.RWMutex
	BySyscall map[string][]int // syscall name -> event indices
	BySeverity map[string][]int // severity -> event indices
	ByProcess  map[string][]int // pid -> event indices
	ByThread   map[string][]int // tid -> event indices
	BySource   map[string][]int // source panel -> event indices
	ByType     map[string][]int // event type -> event indices
	ByFD       map[string][]int // fd operations -> event indices

	// Cross-module links
	crossLinks map[int][]CrossModuleIndex

	// Indexed events
	events []IndexedEvent
}

// IndexedEvent represents an event registered in the filter index.
type IndexedEvent struct {
	Index     int
	Timestamp float64 // ms offset from timeline start
	Type      string
	Field     string
	Value     string
	Severity  string
	Process   string
	Thread    string
	Source    string
	Syscall   string
	FD        string
}

// CrossModuleIndex links events to cross-module correlation data.
type CrossModuleIndex struct {
	EventIndex          int
	FlamegraphHighlight string
	Memory3DRegion      string
	TimelineLabel       string
}

// NewFilterIndex creates an empty filter index with all dimensions initialized.
func NewFilterIndex() *FilterIndex {
	return &FilterIndex{
		BySyscall:  make(map[string][]int),
		BySeverity: make(map[string][]int),
		ByProcess:  make(map[string][]int),
		ByThread:   make(map[string][]int),
		BySource:   make(map[string][]int),
		ByType:     make(map[string][]int),
		ByFD:       make(map[string][]int),
		crossLinks: make(map[int][]CrossModuleIndex),
	}
}

// IndexSyscallTraces indexes syscall events for filtering across all dimensions.
func (fi *FilterIndex) IndexSyscallTraces(traces []types.SyscallEvent, timelineStart float64) {
	fi.mu.Lock()
	defer fi.mu.Unlock()

	for i, t := range traces {
		idx := len(fi.events)
		sev := t.Severity
		if sev == "" {
			sev = "info"
		}
		fi.events = append(fi.events, IndexedEvent{
			Index:     i,
			Timestamp: float64(t.Timestamp.UnixNano())/1e6 - timelineStart,
			Type:      "syscall",
			Field:     t.Syscall,
			Value:     t.Syscall,
			Severity:  sev,
			Process:   fmt.Sprintf("pid:%d", t.PID),
			Thread:    fmt.Sprintf("tid:%d", t.TID),
			Syscall:   t.Syscall,
		})

		// Index by syscall
		fi.BySyscall[t.Syscall] = append(fi.BySyscall[t.Syscall], idx)

		// Index by severity
		fi.BySeverity[sev] = append(fi.BySeverity[sev], idx)

		// Index by process (PID)
		pidKey := fmt.Sprintf("%d", t.PID)
		fi.ByProcess[pidKey] = append(fi.ByProcess[pidKey], idx)

		// Index by thread (TID)
		tidKey := fmt.Sprintf("%d", t.TID)
		fi.ByThread[tidKey] = append(fi.ByThread[tidKey], idx)

		// Index by event type
		fi.ByType["syscall"] = append(fi.ByType["syscall"], idx)

		// Index FD-related syscalls
		if isFDSyscall(t.Syscall) {
			fi.ByFD[t.Syscall] = append(fi.ByFD[t.Syscall], idx)
		}
	}
}

// IndexLockEvents indexes lock events for filtering.
func (fi *FilterIndex) IndexLockEvents(events []types.LockEvent, timelineStart float64) {
	fi.mu.Lock()
	defer fi.mu.Unlock()

	for i, e := range events {
		idx := len(fi.events)
		fi.events = append(fi.events, IndexedEvent{
			Index:     i,
			Timestamp: float64(e.Timestamp.UnixNano())/1e6 - timelineStart,
			Type:      "lock",
			Field:     "lock",
			Value:     e.Op,
			Thread:    fmt.Sprintf("tid:%d", e.TID),
			Source:    "lock",
		})

		fi.BySource["lock"] = append(fi.BySource["lock"], idx)
		fi.ByType["lock"] = append(fi.ByType["lock"], idx)
		tidKey := fmt.Sprintf("%d", e.TID)
		fi.ByThread[tidKey] = append(fi.ByThread[tidKey], idx)
		if e.HolderTID > 0 {
			holderKey := fmt.Sprintf("%d", e.HolderTID)
			fi.ByThread[holderKey] = append(fi.ByThread[holderKey], idx)
		}
	}
}

// IndexMemorySnapshots indexes memory snapshot events for filtering.
func (fi *FilterIndex) IndexMemorySnapshots(snapshots []types.MemorySnapshot, timelineStart float64) {
	fi.mu.Lock()
	defer fi.mu.Unlock()

	for i, m := range snapshots {
		idx := len(fi.events)
		fi.events = append(fi.events, IndexedEvent{
			Index:     i,
			Timestamp: float64(m.Timestamp.UnixNano())/1e6 - timelineStart,
			Type:      "memory",
			Field:     "memory",
			Value:     fmt.Sprintf("heap=%dKB", m.HeapSize/1024),
			Source:    "memory",
		})

		fi.BySource["memory"] = append(fi.BySource["memory"], idx)
		fi.ByType["memory"] = append(fi.ByType["memory"], idx)
	}
}

// IndexAnnotations indexes event annotations for filtering.
func (fi *FilterIndex) IndexAnnotations(annotations []types.EventAnnotation, timelineStart float64) {
	fi.mu.Lock()
	defer fi.mu.Unlock()

	for i, a := range annotations {
		idx := len(fi.events)
		fi.events = append(fi.events, IndexedEvent{
			Index:     i,
			Timestamp: float64(a.Timestamp.UnixNano())/1e6 - timelineStart,
			Type:      "annotation",
			Field:     a.Type,
			Value:     a.Label,
			Severity:  a.Severity,
			Source:    a.Source,
		})

		if a.Source != "" {
			fi.BySource[a.Source] = append(fi.BySource[a.Source], idx)
		}
		if a.Severity != "" {
			fi.BySeverity[a.Severity] = append(fi.BySeverity[a.Severity], idx)
		}
		fi.ByType["annotation"] = append(fi.ByType["annotation"], idx)
	}
}

// IndexPerfEvents indexes perf events for filtering.
func (fi *FilterIndex) IndexPerfEvents(events []types.PerfEvent, timelineStart float64) {
	fi.mu.Lock()
	defer fi.mu.Unlock()

	for i, e := range events {
		idx := len(fi.events)
		fi.events = append(fi.events, IndexedEvent{
			Index:     i,
			Timestamp: float64(e.Timestamp.UnixNano())/1e6 - timelineStart,
			Type:      "perf",
			Field:     e.EventType,
			Value:     e.Symbol,
			Process:   fmt.Sprintf("pid:%d", e.PID),
			Thread:    fmt.Sprintf("tid:%d", e.TID),
			Source:    "perf",
		})

		fi.BySource["perf"] = append(fi.BySource["perf"], idx)
		fi.ByType["perf"] = append(fi.ByType["perf"], idx)
		pidKey := fmt.Sprintf("%d", e.PID)
		fi.ByProcess[pidKey] = append(fi.ByProcess[pidKey], idx)
	}
}

// IndexAll indexes all events in an ObsContext.
func (fi *FilterIndex) IndexAll(ctx *types.ObsContext) {
	timelineStart := float64(ctx.TimelineStart.UnixNano()) / 1e6

	fi.IndexSyscallTraces(ctx.SyscallTraces, timelineStart)
	fi.IndexLockEvents(ctx.LockEvents, timelineStart)
	fi.IndexMemorySnapshots(ctx.MemorySnapshots, timelineStart)
	fi.IndexAnnotations(ctx.EventAnnotations, timelineStart)
	fi.IndexPerfEvents(ctx.PerfEvents, timelineStart)
}

// IndexCrossLinks indexes cross-module event links.
func (fi *FilterIndex) IndexCrossLinks(links []CrossModuleLink) {
	fi.mu.Lock()
	defer fi.mu.Unlock()

	for i, link := range links {
		if link.SyscallEvent != nil {
			cidx := CrossModuleIndex{
				EventIndex:          i,
				FlamegraphHighlight: link.FlamegraphHighlight,
				TimelineLabel:       link.TimelineLabel,
			}
			if link.Memory3DRegion != nil {
				cidx.Memory3DRegion = link.Memory3DRegion.Segment
			}
			// Link by PID
			pidKey := fmt.Sprintf("%d", link.Key.PID)
			for _, idx := range fi.ByProcess[pidKey] {
				fi.crossLinks[idx] = append(fi.crossLinks[idx], cidx)
			}
		}
	}
}

// Query executes a conjunctive filter query (AND semantics).
// Returns matching event indices.
// Filter format examples:
//   syscall:fork — filter by syscall name
//   severity:critical — filter by severity level
//   process:100 — filter by PID
//   thread:245 — filter by TID
//   source:lock — filter by source panel
//   type:annotation — filter by event type
//   fd:openat — filter by FD syscall
func (fi *FilterIndex) Query(filters []FilterClause) []int {
	fi.mu.RLock()
	defer fi.mu.RUnlock()

	if len(filters) == 0 {
		all := make([]int, len(fi.events))
		for i := range fi.events {
			all[i] = i
		}
		return all
	}

	// Start with the first filter's results
	var result []int
	for i, f := range filters {
		candidates := fi.resolveQuery(f)
		if i == 0 {
			result = candidates
		} else {
			result = intersectInts(result, candidates)
		}
		if len(result) == 0 {
			return nil
		}
	}
	return result
}

// resolveQuery resolves a single filter clause to matching indices.
func (fi *FilterIndex) resolveQuery(f FilterClause) []int {
	switch f.Field {
	case "syscall":
		return fi.BySyscall[f.Value]
	case "severity":
		return fi.BySeverity[f.Value]
	case "process":
		return fi.ByProcess[f.Value]
	case "thread":
		return fi.ByThread[f.Value]
	case "source":
		return fi.BySource[f.Value]
	case "type":
		return fi.ByType[f.Value]
	case "fd":
		return fi.ByFD[f.Value]
	default:
		return nil
	}
}

// GetFacets returns the current filter facets with all available values.
func (fi *FilterIndex) GetFacets() []types.FilterFacet {
	fi.mu.RLock()
	defer fi.mu.RUnlock()

	return []types.FilterFacet{
		{Field: "syscall", Values: sortedKeys(fi.BySyscall)},
		{Field: "severity", Values: sortedKeys(fi.BySeverity)},
		{Field: "process", Values: sortedKeys(fi.ByProcess)},
		{Field: "thread", Values: sortedKeys(fi.ByThread)},
		{Field: "source", Values: sortedKeys(fi.BySource)},
		{Field: "type", Values: sortedKeys(fi.ByType)},
		{Field: "fd", Values: sortedKeys(fi.ByFD)},
	}
}

// GetEvents returns the indexed events within a time range.
func (fi *FilterIndex) GetEvents(startMs, endMs float64) []IndexedEvent {
	fi.mu.RLock()
	defer fi.mu.RUnlock()

	var result []IndexedEvent
	for _, e := range fi.events {
		if e.Timestamp >= startMs && e.Timestamp <= endMs {
			result = append(result, e)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Timestamp < result[j].Timestamp
	})
	return result
}

// GetCrossLinks returns cross-module links for a given event index.
func (fi *FilterIndex) GetCrossLinks(eventIdx int) []CrossModuleIndex {
	fi.mu.RLock()
	defer fi.mu.RUnlock()
	return fi.crossLinks[eventIdx]
}

// FilterClause represents a single filter criterion.
type FilterClause struct {
	Field string // syscall, severity, process, thread, source, type, fd
	Value string
}

// isFDSyscall checks if a syscall is file-descriptor related.
func isFDSyscall(s string) bool {
	switch s {
	case "open", "openat", "close", "read", "write", "dup", "dup2",
		"pipe", "pipe2", "fcntl", "ioctl", "lseek", "fstat",
		"socket", "bind", "listen", "accept", "connect":
		return true
	}
	return false
}

func intersectInts(a, b []int) []int {
	set := make(map[int]bool, len(b))
	for _, v := range b {
		set[v] = true
	}
	var result []int
	for _, v := range a {
		if set[v] {
			result = append(result, v)
		}
	}
	return result
}

func sortedKeys(m map[string][]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
