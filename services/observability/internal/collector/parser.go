package collector

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// SyscallEvent represents a single parsed strace event.
type SyscallEvent struct {
	Timestamp   time.Time         `json:"timestamp"`
	PID         int               `json:"pid"`
	TID         int               `json:"tid"`
	SyscallName string            `json:"syscall_name"`
	Args        map[string]string `json:"args"`
	ReturnValue int64             `json:"return_value"`
	ErrorCode   int               `json:"error_code"`
	ErrorName   string            `json:"error_name"`
	DurationNs  int64             `json:"duration_ns"`
}

// TraceSummary holds aggregate statistics.
type TraceSummary struct {
	TotalSyscalls  int            `json:"total_syscalls"`
	UniqueSyscalls int            `json:"unique_syscalls"`
	ErrorCount     int            `json:"error_count"`
	ErrorTypes     map[string]int `json:"error_types"`
	TopSyscalls    []SyscallCount `json:"top_syscalls"`
}

// SyscallCount pairs a syscall name with its count.
type SyscallCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// StraceParser parses strace output into structured events.
type StraceParser struct{}

// NewStraceParser creates a new parser.
func NewStraceParser() *StraceParser {
	return &StraceParser{}
}

// strace line format: PID  TIMESTAMP SYSCALL(ARGS) = RETURN <DURATION>
var straceRe = regexp.MustCompile(
	`^(\d+)\s+(\d+:\d+:\d+\.\d+)\s+(\w+)\(([^)]*)\)\s*=\s*(-?\d+|\?)\s*(<[\d.]+>|E\w+)?\s*(\(.*\))?$`,
)

// errorReturnRe matches "= -1 ENOENT (message)" pattern.
var errorReturnRe = regexp.MustCompile(`^-1\s+(\w+)`)

// Parse parses strace output content into events.
func (p *StraceParser) Parse(content string) []SyscallEvent {
	var events []SyscallEvent

	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		m := straceRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}

		pid, _ := strconv.Atoi(m[1])
		retVal, _ := strconv.ParseInt(m[5], 10, 64)

		event := SyscallEvent{
			PID:         pid,
			TID:         pid, // same unless multi-threaded
			SyscallName: m[3],
			ReturnValue: retVal,
		}

		// Parse timestamp
		if ts, err := time.Parse("15:04:05.000000", m[2]); err == nil {
			event.Timestamp = ts
		}

		// Check for error
		if retVal == -1 {
			em := errorReturnRe.FindStringSubmatch(m[5])
			if em != nil {
				event.ErrorName = em[1]
			}
		}

		events = append(events, event)
	}

	return events
}

// BuildSummary computes aggregate statistics from events.
func BuildSummary(events []SyscallEvent) TraceSummary {
	summary := TraceSummary{
		ErrorTypes: make(map[string]int),
	}

	nameCounts := make(map[string]int)
	uniqueSet := make(map[string]bool)

	for _, e := range events {
		summary.TotalSyscalls++
		nameCounts[e.SyscallName]++
		uniqueSet[e.SyscallName] = true
		if e.ReturnValue == -1 || e.ErrorName != "" {
			summary.ErrorCount++
			if e.ErrorName != "" {
				summary.ErrorTypes[e.ErrorName]++
			}
		}
	}

	summary.UniqueSyscalls = len(uniqueSet)

	// Build top syscalls
	for name, count := range nameCounts {
		summary.TopSyscalls = append(summary.TopSyscalls, SyscallCount{Name: name, Count: count})
	}

	// Sort by count descending (simple bubble for small lists)
	for i := 0; i < len(summary.TopSyscalls); i++ {
		for j := i + 1; j < len(summary.TopSyscalls); j++ {
			if summary.TopSyscalls[j].Count > summary.TopSyscalls[i].Count {
				summary.TopSyscalls[i], summary.TopSyscalls[j] = summary.TopSyscalls[j], summary.TopSyscalls[i]
			}
		}
	}

	return summary
}
