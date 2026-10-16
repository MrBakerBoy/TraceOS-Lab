package types

import "time"

// ============================================================================
// TraceOS 统一观测上下文 (ObsContext)
// 
// 设计参考: Grafana 三层架构 + Datadog Event Overlay + Google SRE RED/USE
// 将 5 大可视化模块的数据统一为 AI/前端可直接消费的结构化上下文
// ============================================================================

// ObsContext 是 TraceOS 观测体系的统一数据模型。
// 通过 NATS 事件总线发布，供前端 Store 和 AI 服务消费。
type ObsContext struct {
	SubmissionID  string     `json:"submission_id"`
	ExperimentID  string     `json:"experiment_id"`
	StudentID     string     `json:"student_id"`
	ExperimentType string   `json:"experiment_type"` // process/thread/memory/io/ipc/deadlock
	Language      string     `json:"language"`
	TimelineStart time.Time  `json:"timeline_start"`
	TimelineEnd   time.Time  `json:"timeline_end"`

	// ============================
	// Tier 1 — 全景总览 (4-6 Panels)
	// ============================
	HealthScore    HealthScore      `json:"health_score"`
	REDMetrics     REDMetrics       `json:"red_metrics"`
	USEMetrics     USEMetrics       `json:"use_metrics"`
	AnomalySummary []AnomalyDigest  `json:"anomaly_summary"`
	DiffVsBaseline *DiffSummary     `json:"diff_vs_baseline,omitempty"`

	// ============================
	// Tier 2 — 进程深度分析 (12-16 Panels)
	// ============================
	ProcessGraph    *ProcessGraph    `json:"process_graph,omitempty"`
	SyscallTraces   []SyscallEvent   `json:"syscall_traces,omitempty"`
	FlameGraph      *FlameGraphData  `json:"flamegraph,omitempty"`
	MemorySnapshots []MemorySnapshot `json:"memory_snapshots,omitempty"`
	LockEvents      []LockEvent      `json:"lock_events,omitempty"`
	ResourceMetrics []ResourceMetric `json:"resource_metrics,omitempty"`
	PerfEvents      []PerfEvent      `json:"perf_events,omitempty"`

	// ============================
	// Tier 3 — 函数级调试 (≤20 Panels)
	// ============================
	FlameGraphDiff2   *FlameGraphData      `json:"flamegraph_diff2,omitempty"`
	FlameGraphDiff1   *FlameGraphData      `json:"flamegraph_diff1,omitempty"`
	CallChains        []CallChain          `json:"call_chains,omitempty"`
	SourceAnnotations []SourceAnnotation   `json:"source_annotations,omitempty"`
	IOFlameGraph      *FlameGraphData      `json:"io_flamegraph,omitempty"`
	MemAllocFlameGraph *FlameGraphData     `json:"mem_alloc_flamegraph,omitempty"`
	LockContentionFG  *FlameGraphData      `json:"lock_contention_fg,omitempty"`
	SchedEvents       []SchedEvent         `json:"sched_events,omitempty"`
	RaceReports       []RaceReport         `json:"race_reports,omitempty"`
	DeadlockEvolution *DeadlockEvolution   `json:"deadlock_evolution,omitempty"`
	LeakReports       []LeakReport         `json:"leak_reports,omitempty"`
	SpanTree          *SpanTreeNode        `json:"span_tree,omitempty"`

	// ============================
	// 事件标注 (Datadog Event Overlay)
	// ============================
	EventAnnotations []EventAnnotation `json:"event_annotations,omitempty"`

	// ============================
	// Filter Bar 索引 (Datadog Template Variables)
	// ============================
	FilterFacets []FilterFacet `json:"filter_facets,omitempty"`

	// ============================
	// 复合风险指标 (Grafana 风格)
	// ============================
	RiskIndicators *RiskIndicators `json:"risk_indicators,omitempty"`

	// AI 注入标记
	AIAnnotations []AIAnnotation `json:"ai_annotations,omitempty"`
	ConceptTags   []ConceptTag   `json:"concept_tags,omitempty"`

	// 证据链接 — 诊断结论到可视化面板的可点击跳转
	EvidenceLinks []EvidenceLink `json:"evidence_links,omitempty"`
}

// ── Tier 1 类型 ──

type HealthScore struct {
	Score           int    `json:"score"`            // 0-100
	SLOCompliance   bool   `json:"slo_compliance"`
	ActiveAnomalies int    `json:"active_anomalies"`
	TrendDirection  string `json:"trend_direction"`  // "improving"/"stable"/"degrading"
}

type REDMetrics struct {
	RequestRate  float64 `json:"request_rate"`
	ErrorRate    float64 `json:"error_rate"`
	DurationP50  float64 `json:"duration_p50"`
	DurationP95  float64 `json:"duration_p95"`
	DurationP99  float64 `json:"duration_p99"`
}

type USEMetrics struct {
	CPUUtilization float64 `json:"cpu_utilization"`
	CPUSaturation  float64 `json:"cpu_saturation"`
	MemUtilization float64 `json:"mem_utilization"`
	MemSaturation  float64 `json:"mem_saturation"`
	IOUtilization  float64 `json:"io_utilization"`
	ErrorCount     int     `json:"error_count"`
}

type AnomalyDigest struct {
	Type              string   `json:"type"`               // deadlock|leak|performance|failure
	Severity          string   `json:"severity"`           // critical|warning|info
	Summary           string   `json:"summary"`
	CoffmanConditions []string `json:"coffman_conditions,omitempty"`
	LinkToTier2Panel  string   `json:"link_to_tier2_panel"`
}

type DiffSummary struct {
	CPUChange       float64 `json:"cpu_change"`
	MemChange       float64 `json:"mem_change"`
	IOChange        float64 `json:"io_change"`
	SyscallSimiliarity float64 `json:"syscall_similarity"`
}

// ── Tier 2 类型 ──

type ProcessGraph struct {
	Nodes    []ProcessNode    `json:"nodes"`
	Edges    []ProcessEdge    `json:"edges"`
	Metadata ProcessMetadata  `json:"metadata"`
}

type ProcessNode struct {
	ID           int    `json:"id"`
	PID          int    `json:"pid"`
	TID          int    `json:"tid,omitempty"`
	Name         string `json:"name"`
	Type         string `json:"type"` // "process"|"thread"
	SyscallCount int    `json:"syscall_count"`
	ErrorCount   int    `json:"error_count"`
}

type ProcessEdge struct {
	Source   int    `json:"source"`
	Target   int    `json:"target"`
	Type     string `json:"type"`     // fork|pipe|signal|futex|clone
	Count    int    `json:"count"`
	LatencyMs float64 `json:"latency_ms"`
}

type ProcessMetadata struct {
	TotalProcesses int `json:"total_processes"`
	TotalThreads   int `json:"total_threads"`
	TotalIPC       int `json:"total_ipc"`
}

type SyscallEvent struct {
	Timestamp    time.Time `json:"timestamp"`
	Syscall      string    `json:"syscall"`
	PID          int       `json:"pid"`
	TID          int       `json:"tid"`
	Ret          int64     `json:"ret"`
	DurationNs   int64     `json:"duration_ns"`
	ErrorCode    int       `json:"error_code,omitempty"`
	ErrorName    string    `json:"error_name,omitempty"`
	Args         string    `json:"args,omitempty"`
	SemanticLabel string   `json:"semantic_label,omitempty"`
	Severity     string    `json:"severity,omitempty"`
	OSConcept    string    `json:"os_concept,omitempty"`
	SourceLine   int       `json:"source_line,omitempty"`
	SourceFile   string    `json:"source_file,omitempty"`
}

type FlameGraphData struct {
	SVG          string        `json:"svg"`
	HotFunctions []HotFunction `json:"hot_functions"`
	UserPct      float64       `json:"user_pct"`
	KernelPct    float64       `json:"kernel_pct"`
	TotalSamples int           `json:"total_samples"`
	SampleRate   int           `json:"sample_rate"` // Hz
	ProfileStart time.Time     `json:"profile_start"`
	ProfileEnd   time.Time     `json:"profile_end"`
}

type HotFunction struct {
	Name       string  `json:"name"`
	Percentage float64 `json:"percentage"`
	Samples    int     `json:"samples"`
	SourceFile string  `json:"source_file,omitempty"`
	SourceLine int     `json:"source_line,omitempty"`
	Module     string  `json:"module,omitempty"`
}

type MemorySnapshot struct {
	Timestamp  time.Time       `json:"timestamp"`
	TextStart  uint64          `json:"text_start"`
	TextSize   uint64          `json:"text_size"`
	DataStart  uint64          `json:"data_start"`
	DataSize   uint64          `json:"data_size"`
	BSSStart   uint64          `json:"bss_start"`
	BSSSize    uint64          `json:"bss_size"`
	HeapStart  uint64          `json:"heap_start"`
	HeapSize   uint64          `json:"heap_size"`
	StackStart uint64          `json:"stack_start"`
	StackSize  uint64          `json:"stack_size"`
	MmapTotal  uint64          `json:"mmap_total"`
	MmapCount  int             `json:"mmap_count"`
}

type LockEvent struct {
	Timestamp   time.Time `json:"timestamp"`
	LockAddr    uint64    `json:"lock_addr"`
	LockType    string    `json:"lock_type"`    // "mutex"|"spinlock"|"rwlock"
	Op          string    `json:"op"`           // "lock"|"unlock"|"trylock"
	TID         int       `json:"tid"`
	HolderTID   int       `json:"holder_tid,omitempty"`
	WaitDurationNs int64  `json:"wait_duration_ns,omitempty"`
	SourceFile  string    `json:"source_file,omitempty"`
	SourceLine  int       `json:"source_line,omitempty"`
}

type ResourceMetric struct {
	Timestamp       time.Time `json:"timestamp"`
	CPUPercent      float64   `json:"cpu_percent"`
	MemRSS          uint64    `json:"mem_rss"`
	MemVirtual      uint64    `json:"mem_virtual"`
	IOReadBytes     uint64    `json:"io_read_bytes"`
	IOWriteBytes    uint64    `json:"io_write_bytes"`
	FDCount         int       `json:"fd_count"`
	ThreadCount     int       `json:"thread_count"`
	PageFaultMin    uint64    `json:"page_fault_min"`
	PageFaultMaj    uint64    `json:"page_fault_maj"`
	ContextSwitches uint64    `json:"context_switches"`
	CFSThrottledUs  uint64    `json:"cfs_throttled_us"`
	OOMScore        int       `json:"oom_score"`
}

type PerfEvent struct {
	Timestamp   time.Time `json:"timestamp"`
	EventType   string    `json:"event_type"`
	PID         int       `json:"pid"`
	TID         int       `json:"tid"`
	Symbol      string    `json:"symbol,omitempty"`
	Count       uint64    `json:"count"`
	SourceFile  string    `json:"source_file,omitempty"`
	SourceLine  int       `json:"source_line,omitempty"`
}

// ── Tier 3 类型 ──

type CallChain struct {
	RootCall   string        `json:"root_call"`
	Chain      []CallStep    `json:"chain"`
	TotalLatencyNs int64     `json:"total_latency_ns"`
}

type CallStep struct {
	Function   string `json:"function"`
	SourceFile string `json:"source_file"`
	SourceLine int    `json:"source_line"`
	LatencyNs  int64  `json:"latency_ns"`
	IsKernelSpace bool `json:"is_kernel_space"`
}

type SourceAnnotation struct {
	SourceFile string `json:"source_file"`
	Line       int    `json:"line"`
	Annotation string `json:"annotation"`
	Severity   string `json:"severity"`
	LinkToPanel string `json:"link_to_panel,omitempty"`
}

type SchedEvent struct {
	Timestamp    time.Time `json:"timestamp"`
	PrevPID      int       `json:"prev_pid"`
	PrevTID      int       `json:"prev_tid"`
	NextPID      int       `json:"next_pid"`
	NextTID      int       `json:"next_tid"`
	PrevState    string    `json:"prev_state"`
	CPU          int       `json:"cpu"`
	IsMigration  bool      `json:"is_migration"`
}

type RaceReport struct {
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
	HasHappensBefore bool `json:"has_happens_before"`
	TeachingHint string   `json:"teaching_hint,omitempty"`
}

type DeadlockEvolution struct {
	Steps      []DeadlockStep `json:"steps"`
	CoffmanConditions map[string]bool `json:"coffman_conditions"`
	CycleInfo  string         `json:"cycle_info"`
}

type DeadlockStep struct {
	Order       int       `json:"order"`
	Timestamp   time.Time `json:"timestamp"`
	TID         int       `json:"tid"`
	Action      string    `json:"action"` // lock|unlock|wait
	LockAddr    uint64    `json:"lock_addr"`
	Description string    `json:"description"`
}

type LeakReport struct {
	Severity      string        `json:"severity"` // definitely|indirectly|possibly|reachable
	Address       uint64        `json:"address"`
	Size          uint64        `json:"size"`
	AllocTime     time.Time     `json:"alloc_time"`
	CallStack     []StackFrame  `json:"call_stack"`
	SourceFile    string        `json:"source_file"`
	SourceLine    int           `json:"source_line"`
	Description   string        `json:"description"`
	FixSuggestion string        `json:"fix_suggestion,omitempty"`
	GrowthRate    float64       `json:"growth_rate,omitempty"` // MB/s
}

type StackFrame struct {
	Function   string `json:"function"`
	SourceFile string `json:"source_file"`
	SourceLine int    `json:"source_line"`
	Module     string `json:"module,omitempty"`
}

type SpanTreeNode struct {
	SpanID       string          `json:"span_id"`
	ParentSpanID string          `json:"parent_span_id,omitempty"`
	OperationName string         `json:"operation_name"`
	DurationMs   float64         `json:"duration_ms"`
	SyscallCount int             `json:"syscall_count"`
	ErrorCount   int             `json:"error_count"`
	SelfTimeMs   float64         `json:"self_time_ms"`
	Tags         map[string]string `json:"tags,omitempty"`
	Children     []SpanTreeNode  `json:"children,omitempty"`
}

// ── 事件标注类型 ──

type EventAnnotation struct {
	Timestamp    time.Time `json:"timestamp"`
	Type         string    `json:"type"`   // compile|deploy|start|test_pass|test_fail|anomaly|oom
	Label        string    `json:"label"`
	SubmissionID string    `json:"submission_id"`
	Severity     string    `json:"severity,omitempty"`
	Source       string    `json:"source,omitempty"` // process|memory|lock|io
	RelatedTID   int       `json:"related_tid,omitempty"`
}

// ── Filter Bar 类型 ──

type FilterFacet struct {
	Field  string   `json:"field"`  // syscall|severity|process|thread|fd|source
	Values []string `json:"values"`
	Active []string `json:"active,omitempty"`
}

// ── 复合风险指标 ──

type RiskIndicators struct {
	HealthScore      float64 `json:"health_score"`       // 0-100
	SaturationIndex  float64 `json:"saturation_index"`   // 0-1
	DependencyRisk   float64 `json:"dependency_risk"`    // 0-1
	BacklogGrowth    float64 `json:"backlog_growth"`     // items/s
	OOMRiskRate      float64 `json:"oom_risk_rate"`      // 0-1
	CPUSaturationPct float64 `json:"cpu_saturation_pct"`
	MemSaturationPct float64 `json:"mem_saturation_pct"`
	FDSaturationPct  float64 `json:"fd_saturation_pct"`
}

// ── AI 注入类型 ──

type AIAnnotation struct {
	TargetField string    `json:"target_field"`
	Content     string    `json:"content"`
	Confidence  float64   `json:"confidence"`
	CreatedAt   time.Time `json:"created_at"`
}

type ConceptTag struct {
	Name        string `json:"name"`
	ConceptID   string `json:"concept_id"`
	Relevance   float64 `json:"relevance"`
	LinkedField string  `json:"linked_field"`
}

// ── 证据链接类型 (Diagnosis → Visualization) ──

// EvidenceLink 连接诊断结论与可视化面板高亮目标。
// 由 EventLinker 确定性生成，前端 DiagnosisPanel 渲染为可点击芯片。
type EvidenceLink struct {
	ID           string  `json:"id"`
	Label        string  `json:"label"`         // e.g. "futex 死锁 @ T+350ms"
	Panel        string  `json:"panel"`         // "trace" | "flamegraph" | "memory3d" | "ebpf"
	TimestampMs  float64 `json:"timestamp_ms"`  // ms offset from timeline start
	HighlightKey string  `json:"highlight_key"` // function name, segment, TID, syscall
	Description  string  `json:"description"`   // tooltip
	Severity     string  `json:"severity"`      // "critical" | "warning" | "info"
	SourceFile   string  `json:"source_file,omitempty"`
	SourceLine   int     `json:"source_line,omitempty"`
}
