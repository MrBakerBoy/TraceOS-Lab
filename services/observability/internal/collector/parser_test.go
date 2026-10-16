package collector

import (
	"os"
	"testing"
)

func TestParse_SampleFile(t *testing.T) {
	data, err := os.ReadFile("testdata/strace_sample.log")
	if err != nil {
		t.Fatalf("read testdata: %v", err)
	}

	parser := NewStraceParser()
	events := parser.Parse(string(data))

	if len(events) < 5 {
		t.Errorf("expected >= 5 events, got %d", len(events))
	}

	// Check first event
	if events[0].SyscallName != "openat" {
		t.Errorf("first event syscall = %q, want openat", events[0].SyscallName)
	}
	if events[0].ReturnValue != 3 {
		t.Errorf("first event return = %d, want 3", events[0].ReturnValue)
	}
}

func TestParse_ErrorReturn(t *testing.T) {
	content := `1234  10:00:00.100000 openat(AT_FDCWD, "missing.txt", O_RDONLY) = -1 ENOENT <0.000010>`
	parser := NewStraceParser()
	events := parser.Parse(content)

	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].ReturnValue != -1 {
		t.Errorf("return value = %d, want -1", events[0].ReturnValue)
	}
	if events[0].ErrorName != "ENOENT" {
		t.Errorf("error name = %q, want ENOENT", events[0].ErrorName)
	}
}

func TestBuildSummary(t *testing.T) {
	events := []SyscallEvent{
		{SyscallName: "openat", ReturnValue: 3},
		{SyscallName: "read", ReturnValue: 5},
		{SyscallName: "openat", ReturnValue: -1, ErrorName: "ENOENT"},
		{SyscallName: "write", ReturnValue: 5},
	}

	summary := BuildSummary(events)
	if summary.TotalSyscalls != 4 {
		t.Errorf("TotalSyscalls = %d, want 4", summary.TotalSyscalls)
	}
	if summary.ErrorCount != 1 {
		t.Errorf("ErrorCount = %d, want 1", summary.ErrorCount)
	}
	if summary.UniqueSyscalls != 3 {
		t.Errorf("UniqueSyscalls = %d, want 3", summary.UniqueSyscalls)
	}
}
