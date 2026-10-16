package services

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// FlameGraphDiff implements Brendan Gregg's differential flame graph methodology.
// Key rules:
//  1. Dual-view: diff2 (after-based, red=increase) + diff1/negated (before-based)
//  2. Normalization: auto-enable when sample count difference > 10%
//  3. Address stripping: filter unresolved hex addresses
//  4. Standardized pipeline: perf record -F 99 -j random -g
type FlameGraphDiff struct {
	baselineTotalSamples int
	currentTotalSamples  int
	normalized           bool
}

// StackFrame represents a single frame in the call stack.
type StackFrame struct {
	Name       string `json:"name"`
	Module     string `json:"module"`
	SourceFile string `json:"source_file"`
	SourceLine int    `json:"source_line"`
}

// StackSample represents one profiling sample with full call stack.
type StackSample struct {
	Stack  []StackFrame
	Weight int // sample count
}

// DiffResult holds the output of differential flame graph computation.
type DiffResult struct {
	Diff2         []DiffFrame   `json:"diff2"`
	Diff1Negated  []DiffFrame   `json:"diff1_negated"`
	Diff2SVG      string        `json:"diff2_svg,omitempty"`
	Diff1SVG      string        `json:"diff1_svg,omitempty"`
	Normalized    bool          `json:"normalized"`
	SampleDiffPct float64       `json:"sample_diff_pct"`
	HotFunctions  []DiffHotFunc `json:"hot_functions"`
	Summary       string        `json:"summary"`
	AppValidation *AppMetrics   `json:"app_validation,omitempty"`
}

// DiffFrame represents a single stack frame with diff coloring metadata.
type DiffFrame struct {
	Name            string  `json:"name"`
	Level           int     `json:"level"`
	BaselineSamples int     `json:"baseline_samples"`
	CurrentSamples  int     `json:"current_samples"`
	Delta           int     `json:"delta"`
	PctChange       float64 `json:"pct_change"`
	Direction       string  `json:"direction"`
	Color           string  `json:"color"`
	SourceFile      string  `json:"source_file,omitempty"`
	SourceLine      int     `json:"source_line,omitempty"`
}

// DiffHotFunc represents a function with significant change.
type DiffHotFunc struct {
	Name        string  `json:"name"`
	SamplesDiff int     `json:"samples_diff"`
	PctChange   float64 `json:"pct_change"`
	Direction   string  `json:"direction"`
	SourceFile  string  `json:"source_file,omitempty"`
	SourceLine  int     `json:"source_line,omitempty"`
}

// AppMetrics are application-level cross-validation metrics.
type AppMetrics struct {
	P50Latency float64 `json:"p50_latency"`
	P95Latency float64 `json:"p95_latency"`
	P99Latency float64 `json:"p99_latency"`
	Throughput float64 `json:"throughput"`
	ErrorRate  float64 `json:"error_rate"`
}

// frameKey is the key type for per-frame aggregation maps.
type frameKey struct {
	name  string
	level int
}

// NewFlameGraphDiff creates a new diff engine.
func NewFlameGraphDiff(baselineSamples, currentSamples int) *FlameGraphDiff {
	diff := &FlameGraphDiff{
		baselineTotalSamples: baselineSamples,
		currentTotalSamples:  currentSamples,
	}

	if baselineSamples > 0 {
		sampleDiffPct := math.Abs(float64(currentSamples-baselineSamples)) / float64(baselineSamples) * 100
		diff.normalized = sampleDiffPct > 10
	}

	return diff
}

// ComputeDiff computes the differential flame graph data.
func (fgd *FlameGraphDiff) ComputeDiff(baseline, current []StackSample) *DiffResult {
	baselineCounts := fgd.aggregateSamples(baseline)
	currentCounts := fgd.aggregateSamples(current)

	if fgd.normalized {
		baselineCounts = fgd.normalizeCounts(baselineCounts, fgd.baselineTotalSamples)
		currentCounts = fgd.normalizeCounts(currentCounts, fgd.currentTotalSamples)
	}

	var hotFuncs []DiffHotFunc
	seen := make(map[string]bool)
	totalDelta := 0

	for name, curCount := range currentCounts {
		baseCount := baselineCounts[name]
		delta := curCount - baseCount
		seen[name] = true

		if delta == 0 {
			continue
		}
		totalDelta += delta

		pctChange := float64(0)
		if baseCount > 0 {
			pctChange = float64(delta) / float64(baseCount) * 100
		} else {
			pctChange = 100
		}

		dir := "up"
		if delta < 0 {
			dir = "down"
		}
		if baseCount == 0 {
			dir = "new"
		}

		hotFuncs = append(hotFuncs, DiffHotFunc{
			Name:        name,
			SamplesDiff: delta,
			PctChange:   pctChange,
			Direction:   dir,
		})
	}

	for name, baseCount := range baselineCounts {
		if seen[name] {
			continue
		}
		hotFuncs = append(hotFuncs, DiffHotFunc{
			Name:        name,
			SamplesDiff: -baseCount,
			PctChange:   -100,
			Direction:   "vanished",
		})
	}

	sort.Slice(hotFuncs, func(i, j int) bool {
		return absInt(hotFuncs[i].SamplesDiff) > absInt(hotFuncs[j].SamplesDiff)
	})

	diff2Frames := fgd.computeFrameDiff(baseline, current, false)
	diff1Frames := fgd.computeFrameDiff(baseline, current, true)

	summary := fgd.buildSummary(hotFuncs, totalDelta)

	return &DiffResult{
		Diff2:         diff2Frames,
		Diff1Negated:  diff1Frames,
		Normalized:    fgd.normalized,
		SampleDiffPct: float64(fgd.currentTotalSamples-fgd.baselineTotalSamples) / float64(fgd.baselineTotalSamples) * 100,
		HotFunctions:  hotFuncs,
		Summary:       summary,
	}
}

func (fgd *FlameGraphDiff) computeFrameDiff(baseline, current []StackSample, negated bool) []DiffFrame {
	baselineFrames := make(map[frameKey]int)
	currentFrames := make(map[frameKey]int)
	maxLevel := 0

	for _, s := range baseline {
		for level, f := range s.Stack {
			if fgd.isHexAddress(f.Name) {
				continue
			}
			key := frameKey{name: f.Name, level: level}
			baselineFrames[key] += s.Weight
			if level > maxLevel {
				maxLevel = level
			}
		}
	}
	for _, s := range current {
		for level, f := range s.Stack {
			if fgd.isHexAddress(f.Name) {
				continue
			}
			key := frameKey{name: f.Name, level: level}
			currentFrames[key] += s.Weight
			if level > maxLevel {
				maxLevel = level
			}
		}
	}

	if fgd.normalized {
		baselineFrames = fgd.normalizeFrameCounts(baselineFrames, fgd.baselineTotalSamples)
		currentFrames = fgd.normalizeFrameCounts(currentFrames, fgd.currentTotalSamples)
	}

	allKeys := make(map[frameKey]bool)
	for k := range baselineFrames {
		allKeys[k] = true
	}
	for k := range currentFrames {
		allKeys[k] = true
	}

	_ = maxLevel

	var frames []DiffFrame
	for k := range allKeys {
		baseCount := baselineFrames[k]
		curCount := currentFrames[k]
		delta := curCount - baseCount
		if negated {
			delta = -delta
		}

		pctChange := float64(0)
		if baseCount > 0 {
			pctChange = float64(curCount-baseCount) / float64(baseCount) * 100
			if negated {
				pctChange = -pctChange
			}
		}

		dir := "same"
		color := fgd.frameColor(baseCount, curCount, negated)
		if delta > 0 {
			dir = "up"
		} else if delta < 0 {
			dir = "down"
		}
		if baseCount == 0 && curCount > 0 {
			dir = "new"
			if negated {
				dir = "vanished"
			}
		}
		if baseCount > 0 && curCount == 0 {
			dir = "vanished"
			if negated {
				dir = "new"
			}
		}

		frames = append(frames, DiffFrame{
			Name:            k.name,
			Level:           k.level,
			BaselineSamples: baseCount,
			CurrentSamples:  curCount,
			Delta:           delta,
			PctChange:       pctChange,
			Direction:       dir,
			Color:           color,
		})
	}

	sort.Slice(frames, func(i, j int) bool {
		if frames[i].Level != frames[j].Level {
			return frames[i].Level < frames[j].Level
		}
		return absInt(frames[i].Delta) > absInt(frames[j].Delta)
	})

	return frames
}

func (fgd *FlameGraphDiff) frameColor(baseCount, curCount int, negated bool) string {
	if baseCount == curCount {
		return "#AAAAAA"
	}
	moreCPU := curCount > baseCount
	if negated {
		moreCPU = !moreCPU
	}
	if moreCPU {
		delta := curCount - baseCount
		if negated {
			delta = baseCount - curCount
		}
		pct := math.Min(math.Abs(float64(delta))/math.Max(float64(baseCount), 1)*3, 1.0)
		r := 200 + int(55*pct)
		g := 60 - int(40*pct)
		b := 60 - int(40*pct)
		if r > 255 {
			r = 255
		}
		if g < 0 {
			g = 0
		}
		if b < 0 {
			b = 0
		}
		return fmt.Sprintf("#%02x%02x%02x", r, g, b)
	}
	delta := baseCount - curCount
	if negated {
		delta = curCount - baseCount
	}
	pct := math.Min(math.Abs(float64(delta))/math.Max(float64(baseCount), 1)*3, 1.0)
	r := 60 - int(40*pct)
	g := 100 - int(50*pct)
	b := 200 + int(55*pct)
	if r < 0 {
		r = 0
	}
	if g < 0 {
		g = 0
	}
	if b > 255 {
		b = 255
	}
	return fmt.Sprintf("#%02x%02x%02x", r, g, b)
}

func (fgd *FlameGraphDiff) isHexAddress(name string) bool {
	name = strings.TrimSpace(name)
	if strings.HasPrefix(name, "0x") || strings.HasPrefix(name, "ffff") {
		return true
	}
	if len(name) >= 8 {
		hexChars := true
		for _, c := range name {
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
				hexChars = false
				break
			}
		}
		if hexChars {
			return true
		}
	}
	return false
}

func (fgd *FlameGraphDiff) aggregateSamples(samples []StackSample) map[string]int {
	counts := make(map[string]int)
	for _, s := range samples {
		if len(s.Stack) > 0 {
			top := s.Stack[0].Name
			counts[top] += s.Weight
		}
	}
	return counts
}

func (fgd *FlameGraphDiff) normalizeCounts(counts map[string]int, total int) map[string]int {
	if total == 0 {
		return counts
	}
	normalized := make(map[string]int)
	for name, count := range counts {
		normalized[name] = int(float64(count) / float64(total) * 10000)
	}
	return normalized
}

func (fgd *FlameGraphDiff) normalizeFrameCounts(counts map[frameKey]int, total int) map[frameKey]int {
	if total == 0 {
		return counts
	}
	normalized := make(map[frameKey]int)
	for k, count := range counts {
		normalized[k] = int(float64(count) / float64(total) * 10000)
	}
	return normalized
}

func (fgd *FlameGraphDiff) buildSummary(hotFuncs []DiffHotFunc, totalDelta int) string {
	if len(hotFuncs) == 0 {
		return "无显著性能变化"
	}

	top := hotFuncs[0]
	dirWord := "增加"
	if top.Direction == "down" || top.Direction == "vanished" {
		dirWord = "减少"
	}

	normalizedNote := ""
	if fgd.normalized {
		normalizedNote = " (已自动启用归一化，采样差异 >10%)"
	}

	return fmt.Sprintf(
		"%s() CPU %s %.1f%%%s。共 %d 个函数有显著变化。",
		top.Name, dirWord, top.PctChange, normalizedNote, len(hotFuncs),
	)
}

func absInt(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
