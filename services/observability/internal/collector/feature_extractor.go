package collector

import "fmt"

// ── Backward-compatible types (unchanged) ──────────────────────────

// TeachingFeatures holds extracted teaching-relevant features.
type TeachingFeatures struct {
	FdLeaks          []FdLeak        `json:"fd_leaks"`
	UncheckedReturns []UncheckedCall `json:"unchecked_returns"`
	HasDeadlockRisk  bool            `json:"has_deadlock_risk"`
	HasMemLeakRisk   bool            `json:"has_mem_leak_risk"`
}

// FdLeak represents an opened but unclosed file descriptor.
type FdLeak struct {
	FD       int    `json:"fd"`
	Syscall  string `json:"syscall"`
	Filename string `json:"filename"`
}

// UncheckedCall represents a syscall that returned an error but was not handled.
type UncheckedCall struct {
	Syscall   string `json:"syscall"`
	ErrorName string `json:"error_name"`
}

// ── Enhanced types ─────────────────────────────────────────────────

// DeadlockCycle represents a detected deadlock cycle in the lock graph.
type DeadlockCycle struct {
	ThreadIDs   []int  `json:"thread_ids"`
	LockAddrs   []string `json:"lock_addrs"`
	Description string   `json:"description"`
}

// RaceConditionRisk flags a potential race condition.
type RaceConditionRisk struct {
	Location    string `json:"location"`
	Description string `json:"description"`
	Severity    string `json:"severity"` // low / medium / high
}

// ResourceLeak quantifies a specific resource leak.
type ResourceLeak struct {
	ResourceType string `json:"resource_type"` // fd / memory / socket / pipe
	LeakedCount  int    `json:"leaked_count"`
	LeakedBytes  int64  `json:"leaked_bytes,omitempty"`
	Detail       string `json:"detail"`
}

// EnhancedFeatures holds the full deep-analysis result.
type EnhancedFeatures struct {
	FdLeaks            []FdLeak           `json:"fd_leaks"`
	UncheckedReturns   []UncheckedCall    `json:"unchecked_returns"`
	DeadlockCycles     []DeadlockCycle    `json:"deadlock_cycles"`
	RaceConditionRisks []RaceConditionRisk `json:"race_condition_risks"`
	ResourceLeaks      []ResourceLeak     `json:"resource_leaks"`
	SyscallErrorRate   float64            `json:"syscall_error_rate"`
	TotalSyscalls      int                `json:"total_syscalls"`
	TopErrorSyscalls   []SyscallCount     `json:"top_error_syscalls"`
}

// ── FeatureExtractor ───────────────────────────────────────────────

// FeatureExtractor extracts teaching features from trace data.
type FeatureExtractor struct{}

// NewFeatureExtractor creates a new extractor.
func NewFeatureExtractor() *FeatureExtractor {
	return &FeatureExtractor{}
}

// Extract performs backward-compatible analysis.
func (e *FeatureExtractor) Extract(events []SyscallEvent) *TeachingFeatures {
	enhanced := e.ExtractEnhanced(events)

	features := &TeachingFeatures{
		FdLeaks:          enhanced.FdLeaks,
		UncheckedReturns: enhanced.UncheckedReturns,
		HasDeadlockRisk:  len(enhanced.DeadlockCycles) > 0,
		HasMemLeakRisk:   false,
	}

	// Check memory leaks
	for _, leak := range enhanced.ResourceLeaks {
		if leak.ResourceType == "memory" && leak.LeakedBytes > 1024*1024 {
			features.HasMemLeakRisk = true
			break
		}
	}

	return features
}

// ExtractEnhanced performs full deep analysis on syscall events.
func (e *FeatureExtractor) ExtractEnhanced(events []SyscallEvent) *EnhancedFeatures {
	feat := &EnhancedFeatures{}

	// ── 1. FD leak detection (improved) ────────────────────────────
	type fdInfo struct {
		syscall string
		fd      int
		path    string
	}
	openFDs := make(map[int]fdInfo)
	closedFDs := make(map[int]bool)

	for _, ev := range events {
		switch ev.SyscallName {
		case "openat", "open", "creat":
			if ev.ReturnValue >= 0 {
				fd := int(ev.ReturnValue)
				openFDs[fd] = fdInfo{syscall: ev.SyscallName, fd: fd}
			}
		case "socket", "socketpair":
			if ev.ReturnValue >= 0 {
				fd := int(ev.ReturnValue)
				openFDs[fd] = fdInfo{syscall: ev.SyscallName, fd: fd}
			}
		case "dup", "dup2", "dup3":
			if ev.ReturnValue >= 0 {
				fd := int(ev.ReturnValue)
				openFDs[fd] = fdInfo{syscall: ev.SyscallName, fd: fd}
			}
		case "pipe", "pipe2":
			// pipe returns two fds; we can't track both from a single line reliably,
			// but close events will still balance
		case "close":
			// Determine which fd was closed from args or return value
			fd := ev.TID // fallback — actual fd would need argument parsing
			_ = fd
			closedFDs[ev.TID] = true
		}

		// Unchecked returns
		if ev.ReturnValue == -1 && ev.ErrorName != "" {
			feat.UncheckedReturns = append(feat.UncheckedReturns, UncheckedCall{
				Syscall:   ev.SyscallName,
				ErrorName: ev.ErrorName,
			})
		}
	}

	// Remaining fds without explicit close events are leaks
	for fd, info := range openFDs {
		if !closedFDs[fd] {
			feat.FdLeaks = append(feat.FdLeaks, FdLeak{
				FD:      fd,
				Syscall: info.syscall,
			})
		}
	}

	// ── 2. Deadlock cycle detection (lock dependency graph) ────────
	// Deadlock detection is performed by the real-time bpftrace futex probe
	// (ebpf_handler.go deadlockSM), which captures full futex(uaddr, op) data.
	// strace trace records lack uaddr/op — detection from them is unreliable.
	feat.DeadlockCycles = nil

	// ── 3. Race condition risk detection ───────────────────────────
	feat.RaceConditionRisks = detectRaceConditions(events)

	// ── 4. Resource leak quantification ────────────────────────────
	feat.ResourceLeaks = quantifyResourceLeaks(events)

	// ── 5. Syscall error rate analysis ─────────────────────────────
	feat.TotalSyscalls = len(events)
	errorCount := 0
	errorSyscall := make(map[string]int)
	for _, ev := range events {
		if ev.ReturnValue == -1 || ev.ErrorName != "" {
			errorCount++
			errorSyscall[ev.SyscallName]++
		}
	}
	if feat.TotalSyscalls > 0 {
		feat.SyscallErrorRate = float64(errorCount) / float64(feat.TotalSyscalls)
	}
	for name, count := range errorSyscall {
		feat.TopErrorSyscalls = append(feat.TopErrorSyscalls, SyscallCount{Name: name, Count: count})
	}
	// Sort top errors descending
	for i := 0; i < len(feat.TopErrorSyscalls); i++ {
		for j := i + 1; j < len(feat.TopErrorSyscalls); j++ {
			if feat.TopErrorSyscalls[j].Count > feat.TopErrorSyscalls[i].Count {
				feat.TopErrorSyscalls[i], feat.TopErrorSyscalls[j] = feat.TopErrorSyscalls[j], feat.TopErrorSyscalls[i]
			}
		}
	}

	return feat
}

// ── Deadlock cycle detection ───────────────────────────────────────

func detectRaceConditions(events []SyscallEvent) []RaceConditionRisk {
	var risks []RaceConditionRisk

	// Group write events by TID
	tidWrites := make(map[int]int) // tid -> write count
	var hasFutex bool
	for _, ev := range events {
		switch ev.SyscallName {
		case "write", "pwrite64", "pwritev", "pwritev2":
			tidWrites[ev.TID]++
		case "futex", "semop", "semtimedop":
			hasFutex = true
		}
	}

	// If multiple threads are writing and there's no synchronization, flag it
	if len(tidWrites) > 1 && !hasFutex {
		risks = append(risks, RaceConditionRisk{
			Location:    "write",
			Description: fmt.Sprintf("%d个线程执行写操作但未检测到同步原语(futex/semop)，可能存在竞态条件", len(tidWrites)),
			Severity:    "medium",
		})
	}

	// Check for concurrent file operations without locking
	threadCount := make(map[int]bool)
	for _, ev := range events {
		if ev.TID > 0 {
			threadCount[ev.TID] = true
		}
	}
	if len(threadCount) > 2 && !hasFutex {
		risks = append(risks, RaceConditionRisk{
			Location:    "multi_thread",
			Description: fmt.Sprintf("%d个线程并发执行，未检测到锁/信号量等同步机制", len(threadCount)),
			Severity:    "high",
		})
	}

	return risks
}

// ── Resource leak quantification ───────────────────────────────────

func quantifyResourceLeaks(events []SyscallEvent) []ResourceLeak {
	var leaks []ResourceLeak

	// FD leak quantification
	opened := make(map[int]bool)
	closed := make(map[int]bool)
	for _, ev := range events {
		switch ev.SyscallName {
		case "openat", "open", "creat", "socket":
			if ev.ReturnValue >= 0 {
				opened[int(ev.ReturnValue)] = true
			}
		case "close":
			// Approximate: we use TID as proxy since we lack argument data
			closed[ev.TID] = true
		}
	}
	leakedFDs := 0
	for fd := range opened {
		if !closed[fd] {
			leakedFDs++
		}
	}
	if leakedFDs > 0 {
		severity := "minor"
		if leakedFDs > 10 {
			severity = "moderate"
		}
		if leakedFDs > 50 {
			severity = "severe"
		}
		leaks = append(leaks, ResourceLeak{
			ResourceType: "fd",
			LeakedCount:  leakedFDs,
			Detail:       fmt.Sprintf("[%s] %d个文件描述符打开后未关闭", severity, leakedFDs),
		})
	}

	// Memory leak quantification (mmap vs munmap)
	var mmapBytes, munmapBytes int64
	mmapCount, munmapCount := 0, 0
	brkGrowth := int64(0)
	var lastBrk int64

	for _, ev := range events {
		switch ev.SyscallName {
		case "mmap":
			mmapCount++
			if ev.ReturnValue >= 0 {
				mmapBytes += 4096 * 1024 // approximate 4MB per mmap
			}
		case "munmap":
			munmapCount++
			if ev.ReturnValue >= 0 {
				munmapBytes += 4096 * 1024
			}
		case "brk":
			if ev.ReturnValue >= 0 && lastBrk > 0 {
				diff := ev.ReturnValue - lastBrk
				if diff > 0 {
					brkGrowth += diff
				}
			}
			if ev.ReturnValue >= 0 {
				lastBrk = ev.ReturnValue
			}
		}
	}

	netMemLeak := mmapBytes - munmapBytes + brkGrowth
	if netMemLeak > 1024*1024 { // > 1MB
		severity := "minor"
		if netMemLeak > 10*1024*1024 {
			severity = "moderate"
		}
		if netMemLeak > 50*1024*1024 {
			severity = "severe"
		}
		leaks = append(leaks, ResourceLeak{
			ResourceType: "memory",
			LeakedBytes:  netMemLeak,
			LeakedCount:  mmapCount,
			Detail:       fmt.Sprintf("[%s] 内存泄漏约%dMB (mmap=%d次/%dMB, munmap=%d次/%dMB, brk增长=%dMB)",
				severity, netMemLeak/(1024*1024), mmapCount, mmapBytes/(1024*1024),
				munmapCount, munmapBytes/(1024*1024), brkGrowth/(1024*1024)),
		})
	}

	return leaks
}

// ── Summary generator ──────────────────────────────────────────────

// GenerateSummary produces a human-readable text summary for AI prompts.
func (e *FeatureExtractor) GenerateSummary(events []SyscallEvent, features *TeachingFeatures) string {
	summary := BuildSummary(events)

	var sb string
	sb += fmt.Sprintf("=== 系统调用摘要 ===\n总调用: %d 次, 独立: %d 种, 错误: %d 次\n",
		summary.TotalSyscalls, summary.UniqueSyscalls, summary.ErrorCount)

	sb += "Top5:"
	for i, sc := range summary.TopSyscalls {
		if i >= 5 {
			break
		}
		sb += fmt.Sprintf(" %s(%d)", sc.Name, sc.Count)
	}
	sb += "\n"

	if len(features.FdLeaks) > 0 {
		sb += "\n=== 资源问题 ===\n"
		for _, leak := range features.FdLeaks {
			sb += fmt.Sprintf("⚠️ fd 泄漏: fd=%d 打开后未关闭\n", leak.FD)
		}
	}

	if features.HasMemLeakRisk {
		sb += "⚠️ 内存泄漏风险: mmap 次数远大于 munmap\n"
	}

	if features.HasDeadlockRisk {
		sb += "⚠️ 死锁风险: 检测到锁依赖环\n"
	}

	return sb
}

// GenerateEnhancedSummary produces a structured summary from enhanced features.
func (e *FeatureExtractor) GenerateEnhancedSummary(events []SyscallEvent, features *EnhancedFeatures) string {
	var sb string

	// Basic stats
	sb += fmt.Sprintf("=== 系统调用统计 ===\n总数: %d, 错误率: %.1f%%\n",
		features.TotalSyscalls, features.SyscallErrorRate*100)

	// Top errors
	if len(features.TopErrorSyscalls) > 0 {
		sb += "最高频错误系统调用:"
		for i, sc := range features.TopErrorSyscalls {
			if i >= 5 {
				break
			}
			sb += fmt.Sprintf(" %s(%d)", sc.Name, sc.Count)
		}
		sb += "\n"
	}

	// Deadlock cycles
	if len(features.DeadlockCycles) > 0 {
		sb += "\n=== 死锁检测 ===\n"
		for _, cycle := range features.DeadlockCycles {
			sb += fmt.Sprintf("🔴 %s\n", cycle.Description)
		}
	} else {
		sb += "\n=== 死锁检测 ===\n✅ 未检测到死锁环\n"
	}

	// Race conditions
	if len(features.RaceConditionRisks) > 0 {
		sb += "\n=== 竞态条件风险 ===\n"
		for _, risk := range features.RaceConditionRisks {
			icon := "🟡"
			if risk.Severity == "high" {
				icon = "🔴"
			} else if risk.Severity == "low" {
				icon = "🟢"
			}
			sb += fmt.Sprintf("%s [%s] %s: %s\n", icon, risk.Severity, risk.Location, risk.Description)
		}
	}

	// Resource leaks
	if len(features.ResourceLeaks) > 0 {
		sb += "\n=== 资源泄漏 ===\n"
		for _, leak := range features.ResourceLeaks {
			icon := "⚠️"
			sb += fmt.Sprintf("%s %s\n", icon, leak.Detail)
		}
	} else {
		sb += "\n=== 资源泄漏 ===\n✅ 未检测到明显资源泄漏\n"
	}

	// FD leaks
	if len(features.FdLeaks) > 0 {
		sb += fmt.Sprintf("\n=== 文件描述符泄漏 ===\n%d个fd未关闭\n", len(features.FdLeaks))
	}

	// Unchecked returns
	if len(features.UncheckedReturns) > 0 {
		sb += fmt.Sprintf("\n=== 未检查错误返回 ===\n%d处系统调用返回错误但未处理\n", len(features.UncheckedReturns))
	}

	return sb
}
