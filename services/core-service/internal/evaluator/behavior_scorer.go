package evaluator

// ═══════════════════════════════════════════════════════════════════════════════
// Deprecated: Behavior scoring is now handled per test point via
// behavior_assertions in the JSON assertion schema.
//
// ScoreBehavior() used incremental deductions based on strace analysis and
// trace diff similarity. The new approach binds behavior checks (FD leaks,
// deadlocks, zombies, syscall presence) directly to individual test points
// via the behavior_assertions field in expected_output JSON.
//
// Helper functions (syscallAliases, checkMissingSyscalls, checkForbiddenSyscalls,
// minInt) are retained as they are used by the old pipeline and may be useful
// for diagnostics.
// ═══════════════════════════════════════════════════════════════════════════════

import (
	"fmt"
	"strings"

	"github.com/traceos-lab/core-service/internal/nats"
)

// BehaviorScoreInput collects all evidence needed for behavior scoring.
type BehaviorScoreInput struct {
	StraceSummary    *nats.StraceSummaryData
	TraceSimilarity  float64
	ExpectedSyscalls  []string
	ForbiddenSyscalls []string
	ActualSyscallMap  map[string]int
	Category         string
	MaxScore         int
	AllPassed        bool
	PassedCount      int
	TotalCount       int
}

// BehaviorScoreResult holds the computed behavior score and details.
type BehaviorScoreResult struct {
	Score      int
	Deductions []Deduction
	Details    []string
}

// Deprecated: Use behavior_assertions in JSON assertion schema via EvaluateAssertions().
// ScoreBehavior evaluates runtime behavior from strace analysis and trace diff.
func ScoreBehavior(input BehaviorScoreInput) BehaviorScoreResult {
	if input.MaxScore <= 0 {
		return BehaviorScoreResult{Score: 0}
	}

	score := input.MaxScore
	var deductions []Deduction
	var details []string

	// 1. Syscall coverage: check expected syscalls
	if len(input.ExpectedSyscalls) > 0 {
		missing := checkMissingSyscalls(input.ExpectedSyscalls, input.ActualSyscallMap)
		if len(missing) > 0 {
			ratio := float64(len(missing)) / float64(len(input.ExpectedSyscalls))
			deduction := int(ratio * float64(input.MaxScore) * 0.4)
			if deduction < 1 {
				deduction = 1
			}
			score -= deduction
			deductions = append(deductions, Deduction{
				Type:   "missing_syscalls",
				Points: deduction,
				Reason: fmt.Sprintf("缺少期望的系统调用: %s", strings.Join(missing, ", ")),
			})
			details = append(details, fmt.Sprintf("missing_syscalls: %v", missing))
		} else {
			details = append(details, "all_expected_syscalls_present")
		}
	}

	// 2. Forbidden syscall check
	if len(input.ForbiddenSyscalls) > 0 {
		violations := checkForbiddenSyscalls(input.ForbiddenSyscalls, input.ActualSyscallMap)
		if len(violations) > 0 {
			deduction := minInt(len(violations)*3, input.MaxScore/3)
			score -= deduction
			deductions = append(deductions, Deduction{
				Type:   "forbidden_syscalls",
				Points: deduction,
				Reason: fmt.Sprintf("使用了被禁止的系统调用: %s", strings.Join(violations, ", ")),
			})
			details = append(details, fmt.Sprintf("forbidden_syscalls: %v", violations))
		}
	}

	// 3. Resource hygiene from strace summary
	if input.StraceSummary != nil {
		if input.StraceSummary.FDOpenClose != nil && input.StraceSummary.FDOpenClose.HasLeak {
			leaked := input.StraceSummary.FDOpenClose.Leaked
			deduction := minInt(leaked*2, input.MaxScore/4)
			score -= deduction
			deductions = append(deductions, Deduction{
				Type:   "fd_leak",
				Points: deduction,
				Reason: fmt.Sprintf("文件描述符泄漏: 打开%d次, 关闭%d次, 差异%d",
					input.StraceSummary.FDOpenClose.Opens,
					input.StraceSummary.FDOpenClose.Closes,
					leaked),
			})
			details = append(details, fmt.Sprintf("fd_leak: %d", leaked))
		}

		if (input.Category == "process" || input.Category == "deadlock") &&
			input.StraceSummary.ProcessOps != nil && input.StraceSummary.ProcessOps.HasZombies {
			deduction := minInt(5, input.MaxScore/5)
			score -= deduction
			deductions = append(deductions, Deduction{
				Type:   "zombie_risk",
				Points: deduction,
				Reason: input.StraceSummary.ProcessOps.Detail,
			})
			details = append(details, "zombie_risk")
		}

		if input.Category == "memory" &&
			input.StraceSummary.MemoryOps != nil && input.StraceSummary.MemoryOps.HasImbalance {
			deduction := minInt(8, input.MaxScore/4)
			score -= deduction
			deductions = append(deductions, Deduction{
				Type:   "memory_imbalance",
				Points: deduction,
				Reason: input.StraceSummary.MemoryOps.Detail,
			})
			details = append(details, "memory_imbalance")
		}

		for _, p := range input.StraceSummary.Patterns {
			if p.Severity == "high" {
				deduction := minInt(3, input.MaxScore/10)
				score -= deduction
				deductions = append(deductions, Deduction{
					Type:   p.Pattern,
					Points: deduction,
					Reason: p.Description,
				})
				details = append(details, fmt.Sprintf("pattern_%s", p.Pattern))
			}
		}
	}

	// 4. Trace diff similarity
	if input.TraceSimilarity > 0 {
		if input.TraceSimilarity < 0.3 {
			deduction := int((1.0 - input.TraceSimilarity) * float64(input.MaxScore) * 0.3)
			score -= deduction
			deductions = append(deductions, Deduction{
				Type:   "trace_mismatch",
				Points: deduction,
				Reason: fmt.Sprintf("系统调用序列与参考答案差异较大 (相似度: %.0f%%)", input.TraceSimilarity*100),
			})
			details = append(details, fmt.Sprintf("trace_similarity_low: %.2f", input.TraceSimilarity))
		} else {
			details = append(details, fmt.Sprintf("trace_similarity_ok: %.2f", input.TraceSimilarity))
		}
	}

	if score < 0 {
		score = 0
	}
	if score > input.MaxScore {
		score = input.MaxScore
	}

	return BehaviorScoreResult{
		Score:      score,
		Deductions: deductions,
		Details:    details,
	}
}

func checkMissingSyscalls(expected []string, actual map[string]int) []string {
	var missing []string
	for _, name := range expected {
		found := false
		for _, alias := range syscallAliases(name) {
			if actual[alias] > 0 {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, name)
		}
	}
	return missing
}

func syscallAliases(name string) []string {
	switch name {
	case "clone":
		return []string{"clone", "clone3", "fork", "vfork"}
	case "fork":
		return []string{"fork", "vfork", "clone", "clone3"}
	case "wait4":
		return []string{"wait4", "waitpid", "waitid"}
	case "waitpid":
		return []string{"wait4", "waitpid", "waitid"}
	case "brk":
		return []string{"brk", "mmap", "mmap2"}
	case "mmap":
		return []string{"mmap", "mmap2", "brk"}
	case "munmap":
		return []string{"munmap"}
	case "openat":
		return []string{"openat", "open", "creat"}
	case "read":
		return []string{"read", "readv", "pread64"}
	case "write":
		return []string{"write", "writev", "pwrite64"}
	case "close":
		return []string{"close"}
	case "futex":
		return []string{"futex", "futex_time64"}
	case "execve":
		return []string{"execve", "execveat"}
	default:
		return []string{name}
	}
}

func checkForbiddenSyscalls(forbidden []string, actual map[string]int) []string {
	var violations []string
	for _, name := range forbidden {
		for _, alias := range syscallAliases(name) {
			if actual[alias] > 0 {
				violations = append(violations, name)
				break
			}
		}
	}
	return violations
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
