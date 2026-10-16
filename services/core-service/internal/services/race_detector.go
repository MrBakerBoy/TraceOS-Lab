package services

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

// RaceDetector implements data race detection using a simplified TSan (ThreadSanitizer)
// Happens-Before algorithm. Designed for educational transparency.
type RaceDetector struct {
	mu           sync.RWMutex
	shadowMemory map[uint64][]ShadowCell
	threadClocks map[int]*ThreadClock
	syncClocks   map[uint64]*SyncClock
}

// ShadowCell mirrors TSan's shadow memory cell.
type ShadowCell struct {
	ThreadID   int
	Epoch      int64
	AccessType string // "read" or "write"
	Offset     uint32
	Size       uint32
	Timestamp  time.Time
	SourceLine int
	SourceFile string
	Locked     bool
}

// ThreadClock is a simplified vector clock per thread.
type ThreadClock struct {
	mu     sync.Mutex
	Epoch  int64
	Vector map[int]int64 // per-thread epoch knowledge (full vector clock)
}

// SyncClock tracks synchronization object state.
type SyncClock struct {
	OwnerTID int
	Epoch    int64
	Vector   map[int]int64 // vector clock snapshot at release time
}

// RaceResult holds a detected race condition.
type RaceResult struct {
	Address      uint64    `json:"address"`
	Thread1      int       `json:"thread1"`
	Thread2      int       `json:"thread2"`
	Epoch1       int64     `json:"epoch1"`
	Epoch2       int64     `json:"epoch2"`
	Timestamp    time.Time `json:"timestamp"`
	SourceLine1  int       `json:"source_line1"`
	SourceFile1  string    `json:"source_file1"`
	SourceLine2  int       `json:"source_line2"`
	SourceFile2  string    `json:"source_file2"`
	Description  string    `json:"description"`
	HasHB        bool      `json:"has_hb"`
	TeachingHint string    `json:"teaching_hint"`
}

// RaceSummary holds aggregate statistics for the race detector.
type RaceSummary struct {
	TotalAccesses    int         `json:"total_accesses"`
	TotalRaces       int         `json:"total_races"`
	UniqueAddresses  int         `json:"unique_addresses"`
	ThreadsInvolved  []int       `json:"threads_involved"`
	RacesPerThread   map[int]int `json:"races_per_thread"`
	UnprotectedAddrs []uint64    `json:"unprotected_addrs"`
	ConfidenceScore  float64     `json:"confidence_score"`
}

// NewRaceDetector creates a new race detector.
func NewRaceDetector() *RaceDetector {
	return &RaceDetector{
		shadowMemory: make(map[uint64][]ShadowCell),
		threadClocks: make(map[int]*ThreadClock),
		syncClocks:   make(map[uint64]*SyncClock),
	}
}

// RecordAccess records a memory access event.
func (rd *RaceDetector) RecordAccess(addr uint64, tid int, accessType string,
	sourceFile string, sourceLine int, ts time.Time, locked bool) {
	rd.mu.Lock()
	defer rd.mu.Unlock()

	clock := rd.getOrCreateClock(tid)
	clock.mu.Lock()
	clock.Epoch++
	epoch := clock.Epoch
	// Update vector clock: this thread's own epoch advances
	clock.Vector[tid] = epoch
	clock.mu.Unlock()

	cell := ShadowCell{
		ThreadID:   tid,
		Epoch:      epoch,
		AccessType: accessType,
		Timestamp:  ts,
		SourceLine: sourceLine,
		SourceFile: sourceFile,
		Locked:     locked,
	}
	rd.shadowMemory[addr] = append(rd.shadowMemory[addr], cell)
}

// RecordLock records a mutex lock acquisition.
func (rd *RaceDetector) RecordLock(lockAddr uint64, tid int) {
	rd.mu.Lock()
	defer rd.mu.Unlock()

	clock := rd.getOrCreateClock(tid)
	if sc, ok := rd.syncClocks[lockAddr]; ok {
		clock.mu.Lock()
		// Acquire: merge sync clock state into thread clock
		for t, e := range sc.Vector {
			if existing, exists := clock.Vector[t]; !exists || e > existing {
				clock.Vector[t] = e
			}
		}
		if sc.Epoch > clock.Epoch {
			clock.Epoch = sc.Epoch
		}
		clock.mu.Unlock()
	}
}

// RecordUnlock records a mutex unlock operation.
func (rd *RaceDetector) RecordUnlock(lockAddr uint64, tid int) {
	rd.mu.Lock()
	defer rd.mu.Unlock()

	clock := rd.getOrCreateClock(tid)
	clock.mu.Lock()
	// Release: sync clock gets a copy of thread's vector clock
	vecCopy := make(map[int]int64)
	for t, e := range clock.Vector {
		vecCopy[t] = e
	}
	rd.syncClocks[lockAddr] = &SyncClock{
		OwnerTID: tid,
		Epoch:    clock.Epoch,
		Vector:   vecCopy,
	}
	clock.mu.Unlock()
}

// DetectRaces runs the TSan-style race detection algorithm.
func (rd *RaceDetector) DetectRaces() []RaceResult {
	rd.mu.RLock()
	defer rd.mu.RUnlock()

	var results []RaceResult
	for addr, cells := range rd.shadowMemory {
		for i := 0; i < len(cells); i++ {
			for j := i + 1; j < len(cells); j++ {
				a, b := cells[i], cells[j]

				// Condition 1: different threads
				if a.ThreadID == b.ThreadID {
					continue
				}

				// Condition 2: at least one write
				if a.AccessType != "write" && b.AccessType != "write" {
					continue
				}

				// Condition 3: no lock protection
				if a.Locked && b.Locked {
					continue
				}

				// Condition 4: no Happens-Before relation
				if rd.happensBeforeVClock(a, b) || rd.happensBeforeVClock(b, a) {
					continue
				}

				// Condition 5: overlapping time window (within tolerance)
				diff := b.Timestamp.Sub(a.Timestamp)
				if diff < 0 {
					diff = -diff
				}
				if diff > 10*time.Second {
					continue
				}

				results = append(results, RaceResult{
					Address:     addr,
					Thread1:     a.ThreadID,
					Thread2:     b.ThreadID,
					Epoch1:      a.Epoch,
					Epoch2:      b.Epoch,
					Timestamp:   a.Timestamp,
					SourceLine1: a.SourceLine,
					SourceFile1: a.SourceFile,
					SourceLine2: b.SourceLine,
					SourceFile2: b.SourceFile,
					Description: fmt.Sprintf(
						"TID=%d (Epoch=%d) 和 TID=%d (Epoch=%d) 之间缺少 Happens-Before 关系",
						a.ThreadID, a.Epoch, b.ThreadID, b.Epoch,
					),
					HasHB: false,
					TeachingHint: fmt.Sprintf(
						"TSan 检测: 线程 %d 和 %d 同时访问地址 0x%x，无同步保护。"+
							"修复: 使用 pthread_mutex_lock/unlock 保护共享变量，确保所有访问路径持有同一互斥锁。\n"+
							"教学要点: Happens-Before 关系通过锁的 acquire/release 语义建立。"+
							"若线程 A 释放锁后线程 B 获取同一锁，则 A 的写入 Happens-Before B 的读取。",
						a.ThreadID, b.ThreadID, addr,
					),
				})
			}
		}
	}

	return results
}

// happensBeforeVClock uses vector clock comparison to determine if
// access `a` happens-before access `b`.
func (rd *RaceDetector) happensBeforeVClock(a, b ShadowCell) bool {
	clockB, ok := rd.threadClocks[b.ThreadID]
	if !ok {
		return false
	}
	clockB.mu.Lock()
	defer clockB.mu.Unlock()

	// Full vector clock check: if b's clock has knowledge of a's epoch for thread a.tid
	if bVec, exists := clockB.Vector[a.ThreadID]; exists && bVec >= a.Epoch {
		return true
	}

	// Fallback scalar check
	if clockB.Epoch >= a.Epoch && b.Timestamp.After(a.Timestamp) {
		return true
	}

	return false
}

// happensBefore is a simplified check (backward compatible).
func (rd *RaceDetector) happensBefore(a, b ShadowCell) bool {
	clockB, ok := rd.threadClocks[b.ThreadID]
	if !ok {
		return false
	}
	clockB.mu.Lock()
	defer clockB.mu.Unlock()
	return clockB.Epoch >= a.Epoch && b.Timestamp.After(a.Timestamp)
}

// DetectRacesWithSummary runs detection and returns both results and a summary.
func (rd *RaceDetector) DetectRacesWithSummary() ([]RaceResult, *RaceSummary) {
	results := rd.DetectRaces()

	rd.mu.RLock()
	defer rd.mu.RUnlock()

	threadSet := make(map[int]bool)
	threadRaceCount := make(map[int]int)
	unprotected := make(map[uint64]bool)
	totalAccesses := 0

	for addr, cells := range rd.shadowMemory {
		totalAccesses += len(cells)
		// Check if any cell on this address is unprotected
		for _, c := range cells {
			if !c.Locked {
				unprotected[addr] = true
			}
		}
	}

	for _, r := range results {
		threadSet[r.Thread1] = true
		threadSet[r.Thread2] = true
		threadRaceCount[r.Thread1]++
		threadRaceCount[r.Thread2]++
	}

	threads := make([]int, 0, len(threadSet))
	for t := range threadSet {
		threads = append(threads, t)
	}
	sort.Ints(threads)

	unprotectedAddrs := make([]uint64, 0, len(unprotected))
	for addr := range unprotected {
		unprotectedAddrs = append(unprotectedAddrs, addr)
	}

	confidence := 0.0
	if totalAccesses > 0 {
		// Confidence heuristic: more accesses + fewer threads = more confidence
		threadFactor := 1.0 / float64(len(threads)+1)
		accessFactor := float64(len(results)) / float64(totalAccesses)
		confidence = (1.0 - threadFactor) * accessFactor * 100
		if confidence > 100 {
			confidence = 100
		}
	}

	return results, &RaceSummary{
		TotalAccesses:    totalAccesses,
		TotalRaces:       len(results),
		UniqueAddresses:  len(rd.shadowMemory),
		ThreadsInvolved:  threads,
		RacesPerThread:   threadRaceCount,
		UnprotectedAddrs: unprotectedAddrs,
		ConfidenceScore:  confidence,
	}
}

// Clear resets all collected data.
func (rd *RaceDetector) Clear() {
	rd.mu.Lock()
	defer rd.mu.Unlock()

	rd.shadowMemory = make(map[uint64][]ShadowCell)
	rd.threadClocks = make(map[int]*ThreadClock)
	rd.syncClocks = make(map[uint64]*SyncClock)
}

// GetAccessCount returns the total number of recorded memory accesses.
func (rd *RaceDetector) GetAccessCount() int {
	rd.mu.RLock()
	defer rd.mu.RUnlock()

	count := 0
	for _, cells := range rd.shadowMemory {
		count += len(cells)
	}
	return count
}

// GetUniqueAddressCount returns the number of unique memory addresses tracked.
func (rd *RaceDetector) GetUniqueAddressCount() int {
	rd.mu.RLock()
	defer rd.mu.RUnlock()
	return len(rd.shadowMemory)
}

// GetThreadCount returns the number of distinct threads tracked.
func (rd *RaceDetector) GetThreadCount() int {
	rd.mu.RLock()
	defer rd.mu.RUnlock()
	return len(rd.threadClocks)
}

// GetAddressAccesses returns the access history for a specific memory address.
func (rd *RaceDetector) GetAddressAccesses(addr uint64) []ShadowCell {
	rd.mu.RLock()
	defer rd.mu.RUnlock()

	cells, ok := rd.shadowMemory[addr]
	if !ok {
		return nil
	}
	result := make([]ShadowCell, len(cells))
	copy(result, cells)
	return result
}

func (rd *RaceDetector) getOrCreateClock(tid int) *ThreadClock {
	if c, ok := rd.threadClocks[tid]; ok {
		return c
	}
	c := &ThreadClock{
		Epoch:  0,
		Vector: make(map[int]int64),
	}
	rd.threadClocks[tid] = c
	return c
}
