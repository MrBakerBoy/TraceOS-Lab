package evaluator

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// ── Parsed JSON Assertion Structures ──

// AssertionsDoc is the top-level parsed JSON structure for a test case's expected_output.
type AssertionsDoc struct {
	ExitCode           json.RawMessage       `json:"exit_code"`           // number or []number
	OutputAssertions   []OutputAssertion     `json:"output_assertions"`   // optional
	SyscallAssertions  *SyscallAssertions    `json:"syscall_assertions"`  // optional
	BehaviorAssertions *BehaviorAssertions   `json:"behavior_assertions"` // optional
	NumericAssertions  *NumericAssertions    `json:"numeric_assertions"`  // optional
}

// OutputAssertion represents a single output assertion rule.
type OutputAssertion struct {
	Mode  string `json:"mode"`  // contains | not_contains | regex | exact_match
	Value string `json:"value"`
}

// SyscallAssertions defines syscall-level rules.
type SyscallAssertions struct {
	Required  []string       `json:"required"`
	Forbidden []string       `json:"forbidden"`
	MinCount  map[string]int `json:"min_count"`
	MaxCount  map[string]int `json:"max_count"`
}

// BehaviorAssertions defines runtime behavior rules.
type BehaviorAssertions struct {
	NoFDLeak      bool  `json:"no_fd_leak"`
	NoZombie      bool  `json:"no_zombie"`
	NoDeadlock    bool  `json:"no_deadlock"`
	MaxMemoryKB   int64 `json:"max_memory_kb"`
	MaxRuntimeMs  int64 `json:"max_runtime_ms"`
}

// NumericAssertions defines mathematical constraints on extracted numeric values.
type NumericAssertions struct {
	Mode     string    `json:"mode"`     // range | comparison | set_equality | count_distinct
	Pattern  string    `json:"pattern"`  // regex with capture group 1
	Min      float64   `json:"min"`
	Max      float64   `json:"max"`
	Expected []float64 `json:"expected"` // for set_equality
	Formula  string    `json:"formula"`  // for comparison
}

// ── Evaluation Result Structures ──

// EvalSummary holds the result of evaluating all assertions for one test point.
type EvalSummary struct {
	Passed          bool            `json:"passed"`
	ExitCodePassed  bool            `json:"exit_code_passed"`
	ExitCodeDetail  string          `json:"exit_code_detail"`
	OutputPassed    bool            `json:"output_passed"`
	OutputDetails   []string        `json:"output_details"`
	SyscallPassed   bool            `json:"syscall_passed"`
	SyscallDetails  []string        `json:"syscall_details"`
	BehaviorPassed  bool            `json:"behavior_passed"`
	BehaviorDetails []string        `json:"behavior_details"`
	NumericPassed   bool            `json:"numeric_passed"`
	NumericDetail   string          `json:"numeric_detail"`
}

// EvalResult is the complete evaluation result for a test case.
type EvalResult struct {
	Passed bool        `json:"passed"`
	Reason string      `json:"reason"`
	Summary EvalSummary `json:"summary"`
}

// ── Normalization ──

// normalizeOutput replaces volatile tokens (PIDs, addresses, timestamps) with placeholders
// and folds whitespace to single spaces.
func normalizeOutput(s string) string {
	patterns := []struct {
		re   *regexp.Regexp
		repl string
	}{
		{regexp.MustCompile(`PID=\d+`), "PID=NNN"},
		{regexp.MustCompile(`TID=\d+`), "TID=NNN"},
		{regexp.MustCompile(`PPID=\d+`), "PPID=NNN"},
		{regexp.MustCompile(`0x[0-9a-fA-F]+`), "0xNNN"},
		{regexp.MustCompile(`\d{2}:\d{2}:\d{2}\.\d+`), "HH:MM:SS"},
	}
	normalized := s
	for _, p := range patterns {
		normalized = p.re.ReplaceAllString(normalized, p.repl)
	}
	// Collapse whitespace
	normalized = strings.ReplaceAll(normalized, "\n", " ")
	normalized = strings.ReplaceAll(normalized, "\r", " ")
	normalized = strings.ReplaceAll(normalized, "\t", " ")
	for strings.Contains(normalized, "  ") {
		normalized = strings.ReplaceAll(normalized, "  ", " ")
	}
	return strings.TrimSpace(normalized)
}

// ── Parsing ──

// ParseAssertions parses the expected_output field into an AssertionsDoc.
// Falls back to legacy compatibility for non-JSON strings.
func ParseAssertions(raw string) (*AssertionsDoc, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return &AssertionsDoc{
			ExitCode: json.RawMessage("0"),
			OutputAssertions: []OutputAssertion{
				{Mode: "exact_match", Value: ""},
			},
		}, nil
	}

	// Try JSON parse first
	var doc AssertionsDoc
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		// Legacy fallback: plain string → contains assertion
		return &AssertionsDoc{
			ExitCode: json.RawMessage("0"),
			OutputAssertions: []OutputAssertion{
				{Mode: "contains", Value: raw},
			},
		}, nil
	}

	// Ensure exit_code has a default
	if len(doc.ExitCode) == 0 {
		doc.ExitCode = json.RawMessage("0")
	}

	return &doc, nil
}

// ── Evaluation ──

// EvaluateAssertions evaluates all assertions in a doc against the actual test results.
func EvaluateAssertions(doc *AssertionsDoc, output string, exitCode int,
	syscallMap map[string]int, metrics *BehaviorMetrics) *EvalResult {

	summary := EvalSummary{}

	// 1. Exit code check
	summary.ExitCodePassed, summary.ExitCodeDetail = evalExitCode(doc.ExitCode, exitCode)

	// 2. Output assertions
	if len(doc.OutputAssertions) > 0 {
		normalized := ""
		if len(doc.OutputAssertions) > 0 {
			normalized = normalizeOutput(output)
			rawNormalized := normalizeOutput(output)
			// Both normalized output and raw normalized are used
			_ = normalized
			_ = rawNormalized
		}
		summary.OutputPassed, summary.OutputDetails = evalOutputAssertions(doc.OutputAssertions, output)
	} else {
		summary.OutputPassed = true
	}

	// 3. Syscall assertions
	if doc.SyscallAssertions != nil {
		summary.SyscallPassed, summary.SyscallDetails = evalSyscallAssertions(doc.SyscallAssertions, syscallMap)
	} else {
		summary.SyscallPassed = true
	}

	// 4. Behavior assertions
	if doc.BehaviorAssertions != nil {
		summary.BehaviorPassed, summary.BehaviorDetails = evalBehaviorAssertions(doc.BehaviorAssertions, metrics)
	} else {
		summary.BehaviorPassed = true
	}

	// 5. Numeric assertions
	if doc.NumericAssertions != nil {
		summary.NumericPassed, summary.NumericDetail = evalNumericAssertions(doc.NumericAssertions, output)
	} else {
		summary.NumericPassed = true
	}

	// All MUST pass (AND)
	allPassed := summary.ExitCodePassed &&
		summary.OutputPassed &&
		summary.SyscallPassed &&
		summary.BehaviorPassed &&
		summary.NumericPassed

	reason := "all assertions passed"
	if !allPassed {
		reason = buildFailReason(&summary)
	}

	return &EvalResult{
		Passed:  allPassed,
		Reason:  reason,
		Summary: summary,
	}
}

// ── Exit Code Evaluation ──

func evalExitCode(raw json.RawMessage, actual int) (bool, string) {
	// Try single number
	var single int
	if err := json.Unmarshal(raw, &single); err == nil {
		if actual == single {
			return true, fmt.Sprintf("exit_code %d == expected %d", actual, single)
		}
		return false, fmt.Sprintf("exit_code %d != expected %d", actual, single)
	}

	// Try array of numbers
	var multi []int
	if err := json.Unmarshal(raw, &multi); err == nil {
		for _, v := range multi {
			if actual == v {
				return true, fmt.Sprintf("exit_code %d in allowed set %v", actual, multi)
			}
		}
		return false, fmt.Sprintf("exit_code %d not in allowed set %v", actual, multi)
	}

	return false, fmt.Sprintf("invalid exit_code format: %s", string(raw))
}

// ── Output Assertions Evaluation ──

func evalOutputAssertions(assertions []OutputAssertion, actual string) (bool, []string) {
	normalized := normalizeOutput(actual)
	var details []string
	allPassed := true

	for _, a := range assertions {
		switch a.Mode {
		case "contains":
			expectedNorm := normalizeOutput(a.Value)
			if strings.Contains(normalized, expectedNorm) {
				details = append(details, fmt.Sprintf("contains %q: passed", a.Value))
			} else {
				details = append(details, fmt.Sprintf("contains %q: failed", a.Value))
				allPassed = false
			}
		case "not_contains":
			expectedNorm := normalizeOutput(a.Value)
			if !strings.Contains(normalized, expectedNorm) {
				details = append(details, fmt.Sprintf("not_contains %q: passed", a.Value))
			} else {
				details = append(details, fmt.Sprintf("not_contains %q: failed (found in output)", a.Value))
				allPassed = false
			}
		case "regex":
			re, err := regexp.Compile(a.Value)
			if err != nil {
				details = append(details, fmt.Sprintf("regex %q: invalid pattern (%v)", a.Value, err))
				allPassed = false
			} else if re.MatchString(actual) {
				details = append(details, fmt.Sprintf("regex %q: passed", a.Value))
			} else {
				details = append(details, fmt.Sprintf("regex %q: failed", a.Value))
				allPassed = false
			}
		case "exact_match":
			expectedNorm := normalizeOutput(a.Value)
			if normalized == expectedNorm {
				details = append(details, fmt.Sprintf("exact_match: passed"))
			} else {
				details = append(details, fmt.Sprintf("exact_match: failed (expected %q, got %q)",
					truncate(expectedNorm, 100), truncate(normalized, 100)))
				allPassed = false
			}
		default:
			details = append(details, fmt.Sprintf("unknown mode %q", a.Mode))
			allPassed = false
		}
	}
	return allPassed, details
}

// ── Syscall Assertions Evaluation ──

func resolveAliasCount(name string, syscallMap map[string]int) int {
	aliases := syscallAliases(name)
	total := 0
	for _, a := range aliases {
		total += syscallMap[a]
	}
	return total
}

func syscallNameExists(name string, syscallMap map[string]int) bool {
	return resolveAliasCount(name, syscallMap) > 0
}

func evalSyscallAssertions(a *SyscallAssertions, syscallMap map[string]int) (bool, []string) {
	allPassed := true
	var details []string

	// Required: must appear at least once
	for _, name := range a.Required {
		if !syscallNameExists(name, syscallMap) {
			details = append(details, fmt.Sprintf("required %q: not found", name))
			allPassed = false
		} else {
			details = append(details, fmt.Sprintf("required %q: found", name))
		}
	}

	// Forbidden: must NOT appear
	for _, name := range a.Forbidden {
		if syscallNameExists(name, syscallMap) {
			details = append(details, fmt.Sprintf("forbidden %q: found (count=%d)", name, resolveAliasCount(name, syscallMap)))
			allPassed = false
		} else {
			details = append(details, fmt.Sprintf("forbidden %q: not found", name))
		}
	}

	// Min count
	for name, min := range a.MinCount {
		actual := resolveAliasCount(name, syscallMap)
		if actual < min {
			details = append(details, fmt.Sprintf("min_count %q: %d < %d", name, actual, min))
			allPassed = false
		} else {
			details = append(details, fmt.Sprintf("min_count %q: %d >= %d", name, actual, min))
		}
	}

	// Max count
	for name, max := range a.MaxCount {
		actual := resolveAliasCount(name, syscallMap)
		if actual > max {
			details = append(details, fmt.Sprintf("max_count %q: %d > %d", name, actual, max))
			allPassed = false
		} else {
			details = append(details, fmt.Sprintf("max_count %q: %d <= %d", name, actual, max))
		}
	}

	return allPassed, details
}

// ── Behavior Assertions Evaluation ──

func evalBehaviorAssertions(a *BehaviorAssertions, m *BehaviorMetrics) (bool, []string) {
	if m == nil {
		m = &BehaviorMetrics{} // default empty metrics
	}
	allPassed := true
	var details []string

	if a.NoFDLeak {
		if m.HasFDLeak {
			details = append(details, fmt.Sprintf("no_fd_leak: failed (%d leaked)", m.FDLeaked))
			allPassed = false
		} else {
			details = append(details, "no_fd_leak: passed")
		}
	}
	if a.NoZombie {
		if m.HasZombies {
			details = append(details, "no_zombie: failed")
			allPassed = false
		} else {
			details = append(details, "no_zombie: passed")
		}
	}
	if a.NoDeadlock {
		if m.DeadlockDetected {
			details = append(details, "no_deadlock: failed")
			allPassed = false
		} else {
			details = append(details, "no_deadlock: passed")
		}
	}
	if a.MaxMemoryKB > 0 && m.MemoryKB > a.MaxMemoryKB {
		details = append(details, fmt.Sprintf("max_memory_kb: %d > %d", m.MemoryKB, a.MaxMemoryKB))
		allPassed = false
	}
	if a.MaxRuntimeMs > 0 && m.RuntimeMs > float64(a.MaxRuntimeMs) {
		details = append(details, fmt.Sprintf("max_runtime_ms: %.0f > %d", m.RuntimeMs, a.MaxRuntimeMs))
		allPassed = false
	}

	if len(details) == 0 {
		details = append(details, "no behavior assertions to check")
	}
	return allPassed, details
}

// ── Numeric Assertions Evaluation ──

func evalNumericAssertions(a *NumericAssertions, output string) (bool, string) {
	normalized := normalizeOutput(output)
	re, err := regexp.Compile(a.Pattern)
	if err != nil {
		return false, fmt.Sprintf("invalid regex pattern: %v", err)
	}

	matches := re.FindAllStringSubmatch(normalized, -1)
	if len(matches) == 0 {
		return false, fmt.Sprintf("pattern %q matched no values", a.Pattern)
	}

	// Extract numeric values from capture group 1
	var values []float64
	for _, m := range matches {
		if len(m) > 1 {
			v, err := strconv.ParseFloat(m[1], 64)
			if err == nil {
				values = append(values, v)
			}
		}
	}

	if len(values) == 0 {
		return false, fmt.Sprintf("pattern %q matched but no numeric values extracted", a.Pattern)
	}

	switch a.Mode {
	case "count_distinct":
		seen := map[float64]bool{}
		for _, v := range values {
			seen[v] = true
		}
		cnt := float64(len(seen))
		if cnt < a.Min || cnt > a.Max {
			return false, fmt.Sprintf("count_distinct: %d unique values, expected [%.0f, %.0f]",
				int(cnt), a.Min, a.Max)
		}
		return true, fmt.Sprintf("count_distinct: %d unique values in [%.0f, %.0f]",
			int(cnt), a.Min, a.Max)

	case "set_equality":
		if len(values) != len(a.Expected) {
			return false, fmt.Sprintf("set_equality: got %d values, expected %d",
				len(values), len(a.Expected))
		}
		expectedSet := map[float64]bool{}
		for _, e := range a.Expected {
			expectedSet[e] = true
		}
		for _, v := range values {
			if !expectedSet[v] {
				return false, fmt.Sprintf("set_equality: unexpected value %.0f", v)
			}
		}
		for _, e := range a.Expected {
			found := false
			for _, v := range values {
				if v == e {
					found = true
					break
				}
			}
			if !found {
				return false, fmt.Sprintf("set_equality: missing value %.0f", e)
			}
		}
		return true, "set_equality: all expected values matched"

	default:
		return false, fmt.Sprintf("unsupported numeric_assertions mode: %s", a.Mode)
	}
}

// ── Helpers ──

func buildFailReason(s *EvalSummary) string {
	var parts []string
	if !s.ExitCodePassed {
		parts = append(parts, fmt.Sprintf("exit_code: %s", s.ExitCodeDetail))
	}
	if !s.OutputPassed {
		for _, d := range s.OutputDetails {
			if strings.HasSuffix(d, ": failed") || strings.HasPrefix(d, "exact_match: failed") ||
				strings.HasPrefix(d, "unknown mode") {
				parts = append(parts, fmt.Sprintf("output: %s", d))
			}
		}
	}
	if !s.SyscallPassed {
		var fails []string
		for _, d := range s.SyscallDetails {
			if isSyscallFailDetail(d) {
				fails = append(fails, d)
			}
		}
		if len(fails) > 0 {
			parts = append(parts, fmt.Sprintf("syscall: %s", strings.Join(fails, "; ")))
		}
	}
	if !s.BehaviorPassed {
		for _, d := range s.BehaviorDetails {
			if strings.HasSuffix(d, ": failed") || strings.Contains(d, ": failed (") || strings.Contains(d, " > ") {
				parts = append(parts, fmt.Sprintf("behavior: %s", d))
			}
		}
	}
	if !s.NumericPassed {
		parts = append(parts, fmt.Sprintf("numeric: %s", s.NumericDetail))
	}
	if len(parts) == 0 {
		return "unknown assertion failure"
	}
	return strings.Join(parts, "; ")
}

// isSyscallFailDetail identifies a syscall-assertion detail string that
// represents a failure (as opposed to a passing "found / not found" note).
func isSyscallFailDetail(d string) bool {
	if strings.HasPrefix(d, "required ") && strings.Contains(d, ": not found") {
		return true
	}
	if strings.HasPrefix(d, "forbidden ") && strings.Contains(d, ": found (") {
		return true
	}
	if strings.HasPrefix(d, "min_count ") && strings.Contains(d, " < ") {
		return true
	}
	if strings.HasPrefix(d, "max_count ") && strings.Contains(d, " > ") {
		return true
	}
	return false
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}