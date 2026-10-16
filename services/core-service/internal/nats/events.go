package nats

import (
	"encoding/json"

	"github.com/traceos-lab/core-service/internal/model"
)

// SubmissionCreatedEvent is published when a new code submission is created.
type SubmissionCreatedEvent struct {
	SubmissionID string `json:"submission_id"`
	ExperimentID string `json:"experiment_id"`
	StudentID    string `json:"student_id"`
	Code         string `json:"code"`
	Language     string `json:"language"`
}

// EvaluationCompletedEvent is published when evaluation finishes.
type EvaluationCompletedEvent struct {
	SubmissionID  string  `json:"submission_id"`
	ExperimentID  string  `json:"experiment_id"`
	StudentID     string  `json:"student_id"`
	Score         int     `json:"score"`
	TotalScore    int     `json:"total_score"`
	PassedCases   int     `json:"passed_cases"`
	TotalCases    int     `json:"total_cases"`
	Status        string  `json:"status"`
	CompileError  *string `json:"compile_error,omitempty"`
	RuntimeError  *string `json:"runtime_error,omitempty"`
	ExecutionTime *int    `json:"execution_time,omitempty"`

	// New scoring fields (v2)
	IsQualified   bool                `json:"is_qualified"`
	CoreScore     int                 `json:"core_score"`
	EdgeScore     int                 `json:"edge_score"`
	TestPoints    []TestPointData     `json:"test_points,omitempty"`

	// Strace analysis results — included for AI diagnosis
	StraceSummary *StraceSummaryData `json:"strace_summary,omitempty"`
	TestResults   []TestResultData   `json:"test_results,omitempty"`

	// Score breakdown — for AI-assisted scoring
	OutputScore    int              `json:"output_score"`
	StructureScore int              `json:"structure_score"`
	BehaviorScore  int              `json:"behavior_score"`

	// ObsContext carries the unified three-tier observation context for AI/frontend consumption.
	ObsContextJSON json.RawMessage `json:"obs_context,omitempty"`
	Deductions     []DeductionData  `json:"deductions,omitempty"`

	// EBPFMetrics is an AI-friendly deterministic summary of kernel-level
	// observation facts (fd leak, memory imbalance, zombie, deadlock, syscall
	// stats, process/thread structure). Extracted from strace analysis +
	// obs_context, never produced by AI and never used for scoring.
	EBPFMetrics *EBPFMetricsData `json:"ebpf_metrics,omitempty"`
}

// TestPointData mirrors the shared test point result for NATS serialization.
type TestPointData = model.TestPointData

// DeductionData mirrors evaluator.Deduction for NATS serialization.
type DeductionData struct {
	Type   string `json:"type"`
	Points int    `json:"points"`
	Reason string `json:"reason"`
}

// StraceSummaryData carries the pattern analysis results in the NATS event.
type StraceSummaryData struct {
	TotalSyscalls  int              `json:"total_syscalls"`
	ErrorSyscalls  int              `json:"error_syscalls"`
	UniqueSyscalls int              `json:"unique_syscalls"`
	TopSyscalls    []SyscallCountData `json:"top_syscalls"`
	TopErrors      []SyscallErrorData `json:"top_errors"`
	Patterns       []PatternData    `json:"patterns"`
	HumanReadable  string           `json:"human_readable"`
	FDOpenClose    *BalanceData     `json:"fd_balance,omitempty"`
	MemoryOps      *BalanceData     `json:"memory_balance,omitempty"`
	ProcessOps     *BalanceData     `json:"process_balance,omitempty"`
}

type SyscallCountData struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type SyscallErrorData struct {
	Name      string `json:"name"`
	ErrorName string `json:"error_name"`
	Count     int    `json:"count"`
}

type PatternData struct {
	Pattern     string `json:"pattern"`
	Severity    string `json:"severity"`
	Description string `json:"description"`
	Evidence    string `json:"evidence"`
	Count       int    `json:"count"`
}

type BalanceData struct {
	Opens        int    `json:"opens,omitempty"`
	Closes       int    `json:"closes,omitempty"`
	Leaked       int    `json:"leaked,omitempty"`
	HasLeak      bool   `json:"has_leak,omitempty"`
	Detail       string `json:"detail"`
	AllocCalls   int    `json:"alloc_calls,omitempty"`
	FreeCalls    int    `json:"free_calls,omitempty"`
	HasImbalance bool   `json:"has_imbalance,omitempty"`
	ForkCalls    int    `json:"fork_calls,omitempty"`
	WaitCalls    int    `json:"wait_calls,omitempty"`
	HasZombies   bool   `json:"has_zombies,omitempty"`
}

type TestResultData struct {
	Name           string `json:"name"`
	Passed         bool   `json:"passed"`
	ScoreWeight    int    `json:"score_weight"`
	ActualOutput   string `json:"actual_output,omitempty"`
	ExpectedOutput string `json:"expected_output,omitempty"`
	RuntimeError   string `json:"runtime_error,omitempty"`
}

// DiagnosisCompletedEvent is published when AI diagnosis finishes.
type DiagnosisCompletedEvent struct {
	SubmissionID string `json:"submission_id"`
	DiagnosisID  string `json:"diagnosis_id"`
	ErrorType    string `json:"error_type"`
}

// ─────────────────────────────────────────────────────────────────────────────
// ebpf_metrics — AI-friendly deterministic observation facts (Phase 2)
// ─────────────────────────────────────────────────────────────────────────────

// EBPFMetricsData is the AI-friendly summary carried in the
// evaluation.completed event. All fields are deterministically derived from
// strace analysis + obs_context; AI only reads them, never scores them.
type EBPFMetricsData struct {
	Resource      ResourceMetricsData `json:"resource"`
	Syscall       SyscallMetricsData  `json:"syscall"`
	ProcessThread ProcessThreadData   `json:"process_thread"`
}

// ResourceMetricsData holds the kernel-level resource facts that matter for
// teaching (not scoring). Zero means "clean / balanced / no issue".
type ResourceMetricsData struct {
	FdLeak          int  `json:"fd_leak"`          // open - close, positive = leaked fds
	MemoryImbalance int  `json:"memory_imbalance"` // alloc - free, positive = unpaired
	Deadlock        bool `json:"deadlock"`         // wait-for cycle detected (no source yet)
	Zombie          int  `json:"zombie"`           // fork - wait, positive = unreaped children
}

// SyscallMetricsData carries a compact syscall statistics summary.
type SyscallMetricsData struct {
	Stats  map[string]int      `json:"stats"`
	Errors []SyscallErrorData  `json:"errors,omitempty"`
}

// ProcessThreadData carries the process/thread structure summary.
type ProcessThreadData struct {
	Graph       json.RawMessage `json:"graph,omitempty"`
	ThreadCount int             `json:"thread_count"`
}

