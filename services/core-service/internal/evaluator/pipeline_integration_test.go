package evaluator

import (
	"testing"
)

// TestAllStrategies_ValidWeights verifies that every experiment strategy
// produces weight configurations that sum to 1.0 (100%).
func TestAllStrategies_ValidWeights(t *testing.T) {
	strategies := map[string]ExperimentStrategy{
		"process":   &ProcessStrategy{},
		"thread":    &ThreadStrategy{},
		"memory":    &MemoryStrategy{},
		"fs":        &FileStrategy{},
		"scheduler": &SchedulerStrategy{},
		"deadlock":  &DeadlockStrategy{},
	}

	for name, strategy := range strategies {
		t.Run(name, func(t *testing.T) {
			total := strategy.OutputWeight() + strategy.StructureWeight() + strategy.BehaviorWeight()
			if total < 0.99 || total > 1.01 {
				t.Errorf("weight sum = %.2f, want 1.0 (output=%.2f structure=%.2f behavior=%.2f)",
					total, strategy.OutputWeight(), strategy.StructureWeight(), strategy.BehaviorWeight())
			}

			// Sandbox level must be 1-3
			level := strategy.SandboxLevel()
			if level < 1 || level > 3 {
				t.Errorf("sandbox level = %d, want 1-3", level)
			}

			// Time limit must be positive
			if strategy.TimeLimit() <= 0 {
				t.Errorf("time limit = %d, want > 0", strategy.TimeLimit())
			}

			// Rerun count must be >= 1
			if strategy.RerunCount() < 1 {
				t.Errorf("rerun count = %d, want >= 1", strategy.RerunCount())
			}

			// Compare mode should be valid
			mode := strategy.CompareMode()
			validModes := map[string]bool{"exact": true, "contains": true, "regex": true, "ignore_whitespace": true, "normalized_contains": true}
			if !validModes[mode] {
				t.Errorf("compare mode = %q, not in valid set", mode)
			}

			// DisableTrace should be false for most strategies
			// (tracing is a core feature — only disable for specific cases)
			if strategy.DisableTrace() {
				t.Logf("%s: tracing is disabled", name)
			}
		})
	}
}

// TestNormalizeEscapes_AllPatterns verifies escape sequence normalization.
func TestNormalizeEscapes_AllPatterns(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"hello\\nworld", "hello\nworld"},
		{"tab\\ttest", "tab\ttest"},
		{"carriage\\rreturn", "carriage\rreturn"},
		{"back\\\\slash", "back\\slash"},
		{"quote\\\"here", "quote\"here"},
		{"\\n\\t\\r", "\n\t\r"},
		{"plain text", "plain text"},
		{"", ""},
	}

	for _, tc := range tests {
		result := NormalizeEscapes(tc.input)
		if result != tc.expected {
			t.Errorf("NormalizeEscapes(%q) = %q, want %q", tc.input, result, tc.expected)
		}
	}
}

// TestNormalizeDynamicOutput_CommonPatterns verifies output normalization
// replaces runtime-variable values like PIDs and addresses with placeholders.
func TestNormalizeDynamicOutput_CommonPatterns(t *testing.T) {
	tests := []struct {
		input    string
		contains string // output should contain this after normalization
		excludes string // output should NOT contain this after normalization
	}{
		{
			input:    "Parent PID=12345, Child PID=67890",
			contains: "PID=",
			excludes: "12345",
		},
		{
			input:    "Address: 0x7fff1234abcd",
			contains: "0xADDR",
			excludes: "0x7fff",
		},
		{
			input:    "Time: 10:30:45.123456 started",
			contains: "HH:MM:SS.ms",
			excludes: "10:30:45",
		},
		{
			input:    "fd=3 opened, fd=5 closed",
			contains: "FD=",
		},
	}

	for _, tc := range tests {
		result := normalizeDynamicOutput(tc.input)
		if tc.contains != "" && !stringContains(result, tc.contains) {
			t.Errorf("normalizeDynamicOutput(%q) = %q, expected to contain %q", tc.input, result, tc.contains)
		}
		if tc.excludes != "" && stringContains(result, tc.excludes) {
			t.Errorf("normalizeDynamicOutput(%q) = %q, should NOT contain %q", tc.input, result, tc.excludes)
		}
	}
}

// TestParseStraceLine verifies strace line parsing for common formats.
func TestParseStraceLine(t *testing.T) {
	tests := []struct {
		name     string
		line     string
		expectOK bool
		syscall  string
		retVal   int64
		hasError bool
	}{
		{
			name:     "successful read",
			line:     "12345 10:30:45.123456 read(3, \"hello\", 5) = 5 <0.000123>",
			expectOK: true,
			syscall:  "read",
			retVal:   5,
			hasError: false,
		},
		{
			name:     "failed write with errno",
			line:     "12345 10:30:45.123456 write(1, \"test\", 4) = -1 EACCES (Permission denied)",
			expectOK: true,
			syscall:  "write",
			retVal:   -1,
			hasError: true,
		},
		{
			name:     "close success",
			line:     "12345 10:30:45.123456 close(3) = 0 <0.000010>",
			expectOK: true,
			syscall:  "close",
			retVal:   0,
			hasError: false,
		},
		{
			name:     "empty line",
			line:     "",
			expectOK: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := parseStraceLine(tc.line)
			if tc.expectOK {
				if result == nil {
					t.Fatal("expected parsed result, got nil")
				}
				if result.syscall != tc.syscall {
					t.Errorf("syscall = %q, want %q", result.syscall, tc.syscall)
				}
				if result.retVal != tc.retVal {
					t.Errorf("retVal = %d, want %d", result.retVal, tc.retVal)
				}
				if tc.hasError && result.errorName == "" {
					t.Error("expected error name to be set")
				}
			} else {
				if result != nil {
					t.Errorf("expected nil, got %+v", result)
				}
			}
		})
	}
}

// TestParseStraceLine_Resumed verifies that `<... SYSCALL resumed>` lines
// produced by `strace -f` for blocking syscalls (wait4, futex, ...) are parsed
// and counted instead of being silently dropped.
func TestParseStraceLine_Resumed(t *testing.T) {
	line := "3309970 12:43:41.893214 <... wait4 resumed>[{WIFEXITED(s) && WEXITSTATUS(s) == 0}], 0, NULL) = 3309971 <0.016285>"
	result := parseStraceLine(line)
	if result == nil {
		t.Fatal("expected resumed wait4 line to be parsed, got nil")
	}
	if result.syscall != "wait4" {
		t.Errorf("syscall = %q, want wait4", result.syscall)
	}
	if result.retVal != 3309971 {
		t.Errorf("retVal = %d, want 3309971", result.retVal)
	}
	if result.duration <= 0 {
		t.Errorf("duration = %f, want > 0", result.duration)
	}
}

// TestParseStraceLine_AllSyscalls verifies that various OS syscall names
// are correctly extracted from strace output.
func TestParseStraceLine_AllSyscalls(t *testing.T) {
	syscalls := []string{
		"fork", "execve", "wait4", "clone",
		"openat", "read", "write", "close", "stat", "lseek",
		"mmap", "munmap", "brk", "mprotect",
		"futex", "pthread_create", "nanosleep",
		"sched_yield", "getpriority", "setpriority",
	}

	for _, sc := range syscalls {
		line := "12345 10:30:45.123456 " + sc + "(...) = 0 <0.000001>"
		result := parseStraceLine(line)
		if result == nil {
			t.Errorf("parseStraceLine failed for syscall %q", sc)
			continue
		}
		if result.syscall != sc {
			t.Errorf("syscall = %q, want %q", result.syscall, sc)
		}
	}
}

// TestHasSubstantialCode_Cases verifies code quality detection.
func TestHasSubstantialCode_Cases(t *testing.T) {
	tests := []struct {
		name     string
		code     string
		expected bool
	}{
		{"trivial main", "#include <stdio.h>\nint main() { return 0; }", false},
		{"has printf", "#include <stdio.h>\nint main() { printf(\"hello\"); return 0; }", true},
		{"has fork", "#include <unistd.h>\nint main() { fork(); return 0; }", true},
		{"has pthread", "#include <pthread.h>\nint main() { pthread_t t; return 0; }", true},
		{"has malloc", "#include <stdlib.h>\nint main() { int *p = malloc(4); free(p); return 0; }", true},
		{"has if for while", "#include <stdio.h>\nint main() { for (int i=0;i<10;i++) if (i>5) break; return 0; }", true},
		{"empty code", "", false},
		{"comment only", "// this is a comment\n/* block comment */", false},
		{"only includes", "#include <stdio.h>\n#include <stdlib.h>", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := HasSubstantialCode(tc.code)
			if result != tc.expected {
				t.Errorf("HasSubstantialCode(%q) = %v, want %v", tc.code, result, tc.expected)
			}
		})
	}
}

// TestScore_EdgeCases covers score-related edge cases.
func TestScore_EdgeCases(t *testing.T) {
	// Empty results
	s := Score(nil, &ProcessStrategy{}, "", 0, 0)
	if s.TotalScore != 0 || s.PassedCases != 0 {
		t.Error("Score of nil results should be 0")
	}

	// Single passed test
	s = Score([]TestResult{{Passed: true}}, &ProcessStrategy{}, "#include <stdio.h>\nint main() {\n  int a = 1;\n  if (a > 0) printf(\"ok\");\n  return 0;\n}", 50, 50)
	if s.TotalScore <= 0 {
		t.Error("Single passed test with real code should score > 0")
	}
	if !s.Passed {
		t.Error("Single test passed should result in Passed=true")
	}
}

// Helper: stringContains checks if a string contains a substring.
func stringContains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
