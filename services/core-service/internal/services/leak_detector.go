package services

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

type LeakDetector struct {
	mu              sync.RWMutex
	allocations     map[uint64]*AllocRecord
	heapHistory     []HeapSnapshot
	livePointers    map[uint64]struct{}
	totalAllocBytes uint64
	totalFreeBytes  uint64
	allocCount      uint64
	freeCount       uint64
	peakHeap        uint64
	peakTime        time.Time
	rateWindowSize  time.Duration
	allocTimestamps []rateSample
	freeTimestamps  []rateSample
}

type rateSample struct {
	at    time.Time
	bytes uint64
}

type AllocRecord struct {
	Address    uint64
	Size       uint64
	AllocTime  time.Time
	CallStack  []StackFrame
	Freed      bool
	FreedAt    *time.Time
	SourceFile string
	SourceLine int
}

type HeapSnapshot struct {
	Timestamp  time.Time `json:"timestamp"`
	HeapSize   uint64    `json:"heap_size"`
	AllocCount int       `json:"alloc_count"`
	FreeCount  int       `json:"free_count"`
	PeakHeap   uint64    `json:"peak_heap"`
}

type LeakSeverity string

const (
	DefinitelyLost LeakSeverity = "definitely"
	IndirectlyLost LeakSeverity = "indirectly"
	PossiblyLost   LeakSeverity = "possibly"
	StillReachable LeakSeverity = "reachable"
)

type LeakResult struct {
	Severity      LeakSeverity `json:"severity"`
	Address       uint64       `json:"address"`
	Size          uint64       `json:"size"`
	AllocTime     time.Time    `json:"alloc_time"`
	CallStack     []StackFrame `json:"call_stack,omitempty"`
	SourceFile    string       `json:"source_file"`
	SourceLine    int          `json:"source_line"`
	Description   string       `json:"description"`
	FixSuggestion string       `json:"fix_suggestion"`
	GrowthRate    float64      `json:"growth_rate,omitempty"`
}

type HeaptrackSummary struct {
	TotalAllocated  uint64    `json:"total_allocated"`
	TotalFreed      uint64    `json:"total_freed"`
	StillAllocated  uint64    `json:"still_allocated"`
	PeakHeap        uint64    `json:"peak_heap"`
	PeakTime        time.Time `json:"peak_time"`
	AllocCount      uint64    `json:"alloc_count"`
	FreeCount       uint64    `json:"free_count"`
	AllocRateMbps   float64   `json:"alloc_rate_mbps"`
	FreeRateMbps    float64   `json:"free_rate_mbps"`
	NetGrowthMbps   float64   `json:"net_growth_mbps"`
	LeakProbability float64   `json:"leak_probability"`
}

type TopAllocator struct {
	Function   string  `json:"function"`
	SourceFile string  `json:"source_file"`
	SourceLine int     `json:"source_line"`
	TotalBytes uint64  `json:"total_bytes"`
	AllocCount int     `json:"alloc_count"`
	Percent    float64 `json:"percent"`
}

type TrendAnalysis struct {
	TrendDirection string
	GrowthRateMbps float64
	PeakHeapBytes  uint64
	PeakTime       time.Time
	StillAllocated uint64
	AllocRateMbps  float64
	FreeRateMbps   float64
}

func NewLeakDetector() *LeakDetector {
	return &LeakDetector{
		allocations:    make(map[uint64]*AllocRecord),
		livePointers:   make(map[uint64]struct{}),
		rateWindowSize: 10 * time.Second,
	}
}

func (ld *LeakDetector) RecordAlloc(address, size uint64, sourceFile string, sourceLine int, callStack []StackFrame, ts time.Time) {
	ld.mu.Lock()
	defer ld.mu.Unlock()
	ld.allocations[address] = &AllocRecord{Address: address, Size: size, AllocTime: ts, CallStack: callStack, SourceFile: sourceFile, SourceLine: sourceLine, Freed: false}
	ld.livePointers[address] = struct{}{}
	ld.totalAllocBytes += size
	ld.allocCount++
	ld.allocTimestamps = append(ld.allocTimestamps, rateSample{at: ts, bytes: size})
	currentHeap := ld.totalAllocBytes - ld.totalFreeBytes
	if currentHeap > ld.peakHeap {
		ld.peakHeap = currentHeap
		ld.peakTime = ts
	}
	ld.heapHistory = append(ld.heapHistory, HeapSnapshot{Timestamp: ts, HeapSize: currentHeap, AllocCount: int(ld.allocCount), FreeCount: int(ld.freeCount), PeakHeap: ld.peakHeap})
}

func (ld *LeakDetector) RecordFree(address uint64, ts time.Time) {
	ld.mu.Lock()
	defer ld.mu.Unlock()
	if rec, ok := ld.allocations[address]; ok && !rec.Freed {
		rec.Freed = true
		rec.FreedAt = &ts
		ld.totalFreeBytes += rec.Size
		ld.freeCount++
		delete(ld.livePointers, address)
	}
	ld.freeTimestamps = append(ld.freeTimestamps, rateSample{at: ts, bytes: 0})
	ld.heapHistory = append(ld.heapHistory, HeapSnapshot{Timestamp: ts, HeapSize: ld.totalAllocBytes - ld.totalFreeBytes, FreeCount: 1, PeakHeap: ld.peakHeap})
}

func (ld *LeakDetector) RecordPointerLost(address uint64) {
	ld.mu.Lock()
	defer ld.mu.Unlock()
	delete(ld.livePointers, address)
}

func (ld *LeakDetector) Analyze() []LeakResult {
	ld.mu.RLock()
	defer ld.mu.RUnlock()
	var results []LeakResult
	for addr, rec := range ld.allocations {
		if rec.Freed {
			continue
		}
		if !ld.isReachable(addr) && !ld.isInteriorReachable(addr) {
			results = append(results, LeakResult{Severity: DefinitelyLost, Address: addr, Size: rec.Size, AllocTime: rec.AllocTime, CallStack: rec.CallStack, SourceFile: rec.SourceFile, SourceLine: rec.SourceLine, Description: fmt.Sprintf("Definitely lost: %d bytes", rec.Size), FixSuggestion: fmt.Sprintf("Call free(). Allocated at: %s:%d", rec.SourceFile, rec.SourceLine)})
		}
	}
	defAddr := make(map[uint64]bool)
	for _, r := range results {
		if r.Severity == DefinitelyLost {
			defAddr[r.Address] = true
		}
	}
	for addr, rec := range ld.allocations {
		if rec.Freed {
			continue
		}
		for pa := range defAddr {
			parent, ok := ld.allocations[pa]
			if !ok || pa == addr {
				continue
			}
			if addr > pa && addr < pa+parent.Size {
				results = append(results, LeakResult{Severity: IndirectlyLost, Address: addr, Size: rec.Size, AllocTime: rec.AllocTime, CallStack: rec.CallStack, SourceFile: rec.SourceFile, SourceLine: rec.SourceLine, Description: fmt.Sprintf("Indirectly lost: %d bytes, parent 0x%x", rec.Size, pa), FixSuggestion: "Fix parent leak."})
				break
			}
		}
	}
	for addr, rec := range ld.allocations {
		if rec.Freed {
			continue
		}
		if ld.isInteriorReachable(addr) && !ld.isReachable(addr) {
			results = append(results, LeakResult{Severity: PossiblyLost, Address: addr, Size: rec.Size, AllocTime: rec.AllocTime, CallStack: rec.CallStack, SourceFile: rec.SourceFile, SourceLine: rec.SourceLine, Description: fmt.Sprintf("Possibly lost: %d bytes", rec.Size), FixSuggestion: "Save pointer to start of allocated block."})
		}
	}
	for addr, rec := range ld.allocations {
		if rec.Freed {
			continue
		}
		if ld.isReachable(addr) {
			results = append(results, LeakResult{Severity: StillReachable, Address: addr, Size: rec.Size, AllocTime: rec.AllocTime, CallStack: rec.CallStack, SourceFile: rec.SourceFile, SourceLine: rec.SourceLine, Description: fmt.Sprintf("Still reachable: %d bytes", rec.Size), FixSuggestion: "Call free() before exit."})
		}
	}
	growthRate := ld.calcNetGrowthRate()
	if growthRate > 1.0 {
		leakProb := ld.calcLeakProbability()
		results = append(results, LeakResult{Severity: PossiblyLost, Description: fmt.Sprintf("Heap growing %.2f MB/s (leak prob: %.0f%%)", growthRate, leakProb*100), GrowthRate: growthRate})
	}
	sort.Slice(results, func(i, j int) bool { return severityOrder(results[i].Severity) < severityOrder(results[j].Severity) })
	return results
}

func severityOrder(s LeakSeverity) int {
	switch s {
	case DefinitelyLost:
		return 0
	case IndirectlyLost:
		return 1
	case PossiblyLost:
		return 2
	case StillReachable:
		return 3
	default:
		return 4
	}
}

func (ld *LeakDetector) GetHeaptrackSummary() *HeaptrackSummary {
	ld.mu.RLock()
	defer ld.mu.RUnlock()
	stillAllocated := ld.totalAllocBytes - ld.totalFreeBytes
	allocRate, freeRate := ld.calcRates()
	return &HeaptrackSummary{TotalAllocated: ld.totalAllocBytes, TotalFreed: ld.totalFreeBytes, StillAllocated: stillAllocated, PeakHeap: ld.peakHeap, PeakTime: ld.peakTime, AllocCount: ld.allocCount, FreeCount: ld.freeCount, AllocRateMbps: allocRate, FreeRateMbps: freeRate, NetGrowthMbps: allocRate - freeRate, LeakProbability: ld.calcLeakProbability()}
}

func (ld *LeakDetector) GetHeapHistory() []HeapSnapshot {
	ld.mu.RLock()
	defer ld.mu.RUnlock()
	cp := make([]HeapSnapshot, len(ld.heapHistory))
	copy(cp, ld.heapHistory)
	return cp
}

func (ld *LeakDetector) GetTopAllocators(limit int) []TopAllocator {
	ld.mu.RLock()
	defer ld.mu.RUnlock()
	type byFunc struct {
		totalBytes uint64
		count      int
		sourceFile string
		sourceLine int
	}
	agg := make(map[string]*byFunc)
	var grandTotal uint64
	for _, rec := range ld.allocations {
		key := fmt.Sprintf("%s:%d", rec.SourceFile, rec.SourceLine)
		if e, ok := agg[key]; ok {
			e.totalBytes += rec.Size
			e.count++
		} else {
			agg[key] = &byFunc{totalBytes: rec.Size, count: 1, sourceFile: rec.SourceFile, sourceLine: rec.SourceLine}
		}
		grandTotal += rec.Size
	}
	var result []TopAllocator
	for key, v := range agg {
		pct := float64(0)
		if grandTotal > 0 {
			pct = float64(v.totalBytes) / float64(grandTotal) * 100
		}
		result = append(result, TopAllocator{Function: key, SourceFile: v.sourceFile, SourceLine: v.sourceLine, TotalBytes: v.totalBytes, AllocCount: v.count, Percent: pct})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].TotalBytes > result[j].TotalBytes })
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result
}

func (ld *LeakDetector) GetTrendAnalysis() *TrendAnalysis {
	ld.mu.RLock()
	defer ld.mu.RUnlock()
	allocRate, freeRate := ld.calcRates()
	netGrowth := allocRate - freeRate
	direction := "stable"
	if netGrowth > 0.5 {
		direction = "growing"
	} else if netGrowth < -0.5 {
		direction = "shrinking"
	}
	return &TrendAnalysis{TrendDirection: direction, GrowthRateMbps: netGrowth, PeakHeapBytes: ld.peakHeap, PeakTime: ld.peakTime, StillAllocated: ld.totalAllocBytes - ld.totalFreeBytes, AllocRateMbps: allocRate, FreeRateMbps: freeRate}
}

func (ld *LeakDetector) isReachable(addr uint64) bool { _, ok := ld.livePointers[addr]; return ok }

func (ld *LeakDetector) isInteriorReachable(addr uint64) bool {
	rec, ok := ld.allocations[addr]
	if !ok {
		return false
	}
	end := addr + rec.Size
	for ptr := range ld.livePointers {
		if ptr > addr && ptr < end {
			return true
		}
	}
	return false
}

func (ld *LeakDetector) calcRates() (allocRate, freeRate float64) {
	now := time.Now()
	windowStart := now.Add(-ld.rateWindowSize)
	var allocBytes uint64
	for i := len(ld.allocTimestamps) - 1; i >= 0; i-- {
		if ld.allocTimestamps[i].at.Before(windowStart) {
			break
		}
		allocBytes += ld.allocTimestamps[i].bytes
	}
	var freeBytes uint64
	for i := len(ld.freeTimestamps) - 1; i >= 0; i-- {
		if ld.freeTimestamps[i].at.Before(windowStart) {
			break
		}
		freeBytes += ld.freeTimestamps[i].bytes
	}
	allocRate = float64(allocBytes) / (1024 * 1024) / ld.rateWindowSize.Seconds()
	freeRate = float64(freeBytes) / (1024 * 1024) / ld.rateWindowSize.Seconds()
	return
}

func (ld *LeakDetector) calcNetGrowthRate() float64 { a, f := ld.calcRates(); return a - f }

func (ld *LeakDetector) calcLeakProbability() float64 {
	netGrowth := ld.calcNetGrowthRate()
	if netGrowth <= 0 {
		return 0
	}
	rateScore := clamp(netGrowth/10.0, 0, 1)
	var ratioScore float64
	if ld.freeCount > 0 {
		ratioScore = clamp(float64(ld.allocCount)/float64(ld.freeCount)/5.0, 0, 1)
	} else if ld.allocCount > 5 {
		ratioScore = 1.0
	}
	var unfreedScore float64
	if ld.allocCount > 0 {
		unfreed := 0
		for _, rec := range ld.allocations {
			if !rec.Freed {
				unfreed++
			}
		}
		unfreedScore = float64(unfreed) / float64(ld.allocCount)
	}
	return clamp(rateScore*0.5+ratioScore*0.3+unfreedScore*0.2, 0, 1)
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
