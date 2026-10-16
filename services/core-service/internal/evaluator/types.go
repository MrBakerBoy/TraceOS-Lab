package evaluator

import "time"

// CompileResult holds the result of compiling source code.
type CompileResult struct {
	Success    bool        `json:"success"`
	BinaryPath string      `json:"binary_path,omitempty"`
	ErrorLines []ErrorLine `json:"error_lines,omitempty"`
	Stderr     string      `json:"stderr,omitempty"`
}

// ErrorLine represents a single compiler error.
type ErrorLine struct {
	Type    string `json:"type"`
	File    string `json:"file"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Message string `json:"message"`
}

// TestResult holds the result of running a single test case.
type TestResult struct {
	TestCaseID     string        `json:"test_case_id"`
	Name           string        `json:"name"`
	Passed         bool          `json:"passed"`
	ScoreWeight    int           `json:"score_weight"`
	ActualOutput   string        `json:"actual_output"`
	ExpectedOutput string        `json:"expected_output"`
	ExitCode       int           `json:"exit_code"`
	ExecTime       time.Duration `json:"exec_time"`
	RuntimeError   *string       `json:"runtime_error,omitempty"`
	TraceFile      string        `json:"trace_file,omitempty"`
	MemoryUsage    int64         `json:"memory_usage,omitempty"`
	MatchedPatterns  []string `json:"matched_patterns,omitempty"`
	FailedPatterns   []string `json:"failed_patterns,omitempty"`
	SyscallViolations []string `json:"syscall_violations,omitempty"`
}

// ScoreResult holds the final score.
type ScoreResult struct {
	TotalScore     int         `json:"total_score"`
	OutputScore    int         `json:"output_score"`
	StructureScore int         `json:"structure_score"`
	BehaviorScore  int         `json:"behavior_score"`
	PassedCases    int         `json:"passed_cases"`
	TotalCases     int         `json:"total_cases"`
	TotalExecTimeMs int        `json:"total_exec_time_ms"`
	Deductions     []Deduction `json:"deductions"`
	Passed         bool        `json:"passed"`
}

// Deduction represents a score deduction.
type Deduction struct {
	Type   string `json:"type"`
	Points int    `json:"points"`
	Reason string `json:"reason"`
}

// StrPtr returns a pointer to the given string.
func StrPtr(s string) *string {
	return &s
}
