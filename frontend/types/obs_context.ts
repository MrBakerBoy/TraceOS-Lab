/**
 * TraceOS — Unified Observation Context types (mirrors Go obs_context.go)
 *
 * Three-tier architecture:
 *   Tier 1 – Panoramic Overview (4-6 panels): health score, RED/USE, anomalies
 *   Tier 2 – Process Deep Analysis (12-16 panels): flamegraph, traces, memory, locks
 *   Tier 3 – Function-level Debug (≤20 panels): diff flamegraphs, call chains, races
 *
 * Design references:
 *   Grafana 3-tier dashboards · Datadog Event Overlay · Google SRE RED/USE
 */

// ═══════════════════════════════════════════════════════════════════
// Core ObsContext
// ═══════════════════════════════════════════════════════════════════

export interface ObsContext {
  submission_id: string;
  experiment_id: string;
  student_id: string;
  experiment_type: string;
  language: string;
  timeline_start: string;
  timeline_end: string;

  // Tier 1
  health_score: HealthScore;
  red_metrics: REDMetrics;
  use_metrics: USEMetrics;
  anomaly_summary: AnomalyDigest[];
  diff_vs_baseline?: DiffSummary;

  // Tier 2
  process_graph?: ProcessGraph;
  syscall_traces?: SyscallEvent[];
  flamegraph?: FlameGraphData;
  memory_snapshots?: MemorySnapshot[];
  lock_events?: LockEvent[];
  resource_metrics?: ResourceMetric[];
  perf_events?: PerfEvent[];

  // Tier 3
  flamegraph_diff2?: FlameGraphData;
  flamegraph_diff1?: FlameGraphData;
  call_chains?: CallChain[];
  source_annotations?: SourceAnnotation[];
  io_flamegraph?: FlameGraphData;
  mem_alloc_flamegraph?: FlameGraphData;
  lock_contention_fg?: FlameGraphData;
  sched_events?: SchedEvent[];
  race_reports?: RaceReport[];
  deadlock_evolution?: DeadlockEvolution;
  leak_reports?: LeakReport[];
  span_tree?: SpanTreeNode;

  // Event annotations (Datadog style)
  event_annotations?: EventAnnotation[];

  // Filter bar facets
  filter_facets?: FilterFacet[];

  // Composite risk indicators (Grafana style)
  risk_indicators?: RiskIndicators;

  // AI annotations
  ai_annotations?: AIAnnotation[];
  concept_tags?: ConceptTag[];

  // Evidence links — diagnosis → visualization navigation
  evidence_links?: EvidenceLink[];
}

// ═══════════════════════════════════════════════════════════════════
// Tier 1 — Panoramic Overview
// ═══════════════════════════════════════════════════════════════════

export interface HealthScore {
  score: number;             // 0–100
  slo_compliance: boolean;
  active_anomalies: number;
  trend_direction: "improving" | "stable" | "degrading";
}

export interface REDMetrics {
  request_rate: number;      // syscalls/s
  error_rate: number;        // %
  duration_p50: number;      // ms
  duration_p95: number;
  duration_p99: number;
}

export interface USEMetrics {
  cpu_utilization: number;
  cpu_saturation: number;
  mem_utilization: number;
  mem_saturation: number;
  io_utilization: number;
  error_count: number;
}

export interface AnomalyDigest {
  type: "deadlock" | "leak" | "performance" | "failure";
  severity: "critical" | "warning" | "info";
  summary: string;
  coffman_conditions?: string[];
  link_to_tier2_panel: string;
}

export interface DiffSummary {
  cpu_change: number;
  mem_change: number;
  io_change: number;
  syscall_similarity: number;
}

// ═══════════════════════════════════════════════════════════════════
// Tier 2 — Process Deep Analysis
// ═══════════════════════════════════════════════════════════════════

export interface ProcessGraph {
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  metadata: ProcessMetadata;
}

export interface ProcessNode {
  id: number;
  pid: number;
  tid?: number;
  name: string;
  type: "process" | "thread";
  syscall_count: number;
  error_count: number;
}

export interface ProcessEdge {
  source: number;
  target: number;
  type: "fork" | "pipe" | "signal" | "futex" | "clone";
  count: number;
  latency_ms: number;
}

export interface ProcessMetadata {
  total_processes: number;
  total_threads: number;
  total_ipc: number;
}

export interface SyscallEvent {
  timestamp: string;
  syscall: string;
  pid: number;
  tid: number;
  ret: number;
  duration_ns: number;
  error_code?: number;
  error_name?: string;
  args?: string;
  semantic_label?: string;
  severity?: string;
  os_concept?: string;
  source_line?: number;
  source_file?: string;
}

export interface FlameGraphData {
  svg: string;
  hot_functions: HotFunction[];
  user_pct: number;
  kernel_pct: number;
  total_samples: number;
  sample_rate: number;
  profile_start: string;
  profile_end: string;
}

export interface HotFunction {
  name: string;
  percentage: number;
  samples: number;
  source_file?: string;
  source_line?: number;
  module?: string;
}

export interface MemorySnapshot {
  timestamp: string;
  text_start: number;
  text_size: number;
  data_start: number;
  data_size: number;
  bss_start: number;
  bss_size: number;
  heap_start: number;
  heap_size: number;
  stack_start: number;
  stack_size: number;
  mmap_total: number;
  mmap_count: number;
}

export interface LockEvent {
  timestamp: string;
  lock_addr: number;
  lock_type: string;
  op: "lock" | "unlock" | "trylock";
  tid: number;
  holder_tid?: number;
  wait_duration_ns?: number;
  source_file?: string;
  source_line?: number;
}

export interface ResourceMetric {
  timestamp: string;
  cpu_percent: number;
  mem_rss: number;
  mem_virtual: number;
  io_read_bytes: number;
  io_write_bytes: number;
  fd_count: number;
  thread_count: number;
  page_fault_min: number;
  page_fault_maj: number;
  context_switches: number;
  cfs_throttled_us: number;
  oom_score: number;
}

export interface PerfEvent {
  timestamp: string;
  event_type: string;
  pid: number;
  tid: number;
  symbol?: string;
  count: number;
  source_file?: string;
  source_line?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Tier 3 — Function-level Debug
// ═══════════════════════════════════════════════════════════════════

export interface CallChain {
  root_call: string;
  chain: CallStep[];
  total_latency_ns: number;
}

export interface CallStep {
  function: string;
  source_file: string;
  source_line: number;
  latency_ns: number;
  is_kernel_space: boolean;
}

export interface SourceAnnotation {
  source_file: string;
  line: number;
  annotation: string;
  severity: string;
  link_to_panel?: string;
}

export interface SchedEvent {
  timestamp: string;
  prev_pid: number;
  prev_tid: number;
  next_pid: number;
  next_tid: number;
  prev_state: string;
  cpu: number;
  is_migration: boolean;
}

export interface RaceReport {
  address: number;
  thread1: number;
  thread2: number;
  epoch1: number;
  epoch2: number;
  timestamp: string;
  source_line1: number;
  source_file1: string;
  source_line2: number;
  source_file2: string;
  description: string;
  has_happens_before: boolean;
  teaching_hint?: string;
}

export interface DeadlockEvolution {
  steps: DeadlockStep[];
  coffman_conditions: Record<string, boolean>;
  cycle_info: string;
}

export interface DeadlockStep {
  order: number;
  timestamp: string;
  tid: number;
  action: "lock" | "unlock" | "wait";
  lock_addr: number;
  description: string;
}

export interface LeakReport {
  severity: "definitely" | "indirectly" | "possibly" | "reachable";
  address: number;
  size: number;
  alloc_time: string;
  call_stack: StackFrame[];
  source_file: string;
  source_line: number;
  description: string;
  fix_suggestion?: string;
  growth_rate?: number;
}

export interface StackFrame {
  function: string;
  source_file: string;
  source_line: number;
  module?: string;
}

export interface SpanTreeNode {
  span_id: string;
  parent_span_id?: string;
  operation_name: string;
  duration_ms: number;
  syscall_count: number;
  error_count: number;
  self_time_ms: number;
  tags?: Record<string, string>;
  children?: SpanTreeNode[];
}

// ═══════════════════════════════════════════════════════════════════
// Event Annotations & Filter Bar
// ═══════════════════════════════════════════════════════════════════

export interface EventAnnotation {
  timestamp: string;
  type: "compile" | "deploy" | "start" | "test_pass" | "test_fail" | "anomaly" | "oom";
  label: string;
  submission_id: string;
  severity?: string;
  source?: string;
  related_tid?: number;
}

export interface FilterFacet {
  field: "syscall" | "severity" | "process" | "thread" | "fd" | "source";
  values: string[];
  active?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Composite Risk Indicators
// ═══════════════════════════════════════════════════════════════════

export interface RiskIndicators {
  health_score: number;
  saturation_index: number;
  dependency_risk: number;
  backlog_growth: number;
  oom_risk_rate: number;
  cpu_saturation_pct: number;
  mem_saturation_pct: number;
  fd_saturation_pct: number;
}

// ═══════════════════════════════════════════════════════════════════
// AI
// ═══════════════════════════════════════════════════════════════════

export interface AIAnnotation {
  target_field: string;
  content: string;
  confidence: number;
  created_at: string;
}

export interface ConceptTag {
  name: string;
  concept_id: string;
  relevance: number;
  linked_field: string;
}

// ── Evidence Links (Diagnosis → Visualization) ──

export interface EvidenceLink {
  id: string;
  label: string;         // "futex 死锁 @ T+350ms"
  panel: "trace" | "flamegraph" | "memory3d" | "ebpf";
  timestamp_ms: number;  // ms offset from timeline start
  highlight_key: string; // function name, segment, TID, syscall
  description: string;   // tooltip
  severity: "critical" | "warning" | "info";
  source_file?: string;
  source_line?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Three-tier view state
// ═══════════════════════════════════════════════════════════════════

export type TierLevel = 1 | 2 | 3;

export interface TierState {
  currentTier: TierLevel;
  selectedPanel: string | null;
  replayTimestamp: number;    // ms offset → synchronizes all panels
  activeFilters: ActiveFilter[];
}

export interface ActiveFilter {
  field: string;
  value: string;
}
