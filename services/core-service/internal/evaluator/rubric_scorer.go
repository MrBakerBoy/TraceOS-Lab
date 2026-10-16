package evaluator

// ═══════════════════════════════════════════════════════════════════════════════
// Deprecated: Concept rubric scoring is replaced by per-test-point JSON
// assertion rules (see assertion.go).
//
// ScoreRubric() evaluated code quality via concept rubrics and atomic criteria.
// The new approach moves all evaluable checks into structured JSON assertions
// in test_cases.expected_output. AI diagnosis may still consume rubric data
// for generating teaching feedback, but it no longer participates in scoring.
// ═══════════════════════════════════════════════════════════════════════════════

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// RubricData is the parsed rubric JSON from experiment_rubrics table.
type RubricData struct {
	Category        string                    `json:"category"`
	Dimensions      map[string]RubricDimension `json:"dimensions,omitempty"`
	ConceptRubrics  []ConceptRubric            `json:"concept_rubrics,omitempty"`
	HardFailRules   []string                  `json:"hard_fail_rules,omitempty"`
}

// RubricDimension is a v2-style scoring dimension.
type RubricDimension struct {
	Weight      float64 `json:"weight"`
	Description string  `json:"description"`
}

// ConceptRubric is a v1-style atomic concept rubric.
type ConceptRubric struct {
	Concept        string          `json:"concept"`
	Weight         float64         `json:"weight"`
	AtomicCriteria []string        `json:"atomic_criteria"`
	EvidenceMapping map[string]string `json:"evidence_mapping"`
	ScoringScale   string          `json:"scoring_scale"`
	ScaleAnchors   map[string]string `json:"scale_anchors"`
}

// RubricScoreInput is the evidence for rubric evaluation.
type RubricScoreInput struct {
	RubricJSON       []byte          // raw JSON from DB
	Code             string
	ActualSyscallMap map[string]int
	TestPassRate     float64 // 0.0–1.0
	MaxScore         int
}

// RubricScoreResult is the computed rubric score.
type RubricScoreResult struct {
	Score      int
	Deductions []Deduction
	Details    []string
}

// Deprecated: Use assertion-based scoring via EvaluateAssertions() in assertion.go.
// ScoreRubric evaluates concept rubrics against code and runtime evidence.
func ScoreRubric(input RubricScoreInput) RubricScoreResult {
	if input.MaxScore <= 0 {
		return RubricScoreResult{Score: 0}
	}

	var rubric RubricData
	if err := json.Unmarshal(input.RubricJSON, &rubric); err != nil || (len(rubric.Dimensions) == 0 && len(rubric.ConceptRubrics) == 0) {
		// Fallback: use test pass rate for structure score
		score := int(input.TestPassRate * float64(input.MaxScore))
		return RubricScoreResult{
			Score:   score,
			Details: []string{"rubric_fallback_passrate"},
		}
	}

	// v2 format: dimensions-based
	if len(rubric.Dimensions) > 0 {
		return scoreByDimensions(input, rubric)
	}

	// v1 format: concept_rubrics-based
	if len(rubric.ConceptRubrics) > 0 {
		return scoreByConcepts(input, rubric)
	}

	return RubricScoreResult{Score: 0}
}

func scoreByDimensions(input RubricScoreInput, rubric RubricData) RubricScoreResult {
	totalWeight := 0.0
	weightedScore := 0.0
	var details []string

	for dimName, dim := range rubric.Dimensions {
		totalWeight += dim.Weight
		dimScore := evaluateDimension(dimName, dim.Description, input)
		weightedScore += dimScore * dim.Weight
		details = append(details, fmt.Sprintf("dim_%s: %.1f", dimName, dimScore))
	}

	if totalWeight > 0 {
		weightedScore /= totalWeight
	}

	score := int(weightedScore * float64(input.MaxScore))
	if score > input.MaxScore {
		score = input.MaxScore
	}
	if score < 0 {
		score = 0
	}

	return RubricScoreResult{Score: score, Details: details}
}

func evaluateDimension(name, description string, input RubricScoreInput) float64 {
	switch name {
	case "functionality":
		// Driven by test pass rate
		return input.TestPassRate
	case "syscall_coverage":
		// Check if expected syscalls for the category are present
		return evaluateSyscallCoverage(description, input.ActualSyscallMap)
	case "resource_quality":
		// Based on code structure (hasSubstantialCode as proxy)
		if hasSubstantialCode(input.Code) {
			return 1.0
		}
		return 0.3
	case "ai_code_quality":
		// Code has substance check
		if hasSubstantialCode(input.Code) {
			return 1.0
		}
		return 0.3
	default:
		return input.TestPassRate
	}
}

func evaluateSyscallCoverage(description string, actual map[string]int) float64 {
	// Extract expected syscall names from the description
	// e.g. "Expected syscalls: fork,wait,exit,getpid,getppid,execvp,pipe,dup2,sigaction"
	re := regexp.MustCompile(`(?i)expected\s+syscalls?\s*:?\s*(.+)`)
	m := re.FindStringSubmatch(description)
	if m == nil {
		return 1.0 // no specific expectations, full credit
	}

	expected := strings.Split(m[1], ",")
	if len(expected) == 0 {
		return 1.0
	}

	covered := 0
	for _, exp := range expected {
		exp = strings.TrimSpace(exp)
		for _, alias := range syscallAliases(exp) {
			if actual[alias] > 0 {
				covered++
				break
			}
		}
	}

	return float64(covered) / float64(len(expected))
}

func scoreByConcepts(input RubricScoreInput, rubric RubricData) RubricScoreResult {
	totalWeight := 0.0
	weightedScore := 0.0
	var details []string

	for _, concept := range rubric.ConceptRubrics {
		totalWeight += concept.Weight
		conceptScore := evaluateConcept(concept, input)
		weightedScore += conceptScore * concept.Weight
		details = append(details, fmt.Sprintf("concept_%s: %.1f", concept.Concept, conceptScore))
	}

	if totalWeight > 0 {
		weightedScore /= totalWeight
	}

	score := int(weightedScore * float64(input.MaxScore))
	if score > input.MaxScore {
		score = input.MaxScore
	}
	if score < 0 {
		score = 0
	}

	return RubricScoreResult{Score: score, Details: details}
}

func evaluateConcept(concept ConceptRubric, input RubricScoreInput) float64 {
	if len(concept.AtomicCriteria) == 0 {
		return 1.0
	}

	met := 0
	for _, criterion := range concept.AtomicCriteria {
		if evaluateCriterion(criterion, input.Code, input.ActualSyscallMap) {
			met++
		}
	}

	ratio := float64(met) / float64(len(concept.AtomicCriteria))

	// Map to 3-point scale: 0/1/2 → 0.0/0.5/1.0
	switch {
	case ratio >= 0.8:
		return 1.0
	case ratio >= 0.4:
		return 0.5
	default:
		return 0.0
	}
}

func evaluateCriterion(criterion, code string, syscallMap map[string]int) bool {
	cLower := strings.ToLower(criterion)

	// Check code-level patterns
	codePatterns := map[string]string{
		"fork":    `\bfork\s*\(`,
		"wait":    `\bwait\s*\(|\bwaitpid\s*\(`,
		"exec":    `\bexec[lv]p?e?\s*\(`,
		"pipe":    `\bpipe\s*\(|\bpipe2\s*\(`,
		"signal":  `\bsignal\s*\(|\bsigaction\s*\(`,
		"mutex":   `\bpthread_mutex_`,
		"thread":  `\bpthread_create\s*\(`,
		"malloc":  `\bmalloc\s*\(|\bcalloc\s*\(`,
		"free":    `\bfree\s*\(`,
		"mmap":    `\bmmap\s*\(`,
		"open":    `\bopen\s*\(|\bopenat\s*\(`,
		"read":    `\bread\s*\(`,
		"write":   `\bwrite\s*\(`,
		"close":   `\bclose\s*\(`,
		"setsid":  `\bsetsid\s*\(`,
		"chdir":   `\bchdir\s*\(`,
		"dup2":    `\bdup2?\s*\(`,
		"kill":    `\bkill\s*\(`,
		"socket":  `\bsocket\s*\(`,
	}

	for keyword, pattern := range codePatterns {
		if strings.Contains(cLower, keyword) {
			re := regexp.MustCompile(pattern)
			if re.MatchString(code) {
				return true
			}
		}
	}

	// Check syscall-level patterns
	syscallMappings := map[string][]string{
		"fork":     {"fork", "vfork", "clone", "clone3"},
		"clone":    {"clone", "clone3", "fork", "vfork"},
		"wait":     {"wait4", "waitpid", "waitid"},
		"execve":   {"execve", "execveat"},
		"pipe":     {"pipe", "pipe2"},
		"mmap":     {"mmap", "mmap2"},
		"open":     {"open", "openat", "creat"},
		"read":     {"read", "readv", "pread64"},
		"write":    {"write", "writev", "pwrite64"},
		"close":    {"close"},
		"futex":    {"futex", "futex_time64"},
		"setsid":   {"setsid"},
		"dup2":     {"dup2", "dup", "dup3"},
		"kill":     {"kill", "tkill", "tgkill"},
		"socket":   {"socket", "socketpair"},
		"brk":      {"brk"},
		"munmap":   {"munmap"},
		"sigaction": {"rt_sigaction", "sigaction"},
	}

	for keyword, syscalls := range syscallMappings {
		if strings.Contains(cLower, keyword) {
			for _, sc := range syscalls {
				if syscallMap[sc] > 0 {
					return true
				}
			}
		}
	}

	// Generic check: if criterion mentions "strace 中" and we have syscall data
	if strings.Contains(cLower, "strace") {
		for _, sc := range []string{"clone", "fork", "vfork", "wait4", "waitpid", "execve", "pipe", "pipe2"} {
			if syscallMap[sc] > 0 {
				return true
			}
		}
	}

	return false
}
