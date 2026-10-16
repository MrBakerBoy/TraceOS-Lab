package services

import (
	"fmt"
	"time"
)

// DeadlockEvolver analyzes the step-by-step evolution of a deadlock.
// Design reference: PostgreSQL deadlock_timeout + Coffman condition detection.
type DeadlockEvolver struct {
	lockHolders map[uint64]int     // lock_addr → holder TID
	lockWaiters map[uint64][]int   // lock_addr → waiting TIDs
	threadLocks map[int]uint64     // TID → lock_addr (held)
	threadWaits map[int]uint64     // TID → lock_addr (waiting for)
}

// DeadlockStep represents one step in the deadlock evolution.
type DeadlockStep struct {
	Order       int       `json:"order"`
	Timestamp   time.Time `json:"timestamp"`
	TID         int       `json:"tid"`
	Action      string    `json:"action"` // lock|unlock|wait
	LockAddr    uint64    `json:"lock_addr"`
	HolderTID   int       `json:"holder_tid,omitempty"`
	Description string    `json:"description"`
}

// DeadlockAnalysis holds the complete deadlock analysis.
type DeadlockAnalysis struct {
	Detected          bool              `json:"detected"`
	Steps             []DeadlockStep    `json:"steps"`
	CoffmanConditions map[string]bool   `json:"coffman_conditions"`
	CycleInfo         string            `json:"cycle_info"`
	CycleNodes        []int             `json:"cycle_nodes"`  // TIDs in the cycle
	FixSuggestion     string            `json:"fix_suggestion"`
	TeachingNarrative string            `json:"teaching_narrative"`
}

// NewDeadlockEvolver creates a new deadlock analyzer.
func NewDeadlockEvolver() *DeadlockEvolver {
	return &DeadlockEvolver{
		lockHolders: make(map[uint64]int),
		lockWaiters: make(map[uint64][]int),
		threadLocks: make(map[int]uint64),
		threadWaits: make(map[int]uint64),
	}
}

// RecordLock records a successful lock acquisition.
func (de *DeadlockEvolver) RecordLock(tid int, lockAddr uint64, ts time.Time) *DeadlockStep {
	de.lockHolders[lockAddr] = tid
	de.threadLocks[tid] = lockAddr

	return &DeadlockStep{
		Order:       len(de.threadLocks),
		Timestamp:   ts,
		TID:         tid,
		Action:      "lock",
		LockAddr:    lockAddr,
		Description: fmt.Sprintf("线程 %d 获取锁 0x%x", tid, lockAddr),
	}
}

// RecordUnlock records a lock release.
func (de *DeadlockEvolver) RecordUnlock(tid int, lockAddr uint64, ts time.Time) *DeadlockStep {
	delete(de.lockHolders, lockAddr)
	delete(de.threadLocks, tid)
	delete(de.threadWaits, tid)

	return &DeadlockStep{
		Order:       len(de.threadLocks),
		Timestamp:   ts,
		TID:         tid,
		Action:      "unlock",
		LockAddr:    lockAddr,
		Description: fmt.Sprintf("线程 %d 释放锁 0x%x", tid, lockAddr),
	}
}

// RecordWait records a lock wait (blocked).
func (de *DeadlockEvolver) RecordWait(tid int, lockAddr uint64, ts time.Time) *DeadlockStep {
	holder := de.lockHolders[lockAddr]
	de.lockWaiters[lockAddr] = append(de.lockWaiters[lockAddr], tid)
	de.threadWaits[tid] = lockAddr

	desc := fmt.Sprintf("线程 %d 等待锁 0x%x", tid, lockAddr)
	if holder != 0 {
		desc += fmt.Sprintf(" (被线程 %d 持有)", holder)
	}

	return &DeadlockStep{
		Order:       len(de.threadLocks),
		Timestamp:   ts,
		TID:         tid,
		Action:      "wait",
		LockAddr:    lockAddr,
		HolderTID:   holder,
		Description: desc,
	}
}

// Analyze runs deadlock detection and returns the complete analysis.
func (de *DeadlockEvolver) Analyze(allSteps []DeadlockStep) *DeadlockAnalysis {
	analysis := &DeadlockAnalysis{
		Steps: allSteps,
		CoffmanConditions: make(map[string]bool),
	}

	// Detect cycle in wait-for graph
	cycle := de.detectCycle()
	if len(cycle) == 0 {
		analysis.Detected = false
		return analysis
	}

	analysis.Detected = true
	analysis.CycleNodes = cycle

	// Build cycle description
	cycleDesc := ""
	for i, tid := range cycle {
		if i > 0 {
			cycleDesc += " → "
		}
		cycleDesc += fmt.Sprintf("T%d", tid)
		if lock, ok := de.threadWaits[tid]; ok {
			cycleDesc += fmt.Sprintf("→等待锁0x%x", lock)
		}
	}
	analysis.CycleInfo = cycleDesc

	// Evaluate Coffman's four conditions
	analysis.CoffmanConditions = de.evaluateCoffman(allSteps)

	return analysis
}

func (de *DeadlockEvolver) detectCycle() []int {
	// Build wait-for graph: TID_A → TID_B means A waits for B
	graph := make(map[int]int)
	for tid, lockAddr := range de.threadWaits {
		if holder := de.lockHolders[lockAddr]; holder != 0 {
			graph[tid] = holder
		}
	}

	// Detect cycle using DFS
	visited := make(map[int]bool)
	recStack := make(map[int]bool)

	var cycle []int
	var dfs func(tid int) bool
	dfs = func(tid int) bool {
		visited[tid] = true
		recStack[tid] = true

		if next, ok := graph[tid]; ok {
			if !visited[next] {
				if dfs(next) {
					if len(cycle) == 0 || cycle[len(cycle)-1] != tid {
						cycle = append(cycle, tid)
					}
					return true
				}
			} else if recStack[next] {
				// Found cycle
				cycle = append(cycle, next)
				cycle = append(cycle, tid)
				return true
			}
		}
		recStack[tid] = false
		return false
	}

	for tid := range graph {
		if !visited[tid] {
			if dfs(tid) {
				// Reverse to get correct order
				for i, j := 0, len(cycle)-1; i < j; i, j = i+1, j-1 {
					cycle[i], cycle[j] = cycle[j], cycle[i]
				}
				return cycle
			}
		}
	}

	return nil
}

// evaluateCoffman checks the four Coffman conditions.
func (de *DeadlockEvolver) evaluateCoffman(steps []DeadlockStep) map[string]bool {
	conditions := map[string]bool{
		"mutual_exclusion":  false, // 互斥
		"hold_and_wait":     false, // 持有并等待
		"no_preemption":     false, // 不可剥夺
		"circular_wait":     false, // 循环等待
	}

	// Mutual exclusion: at least one lock that's held
	if len(de.lockHolders) > 0 {
		conditions["mutual_exclusion"] = true
	}

	// Hold and wait: a thread holds a lock while waiting for another
	for tid := range de.threadLocks {
		if _, waiting := de.threadWaits[tid]; waiting {
			conditions["hold_and_wait"] = true
			break
		}
	}

	// No preemption: locks not released except by owner (assumed true for mutex)
	conditions["no_preemption"] = true

	// Circular wait: cycle detected in wait-for graph
	conditions["circular_wait"] = len(de.detectCycle()) > 0

	return conditions
}

// BuildTeachingNarrative generates a student-facing deadlock story.
func (de *DeadlockEvolver) BuildTeachingNarrative(analysis *DeadlockAnalysis, steps []DeadlockStep) string {
	if !analysis.Detected {
		return "未检测到死锁。"
	}

	allTrue := true; _ = allTrue
	for _, v := range analysis.CoffmanConditions {
		if !v {
			allTrue = false
			break
		}
	}

	conditionsText := ""
	for name, met := range analysis.CoffmanConditions {
		mark := "❌"
		if met {
			mark = "✅"
		}
		conditionsText += fmt.Sprintf("\n  %s %s", mark, name)
	}

	return fmt.Sprintf(
		"🔴 检测到死锁！\n\n"+
			"📖 死锁讲述:\n"+
			"  你的程序中有 %d 个线程形成了循环等待关系: %s\n\n"+
			"🧪 Coffman 四条件验证:\n%s\n\n"+
			"🔧 修复建议: 统一加锁顺序——所有线程按相同顺序获取锁。",
		len(analysis.CycleNodes),
		analysis.CycleInfo,
		conditionsText,
	)
}
