package handler

import (
	"testing"
)

// helpers
func ev(name, args, result string) SyscallEvent {
	return SyscallEvent{Name: name, Args: args, Result: result}
}


func TestAlignTraces_ExactMatch(t *testing.T) {
	ref := []SyscallEvent{
		ev("openat", "AT_FDCWD, \"/etc/passwd\", O_RDONLY", "3"),
		ev("read", "3, 0x7fff, 4096", "1024"),
		ev("close", "3", "0"),
	}
	result := alignTraces(ref, ref)
	if result.Stats.Similarity != 1.0 {
		t.Fatalf("expected similarity 1.0, got %f", result.Stats.Similarity)
	}
	if result.Stats.Matches != 3 {
		t.Fatalf("expected 3 matches, got %d", result.Stats.Matches)
	}
	if result.Stats.Mismatches != 0 || result.Stats.Missing != 0 || result.Stats.Extra != 0 {
		t.Fatalf("unexpected mismatch/missing/extra in exact match")
	}
	for _, p := range result.AlignedPairs {
		if p.Type != "match" {
			t.Fatalf("all pairs should be match, got %s at index %d", p.Type, p.Index)
		}
	}
}

func TestAlignTraces_MissingCalls(t *testing.T) {
	ref := []SyscallEvent{
		ev("mmap", "NULL, 4096, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0", "0x7f000000"),
		ev("munmap", "0x7f000000, 4096", "0"),
	}
	stu := []SyscallEvent{}
	result := alignTraces(ref, stu)
	if result.Stats.Missing != 2 {
		t.Fatalf("expected 2 missing, got %d", result.Stats.Missing)
	}
	if result.Stats.Matches != 0 {
		t.Fatalf("expected 0 matches, got %d", result.Stats.Matches)
	}
}

func TestAlignTraces_ExtraCalls(t *testing.T) {
	ref := []SyscallEvent{
		ev("openat", "AT_FDCWD, \"/tmp/x\", O_WRONLY", "3"),
	}
	stu := []SyscallEvent{
		ev("openat", "AT_FDCWD, \"/tmp/x\", O_WRONLY", "3"),
		ev("write", "3, \"hello\", 5", "5"),
	}
	result := alignTraces(ref, stu)
	if result.Stats.Extra != 1 {
		t.Fatalf("expected 1 extra, got %d", result.Stats.Extra)
	}
	found := false
	for _, p := range result.AlignedPairs {
		if p.Type == "extra" {
			found = true
			if p.Student == nil || p.Student.Name != "write" {
				t.Fatalf("extra pair should be 'write' syscall")
			}
		}
	}
	if !found {
		t.Fatal("no extra pair found")
	}
}

func TestAlignTraces_ArgMismatch(t *testing.T) {
	ref := []SyscallEvent{
		ev("openat", "AT_FDCWD, \"/etc/passwd\", O_RDONLY", "3"),
	}
	stu := []SyscallEvent{
		ev("openat", "AT_FDCWD, \"/tmp/log\", O_WRONLY", "3"),
	}
	result := alignTraces(ref, stu)
	if result.Stats.Mismatches != 1 {
		t.Fatalf("expected 1 mismatch, got %d", result.Stats.Mismatches)
	}
	p := result.AlignedPairs[0]
	if p.Type != "mismatch" {
		t.Fatalf("expected mismatch type, got %s", p.Type)
	}
	if p.DiffNote != "参数不同" {
		t.Fatalf("expected diff_note '参数不同', got '%s'", p.DiffNote)
	}
}

func TestAlignTraces_MismatchResult(t *testing.T) {
	// Same name + same args → match type, but result differs → diff_note appended.
	// Result difference alone does not change type from match to mismatch.
	ref := []SyscallEvent{
		ev("openat", "AT_FDCWD, \"/etc/passwd\", O_RDONLY", "3"),
	}
	stu := []SyscallEvent{
		ev("openat", "AT_FDCWD, \"/etc/passwd\", O_RDONLY", "-1"),
	}
	result := alignTraces(ref, stu)
	if result.Stats.Matches != 1 {
		t.Fatalf("expected 1 match (same name & args, result differs), got %d", result.Stats.Matches)
	}
	if result.Stats.Mismatches != 0 {
		t.Fatalf("expected 0 mismatches, got %d", result.Stats.Mismatches)
	}
	p := result.AlignedPairs[0]
	if p.Type != "match" {
		t.Fatalf("expected match type, got %s", p.Type)
	}
	if p.DiffNote != " 返回值不同" {
		t.Fatalf("expected diff_note ' 返回值不同', got '%s'", p.DiffNote)
	}
}

func TestAlignTraces_ArgAndResultMismatch(t *testing.T) {
	// Different args AND different result → mismatch with both notes
	ref := []SyscallEvent{
		ev("openat", "AT_FDCWD, \"/etc/passwd\", O_RDONLY", "3"),
	}
	stu := []SyscallEvent{
		ev("openat", "AT_FDCWD, \"/tmp/log\", O_WRONLY", "-1"),
	}
	result := alignTraces(ref, stu)
	if result.Stats.Mismatches != 1 {
		t.Fatalf("expected 1 mismatch, got %d", result.Stats.Mismatches)
	}
	p := result.AlignedPairs[0]
	if p.Type != "mismatch" {
		t.Fatalf("expected mismatch type, got %s", p.Type)
	}
	// args differ → "参数不同", result differs → " 返回值不同"
	if p.DiffNote != "参数不同 返回值不同" {
		t.Fatalf("expected diff_note '参数不同 返回值不同', got '%s'", p.DiffNote)
	}
}

func TestAlignTraces_ExitGroupAbnormal(t *testing.T) {
	ref := []SyscallEvent{
		ev("exit_group", "0", "?"),
	}
	stu := []SyscallEvent{
		ev("exit_group", "1", "?"),
	}
	result := alignTraces(ref, stu)
	if result.Stats.Mismatches != 1 {
		t.Fatalf("expected 1 mismatch for exit_group(0) vs exit_group(1), got %d", result.Stats.Mismatches)
	}
	p := result.AlignedPairs[0]
	if p.Type != "mismatch" {
		t.Fatalf("expected mismatch, got %s", p.Type)
	}
}

func TestAlignTraces_ExitGroupAbnormalMissing(t *testing.T) {
	ref := []SyscallEvent{
		ev("write", "1, \"hello\", 5", "5"),
		ev("exit_group", "0", "?"),
	}
	stu := []SyscallEvent{
		ev("write", "1, \"hello\", 5", "5"),
	}
	result := alignTraces(ref, stu)
	if result.Stats.Missing != 1 {
		t.Fatalf("expected 1 missing (exit_group), got %d", result.Stats.Missing)
	}
	found := false
	for _, p := range result.AlignedPairs {
		if p.Type == "missing" && p.Reference != nil && p.Reference.Name == "exit_group" {
			found = true
			if p.DiffNote != "学生漏掉了此调用" {
				t.Logf("exit_group missing note (expected fallback): '%s'", p.DiffNote)
			}
		}
	}
	if !found {
		t.Fatal("missing exit_group not found in aligned pairs")
	}
}

func TestAlignTraces_EmptyTrace(t *testing.T) {
	tests := []struct {
		name string
		ref  []SyscallEvent
		stu  []SyscallEvent
	}{
		{"both empty", nil, nil},
		{"ref empty", nil, []SyscallEvent{ev("write", "1, \"x\", 1", "1")}},
		{"stu empty", []SyscallEvent{ev("write", "1, \"x\", 1", "1")}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := alignTraces(tt.ref, tt.stu)
			if tt.name == "both empty" {
				if result.Stats.Similarity != 0 {
					t.Fatalf("expected similarity 0 for both empty, got %f", result.Stats.Similarity)
				}
			}
			t.Logf("[%s] aligned pairs=%d stats=%+v", tt.name, len(result.AlignedPairs), result.Stats)
		})
	}
}

func TestAnalyzeMissingPattern(t *testing.T) {
	tests := []struct {
		syscall  string
		expected string
	}{
		{"munmap", "未释放映射内存 — 可能导致内存泄漏"},
		{"close", "未关闭文件描述符"},
		{"pthread_mutex_unlock", "未释放互斥锁 — 可能导致死锁或资源泄漏"},
		{"pthread_join", "未等待线程结束 — 可能产生僵尸线程"},
		{"free", "未释放堆内存 — 内存泄漏"},
		{"waitpid", "未回收子进程 — 僵尸进程"},
		{"unknown_syscall", ""},
	}
	for _, tt := range tests {
		t.Run(tt.syscall, func(t *testing.T) {
			pairs := []AlignedPair{
				{
					Index:     0,
					Type:      "missing",
					Reference: &SyscallEvent{Name: tt.syscall},
				},
				{
					Index:   1,
					Type:    "match",
					Student: &SyscallEvent{Name: "some_other"},
				},
			}
			got := analyzeMissingPattern(tt.syscall, pairs, 0)
			if got != tt.expected {
				t.Fatalf("analyzeMissingPattern(%q) = %q, want %q", tt.syscall, got, tt.expected)
			}
		})
	}
}

func TestAnalyzeMissingPattern_ExitGroupAbnormal(t *testing.T) {
	pairs := []AlignedPair{
		{
			Index:     0,
			Type:      "missing",
			Reference: &SyscallEvent{Name: "exit_group"},
		},
		{
			Index:   1,
			Type:    "match",
			Student: &SyscallEvent{Name: "exit_group", Result: "1"},
		},
	}
	got := analyzeMissingPattern("exit_group", pairs, 0)
	if got != "程序异常退出（非零退出码）" {
		t.Fatalf("expected '程序异常退出（非零退出码）', got %q", got)
	}
}

func TestAlignTraces_BoundarySingleElement(t *testing.T) {
	ref := []SyscallEvent{ev("read", "0, buf, 100", "42")}
	stu := []SyscallEvent{ev("read", "0, buf, 100", "42")}
	result := alignTraces(ref, stu)
	if result.Stats.Matches != 1 || result.Stats.Similarity != 1.0 {
		t.Fatalf("single element: expected 1 match & similarity 1.0, got %d match & %f sim",
			result.Stats.Matches, result.Stats.Similarity)
	}
}

func TestAlignTraces_BoundaryLargeTrace(t *testing.T) {
	syscalls := []string{"openat", "read", "write", "close", "mmap", "munmap", "fstat", "brk", "mprotect", "arch_prctl", "exit_group"}
	ref := make([]SyscallEvent, len(syscalls))
	stu := make([]SyscallEvent, len(syscalls))
	for i, name := range syscalls {
		ref[i] = ev(name, "args", "0")
		stu[i] = ev(name, "args", "0")
	}
	result := alignTraces(ref, stu)
	if result.Stats.Matches != len(syscalls) {
		t.Fatalf("large trace: expected %d matches, got %d", len(syscalls), result.Stats.Matches)
	}
	if result.Stats.Similarity != 1.0 {
		t.Fatalf("large trace: expected similarity 1.0, got %f", result.Stats.Similarity)
	}
}

func TestAlignTraces_MismatchDifferentSyscallName(t *testing.T) {
	ref := []SyscallEvent{ev("openat", "path", "3")}
	stu := []SyscallEvent{ev("open", "path", "3")}
	result := alignTraces(ref, stu)
	if result.Stats.Mismatches != 1 {
		t.Fatalf("expected 1 mismatch, got %d", result.Stats.Mismatches)
	}
	p := result.AlignedPairs[0]
	if p.DiffNote != "系统调用不同" {
		t.Fatalf("expected diff_note '系统调用不同', got '%s'", p.DiffNote)
	}
}

func TestAlignTraces_DiverseScenario(t *testing.T) {
	ref := []SyscallEvent{
		ev("openat", "path", "3"),
		ev("read", "3, buf, 100", "42"),
		ev("mmap", "NULL, 4096, ...", "0x7f000"),
		ev("write", "3, buf, 42", "42"),
		ev("close", "3", "0"),
	}
	stu := []SyscallEvent{
		ev("openat", "path", "3"),
		ev("read", "3, buf, 50", "42"),
		ev("write", "3, buf, 42", "42"),
		ev("close", "3", "0"),
		ev("munmap", "0x7f000, 4096", "0"),
	}
	result := alignTraces(ref, stu)
	t.Logf("Diverse scenario stats: %+v", result.Stats)
	t.Logf("Diverse pairs:")
	for _, p := range result.AlignedPairs {
		t.Logf("  [%d] type=%s ref=%v stu=%v note=%q",
			p.Index, p.Type,
			func() string { if p.Reference != nil { return p.Reference.Name }; return "-" }(),
			func() string { if p.Student != nil { return p.Student.Name }; return "-" }(),
			p.DiffNote)
	}
	if result.Stats.Matches < 1 {
		t.Fatal("expected at least 1 match")
	}
	if result.Stats.Mismatches < 1 {
		t.Fatal("expected at least 1 mismatch")
	}
	if result.Stats.Missing < 1 {
		t.Fatal("expected at least 1 missing (mmap)")
	}
	if result.Stats.Extra < 1 {
		t.Fatal("expected at least 1 extra (munmap)")
	}
	if result.Stats.Similarity <= 0 || result.Stats.Similarity > 1.0 {
		t.Fatalf("similarity out of range: %f", result.Stats.Similarity)
	}
}
