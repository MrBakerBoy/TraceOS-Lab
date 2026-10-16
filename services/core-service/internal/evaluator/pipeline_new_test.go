package evaluator

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/traceos-lab/core-service/internal/model"
)

// ── Helper: full pipeline (parse → evaluate → score) ──

func runFullPipeline(testCases []model.TestCase, output string, exitCode int,
	syscallMap map[string]int, metrics *BehaviorMetrics) *NewScoreResult {

	var points []TestPointResult
	for _, tc := range testCases {
		doc, err := ParseAssertions(tc.ExpectedOutput)
		if err != nil {
			// Fallback: treat as failed
			points = append(points, TestPointResult{
				Name: tc.Name, Type: tc.Type, Weight: tc.ScoreWeight,
				Passed: false, FailReason: fmt.Sprintf("parse error: %v", err),
			})
			continue
		}
		evalResult := EvaluateAssertions(doc, output, exitCode, syscallMap, metrics)
		points = append(points, TestPointResult{
			Name:       tc.Name,
			Type: tc.Type,
			Weight:     tc.ScoreWeight,
			Passed:     evalResult.Passed,
			FailReason: evalResult.Reason,
		})
	}
	return NewScore(points)
}

// ── Integration: Full runFullPipeline ──

func TestRunFullPipeline_AllCorePass_Qualified(t *testing.T) {
	// Simulate 5 test cases, all core, all pass
	testCases := []model.TestCase{
		{Name: "TC1", Type: "normal", ScoreWeight: 20,
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"contains","value":"hello"}]}`},
		{Name: "TC2", Type: "normal", ScoreWeight: 20,
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"contains","value":"world"}]}`},
		{Name: "TC3", Type: "normal", ScoreWeight: 20,
			ExpectedOutput: `{"exit_code":0,"syscall_assertions":{"required":["write"]}}`},
		{Name: "TC4", Type: "edge_case", ScoreWeight: 20,
			ExpectedOutput: `{"exit_code":0,"behavior_assertions":{"max_runtime_ms":5000}}`},
		{Name: "TC5", Type: "edge_case", ScoreWeight: 20,
			ExpectedOutput: `{"exit_code":[0,1]}`},
	}

	result := runFullPipeline(testCases, "hello world from test", 0, map[string]int{"write": 5, "read": 2}, &BehaviorMetrics{RuntimeMs: 100})

	if result.TotalScore != 100 {
		t.Errorf("expected 100, got %d", result.TotalScore)
	}
	if !result.IsQualified {
		t.Error("expected is_qualified=true when all tests pass")
	}
	if len(result.Points) != 5 {
		t.Errorf("expected 5 test results, got %d", len(result.Points))
	}
}

func TestRunFullPipeline_CoreFail_NotQualified(t *testing.T) {
	// Core test fails: exit_code mismatch
	testCases := []model.TestCase{
		{Name: "Core1", Type: "normal", ScoreWeight: 50,
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"contains","value":"missing"}]}`},
		{Name: "Core2", Type: "normal", ScoreWeight: 50,
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"contains","value":"hello"}]}`},
	}

	result := runFullPipeline(testCases, "hello world", 0, nil, nil)

	if result.IsQualified {
		t.Error("should not be qualified when core test fails")
	}
	if result.TotalScore >= 60 {
		t.Errorf("score should be <60 when core fails, got %d", result.TotalScore)
	}
}

func TestRunFullPipeline_OnlyEdgeFail_StillQualified(t *testing.T) {
	// All core pass, edge fails — still qualified
	testCases := []model.TestCase{
		{Name: "Core1", Type: "normal", ScoreWeight: 40,
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"contains","value":"hello"}]}`},
		{Name: "Core2", Type: "normal", ScoreWeight: 30,
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"contains","value":"world"}]}`},
		{Name: "Edge1", Type: "edge_case", ScoreWeight: 30,
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"contains","value":"impossible"}]}`},
	}

	result := runFullPipeline(testCases, "hello world", 0, nil, nil)

	if !result.IsQualified {
		t.Error("should be qualified when all core pass (even if edge fails)")
	}
	if result.TotalScore != 70 {
		t.Errorf("expected total=70 (40+30), got %d", result.TotalScore)
	}
}

func TestRunFullPipeline_ExitCodeNonZero_InSet(t *testing.T) {
	// exit_code [0,1] — exit_code=1 should pass
	testCases := []model.TestCase{
		{Name: "TC1", Type: "normal", ScoreWeight: 50,
			ExpectedOutput: `{"exit_code":[0,1]}`},
		{Name: "TC2", Type: "normal", ScoreWeight: 50,
			ExpectedOutput: `{"exit_code":[0,1],"output_assertions":[{"mode":"contains","value":"error"}]}`},
	}

	result := runFullPipeline(testCases, "error occurred", 1, nil, nil)

	if !result.IsQualified {
		t.Error("should be qualified when exit_code=1 is in allowed set")
	}
	if result.TotalScore != 100 {
		t.Errorf("expected 100, got %d", result.TotalScore)
	}
}

func TestRunFullPipeline_EmptyOutput_ExactMatch(t *testing.T) {
	// exact_match on empty output
	testCases := []model.TestCase{
		{Name: "TC1", Type: "normal", ScoreWeight: 100,
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"exact_match","value":""}]}`},
	}

	result := runFullPipeline(testCases, "", 0, nil, nil)

	if !result.IsQualified {
		t.Error("exact_match on empty should pass")
	}
}

// ── Weight Calculation Edge Cases ──

func TestRunFullPipeline_ZeroTotalWeight(t *testing.T) {
	// No test cases given
	result := runFullPipeline([]model.TestCase{}, "", 0, nil, nil)

	if result.TotalScore != 0 {
		t.Errorf("empty test cases should give score 0, got %d", result.TotalScore)
	}
	// No core = auto-qualified? Let's check the logic
	// If there are no core tests, is_qualified defaults to true
}

func TestRunFullPipeline_WeightedAverage(t *testing.T) {
	testCases := []model.TestCase{
		{Name: "Big", Type: "normal", ScoreWeight: 70,
			ExpectedOutput: `{"exit_code":0}`},
		{Name: "Small", Type: "normal", ScoreWeight: 30,
			ExpectedOutput: `{"exit_code":0}`},
	}

	result := runFullPipeline(testCases, "", 0, nil, nil)

	if result.TotalScore != 100 {
		t.Errorf("expected 100, got %d", result.TotalScore)
	}
}

// ── Type Normalization ──

func TestNormalizeType(t *testing.T) {
	tests := []struct{ input, expected string }{
		{"normal", "core"},
		{"edge_case", "edge"},
		{"core", "core"},
		{"edge", "edge"},
		{"performance", "edge"},
		{"security", "edge"},
		{"unknown", "edge"},
	}

	for _, tt := range tests {
		got := normalizeType(tt.input)
		if got != tt.expected {
			t.Errorf("normalizeType(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

// ── Large-scale: 31 Experiment Assertion Validity ──

type experimentAssertion struct {
	ID          string
	Name        string
	TestCount   int
	TotalWeight int
	JSONs       []string // raw expected_output JSON strings
}

// sampleAssertions contains representative assertions from the 31 experiments
// for smoke-testing the parser
func TestAll31ExperimentAssertionsParseable(t *testing.T) {
	samples := []experimentAssertion{
		{ID: "lab1", Name: "fork_basic", TestCount: 5, TotalWeight: 100, JSONs: []string{
			`{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Parent:.*PID=\\d+"}],"syscall_assertions":{"required":["clone"]},"behavior_assertions":{"max_runtime_ms":5000}}`,
			`{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Child:.*PID=\\d+"},{"mode":"contains","value":"PPID="}]}`,
			`{"exit_code":0,"syscall_assertions":{"required":["wait4"]},"behavior_assertions":{"no_zombie":true}}`,
			`{"exit_code":0,"behavior_assertions":{"max_runtime_ms":5000}}`,
			`{"exit_code":[0,1],"syscall_assertions":{"forbidden":["system","execve"]}}`,
		}},
		{ID: "lab2", Name: "fork_tree", TestCount: 5, TotalWeight: 100, JSONs: []string{
			`{"exit_code":0,"behavior_assertions":{"no_zombie":true}}`,
			`{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Level 0: PID=\\d+, PPID=\\d+"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Level 1:"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Level 2:"}]}`,
			`{"exit_code":[0,1],"syscall_assertions":{"forbidden":["system"]}}`,
		}},
		{ID: "lab8", Name: "producer_consumer", TestCount: 5, TotalWeight: 100, JSONs: []string{
			`{"exit_code":0,"syscall_assertions":{"required":["clone"],"min_count":{"clone":4}},"behavior_assertions":{"max_runtime_ms":10000}}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"All items processed"}],"numeric_assertions":{"mode":"count_distinct","pattern":"Consumed: (\\d+)","min":20,"max":20}}`,
			`{"exit_code":0,"behavior_assertions":{"no_deadlock":true}}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Consumed: 1"},{"mode":"contains","value":"Consumed: 20"}]}`,
			`{"exit_code":0,"syscall_assertions":{"required":["futex"],"min_count":{"futex":4}}}`,
		}},
		{ID: "lab14", Name: "malloc_impl", TestCount: 5, TotalWeight: 100, JSONs: []string{
			`{"exit_code":0,"numeric_assertions":{"mode":"count_distinct","pattern":"Allocated","min":5,"max":5}}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Realloc test passed"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"regex","value":"(F|f)ree"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"not_contains","value":"Segfault"}],"behavior_assertions":{"max_runtime_ms":10000}}`,
			`{"exit_code":[0,1],"syscall_assertions":{"required":["brk"]}}`,
		}},
		{ID: "lab24", Name: "sched_sim", TestCount: 5, TotalWeight: 100, JSONs: []string{
			`{"exit_code":0,"output_assertions":[{"mode":"regex","value":"FCFS:.*avg.*wait"},{"mode":"contains","value":"avg turnaround"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"SJF:"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"RR:"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Priority:"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Scheduler simulation complete"}]}`,
		}},
		{ID: "lab29", Name: "banker", TestCount: 6, TotalWeight: 100, JSONs: []string{
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Bankers algorithm test complete"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Request granted"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Request denied"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Safe sequence"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"exceeds maximum"}]}`,
			`{"exit_code":0,"output_assertions":[{"mode":"contains","value":"not enough"}]}`,
		}},
	}

	for _, exp := range samples {
		for i, raw := range exp.JSONs {
			doc, err := ParseAssertions(raw)
			if err != nil {
				t.Errorf("%s TC%d: parse error: %v", exp.Name, i+1, err)
				continue
			}
			if doc.ExitCode == nil || len(doc.ExitCode) == 0 {
				t.Errorf("%s TC%d: exit_code missing", exp.Name, i+1)
			}
		}
	}
}

// ── Pipeline with Realistic Data ──

func TestRunFullPipeline_Lab1FullSimulation(t *testing.T) {
	// Simulate lab1_fork_basic submission — correct fork implementation.
	// fork() produces a clone syscall, wait() produces wait4; neither "system"
	// nor "execve" is present, so the "错误处理" forbidden check passes too.
	// Result: all 5 test points pass (100 points).
	testCases := []model.TestCase{
		{Name: "fork创建成功", Type: "normal", ScoreWeight: 25,
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Parent:.*PID=\\d+"}],"syscall_assertions":{"required":["clone"]},"behavior_assertions":{"max_runtime_ms":5000}}`},
		{Name: "父子输出正确", Type: "normal", ScoreWeight: 25,
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Child:.*PID=\\d+"},{"mode":"contains","value":"PPID="}]}`},
		{Name: "waitpid回收子进程", Type: "normal", ScoreWeight: 20,
			ExpectedOutput: `{"exit_code":0,"syscall_assertions":{"required":["wait4"]},"behavior_assertions":{"no_zombie":true}}`},
		{Name: "fork返回值正确使用", Type: "edge_case", ScoreWeight: 15,
			ExpectedOutput: `{"exit_code":0,"behavior_assertions":{"max_runtime_ms":5000}}`},
		{Name: "错误处理", Type: "edge_case", ScoreWeight: 15,
			ExpectedOutput: `{"exit_code":[0,1],"syscall_assertions":{"forbidden":["system","execve"]}}`},
	}

	output := "Parent: PID=12345, Child PID=12346\nChild: PID=12346, PPID=12345"
	syscallMap := map[string]int{"clone": 1, "wait4": 1, "write": 5, "close": 3}
	metrics := &BehaviorMetrics{RuntimeMs: 100, HasZombies: false}

	result := runFullPipeline(testCases, output, 0, syscallMap, metrics)

	if !result.IsQualified {
		t.Errorf("should be qualified (3 core pass): score=%d", result.TotalScore)
	}
	if result.TotalScore != 100 {
		t.Errorf("expected score=100, got %d", result.TotalScore)
	}
	for _, tr := range result.Points {
		if !tr.Passed {
			t.Errorf("test %q should pass: %s", tr.Name, tr.FailReason)
		}
	}
}

func TestRunFullPipeline_Lab1MissingWaitpid(t *testing.T) {
	// Missing waitpid — should fail TC3
	testCases := []model.TestCase{
		{Name: "fork创建成功", Type: "normal", ScoreWeight: 25,
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Parent:.*PID=\\d+"}],"syscall_assertions":{"required":["clone"]},"behavior_assertions":{"max_runtime_ms":5000}}`},
		{Name: "父子输出正确", Type: "normal", ScoreWeight: 25,
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Child:.*PID=\\d+"},{"mode":"contains","value":"PPID="}]}`},
		{Name: "waitpid回收子进程", Type: "normal", ScoreWeight: 20,
			ExpectedOutput: `{"exit_code":0,"syscall_assertions":{"required":["wait4"]},"behavior_assertions":{"no_zombie":true}}`},
		{Name: "fork返回值正确使用", Type: "edge_case", ScoreWeight: 15,
			ExpectedOutput: `{"exit_code":0,"behavior_assertions":{"max_runtime_ms":5000}}`},
		{Name: "错误处理", Type: "edge_case", ScoreWeight: 15,
			ExpectedOutput: `{"exit_code":[0,1],"syscall_assertions":{"forbidden":["system","execve"]}}`},
	}

	output := "Parent: PID=12345, Child PID=12346\nChild: PID=12346, PPID=12345"
	// wait4 is MISSING — should fail TC3
	syscallMap := map[string]int{"clone": 1, "write": 5, "close": 3}
	metrics := &BehaviorMetrics{RuntimeMs: 100, HasZombies: true}

	result := runFullPipeline(testCases, output, 0, syscallMap, metrics)

	// TC3 is core and fails -> not qualified
	if result.IsQualified {
		t.Error("lab1 without waitpid should not be qualified")
	}
	// Check TC3 specifically failed
	for _, tr := range result.Points {
		if tr.Name == "waitpid回收子进程" && tr.Passed {
			t.Error("TC3 should fail when wait4 is missing")
		}
	}
}

// ── Assertion Edge Cases ──

func TestParseAssertions_InvalidJSON(t *testing.T) {
	// Invalid JSON should fallback to legacy contains mode
	doc, err := ParseAssertions(`{this is not json}`)
	if err != nil {
		t.Fatalf("ParseAssertions should not error on invalid JSON: %v", err)
	}
	if len(doc.OutputAssertions) == 0 || doc.OutputAssertions[0].Mode != "contains" {
		t.Error("invalid JSON should fallback to contains mode")
	}
}

func TestEvalNumeric_SetEquality_Bidirectional(t *testing.T) {
	// Verify bidirectional check: both "unexpected" and "missing" caught
	a := &NumericAssertions{
		Mode:     "set_equality",
		Pattern:  `(\d+)`,
		Expected: []float64{1, 2},
	}
	// Too few values
	ok, _ := evalNumericAssertions(a, "1")
	if ok {
		t.Error("set_equality should fail with too few values")
	}
	// Wrong values
	ok, _ = evalNumericAssertions(a, "1 3")
	if ok {
		t.Error("set_equality should fail when value 2 is replaced by 3")
	}
	// Extra values
	ok, _ = evalNumericAssertions(a, "1 2 3")
	if ok {
		t.Error("set_equality should fail with extra values")
	}
}

func TestNormalizeOutput_MixedPatterns(t *testing.T) {
	input := "PID=1111 at time 12:34:56.789 with TID=2222 PPID=3333 addr=0xabcd"
	got := normalizeOutput(input)
	if !strings.Contains(got, "PID=NNN") {
		t.Errorf("PID not normalized: %q", got)
	}
	if !strings.Contains(got, "TID=NNN") {
		t.Errorf("TID not normalized: %q", got)
	}
	if !strings.Contains(got, "PPID=NNN") {
		t.Errorf("PPID not normalized: %q", got)
	}
	if !strings.Contains(got, "0xNNN") {
		t.Errorf("hex address not normalized: %q", got)
	}
	if !strings.Contains(got, "HH:MM:SS") {
		t.Errorf("timestamp not normalized: %q", got)
	}
}

// ── System Call Alias Resolution ──

func TestSyscallAlias_ForkToClone(t *testing.T) {
	sa := &SyscallAssertions{Required: []string{"clone"}}
	// "fork" is an alias for "clone" — should pass
	ok, _ := evalSyscallAssertions(sa, map[string]int{"fork": 1})
	if !ok {
		t.Error("fork should be recognized as clone alias")
	}
}

func TestSyscallAlias_WaitpidToWait4(t *testing.T) {
	sa := &SyscallAssertions{Required: []string{"wait4"}}
	// "waitpid" is an alias for "wait4" — should pass
	ok, _ := evalSyscallAssertions(sa, map[string]int{"waitpid": 1})
	if !ok {
		t.Error("waitpid should be recognized as wait4 alias")
	}
}

func TestSyscallAlias_SystemIsForbidden(t *testing.T) {
	sa := &SyscallAssertions{Forbidden: []string{"system"}}
	// "system" is not a real syscall and must NOT alias clone/fork/execve;
	// a plain fork() (clone) must not be flagged as "system".
	ok, _ := evalSyscallAssertions(sa, map[string]int{"clone": 1})
	if !ok {
		t.Error("'system' forbidden should NOT catch clone (system is not a syscall alias)")
	}
	// Only write/read present — forbidden should still not trigger.
	ok, _ = evalSyscallAssertions(sa, map[string]int{"write": 1, "read": 1})
	if !ok {
		t.Error("'system' forbidden should not trigger when only write/read present")
	}
}

// ── Performance: Many Test Cases ──

func TestRunFullPipeline_ManyTestCases(t *testing.T) {
	// Simulate a large experiment with 6 test cases
	var tcs []model.TestCase
	for i := 0; i < 6; i++ {
		tcs = append(tcs, model.TestCase{
			Name:       "TC" + string(rune('A'+i)),
			Type:       "normal",
			ScoreWeight: 16 + i%2, // 16, 17, 16, 17, 16, 17 = 99 (close to 100)
			ExpectedOutput: `{"exit_code":0,"output_assertions":[{"mode":"contains","value":"result"}]}`,
		})
	}

	result := runFullPipeline(tcs, "result", 0, nil, nil)

	if len(result.Points) != 6 {
		t.Errorf("expected 6 results, got %d", len(result.Points))
	}
	if !result.IsQualified {
		t.Error("should be qualified when all pass")
	}
}

// ── JSON Round-trip: Our assertions serialize correctly ──

func TestAssertionsDoc_JSONRoundTrip(t *testing.T) {
	original := `{"exit_code":0,"output_assertions":[{"mode":"contains","value":"hello"},{"mode":"regex","value":"\\d+"}],"syscall_assertions":{"required":["clone"],"min_count":{"futex":4}},"behavior_assertions":{"no_deadlock":true,"max_runtime_ms":5000},"numeric_assertions":{"mode":"count_distinct","pattern":"(\\d+)","min":1,"max":10}}`

	doc, err := ParseAssertions(original)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}

	// Re-serialize and verify key fields
	reJSON, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var verify map[string]interface{}
	if err := json.Unmarshal(reJSON, &verify); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if _, ok := verify["exit_code"]; !ok {
		t.Error("exit_code missing in round-trip")
	}
	if _, ok := verify["output_assertions"]; !ok {
		t.Error("output_assertions missing in round-trip")
	}
	if _, ok := verify["syscall_assertions"]; !ok {
		t.Error("syscall_assertions missing in round-trip")
	}
	if _, ok := verify["behavior_assertions"]; !ok {
		t.Error("behavior_assertions missing in round-trip")
	}
	if _, ok := verify["numeric_assertions"]; !ok {
		t.Error("numeric_assertions missing in round-trip")
	}
}

// ── Regression: SQL migrations don't break our evaluator ──

func TestDBMigrationTypeValues(t *testing.T) {
	// Verify all type values in the migration CHECK constraint are handled by normalizeType
	validTypes := []string{"core", "edge", "normal", "edge_case", "performance", "security"}

	for _, typ := range validTypes {
		normalized := normalizeType(typ)
		if normalized == "" {
			t.Errorf("normalizeType(%q) returned empty string", typ)
		}
		switch typ {
		case "normal", "core":
			if normalized != "core" {
				t.Errorf("normalizeType(%q) = %q, expected 'core'", typ, normalized)
			}
		case "edge_case", "edge":
			if normalized != "edge" {
				t.Errorf("normalizeType(%q) = %q, expected 'edge'", typ, normalized)
			}
		}
	}
}