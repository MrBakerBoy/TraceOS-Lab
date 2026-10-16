package evaluator

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/traceos-lab/core-service/internal/model"
)

// SyscallEvent represents a single syscall for trace diff comparison.
type TraceSyscallEvent struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
}

// TraceAlignedPair is one aligned element in the diff.
type TraceAlignedPair struct {
	Index     int                `json:"index"`
	Type      string             `json:"type"`
	Reference *TraceSyscallEvent `json:"reference,omitempty"`
	Student   *TraceSyscallEvent `json:"student,omitempty"`
	DiffNote  string             `json:"diff_note,omitempty"`
}

// TraceDiffStats contains summary statistics of the diff.
type TraceDiffStats struct {
	TotalReference int `json:"total_reference"`
	TotalStudent   int `json:"total_student"`
	Matches        int `json:"matches"`
	Mismatches     int `json:"mismatches"`
	Missing        int `json:"missing"`
	Extra          int `json:"extra"`
}

// TraceDiffResult stores the output of comparing two syscall traces.
type TraceDiffResult struct {
	AlignedPairs []TraceAlignedPair `json:"aligned_pairs"`
	Score        float64            `json:"score"`
	Stats        TraceDiffStats     `json:"stats"`
	Similarity   float64            `json:"similarity"`
}

// runReferenceTrace compiles and runs the reference solution with strace,
// then compares its syscall sequence with the student's stored traces.
func (p *Pipeline) runReferenceTrace(submissionID string, exp *model.Experiment, testResults []TestResult, lang string) {
	strategy := GetStrategy(exp.Category)

	// Look up the reference solution for the specific language from templates table
	var refCode string
	var refLang string
	if tpl, err := p.codeTemplateRepo.GetTemplate(context.Background(), exp.ID, lang); err == nil && tpl.ReferenceSolution != nil && *tpl.ReferenceSolution != "" {
		refCode = *tpl.ReferenceSolution
		refLang = lang
	} else if exp.ReferenceSolution != nil && *exp.ReferenceSolution != "" {
		refCode = *exp.ReferenceSolution
		refLang = "c"
	} else {
		return
	}

	compileResult, err := p.compiler.Compile(context.Background(), refCode, refLang, strategy.CompileFlagsFor(refLang))
	if err != nil || !compileResult.Success {
		return
	}
	defer os.RemoveAll(filepath.Dir(compileResult.BinaryPath))

	traceFile, err := os.CreateTemp("", "traceos-ref-strace-*.log")
	if err != nil {
		return
	}
	tracePath := traceFile.Name()
	traceFile.Close()
	defer os.Remove(tracePath)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "strace", "-tt", "-o", tracePath, compileResult.BinaryPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	_ = cmd.Run()

	data, err := os.ReadFile(tracePath)
	if err != nil {
		return
	}

	var refEvents []TraceSyscallEvent
	idx := 0
	for _, line := range strings.Split(string(data), "\n") {
		parsed := parseStraceLine(line)
		if parsed == nil || parsed.syscall == "" {
			continue
		}
		refEvents = append(refEvents, TraceSyscallEvent{Index: idx, Name: parsed.syscall})
		idx++
	}

	var stuEvents []TraceSyscallEvent
	for _, tr := range testResults {
		if tr.TraceFile == "" {
			continue
		}
		td, err := os.ReadFile(tr.TraceFile)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(td), "\n") {
			parsed := parseStraceLine(line)
			if parsed == nil || parsed.syscall == "" {
				continue
			}
			stuEvents = append(stuEvents, TraceSyscallEvent{Index: len(stuEvents), Name: parsed.syscall})
		}
	}

	if len(refEvents) == 0 && len(stuEvents) == 0 {
		return
	}

	diffResult := alignStraceTraces(refEvents, stuEvents)

	dbCtx, dbCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer dbCancel()
	diffJSON, _ := json.Marshal(diffResult)
	err = p.subRepo.StoreTraceDiff(dbCtx, submissionID, diffJSON)
	if err != nil {
		log.Printf("[TraceDiff] store diff: %v", err)
		return
	}
	log.Printf("[TraceDiff] stored diff for %s: similarity=%.1f%%, match=%d mismatch=%d missing=%d extra=%d",
		submissionID, diffResult.Similarity*100, diffResult.Stats.Matches,
		diffResult.Stats.Mismatches, diffResult.Stats.Missing, diffResult.Stats.Extra)
}

// alignStraceTraces performs Needleman-Wunsch global alignment of two syscall sequences.
func alignStraceTraces(ref, stu []TraceSyscallEvent) *TraceDiffResult {
	n, m := len(ref), len(stu)
	const (
		matchScore    = 2
		mismatchScore = -1
		gapPenalty    = -1
	)

	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
	}
	for i := 1; i <= n; i++ {
		dp[i][0] = dp[i-1][0] + gapPenalty
	}
	for j := 1; j <= m; j++ {
		dp[0][j] = dp[0][j-1] + gapPenalty
	}

	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			score := mismatchScore
			if ref[i-1].Name == stu[j-1].Name {
				score = matchScore
			}
			diag := dp[i-1][j-1] + score
			del := dp[i-1][j] + gapPenalty
			ins := dp[i][j-1] + gapPenalty
			dp[i][j] = max3Int(diag, del, ins)
		}
	}

	var pairs []TraceAlignedPair
	i, j := n, m
	for i > 0 || j > 0 {
		if i > 0 && j > 0 {
			s := mismatchScore
			if ref[i-1].Name == stu[j-1].Name {
				s = matchScore
			}
			if dp[i][j] == dp[i-1][j-1]+s {
				refEvt := ref[i-1]
				stuEvt := stu[j-1]
				pair := TraceAlignedPair{Index: len(pairs), Reference: &refEvt, Student: &stuEvt}
				if refEvt.Name == stuEvt.Name {
					pair.Type = "match"
				} else {
					pair.Type = "mismatch"
					pair.DiffNote = refEvt.Name + " -> " + stuEvt.Name
				}
				pairs = append(pairs, pair)
				i--
				j--
				continue
			}
		}
		if i > 0 && (j == 0 || dp[i][j] == dp[i-1][j]+gapPenalty) {
			refEvt := ref[i-1]
			pairs = append(pairs, TraceAlignedPair{
				Index: len(pairs), Type: "missing", Reference: &refEvt,
				DiffNote: "缺少: " + refEvt.Name,
			})
			i--
		} else {
			stuEvt := stu[j-1]
			pairs = append(pairs, TraceAlignedPair{
				Index: len(pairs), Type: "extra", Student: &stuEvt,
				DiffNote: "多余: " + stuEvt.Name,
			})
			j--
		}
	}

	// Reverse
	for left, right := 0, len(pairs)-1; left < right; left, right = left+1, right-1 {
		pairs[left], pairs[right] = pairs[right], pairs[left]
	}
	for k := range pairs {
		pairs[k].Index = k
	}

	stats := TraceDiffStats{TotalReference: n, TotalStudent: m}
	for _, p := range pairs {
		switch p.Type {
		case "match":
			stats.Matches++
		case "mismatch":
			stats.Mismatches++
		case "missing":
			stats.Missing++
		case "extra":
			stats.Extra++
		}
	}

	similarity := float64(0)
	if n+m > 0 {
		similarity = float64(stats.Matches*2) / float64(n+m)
	}

	return &TraceDiffResult{
		AlignedPairs: pairs,
		Score:        float64(dp[n][m]),
		Stats:        stats,
		Similarity:   similarity,
	}
}

func max3Int(a, b, c int) int {
	if a >= b && a >= c {
		return a
	}
	if b >= c {
		return b
	}
	return c
}
