package handler

import (
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
)

// TraceDiffHandler handles syscall trace diff endpoints.
type TraceDiffHandler struct{}

// NewTraceDiffHandler creates a new trace diff handler.
func NewTraceDiffHandler() *TraceDiffHandler {
	return &TraceDiffHandler{}
}

// SyscallEvent represents a single syscall in a trace.
type SyscallEvent struct {
	Index    int    `json:"index"`
	Name     string `json:"name"`
	Args     string `json:"args"`
	Result   string `json:"result"`
	Duration string `json:"duration,omitempty"`
}

// DiffResult represents the result of comparing two syscall traces.
type DiffResult struct {
	AlignedPairs []AlignedPair  `json:"aligned_pairs"`
	Score        float64        `json:"score"`
	Stats        DiffStats      `json:"stats"`
}

// AlignedPair is one aligned element in the diff.
type AlignedPair struct {
	Index     int           `json:"index"`
	Type      string        `json:"type"` // match, mismatch, missing, extra
	Reference *SyscallEvent `json:"reference,omitempty"`
	Student   *SyscallEvent `json:"student,omitempty"`
	DiffNote  string        `json:"diff_note,omitempty"`
}

// DiffStats contains summary statistics of the diff.
type DiffStats struct {
	TotalReference int     `json:"total_reference"`
	TotalStudent   int     `json:"total_student"`
	Matches        int     `json:"matches"`
	Mismatches     int     `json:"mismatches"`
	Missing        int     `json:"missing"`
	Extra          int     `json:"extra"`
	Similarity     float64 `json:"similarity"`
}

// CompareTraces performs Needleman-Wunsch alignment on two syscall traces.
// POST /api/v1/traces/diff
func (h *TraceDiffHandler) CompareTraces(c *gin.Context) {
	var req struct {
		ReferenceTrace []SyscallEvent `json:"reference_trace" binding:"required"`
		StudentTrace   []SyscallEvent `json:"student_trace" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result := alignTraces(req.ReferenceTrace, req.StudentTrace)
	c.JSON(http.StatusOK, result)
}

// alignTraces performs Needleman-Wunsch sequence alignment on syscall names.
func alignTraces(ref, stu []SyscallEvent) *DiffResult {
	n := len(ref)
	m := len(stu)

	// Scoring
	const (
		matchScore    = 2
		mismatchScore = -1
		gapPenalty    = -1
	)

	// Build score matrix
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, m+1)
	}

	// Initialize
	for i := 1; i <= n; i++ {
		dp[i][0] = dp[i-1][0] + gapPenalty
	}
	for j := 1; j <= m; j++ {
		dp[0][j] = dp[0][j-1] + gapPenalty
	}

	// Fill
	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			score := mismatchScore
			if ref[i-1].Name == stu[j-1].Name {
				score = matchScore
				// Bonus for matching args
				if ref[i-1].Args == stu[j-1].Args {
					score += 1
				}
			}
			match := dp[i-1][j-1] + score
			del := dp[i-1][j] + gapPenalty
			ins := dp[i][j-1] + gapPenalty
			dp[i][j] = max3(match, del, ins)
		}
	}

	// Traceback
	var pairs []AlignedPair
	i, j := n, m
	idx := 0
	for i > 0 || j > 0 {
		if i > 0 && j > 0 {
			score := mismatchScore
			if ref[i-1].Name == stu[j-1].Name {
				score = matchScore
				if ref[i-1].Args == stu[j-1].Args {
					score += 1
				}
			}
			if dp[i][j] == dp[i-1][j-1]+score {
				refEvt := ref[i-1]
				stuEvt := stu[j-1]
				refEvt.Index = idx
				stuEvt.Index = idx
				pair := AlignedPair{
					Index:     idx,
					Reference: &refEvt,
					Student:   &stuEvt,
				}
				if refEvt.Name == stuEvt.Name {
					pair.Type = "match"
					if refEvt.Args != stuEvt.Args {
						pair.Type = "mismatch"
						pair.DiffNote = "参数不同"
					}
					if refEvt.Result != stuEvt.Result {
						pair.DiffNote += " 返回值不同"
					}
				} else {
					pair.Type = "mismatch"
					pair.DiffNote = "系统调用不同"
				}
				pairs = append(pairs, pair)
				i--
				j--
				idx++
				continue
			}
		}

		if i > 0 && (j == 0 || dp[i][j] == dp[i-1][j]+gapPenalty) {
			refEvt := ref[i-1]
			refEvt.Index = idx
			pairs = append(pairs, AlignedPair{
				Index:     idx,
				Type:      "missing",
				Reference: &refEvt,
				DiffNote:  "学生漏掉了此调用",
			})
			i--
			idx++
		} else {
			stuEvt := stu[j-1]
			stuEvt.Index = idx
			pairs = append(pairs, AlignedPair{
				Index:   idx,
				Type:    "extra",
				Student: &stuEvt,
				DiffNote: "学生多了此调用",
			})
			j--
			idx++
		}
	}

	// Reverse to get forward order
	for left, right := 0, len(pairs)-1; left < right; left, right = left+1, right-1 {
		pairs[left], pairs[right] = pairs[right], pairs[left]
	}
	for i := range pairs {
		pairs[i].Index = i
	}

	// Stats
	stats := DiffStats{
		TotalReference: n,
		TotalStudent:   m,
	}
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
	if n+m > 0 {
		stats.Similarity = float64(stats.Matches*2) / float64(n+m)
	}

	// Generate human-readable notes for common patterns
	for i := range pairs {
		if pairs[i].DiffNote == "" && pairs[i].Type == "missing" && pairs[i].Reference != nil {
			ref := pairs[i].Reference
			note := analyzeMissingPattern(ref.Name, pairs, i)
			pairs[i].DiffNote = note
		}
	}

	// Sort by index
	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].Index < pairs[j].Index
	})

	return &DiffResult{
		AlignedPairs: pairs,
		Score:        float64(dp[n][m]),
		Stats:        stats,
	}
}

func analyzeMissingPattern(name string, pairs []AlignedPair, pos int) string {
	switch name {
	case "munmap":
		return "未释放映射内存 — 可能导致内存泄漏"
	case "close":
		return "未关闭文件描述符"
	case "pthread_mutex_unlock":
		return "未释放互斥锁 — 可能导致死锁或资源泄漏"
	case "pthread_join":
		return "未等待线程结束 — 可能产生僵尸线程"
	case "free":
		return "未释放堆内存 — 内存泄漏"
	case "waitpid":
		return "未回收子进程 — 僵尸进程"
	case "exit_group":
		if pos < len(pairs)-1 {
			next := pairs[pos+1]
			if next.Student != nil && next.Student.Name == "exit_group" && next.Student.Result != "0" {
				return "程序异常退出（非零退出码）"
			}
		}
	}
	return ""
}

func max3(a, b, c int) int {
	if a >= b && a >= c {
		return a
	}
	if b >= c {
		return b
	}
	return c
}
