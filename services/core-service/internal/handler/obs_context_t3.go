package handler

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/services"
	"github.com/traceos-lab/core-service/internal/types"
)

// injectT3 populates Tier-3 function-debug fields on the ObsContext by reusing
// the same stateless detectors and event extractors the standalone race /
// deadlock / leak / span handlers use, so T2 -> T3 drill-down has data inline.
func injectT3(obsCtx *types.ObsContext, traces []repository.SyscallTraceRecord) {
	if obsCtx == nil {
		return
	}

	// Race detection
	detector := services.NewRaceDetector()
	accessEvents := extractAccessEvents(traces)
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
	races, _ := detector.DetectRacesWithSummary()
	obsCtx.RaceReports = make([]types.RaceReport, 0, len(races))
	for _, r := range races {
		obsCtx.RaceReports = append(obsCtx.RaceReports, types.RaceReport{
			Address:          r.Address,
			Thread1:          r.Thread1,
			Thread2:          r.Thread2,
			Epoch1:           r.Epoch1,
			Epoch2:           r.Epoch2,
			Timestamp:        r.Timestamp,
			SourceLine1:      r.SourceLine1,
			SourceFile1:      r.SourceFile1,
			SourceLine2:      r.SourceLine2,
			SourceFile2:      r.SourceFile2,
			Description:      r.Description,
			HasHappensBefore: r.HasHB,
			TeachingHint:     r.TeachingHint,
		})
	}

	// Deadlock evolution
	evolver := services.NewDeadlockEvolver()
	steps := buildDeadlockSteps(traces)
	for _, step := range steps {
		switch step.Action {
		case "lock":
			evolver.RecordLock(step.TID, step.LockAddr, step.Timestamp)
		case "unlock":
			evolver.RecordUnlock(step.TID, step.LockAddr, step.Timestamp)
		case "wait":
			evolver.RecordWait(step.TID, step.LockAddr, step.Timestamp)
		}
	}
	analysis := evolver.Analyze(steps)
	if analysis != nil {
		obsCtx.DeadlockEvolution = &types.DeadlockEvolution{
			Steps:             convertDeadlockSteps(analysis.Steps),
			CoffmanConditions: analysis.CoffmanConditions,
			CycleInfo:         analysis.CycleInfo,
		}
	}

	// Leak detection
	leakDetector := services.NewLeakDetector()
	memEvents := extractMemoryEvents(traces)
	for _, evt := range memEvents {
		if evt.IsFree {
			leakDetector.RecordFree(evt.Address, evt.Timestamp)
		} else {
			leakDetector.RecordAlloc(evt.Address, evt.Size, evt.SourceFile, evt.SourceLine, nil, evt.Timestamp)
		}
	}
	leaks := leakDetector.Analyze()
	obsCtx.LeakReports = make([]types.LeakReport, 0, len(leaks))
	for _, m := range leaks {
		obsCtx.LeakReports = append(obsCtx.LeakReports, types.LeakReport{
			Severity:      string(m.Severity),
			Address:       m.Address,
			Size:          m.Size,
			AllocTime:     m.AllocTime,
			CallStack:     convertStackFrames(m.CallStack),
			SourceFile:    m.SourceFile,
			SourceLine:    m.SourceLine,
			Description:   m.Description,
			FixSuggestion: m.FixSuggestion,
			GrowthRate:    m.GrowthRate,
		})
	}

	// Span tree
	spanBuilder := services.NewSpanBuilder()
	records := make([]services.SyscallRecord, len(traces))
	for i, t := range traces {
		records[i] = services.SyscallRecord{
			Name:       t.SyscallName,
			Timestamp:  t.Time,
			DurationNs: t.DurationNs,
			PID:        t.PID,
			TID:        t.PID,
			ErrorName:  t.ErrorName,
		}
	}
	obsCtx.SpanTree = convertSpanNode(spanBuilder.BuildFromRecords(records))
}

func convertDeadlockSteps(in []services.DeadlockStep) []types.DeadlockStep {
	out := make([]types.DeadlockStep, len(in))
	for i, s := range in {
		out[i] = types.DeadlockStep{
			Order:       s.Order,
			Timestamp:   s.Timestamp,
			TID:         s.TID,
			Action:      s.Action,
			LockAddr:    s.LockAddr,
			Description: s.Description,
		}
	}
	return out
}

func convertStackFrames(in []services.StackFrame) []types.StackFrame {
	out := make([]types.StackFrame, len(in))
	for i, f := range in {
		out[i] = types.StackFrame{
			Function:   f.Name,
			SourceFile: f.SourceFile,
			SourceLine: f.SourceLine,
			Module:     f.Module,
		}
	}
	return out
}

func convertSpanNode(n *services.SpanNode) *types.SpanTreeNode {
	if n == nil {
		return nil
	}
	out := &types.SpanTreeNode{
		SpanID:        n.SpanID,
		ParentSpanID:  n.ParentSpanID,
		OperationName: n.OperationName,
		DurationMs:    n.DurationMs,
		SyscallCount:  n.SyscallCount,
		ErrorCount:    n.ErrorCount,
		SelfTimeMs:    n.SelfTimeMs,
		Tags:          n.Tags,
	}
	for _, c := range n.Children {
		if child := convertSpanNode(c); child != nil {
			out.Children = append(out.Children, *child)
		}
	}
	return out
}

// buildMemorySnapshots converts persisted memory-layout records into the
// unified observation memory snapshot shape, deriving mmap total/count from
// the stored JSONB region payload.
func buildMemorySnapshots(records []repository.MemoryLayoutRecord) []types.MemorySnapshot {
	if len(records) == 0 {
		return nil
	}
	snapshots := make([]types.MemorySnapshot, 0, len(records))
	for _, rec := range records {
		snap := types.MemorySnapshot{
			Timestamp:  rec.Timestamp,
			TextStart:  rec.TextStart,
			TextSize:   rec.TextSize,
			DataStart:  rec.DataStart,
			DataSize:   rec.DataSize,
			BSSStart:   rec.BSSStart,
			BSSSize:    rec.BSSSize,
			HeapStart:  rec.HeapStart,
			HeapSize:   rec.HeapSize,
			StackStart: rec.StackStart,
			StackSize:  rec.StackSize,
		}
		var regions []struct {
			Size uint64 `json:"size"`
		}
		if len(rec.MmapRegions) > 0 && json.Unmarshal(rec.MmapRegions, &regions) == nil {
			snap.MmapCount = len(regions)
			var total uint64
			for _, rg := range regions {
				total += rg.Size
			}
			snap.MmapTotal = total
		}
		snapshots = append(snapshots, snap)
	}
	return snapshots
}

// buildLockEvents derives lock events from lock-related syscall traces
// (futex/flock/fcntl/mutex). There is no dedicated lock_events table, so
// this reconstructs the lock timeline from the raw syscall stream.
func buildLockEvents(traces []repository.SyscallTraceRecord) []types.LockEvent {
	var events []types.LockEvent
	var addrCounter uint64 = 0xa0000000
	for i, t := range traces {
		switch t.SyscallName {
		case "futex", "flock", "fcntl", "pthread_mutex_lock", "pthread_mutex_unlock", "pthread_mutex_trylock":
		default:
			continue
		}

		tid := t.PID
		if tid == 0 {
			tid = 1
		}

		lockType := "mutex"
		if t.SyscallName == "flock" || t.SyscallName == "fcntl" {
			lockType = "rwlock"
		}

		op := "lock"
		switch {
		case strings.Contains(t.SyscallName, "unlock"):
			op = "unlock"
		case strings.Contains(t.SyscallName, "trylock"):
			op = "trylock"
		}

		waitNs := int64(0)
		if t.ErrorName != "" {
			waitNs = t.DurationNs
		}

		addr := addrCounter
		addrCounter += 8
		events = append(events, types.LockEvent{
			Timestamp:      t.Time,
			LockAddr:       addr,
			LockType:       lockType,
			Op:             op,
			TID:            tid,
			HolderTID:      tid,
			WaitDurationNs: waitNs,
			SourceFile:     "trace",
			SourceLine:     i + 1,
		})
	}
	return events
}

// buildSyscallFlameGraph synthesizes a flame graph from syscall frequency so
// that the T2 hot-function panel has data even when no profiler run is stored.
func buildSyscallFlameGraph(traces []repository.SyscallTraceRecord) *types.FlameGraphData {
	if len(traces) == 0 {
		return nil
	}

	counts := make(map[string]int)
	for _, t := range traces {
		counts[t.SyscallName]++
	}

	type entry struct {
		name  string
		count int
	}
	entries := make([]entry, 0, len(counts))
	for name, count := range counts {
		entries = append(entries, entry{name: name, count: count})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].count > entries[j].count })

	total := len(traces)
	hot := make([]types.HotFunction, 0, len(entries))
	for _, e := range entries {
		hot = append(hot, types.HotFunction{
			Name:       e.name,
			Percentage: float64(e.count) / float64(total) * 100,
			Samples:    e.count,
			Module:     "syscall",
		})
	}

	return &types.FlameGraphData{
		HotFunctions: hot,
		TotalSamples: total,
	}
}

// buildCallChains groups consecutive syscalls per PID into function-debug
// call chains so the T3 call-chain panel has drill-down data.
func buildCallChains(traces []repository.SyscallTraceRecord) []types.CallChain {
	if len(traces) == 0 {
		return nil
	}

	type chainAcc struct {
		steps []types.CallStep
		total int64
	}
	byPID := make(map[int]*chainAcc)
	var order []int
	for _, t := range traces {
		pid := t.PID
		if pid == 0 {
			pid = 1
		}
		acc, ok := byPID[pid]
		if !ok {
			acc = &chainAcc{}
			byPID[pid] = acc
			order = append(order, pid)
		}
		acc.steps = append(acc.steps, types.CallStep{
			Function:      t.SyscallName,
			LatencyNs:     t.DurationNs,
			IsKernelSpace: true,
		})
		acc.total += t.DurationNs
	}

	chains := make([]types.CallChain, 0, len(order))
	for _, pid := range order {
		acc := byPID[pid]
		if len(acc.steps) == 0 {
			continue
		}
		chains = append(chains, types.CallChain{
			RootCall:       acc.steps[0].Function,
			Chain:          acc.steps,
			TotalLatencyNs: acc.total,
		})
	}
	if len(chains) > 20 {
		chains = chains[:20]
	}
	return chains
}

// buildSourceAnnotations annotates syscall error events so the T3 source
// annotation panel surfaces failure points.
func buildSourceAnnotations(traces []repository.SyscallTraceRecord) []types.SourceAnnotation {
	var annotations []types.SourceAnnotation
	for i, t := range traces {
		if t.ErrorName == "" {
			continue
		}
		line := 0
		if t.SourceLine != nil {
			line = *t.SourceLine
		}
		if line == 0 {
			line = i + 1
		}
		annotations = append(annotations, types.SourceAnnotation{
			SourceFile: "syscall",
			Line:       line,
			Annotation: fmt.Sprintf("%s 返回错误 %s (ret=%d)", t.SyscallName, t.ErrorName, t.ReturnValue),
			Severity:   "warning",
		})
		if len(annotations) >= 50 {
			break
		}
	}
	return annotations
}
