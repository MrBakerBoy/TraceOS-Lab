package services

import (
	"fmt"
	"sort"
	"time"

	"github.com/traceos-lab/core-service/internal/types"
)

// EventLinker correlates events across observability modules:
//   eBPF syscall events → Trace timeline annotations → Flamegraph highlights → Memory 3D positioning
//
// Design reference: Datadog Event Overlay — cross-source event correlation with
// unified timeline and bidirectional linking.

// LinkKey uniquely identifies a cross-module event link.
type LinkKey struct {
	Timestamp  time.Time
	PID        int
	TID        int
	EventType  string // syscall|lock|mem|sched|perf|annotation
}

// CrossModuleLink connects events from different observability sources.
type CrossModuleLink struct {
	Key           LinkKey
	SyscallEvent  *types.SyscallEvent   `json:"syscall_event,omitempty"`
	LockEvent     *types.LockEvent      `json:"lock_event,omitempty"`
	MemorySnapshot *types.MemorySnapshot `json:"memory_snapshot,omitempty"`
	PerfEvent     *types.PerfEvent      `json:"perf_event,omitempty"`
	Annotation    *types.EventAnnotation `json:"annotation,omitempty"`

	// Derived links
	FlamegraphHighlight string  `json:"flamegraph_highlight,omitempty"` // function name to highlight
	Memory3DRegion      *Memory3DRef `json:"memory_3d_region,omitempty"`  // 3D memory layout region
	TimelineLabel       string  `json:"timeline_label,omitempty"`
}

// Memory3DRef references a region in the memory 3D visualization.
type Memory3DRef struct {
	Segment    string  `json:"segment"`    // text|data|bss|heap|stack|mmap
	StartAddr  uint64  `json:"start_addr"`
	Size       uint64  `json:"size"`
	Highlight  bool    `json:"highlight"`
	Color      string  `json:"color,omitempty"` // hex color for highlighting
	Label      string  `json:"label,omitempty"`
}

// EventLinker manages cross-module event correlation.
type EventLinker struct {
	links []CrossModuleLink
}

// NewEventLinker creates a new event linker.
func NewEventLinker() *EventLinker {
	return &EventLinker{}
}

// LinkAll correlates all event types in an ObsContext and returns cross-module links.
func (el *EventLinker) LinkAll(ctx *types.ObsContext) []CrossModuleLink {
	el.links = nil

	// Phase 1: Build timeline by PID/TID grouping
	pidTimelines := el.buildPIDTimelines(ctx)

	// Phase 2: Link syscall events → trace annotations
	el.linkSyscallToAnnotations(ctx.SyscallTraces, ctx.EventAnnotations)

	// Phase 3: Link syscall events → lock events (futex correlation)
	el.linkSyscallToLocks(ctx.SyscallTraces, ctx.LockEvents)

	// Phase 4: Link memory snapshots → syscall events (mmap/brk correlation)
	el.linkMemoryToSyscalls(ctx.MemorySnapshots, ctx.SyscallTraces)

	// Phase 5: Link perf events → flamegraph functions
	el.linkPerfToFlamegraph(ctx.PerfEvents, ctx.FlameGraph)

	// Phase 6: Generate timeline labels for all linked events
	el.generateTimelineLabels()

	// Phase 7: Sort by timestamp
	sort.Slice(el.links, func(i, j int) bool {
		return el.links[i].Key.Timestamp.Before(el.links[j].Key.Timestamp)
	})

	// Attach PID timeline context
	_ = pidTimelines

	return el.links
}

// buildPIDTimelines builds per-PID event timelines.
func (el *EventLinker) buildPIDTimelines(ctx *types.ObsContext) map[int][]LinkKey {
	timelines := make(map[int][]LinkKey)

	for _, e := range ctx.SyscallTraces {
		key := LinkKey{Timestamp: e.Timestamp, PID: e.PID, TID: e.TID, EventType: "syscall"}
		timelines[e.PID] = append(timelines[e.PID], key)
	}
	for _, e := range ctx.LockEvents {
		key := LinkKey{Timestamp: e.Timestamp, PID: 0, TID: e.TID, EventType: "lock"}
		timelines[e.TID] = append(timelines[e.TID], key)
	}
	for _, e := range ctx.PerfEvents {
		key := LinkKey{Timestamp: e.Timestamp, PID: e.PID, TID: e.TID, EventType: "perf"}
		timelines[e.PID] = append(timelines[e.PID], key)
	}

	return timelines
}

// linkSyscallToAnnotations links syscall events to timeline annotations.
func (el *EventLinker) linkSyscallToAnnotations(syscalls []types.SyscallEvent, annotations []types.EventAnnotation) {
	annoMap := make(map[string]*types.EventAnnotation)
	for i := range annotations {
		a := &annotations[i]
		key := fmt.Sprintf("%d_%d", a.Timestamp.UnixMilli(), a.RelatedTID)
		annoMap[key] = a
	}

	for i := range syscalls {
		s := &syscalls[i]
		key := fmt.Sprintf("%d_%d", s.Timestamp.UnixMilli(), s.TID)
		if a, ok := annoMap[key]; ok {
			link := CrossModuleLink{
				Key:          LinkKey{Timestamp: s.Timestamp, PID: s.PID, TID: s.TID, EventType: "syscall"},
				SyscallEvent: s,
				Annotation:   a,
				TimelineLabel: fmt.Sprintf("%s — %s", s.SemanticLabel, a.Label),
			}

			// Generate flamegraph highlight from syscall type
			if s.Syscall == "mmap" || s.Syscall == "brk" {
				link.FlamegraphHighlight = "malloc"
			} else if s.Syscall == "futex" {
				link.FlamegraphHighlight = "pthread_mutex_lock"
			} else if s.Syscall == "write" || s.Syscall == "read" {
				link.FlamegraphHighlight = s.Syscall
			}

			el.links = append(el.links, link)
		}
	}
}

// linkSyscallToLocks links futex syscalls to lock events.
func (el *EventLinker) linkSyscallToLocks(syscalls []types.SyscallEvent, locks []types.LockEvent) {
	const timeWindow = 10 * time.Millisecond

	for i := range syscalls {
		s := &syscalls[i]
		if s.Syscall != "futex" {
			continue
		}

		for j := range locks {
			l := &locks[j]
			if l.TID != s.TID {
				continue
			}
			diff := s.Timestamp.Sub(l.Timestamp)
			if diff < 0 {
				diff = -diff
			}
			if diff <= timeWindow {
				link := CrossModuleLink{
					Key:          LinkKey{Timestamp: s.Timestamp, PID: s.PID, TID: s.TID, EventType: "lock"},
					SyscallEvent: s,
					LockEvent:    l,
					TimelineLabel: fmt.Sprintf("futex → %s %s (wait=%dns)",
						l.Op, l.LockType, l.WaitDurationNs),
				}

				// Flamegraph highlight for lock contention
				if l.WaitDurationNs > 1_000_000 { // >1ms wait
					link.FlamegraphHighlight = "lock_contention"
				}

				el.links = append(el.links, link)
				break
			}
		}
	}
}

// linkMemoryToSyscalls links memory snapshots to mmap/brk syscalls.
func (el *EventLinker) linkMemoryToSyscalls(snapshots []types.MemorySnapshot, syscalls []types.SyscallEvent) {
	const timeWindow = 50 * time.Millisecond

	for i := range snapshots {
		m := &snapshots[i]
		for j := range syscalls {
			s := &syscalls[j]
			if s.Syscall != "mmap" && s.Syscall != "brk" && s.Syscall != "munmap" {
				continue
			}
			diff := m.Timestamp.Sub(s.Timestamp)
			if diff < 0 {
				diff = -diff
			}
			if diff <= timeWindow {
				link := CrossModuleLink{
					Key:            LinkKey{Timestamp: m.Timestamp, PID: s.PID, TID: s.TID, EventType: "mem"},
					SyscallEvent:   s,
					MemorySnapshot: m,
					TimelineLabel:  fmt.Sprintf("%s → heap=%dKB", s.Syscall, m.HeapSize/1024),
				}

				// Memory 3D region reference
				if s.Syscall == "brk" || s.Syscall == "mmap" {
					segment := "heap"
					if s.Syscall == "mmap" {
						segment = "mmap"
					}
					link.Memory3DRegion = &Memory3DRef{
						Segment:   segment,
						StartAddr: m.HeapStart,
						Size:      m.HeapSize,
						Highlight: true,
						Color:     "#FF6B6B",
						Label:     fmt.Sprintf("Heap growth via %s", s.Syscall),
					}
				}

				el.links = append(el.links, link)
				break
			}
		}
	}
}

// linkPerfToFlamegraph links perf events to flamegraph hot functions.
func (el *EventLinker) linkPerfToFlamegraph(perfEvents []types.PerfEvent, fg *types.FlameGraphData) {
	if fg == nil || len(fg.HotFunctions) == 0 {
		return
	}

	// Build hot function lookup
	hotFuncs := make(map[string]*types.HotFunction)
	for i := range fg.HotFunctions {
		h := &fg.HotFunctions[i]
		hotFuncs[h.Name] = h
	}

	for i := range perfEvents {
		p := &perfEvents[i]
		if p.Symbol == "" {
			continue
		}

		if hf, ok := hotFuncs[p.Symbol]; ok {
			link := CrossModuleLink{
				Key:                 LinkKey{Timestamp: p.Timestamp, PID: p.PID, TID: p.TID, EventType: "perf"},
				PerfEvent:           p,
				FlamegraphHighlight: hf.Name,
				TimelineLabel:       fmt.Sprintf("perf: %s (count=%d)", p.Symbol, p.Count),
			}
			el.links = append(el.links, link)
		}
	}
}

// generateTimelineLabels generates descriptive labels for all linked events.
func (el *EventLinker) generateTimelineLabels() {
	for i := range el.links {
		if el.links[i].TimelineLabel != "" {
			continue
		}
		l := &el.links[i]
		switch l.Key.EventType {
		case "syscall":
			if l.SyscallEvent != nil {
				l.TimelineLabel = fmt.Sprintf("%s (TID=%d)", l.SyscallEvent.Syscall, l.Key.TID)
			}
		case "lock":
			if l.LockEvent != nil {
				l.TimelineLabel = fmt.Sprintf("lock: %s %s", l.LockEvent.LockType, l.LockEvent.Op)
			}
		case "mem":
			if l.MemorySnapshot != nil {
				l.TimelineLabel = fmt.Sprintf("mem: heap=%dKB", l.MemorySnapshot.HeapSize/1024)
			}
		case "perf":
			if l.PerfEvent != nil {
				l.TimelineLabel = fmt.Sprintf("perf: %s", l.PerfEvent.EventType)
			}
		}
	}
}

// GetLinksForRegion returns all links that reference a specific flamegraph function.
func (el *EventLinker) GetLinksForFlamegraph(funcName string) []CrossModuleLink {
	var result []CrossModuleLink
	for _, l := range el.links {
		if l.FlamegraphHighlight == funcName {
			result = append(result, l)
		}
	}
	return result
}

// GetLinksForMemorySegment returns all links that reference a memory segment.
func (el *EventLinker) GetLinksForMemorySegment(segment string) []CrossModuleLink {
	var result []CrossModuleLink
	for _, l := range el.links {
		if l.Memory3DRegion != nil && l.Memory3DRegion.Segment == segment {
			result = append(result, l)
		}
	}
	return result
}

// GetLinksForTimestamp returns all links near a given timestamp.
func (el *EventLinker) GetLinksForTimestamp(ts time.Time, window time.Duration) []CrossModuleLink {
	var result []CrossModuleLink
	for _, l := range el.links {
		diff := l.Key.Timestamp.Sub(ts)
		if diff < 0 {
			diff = -diff
		}
		if diff <= window {
			result = append(result, l)
		}
	}
	return result
}

// GenerateEvidenceLinks converts CrossModuleLinks into EvidenceLinks for frontend navigation.
// Each link maps a diagnosis conclusion to a specific visualization panel target.
func (el *EventLinker) GenerateEvidenceLinks(ctx *types.ObsContext) []types.EvidenceLink {
	links := el.LinkAll(ctx)
	if len(links) == 0 {
		return nil
	}

	result := make([]types.EvidenceLink, 0, len(links))
	for _, link := range links {
		el := types.EvidenceLink{
			ID:          fmt.Sprintf("ev_%d", len(result)),
			Label:       link.TimelineLabel,
			Severity:    "info",
			TimestampMs: float64(link.Key.Timestamp.UnixNano()) / 1e6,
		}

		// Determine target panel and highlight key
		if link.FlamegraphHighlight != "" {
			el.Panel = "flamegraph"
			el.HighlightKey = link.FlamegraphHighlight
			el.Description = fmt.Sprintf("火焰图中高亮函数: %s", link.FlamegraphHighlight)
			if link.FlamegraphHighlight == "lock_contention" {
				el.Severity = "warning"
			}
		} else if link.Memory3DRegion != nil {
			el.Panel = "memory3d"
			el.HighlightKey = link.Memory3DRegion.Segment
			el.Description = fmt.Sprintf("内存3D布局中高亮: %s 段", link.Memory3DRegion.Segment)
			el.Severity = "warning"
		} else if link.SyscallEvent != nil {
			el.Panel = "trace"
			el.HighlightKey = fmt.Sprintf("%d", link.Key.TID)
			el.Description = fmt.Sprintf("Trace时间轴定位到 TID=%d 的 %s 事件", link.Key.TID, link.SyscallEvent.Syscall)
			if link.SyscallEvent.ErrorCode != 0 || link.SyscallEvent.Severity == "warning" || link.SyscallEvent.Severity == "critical" {
				el.Severity = link.SyscallEvent.Severity
			}
		} else if link.LockEvent != nil {
			el.Panel = "trace"
			el.HighlightKey = fmt.Sprintf("%d", link.Key.TID)
			el.Description = fmt.Sprintf("Trace时间轴定位到 TID=%d 的锁事件", link.Key.TID)
			if link.LockEvent.WaitDurationNs > 1_000_000 {
				el.Severity = "warning"
			}
		} else {
			continue // skip links without a navigation target
		}

		// Source file/line from syscall event
		if link.SyscallEvent != nil && link.SyscallEvent.SourceFile != "" {
			el.SourceFile = link.SyscallEvent.SourceFile
			el.SourceLine = link.SyscallEvent.SourceLine
		}

		if el.Label == "" {
			el.Label = el.Description
		}

		result = append(result, el)
	}

	// Deduplicate by highlight key + panel
	seen := make(map[string]bool)
	deduped := make([]types.EvidenceLink, 0, len(result))
	for _, el := range result {
		key := el.Panel + ":" + el.HighlightKey
		if !seen[key] {
			seen[key] = true
			deduped = append(deduped, el)
		}
	}

	// Assign stable IDs
	for i := range deduped {
		deduped[i].ID = fmt.Sprintf("ev_%s_%d", deduped[i].Panel, i)
	}

	// Sort by severity (critical first) then by timestamp
	sort.Slice(deduped, func(i, j int) bool {
		sevOrder := map[string]int{"critical": 0, "warning": 1, "info": 2}
		if sevOrder[deduped[i].Severity] != sevOrder[deduped[j].Severity] {
			return sevOrder[deduped[i].Severity] < sevOrder[deduped[j].Severity]
		}
		return deduped[i].TimestampMs < deduped[j].TimestampMs
	})

	return deduped
}
