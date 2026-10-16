package evaluator

import (
	"context"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/traceos-lab/core-service/internal/model"
	"github.com/traceos-lab/core-service/internal/sandbox"
)

// maxParallelTests bounds how many test cases run concurrently. The sandbox
// manager's own semaphore (nsjail: NSJAIL_MAX_CONCURRENT) is the stricter
// limiter; this cap only prevents unbounded goroutine fan-out for backends
// without an internal limit (e.g. local execution).
const maxParallelTests = 8

// TestCaseRunner executes compiled binaries against test cases.
type TestCaseRunner struct {
	manager sandbox.SandboxManager
}

// NewTestCaseRunner creates a new test case runner.
func NewTestCaseRunner(manager sandbox.SandboxManager) *TestCaseRunner {
	return &TestCaseRunner{manager: manager}
}

// RunAll executes all test cases and returns results.
func (r *TestCaseRunner) RunAll(ctx context.Context, binaryPath string, testCases []model.TestCase, strategy ExperimentStrategy) ([]TestResult, error) {
	level := sandbox.SandboxLevel(strategy.SandboxLevel())
	rerunCount := strategy.RerunCount()
	if rerunCount < 1 {
		rerunCount = 1
	}

	results := make([]TestResult, len(testCases))
	var firstErr error
	var errMu sync.Mutex
	sem := make(chan struct{}, maxParallelTests)
	var wg sync.WaitGroup

	for i, tc := range testCases {
		wg.Add(1)
		go func(i int, tc model.TestCase) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			var bestResult *TestResult
			for run := 0; run < rerunCount; run++ {
				result, err := r.runOne(ctx, binaryPath, tc, level, strategy)
				if err != nil {
					errMu.Lock()
					if firstErr == nil {
						firstErr = fmt.Errorf("test case %s run %d: %w", tc.ID, run, err)
					}
					errMu.Unlock()
					return
				}

				if bestResult == nil || result.Passed {
					bestResult = result
				}
				if result.Passed {
					break
				}
			}

			if bestResult != nil {
				results[i] = *bestResult
			}
		}(i, tc)
	}

	wg.Wait()
	return results, firstErr
}

func (r *TestCaseRunner) runOne(ctx context.Context, binaryPath string, tc model.TestCase, level sandbox.SandboxLevel, strategy ExperimentStrategy) (*TestResult, error) {
	sb, err := r.manager.Acquire(ctx, level)
	if err != nil {
		return nil, fmt.Errorf("acquire sandbox: %w", err)
	}
	defer r.manager.Release(sb)

	// Honor strategy DisableTrace setting
	sb.DisableTrace = strategy.DisableTrace()

	timeout := time.Duration(strategy.TimeLimit()) * time.Second
	execResult, err := r.manager.Execute(ctx, sb, binaryPath, []byte(tc.InputData), timeout)
	if err != nil {
		return &TestResult{
			TestCaseID:   tc.ID,
			Name:         tc.Name,
			Passed:       false,
			ScoreWeight:  tc.ScoreWeight,
			RuntimeError: StrPtr(fmt.Sprintf("execution error: %v", err)),
		}, nil
	}

	// Normalize expected output: convert escaped \\n to real newlines
	compareMode := tc.CompareMode
	if compareMode == "" {
		compareMode = strategy.CompareMode()
	}
	expectedOutput := tc.ExpectedOutput
	if compareMode != "regex" {
		expectedOutput = normalizeEscapes(tc.ExpectedOutput)
	}

	var passed bool
	expectedExit := strategy.ExitCodeRequired()
	if strings.TrimSpace(expectedOutput) == "" {
		// Empty expected output: program should produce only whitespace/no output
		// Allow whitespace-only output (lenient: students may print stray newlines)
		passed = execResult.ExitCode == expectedExit && !execResult.Killed
		log.Printf("[Runner] test=%s passed=%v (empty expected output) stdout_empty=%v exitCode=%d", tc.Name, passed, strings.TrimSpace(execResult.Stdout) == "", execResult.ExitCode)
	} else {
		var normalizedStdout, normalizedExpected string
                if compareMode == "regex" {
                        normalizedStdout = execResult.Stdout
                        normalizedExpected = expectedOutput
                } else {
                        normalizedStdout = normalizeDynamicOutput(execResult.Stdout)
                        normalizedExpected = normalizeDynamicOutput(expectedOutput)
                }
        compareResult := compareWithFallback(normalizedStdout, normalizedExpected, compareMode, strategy.CompareMode())
		passed = compareResult.Match && execResult.ExitCode == expectedExit && !execResult.Killed
		log.Printf("[Runner] test=%s passed=%v match=%v exitCode=%d mode=%s", tc.Name, passed, compareResult.Match, execResult.ExitCode, tc.CompareMode)
	}

	result := &TestResult{
		TraceFile: execResult.TraceFile,

		TestCaseID:     tc.ID,
		Name:           tc.Name,
		Passed:         passed,
		ScoreWeight:    tc.ScoreWeight,
		ActualOutput:   execResult.Stdout,
		ExpectedOutput: expectedOutput,
		ExitCode:       execResult.ExitCode,
		ExecTime:       execResult.ExecTime,
		MemoryUsage:    execResult.MemoryUsage,
	}

	if execResult.Killed {
		msg := "execution timeout"
		result.RuntimeError = &msg
	}

	return result, nil
}

var pidRe = regexp.MustCompile(`PID=\d+`)
var tidRe = regexp.MustCompile(`TID=\d+`)
var fdRe = regexp.MustCompile(`(?:fd|FD|file descriptor)\s*[:=]?\s*\d+`)
var addrRe = regexp.MustCompile(`0x[0-9a-fA-F]{4,}`)
var tsRe = regexp.MustCompile(`\d{2}:\d{2}:\d{2}[.]\d+`)

// normalizeDynamicOutput replaces runtime-dynamic values in output for comparison.
// Many OS lab outputs include PIDs, addresses, timestamps, FDs that change every run,
// but expected test case output uses placeholder patterns.
func normalizeDynamicOutput(s string) string {
	s = pidRe.ReplaceAllString(s, "PID=")
	s = tidRe.ReplaceAllString(s, "TID=")
	s = fdRe.ReplaceAllString(s, "FD=")
	s = addrRe.ReplaceAllString(s, "0xADDR")
	s = tsRe.ReplaceAllString(s, "HH:MM:SS.ms")
	return s
}

// NormalizeEscapes converts literal escape sequences (stored as text in DB) to actual characters.
// Exported for testing.
func NormalizeEscapes(s string) string { return normalizeEscapes(s) }

// ParseStraceLine is an exported wrapper for testing the strace parser.
func ParseStraceLine(line string) *StraceLine { return parseStraceLine(line) }

// StraceLine is an exported type alias for testing.
type StraceLine = straceLine

// normalizeEscapes converts literal escape sequences (stored as text in DB) to actual characters.
// e.g., the two-char sequence backslash-n becomes a real newline.
// Supports: \n \t \r \\ \" and octal \0xx sequences.
func normalizeEscapes(s string) string {
	s = strings.ReplaceAll(s, "\\n", "\n")
	s = strings.ReplaceAll(s, "\\t", "\t")
	s = strings.ReplaceAll(s, "\\r", "\r")
	s = strings.ReplaceAll(s, "\\\\", "\\")
	s = strings.ReplaceAll(s, "\\\"", "\"")
	// Handle octal escape sequences like \033 (common in terminal color codes)
	octalRe := regexp.MustCompile(`\\([0-7]{3})`)
	s = octalRe.ReplaceAllStringFunc(s, func(match string) string {
		var v int
		fmt.Sscanf(match[1:], "%o", &v)
		return string(rune(v))
	})
	return s
}

// compareWithFallback uses tcMode if non-empty, otherwise falls back to strategyMode
func compareWithFallback(actual, expected, tcMode, strategyMode string) *CompareResult {
	mode := tcMode
	if mode == "" {
		mode = strategyMode
	}
	return Compare(actual, expected, mode)
}
