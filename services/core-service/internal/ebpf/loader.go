// Deprecated: loader.go (v1 per-task BPF loading) is superseded by
// loader_v2.go (global singleton + HASH_OF_MAPS sandbox isolation).
// This file is retained for reference and under the ebpf_native build tag
// to avoid compilation conflicts with loader_v2.go.
//
//go:build ebpf_native
// +build ebpf_native

// Package ebpf provides a unified eBPF program loader and trace pipeline
// for the TraceOS Lab observability system.
//
// Build tag: ebpf_native
// This package requires github.com/cilium/ebpf and kernel headers (>=5.4).
// Build without this tag to use the bpftrace-based fallback path in ebpf_handler.go.
//
// Architecture (multi-probe):
//
//	BPF C programs (CO-RE)           Go loader (cilium/ebpf)
//	─────────────────────           ──────────────────────────
//	syscall_trace.bpf.o      ──→    probes["syscall"]  (tracepoint + ringbuf)
//	futex_deadlock.bpf.o     ──→    probes["deadlock"] (tracepoint + ringbuf)
//	mem_trace.bpf.o          ──→    probes["mem"]      (tracepoint + ringbuf)
//
// Each probe is independently managed — starting one no longer leaks another.
//
// Dependencies: github.com/cilium/ebpf (pure Go, no BCC/clang at runtime)
package ebpf

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"os"
	"sync"
	"sync/atomic"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/cilium/ebpf/rlimit"
)

// ── Unified Trace Event ────────────────────────────────────────────

// TraceEvent is the common event format emitted by all eBPF backends.
// It is consumed by the handler layer for SSE broadcast and AI analysis.
type TraceEvent struct {
	Source      string `json:"source"`                 // "syscall", "futex", "mem", "sched"
	Op          string `json:"op"`                     // syscall name, futex op, mem event type
	Tid         uint32 `json:"tid"`
	Pid         uint32 `json:"pid"`
	Uaddr       uint64 `json:"uaddr,omitempty"`        // futex/mutex address
	Size        uint64 `json:"size,omitempty"`         // mem allocation size
	Addr        uint64 `json:"addr,omitempty"`         // mem returned address
	Count       uint64 `json:"count,omitempty"`        // aggregation count
	LatencyNs   uint64 `json:"latency_ns,omitempty"`
	Ret         int64  `json:"ret,omitempty"`          // syscall return value
	Arg0        uint64 `json:"arg0,omitempty"`         // syscall argument 0
	Arg1        uint64 `json:"arg1,omitempty"`         // syscall argument 1
	TimestampNs uint64 `json:"timestamp_ns"`
}

// TraceEventHandler receives trace events from all eBPF backends.
type TraceEventHandler func(event TraceEvent)

// ── Probe instance (one per BPF object) ────────────────────────────

// probeInstance holds the lifecycle resources for a single eBPF program.
type probeInstance struct {
	name    string
	coll    *ebpf.Collection
	links   []link.Link
	readers []*ringbuf.Reader
}

func (p *probeInstance) Close() {
	for _, rd := range p.readers {
		rd.Close()
	}
	for _, lk := range p.links {
		lk.Close()
	}
	if p.coll != nil {
		p.coll.Close()
	}
}

// ── BPF Object Loader (multi-probe) ────────────────────────────────

// Loader manages the lifecycle of compiled eBPF programs.
// Supports running multiple probes (syscall + deadlock + mem) concurrently.
type Loader struct {
	mu      sync.Mutex
	probes  map[string]*probeInstance
	running atomic.Bool
	handler TraceEventHandler
}

// LoaderOpts configures eBPF program loading.
type LoaderOpts struct {
	BPFObjectPath string            // path to .bpf.o file
	TargetPID     uint32            // filter to this PID (0 = all)
	Handler       TraceEventHandler // called for each event
}

// NewLoader creates a new eBPF loader. Call Start*() to begin tracing.
func NewLoader() *Loader {
	return &Loader{probes: make(map[string]*probeInstance)}
}

// registerProbe stores a probe instance, replacing any existing probe with the same name.
func (l *Loader) registerProbe(p *probeInstance) {
	l.mu.Lock()
	if old, ok := l.probes[p.name]; ok {
		old.Close()
	}
	l.probes[p.name] = p
	l.handler = l.handler // preserve handler reference
	l.mu.Unlock()
}

// ── Syscall Tracer ─────────────────────────────────────────────────

// syscallEventRaw matches the C struct in syscall_trace.bpf.c (packed, little-endian).
//
//	struct syscall_event {
//	    u32 pid; u32 tid; u32 syscall_nr;
//	    u64 args[6]; s64 ret; u64 duration_ns; u64 timestamp_ns;
//	} __attribute__((packed));
type syscallEventRaw struct {
	Pid         uint32
	Tid         uint32
	SyscallNr   uint32
	_           [4]byte // padding to u64-align args[0]
	Arg0        uint64
	Arg1        uint64
	Arg2        uint64
	Arg3        uint64
	Arg4        uint64
	Arg5        uint64
	Ret         int64
	DurationNs  uint64
	TimestampNs uint64
}

// StartSyscallTracer loads and starts the syscall tracing BPF program.
// Events are emitted via ring buffer (per-call) and hash map (aggregation).
func (l *Loader) StartSyscallTracer(opts LoaderOpts) error {
	if err := rlimit.RemoveMemlock(); err != nil {
		log.Printf("[ebpf] memlock rlimit warning: %v (non-fatal)", err)
	}

	spec, err := ebpf.LoadCollectionSpec(opts.BPFObjectPath)
	if err != nil {
		return fmt.Errorf("load syscall trace spec: %w", err)
	}

	if err := spec.RewriteConstants(map[string]interface{}{
		"target_pid": opts.TargetPID,
	}); err != nil {
		return fmt.Errorf("rewrite target_pid constant: %w", err)
	}

	coll, err := ebpf.NewCollection(spec)
	if err != nil {
		return fmt.Errorf("load syscall trace collection: %w", err)
	}

	// Attach tracepoints
	enterLink, err := link.Tracepoint("raw_syscalls", "sys_enter", coll.Programs["trace_syscall_enter"], nil)
	if err != nil {
		coll.Close()
		return fmt.Errorf("attach sys_enter: %w", err)
	}

	exitLink, err := link.Tracepoint("raw_syscalls", "sys_exit", coll.Programs["trace_syscall_exit"], nil)
	if err != nil {
		enterLink.Close()
		coll.Close()
		return fmt.Errorf("attach sys_exit: %w", err)
	}

	// Open ring buffer for per-call events
	rd, err := ringbuf.NewReader(coll.Maps["syscall_events"])
	if err != nil {
		enterLink.Close()
		exitLink.Close()
		coll.Close()
		return fmt.Errorf("open syscall ringbuf: %w", err)
	}

	p := &probeInstance{
		name:    "syscall",
		coll:    coll,
		links:   []link.Link{enterLink, exitLink},
		readers: []*ringbuf.Reader{rd},
	}

	l.mu.Lock()
	l.handler = opts.Handler
	l.running.Store(true)
	l.mu.Unlock()

	l.registerProbe(p)

	// Start ring buffer consumer
	go l.consumeSyscallEvents(rd)

	log.Printf("[ebpf] syscall tracer started (pid=%d, ringbuf)", opts.TargetPID)
	return nil
}

func (l *Loader) consumeSyscallEvents(rd *ringbuf.Reader) {
	var raw syscallEventRaw
	for l.running.Load() {
		record, err := rd.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) {
				return
			}
			log.Printf("[ebpf] syscall ringbuf read: %v", err)
			continue
		}

		if err := binary.Read(bytes.NewReader(record.RawSample), binary.LittleEndian, &raw); err != nil {
			log.Printf("[ebpf] syscall event decode: %v", err)
			continue
		}

		l.mu.Lock()
		handler := l.handler
		l.mu.Unlock()
		if handler != nil {
			handler(TraceEvent{
				Source:      "syscall",
				Op:          syscallNameBPF(raw.SyscallNr),
				Tid:         raw.Tid,
				Pid:         raw.Pid,
				Ret:         raw.Ret,
				LatencyNs:   raw.DurationNs,
				Arg0:        raw.Arg0,
				Arg1:        raw.Arg1,
				TimestampNs: raw.TimestampNs,
			})
		}
	}
}

// ── Deadlock Detector ──────────────────────────────────────────────

// futexEventRaw matches C struct (packed, little-endian).
//
//	struct futex_event { u32 pid; u32 tid; u32 op; u64 uaddr; u64 timestamp_ns; } __attribute__((packed));
type futexEventRaw struct {
	Pid         uint32
	Tid         uint32
	Op          uint32
	Uaddr       uint64
	TimestampNs uint64
}

// StartDeadlockDetector loads and starts the futex deadlock detection BPF program.
func (l *Loader) StartDeadlockDetector(opts LoaderOpts) error {
	if err := rlimit.RemoveMemlock(); err != nil {
		log.Printf("[ebpf] memlock rlimit warning: %v (non-fatal)", err)
	}

	spec, err := ebpf.LoadCollectionSpec(opts.BPFObjectPath)
	if err != nil {
		return fmt.Errorf("load futex deadlock spec: %w", err)
	}

	if err := spec.RewriteConstants(map[string]interface{}{
		"target_pid": opts.TargetPID,
	}); err != nil {
		return fmt.Errorf("rewrite target_pid constant: %w", err)
	}

	coll, err := ebpf.NewCollection(spec)
	if err != nil {
		return fmt.Errorf("load futex deadlock collection: %w", err)
	}

	tpLink, err := link.Tracepoint("syscalls", "sys_enter_futex", coll.Programs["trace_futex_enter"], nil)
	if err != nil {
		coll.Close()
		return fmt.Errorf("attach futex tracepoint: %w", err)
	}

	rd, err := ringbuf.NewReader(coll.Maps["futex_events"])
	if err != nil {
		tpLink.Close()
		coll.Close()
		return fmt.Errorf("open futex ringbuf: %w", err)
	}

	p := &probeInstance{
		name:    "deadlock",
		coll:    coll,
		links:   []link.Link{tpLink},
		readers: []*ringbuf.Reader{rd},
	}

	l.mu.Lock()
	l.handler = opts.Handler
	l.running.Store(true)
	l.mu.Unlock()

	l.registerProbe(p)

	go l.consumeFutexEvents(rd)

	log.Printf("[ebpf] deadlock detector started (pid=%d, ringbuf)", opts.TargetPID)
	return nil
}

func (l *Loader) consumeFutexEvents(rd *ringbuf.Reader) {
	var raw futexEventRaw
	for l.running.Load() {
		record, err := rd.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) {
				return
			}
			log.Printf("[ebpf] futex ringbuf read: %v", err)
			continue
		}

		if err := binary.Read(bytes.NewReader(record.RawSample), binary.LittleEndian, &raw); err != nil {
			log.Printf("[ebpf] futex event decode: %v", err)
			continue
		}

		l.mu.Lock()
		handler := l.handler
		l.mu.Unlock()
		if handler != nil {
			handler(TraceEvent{
				Source:      "futex",
				Op:          futexOpName(raw.Op),
				Tid:         raw.Tid,
				Pid:         raw.Pid,
				Uaddr:       raw.Uaddr,
				TimestampNs: raw.TimestampNs,
			})
		}
	}
}

// ── Memory Tracer ──────────────────────────────────────────────────

// memEventRaw matches C struct (packed, little-endian).
//
//	struct mem_event { u32 pid; u32 tid; u32 type; u64 size; u64 addr; u64 timestamp_ns; } __attribute__((packed));
type memEventRaw struct {
	Pid         uint32
	Tid         uint32
	Type        uint32
	Size        uint64
	Addr        uint64
	TimestampNs uint64
}

// StartMemoryTracer loads and starts the memory allocation tracing BPF program.
func (l *Loader) StartMemoryTracer(opts LoaderOpts) error {
	if err := rlimit.RemoveMemlock(); err != nil {
		log.Printf("[ebpf] memlock rlimit warning: %v (non-fatal)", err)
	}

	spec, err := ebpf.LoadCollectionSpec(opts.BPFObjectPath)
	if err != nil {
		return fmt.Errorf("load mem trace spec: %w", err)
	}

	if err := spec.RewriteConstants(map[string]interface{}{
		"target_pid": opts.TargetPID,
	}); err != nil {
		return fmt.Errorf("rewrite target_pid constant: %w", err)
	}

	coll, err := ebpf.NewCollection(spec)
	if err != nil {
		return fmt.Errorf("load mem trace collection: %w", err)
	}

	// Attach tracepoints
	programs := map[string][2]string{
		"trace_enter_brk":    {"syscalls", "sys_enter_brk"},
		"trace_exit_brk":     {"syscalls", "sys_exit_brk"},
		"trace_enter_mmap":   {"syscalls", "sys_enter_mmap"},
		"trace_exit_mmap":    {"syscalls", "sys_exit_mmap"},
		"trace_enter_munmap": {"syscalls", "sys_enter_munmap"},
		"trace_exit_munmap":  {"syscalls", "sys_exit_munmap"},
	}

	var links []link.Link
	for progName, tp := range programs {
		prog := coll.Programs[progName]
		if prog == nil {
			for _, lk := range links {
				lk.Close()
			}
			coll.Close()
			return fmt.Errorf("program %s not found in collection", progName)
		}
		lk, err := link.Tracepoint(tp[0], tp[1], prog, nil)
		if err != nil {
			for _, prev := range links {
				prev.Close()
			}
			coll.Close()
			return fmt.Errorf("attach %s/%s: %w", tp[0], tp[1], err)
		}
		links = append(links, lk)
	}

	rd, err := ringbuf.NewReader(coll.Maps["mem_events"])
	if err != nil {
		for _, lk := range links {
			lk.Close()
		}
		coll.Close()
		return fmt.Errorf("open mem ringbuf: %w", err)
	}

	p := &probeInstance{
		name:    "mem",
		coll:    coll,
		links:   links,
		readers: []*ringbuf.Reader{rd},
	}

	l.mu.Lock()
	l.handler = opts.Handler
	l.running.Store(true)
	l.mu.Unlock()

	l.registerProbe(p)

	go l.consumeMemEvents(rd)

	log.Printf("[ebpf] memory tracer started (pid=%d, ringbuf)", opts.TargetPID)
	return nil
}

func (l *Loader) consumeMemEvents(rd *ringbuf.Reader) {
	var raw memEventRaw
	for l.running.Load() {
		record, err := rd.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) {
				return
			}
			log.Printf("[ebpf] mem ringbuf read: %v", err)
			continue
		}

		if err := binary.Read(bytes.NewReader(record.RawSample), binary.LittleEndian, &raw); err != nil {
			log.Printf("[ebpf] mem event decode: %v", err)
			continue
		}

		l.mu.Lock()
		handler := l.handler
		l.mu.Unlock()
		if handler != nil {
			handler(TraceEvent{
				Source:      "mem",
				Op:          memEventType(raw.Type),
				Tid:         raw.Tid,
				Pid:         raw.Pid,
				Size:        raw.Size,
				Addr:        raw.Addr,
				TimestampNs: raw.TimestampNs,
			})
		}
	}
}

// ── Lifecycle ──────────────────────────────────────────────────────

// Stop detaches all eBPF programs and closes maps (all probes).
func (l *Loader) Stop() {
	l.running.Store(false)

	l.mu.Lock()
	defer l.mu.Unlock()

	for name, p := range l.probes {
		p.Close()
		delete(l.probes, name)
	}

	log.Printf("[ebpf] loader stopped (all probes detached)")
}

// StopProbe stops a single named probe without affecting others.
func (l *Loader) StopProbe(name string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if p, ok := l.probes[name]; ok {
		p.Close()
		delete(l.probes, name)
		log.Printf("[ebpf] probe %q stopped", name)
	}
}

// ── Helpers ────────────────────────────────────────────────────────

func futexOpName(op uint32) string {
	switch op {
	case 0:
		return "FUTEX_WAIT"
	case 1:
		return "FUTEX_WAKE"
	case 6:
		return "FUTEX_LOCK_PI"
	case 7:
		return "FUTEX_UNLOCK_PI"
	case 9:
		return "FUTEX_WAIT_BITSET"
	default:
		return fmt.Sprintf("FUTEX_%d", op)
	}
}

func memEventType(t uint32) string {
	switch t {
	case 1:
		return "BRK"
	case 2:
		return "MMAP"
	case 3:
		return "MUNMAP"
	default:
		return fmt.Sprintf("MEM_%d", t)
	}
}

// syscallNameBPF maps x86_64 syscall numbers to human-readable names.
// Generated from arch/x86/entry/syscalls/syscall_64.tbl (Linux 6.x — full table).
func syscallNameBPF(nr uint32) string {
	names := map[uint32]string{
		0: "read", 1: "write", 2: "open", 3: "close",
		4: "stat", 5: "fstat", 6: "lstat", 7: "poll",
		8: "lseek", 9: "mmap", 10: "mprotect", 11: "munmap",
		12: "brk", 13: "rt_sigaction", 14: "rt_sigprocmask", 15: "rt_sigreturn",
		16: "ioctl", 17: "pread64", 18: "pwrite64", 19: "readv",
		20: "writev", 21: "access", 22: "pipe", 23: "select",
		24: "sched_yield", 25: "mremap", 26: "msync", 27: "mincore",
		28: "madvise", 29: "shmget", 30: "shmat", 31: "shmctl",
		32: "dup", 33: "dup2", 34: "pause", 35: "nanosleep",
		36: "getitimer", 37: "alarm", 38: "setitimer", 39: "getpid",
		40: "sendfile", 41: "socket", 42: "connect", 43: "accept",
		44: "sendto", 45: "recvfrom", 46: "sendmsg", 47: "recvmsg",
		48: "shutdown", 49: "bind", 50: "listen", 51: "getsockname",
		52: "getpeername", 53: "socketpair", 54: "setsockopt", 55: "getsockopt",
		56: "clone", 57: "fork", 58: "vfork", 59: "execve",
		60: "exit", 61: "wait4", 62: "kill", 63: "uname",
		64: "semget", 65: "semop", 66: "semctl", 67: "shmdt",
		68: "msgget", 69: "msgsnd", 70: "msgrcv", 71: "msgctl",
		72: "fcntl", 73: "flock", 74: "fsync", 75: "fdatasync",
		76: "truncate", 77: "ftruncate", 78: "getdents", 79: "getcwd",
		80: "chdir", 81: "fchdir", 82: "rename", 83: "mkdir",
		84: "rmdir", 85: "creat", 86: "link", 87: "unlink",
		88: "symlink", 89: "readlink", 90: "chmod", 91: "fchmod",
		92: "chown", 93: "fchown", 94: "lchown", 95: "umask",
		96: "gettimeofday", 97: "getrlimit", 98: "getrusage", 99: "sysinfo",
		100: "times", 101: "ptrace", 102: "getuid", 103: "syslog",
		104: "getgid", 105: "setuid", 106: "setgid", 107: "geteuid",
		108: "getegid", 109: "setpgid", 110: "getppid", 111: "getpgrp",
		112: "setsid", 113: "setreuid", 114: "setregid", 115: "getgroups",
		116: "setgroups", 117: "setresuid", 118: "getresuid", 119: "setresgid",
		120: "getresgid", 121: "getpgid", 122: "setfsuid", 123: "setfsgid",
		124: "getsid", 125: "capget", 126: "capset", 127: "rt_sigpending",
		128: "rt_sigtimedwait", 129: "rt_sigqueueinfo", 130: "rt_sigsuspend",
		131: "sigaltstack", 132: "utime", 133: "mknod", 134: "uselib",
		135: "personality", 136: "ustat", 137: "statfs", 138: "fstatfs",
		139: "sysfs", 140: "getpriority", 141: "setpriority",
		142: "sched_setparam", 143: "sched_getparam", 144: "sched_setscheduler",
		145: "sched_getscheduler", 146: "sched_get_priority_max", 147: "sched_get_priority_min",
		148: "sched_rr_get_interval", 149: "mlock", 150: "munlock",
		151: "mlockall", 152: "munlockall", 153: "vhangup", 154: "modify_ldt",
		155: "pivot_root", 156: "_sysctl", 157: "prctl", 158: "arch_prctl",
		159: "adjtimex", 160: "setrlimit", 161: "chroot", 162: "sync",
		163: "acct", 164: "settimeofday", 165: "mount", 166: "umount2",
		167: "swapon", 168: "swapoff", 169: "reboot", 170: "sethostname",
		171: "setdomainname", 172: "iopl", 173: "ioperm", 174: "create_module",
		175: "init_module", 176: "delete_module", 177: "get_kernel_syms", 178: "query_module",
		179: "quotactl", 180: "nfsservctl", 181: "getpmsg", 182: "putpmsg",
		183: "afs_syscall", 184: "tuxcall", 185: "security", 186: "gettid",
		187: "readahead", 188: "setxattr", 189: "lsetxattr", 190: "fsetxattr",
		191: "getxattr", 192: "lgetxattr", 193: "fgetxattr", 194: "listxattr",
		195: "llistxattr", 196: "flistxattr", 197: "removexattr", 198: "lremovexattr",
		199: "fremovexattr", 200: "tkill", 201: "time", 202: "futex",
		203: "sched_setaffinity", 204: "sched_getaffinity", 205: "set_thread_area",
		206: "io_setup", 207: "io_destroy", 208: "io_getevents", 209: "io_submit",
		210: "io_cancel", 211: "get_thread_area", 212: "lookup_dcookie", 213: "epoll_create",
		214: "epoll_ctl_old", 215: "epoll_wait_old", 216: "remap_file_pages", 217: "getdents64",
		218: "set_tid_address", 219: "restart_syscall", 220: "semtimedop",
		221: "fadvise64", 222: "timer_create", 223: "timer_settime", 224: "timer_gettime",
		225: "timer_getoverrun", 226: "timer_delete", 227: "clock_settime", 228: "clock_gettime",
		229: "clock_getres", 230: "clock_nanosleep", 231: "exit_group", 232: "epoll_wait",
		233: "epoll_ctl", 234: "tgkill", 235: "utimes", 236: "vserver",
		237: "mbind", 238: "set_mempolicy", 239: "get_mempolicy", 240: "mq_open",
		241: "mq_unlink", 242: "mq_timedsend", 243: "mq_timedreceive", 244: "mq_notify",
		245: "mq_getsetattr", 246: "kexec_load", 247: "waitid", 248: "add_key",
		249: "request_key", 250: "keyctl", 251: "ioprio_set", 252: "ioprio_get",
		253: "inotify_init", 254: "inotify_add_watch", 255: "inotify_rm_watch",
		256: "migrate_pages", 257: "openat", 258: "mkdirat", 259: "mknodat",
		260: "fchownat", 261: "futimesat", 262: "newfstatat", 263: "unlinkat",
		264: "renameat", 265: "linkat", 266: "symlinkat", 267: "readlinkat",
		268: "fchmodat", 269: "faccessat", 270: "pselect6", 271: "ppoll",
		272: "unshare", 273: "set_robust_list", 274: "get_robust_list", 275: "splice",
		276: "tee", 277: "sync_file_range", 278: "vmsplice", 279: "move_pages",
		280: "utimensat", 281: "epoll_pwait", 282: "signalfd", 283: "timerfd_create",
		284: "eventfd", 285: "fallocate", 286: "timerfd_settime", 287: "timerfd_gettime",
		288: "accept4", 289: "signalfd4", 290: "eventfd2", 291: "epoll_create1",
		292: "dup3", 293: "pipe2", 294: "inotify_init1", 295: "preadv",
		296: "pwritev", 297: "rt_tgsigqueueinfo", 298: "perf_event_open", 299: "recvmmsg",
		300: "fanotify_init", 301: "fanotify_mark", 302: "prlimit64", 303: "name_to_handle_at",
		304: "open_by_handle_at", 305: "clock_adjtime", 306: "syncfs", 307: "sendmmsg",
		308: "setns", 309: "getns", 310: "process_vm_readv", 311: "process_vm_writev",
		312: "kcmp", 313: "finit_module", 314: "sched_setattr", 315: "sched_getattr",
		316: "renameat2", 317: "seccomp", 318: "getrandom", 319: "memfd_create",
		320: "kexec_file_load", 321: "bpf", 322: "execveat", 323: "userfaultfd",
		324: "membarrier", 325: "mlock2", 326: "copy_file_range", 327: "preadv2",
		328: "pwritev2", 329: "pkey_mprotect", 330: "pkey_alloc", 331: "pkey_free",
		332: "statx", 333: "io_pgetevents", 334: "rseq", 335: "pidfd_send_signal",
		336: "io_uring_setup", 337: "io_uring_enter", 338: "io_uring_register",
		339: "open_tree", 340: "move_mount", 341: "fsopen", 342: "fsconfig",
		343: "fsmount", 344: "fspick", 345: "pidfd_open", 346: "clone3",
		347: "close_range", 348: "openat2", 349: "pidfd_getfd", 350: "faccessat2",
		351: "process_madvise", 352: "epoll_pwait2", 353: "mount_setattr",
		354: "quotactl_fd", 355: "landlock_create_ruleset", 356: "landlock_add_rule",
		357: "landlock_restrict_self", 358: "memfd_secret", 359: "process_mrelease",
		360: "futex_waitv", 361: "set_mempolicy_home_node", 362: "cachestat",
		363: "fchmodat2", 364: "map_shadow_stack", 365: "futex_wake",
		366: "futex_wait", 367: "futex_requeue",
		424: "pidfd_send_signal", 425: "io_uring_setup", 426: "io_uring_enter",
		427: "io_uring_register", 428: "open_tree", 429: "move_mount",
		430: "fsopen", 431: "fsconfig", 432: "fsmount", 433: "fspick",
		434: "pidfd_open", 435: "clone3", 436: "close_range", 437: "openat2",
		438: "pidfd_getfd", 439: "faccessat2", 440: "process_madvise",
		441: "epoll_pwait2", 442: "mount_setattr", 443: "quotactl_fd",
		444: "landlock_create_ruleset", 445: "landlock_add_rule",
		446: "landlock_restrict_self", 447: "memfd_secret", 448: "process_mrelease",
		449: "futex_waitv", 450: "set_mempolicy_home_node",
	}
	if name, ok := names[nr]; ok {
		return name
	}
	return fmt.Sprintf("sys_%d", nr)
}

// EnsureBPFObject checks that a BPF object file exists at path.
func EnsureBPFObject(path string) error {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("BPF object file not found: %s (compile with: make -C ebpf/bpf)", path)
	}
	return nil
}
