package evaluator

// ═══════════════════════════════════════════════════════════════════════════════
// Deprecated: Use NewScore() in new_scorer.go instead.
//
// Score() and ScoreWithTrace() use the old tripartite formula
// (output + structure + behavior) which produced inflated scores for
// low-quality code. The new scoring pipeline uses JSON assertion rules
// stored in test_cases.expected_output, evaluated per test point with
// weighted accumulation and is_qualified based on core pass/fail.
// ═══════════════════════════════════════════════════════════════════════════════

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/traceos-lab/core-service/internal/nats"
)

// Deprecated: Use NewScore() in new_scorer.go instead.
// Score calculates the final score based on test results and strategy.
// behaviorScore and structureScore are optional (-1 means compute internally).
func Score(testResults []TestResult, strategy ExperimentStrategy, code string,
	behaviorScore int, structureScore int) *ScoreResult {
	total := len(testResults)
	if total == 0 {
		return &ScoreResult{TotalScore: 0, PassedCases: 0, TotalCases: 0}
	}

	passed := 0
	totalWeight := 0
	passedWeight := 0
	for _, tr := range testResults {
		w := tr.ScoreWeight
		if w <= 0 { w = 20 }
		totalWeight += w
		if tr.Passed {
			passed++
			passedWeight += w
		}
	}

	hasRealCode := hasSubstantialCode(code)
	outputMax := int(strategy.OutputWeight() * 100)
	structureMax := int(strategy.StructureWeight() * 100)
	behaviorMax := int(strategy.BehaviorWeight() * 100)

	// ── All tests passed ──
	if passed == total {
		if !hasRealCode {
			structureScoreVal := structureMax / 2
			if structureScore >= 0 { structureScoreVal = structureScore / 2 }
			return &ScoreResult{
				TotalScore:     structureScoreVal,
				OutputScore:    0,
				StructureScore: structureScoreVal,
				BehaviorScore:  0,
				PassedCases:    passed, TotalCases: total,
				Passed:     false,
				Deductions: []Deduction{{
					Type: "no_code", Points: 100 - structureScoreVal,
					Reason: "测试全部通过但未编写核心代码，请补充实验内容",
				}},
			}
		}

		outputScore := outputMax
		structureScoreVal := structureMax
		behaviorScoreVal := behaviorMax
		if structureScore >= 0 { structureScoreVal = structureScore }
		if behaviorScore >= 0 { behaviorScoreVal = behaviorScore }
		totalScore := outputScore + structureScoreVal + behaviorScoreVal
		if totalScore > 100 { totalScore = 100 }
		return &ScoreResult{
			TotalScore:     totalScore,
			OutputScore:    outputScore,
			StructureScore: structureScoreVal,
			BehaviorScore:  behaviorScoreVal,
			PassedCases:    passed, TotalCases: total,
			Passed: true,
		}
	}

	// ── No tests passed ──
	if passed == 0 {
		if !hasRealCode {
			return &ScoreResult{
				TotalScore: 0, OutputScore: 0,
				PassedCases: 0, TotalCases: total, Passed: false,
				Deductions: []Deduction{{Type: "no_code", Points: 100, Reason: "未编写核心代码，实验不通过"}},
			}
		}
		hasOutput := false
		for _, tr := range testResults {
			if tr.ActualOutput != "" || tr.ExitCode == 0 { hasOutput = true; break }
		}
		if hasOutput {
			structureScoreVal := structureMax
			if structureScore >= 0 { structureScoreVal = structureScore }
			return &ScoreResult{
				TotalScore:     structureScoreVal,
				OutputScore:    0,
				StructureScore: structureScoreVal,
				BehaviorScore:  0,
				PassedCases: 0, TotalCases: total, Passed: false,
				Deductions: []Deduction{{Type: "all_failed", Points: 100 - structureScoreVal,
					Reason: "测试用例未通过，但代码结构合理，请继续完善"}},
			}
		}
		return &ScoreResult{
			TotalScore: 0, OutputScore: 0,
			PassedCases: 0, TotalCases: total, Passed: false,
			Deductions: []Deduction{{Type: "all_failed", Points: 100, Reason: "所有测试用例未通过"}},
		}
	}

	// ── Partial passes ──
	weightedPassRate := float64(passedWeight) / float64(totalWeight)
	outputScore := int(weightedPassRate * float64(outputMax))

	var structureScoreVal int
	if hasRealCode {
		structureScoreVal = structureMax
	}
	if structureScore >= 0 { structureScoreVal = structureScore }

	var behaviorScoreVal int
	if behaviorScore >= 0 {
		behaviorScoreVal = behaviorScore
	} else if hasRealCode {
		behaviorScoreVal = int((0.5*weightedPassRate + 0.5) * float64(behaviorMax))
	} else {
		behaviorScoreVal = int(weightedPassRate * float64(behaviorMax))
	}

	var deductions []Deduction
	for _, tr := range testResults {
		if tr.Passed { continue }
		w := tr.ScoreWeight
		if w <= 0 { w = 20 }
		deduction := int(float64(w) / float64(totalWeight) * float64(outputMax))
		if deduction < 1 { deduction = 1 }
		deductions = append(deductions, Deduction{
			Type: "failed_test", Points: deduction,
			Reason: fmt.Sprintf("测试「%s」未通过", tr.Name),
		})
	}

	totalScore := outputScore + structureScoreVal + behaviorScoreVal
	if totalScore > 100 { totalScore = 100 }
	if totalScore < 0 { totalScore = 0 }

	passed2 := totalScore >= 60 && hasRealCode

	return &ScoreResult{
		TotalScore:     totalScore,
		OutputScore:    outputScore,
		StructureScore: structureScoreVal,
		BehaviorScore:  behaviorScoreVal,
		PassedCases:    passed, TotalCases: total,
		Deductions: deductions, Passed: passed2,
	}
}

// Deprecated: No longer used in the v2 scoring pipeline.
// HasSubstantialCode exposes the internal check.
func HasSubstantialCode(code string) bool { return hasSubstantialCode(code) }

func hasSubstantialCode(code string) bool {
	code = strings.TrimSpace(code)
	if code == "" { return false }
	codeUpper := strings.ToUpper(code)
	startTag := "CODE START"
	endTag := "CODE END"
	allEmpty := true
	foundAny := false
	remaining := codeUpper
	for {
		si := strings.Index(remaining, startTag)
		if si < 0 { break }
		afterStart := remaining[si+len(startTag):]
		ei := strings.Index(afterStart, endTag)
		if ei < 0 { break }
		body := strings.TrimSpace(afterStart[:ei])
		if idx := strings.Index(body, "*/"); idx >= 0 { body = body[idx+2:] }
		if idx := strings.LastIndex(body, "/*"); idx >= 0 { body = body[:idx] }
		body = strings.TrimSpace(body)
		foundAny = true
		if hasRealContent(body) { allEmpty = false; break }
		remaining = afterStart[ei+len(endTag):]
	}
	if foundAny && allEmpty { return false }

	lines := strings.Split(code, "\n")
	var realLines []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#include") ||
			strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "/*") ||
			(strings.HasPrefix(trimmed, "*") && !strings.HasPrefix(trimmed, "*=")) {
			continue
		}
		realLines = append(realLines, trimmed)
	}
	if len(realLines) < 1 { return false }

	joined := strings.Join(realLines, " ")
	joined = strings.ReplaceAll(joined, " ", "")
	joined = strings.ReplaceAll(joined, "\t", "")
	joined = strings.ReplaceAll(joined, "{", "")
	joined = strings.ReplaceAll(joined, "}", "")
	joined = strings.ReplaceAll(joined, "(", "")
	joined = strings.ReplaceAll(joined, ")", "")
	joined = strings.ReplaceAll(joined, ";", "")

	trivialPatterns := []string{
		"intmainreturn0", "intmain(void)return0", "intmain()return0",
		"intmain()return1", "intmainreturn1", "intmainreturn-1",
		"intmain()return-1",
		"intmainreturnEXIT_SUCCESS", "intmain()returnEXIT_SUCCESS",
	}
	for _, p := range trivialPatterns {
		if strings.Contains(joined, p) && len(joined)-len(p) < 30 { return false }
	}

	if !strings.Contains(code, "(") || !strings.Contains(code, ")") { return false }

	count := 0
	if hasOperator(realLines) { count++ }
	if hasControlFlow(realLines) { count++ }
	if hasSyscallPattern(code) { count++ }
	return count >= 1
}

func hasOperator(lines []string) bool {
	full := strings.Join(lines, "\n")
	for _, op := range []string{"=", "+", "-", "*", "/", "&&", "||", "==", "!=", "<", ">", "&", "|", "^", "<<"} {
		if strings.Contains(full, op) { return true }
	}
	return false
}

func hasControlFlow(lines []string) bool {
	full := strings.Join(lines, "\n")
	for _, kw := range []string{"if", "for", "while", "switch", "case", "goto"} {
		if containsWord(full, kw) { return true }
	}
	return false
}

func hasSyscallPattern(code string) bool {
	for _, p := range []string{
		"fork(", "exec", "wait(", "pipe(", "signal(", "kill(",
		"pthread_", "mutex_", "sem_", "cond_",
		"malloc(", "free(", "mmap(", "brk(", "sbrk(",
		"open(", "read(", "write(", "close(", "stat(", "lseek(", "fsync(",
		"sched_", "nice(", "getpriority(", "setpriority(",
		// Common libc calls that signal real logic even without syscalls/operators.
		"printf(", "scanf(", "fprintf(", "sprintf(", "snprintf(",
		"puts(", "fputs(", "fgets(", "getchar(", "putchar(",
		"strcpy(", "strncpy(", "strcmp(", "strlen(", "strcat(",
		"memcpy(", "memset(", "atoi(", "atof(", "qsort(",
	} {
		if strings.Contains(code, p) { return true }
	}
	return false
}

func containsWord(text, word string) bool {
	idx := 0
	for {
		pos := strings.Index(text[idx:], word)
		if pos < 0 { return false }
		absPos := idx + pos
		isBefore := absPos > 0 && (unicode.IsLetter(rune(text[absPos-1])) ||
			unicode.IsDigit(rune(text[absPos-1])) || text[absPos-1] == '_')
		isAfter := absPos+len(word) < len(text) &&
			(unicode.IsLetter(rune(text[absPos+len(word)])) ||
			 unicode.IsDigit(rune(text[absPos+len(word)])) ||
			 text[absPos+len(word)] == '_')
		if !isBefore && !isAfter { return true }
		idx = absPos + 1
	}
}

func hasRealContent(body string) bool {
	for _, line := range strings.Split(body, "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "//") ||
			strings.HasPrefix(t, "TODO") || strings.HasPrefix(t, "todo") {
			continue
		}
		return true
	}
	return false
}

// Deprecated: Use NewScore() in new_scorer.go instead.
// ScoreWithTrace extends Score by incorporating strace analysis for behavior scoring.
// When behaviorScore is already computed externally, this acts as a passthrough.
func ScoreWithTrace(testResults []TestResult, strategy ExperimentStrategy, code string,
	straceSummary *nats.StraceSummaryData, behaviorScore int, structureScore int) *ScoreResult {
	result := Score(testResults, strategy, code, behaviorScore, structureScore)

	// If no external behavior score and we have strace data, apply legacy bonus/penalty
	if behaviorScore < 0 && straceSummary != nil && len(straceSummary.Patterns) > 0 {
		behaviorBonus := 0
		for _, p := range straceSummary.Patterns {
			if p.Severity == "high" { behaviorBonus -= 5 }
			if p.Severity == "medium" { behaviorBonus -= 2 }
		}
		result.BehaviorScore += behaviorBonus
		if result.BehaviorScore < 0 { result.BehaviorScore = 0 }
		result.TotalScore += behaviorBonus
		if result.TotalScore < 0 { result.TotalScore = 0 }
		if result.TotalScore > 100 { result.TotalScore = 100 }
	}
	return result
}
