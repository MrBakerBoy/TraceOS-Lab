package evaluator

import (
	"encoding/json"
	"strings"
	"testing"
)

// ── ParseAssertions Tests ──

func TestParseAssertions_ValidJSON_AllFields(t *testing.T) {
	input := `{
		"exit_code": 0,
		"output_assertions": [{"mode": "contains", "value": "hello"}],
		"syscall_assertions": {"required": ["clone"], "forbidden": ["system"]},
		"behavior_assertions": {"no_fd_leak": true, "max_runtime_ms": 5000},
		"numeric_assertions": {"mode": "count_distinct", "pattern": "(\\d+)", "min": 1, "max": 10}
	}`

	doc, err := ParseAssertions(input)
	if err != nil {
		t.Fatalf("ParseAssertions failed: %v", err)
	}
	if len(doc.OutputAssertions) != 1 {
		t.Errorf("expected 1 output assertion, got %d", len(doc.OutputAssertions))
	}
	if doc.SyscallAssertions == nil {
		t.Error("expected syscall_assertions to be non-nil")
	}
	if doc.BehaviorAssertions == nil {
		t.Error("expected behavior_assertions to be non-nil")
	}
	if doc.NumericAssertions == nil {
		t.Error("expected numeric_assertions to be non-nil")
	}
}

func TestParseAssertions_Minimal(t *testing.T) {
	doc, err := ParseAssertions(`{"exit_code": 0}`)
	if err != nil {
		t.Fatalf("ParseAssertions failed: %v", err)
	}
	if doc.OutputAssertions != nil {
		t.Errorf("expected nil output_assertions, got %v", doc.OutputAssertions)
	}
}

func TestParseAssertions_EmptyString(t *testing.T) {
	doc, err := ParseAssertions("")
	if err != nil {
		t.Fatalf("ParseAssertions failed: %v", err)
	}
	if len(doc.OutputAssertions) == 0 || doc.OutputAssertions[0].Mode != "exact_match" {
		t.Error("empty string should fallback to exact_match")
	}
}

func TestParseAssertions_LegacyString(t *testing.T) {
	doc, err := ParseAssertions("All items processed")
	if err != nil {
		t.Fatalf("ParseAssertions failed: %v", err)
	}
	if len(doc.OutputAssertions) == 0 || doc.OutputAssertions[0].Mode != "contains" {
		t.Error("legacy string should fallback to contains mode")
	}
}

func TestParseAssertions_ExitCodeArray(t *testing.T) {
	doc, err := ParseAssertions(`{"exit_code": [0, 1, 139]}`)
	if err != nil {
		t.Fatalf("ParseAssertions failed: %v", err)
	}
	var arr []int
	if err := json.Unmarshal(doc.ExitCode, &arr); err != nil {
		t.Fatalf("failed to unmarshal exit_code array: %v", err)
	}
	if len(arr) != 3 {
		t.Errorf("expected 3 exit codes, got %d", len(arr))
	}
}

// ── evalExitCode Tests ──

func TestEvalExitCode_SingleMatch(t *testing.T) {
	ok, detail := evalExitCode(json.RawMessage("0"), 0)
	if !ok {
		t.Errorf("exit code 0 should match expected 0: %s", detail)
	}
}

func TestEvalExitCode_SingleMismatch(t *testing.T) {
	ok, _ := evalExitCode(json.RawMessage("0"), 1)
	if ok {
		t.Error("exit code 1 should not match expected 0")
	}
}

func TestEvalExitCode_ArrayMatch(t *testing.T) {
	ok, _ := evalExitCode(json.RawMessage("[0,1,139]"), 139)
	if !ok {
		t.Error("exit code 139 should be in allowed set [0,1,139]")
	}
}

func TestEvalExitCode_ArrayNoMatch(t *testing.T) {
	ok, _ := evalExitCode(json.RawMessage("[0,1]"), 139)
	if ok {
		t.Error("exit code 139 should not be in allowed set [0,1]")
	}
}

// ── evalOutputAssertions Tests ──

func TestEvalOutput_Contains(t *testing.T) {
	assertions := []OutputAssertion{{Mode: "contains", Value: "hello"}}
	ok, details := evalOutputAssertions(assertions, "hello world")
	if !ok {
		t.Errorf("contains should pass: %v", details)
	}
}

func TestEvalOutput_ContainsFail(t *testing.T) {
	assertions := []OutputAssertion{{Mode: "contains", Value: "missing"}}
	ok, _ := evalOutputAssertions(assertions, "hello world")
	if ok {
		t.Error("contains should fail when text is missing")
	}
}

func TestEvalOutput_NotContains(t *testing.T) {
	assertions := []OutputAssertion{{Mode: "not_contains", Value: "error"}}
	ok, _ := evalOutputAssertions(assertions, "hello world")
	if !ok {
		t.Error("not_contains should pass when text is absent")
	}
}

func TestEvalOutput_NotContainsFail(t *testing.T) {
	assertions := []OutputAssertion{{Mode: "not_contains", Value: "hello"}}
	ok, _ := evalOutputAssertions(assertions, "hello world")
	if ok {
		t.Error("not_contains should fail when text is present")
	}
}

func TestEvalOutput_Regex(t *testing.T) {
	assertions := []OutputAssertion{{Mode: "regex", Value: `\d+`}}
	ok, _ := evalOutputAssertions(assertions, "count: 42 items")
	if !ok {
		t.Error("regex should match digits")
	}
}

func TestEvalOutput_RegexFail(t *testing.T) {
	assertions := []OutputAssertion{{Mode: "regex", Value: `\d+`}}
	ok, _ := evalOutputAssertions(assertions, "no numbers here")
	if ok {
		t.Error("regex should fail when no digits present")
	}
}

func TestEvalOutput_ExactMatch(t *testing.T) {
	assertions := []OutputAssertion{{Mode: "exact_match", Value: "hello"}}
	ok, _ := evalOutputAssertions(assertions, "hello")
	if !ok {
		t.Error("exact_match should pass for identical strings")
	}
}

func TestEvalOutput_ExactMatchFail(t *testing.T) {
	assertions := []OutputAssertion{{Mode: "exact_match", Value: "hello"}}
	ok, _ := evalOutputAssertions(assertions, "hello world")
	if ok {
		t.Error("exact_match should fail for different strings")
	}
}

func TestEvalOutput_MultipleAssertions_AllPass(t *testing.T) {
	assertions := []OutputAssertion{
		{Mode: "contains", Value: "hello"},
		{Mode: "regex", Value: `\d+`},
	}
	ok, _ := evalOutputAssertions(assertions, "hello 42")
	if !ok {
		t.Error("both assertions should pass")
	}
}

func TestEvalOutput_MultipleAssertions_OneFails(t *testing.T) {
	assertions := []OutputAssertion{
		{Mode: "contains", Value: "hello"},
		{Mode: "not_contains", Value: "hello"},
	}
	ok, _ := evalOutputAssertions(assertions, "hello world")
	if ok {
		t.Error("should fail because not_contains conflicts with contains")
	}
}

// ── evalSyscallAssertions Tests ──

func TestEvalSyscall_RequiredFound(t *testing.T) {
	sa := &SyscallAssertions{Required: []string{"clone", "write"}}
	sysMap := map[string]int{"clone": 1, "write": 3, "close": 2}
	ok, _ := evalSyscallAssertions(sa, sysMap)
	if !ok {
		t.Error("required syscalls should be found")
	}
}

func TestEvalSyscall_RequiredMissing(t *testing.T) {
	sa := &SyscallAssertions{Required: []string{"clone", "mmap"}}
	sysMap := map[string]int{"clone": 1}
	ok, _ := evalSyscallAssertions(sa, sysMap)
	if ok {
		t.Error("should fail when required syscall is missing")
	}
}

func TestEvalSyscall_ForbiddenAbsent(t *testing.T) {
	sa := &SyscallAssertions{Forbidden: []string{"mmap"}}
	sysMap := map[string]int{"clone": 1, "write": 3}
	ok, _ := evalSyscallAssertions(sa, sysMap)
	if !ok {
		t.Error("forbidden syscalls absent should pass")
	}
}

func TestEvalSyscall_ForbiddenPresent(t *testing.T) {
	sa := &SyscallAssertions{Forbidden: []string{"execve"}}
	sysMap := map[string]int{"execve": 1}
	ok, _ := evalSyscallAssertions(sa, sysMap)
	if ok {
		t.Error("should fail when forbidden syscall is present")
	}
}

func TestEvalSyscall_MinCount(t *testing.T) {
	sa := &SyscallAssertions{MinCount: map[string]int{"clone": 4}}
	sysMap := map[string]int{"clone": 5}
	ok, _ := evalSyscallAssertions(sa, sysMap)
	if !ok {
		t.Error("min_count should pass when count >= min")
	}
}

func TestEvalSyscall_MinCountFail(t *testing.T) {
	sa := &SyscallAssertions{MinCount: map[string]int{"clone": 4}}
	sysMap := map[string]int{"clone": 2}
	ok, _ := evalSyscallAssertions(sa, sysMap)
	if ok {
		t.Error("min_count should fail when count < min")
	}
}

func TestEvalSyscall_MaxCount(t *testing.T) {
	sa := &SyscallAssertions{MaxCount: map[string]int{"futex": 100}}
	sysMap := map[string]int{"futex": 50}
	ok, _ := evalSyscallAssertions(sa, sysMap)
	if !ok {
		t.Error("max_count should pass when count <= max")
	}
}

// ── evalBehaviorAssertions Tests ──

func TestEvalBehavior_NoFDLeakPass(t *testing.T) {
	a := &BehaviorAssertions{NoFDLeak: true}
	m := &BehaviorMetrics{HasFDLeak: false}
	ok, _ := evalBehaviorAssertions(a, m)
	if !ok {
		t.Error("no_fd_leak should pass without leak")
	}
}

func TestEvalBehavior_NoFDLeakFail(t *testing.T) {
	a := &BehaviorAssertions{NoFDLeak: true}
	m := &BehaviorMetrics{HasFDLeak: true, FDLeaked: 3}
	ok, _ := evalBehaviorAssertions(a, m)
	if ok {
		t.Error("no_fd_leak should fail with leak")
	}
}

func TestEvalBehavior_NoZombiePass(t *testing.T) {
	a := &BehaviorAssertions{NoZombie: true}
	m := &BehaviorMetrics{HasZombies: false}
	ok, _ := evalBehaviorAssertions(a, m)
	if !ok {
		t.Error("no_zombie should pass without zombies")
	}
}

func TestEvalBehavior_NoDeadlockPass(t *testing.T) {
	a := &BehaviorAssertions{NoDeadlock: true}
	m := &BehaviorMetrics{DeadlockDetected: false}
	ok, _ := evalBehaviorAssertions(a, m)
	if !ok {
		t.Error("no_deadlock should pass without deadlock")
	}
}

func TestEvalBehavior_MaxRuntimeExceeded(t *testing.T) {
	a := &BehaviorAssertions{MaxRuntimeMs: 1000}
	m := &BehaviorMetrics{RuntimeMs: 1500}
	ok, _ := evalBehaviorAssertions(a, m)
	if ok {
		t.Error("should fail when runtime exceeds max")
	}
}

func TestEvalBehavior_MaxMemoryExceeded(t *testing.T) {
	a := &BehaviorAssertions{MaxMemoryKB: 1024}
	m := &BehaviorMetrics{MemoryKB: 2048}
	ok, _ := evalBehaviorAssertions(a, m)
	if ok {
		t.Error("should fail when memory exceeds max")
	}
}

func TestEvalBehavior_NilMetrics(t *testing.T) {
	a := &BehaviorAssertions{NoFDLeak: true}
	ok, _ := evalBehaviorAssertions(a, nil)
	if !ok {
		t.Error("nil metrics should default to empty and pass")
	}
}

// ── evalNumericAssertions Tests ──

func TestEvalNumeric_CountDistinct(t *testing.T) {
	a := &NumericAssertions{
		Mode:    "count_distinct",
		Pattern: `(\d+)`,
		Min:     3,
		Max:     5,
	}
	ok, _ := evalNumericAssertions(a, "1 2 3 4")
	if !ok {
		t.Error("count_distinct should pass for 4 unique values in [3,5]")
	}
}

func TestEvalNumeric_CountDistinctTooFew(t *testing.T) {
	a := &NumericAssertions{
		Mode:    "count_distinct",
		Pattern: `(\d+)`,
		Min:     5,
		Max:     10,
	}
	ok, _ := evalNumericAssertions(a, "1 2 3")
	if ok {
		t.Error("count_distinct should fail for 3 values when min=5")
	}
}

func TestEvalNumeric_CountDistinctTooMany(t *testing.T) {
	a := &NumericAssertions{
		Mode:    "count_distinct",
		Pattern: `(\d+)`,
		Min:     1,
		Max:     2,
	}
	ok, _ := evalNumericAssertions(a, "1 2 3 4 5")
	if ok {
		t.Error("count_distinct should fail for 5 values when max=2")
	}
}

func TestEvalNumeric_SetEquality(t *testing.T) {
	a := &NumericAssertions{
		Mode:     "set_equality",
		Pattern:  `Consumed: (\d+)`,
		Expected: []float64{1, 2, 3, 4, 5},
	}
	ok, _ := evalNumericAssertions(a, "Consumed: 1\nConsumed: 2\nConsumed: 3\nConsumed: 4\nConsumed: 5")
	if !ok {
		t.Error("set_equality should pass for exact match")
	}
}

func TestEvalNumeric_SetEqualityMissing(t *testing.T) {
	a := &NumericAssertions{
		Mode:     "set_equality",
		Pattern:  `(\d+)`,
		Expected: []float64{1, 2, 3},
	}
	ok, _ := evalNumericAssertions(a, "1 2")
	if ok {
		t.Error("set_equality should fail when expected value is missing")
	}
}

func TestEvalNumeric_NoMatch(t *testing.T) {
	a := &NumericAssertions{
		Mode:    "count_distinct",
		Pattern: `(\d+)`,
		Min:     1,
		Max:     10,
	}
	ok, _ := evalNumericAssertions(a, "no numbers here")
	if ok {
		t.Error("should fail when pattern matches nothing")
	}
}

func TestEvalNumeric_InvalidRegex(t *testing.T) {
	a := &NumericAssertions{
		Mode:    "count_distinct",
		Pattern: `[unclosed`,
		Min:     1,
		Max:     10,
	}
	ok, _ := evalNumericAssertions(a, "some text")
	if ok {
		t.Error("should fail on invalid regex pattern")
	}
}

// ── EvaluateAssertions Integration Tests ──

func TestEvaluateAssertions_AllPass(t *testing.T) {
	doc := &AssertionsDoc{
		ExitCode: json.RawMessage("0"),
		OutputAssertions: []OutputAssertion{
			{Mode: "contains", Value: "hello"},
		},
		SyscallAssertions: &SyscallAssertions{
			Required: []string{"write"},
		},
	}
	result := EvaluateAssertions(doc, "hello world", 0, map[string]int{"write": 1}, nil)
	if !result.Passed {
		t.Errorf("all assertions should pass: %s", result.Reason)
	}
	if !result.Summary.ExitCodePassed {
		t.Error("exit_code should pass")
	}
	if !result.Summary.OutputPassed {
		t.Error("output should pass")
	}
	if !result.Summary.SyscallPassed {
		t.Error("syscall should pass")
	}
}

func TestEvaluateAssertions_ExitCodeFails_EverythingElseSkipped(t *testing.T) {
	doc := &AssertionsDoc{
		ExitCode: json.RawMessage("0"),
	}
	result := EvaluateAssertions(doc, "any output", 1, nil, nil)
	if result.Passed {
		t.Error("should fail when exit_code mismatches")
	}
	if result.Summary.ExitCodePassed {
		t.Error("exit_code should fail for 1 vs expected 0")
	}
}

func TestEvaluateAssertions_OutputNormalization(t *testing.T) {
	// verify that PID normalization works in output assertions
	doc := &AssertionsDoc{
		ExitCode: json.RawMessage("0"),
		OutputAssertions: []OutputAssertion{
			{Mode: "contains", Value: "PID=NNN"},
		},
	}
	result := EvaluateAssertions(doc, "Parent: PID=12345", 0, nil, nil)
	if !result.Passed {
		t.Errorf("normalization should translate PID=12345 to PID=NNN: %s", result.Reason)
	}
}

// ── normalizeOutput Tests ──

func TestNormalizeOutput_PID(t *testing.T) {
	got := normalizeOutput("PID=12345")
	if !strings.Contains(got, "PID=NNN") {
		t.Errorf("expected PID=NNN, got %q", got)
	}
}

func TestNormalizeOutput_PPID(t *testing.T) {
	got := normalizeOutput("PPID=9999")
	if !strings.Contains(got, "PPID=NNN") {
		t.Errorf("expected PPID=NNN, got %q", got)
	}
}

func TestNormalizeOutput_HexAddress(t *testing.T) {
	got := normalizeOutput("at 0x7ffe1234abcd")
	if !strings.Contains(got, "0xNNN") {
		t.Errorf("expected 0xNNN, got %q", got)
	}
}

func TestNormalizeOutput_Timestamp(t *testing.T) {
	got := normalizeOutput("12:34:56.789012")
	if !strings.Contains(got, "HH:MM:SS") {
		t.Errorf("expected HH:MM:SS, got %q", got)
	}
}

func TestNormalizeOutput_WhitespaceCollapse(t *testing.T) {
	got := normalizeOutput("line1\nline2\rline3\t\tline4")
	if strings.Contains(got, "\n") || strings.Contains(got, "\t") || strings.Contains(got, "  ") {
		t.Errorf("whitespace should be collapsed: %q", got)
	}
}

// ── Real-world Test Case Scenarios ──

func TestRealWorld_Lab1_ForkBasic_TC1(t *testing.T) {
	// TC1: fork创建成功
	doc, err := ParseAssertions(`{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Parent:.*PID=\\d+"}],"syscall_assertions":{"required":["clone"]},"behavior_assertions":{"max_runtime_ms":5000}}`)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	m := &BehaviorMetrics{RuntimeMs: 100}
	result := EvaluateAssertions(doc, "Parent: PID=12345, Child PID=12346", 0, map[string]int{"clone": 1}, m)
	if !result.Passed {
		t.Errorf("lab1 TC1 should pass: %s", result.Reason)
	}
}

func TestRealWorld_Lab8_ProducerConsumer_TC2(t *testing.T) {
	// TC2: 所有数据正确消费 — contains + numeric count_distinct
	input := `{"exit_code":0,"output_assertions":[{"mode":"contains","value":"All items processed"}],"numeric_assertions":{"mode":"count_distinct","pattern":"Consumed: (\\d+)","min":20,"max":20}}`
	doc, err := ParseAssertions(input)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	output := ""
	for i := 1; i <= 20; i++ {
		output += strings.Repeat("Consumed: %d\n", 1)
		output = strings.Replace(output, "%d", "Consumed: ...\n", 1)
	}
	// build proper output
	var sb strings.Builder
	for i := 1; i <= 20; i++ {
		sb.WriteString("Consumed: 1\n")
	}
	sb.WriteString("All items processed\n")
	result := EvaluateAssertions(doc, sb.String(), 0, nil, nil)
	// This will fail count_distinct because all values are 1 (not 1-20)
	// but that's realistic — it should catch missing values
	if !result.Summary.OutputPassed {
		t.Logf("output details: %v", result.Summary.OutputDetails)
	}
	if result.Summary.NumericPassed {
		t.Log("numeric passed (all values are 1, so count_distinct=1, min=20 fails)")
	}
	// The test correctly identifies that count_distinct of only "1" values is 1, not 20
	if result.Passed {
		t.Error("should fail because we only have value 1 repeated, not 1-20 distinct")
	}
}

func TestRealWorld_Lab24_SchedSim_TC1(t *testing.T) {
	// TC1: FCFS正确输出 — regex + contains
	doc, err := ParseAssertions(`{"exit_code":0,"output_assertions":[{"mode":"regex","value":"FCFS:.*avg.*wait"},{"mode":"contains","value":"avg turnaround"}]}`)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	result := EvaluateAssertions(doc, "FCFS: avg wait=5.50, avg turnaround=9.25", 0, nil, nil)
	if !result.Passed {
		t.Errorf("lab24 TC1 should pass: %s", result.Reason)
	}
}

func TestRealWorld_ExitCodeArray(t *testing.T) {
	// TC5: 错误处理 — exit_code: [0,1]
	doc, err := ParseAssertions(`{"exit_code":[0,1],"syscall_assertions":{"forbidden":["system","execve"]}}`)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	result := EvaluateAssertions(doc, "", 1, map[string]int{}, nil)
	if !result.Passed {
		t.Errorf("exit_code 1 should be in [0,1]: %s", result.Reason)
	}
	result2 := EvaluateAssertions(doc, "", 139, map[string]int{}, nil)
	if result2.Passed {
		t.Error("exit_code 139 should not be in [0,1]")
	}
}

func TestRealWorld_SyscallAlias_Fork(t *testing.T) {
	// fork syscall should be resolved as clone alias
	doc := &AssertionsDoc{
		ExitCode: json.RawMessage("0"),
		SyscallAssertions: &SyscallAssertions{
			Required: []string{"clone"},
		},
	}
	// syscall "fork" maps to "clone" via aliases
	result := EvaluateAssertions(doc, "", 0, map[string]int{"fork": 1}, nil)
	if !result.Passed {
		t.Errorf("fork should be resolved as clone alias: %s", result.Reason)
	}
}