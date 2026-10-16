package services

import (
	"fmt"
	"sort"
	"time"

	"github.com/traceos-lab/core-service/internal/types"
)

// ObsContextBuilder assembles an ObsContext from raw evaluation results.
// It bridges the evaluator pipeline output with the unified observation data model.
type ObsContextBuilder struct {
	// Pattern libraries for semantic classification
	semanticEngine *SemanticEngine
}

// NewObsContextBuilder creates a new builder with default pattern libraries.
func NewObsContextBuilder() *ObsContextBuilder {
	return &ObsContextBuilder{
		semanticEngine: NewSemanticEngine(),
	}
}

// Build creates a complete ObsContext from raw trace/log/metric data.
func (b *ObsContextBuilder) Build(params BuildParams) *types.ObsContext {
	ctx := &types.ObsContext{
		SubmissionID:   params.SubmissionID,
		ExperimentID:   params.ExperimentID,
		StudentID:      params.StudentID,
		ExperimentType: params.ExperimentType,
		Language:       params.Language,
		TimelineStart:  params.TimelineStart,
		TimelineEnd:    params.TimelineEnd,
	}

	// Build Tier 1 — Panoramic Overview
	b.buildTier1(ctx, params)

	// Build Tier 2 — Process Deep Analysis
	b.buildTier2(ctx, params)

	// Build Tier 3 — Function-level Debug
	b.buildTier3(ctx, params)

	// Build event annotations
	b.buildEventAnnotations(ctx, params)

	// Build filter facets
	b.buildFilterFacets(ctx, params)

	// Build risk indicators
	b.buildRiskIndicators(ctx, params)

	// Build evidence links (cross-module navigation targets)
	linker := NewEventLinker()
	ctx.EvidenceLinks = linker.GenerateEvidenceLinks(ctx)

	return ctx
}

type BuildParams struct {
	SubmissionID    string
	ExperimentID    string
	StudentID       string
	ExperimentType  string
	Language        string
	TimelineStart   time.Time
	TimelineEnd     time.Time
	Score           int
	TotalScore      int
	PassedCases     int
	TotalCases      int
	CompileError    *string
	RuntimeError    *string
	TestResults     []TestResultInput
	SyscallTraces   []SyscallTraceInput
	MemorySnapshots []MemorySnapshotInput
	LockEvents      []LockEventInput
	ResourceMetrics []ResourceMetricInput
	PerfEvents      []PerfEventInput
	FlameGraph      *FlameGraphInput
	FlameGraphDiff2 *FlameGraphInput
	FlameGraphDiff1 *FlameGraphInput
	DetectedIssues  []DetectedIssueInput
}

type TestResultInput struct {
	Name           string
	Passed         bool
	ActualOutput   string
	ExpectedOutput string
	ExitCode       int
	RuntimeError   string
	ExecTimeMs     int
}

type SyscallTraceInput struct {
	Timestamp  time.Time
	Syscall    string
	PID        int
	TID        int
	Ret        int64
	DurationNs int64
	ErrorCode  int
	ErrorName  string
	Args       string
	SourceFile string
	SourceLine int
}

type MemorySnapshotInput struct {
	Timestamp  time.Time
	TextStart  uint64
	TextSize   uint64
	DataStart  uint64
	DataSize   uint64
	BSSStart   uint64
	BSSSize    uint64
	HeapStart  uint64
	HeapSize   uint64
	StackStart uint64
	StackSize  uint64
	MmapTotal  uint64
	MmapCount  int
}

type LockEventInput struct {
	Timestamp  time.Time
	LockAddr   uint64
	LockType   string
	Op         string
	TID        int
	HolderTID  int
	WaitNs     int64
	SourceFile string
	SourceLine int
}

type ResourceMetricInput struct {
	Timestamp       time.Time
	CPUPercent      float64
	MemRSS          uint64
	MemVirtual      uint64
	IOReadBytes     uint64
	IOWriteBytes    uint64
	FDCount         int
	ThreadCount     int
	PageFaultMin    uint64
	PageFaultMaj    uint64
	ContextSwitches uint64
	CFSThrottledUs  uint64
	OOMScore        int
}

type PerfEventInput struct {
	Timestamp  time.Time
	EventType  string
	PID        int
	TID        int
	Symbol     string
	Count      uint64
	SourceFile string
	SourceLine int
}

type FlameGraphInput struct {
	SVG          string
	HotFunctions []struct {
		Name       string
		Percentage float64
		Samples    int
		SourceFile string
		SourceLine int
		Module     string
	}
	UserPct      float64
	KernelPct    float64
	TotalSamples int
	SampleRate   int
	ProfileStart time.Time
	ProfileEnd   time.Time
}

type DetectedIssueInput struct {
	Category    string
	Title       string
	Severity    string
	Description string
	SourceFile  string
	SourceLine  int
}

// buildTier1 constructs the panoramic overview layer.
func (b *ObsContextBuilder) buildTier1(ctx *types.ObsContext, params BuildParams) {
	// Health score
	anomalies := len(params.DetectedIssues)
	score := b.calcHealthScore(params, anomalies)

	ctx.HealthScore = types.HealthScore{
		Score:           score,
		SLOCompliance:   score >= 70,
		ActiveAnomalies: anomalies,
		TrendDirection:  b.determineTrend(params),
	}

	// RED metrics from syscall traces
	ctx.REDMetrics = b.calcREDMetrics(params.SyscallTraces, params.TimelineStart, params.TimelineEnd)

	// USE metrics from resource data
	ctx.USEMetrics = b.calcUSEMetrics(params.ResourceMetrics)

	// Anomaly summary
	ctx.AnomalySummary = b.buildAnomalySummary(params)
}

func (b *ObsContextBuilder) calcHealthScore(params BuildParams, anomalies int) int {
	base := 100

	// Score penalty
	if params.TotalScore > 0 {
		scoreRatio := float64(params.Score) / float64(params.TotalScore)
		base -= int((1.0 - scoreRatio) * 40)
	}

	// Test case penalty
	if params.TotalCases > 0 {
		passRatio := float64(params.PassedCases) / float64(params.TotalCases)
		base -= int((1.0 - passRatio) * 30)
	}

	// Anomaly penalty
	base -= anomalies * 10

	// Error penalty
	if params.CompileError != nil || params.RuntimeError != nil {
		base -= 25
	}

	if base < 0 {
		base = 0
	}
	if base > 100 {
		base = 100
	}
	return base
}

func (b *ObsContextBuilder) determineTrend(params BuildParams) string {
	if params.CompileError != nil {
		return "degrading"
	}
	if params.TotalCases > 0 && params.PassedCases == params.TotalCases {
		return "improving"
	}
	return "stable"
}

func (b *ObsContextBuilder) calcREDMetrics(traces []SyscallTraceInput, start, end time.Time) types.REDMetrics {
	durationSec := end.Sub(start).Seconds()
	if durationSec <= 0 {
		durationSec = 1
	}

	totalCalls := len(traces)
	errorCalls := 0
	var durations []float64

	for _, t := range traces {
		if t.ErrorCode != 0 || t.ErrorName != "" {
			errorCalls++
		}
		durations = append(durations, float64(t.DurationNs)/1e6) // ns → ms
	}

	sort.Float64s(durations)

	red := types.REDMetrics{
		RequestRate: float64(totalCalls) / durationSec,
	}
	if totalCalls > 0 {
		red.ErrorRate = float64(errorCalls) / float64(totalCalls) * 100
	}
	if len(durations) > 0 {
		red.DurationP50 = b.percentile(durations, 0.50)
		red.DurationP95 = b.percentile(durations, 0.95)
		red.DurationP99 = b.percentile(durations, 0.99)
	}

	return red
}

func (b *ObsContextBuilder) calcUSEMetrics(resources []ResourceMetricInput) types.USEMetrics {
	if len(resources) == 0 {
		return types.USEMetrics{}
	}
	last := resources[len(resources)-1]
	return types.USEMetrics{
		CPUUtilization: last.CPUPercent,
		CPUSaturation:  float64(last.CFSThrottledUs) / 1e6,
		MemUtilization: float64(last.MemRSS) / (512 * 1024 * 1024) * 100,
		MemSaturation:  float64(last.PageFaultMaj),
		IOUtilization:  0,
	}
}

func (b *ObsContextBuilder) buildAnomalySummary(params BuildParams) []types.AnomalyDigest {
	var summary []types.AnomalyDigest
	for _, issue := range params.DetectedIssues {
		summary = append(summary, types.AnomalyDigest{
			Type:             issue.Category,
			Severity:         issue.Severity,
			Summary:          issue.Title,
			LinkToTier2Panel: b.mapCategoryToPanel(issue.Category),
		})
	}
	// Limit to 5
	if len(summary) > 5 {
		summary = summary[:5]
	}
	return summary
}

func (b *ObsContextBuilder) mapCategoryToPanel(category string) string {
	m := map[string]string{
		"deadlock":     "locks",
		"race":         "thread_states",
		"leak":         "memory_trend",
		"zombie":       "process_graph",
		"performance":  "flamegraph",
		"fd_leak":      "sandbox_resources",
	}
	if v, ok := m[category]; ok {
		return v
	}
	return "overview"
}

// buildTier2 constructs the process deep analysis layer.
func (b *ObsContextBuilder) buildTier2(ctx *types.ObsContext, params BuildParams) {
	// Process graph from syscall traces
	ctx.ProcessGraph = b.buildProcessGraph(params.SyscallTraces)

	// Syscall traces → ObsContext syscall events
	ctx.SyscallTraces = b.convertSyscallTraces(params.SyscallTraces)

	// Flame graph
	if params.FlameGraph != nil {
		ctx.FlameGraph = b.convertFlameGraph(params.FlameGraph)
	}

	// Memory snapshots
	ctx.MemorySnapshots = b.convertMemorySnapshots(params.MemorySnapshots)

	// Lock events
	ctx.LockEvents = b.convertLockEvents(params.LockEvents)

	// Resource metrics
	ctx.ResourceMetrics = b.convertResourceMetrics(params.ResourceMetrics)

	// Perf events
	ctx.PerfEvents = b.convertPerfEvents(params.PerfEvents)
}

func (b *ObsContextBuilder) buildProcessGraph(traces []SyscallTraceInput) *types.ProcessGraph {
	pidSet := make(map[int]bool)
	tidSet := make(map[int]bool)
	var nodes []types.ProcessNode
	var edges []types.ProcessEdge
	edgeMap := make(map[string]*types.ProcessEdge)

	for _, t := range traces {
		if t.PID > 0 {
			pidSet[t.PID] = true
		}
		if t.TID > 0 {
			tidSet[t.TID] = true
		}

		// Detect fork/clone relationships
		if t.Syscall == "clone" || t.Syscall == "fork" {
			if t.Ret > 0 {
				childPID := int(t.Ret)
				pidSet[childPID] = true
				key := fmt.Sprintf("fork_%d_%d", t.PID, childPID)
				if _, ok := edgeMap[key]; !ok {
					edgeMap[key] = &types.ProcessEdge{
						Source: t.PID,
						Target: childPID,
						Type:   "fork",
						Count:  1,
					}
				} else {
					edgeMap[key].Count++
				}
			}
		}
	}

	for pid := range pidSet {
		nodes = append(nodes, types.ProcessNode{
			ID:   pid,
			PID:  pid,
			Name: fmt.Sprintf("PID=%d", pid),
			Type: "process",
		})
	}

	for _, edge := range edgeMap {
		edges = append(edges, *edge)
	}

	return &types.ProcessGraph{
		Nodes:    nodes,
		Edges:    edges,
		Metadata: types.ProcessMetadata{
			TotalProcesses: len(pidSet),
			TotalThreads:   len(tidSet),
			TotalIPC:       len(edges),
		},
	}
}

// buildTier3 constructs the function-level debug layer.
func (b *ObsContextBuilder) buildTier3(ctx *types.ObsContext, params BuildParams) {
	if params.FlameGraphDiff2 != nil {
		ctx.FlameGraphDiff2 = b.convertFlameGraph(params.FlameGraphDiff2)
	}
	if params.FlameGraphDiff1 != nil {
		ctx.FlameGraphDiff1 = b.convertFlameGraph(params.FlameGraphDiff1)
	}
}

// buildEventAnnotations constructs Datadog-style event annotations.
func (b *ObsContextBuilder) buildEventAnnotations(ctx *types.ObsContext, params BuildParams) {
	var annotations []types.EventAnnotation

	// Compile events
	if params.CompileError != nil {
		annotations = append(annotations, types.EventAnnotation{
			Timestamp:    params.TimelineStart,
			Type:         "compile",
			Label:        "编译失败: " + *params.CompileError,
			SubmissionID: params.SubmissionID,
			Severity:     "critical",
			Source:       "process",
		})
	} else {
		annotations = append(annotations, types.EventAnnotation{
			Timestamp:    params.TimelineStart,
			Type:         "compile",
			Label:        "编译成功",
			SubmissionID: params.SubmissionID,
			Severity:     "info",
			Source:       "process",
		})
	}

	// Program start
	annotations = append(annotations, types.EventAnnotation{
		Timestamp:    params.TimelineStart,
		Type:         "start",
		Label:        "程序启动",
		SubmissionID: params.SubmissionID,
		Severity:     "info",
		Source:       "process",
	})

	// Fork events
	for _, t := range params.SyscallTraces {
		if t.Syscall == "fork" || t.Syscall == "clone" {
			annotations = append(annotations, types.EventAnnotation{
				Timestamp:    t.Timestamp,
				Type:         "start",
				Label:        t.Syscall + "()",
				SubmissionID: params.SubmissionID,
				Source:       "process",
				RelatedTID:   t.TID,
			})
		}
		if t.Syscall == "futex" && t.ErrorCode != 0 {
			annotations = append(annotations, types.EventAnnotation{
				Timestamp:    t.Timestamp,
				Type:         "anomaly",
				Label:        "futex 等待超时",
				SubmissionID: params.SubmissionID,
				Severity:     "warning",
				Source:       "lock",
				RelatedTID:   t.TID,
			})
		}
	}

	// Deadlock detection
	for _, issue := range params.DetectedIssues {
		if issue.Category == "deadlock" {
			lastTrace := params.SyscallTraces[len(params.SyscallTraces)-1]
			annotations = append(annotations, types.EventAnnotation{
				Timestamp:    lastTrace.Timestamp,
				Type:         "anomaly",
				Label:        "死锁检测: " + issue.Title,
				SubmissionID: params.SubmissionID,
				Severity:     "critical",
				Source:       "lock",
			})
		}
	}

	// Memory events
	for _, m := range params.MemorySnapshots {
		if m.HeapSize > 100*1024*1024 { // >100MB
			annotations = append(annotations, types.EventAnnotation{
				Timestamp:    m.Timestamp,
				Type:         "anomaly",
				Label:        "内存增长至 " + fmt.Sprintf("%.1fMB", float64(m.HeapSize)/(1024*1024)),
				SubmissionID: params.SubmissionID,
				Severity:     "warning",
				Source:       "memory",
			})
		}
	}

	ctx.EventAnnotations = annotations
}

// buildFilterFacets constructs filter bar facets.
func (b *ObsContextBuilder) buildFilterFacets(ctx *types.ObsContext, params BuildParams) {
	syscallSet := make(map[string]bool)
	severitySet := make(map[string]bool)
	processSet := make(map[string]bool)

	for _, t := range params.SyscallTraces {
		syscallSet[t.Syscall] = true
		if t.ErrorCode != 0 {
			severitySet["error"] = true
		}
		processSet[fmt.Sprintf("%d", t.PID)] = true
	}
	severitySet["info"] = true
	severitySet["warning"] = true

	ctx.FilterFacets = []types.FilterFacet{
		{Field: "syscall", Values: mapKeys(syscallSet)},
		{Field: "severity", Values: mapKeys(severitySet)},
		{Field: "process", Values: mapKeys(processSet)},
		{Field: "source", Values: []string{"process", "memory", "lock", "io"}},
	}
}

// buildRiskIndicators calculates composite risk indicators.
func (b *ObsContextBuilder) buildRiskIndicators(ctx *types.ObsContext, params BuildParams) {
	use := ctx.USEMetrics

	saturationIndex := 0.40*(use.CPUUtilization/100) +
		0.35*(use.MemUtilization/100) +
		0.25*minF(1, use.MemSaturation/10)

	depRisk := 0.0
	if ctx.REDMetrics.ErrorRate > 0 {
		depRisk += ctx.REDMetrics.ErrorRate / 100 * 0.5
	}

	ctx.RiskIndicators = &types.RiskIndicators{
		HealthScore:      float64(ctx.HealthScore.Score),
		SaturationIndex:  saturationIndex,
		DependencyRisk:   depRisk,
		BacklogGrowth:    0,
		OOMRiskRate:      use.MemUtilization / 100,
		CPUSaturationPct: use.CPUUtilization,
		MemSaturationPct: use.MemUtilization,
	}
}

// ── Conversion helpers ──

func (b *ObsContextBuilder) convertSyscallTraces(inputs []SyscallTraceInput) []types.SyscallEvent {
	result := make([]types.SyscallEvent, len(inputs))
	for i, in := range inputs {
		evt := types.SyscallEvent{
			Timestamp:  in.Timestamp,
			Syscall:    in.Syscall,
			PID:        in.PID,
			TID:        in.TID,
			Ret:        in.Ret,
			DurationNs: in.DurationNs,
			ErrorCode:  in.ErrorCode,
			ErrorName:  in.ErrorName,
			Args:       in.Args,
			SourceFile: in.SourceFile,
			SourceLine: in.SourceLine,
		}
		// Apply semantic labeling
		b.applySemanticLabel(&evt)
		result[i] = evt
	}
	return result
}

func (b *ObsContextBuilder) convertFlameGraph(fg *FlameGraphInput) *types.FlameGraphData {
	hfs := make([]types.HotFunction, len(fg.HotFunctions))
	for i, h := range fg.HotFunctions {
		hfs[i] = types.HotFunction{
			Name:       h.Name,
			Percentage: h.Percentage,
			Samples:    h.Samples,
			SourceFile: h.SourceFile,
			SourceLine: h.SourceLine,
			Module:     h.Module,
		}
	}
	return &types.FlameGraphData{
		SVG:          fg.SVG,
		HotFunctions: hfs,
		UserPct:      fg.UserPct,
		KernelPct:    fg.KernelPct,
		TotalSamples: fg.TotalSamples,
		SampleRate:   fg.SampleRate,
		ProfileStart: fg.ProfileStart,
		ProfileEnd:   fg.ProfileEnd,
	}
}

func (b *ObsContextBuilder) convertMemorySnapshots(inputs []MemorySnapshotInput) []types.MemorySnapshot {
	result := make([]types.MemorySnapshot, len(inputs))
	for i, in := range inputs {
		result[i] = types.MemorySnapshot{
			Timestamp:  in.Timestamp,
			TextStart:  in.TextStart,
			TextSize:   in.TextSize,
			DataStart:  in.DataStart,
			DataSize:   in.DataSize,
			BSSStart:   in.BSSStart,
			BSSSize:    in.BSSSize,
			HeapStart:  in.HeapStart,
			HeapSize:   in.HeapSize,
			StackStart: in.StackStart,
			StackSize:  in.StackSize,
			MmapTotal:  in.MmapTotal,
			MmapCount:  in.MmapCount,
		}
	}
	return result
}

func (b *ObsContextBuilder) convertLockEvents(inputs []LockEventInput) []types.LockEvent {
	result := make([]types.LockEvent, len(inputs))
	for i, in := range inputs {
		result[i] = types.LockEvent{
			Timestamp:      in.Timestamp,
			LockAddr:       in.LockAddr,
			LockType:       in.LockType,
			Op:             in.Op,
			TID:            in.TID,
			HolderTID:      in.HolderTID,
			WaitDurationNs: in.WaitNs,
			SourceFile:     in.SourceFile,
			SourceLine:     in.SourceLine,
		}
	}
	return result
}

func (b *ObsContextBuilder) convertResourceMetrics(inputs []ResourceMetricInput) []types.ResourceMetric {
	result := make([]types.ResourceMetric, len(inputs))
	for i, in := range inputs {
		result[i] = types.ResourceMetric{
			Timestamp:       in.Timestamp,
			CPUPercent:      in.CPUPercent,
			MemRSS:          in.MemRSS,
			MemVirtual:      in.MemVirtual,
			IOReadBytes:     in.IOReadBytes,
			IOWriteBytes:    in.IOWriteBytes,
			FDCount:         in.FDCount,
			ThreadCount:     in.ThreadCount,
			PageFaultMin:    in.PageFaultMin,
			PageFaultMaj:    in.PageFaultMaj,
			ContextSwitches: in.ContextSwitches,
			CFSThrottledUs:  in.CFSThrottledUs,
			OOMScore:        in.OOMScore,
		}
	}
	return result
}

func (b *ObsContextBuilder) convertPerfEvents(inputs []PerfEventInput) []types.PerfEvent {
	result := make([]types.PerfEvent, len(inputs))
	for i, in := range inputs {
		result[i] = types.PerfEvent{
			Timestamp:  in.Timestamp,
			EventType:  in.EventType,
			PID:        in.PID,
			TID:        in.TID,
			Symbol:     in.Symbol,
			Count:      in.Count,
			SourceFile: in.SourceFile,
			SourceLine: in.SourceLine,
		}
	}
	return result
}

// applySemanticLabel applies OS-level semantic labeling to a syscall event.
func (b *ObsContextBuilder) applySemanticLabel(evt *types.SyscallEvent) {
	label, concept, severity := b.semanticEngine.ClassifyEvent(evt.Syscall)
	if label != "" {
		evt.SemanticLabel = label
		evt.OSConcept = concept
		evt.Severity = severity
	}
}

// ── Utility functions ──

func (b *ObsContextBuilder) percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(float64(len(sorted)) * p)
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func minF(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func mapKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
