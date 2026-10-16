package evaluator

import (
	"fmt"
	"sort"
	"strings"

	"github.com/traceos-lab/core-service/internal/repository"
)

// ── Detection patterns ──────────────────────────────────────────────────────

// TracePattern represents a detected runtime behavior pattern from strace data.
type TracePattern struct {
	Pattern     string `json:"pattern"`
	Severity    string `json:"severity"`
	Description string `json:"description"`
	Evidence    string `json:"evidence"`
	Count       int    `json:"count"`
}

// StraceSummary is a structured summary for AI consumption.
type StraceSummary struct {
	TotalSyscalls  int            `json:"total_syscalls"`
	ErrorSyscalls  int            `json:"error_syscalls"`
	UniqueSyscalls int            `json:"unique_syscalls"`
	TopSyscalls    []SyscallCount `json:"top_syscalls"`
	TopErrors      []SyscallError `json:"top_errors"`
	Patterns       []TracePattern `json:"patterns"`
	FDOpenClose    *FDBalance     `json:"fd_balance"`
	MemoryOps      *MemBalance    `json:"memory_balance"`
	ProcessOps     *ProcBalance   `json:"process_balance"`
	// HumanReadable is a pre-built text summary for LLM prompts
	HumanReadable  string         `json:"-"`
}

type SyscallCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type SyscallError struct {
	Name      string `json:"name"`
	ErrorName string `json:"error_name"`
	Count     int    `json:"count"`
}

type FDBalance struct {
	Opens   int    `json:"opens"`
	Closes  int    `json:"closes"`
	Leaked  int    `json:"leaked"`
	HasLeak bool   `json:"has_leak"`
	Detail  string `json:"detail"`
}

type MemBalance struct {
	AllocCalls   int    `json:"alloc_calls"`
	FreeCalls    int    `json:"free_calls"`
	HasImbalance bool   `json:"has_imbalance"`
	Detail       string `json:"detail"`
}

type ProcBalance struct {
	ForkCalls  int    `json:"fork_calls"`
	WaitCalls  int    `json:"wait_calls"`
	HasZombies bool   `json:"has_zombies"`
	Detail     string `json:"detail"`
}

// AnalyzeStraceTraces performs semantic pattern recognition on syscall traces.
func AnalyzeStraceTraces(traces []repository.SyscallTraceRecord) *StraceSummary {
	if len(traces) == 0 {
		return &StraceSummary{}
	}

	s := &StraceSummary{
		TotalSyscalls: len(traces),
		Patterns:      make([]TracePattern, 0),
	}

	syscallCounts := make(map[string]int)
	errorCounts := make(map[string]map[string]int)
	seenSyscalls := make(map[string]bool)

	fdOpen := 0
	fdClose := 0
	memAlloc := 0
	memFree := 0
	forkCnt := 0
	waitCnt := 0
	segfault := 0
	permErr := 0

	for _, t := range traces {
		syscallCounts[t.SyscallName]++
		seenSyscalls[t.SyscallName] = true

		if t.ErrorName != "" {
			s.ErrorSyscalls++
			if errorCounts[t.SyscallName] == nil {
				errorCounts[t.SyscallName] = make(map[string]int)
			}
			errorCounts[t.SyscallName][t.ErrorName]++

			// arch_prctl(0x3001) -> EINVAL is a normal glibc feature probe
			// (ARCH_SET_FS / ARCH_CET_STATUS), not a real segfault.
			// Skip it to avoid false positives in simple C programs.
			if t.SyscallName != "arch_prctl" {
				switch t.ErrorName {
				case "EFAULT", "EINVAL":
					segfault++
				case "EACCES", "EPERM":
					permErr++
				}
			}
		}

		// ── Categorize by syscall type ──
		switch t.SyscallName {
		case "open", "openat", "creat", "socket", "pipe", "pipe2", "dup", "dup2", "dup3":
			fdOpen++
		case "close":
			fdClose++
		case "brk", "mmap", "mmap2":
			if t.ReturnValue > 0 || t.ErrorName == "" {
				memAlloc++
			}
		case "munmap", "munmap2":
			memFree++
		case "fork", "vfork", "clone", "clone3":
			forkCnt++
		case "wait4", "waitid", "waitpid":
			waitCnt++
		}
	}

	s.UniqueSyscalls = len(seenSyscalls)

	// ── Top syscalls ──
	type scPair struct {
		n string
		c int
	}
	var scList []scPair
	for n, c := range syscallCounts {
		scList = append(scList, scPair{n, c})
	}
	sort.Slice(scList, func(i, j int) bool { return scList[i].c > scList[j].c })
	topN := min(10, len(scList))
	s.TopSyscalls = make([]SyscallCount, topN)
	for i := 0; i < topN; i++ {
		s.TopSyscalls[i] = SyscallCount{Name: scList[i].n, Count: scList[i].c}
	}

	// ── Top errors ──
	type sePair struct {
		sn, en string
		c      int
	}
	var seList []sePair
	for sn, errs := range errorCounts {
		for en, c := range errs {
			seList = append(seList, sePair{sn, en, c})
		}
	}
	sort.Slice(seList, func(i, j int) bool { return seList[i].c > seList[j].c })
	errTopN := min(10, len(seList))
	s.TopErrors = make([]SyscallError, errTopN)
	for i := 0; i < errTopN; i++ {
		s.TopErrors[i] = SyscallError{Name: seList[i].sn, ErrorName: seList[i].en, Count: seList[i].c}
	}

	// ── Pattern 1: FD Leak ──
	fdBal := &FDBalance{Opens: fdOpen, Closes: fdClose}
	if fdOpen > 0 && fdClose < fdOpen {
		fdBal.Leaked = fdOpen - fdClose
		fdBal.HasLeak = true
		fdBal.Detail = fmt.Sprintf("文件描述符泄漏风险：打开%d次(open/openat/socket)，关闭仅%d次(close)，差异%d。请确认每个open都有配对的close。",
			fdOpen, fdClose, fdBal.Leaked)
		s.Patterns = append(s.Patterns, TracePattern{
			Pattern: "fd_leak", Severity: "medium",
			Description: fmt.Sprintf("FD泄漏：打开%d次，关闭%d次，差异%d", fdOpen, fdClose, fdBal.Leaked),
			Evidence:    fmt.Sprintf("open类=%d次, close=%d次", fdOpen, fdClose),
			Count:       fdBal.Leaked,
		})
	} else {
		fdBal.Detail = fmt.Sprintf("文件描述符管理正常：打开%d次，关闭%d次。", fdOpen, fdClose)
	}
	s.FDOpenClose = fdBal

	// ── Pattern 2: Memory Imbalance ──
	memBal := &MemBalance{AllocCalls: memAlloc, FreeCalls: memFree}
	if memAlloc > 0 && memFree < memAlloc {
		ratio := float64(memFree) / float64(memAlloc)
		// Normal dynamic-linker startup allocates ~10-15 mmap regions that
		// are never manually munmapped (cleaned up by OS at exit).  Require
		// the absolute imbalance to exceed 15 before flagging, so simple
		// programs without real memory management bugs are not penalised.
		if ratio < 0.5 && (memAlloc-memFree) > 15 {
			memBal.HasImbalance = true
			memBal.Detail = fmt.Sprintf("内存操作不均衡：分配(brk/mmap)%d次，释放(munmap)仅%d次(%.0f%%)，可能存在内存泄漏，请检查malloc/free配对。",
				memAlloc, memFree, ratio*100)
			s.Patterns = append(s.Patterns, TracePattern{
				Pattern: "memory_leak", Severity: "high",
				Description: fmt.Sprintf("内存不均衡：分配%d次，释放%d次(%.0f%%)", memAlloc, memFree, ratio*100),
				Evidence:    fmt.Sprintf("brk/mmap=%d, munmap=%d", memAlloc, memFree),
				Count:       memAlloc - memFree,
			})
		} else {
			memBal.Detail = "内存操作基本均衡。"
		}
	} else if memAlloc == 0 {
		memBal.Detail = "未检测到显著内存分配操作。"
	} else {
		memBal.Detail = "内存分配/释放配对正常。"
	}
	s.MemoryOps = memBal

	// ── Pattern 3: Zombie Risk ──
	procBal := &ProcBalance{ForkCalls: forkCnt, WaitCalls: waitCnt}
	if forkCnt > 0 && waitCnt < forkCnt {
		procBal.HasZombies = true
		if waitCnt == 0 {
			procBal.Detail = fmt.Sprintf("⚠️ 僵尸进程风险：fork/clone %d次，但无wait/waitpid回收调用。子进程退出后将变为僵尸进程。", forkCnt)
		} else {
			procBal.Detail = fmt.Sprintf("可能产生僵尸进程：fork=%d次，wait=%d次。部分子进程可能未被正确回收。", forkCnt, waitCnt)
		}
		s.Patterns = append(s.Patterns, TracePattern{
			Pattern: "zombie_process", Severity: "high",
			Description: fmt.Sprintf("僵尸进程风险：fork=%d次，wait=%d次", forkCnt, waitCnt),
			Evidence:    fmt.Sprintf("fork/clone=%d, wait/waitpid=%d", forkCnt, waitCnt),
			Count:       forkCnt - waitCnt,
		})
	} else if forkCnt > 0 {
		procBal.Detail = fmt.Sprintf("进程创建/回收正常：fork=%d次，wait=%d次。", forkCnt, waitCnt)
	} else {
		procBal.Detail = "未检测到子进程创建操作。"
	}
	s.ProcessOps = procBal

	// ── Pattern 4: Segfault ──
	if segfault > 0 {
		s.Patterns = append(s.Patterns, TracePattern{
			Pattern: "segfault_risk", Severity: "high",
			Description: fmt.Sprintf("检测到%d次EFAULT/EINVAL错误，可能存在段错误或非法内存访问", segfault),
			Evidence:    fmt.Sprintf("%d次EFAULT/EINVAL错误", segfault),
			Count:       segfault,
		})
	}

	// ── Pattern 5: Permission ──
	if permErr > 0 {
		s.Patterns = append(s.Patterns, TracePattern{
			Pattern: "permission_error", Severity: "medium",
			Description: fmt.Sprintf("检测到%d次EACCES/EPERM权限错误", permErr),
			Evidence:    fmt.Sprintf("%d次EACCES/EPERM错误", permErr),
			Count:       permErr,
		})
	}

	// ── Build human-readable text for AI ──
	s.HumanReadable = buildHumanReadable(s)

	return s
}

// buildHumanReadable creates a concise, structured text summary for LLM prompts.
func buildHumanReadable(s *StraceSummary) string {
	var sb strings.Builder

	sb.WriteString("【系统调用轨迹分析摘要】\n")
	sb.WriteString(fmt.Sprintf("总计: %d 次系统调用, %d 次出错, %d 种不同调用\n\n", s.TotalSyscalls, s.ErrorSyscalls, s.UniqueSyscalls))

	// Top syscalls
	if len(s.TopSyscalls) > 0 {
		sb.WriteString("高频调用: ")
		parts := make([]string, 0, len(s.TopSyscalls))
		for _, sc := range s.TopSyscalls[:min(5, len(s.TopSyscalls))] {
			parts = append(parts, fmt.Sprintf("%s(%d)", sc.Name, sc.Count))
		}
		sb.WriteString(strings.Join(parts, ", "))
		sb.WriteString("\n")
	}

	// Top errors
	if len(s.TopErrors) > 0 {
		sb.WriteString("错误调用: ")
		ep := make([]string, 0, len(s.TopErrors))
		for _, e := range s.TopErrors[:min(5, len(s.TopErrors))] {
			ep = append(ep, fmt.Sprintf("%s→%s(%d)", e.Name, e.ErrorName, e.Count))
		}
		sb.WriteString(strings.Join(ep, ", "))
		sb.WriteString("\n")
	}

	// Balances
	if s.FDOpenClose != nil {
		sb.WriteString(fmt.Sprintf("\n[FD] %s\n", s.FDOpenClose.Detail))
	}
	if s.MemoryOps != nil {
		sb.WriteString(fmt.Sprintf("[内存] %s\n", s.MemoryOps.Detail))
	}
	if s.ProcessOps != nil {
		sb.WriteString(fmt.Sprintf("[进程] %s\n", s.ProcessOps.Detail))
	}

	// Patterns
	if len(s.Patterns) > 0 {
		sb.WriteString("\n检测到的运行时模式:\n")
		for _, p := range s.Patterns {
			sb.WriteString(fmt.Sprintf("  [%s] %s: %s\n", p.Severity, p.Pattern, p.Description))
		}
	} else {
		sb.WriteString("\n未检测到明显的运行时异常模式。\n")
	}

	return sb.String()
}
