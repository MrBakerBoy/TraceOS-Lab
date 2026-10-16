package collector

import "testing"

func TestExtract_FdLeak(t *testing.T) {
	events := []SyscallEvent{
		{SyscallName: "openat", ReturnValue: 3},
		{SyscallName: "read", ReturnValue: 5},
		// No close(3) -> leak
	}

	ext := NewFeatureExtractor()
	features := ext.Extract(events)

	if len(features.FdLeaks) != 1 {
		t.Errorf("FdLeaks = %d, want 1", len(features.FdLeaks))
	}
	if features.FdLeaks[0].FD != 3 {
		t.Errorf("leaked FD = %d, want 3", features.FdLeaks[0].FD)
	}
}

func TestExtract_NoFdLeak(t *testing.T) {
	events := []SyscallEvent{
		{SyscallName: "openat", ReturnValue: 3},
		{SyscallName: "close", ReturnValue: 3},
	}

	ext := NewFeatureExtractor()
	features := ext.Extract(events)

	if len(features.FdLeaks) != 0 {
		t.Errorf("FdLeaks = %d, want 0", len(features.FdLeaks))
	}
}

func TestExtract_DeadlockRisk(t *testing.T) {
	events := []SyscallEvent{
		{SyscallName: "futex", ReturnValue: 0},
	}
	ext := NewFeatureExtractor()
	features := ext.Extract(events)
	if !features.HasDeadlockRisk {
		t.Error("should detect deadlock risk from futex")
	}
}

func TestExtract_MemLeakRisk(t *testing.T) {
	events := []SyscallEvent{
		{SyscallName: "mmap", ReturnValue: 100},
		{SyscallName: "mmap", ReturnValue: 200},
		{SyscallName: "mmap", ReturnValue: 300},
		{SyscallName: "mmap", ReturnValue: 400},
		{SyscallName: "mmap", ReturnValue: 500},
		// Only 1 munmap
		{SyscallName: "munmap", ReturnValue: 0},
	}
	ext := NewFeatureExtractor()
	features := ext.Extract(events)
	if !features.HasMemLeakRisk {
		t.Error("should detect memory leak risk")
	}
}

func TestGenerateSummary(t *testing.T) {
	events := []SyscallEvent{
		{SyscallName: "openat", ReturnValue: 3},
		{SyscallName: "openat", ReturnValue: -1, ErrorName: "ENOENT"},
	}
	ext := NewFeatureExtractor()
	features := ext.Extract(events)
	summary := ext.GenerateSummary(events, features)

	if summary == "" {
		t.Error("summary should not be empty")
	}
}
