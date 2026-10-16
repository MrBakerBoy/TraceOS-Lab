package services

import (
	"crypto/md5"
	"fmt"
	"sort"
	"strings"
	"time"
)

// SpanBuilder constructs a hierarchical span tree from flat syscall sequences.
// Design reference: Jaeger Span naming conventions — pattern-based names, values in tags.
type SpanBuilder struct {
	templates map[string][]SpanTemplate
}

// SpanTemplate defines a recognizable span pattern for syscall grouping.
type SpanTemplate struct {
	Name    string   `json:"name"`
	Pattern []string `json:"pattern"`
	Tags    []string `json:"tags"`
	Parent  string   `json:"parent"`
}

// SpanNode represents a node in the span tree (Jaeger-compatible).
type SpanNode struct {
	SpanID        string            `json:"span_id"`
	ParentSpanID  string            `json:"parent_span_id,omitempty"`
	OperationName string            `json:"operation_name"`
	DurationMs    float64           `json:"duration_ms"`
	SyscallCount  int               `json:"syscall_count"`
	ErrorCount    int               `json:"error_count"`
	SelfTimeMs    float64           `json:"self_time_ms"`
	Tags          map[string]string `json:"tags,omitempty"`
	Children      []*SpanNode       `json:"children,omitempty"`
	StartTime     time.Time         `json:"start_time,omitempty"`
	EndTime       time.Time         `json:"end_time,omitempty"`
}

// SyscallRecord is a single syscall event with timing metadata.
type SyscallRecord struct {
	Name       string
	Timestamp  time.Time
	DurationNs int64
	PID        int
	TID        int
	ErrorName  string
	Args       map[string]string
}

// NewSpanBuilder creates a new span builder with all default templates.
func NewSpanBuilder() *SpanBuilder {
	return &SpanBuilder{
		templates: defaultSpanTemplates(),
	}
}

// BuildFromRecords constructs a span tree from detailed syscall records.
func (sb *SpanBuilder) BuildFromRecords(records []SyscallRecord) *SpanNode {
	if len(records) == 0 {
		return &SpanNode{
			SpanID:        "root",
			OperationName: "empty_trace",
			SyscallCount:  0,
		}
	}

	sort.Slice(records, func(i, j int) bool {
		return records[i].Timestamp.Before(records[j].Timestamp)
	})

	names := make([]string, len(records))
	for i, r := range records {
		names[i] = r.Name
	}

	root := &SpanNode{
		SpanID:        "root",
		OperationName: "program_execution",
		SyscallCount:  len(records),
		StartTime:     records[0].Timestamp,
		EndTime:       records[len(records)-1].Timestamp,
		Children:      make([]*SpanNode, 0),
	}

	if !root.StartTime.Equal(root.EndTime) {
		root.DurationMs = float64(root.EndTime.Sub(root.StartTime).Nanoseconds()) / 1e6
	}

	for _, r := range records {
		if r.ErrorName != "" {
			root.ErrorCount++
		}
	}

	categories := []string{"process", "ipc", "thread", "memory"}
	matched := make([]bool, len(records))

	for _, cat := range categories {
		tmpls, ok := sb.templates[cat]
		if !ok {
			continue
		}
		for _, tmpl := range tmpls {
			if tmpl.Parent != "" {
				continue
			}
			sb.matchTemplateInRecords(records, names, matched, root, tmpl)
		}
	}

	for i, r := range records {
		if !matched[i] {
			node := &SpanNode{
				SpanID:        fmt.Sprintf("syscall_%s_%d", r.Name, i),
				ParentSpanID:  root.SpanID,
				OperationName: r.Name,
				SyscallCount:  1,
				DurationMs:    float64(r.DurationNs) / 1e6,
				StartTime:     r.Timestamp,
				EndTime:       r.Timestamp.Add(time.Duration(r.DurationNs) * time.Nanosecond),
				Tags:          make(map[string]string),
			}
			if r.ErrorName != "" {
				node.ErrorCount = 1
			}
			node.Tags["syscall"] = r.Name
			node.Tags["pid"] = fmt.Sprintf("%d", r.PID)
			if r.TID > 0 {
				node.Tags["tid"] = fmt.Sprintf("%d", r.TID)
			}
			root.Children = append(root.Children, node)
		}
	}

	root.SelfTimeMs = root.DurationMs

	return root
}

// Build constructs a span tree from syscall names (backward compatible).
func (sb *SpanBuilder) Build(syscalls []string) *SpanNode {
	records := make([]SyscallRecord, len(syscalls))
	now := time.Now()
	for i, s := range syscalls {
		records[i] = SyscallRecord{
			Name:       s,
			Timestamp:  now.Add(time.Duration(i) * time.Millisecond),
			DurationNs: 1e6,
		}
	}
	return sb.BuildFromRecords(records)
}

func (sb *SpanBuilder) matchTemplateInRecords(
	records []SyscallRecord,
	names []string,
	matched []bool,
	parent *SpanNode,
	tmpl SpanTemplate,
) {
	for i := 0; i <= len(names)-len(tmpl.Pattern); i++ {
		if matched[i] {
			continue
		}
		if !sb.matchPatternAt(names, i, tmpl.Pattern) {
			continue
		}

		start := records[i].Timestamp
		endIdx := i + len(tmpl.Pattern) - 1
		end := records[endIdx].Timestamp.Add(
			time.Duration(records[endIdx].DurationNs) * time.Nanosecond)

		hashInput := fmt.Sprintf("%s_%d", tmpl.Name, i)
		spanID := fmt.Sprintf("%s_%x", tmpl.Name, md5.Sum([]byte(hashInput)))

		node := &SpanNode{
			SpanID:        spanID[:12],
			ParentSpanID:  parent.SpanID,
			OperationName: tmpl.Name,
			SyscallCount:  len(tmpl.Pattern),
			StartTime:     start,
			EndTime:       end,
			Tags:          make(map[string]string),
			Children:      make([]*SpanNode, 0),
		}

		node.DurationMs = float64(end.Sub(start).Nanoseconds()) / 1e6

		for j, recIdx := 0, i; j < len(tmpl.Pattern) && recIdx < len(records); j, recIdx = j+1, recIdx+1 {
			if records[recIdx].ErrorName != "" {
				node.ErrorCount++
			}
			for _, tagKey := range tmpl.Tags {
				if val, ok := records[recIdx].Args[tagKey]; ok {
					node.Tags[tagKey] = val
				}
			}
		}

		for j := 0; j < len(tmpl.Pattern); j++ {
			if i+j < len(matched) {
				matched[i+j] = true
			}
		}

		for _, childTemplates := range sb.templates {
			for _, childTmpl := range childTemplates {
				if childTmpl.Parent == tmpl.Name {
					childNames := names[i : i+len(tmpl.Pattern)]
					childMatched := make([]bool, len(childNames))
					childRecords := records[i : i+len(tmpl.Pattern)]
					sb.matchTemplateInRecords(childRecords, childNames, childMatched, node, childTmpl)
				}
			}
		}

		childrenSum := 0.0
		for _, c := range node.Children {
			childrenSum += c.DurationMs
		}
		node.SelfTimeMs = node.DurationMs - childrenSum
		if node.SelfTimeMs < 0 {
			node.SelfTimeMs = 0
		}

		parent.Children = append(parent.Children, node)
	}
}

func (sb *SpanBuilder) matchPatternAt(names []string, start int, pattern []string) bool {
	if start+len(pattern) > len(names) {
		return false
	}
	for j, p := range pattern {
		actual := names[start+j]
		if strings.HasPrefix(actual, p) {
			continue
		}
		if actual != p {
			return false
		}
	}
	return true
}

func defaultSpanTemplates() map[string][]SpanTemplate {
	return map[string][]SpanTemplate{
		"process": {
			{Name: "fork_exec_workflow", Pattern: []string{"clone", "execve"}, Tags: []string{"flags", "binary"}, Parent: ""},
			{Name: "parent_wait", Pattern: []string{"wait4", "exit"}, Tags: []string{"target_pid", "code"}, Parent: ""},
			{Name: "init_child", Pattern: []string{"open", "read", "close"}, Tags: []string{"fd", "path", "bytes"}, Parent: "fork_exec_workflow"},
			{Name: "process_setup", Pattern: []string{"prctl", "arch_prctl", "set_tid_address", "set_robust_list"}, Tags: []string{}, Parent: ""},
		},
		"thread": {
			{Name: "thread_create", Pattern: []string{"clone", "futex"}, Tags: []string{"flags", "child_tid", "futex_addr"}, Parent: ""},
			{Name: "critical_section", Pattern: []string{"futex", "futex"}, Tags: []string{"futex_addr"}, Parent: ""},
			{Name: "thread_teardown", Pattern: []string{"exit", "exit_group"}, Tags: []string{}, Parent: ""},
		},
		"memory": {
			{Name: "malloc_workflow", Pattern: []string{"brk", "mmap"}, Tags: []string{"size", "prot"}, Parent: ""},
			{Name: "free_workflow", Pattern: []string{"munmap", "brk"}, Tags: []string{"addr", "size"}, Parent: ""},
			{Name: "memory_protect", Pattern: []string{"mprotect"}, Tags: []string{"addr", "len", "prot"}, Parent: ""},
		},
		"ipc": {
			{Name: "pipe_communication", Pattern: []string{"pipe", "write", "read"}, Tags: []string{}, Parent: ""},
			{Name: "signal_delivery", Pattern: []string{"kill", "rt_sigaction"}, Tags: []string{"sig", "pid"}, Parent: ""},
			{Name: "shm_setup", Pattern: []string{"shmget", "shmat"}, Tags: []string{"key", "size", "shmflg"}, Parent: ""},
		},
	}
}
