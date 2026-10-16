package evaluator

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/traceos-lab/core-service/internal/model"
	"github.com/traceos-lab/core-service/internal/nats"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/sandbox"
	"github.com/traceos-lab/core-service/internal/services"
	"github.com/traceos-lab/core-service/internal/ebpf"
	"github.com/traceos-lab/core-service/internal/types"
)

// Pipeline orchestrates the full evaluation process: compile → run → score → update DB → publish event.
type Pipeline struct {
	compiler         *Compiler
	runner           *TestCaseRunner
	subRepo          *repository.SubmissionRepo
	expRepo          *repository.ExperimentRepo
	codeTemplateRepo *repository.CodeTemplateRepo
	bus              nats.EventBus
	obsCtxBuilder    *services.ObsContextBuilder
	ebpfAdapter      *ebpf.Adapter
}

// NewPipeline creates a new evaluation pipeline.
func NewPipeline(subRepo *repository.SubmissionRepo, expRepo *repository.ExperimentRepo, codeTemplateRepo *repository.CodeTemplateRepo, sm sandbox.SandboxManager, bus nats.EventBus, obsCtxBuilder *services.ObsContextBuilder, ebpfAdapter *ebpf.Adapter) *Pipeline {
	return &Pipeline{
		compiler:         NewCompiler("/tmp"),
		runner:           NewTestCaseRunner(sm),
		subRepo:          subRepo,
		expRepo:          expRepo,
		codeTemplateRepo: codeTemplateRepo,
		bus:              bus,
		obsCtxBuilder:    obsCtxBuilder,
		ebpfAdapter:      ebpfAdapter,
	}
}

// Run executes the full evaluation pipeline for a submission.

// generateEmptyTemplateCode strips all code between full CODE START and CODE END markers.
// Handles the actual format: /* ==== CODE START ==== */ ... /* ==== CODE END ==== */
func generateEmptyTemplateCode(code string) string {
	lines := []string{}
	inBlock := false
	for _, line := range strings.Split(code, "\n") {
		upper := strings.ToUpper(line)
		if strings.Contains(upper, "CODE START") {
			inBlock = true
			continue
		}
		if strings.Contains(upper, "CODE END") {
			inBlock = false
			continue
		}
		if !inBlock {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}

// runBinaryForOutput compiles and runs source code, returning its stdout output.
func (p *Pipeline) runBinaryForOutput(ctx context.Context, code string, lang string, strategy ExperimentStrategy) (string, error) {
	compileResult, err := p.compiler.Compile(ctx, code, lang, strategy.CompileFlagsFor(lang))
	if err != nil { return "", fmt.Errorf("empty template compile: %w", err) }
	if !compileResult.Success { return "", fmt.Errorf("empty template compile failed: %s", compileResult.Stderr) }
	defer os.RemoveAll(filepath.Dir(compileResult.BinaryPath))
	dummyTC := model.TestCase{ID: "empty_template_check", Name: "empty_template_check", ExpectedOutput: "", ScoreWeight: 1}
	result, err := p.runner.runOne(ctx, compileResult.BinaryPath, dummyTC, sandbox.SandboxLevel(strategy.SandboxLevel()), strategy)
	if err != nil { return "", fmt.Errorf("empty template run: %w", err) }
	return result.ActualOutput, nil
}

// normalizeOutputForComparison collapses whitespace for output comparison.
func normalizeOutputForComparison(s string) string {
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, "\t", "")
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, "\r", "")
	return strings.TrimSpace(s)
}

func (p *Pipeline) Run(ctx context.Context, submissionID, experimentID, studentID string) error {
	log.Printf("[Pipeline] Run START: submission=%s experiment=%s student=%s", submissionID, experimentID, studentID)
	// 1. Get experiment info + test cases
	exp, err := p.expRepo.GetByID(ctx, experimentID)
	if err != nil {
		p.updateStatus(ctx, submissionID, "failed", nil, nil)
		return fmt.Errorf("get experiment: %w", err)
	}

	// 2. Get submission
	sub, err := p.subRepo.GetByID(ctx, submissionID)
	if err != nil {
		return fmt.Errorf("get submission: %w", err)
	}

	// 3. Select strategy based on experiment category
	strategy := GetStrategy(exp.Category)

	testCases, err := p.expRepo.GetTestCases(ctx, experimentID)
	if err != nil {
		p.updateStatus(ctx, submissionID, "failed", nil, nil)
		return fmt.Errorf("get test cases: %w", err)
	}

	if len(testCases) == 0 {
		log.Printf("[Pipeline] no test cases for %s, evaluating by compilation only", experimentID)
		p.evaluateWithoutTests(ctx, submissionID, experimentID, studentID, sub, exp, strategy)
		return nil
	}
	// 4. Update status to running
	_ = p.subRepo.UpdateResult(ctx, submissionID, "running", 0, 100, 0, len(testCases), nil, nil, nil, nil)

	// 5. Compile
	compileResult, err := p.compiler.Compile(ctx, sub.Code, sub.Language, strategy.CompileFlagsFor(sub.Language))
	if err != nil {
		errMsg := fmt.Sprintf("compilation error: %v", err)
		p.updateStatus(ctx, submissionID, "compile_error", &errMsg, nil)
		p.writeCompileChecklist(submissionID, errMsg)
		p.publishCompleted(submissionID, experimentID, studentID, 0, 0, len(testCases), "compile_error", &errMsg, nil)
		return nil
	}

	if !compileResult.Success {
		p.updateStatus(ctx, submissionID, "compile_error", &compileResult.Stderr, nil)
		p.writeCompileChecklist(submissionID, compileResult.Stderr)
		p.publishCompleted(submissionID, experimentID, studentID, 0, 0, len(testCases), "compile_error", &compileResult.Stderr, nil)
		return nil
	}
	defer os.RemoveAll(filepath.Dir(compileResult.BinaryPath))

	// 6. Run test cases (eBPF-first, strace fallback).
	// The empty-template check only depends on the source code (already
	// available), so it runs concurrently with the student's test execution to
	// hide its own compile+run latency off the critical path.
	emptyTemplateSource := generateEmptyTemplateCode(sub.Code)
	type emptyTemplateOutcome struct {
		output string
		err    error
	}
	var emptyCh chan emptyTemplateOutcome
	if emptyTemplateSource != sub.Code {
		emptyCh = make(chan emptyTemplateOutcome, 1)
		go func() {
			out, e := p.runBinaryForOutput(ctx, emptyTemplateSource, sub.Language, strategy)
			emptyCh <- emptyTemplateOutcome{output: out, err: e}
		}()
	}

	var traceRecords []repository.SyscallTraceRecord
	var testResults []TestResult

	if p.ebpfAdapter != nil && p.ebpfAdapter.IsAvailable() {
		log.Printf("[Pipeline] using eBPF tracing for submission %s", submissionID)
		traceRecords, testResults, err = p.runTestCasesEBPF(ctx, submissionID, compileResult.BinaryPath, testCases, strategy)
	} else {
		log.Printf("[Pipeline] using strace tracing for submission %s", submissionID)
		testResults, err = p.runner.RunAll(ctx, compileResult.BinaryPath, testCases, strategy)
	}
	if err != nil {
		errMsg := fmt.Sprintf("execution error: %v", err)
		p.updateStatus(ctx, submissionID, "failed", nil, &errMsg)
		p.publishCompleted(submissionID, experimentID, studentID, 0, 0, len(testCases), "failed", nil, &errMsg)
		return fmt.Errorf("run tests: %w", err)
	}

	// 6.1 Empty-template output comparison:
	// If student code output is identical to empty template output,
	// the student did not write meaningful code -- override all tests to failed.
	if emptyCh != nil {
		et := <-emptyCh
		if et.err == nil {
			studentOutput := ""
			if len(testResults) > 0 { studentOutput = testResults[0].ActualOutput }
			if normalizeOutputForComparison(studentOutput) == normalizeOutputForComparison(et.output) {
				log.Printf("[Pipeline] student output matches empty template -- marking all tests as failed")
				for i := range testResults { testResults[i].Passed = false }
			}
		} else {
			log.Printf("[Pipeline] empty template check skipped: %v", et.err)
		}
	}

	// 6.2 Safety net: if no substantial code detected, all tests fail
	if !HasSubstantialCode(sub.Code) {
		log.Printf("[Pipeline] no substantial code detected -- marking all tests as failed")
		for i := range testResults { testResults[i].Passed = false }
	}

	// 6.4b. Collect memory-layout snapshots from strace memory events (brk/mmap/munmap/mprotect).
	// Runs before collectAndStoreTraces, which removes the trace files.
	p.collectAndStoreMemoryLayouts(submissionID, testResults)

// 6.5. Collect and store syscall traces, then analyze for patterns
	if len(traceRecords) == 0 {
		// Strace mode: read from trace files
		traceRecords = p.collectAndStoreTraces(submissionID, compileResult.BinaryPath, testResults)
	} else {
		// eBPF mode: traces already collected, just store them
		insertCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := p.subRepo.InsertSyscallTraces(insertCtx, traceRecords); err != nil {
			log.Printf("[Pipeline] failed to insert eBPF traces: %v", err)
		} else {
			log.Printf("[Pipeline] stored %d eBPF traces for submission %s", len(traceRecords), submissionID)
		}
	}

	// 6.5b. Derive and store resource usage metrics from test results + strace analysis
	p.collectAndStoreResourceUsage(submissionID, traceRecords, testResults)

	// 6.6. Perform semantic pattern analysis on traces for AI diagnosis
	var straceSummaryData *nats.StraceSummaryData
	if len(traceRecords) > 0 {
		analysis := AnalyzeStraceTraces(traceRecords)
		if analysis != nil && analysis.TotalSyscalls > 0 {
			straceSummaryData = &nats.StraceSummaryData{
				TotalSyscalls:  analysis.TotalSyscalls,
				ErrorSyscalls:  analysis.ErrorSyscalls,
				UniqueSyscalls: analysis.UniqueSyscalls,
				HumanReadable:  analysis.HumanReadable,
			}
			if len(analysis.TopSyscalls) > 0 {
				for _, sc := range analysis.TopSyscalls {
					straceSummaryData.TopSyscalls = append(straceSummaryData.TopSyscalls, nats.SyscallCountData{Name: sc.Name, Count: sc.Count})
				}
			}
			if len(analysis.TopErrors) > 0 {
				for _, se := range analysis.TopErrors {
					straceSummaryData.TopErrors = append(straceSummaryData.TopErrors, nats.SyscallErrorData{Name: se.Name, ErrorName: se.ErrorName, Count: se.Count})
				}
			}
			if len(analysis.Patterns) > 0 {
				for _, p := range analysis.Patterns {
					straceSummaryData.Patterns = append(straceSummaryData.Patterns, nats.PatternData{
						Pattern: p.Pattern, Severity: p.Severity,
						Description: p.Description, Evidence: p.Evidence, Count: p.Count,
					})
				}
			}
			if analysis.FDOpenClose != nil {
				straceSummaryData.FDOpenClose = &nats.BalanceData{
					Opens: analysis.FDOpenClose.Opens, Closes: analysis.FDOpenClose.Closes,
					Leaked: analysis.FDOpenClose.Leaked, HasLeak: analysis.FDOpenClose.HasLeak,
					Detail: analysis.FDOpenClose.Detail,
				}
			}
			if analysis.MemoryOps != nil {
				straceSummaryData.MemoryOps = &nats.BalanceData{
					AllocCalls: analysis.MemoryOps.AllocCalls, FreeCalls: analysis.MemoryOps.FreeCalls,
					HasImbalance: analysis.MemoryOps.HasImbalance, Detail: analysis.MemoryOps.Detail,
				}
			}
			if analysis.ProcessOps != nil {
				straceSummaryData.ProcessOps = &nats.BalanceData{
					ForkCalls: analysis.ProcessOps.ForkCalls, WaitCalls: analysis.ProcessOps.WaitCalls,
					HasZombies: analysis.ProcessOps.HasZombies, Detail: analysis.ProcessOps.Detail,
				}
			}
			log.Printf("[Pipeline] strace analysis: %d calls, %d errors, %d patterns detected",
				analysis.TotalSyscalls, analysis.ErrorSyscalls, len(analysis.Patterns))
		}
	}

	// Build test results data for AI
	var testResultsData []nats.TestResultData
	for _, tr := range testResults {
		testResultsData = append(testResultsData, nats.TestResultData{
			Name: tr.Name, Passed: tr.Passed, ScoreWeight: tr.ScoreWeight,
			ActualOutput: tr.ActualOutput, ExpectedOutput: tr.ExpectedOutput,
			RuntimeError: ptrToStr(tr.RuntimeError),
		})
	}

	// Build ObsContext from trace records for AI/frontend consumption
	var obsContextJSON json.RawMessage
	var obsCtx *types.ObsContext
	if p.obsCtxBuilder != nil && len(traceRecords) > 0 {
		params := services.BuildParams{
			SubmissionID:  submissionID,
			ExperimentID:  experimentID,
			StudentID:     studentID,
			Language:      sub.Language,
			TimelineStart: time.Now().Add(-5 * time.Minute),
			TimelineEnd:   time.Now(),
		}
		if sub.Score != nil {
			params.Score = *sub.Score
		}
		if sub.TotalScore != nil {
			params.TotalScore = *sub.TotalScore
		}
		params.PassedCases = sub.PassedTestCases
		params.TotalCases = sub.TotalTestCases
		if sub.CompileError != nil && *sub.CompileError != "" {
			params.CompileError = sub.CompileError
		}
		if sub.RuntimeError != nil && *sub.RuntimeError != "" {
			params.RuntimeError = sub.RuntimeError
		}
		for _, t := range traceRecords {
			params.SyscallTraces = append(params.SyscallTraces, services.SyscallTraceInput{
				Timestamp:  t.Time,
				Syscall:    t.SyscallName,
				PID:        t.PID,
				TID:        t.PID,
				Ret:        t.ReturnValue,
				DurationNs: t.DurationNs,
				ErrorName:  t.ErrorName,
			})
		}
		if len(traceRecords) > 0 {
			params.TimelineStart = traceRecords[0].Time
			params.TimelineEnd = traceRecords[len(traceRecords)-1].Time
		}
		obsCtx = p.obsCtxBuilder.Build(params)
		if obsContextJSON, err = json.Marshal(obsCtx); err != nil {
			log.Printf("[Pipeline] failed to marshal ObsContext: %v", err)
			obsContextJSON = nil
		}
	}

	// ── 7. New assertion-based scoring (v2) ──

	// Build syscall map from trace records
	syscallMap := make(map[string]int)
	for _, tr := range traceRecords {
		syscallMap[tr.SyscallName]++
	}

	// Build BehaviorMetrics from traces + test results
	metrics := NewBehaviorMetrics()
	metrics.MergeSyscallMap(syscallMap)
	// Extract exit code / runtime / memory from test results
	if len(testResults) > 0 {
		last := testResults[len(testResults)-1]
		metrics.FromExecutionResult(last.ExitCode,
			float64(last.ExecTime.Milliseconds()),
			last.MemoryUsage, false)
	}
	metrics.AnalyzeFDLeak()
	metrics.AnalyzeZombies()

	// Evaluate each test case using assertion JSON
	var testPointResults []TestPointResult
	for _, tc := range testCases {
		// Find matching test result
		var matchedResult *TestResult
		for i := range testResults {
			if testResults[i].TestCaseID == tc.ID {
				matchedResult = &testResults[i]
				break
			}
		}

		parseErr := (*string)(nil)
		var evalRes *EvalResult
		var doc *AssertionsDoc

		actualOutput := ""
		if matchedResult != nil {
			actualOutput = matchedResult.ActualOutput
		}

		if matchedResult != nil && matchedResult.RuntimeError != nil {
			// Runtime error: test point fails automatically
			errMsg := *matchedResult.RuntimeError
			parseErr = &errMsg
			evalRes = &EvalResult{Passed: false, Reason: errMsg}
		} else if matchedResult != nil {
			// Normal case: parse and evaluate assertions
			parsed, pErr := ParseAssertions(tc.ExpectedOutput)
			if pErr != nil {
				errMsg := fmt.Sprintf("assertion parse error: %v", pErr)
				parseErr = &errMsg
				evalRes = &EvalResult{Passed: false, Reason: errMsg}
			} else {
				doc = parsed
				evalRes = EvaluateAssertions(doc,
					matchedResult.ActualOutput,
					matchedResult.ExitCode,
					syscallMap, metrics)
			}
		} else {
			// No matching result — test not run (shouldn't happen)
			errMsg := "test not executed"
			parseErr = &errMsg
			evalRes = &EvalResult{Passed: false, Reason: errMsg}
		}

		execMs := int64(0)
		if matchedResult != nil {
			execMs = matchedResult.ExecTime.Milliseconds()
		}

		tpr := TestPointResult{
			ID:             tc.ID,
			Name:           tc.Name,
			Type:           normalizeType(tc.Type),
			Weight:         tc.ScoreWeight,
			Passed:         evalRes.Passed,
			FailReason:     evalRes.Reason,
			ExecTimeMs:     execMs,
			RuntimeError:   parseErr,
			ActualOutput:   truncate(actualOutput, 4096),
			ExpectedOutput: tc.ExpectedOutput,
			Assertions:     buildAssertionDetails(doc, evalRes),
		}
		testPointResults = append(testPointResults, tpr)
	}

	// Compute new score
	scoreResult2 := NewScore(testPointResults)

	// ── 8. Calculate total execution time ──
	var totalExecMs int
	for _, tr := range testResults {
		totalExecMs += int(tr.ExecTime.Milliseconds())
	}
	execTimePtr := &totalExecMs

	// ── 9. Update submission in DB with new fields ──
	// totalWeight = sum of all test-point weights (the experiment's full mark).
	// passedCount = number of actually passed test points, not the total count.
	var totalWeight int
	passedCount := 0
	for _, tp := range scoreResult2.Points {
		totalWeight += tp.Weight
		if tp.Passed {
			passedCount++
		}
	}

	var status string
	if scoreResult2.IsQualified {
		status = "completed"
	} else {
		status = "failed"
	}

	testPointsJSON, err := json.Marshal(scoreResult2.Points)
	if err != nil {
		log.Printf("[Pipeline] failed to marshal test points for %s: %v", submissionID, err)
		testPointsJSON = []byte("[]")
	}

	checklistJSON, err := json.Marshal(buildChecklist(scoreResult2, metrics))
	if err != nil {
		log.Printf("[Pipeline] failed to marshal checklist for %s: %v", submissionID, err)
		checklistJSON = []byte("[]")
	}

	dbCtx, dbCancel := context.WithTimeout(context.Background(), 15*time.Second)
	err = p.subRepo.UpdateResultV2(dbCtx, submissionID, status,
		scoreResult2.TotalScore, totalWeight, passedCount, len(scoreResult2.Points),
		scoreResult2.CoreScore, scoreResult2.EdgeScore, scoreResult2.IsQualified,
		nil, nil, execTimePtr, nil, testPointsJSON, checklistJSON)
	dbCancel()
	if err != nil {
		log.Printf("[Pipeline] failed to update submission %s: %v", submissionID, err)
	}

	// Run reference trace diff in background (non-blocking)
	go p.runReferenceTrace(submissionID, exp, testResults, sub.Language)

	// Update student progress
	sub.Score = &scoreResult2.TotalScore
	totalScore := scoreResult2.TotalScore
	sub.TotalScore = &totalScore
	dbCtx2, dbCancel2 := context.WithTimeout(context.Background(), 15*time.Second)
	_ = p.subRepo.UpdateProgress(dbCtx2, sub)
	dbCancel2()

	// ── 10. Publish evaluation.completed event ──
	// TestPointResult aliases the shared model type, so the full detail
	// (actual/expected output and assertion breakdown) is published verbatim.
	testPointData := scoreResult2.Points

	// Deterministic AI-friendly resource summary (no LLM, no scoring).
	ebpfMetrics := BuildEBPFMetrics(straceSummaryData, obsCtx)

	p.publishCompletedV2(submissionID, experimentID, studentID,
		scoreResult2.TotalScore, passedCount, len(scoreResult2.Points),
		status, nil, nil, straceSummaryData, testResultsData, testPointData,
		scoreResult2.IsQualified, scoreResult2.CoreScore, scoreResult2.EdgeScore,
		obsContextJSON, ebpfMetrics)

	log.Printf("[Pipeline] v2 submission %s evaluated: score=%d/%d passed=%d/%d is_qualified=%v",
		submissionID, scoreResult2.TotalScore, totalWeight, passedCount, len(scoreResult2.Points), scoreResult2.IsQualified)

	return nil
}


var straceLineRe = regexp.MustCompile(`^(?:(\d+)\s+)?\d{2}:\d{2}:\d{2}\.\d+\s+(\w+)\(([^)]*)\)\s*=\s*(-?\d+|\?)\s*(?:<([\d.]+)>)?\s*(E\w+)?`)

// straceResumedRe matches "<... SYSCALL resumed>" continuation lines emitted by
// `strace -f` when a blocking syscall (wait4, futex, read, ...) spans multiple
// lines. Without it those syscalls are invisible to scoring.
var straceResumedRe = regexp.MustCompile(`^(?:(\d+)\s+)?\d{2}:\d{2}:\d{2}\.\d+\s+<\.\.\.\s+(\w+)\s+resumed>(.*)$`)

// retvalTailRe extracts "= retval <duration> [ERR]" from the tail of a resumed
// strace line (everything after "resumed>").
var retvalTailRe = regexp.MustCompile(`=\s*(-?\d+|\?)\s*(?:<([\d.]+)>)?\s*(E\w+)?\s*$`)

// straceLine represents one parsed strace output line
type straceLine struct {
	pid       int
	syscall   string
	args      string // raw argument string from strace output
	retVal    int64
	duration  float64
	errorName string
}


// syscallArgNames maps syscall names to their argument name lists (x86_64 ABI order).
var syscallArgNames = map[string][]string{
	"mmap":    {"addr", "len", "prot", "flags", "fd", "offset"},
	"munmap":  {"addr", "len"},
	"brk":     {"addr"},
	"mprotect":{"addr", "len", "prot"},
	"open":    {"path", "flags", "mode"},
	"openat":  {"dirfd", "path", "flags", "mode"},
	"read":    {"fd", "buf", "count"},
	"write":   {"fd", "buf", "count"},
	"close":   {"fd"},
	"lseek":   {"fd", "offset", "whence"},
	"fstat":   {"fd", "statbuf"},
	"stat":    {"path", "statbuf"},
	"access":  {"path", "mode"},
	"faccessat":{"dirfd", "path", "mode", "flags"},
	"pipe":    {"pipefd"},
	"pipe2":   {"pipefd", "flags"},
	"dup":     {"oldfd"},
	"dup2":    {"oldfd", "newfd"},
	"fcntl":   {"fd", "cmd", "arg"},
	"ioctl":   {"fd", "request", "arg"},
	"clone":   {"flags", "child_stack", "parent_tid", "child_tid", "tls"},
	"clone3":  {"args", "size"},
	"execve":  {"path", "argv", "envp"},
	"exit":    {"status"},
	"exit_group":{"status"},
	"wait4":   {"pid", "wstatus", "options", "rusage"},
	"nanosleep":{"req", "rem"},
	"futex":   {"uaddr", "op", "val", "timeout", "uaddr2", "val3"},
	"socket":  {"domain", "type", "protocol"},
	"bind":    {"sockfd", "addr", "addrlen"},
	"listen":  {"sockfd", "backlog"},
	"connect": {"sockfd", "addr", "addrlen"},
	"accept":  {"sockfd", "addr", "addrlen"},
	"accept4": {"sockfd", "addr", "addrlen", "flags"},
	"kill":    {"pid", "sig"},
	"prctl":   {"option", "arg2", "arg3", "arg4", "arg5"},
	"getpid":  {},
	"gettid":  {},
	"getuid":  {},
	"clock_gettime":{"clk_id", "tp"},
	"sched_yield":{},
	"sched_setaffinity":{"pid", "cpusetsize", "mask"},
	"sched_getaffinity":{"pid", "cpusetsize", "mask"},
	"set_robust_list":{"head", "len"},
	"get_robust_list":{"pid", "head", "len"},
	"shmget":  {"key", "size", "shmflg"},
	"shmat":   {"shmid", "shmaddr", "shmflg"},
	"shmdt":   {"shmaddr"},
	"semget":  {"key", "nsems", "semflg"},
	"semop":   {"semid", "sops", "nsops"},
	"semctl":  {"semid", "semnum", "cmd", "arg"},
}

// parseSyscallArgs splits raw strace args into named key-value pairs.
func parseSyscallArgs(syscallName, rawArgs string) map[string]interface{} {
	result := make(map[string]interface{})
	if rawArgs == "" {
		return result
	}
	parts := splitStraceArgs(rawArgs)
	known, ok := syscallArgNames[syscallName]
	if ok && len(known) > 0 {
		for i, name := range known {
			if i < len(parts) {
				result[name] = strings.TrimSpace(parts[i])
			}
		}
	}
	result["_raw"] = rawArgs
	return result
}

// splitStraceArgs splits on commas, respecting nested brackets/parens.
func splitStraceArgs(s string) []string {
	var parts []string
	depth := 0
	start := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '{', '[', '(':
			depth++
		case '}', ']', ')':
			depth--
		case ',':
			if depth == 0 {
				parts = append(parts, s[start:i])
				start = i + 1
			}
		}
	}
	if start < len(s) {
		parts = append(parts, s[start:])
	}
	return parts
}

func parseStraceLine(line string) *straceLine {
	line = strings.TrimSpace(line)

	// Normal syscall line: [PID ]ts SYSCALL(args) = retval <duration> [ERR]
	if m := straceLineRe.FindStringSubmatch(line); m != nil {
		return newStraceLine(m[1], m[2], m[3], m[4], m[5], m[6])
	}

	// Resumed syscall line (blocking syscall completed):
	// [PID ]ts <... SYSCALL resumed>ARGS) = retval <duration> [ERR]
	if m := straceResumedRe.FindStringSubmatch(line); m != nil {
		// m[1]=pid, m[2]=syscall, m[3]=tail after "resumed>"
		if tm := retvalTailRe.FindStringSubmatch(m[3]); tm != nil {
			return newStraceLine(m[1], m[2], m[3], tm[1], tm[2], tm[3])
		}
		return newStraceLine(m[1], m[2], m[3], "?", "", "")
	}
	return nil
}

// newStraceLine builds a straceLine from already-extracted regex submatches.
func newStraceLine(pidStr, name, args, retStr, durStr, errName string) *straceLine {
	pid, _ := strconv.Atoi(pidStr)
	retVal := int64(0)
	if retStr == "?" {
		retVal = -1
	} else if retStr != "" {
		retVal, _ = strconv.ParseInt(retStr, 10, 64)
	}
	dur := 0.0
	if durStr != "" {
		dur, _ = strconv.ParseFloat(durStr, 64)
	}
	return &straceLine{
		pid:       pid,
		syscall:   name,
		args:      args,
		retVal:    retVal,
		duration:  dur,
		errorName: errName,
	}
}

// collectAndStoreTraces reads strace output files, persists them to DB,
// and returns the trace records for analysis.
func (p *Pipeline) collectAndStoreTraces(submissionID string, binaryPath string, testResults []TestResult) []repository.SyscallTraceRecord {
	log.Printf("[Pipeline] collectAndStoreTraces for %s: %d test results", submissionID, len(testResults))
	var allTraces []repository.SyscallTraceRecord
	seenFiles := make(map[string]bool)

	for _, tr := range testResults {
		if tr.TraceFile == "" || seenFiles[tr.TraceFile] {
			continue
		}
		seenFiles[tr.TraceFile] = true

		data, err := os.ReadFile(tr.TraceFile)
		if err != nil {
			log.Printf("[Pipeline] failed to read trace file %s: %v", tr.TraceFile, err)
			continue
		}

		// Parse source line info from strace -k stack traces via addr2line
		sourceLineMap := ParseSourceLine(string(data), binaryPath)

		now := time.Now()
		firstSyscall := true
		for lineIdx, line := range strings.Split(string(data), "\n") {
			parsed := parseStraceLine(line)
			if parsed == nil || parsed.syscall == "" {
				continue
			}
			// Skip the harness's own execve that launches the binary. It is
			// always the first traced syscall and is not part of the student's
			// program, so it must not count toward syscall assertions.
			if firstSyscall && (parsed.syscall == "execve" || parsed.syscall == "execveat") {
				firstSyscall = false
				continue
			}
			firstSyscall = false
			record := repository.SyscallTraceRecord{
				Time:         now,
				SubmissionID: submissionID,
				PID:          parsed.pid,
				SyscallName:  parsed.syscall,
				Args:         parseSyscallArgs(parsed.syscall, parsed.args),
				ReturnValue:  parsed.retVal,
				ErrorName:    parsed.errorName,
				DurationNs:   int64(parsed.duration * 1e6),
			}
			if sl, ok := sourceLineMap[lineIdx]; ok && sl > 0 {
				record.SourceLine = &sl
			}
			allTraces = append(allTraces, record)
		}

		// Clean up trace file
		os.Remove(tr.TraceFile)
	}

	if len(allTraces) > 0 {
		// Use a detached context with timeout for trace insertion
		insertCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := p.subRepo.InsertSyscallTraces(insertCtx, allTraces); err != nil {
			log.Printf("[Pipeline] failed to insert syscall traces: %v", err)
		} else {
			log.Printf("[Pipeline] stored %d syscall traces for submission %s", len(allTraces), submissionID)
		}
	}

	return allTraces
}

func (p *Pipeline) updateStatus(ctx context.Context, submissionID, status string, compileErr, runtimeErr *string) {
	// Use a detached context with its own timeout for DB writes to avoid
	// being cancelled by the parent context (which may have a shorter deadline).
	// This ensures status updates are persisted even if the main context expires.
	detachedCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := p.subRepo.UpdateResult(detachedCtx, submissionID, status, 0, 0, 0, 0, compileErr, runtimeErr, nil, nil); err != nil {
		log.Printf("[Pipeline] failed to update submission %s: %v", submissionID, err)
	}
}

func (p *Pipeline) publishCompleted(submissionID, experimentID, studentID string, score, passedCases, totalCases int, status string, compileErr, runtimeErr *string) {
	p.publishCompletedWithTrace(submissionID, experimentID, studentID, score, passedCases, totalCases, status, compileErr, runtimeErr, nil, nil, nil)
}

// publishCompletedWithTrace publishes the evaluation.completed event including
// strace analysis data and test results for AI diagnosis.
func (p *Pipeline) publishCompletedWithTrace(submissionID, experimentID, studentID string, score, passedCases, totalCases int, status string, compileErr, runtimeErr *string, straceSummary *nats.StraceSummaryData, testResults []nats.TestResultData, obsContextJSON json.RawMessage) {
	if p.bus == nil {
		return
	}
	event := nats.EvaluationCompletedEvent{
		SubmissionID:  submissionID,
		ExperimentID:  experimentID,
		StudentID:     studentID,
		Score:         score,
		TotalScore:    score,
		PassedCases:   passedCases,
		TotalCases:    totalCases,
		Status:        status,
		CompileError:  compileErr,
		RuntimeError:  runtimeErr,
		StraceSummary: straceSummary,
		TestResults:   testResults,
		ObsContextJSON: obsContextJSON,
	}
	if err := nats.PublishEvaluationCompleted(p.bus, event); err != nil {
		log.Printf("[Pipeline] failed to publish evaluation.completed: %v", err)
	}
}

// publishCompletedV2 publishes the evaluation.completed event with v2 scoring fields.
func (p *Pipeline) publishCompletedV2(submissionID, experimentID, studentID string, score, passedCases, totalCases int, status string, compileErr, runtimeErr *string, straceSummary *nats.StraceSummaryData, testResults []nats.TestResultData, testPoints []nats.TestPointData, isQualified bool, coreScore, edgeScore int, obsContextJSON json.RawMessage, ebpfMetrics *nats.EBPFMetricsData) {
	if p.bus == nil {
		return
	}
	event := nats.EvaluationCompletedEvent{
		SubmissionID:   submissionID,
		ExperimentID:   experimentID,
		StudentID:      studentID,
		Score:          score,
		TotalScore:     score,
		PassedCases:    passedCases,
		TotalCases:     totalCases,
		Status:         status,
		CompileError:   compileErr,
		RuntimeError:   runtimeErr,
		StraceSummary:  straceSummary,
		TestResults:    testResults,
		IsQualified:    isQualified,
		CoreScore:      coreScore,
		EdgeScore:      edgeScore,
		TestPoints:     testPoints,
		ObsContextJSON: obsContextJSON,
		EBPFMetrics:    ebpfMetrics,
	}
	if err := nats.PublishEvaluationCompleted(p.bus, event); err != nil {
		log.Printf("[Pipeline] failed to publish evaluation.completed v2: %v", err)
	}
}

// ptrToStr converts *string to string, returning "" for nil.
func ptrToStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// evaluateWithoutTests handles experiments with no test cases.
// Scores based on compilation success and code quality.
func (p *Pipeline) evaluateWithoutTests(ctx context.Context, submissionID, experimentID, studentID string, sub *model.Submission, exp *model.Experiment, strategy ExperimentStrategy) {
	// Compile
	compileResult, err := p.compiler.Compile(ctx, sub.Code, sub.Language, strategy.CompileFlagsFor(sub.Language))
	if err != nil || !compileResult.Success {
		errMsg := "compilation failed"
		if compileResult != nil {
			errMsg = compileResult.Stderr
		}
		p.updateStatus(ctx, submissionID, "compile_error", &errMsg, nil)
		p.writeCompileChecklist(submissionID, errMsg)
		p.publishCompleted(submissionID, experimentID, studentID, 0, 0, 0, "compile_error", &errMsg, nil)
		return
	}
	defer os.RemoveAll(filepath.Dir(compileResult.BinaryPath))

	// Score based on compilation + strategy weights
	// Use detached context for DB writes
	hasCode := HasSubstantialCode(sub.Code)
	var totalScore int
	if hasCode {
		// Compilation succeeded + has real code → full structure + behavior + output credit
		outputScore := int(strategy.OutputWeight() * 100)
		structureScore := int(strategy.StructureWeight() * 100)
		behaviorScore := int(strategy.BehaviorWeight() * 100)
		totalScore = outputScore + structureScore + behaviorScore
		if totalScore > 100 {
			totalScore = 100
		}
	} else {
		totalScore = 0
	}

	dbCtx, dbCancel := context.WithTimeout(context.Background(), 15*time.Second)
	_ = p.subRepo.UpdateResult(dbCtx, submissionID, "completed", totalScore, 100, 0, 0, nil, nil, nil, nil)
	dbCancel()

	p.publishCompleted(submissionID, experimentID, studentID, totalScore, 0, 0, "completed", nil, nil)
}

// collectAndStoreMemoryLayouts derives memory-layout snapshots from the strace
// memory events (brk/mmap/munmap/mprotect) captured per test case and persists
// them to the memory_layouts table. It must run before collectAndStoreTraces,
// which removes the trace files.
func (p *Pipeline) collectAndStoreMemoryLayouts(submissionID string, testResults []TestResult) {
	var records []repository.MemoryLayoutRecord
	seenFiles := make(map[string]bool)
	baseTime := time.Now()
	var offset time.Duration

	for _, tr := range testResults {
		if tr.TraceFile == "" || seenFiles[tr.TraceFile] {
			continue
		}
		seenFiles[tr.TraceFile] = true

		data, err := os.ReadFile(tr.TraceFile)
		if err != nil {
			log.Printf("[Pipeline] failed to read trace file for memory layout %s: %v", tr.TraceFile, err)
			continue
		}

		// Derive incremental snapshots from the strace memory events. A nil
		// initial snapshot is used since the sandboxed process PID (and thus
		// its /proc/<pid>/maps) is not directly accessible from the pipeline.
		snapshots := CollectMemorySnapshots(nil, string(data))
		for _, snap := range snapshots {
			regions, err := json.Marshal(snap.MmapRegions)
			if err != nil {
				log.Printf("[Pipeline] marshal mmap_regions: %v", err)
				continue
			}
			ts := baseTime.Add(offset)
			offset += time.Millisecond
			records = append(records, repository.MemoryLayoutRecord{
				SubmissionID: submissionID,
				Timestamp:    ts,
				TextStart:    snap.TextStart,
				TextSize:     snap.TextSize,
				DataStart:    snap.DataStart,
				DataSize:     snap.DataSize,
				BSSStart:     snap.BSSStart,
				BSSSize:      snap.BSSSize,
				HeapStart:    snap.HeapStart,
				HeapSize:     snap.HeapSize,
				StackStart:   snap.StackStart,
				StackSize:    snap.StackSize,
				MmapRegions:  regions,
			})
		}
	}

	if len(records) == 0 {
		return
	}

	insertCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := p.subRepo.InsertMemoryLayouts(insertCtx, records); err != nil {
		log.Printf("[Pipeline] failed to insert memory layouts: %v", err)
	} else {
		log.Printf("[Pipeline] stored %d memory layout snapshots for submission %s", len(records), submissionID)
	}
}

// collectAndStoreResourceUsage derives resource usage metrics from test results
// and strace analysis, then persists them to the resource_usage table.
func (p *Pipeline) collectAndStoreResourceUsage(submissionID string, traceRecords []repository.SyscallTraceRecord, testResults []TestResult) {
	if len(testResults) == 0 {
		return
	}

	// Derive metrics from strace traces
	var fdCount, threadCount int
	var ioReadBytes, ioWriteBytes int64
	fdOpen := make(map[string]bool)
	for _, tr := range traceRecords {
		switch tr.SyscallName {
		case "open", "openat", "creat":
			fdOpen[fmt.Sprintf("%d_%d", tr.PID, tr.ReturnValue)] = true
		case "close":
			fdOpen[fmt.Sprintf("%d_%d", tr.PID, tr.ReturnValue)] = false
		case "clone", "fork":
			if tr.ReturnValue > 0 {
				threadCount++
			}
		case "read", "pread64":
			ioReadBytes += tr.ReturnValue
		case "write", "pwrite64":
			ioWriteBytes += tr.ReturnValue
		}
	}
	for _, open := range fdOpen {
		if open {
			fdCount++
		}
	}

	// Collect memory from the first test result that has it
	var totalMemory int64
	for _, tr := range testResults {
		if tr.MemoryUsage > 0 {
			totalMemory = tr.MemoryUsage
			break
		}
	}

	// Estimate CPU percent from total execution time
	var totalExecMs float64
	var cpuPercent float64
	for _, tr := range testResults {
		totalExecMs += float64(tr.ExecTime.Milliseconds())
	}
	if totalExecMs > 0 {
		// Normalize to 0-100 range: if execution took < 100ms, assume near 100% CPU
		cpuPercent = (totalExecMs / 1000) * 100
		if cpuPercent > 100 {
			cpuPercent = 100
		}
		if cpuPercent < 0 {
			cpuPercent = 0
		}
	}

	now := time.Now()
	records := []repository.ResourceUsageRecord{
		{
			SubmissionID:   submissionID,
			Time:           now,
			PID:            0,
			CPUPercent:     cpuPercent,
			MemoryBytes:    totalMemory,
			MemoryPercent:  0,
			DiskReadBytes:  ioReadBytes,
			DiskWriteBytes: ioWriteBytes,
		},
	}

	insertCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := p.subRepo.InsertResourceUsage(insertCtx, records); err != nil {
		log.Printf("[Pipeline] failed to insert resource_usage: %v", err)
	} else {
		log.Printf("[Pipeline] stored resource_usage for submission %s: cpu=%.1f%%, mem=%d, fd=%d, threads=%d, io_r=%d, io_w=%d",
			submissionID, cpuPercent, totalMemory, fdCount, threadCount, ioReadBytes, ioWriteBytes)
	}
}

// passedCount returns the number of passed test cases.
func passedCount(traceRecords []repository.SyscallTraceRecord, testResults []TestResult) int {
	count := 0
	for _, tr := range testResults {
		if tr.Passed {
			count++
		}
	}
	_ = traceRecords
	return count
}

func max(a, b int) int {
	if a > b { return a }
	return b
}

// runTestCasesEBPF runs all test cases with eBPF tracing.
// Returns trace records collected from BPF ring buffers and test results.
func (p *Pipeline) runTestCasesEBPF(ctx context.Context, submissionID, binaryPath string, testCases []model.TestCase, strategy ExperimentStrategy) ([]repository.SyscallTraceRecord, []TestResult, error) {
	level := sandbox.SandboxLevel(strategy.SandboxLevel())
	timeout := time.Duration(strategy.TimeLimit()) * time.Second

	results := make([]TestResult, len(testCases))
	tracesByIndex := make([][]repository.SyscallTraceRecord, len(testCases))

	sem := make(chan struct{}, maxParallelTests)
	var wg sync.WaitGroup

	for i, tc := range testCases {
		wg.Add(1)
		go func(i int, tc model.TestCase) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			result, err := p.ebpfAdapter.RunWithEBPF(
				ctx, binaryPath, []byte(tc.InputData), level, timeout, submissionID,
			)
			if err != nil {
				results[i] = TestResult{
					TestCaseID:   tc.ID,
					Name:         tc.Name,
					Passed:       false,
					ScoreWeight:  tc.ScoreWeight,
					RuntimeError: StrPtr(fmt.Sprintf("ebpf execution error: %v", err)),
				}
				return
			}

			// Compare output
			expectedOutput := normalizeEscapes(tc.ExpectedOutput)
			passed := strings.TrimSpace(result.Stdout) == strings.TrimSpace(expectedOutput)
			if strings.TrimSpace(expectedOutput) == "" {
				passed = result.ExitCode == strategy.ExitCodeRequired() && !result.Killed
			}

			results[i] = TestResult{
				TestCaseID:   tc.ID,
				Name:         tc.Name,
				Passed:       passed,
				ScoreWeight:  tc.ScoreWeight,
				ActualOutput: result.Stdout,
				ExecTime:     result.ExecTime,
				TraceFile:    "", // eBPF mode: no trace file
			}

			tracesByIndex[i] = result.TraceRecords
		}(i, tc)
	}

	wg.Wait()

	var allTraces []repository.SyscallTraceRecord
	for _, traces := range tracesByIndex {
		allTraces = append(allTraces, traces...)
	}

	return allTraces, results, nil
}

// buildChecklist derives a verification checklist from real evaluation evidence
// (score result + runtime behavior metrics). It never guesses: items without
// any applicable evidence are marked "unknown".
func buildChecklist(score *NewScoreResult, metrics *BehaviorMetrics) []model.ChecklistItem {
	items := make([]model.ChecklistItem, 0, 5)

	items = append(items, model.ChecklistItem{Key: "compile", Label: "代码通过编译", Status: "passed"})

	corePassed, coreTotal := 0, 0
	syscallAssertions := 0
	syscallFailed := false
	behaviorAssertions := 0
	behaviorFailed := false
	for _, tp := range score.Points {
		if normalizeType(tp.Type) == "core" {
			coreTotal++
			if tp.Passed {
				corePassed++
			}
		}
		for _, a := range tp.Assertions {
			switch a.Category {
			case "syscall":
				syscallAssertions++
				if !a.Passed {
					syscallFailed = true
				}
			case "behavior":
				behaviorAssertions++
				if !a.Passed {
					behaviorFailed = true
				}
			}
		}
	}

	if coreTotal > 0 {
		status := "passed"
		if !score.IsQualified {
			status = "failed"
		}
		items = append(items, model.ChecklistItem{
			Key:    "core",
			Label:  "核心功能正确",
			Status: status,
			Detail: fmt.Sprintf("%d/%d 核心测试点通过", corePassed, coreTotal),
		})
	} else {
		items = append(items, model.ChecklistItem{Key: "core", Label: "核心功能正确", Status: "unknown"})
	}

	if syscallAssertions > 0 {
		status := "passed"
		if syscallFailed {
			status = "failed"
		}
		items = append(items, model.ChecklistItem{Key: "syscall", Label: "系统调用符合要求", Status: status})
	} else {
		items = append(items, model.ChecklistItem{Key: "syscall", Label: "系统调用符合要求", Status: "unknown"})
	}

	if behaviorAssertions > 0 {
		status := "passed"
		if behaviorFailed {
			status = "failed"
		}
		items = append(items, model.ChecklistItem{Key: "behavior", Label: "运行时行为正常（无死锁/超时）", Status: status})
	} else if metrics.DeadlockDetected {
		items = append(items, model.ChecklistItem{Key: "behavior", Label: "运行时行为正常（无死锁/超时）", Status: "failed", Detail: "检测到死锁或超时"})
	} else {
		items = append(items, model.ChecklistItem{Key: "behavior", Label: "运行时行为正常（无死锁/超时）", Status: "unknown"})
	}

	leaks := make([]string, 0, 2)
	if metrics.HasFDLeak {
		leaks = append(leaks, fmt.Sprintf("文件描述符泄漏 %d 个", metrics.FDLeaked))
	}
	if metrics.HasZombies {
		leaks = append(leaks, "存在僵尸进程")
	}
	if len(leaks) > 0 {
		items = append(items, model.ChecklistItem{
			Key:    "resource",
			Label:  "资源无泄漏",
			Status: "failed",
			Detail: strings.Join(leaks, "；"),
		})
	} else {
		items = append(items, model.ChecklistItem{Key: "resource", Label: "资源无泄漏", Status: "passed"})
	}

	return items
}

// writeCompileChecklist records a compile-failure checklist entry for terminal
// compile_error states, which bypass the v2 scoring path.
func (p *Pipeline) writeCompileChecklist(submissionID, detail string) {
	checklist := []model.ChecklistItem{
		{Key: "compile", Label: "代码通过编译", Status: "failed", Detail: detail},
	}
	b, err := json.Marshal(checklist)
	if err != nil {
		return
	}
	detachedCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := p.subRepo.UpdateChecklist(detachedCtx, submissionID, b); err != nil {
		log.Printf("[Pipeline] failed to update checklist %s: %v", submissionID, err)
	}
}
