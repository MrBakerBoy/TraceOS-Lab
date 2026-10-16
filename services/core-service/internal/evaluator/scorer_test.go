package evaluator

import "testing"

func TestScore_AllPassed(t *testing.T) {
	code := "#include <stdio.h>\nint main() {\n  int a = 1;\n  if (a > 0) printf(\"hello\");\n  return 0;\n}"
	results := []TestResult{
		{Passed: true, ActualOutput: "hello"}, {Passed: true, ActualOutput: "hello"}, {Passed: true, ActualOutput: "hello"},
	}
	s := Score(results, &ProcessStrategy{}, code, 50, 50)
	if s.PassedCases != 3 {
		t.Errorf("PassedCases = %d, want 3", s.PassedCases)
	}
	if s.TotalScore < 90 {
		t.Errorf("TotalScore = %d, want >= 90", s.TotalScore)
	}
	if !s.Passed {
		t.Errorf("should pass when all tests pass")
	}
}

func TestScore_HalfPassed(t *testing.T) {
	code := "#include <stdio.h>\nint main() { int a=1; return a; }"
	results := []TestResult{
		{Passed: true, ActualOutput: "ok"},
		{Passed: true, ActualOutput: "ok"},
		{Passed: false},
		{Passed: false},
	}
	s := Score(results, &ProcessStrategy{}, code, 0, 0)
	if s.PassedCases != 2 {
		t.Errorf("PassedCases = %d, want 2", s.PassedCases)
	}
	if s.TotalScore >= 80 {
		t.Errorf("TotalScore = %d, want < 80", s.TotalScore)
	}
}

func TestScore_ZeroPassed_NoCode(t *testing.T) {
	code := "#include <stdio.h>\nint main() { return 0; }"
	results := []TestResult{
		{Passed: false}, {Passed: false},
	}
	s := Score(results, &ProcessStrategy{}, code, 0, 0)
	if s.TotalScore != 0 {
		t.Errorf("TotalScore = %d, want 0 (no real code)", s.TotalScore)
	}
	if s.Passed {
		t.Errorf("should NOT pass with no real code")
	}
}

func TestScore_ZeroPassed_WithEffort(t *testing.T) {
	code := "#include <stdio.h>\n#include <unistd.h>\nint main() {\n  pid_t p = fork();\n  if (p == 0) printf(\"child\");\n  else printf(\"parent\");\n  return 0;\n}"
	results := []TestResult{
		{Passed: false, ActualOutput: "parent", ExitCode: 0},
	}
	s := Score(results, &ProcessStrategy{}, code, 30, 30)
	if s.TotalScore <= 0 {
		t.Errorf("TotalScore = %d, want > 0 (has effort)", s.TotalScore)
	}
}

func TestScore_EmptyCode(t *testing.T) {
	s := Score([]TestResult{{Passed: true}}, &ProcessStrategy{}, "", 0, 0)
	if s.Passed {
		t.Errorf("should NOT pass with empty code")
	}
}

func TestScore_Empty(t *testing.T) {
	s := Score(nil, &ProcessStrategy{}, "", 0, 0)
	if s.TotalScore != 0 {
		t.Errorf("TotalScore = %d, want 0", s.TotalScore)
	}
}
