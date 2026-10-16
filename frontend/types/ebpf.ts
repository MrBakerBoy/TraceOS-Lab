/**
 * TraceOS Lab — Unified eBPF types
 *
 * Shared by EBPFTracePanel, all Tab components, hooks, and stores.
 * Covers: SSE events, API responses, detection results, chart data, tab definitions.
 */

// ═══════════════════════════════════════════════════════════════════
// SSE Event Types (from backend ebpf_handler.go)
// ═══════════════════════════════════════════════════════════════════

export interface SSESyscallEvent {
  type: "syscall";
  payload: { syscall: string; count: number };
}

export interface SSETraceEvent {
  type: "trace_event";
  payload: {
    syscall: string;
    pid: number;
    tid: number;
    ret: number;
    dur_ns: number;
    [key: string]: unknown;
  };
}

export interface SSEGraphEvent {
  type: "graph";
  payload: LockGraphState;
}

export interface SSEDeadlockEvent {
  type: "deadlock";
  payload: {
    detected: boolean;
    cycle: number[];
    details: string[];
    fix: string;
  };
}

export interface SSESafeEvent {
  type: "safe";
  payload: { msg: string };
}

export interface SSEInfoEvent {
  type: "info";
  payload: { pid: number; msg: string };
}

export interface SSEMemEvent {
  type: "mem";
  payload: {
    brk_count?: number;
    brk_growth?: number;
    mmap_count?: number;
    mmap_total?: number;
    munmap_count?: number;
    munmap_total?: number;
    net_bytes?: number;
    leak_warning?: boolean | number;
    [key: string]: unknown;
  };
}

export interface SSESchedEvent {
  type: "sched";
  payload: SchedStats;
}

export interface SSEDoneEvent {
  type: "done";
  payload: null;
}

export interface SSEErrorEvent {
  type: "error";
  payload: { msg: string };
}

export type SSEEvent =
  | SSESyscallEvent
  | SSETraceEvent
  | SSEGraphEvent
  | SSEDeadlockEvent
  | SSESafeEvent
  | SSEInfoEvent
  | SSEMemEvent
  | SSESchedEvent
  | SSEDoneEvent
  | SSEErrorEvent;

// ═══════════════════════════════════════════════════════════════════
// Graph / Lock types
// ═══════════════════════════════════════════════════════════════════

export interface ThreadNode {
  tid: number;
}

export interface LockNode {
  uaddr: string;
  holder: number;
  waiters: number[];
}

export interface LockGraphState {
  threads: ThreadNode[];
  locks: LockNode[];
}

// ═══════════════════════════════════════════════════════════════════
// Sched types
// ═══════════════════════════════════════════════════════════════════

export interface SchedStats {
  switches?: Record<string, number>;
  wakeups?: Record<string, number>;
  migrations?: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════════
// Trace types (from DB / API)
// ═══════════════════════════════════════════════════════════════════

export interface SyscallTrace {
  time: string;
  pid: number;
  tid?: number;
  syscall_name: string;
  return_value: number;
  duration_ns: number;
  error_code?: number;
  error_name?: string;
  args?: Record<string, unknown>;
  source_line?: number;
}

export interface TraceSummary {
  total_count: number;
  error_count: number;
  unique_syscalls: number;
  execution_time_ns: number;
  syscall_counts: Record<string, number>;
}

export interface TraceData {
  summary: TraceSummary;
  traces: SyscallTrace[] | null;
}

// ═══════════════════════════════════════════════════════════════════
// Syscall classification
// ═══════════════════════════════════════════════════════════════════

export type SyscallCategory = "io" | "mem" | "sync" | "proc" | "other";

export interface SyscallClass {
  cat: SyscallCategory;
  label: string;
  color: string; // resolved at render time
}

/** Regex-based classification (from WaterfallTimeline pattern). */
const CAT_PATTERNS: [SyscallCategory, RegExp][] = [
  ["io",   /^(read|write|open|close|stat|fstat|lstat|lseek|pread|pwrite|readv|writev|fcntl|ioctl|poll|select|epoll|sendfile|copy_file_range|fsync|fdatasync|truncate|ftruncate|fallocate|getdents|readdir|link|unlink|symlink|readlink|rename|chmod|chown|access|dup|dup2|pipe)_?/],
  ["mem",  /^(mmap|munmap|mprotect|brk|sbrk|madvise|mincore|mlock|mlockall|munlock|munlockall|msync|remap_file_pages|mremap|shmget|shmat|shmdt)_?/],
  ["sync", /^(futex|semget|semop|semctl|semtimedop|nanosleep|clock_nanosleep|sched_yield|pause|sigwait|sigwaitinfo|sigtimedwait|poll|ppoll|select|pselect6|epoll_wait|epoll_pwait)_?/],
  ["proc", /^(fork|vfork|clone|exec|wait|waitpid|exit|_exit|getpid|getppid|gettid|setpgid|getpgid|setsid|kill|tgkill|tkill|rt_sig|sig|prctl|arch_prctl|set_tid_address|set_robust_list|rseq|execve|exit_group|getrandom|prlimit64)_?/],
];

export function classifySyscall(name: string): SyscallClass {
  for (const [cat, pattern] of CAT_PATTERNS) {
    if (pattern.test(name)) {
      return { cat, label: CAT_LABELS[cat], color: "" };
    }
  }
  return { cat: "other", label: "其他", color: "" };
}

const CAT_LABELS: Record<SyscallCategory, string> = {
  io:    "I/O 读写",
  mem:   "内存管理",
  sync:  "同步互斥",
  proc:  "进程/线程",
  other: "其他",
};

/**
 * Resolve classification colors against KT theme tokens.
 * Call this at render time (inside useEffect / useMemo) with current theme.
 */
export function classifyWithColors(
  name: string,
  catCols: string[], // [cyan, amber, green, purple]
): SyscallClass {
  const cls = classifySyscall(name);
  switch (cls.cat) {
    case "io":   return { ...cls, color: catCols[0] };
    case "mem":  return { ...cls, color: catCols[1] };
    case "sync": return { ...cls, color: catCols[2] };
    case "proc": return { ...cls, color: catCols[3] };
    default:     return { ...cls, color: "var(--kt-text-tertiary)" };
  }
}

// ═══════════════════════════════════════════════════════════════════
// AI analysis types
// ═══════════════════════════════════════════════════════════════════

export interface EbpfAIAnalysis {
  plain_summary: string;
  syscall_explanations: Array<{
    name: string;
    plain_meaning: string;
    why_program_uses_it: string;
  }>;
  error_explanations: Array<{
    syscall: string;
    error: string;
    plain_reason: string;
    fix_hint: string;
  }>;
  patterns: Array<{ type: string; explanation: string }>;
  raw_error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Health status (shared across all tabs)
// ═══════════════════════════════════════════════════════════════════

export type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

export interface HealthDimension {
  label: string;
  score: number;       // 0-20 per dimension
  maxScore: number;
  status: HealthStatus;
  tabId: EbpfTabId;   // click to navigate
}

export interface HealthScore {
  total: number;           // 0-100
  status: HealthStatus;
  dimensions: HealthDimension[];
  summary: string;         // one-line summary text
  generatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// Sandbox Metrics (GET /submissions/:id/sandbox-metrics)
// ═══════════════════════════════════════════════════════════════════

export interface MetricAlert {
  type: string;           // "cpu_throttle" | "mem_pressure" | "oom_kill" | "fd_limit"
  severity: "info" | "warning" | "critical";
  message: string;
  currentValue: number;
  limitValue?: number;
}

export interface SandboxMetrics {
  submission_id: string;
  experiment_id: string;
  cpu_percent: number;
  mem_percent: number;
  mem_rss_mb: number;
  mem_limit_mb: number;
  mem_oom_risk: number;
  mem_oom_events: number;
  io_read_bytes: number;
  io_write_bytes: number;
  fd_count: number;
  fd_soft_limit: number;
  thread_count: number;
  thread_running: number;
  thread_sleeping: number;
  page_faults_minor: number;
  page_faults_major: number;
  context_switches: number;
  cfs_throttled_ms: number;
  io_wait_percent: number;
  mem_working_set_bytes: number;
  mem_limit_bytes: number;
  duration_sec: number;
  trace_count: number;
  trend: string;           // "stable" | "degrading" | "improving"
  alerts: MetricAlert[];
}

// ═══════════════════════════════════════════════════════════════════
// Leak Detection (GET /submissions/:id/leak-report)
// ═══════════════════════════════════════════════════════════════════

export type LeakSeverity = "definitely" | "indirectly" | "possibly" | "reachable";

export interface LeakResult {
  severity: LeakSeverity;
  address: number;
  size: number;
  alloc_time: string;
  source_file: string;
  source_line: number;
  description: string;
  fix_suggestion: string;
  growth_rate: number;
  call_stack?: StackFrame[];
}

export interface StackFrame {
  function: string;
  file: string;
  line: number;
}

export interface HeaptrackSummary {
  total_allocated: number;
  total_freed: number;
  still_allocated: number;
  peak_heap: number;
  peak_time: string;
  alloc_count: number;
  free_count: number;
  alloc_rate_mbps: number;
  free_rate_mbps: number;
  net_growth_mbps: number;
  leak_probability: number;
}

export interface HeapSnapshot {
  timestamp: string;
  heap_size: number;
  peak_heap: number;
  alloc_count: number;
  free_count: number;
}

export interface LeakSummary {
  definitely_lost: number;
  indirectly_lost: number;
  possibly_lost: number;
  still_reachable: number;
  total_leaks: number;
  has_critical: boolean;
}

export interface LeakReport {
  submission_id: string;
  experiment_id: string;
  trace_count: number;
  mem_event_count: number;
  leaks: LeakResult[];
  heaptrack_summary: HeaptrackSummary;
  heap_history: HeapSnapshot[];
  leak_summary: LeakSummary;
}

// ═══════════════════════════════════════════════════════════════════
// Alloc Flamegraph (GET /submissions/:id/alloc-flamegraph)
// ═══════════════════════════════════════════════════════════════════

export interface TopAllocator {
  function: string;
  source_file: string;
  source_line: number;
  total_bytes: number;
  alloc_count: number;
  percent: number;
}

export interface AllocFlamegraphData {
  submission_id: string;
  experiment_id: string;
  top_allocators: TopAllocator[];
  summary: HeaptrackSummary | null;
  trace_count: number;
  mem_event_count: number;
  generated_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// Memory Trend (GET /submissions/:id/memory-trend)
// ═══════════════════════════════════════════════════════════════════

export interface HeapTimelinePoint {
  timestamp: string;
  heap_size: number;
  peak_heap: number;
  alloc_count: number;
  free_count: number;
  alloc_rate_mbps: number;
  free_rate_mbps: number;
}

export interface MemoryTrendSummary {
  trend_direction: string;    // "increasing" | "decreasing" | "stable"
  growth_rate_mbps: number;
  peak_heap_bytes: number;
  peak_time: string;
  still_allocated: number;
}

export interface MemoryTrend {
  submission_id: string;
  experiment_id: string;
  heap_timeline: HeapTimelinePoint[];
  summary: MemoryTrendSummary;
  trace_count: number;
  mem_event_count: number;
  generated_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// Race Detection (GET /submissions/:id/race-report)
// ═══════════════════════════════════════════════════════════════════

export interface RaceResult {
  address: number;
  thread1: number;
  thread2: number;
  epoch1: number;
  epoch2: number;
  timestamp: string;
  source_file1: string;
  source_line1: number;
  source_file2: string;
  source_line2: number;
  description: string;
  has_hb: boolean;          // Happens-Before relationship exists?
  teaching_hint: string;
}

export interface RaceSummary {
  total_accesses: number;
  total_races: number;
  unique_addresses: number;
  threads_involved: number[];
  races_per_thread: Record<string, number>;
  unprotected_addrs: number[];
  confidence_score: number;
}

export interface RaceReport {
  submission_id: string;
  experiment_id: string;
  trace_count: number;
  access_events: number;
  races: RaceResult[];
  race_summary: RaceSummary;
  has_races: boolean;
  thread_count: number;
  address_count: number;
}

// ═══════════════════════════════════════════════════════════════════
// Deadlock Evolution (GET /submissions/:id/deadlock-evolution)
// ═══════════════════════════════════════════════════════════════════

export interface CoffmanConditions {
  mutual_exclusion: boolean;
  hold_and_wait: boolean;
  no_preemption: boolean;
  circular_wait: boolean;
}

export interface DeadlockStep {
  order: number;
  timestamp: string;
  tid: number;
  action: string;           // "lock" | "unlock" | "wait"
  lock_addr: number;
  holder_tid: number;
  description: string;
}

export interface DeadlockAnalysisData {
  detected: boolean;
  steps: DeadlockStep[];
  coffman_conditions: CoffmanConditions;
  cycle_info: string;
  cycle_nodes: number[];     // TIDs in the cycle
  fix_suggestion: string;
  teaching_narrative: string;
}

export interface DeadlockEvolution {
  submission_id: string;
  experiment_id: string;
  trace_count: number;
  lock_step_count: number;
  detected: boolean;
  steps: DeadlockStep[];
  coffman_conditions: CoffmanConditions;
  cycle_info: string;
  cycle_nodes: number[];
  teaching_narrative: string;
  analysis: DeadlockAnalysisData;
}

// ═══════════════════════════════════════════════════════════════════
// Aggregated eBPF state (all data for a submission)
// ═══════════════════════════════════════════════════════════════════

export interface EbpfSubmissionData {
  submissionId: string;
  experimentId: string;

  // Loading states
  sandboxMetricsLoading: boolean;
  leakReportLoading: boolean;
  allocFlamegraphLoading: boolean;
  memoryTrendLoading: boolean;
  raceReportLoading: boolean;
  deadlockEvolutionLoading: boolean;
  tracesLoading: boolean;

  // Errors
  sandboxMetricsError: string | null;
  leakReportError: string | null;
  allocFlamegraphError: string | null;
  memoryTrendError: string | null;
  raceReportError: string | null;
  deadlockEvolutionError: string | null;
  tracesError: string | null;

  // Data
  sandboxMetrics: SandboxMetrics | null;
  leakReport: LeakReport | null;
  allocFlamegraph: AllocFlamegraphData | null;
  memoryTrend: MemoryTrend | null;
  raceReport: RaceReport | null;
  deadlockEvolution: DeadlockEvolution | null;
  traces: TraceData | null;

  // Derived
  healthScore: HealthScore | null;
}

// ═══════════════════════════════════════════════════════════════════
// Tab definition (redesigned)
// ═══════════════════════════════════════════════════════════════════

export type EbpfTabId = "health" | "resources" | "memory" | "concurrency" | "syscalls";

export interface EbpfTab {
  id: EbpfTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;       // one-line tab purpose
}

// ═══════════════════════════════════════════════════════════════════
// View state (cross-tab coordination)
// ═══════════════════════════════════════════════════════════════════

export interface EbpfViewState {
  activeTab: EbpfTabId;
  realtimeMode: boolean;
  filterCategory: SyscallCategory | "all";
  selectedTrace: SyscallTrace | null;
  comparisonSubmissionId: string | null;
}

// ═══════════════════════════════════════════════════════════════════
// AI Ask Context
// ═══════════════════════════════════════════════════════════════════

export interface AIAskContext {
  sourceTab: EbpfTabId;
  sourceSection: string;        // e.g. "leak-details", "race-result-1"
  contextSummary: string;       // what the AI needs to know
  presetQuestion: string;       // suggested question
}