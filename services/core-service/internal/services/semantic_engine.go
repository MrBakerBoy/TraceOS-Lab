package services

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// SemanticEngine translates raw syscall sequences into OS-teaching-language narratives.
// Design reference: Pixie protocol auto-parsing — automatic pattern recognition.
type SemanticEngine struct {
	patterns []SemanticPattern
}

// SemanticPattern defines a recognizable OS pattern.
type SemanticPattern struct {
	Name         string   `json:"name"`
	Sequence     []string `json:"sequence"`      // ordered syscall names (or "regex:..." prefix)
	Label        string   `json:"label"`         // human-readable label with icon
	Category     string   `json:"category"`      // process|memory|lock|io|ipc
	CategoryIcon string   `json:"category_icon"` // 🟢|💾|🔴|📁|🔗
	OSConcept    string   `json:"os_concept"`    // linked OS textbook concept
	Severity     string   `json:"severity"`      // info|warning|critical
	TeachingNote string   `json:"teaching_note"`
}

// NewSemanticEngine creates a semantic engine with the default OS pattern library.
func NewSemanticEngine() *SemanticEngine {
	return &SemanticEngine{
		patterns: defaultPatterns(),
	}
}

// Analyze transforms a syscall sequence into semantic events.
func (se *SemanticEngine) Analyze(syscalls []string) []SemanticResult {
	var results []SemanticResult
	seen := make(map[string]bool)

	for _, p := range se.patterns {
		matches := se.findSequence(syscalls, p.Sequence)
		for _, m := range matches {
			key := fmt.Sprintf("%s_%d", p.Name, m.start)
			if seen[key] {
				continue // deduplicate overlapping matches
			}
			seen[key] = true
			results = append(results, SemanticResult{
				PatternName:  p.Name,
				Label:        p.Label,
				Category:     p.Category,
				CategoryIcon: p.CategoryIcon,
				OSConcept:    p.OSConcept,
				Severity:     p.Severity,
				TeachingNote: p.TeachingNote,
				StartIndex:   m.start,
				EndIndex:     m.end,
			})
		}
	}

	// Sort by start index
	sort.Slice(results, func(i, j int) bool {
		return results[i].StartIndex < results[j].StartIndex
	})

	return results
}

// ClassifyEvent returns the semantic label for a single syscall.
func (se *SemanticEngine) ClassifyEvent(syscall string) (label, concept, severity string) {
	for _, p := range se.patterns {
		if len(p.Sequence) == 1 && se.syscallMatches(syscall, p.Sequence[0]) {
			return p.Label, p.OSConcept, p.Severity
		}
	}
	return syscall, syscall, "info"
}

// MatchSingle returns the SemanticPattern if the single syscall matches any pattern.
func (se *SemanticEngine) MatchSingle(syscall string) *SemanticPattern {
	for _, p := range se.patterns {
		if len(p.Sequence) == 1 && se.syscallMatches(syscall, p.Sequence[0]) {
			return &p
		}
	}
	return nil
}

type matchRange struct {
	start, end int
}

func (se *SemanticEngine) findSequence(syscalls []string, pattern []string) []matchRange {
	if len(pattern) == 0 || len(syscalls) < len(pattern) {
		return nil
	}

	var matches []matchRange
	maxStart := len(syscalls) - len(pattern)
	for i := 0; i <= maxStart; i++ {
		if se.matchAt(syscalls, pattern, i) {
			matches = append(matches, matchRange{start: i, end: i + len(pattern) - 1})
			// For multi-step patterns, skip past the matched range to avoid overlapping
			if len(pattern) > 1 {
				i += len(pattern) - 1
			}
		}
	}
	return matches
}

func (se *SemanticEngine) matchAt(syscalls []string, pattern []string, start int) bool {
	for j, p := range pattern {
		if !se.syscallMatches(syscalls[start+j], p) {
			return false
		}
	}
	return true
}

func (se *SemanticEngine) syscallMatches(actual, pattern string) bool {
	if strings.HasPrefix(pattern, "regex:") {
		// Regex-based pattern matching for flexible syscall names
		rePattern := pattern[6:]
		re, err := regexp.Compile(rePattern)
		if err != nil {
			return false
		}
		return re.MatchString(actual)
	}
	if strings.Contains(pattern, "(") {
		// Pattern with arguments: check prefix only
		prefix := pattern[:strings.Index(pattern, "(")]
		return strings.HasPrefix(actual, prefix)
	}
	return actual == pattern
}

// SemanticResult represents a detected OS pattern.
type SemanticResult struct {
	PatternName  string `json:"pattern_name"`
	Label        string `json:"label"`
	Category     string `json:"category"`
	CategoryIcon string `json:"category_icon"`
	OSConcept    string `json:"os_concept"`
	Severity     string `json:"severity"`
	TeachingNote string `json:"teaching_note"`
	StartIndex   int    `json:"start_index"`
	EndIndex     int    `json:"end_index"`
}

// ── Default OS Semantic Pattern Library (21 patterns) ──

func defaultPatterns() []SemanticPattern {
	return []SemanticPattern{
		// ═══════════════════════════════════════════
		// Process patterns (5)
		// ═══════════════════════════════════════════
		{
			Name: "fork_exec_workflow",
			Sequence: []string{"clone", "execve"},
			Label: "🟢 进程创建与程序加载",
			Category: "process",
			CategoryIcon: "🟢",
			OSConcept: "fork+exec",
			Severity: "info",
			TeachingNote: "这正是 fork()+exec() 的经典模式：fork 复制进程，exec 替换程序映像",
		},
		{
			Name: "fork_wait_pattern",
			Sequence: []string{"clone", "wait4"},
			Label: "🟢 创建子进程并等待",
			Category: "process",
			CategoryIcon: "🟢",
			OSConcept: "wait",
			Severity: "info",
			TeachingNote: "父进程创建子进程后正确调用了 wait()，避免僵尸进程",
		},
		{
			Name: "clone_thread_pattern",
			Sequence: []string{"clone", "clone"},
			Label: "🟢 创建多个工作线程",
			Category: "process",
			CategoryIcon: "🟢",
			OSConcept: "clone-flags",
			Severity: "info",
			TeachingNote: "连续 clone() 创建多个执行单元。若 flags 含 CLONE_VM 则是线程(共享地址空间)，否则为新进程。",
		},
		{
			Name: "fork_no_wait",
			Sequence: []string{"clone"},
			Label: "🟡 创建子进程（缺少 wait）",
			Category: "process",
			CategoryIcon: "🟡",
			OSConcept: "zombie",
			Severity: "warning",
			TeachingNote: "fork()/clone() 后未跟随 wait() — 子进程退出后会变成僵尸进程，占用进程表条目。",
		},
		{
			Name: "process_lifecycle",
			Sequence: []string{"clone", "execve", "exit_group"},
			Label: "🟢 完整进程生命周期",
			Category: "process",
			CategoryIcon: "🟢",
			OSConcept: "process-lifecycle",
			Severity: "info",
			TeachingNote: "进程从创建 → 加载程序 → 退出的完整生命周期。这是理解进程状态转换的最佳示例。",
		},

		// ═══════════════════════════════════════════
		// IPC patterns (4)
		// ═══════════════════════════════════════════
		{
			Name: "pipe_ipc",
			Sequence: []string{"pipe2", "clone"},
			Label: "🔗 管道通信准备",
			Category: "ipc",
			CategoryIcon: "🔗",
			OSConcept: "pipe",
			Severity: "info",
			TeachingNote: "pipe2() 创建管道后 fork，子进程继承管道 fd — 父子进程可通过管道进行半双工通信。",
		},
		{
			Name: "pipe_read_write",
			Sequence: []string{"write", "read"},
			Label: "🔗 管道读写通信",
			Category: "ipc",
			CategoryIcon: "🔗",
			OSConcept: "pipe-io",
			Severity: "info",
			TeachingNote: "write() 向管道写入，read() 从管道读取。管道是单向的 — 注意 fd 方向(0读/1写)。",
		},
		{
			Name: "signal_ipc",
			Sequence: []string{"kill", "rt_sigaction"},
			Label: "🔗 信号通信",
			Category: "ipc",
			CategoryIcon: "🔗",
			OSConcept: "signal",
			Severity: "info",
			TeachingNote: "kill() 向目标进程发送信号，rt_sigaction() 设置信号处理函数 — POSIX 信号是最基础的 IPC 机制。",
		},
		{
			Name: "socket_create",
			Sequence: []string{"socket", "bind"},
			Label: "🔗 创建并绑定 socket",
			Category: "ipc",
			CategoryIcon: "🔗",
			OSConcept: "socket",
			Severity: "info",
			TeachingNote: "socket() 创建通信端点，bind() 绑定本地地址 — 网络编程的基础步骤。",
		},

		// ═══════════════════════════════════════════
		// Memory patterns (4)
		// ═══════════════════════════════════════════
		{
			Name: "malloc_pattern",
			Sequence: []string{"brk", "mmap"},
			Label: "💾 动态内存分配",
			Category: "memory",
			CategoryIcon: "💾",
			OSConcept: "malloc",
			Severity: "info",
			TeachingNote: "brk() 扩展堆空间(小分配)，mmap() 映射新内存区域(大分配) — glibc malloc 的底层双轨策略。",
		},
		{
			Name: "leak_pattern",
			Sequence: []string{"brk", "brk", "brk"},
			Label: "🟡 堆持续增长（可能泄漏）",
			Category: "memory",
			CategoryIcon: "🟡",
			OSConcept: "memory_leak",
			Severity: "warning",
			TeachingNote: "堆(brk)连续扩展 3 次而未发现 munmap() — 检查是否忘记 free() 或重用已分配的内存。",
		},
		{
			Name: "mem_growth_warning",
			Sequence: []string{"mmap", "mmap", "mmap"},
			Label: "🔴 内存快速增长",
			Category: "memory",
			CategoryIcon: "🔴",
			OSConcept: "memory_growth",
			Severity: "critical",
			TeachingNote: "连续 3 次匿名 mmap — 内存使用快速增长。检查是否有未释放的分配，或是否需要考虑内存池复用。",
		},
		{
			Name: "munmap_release",
			Sequence: []string{"mmap", "munmap"},
			Label: "💾 申请后释放",
			Category: "memory",
			CategoryIcon: "💾",
			OSConcept: "munmap",
			Severity: "info",
			TeachingNote: "mmap 分配后调用 munmap 正确释放 — 良好的内存管理习惯。",
		},

		// ═══════════════════════════════════════════
		// Lock / Deadlock patterns (2)
		// ═══════════════════════════════════════════
		{
			Name: "deadlock_pattern",
			Sequence: []string{"futex", "futex"},
			Label: "🔴 潜在死锁（两个 futex 等待）",
			Category: "lock",
			CategoryIcon: "🔴",
			OSConcept: "deadlock",
			Severity: "critical",
			TeachingNote: "连续两个 futex 等待调用 — 检查是否满足 Coffman 四个条件(互斥/持有并等待/不可剥夺/循环等待)。",
		},
		{
			Name: "deadlock_cycle",
			Sequence: []string{"futex", "futex", "futex"},
			Label: "🔴 死锁环（三个 futex 等待）",
			Category: "lock",
			CategoryIcon: "🔴",
			OSConcept: "deadlock-cycle",
			Severity: "critical",
			TeachingNote: "三个连续 futex 等待 → 高概率死锁环。按 Coffman 条件逐一排查：互斥✅、持有并等待✅、不可剥夺✅、循环等待✅。",
		},

		// ═══════════════════════════════════════════
		// I/O patterns (5)
		// ═══════════════════════════════════════════
		{
			Name: "fd_leak_pattern",
			Sequence: []string{"openat", "openat", "openat"},
			Label: "🟡 重复打开文件（FD 泄漏风险）",
			Category: "io",
			CategoryIcon: "🟡",
			OSConcept: "fd_leak",
			Severity: "warning",
			TeachingNote: "连续 3 次 openat 未伴随 close() — 文件描述符可能泄漏。Linux 默认 fd 上限为 1024(ulimit -n 查看)。",
		},
		{
			Name: "open_close_cycle",
			Sequence: []string{"openat", "close"},
			Label: "📁 文件打开后关闭",
			Category: "io",
			CategoryIcon: "📁",
			OSConcept: "fd-lifecycle",
			Severity: "info",
			TeachingNote: "open 后及时 close — 正确的 fd 生命周期管理。文件描述符是有限的系统资源。",
		},
		{
			Name: "small_io_pattern",
			Sequence: []string{"write", "write", "write"},
			Label: "🟡 频繁小 I/O 操作",
			Category: "io",
			CategoryIcon: "🟡",
			OSConcept: "io-buffer",
			Severity: "warning",
			TeachingNote: "连续多次 write() 系统调用 — 每次 write 都有上下文切换开销。考虑使用缓冲批量写入(如 setvbuf)。",
		},
		{
			Name: "read_write_cycle",
			Sequence: []string{"read", "write"},
			Label: "📁 读取后写入",
			Category: "io",
			CategoryIcon: "📁",
			OSConcept: "io-relay",
			Severity: "info",
			TeachingNote: "从源 fd 读取数据后写入目标 fd — 常见的数据中继模式，如 cp/cat 命令。注意检查返回值中的字节数。",
		},
		{
			Name: "early_close_bug",
			Sequence: []string{"close", "read"},
			Label: "🔴 关闭 fd 后尝试读取",
			Category: "io",
			CategoryIcon: "🔴",
			OSConcept: "ebadf",
			Severity: "warning",
			TeachingNote: "close(fd) 后立即 read(fd) — read 将返回 EBADF(Bad file descriptor)。检查 close() 的位置是否过早。",
		},

		// ═══════════════════════════════════════════
		// Network patterns (1)
		// ═══════════════════════════════════════════
		{
			Name: "socket_listen_accept",
			Sequence: []string{"bind", "listen", "accept4"},
			Label: "🔗 TCP 服务端启动",
			Category: "ipc",
			CategoryIcon: "🔗",
			OSConcept: "tcp-server",
			Severity: "info",
			TeachingNote: "bind → listen → accept 是 TCP 服务端的标准三步: 绑定端口 → 标记监听 → 接受连接。",
		},
	}
}
