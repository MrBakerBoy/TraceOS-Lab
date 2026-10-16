package evaluator

import (
	"strings"
	"testing"
	"time"

	"github.com/traceos-lab/core-service/internal/repository"
)

func makeTrace(syscall string, retVal int64, errName string) repository.SyscallTraceRecord {
	return repository.SyscallTraceRecord{
		Time:        time.Now(),
		PID:         12345,
		SyscallName: syscall,
		ReturnValue: retVal,
		ErrorName:   errName,
		DurationNs:  1000,
	}
}

func TestAnalyzeStraceTraces_Empty(t *testing.T) {
	result := AnalyzeStraceTraces(nil)
	if result.TotalSyscalls != 0 {
		t.Error("empty traces should have 0 total")
	}

	result = AnalyzeStraceTraces([]repository.SyscallTraceRecord{})
	if result.TotalSyscalls != 0 {
		t.Error("empty slice should have 0 total")
	}
}

func TestAnalyzeStraceTraces_FDLeak(t *testing.T) {
	traces := []repository.SyscallTraceRecord{
		makeTrace("openat", 3, ""),
		makeTrace("openat", 4, ""),
		makeTrace("read", 5, ""),
		makeTrace("write", 5, ""),
		// Only 1 close for 2 opens
		makeTrace("close", 0, ""),
	}

	result := AnalyzeStraceTraces(traces)
	if result == nil {
		t.Fatal("result should not be nil")
	}

	if result.FDOpenClose == nil {
		t.Fatal("FDOpenClose should not be nil")
	}
	if !result.FDOpenClose.HasLeak {
		t.Error("should detect FD leak: 2 opens, 1 close")
	}
	if result.FDOpenClose.Leaked != 1 {
		t.Errorf("Leaked = %d, want 1", result.FDOpenClose.Leaked)
	}

	// Verify pattern was detected
	found := false
	for _, p := range result.Patterns {
		if p.Pattern == "fd_leak" {
			found = true
			break
		}
	}
	if !found {
		t.Error("fd_leak pattern not in result.Patterns")
	}

	// Verify human-readable summary
	if !strings.Contains(result.HumanReadable, "fd") || !strings.Contains(result.HumanReadable, "泄漏") {
		t.Errorf("HumanReadable should mention fd leak: %s", result.HumanReadable)
	}
}

func TestAnalyzeStraceTraces_NoFDLeak(t *testing.T) {
	traces := []repository.SyscallTraceRecord{
		makeTrace("openat", 3, ""),
		makeTrace("openat", 4, ""),
		makeTrace("close", 0, ""),
		makeTrace("close", 0, ""),
	}

	result := AnalyzeStraceTraces(traces)
	if result.FDOpenClose.HasLeak {
		t.Error("should NOT detect FD leak when opens == closes")
	}
}

func TestAnalyzeStraceTraces_MemoryImbalance(t *testing.T) {
	// 18 allocations vs 1 free. The >15 absolute-imbalance threshold exists
	// to filter out the dynamic linker's normal ~10-15 startup mmap regions
	// that are never munmapped; 18 vs 1 exceeds it and must be flagged.
	traces := make([]repository.SyscallTraceRecord, 0, 19)
	for i := 0; i < 18; i++ {
		traces = append(traces, makeTrace("mmap", 0x7f000000+int64(i*0x1000), ""))
	}
	traces = append(traces, makeTrace("munmap", 0, ""))

	result := AnalyzeStraceTraces(traces)
	if result.MemoryOps == nil {
		t.Fatal("MemoryOps should not be nil")
	}
	if result.MemoryOps.AllocCalls != 18 {
		t.Errorf("AllocCalls = %d, want 18", result.MemoryOps.AllocCalls)
	}
	if result.MemoryOps.FreeCalls != 1 {
		t.Errorf("FreeCalls = %d, want 1", result.MemoryOps.FreeCalls)
	}
	if !result.MemoryOps.HasImbalance {
		t.Error("should detect memory imbalance: 18 allocs, 1 free")
	}
}

func TestAnalyzeStraceTraces_ZombieRisk(t *testing.T) {
	traces := []repository.SyscallTraceRecord{
		makeTrace("fork", 67890, ""),
		makeTrace("fork", 67891, ""),
		// No wait calls
		makeTrace("exit_group", 0, ""),
	}

	result := AnalyzeStraceTraces(traces)
	if result.ProcessOps == nil {
		t.Fatal("ProcessOps should not be nil")
	}
	if !result.ProcessOps.HasZombies {
		t.Error("should detect zombie risk: 2 forks, 0 waits")
	}

	// Verify pattern
	found := false
	for _, p := range result.Patterns {
		if p.Pattern == "zombie_process" {
			found = true
			if p.Severity != "high" {
				t.Errorf("zombie_process severity should be 'high', got %s", p.Severity)
			}
			break
		}
	}
	if !found {
		t.Error("zombie_process pattern not detected")
	}
}

func TestAnalyzeStraceTraces_NoZombie(t *testing.T) {
	traces := []repository.SyscallTraceRecord{
		makeTrace("fork", 67890, ""),
		makeTrace("wait4", 0, ""),
		makeTrace("exit_group", 0, ""),
	}

	result := AnalyzeStraceTraces(traces)
	if result.ProcessOps.HasZombies {
		t.Error("should NOT detect zombie when fork==wait")
	}
}

func TestAnalyzeStraceTraces_ErrorSyscalls(t *testing.T) {
	traces := []repository.SyscallTraceRecord{
		makeTrace("openat", -1, "ENOENT"),
		makeTrace("openat", -1, "ENOENT"),
		makeTrace("write", -1, "EACCES"),
		makeTrace("read", 5, ""),
		makeTrace("close", 0, ""),
	}

	result := AnalyzeStraceTraces(traces)
	if result.ErrorSyscalls != 3 {
		t.Errorf("ErrorSyscalls = %d, want 3", result.ErrorSyscalls)
	}
	if result.TotalSyscalls != 5 {
		t.Errorf("TotalSyscalls = %d, want 5", result.TotalSyscalls)
	}
	if result.UniqueSyscalls != 4 {
		t.Errorf("UniqueSyscalls = %d, want 4 (openat/write/read/close)", result.UniqueSyscalls)
	}

	// Check top errors
	if len(result.TopErrors) == 0 {
		t.Fatal("should have top errors")
	}
}

func TestAnalyzeStraceTraces_SegfaultPattern(t *testing.T) {
	traces := []repository.SyscallTraceRecord{
		makeTrace("write", -1, "EFAULT"),
		makeTrace("read", -1, "EINVAL"),
		makeTrace("close", -1, "EFAULT"),
	}

	result := AnalyzeStraceTraces(traces)

	found := false
	for _, p := range result.Patterns {
		if p.Pattern == "segfault_risk" {
			found = true
			if p.Count != 3 {
				t.Errorf("segfault count = %d, want 3", p.Count)
			}
			break
		}
	}
	if !found {
		t.Error("segfault_risk pattern not detected")
	}
}

func TestAnalyzeStraceTraces_TopSyscalls(t *testing.T) {
	traces := []repository.SyscallTraceRecord{
		makeTrace("read", 1, ""),
		makeTrace("read", 2, ""),
		makeTrace("read", 3, ""),
		makeTrace("write", 1, ""),
		makeTrace("write", 2, ""),
		makeTrace("close", 0, ""),
	}

	result := AnalyzeStraceTraces(traces)
	if len(result.TopSyscalls) < 3 {
		t.Fatalf("should have 3 top syscalls, got %d", len(result.TopSyscalls))
	}
	if result.TopSyscalls[0].Name != "read" {
		t.Errorf("top syscall should be 'read', got %s", result.TopSyscalls[0].Name)
	}
	if result.TopSyscalls[0].Count != 3 {
		t.Errorf("read count = %d, want 3", result.TopSyscalls[0].Count)
	}
}

func TestAnalyzeStraceTraces_HumanReadable(t *testing.T) {
	traces := []repository.SyscallTraceRecord{
		makeTrace("fork", 67890, ""),
		makeTrace("openat", 3, ""),
		makeTrace("openat", 4, ""),
		makeTrace("close", 0, ""),
		makeTrace("write", -1, "EACCES"),
	}

	result := AnalyzeStraceTraces(traces)
	hr := result.HumanReadable

	// Should contain key information
	checks := []string{
		"系统调用轨迹分析",
		"总计",
		"fork",
		"openat",
		"close",
		"EACCES",
		"fd", // fd balance
		"僵尸", // zombie risk
	}

	for _, check := range checks {
		if !strings.Contains(strings.ToLower(hr), strings.ToLower(check)) {
			t.Errorf("HumanReadable missing '%s':\n%s", check, hr)
		}
	}
}
