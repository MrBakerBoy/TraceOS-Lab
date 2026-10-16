// Package ebpf provides the v2 global-singleton eBPF tracer for TraceOS Lab.
//
// Architecture (global singleton, per-sandbox isolation):
//
//    Service startup: LoadV2() loads 3 BPF objects ONCE, attaches all
//                     tracepoints. 4 ring buffers stream events continuously.
//
//    Per-evaluation:   AllocSandbox() → creates inner map in HASH_OF_MAPS
//                      InjectPID()    → adds student PID to inner map
//                      BPF emits events tagged with sandbox_id
//                      DrainEvents()  → collect buffered events for analysis
//                      FreeSandbox()  → delete inner map, kernel auto-reclaims
//
//    Fallback:         IsEBPFAvailable() returns false → strace path
//
// Ring buffer demux:
//    4 goroutines (syscall, futex, mem, lifecycle) continuously read from
//    their respective ring buffers and demux events by sandbox_id into
//    per-sandbox buffered channels. No per-task BPF loading — tracepoints
//    are attached globally once.
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

// ═══════════════════════════════════════════════════════════════════
// Public types
// ═══════════════════════════════════════════════════════════════════

// V2Event is the unified event type emitted by all v2 BPF programs.
// Different sources populate different fields — consumers should
// switch on Source to determine which fields are meaningful.
type V2Event struct {
	Source      string // "syscall", "futex", "mem", "lifecycle"
	SandboxID   uint32
	TimestampNs uint64

	// Syscall fields
	Pid         uint32
	Tid         uint32
	SyscallNr   uint32
	SyscallName string
	Args        [6]uint64
	Ret         int64
	DurationNs  uint64
	IsThread    bool

	// Futex fields
	FutexOp uint32
	Uaddr   uint64

	// Mem fields
	MemType uint32 // 1=BRK, 2=MMAP, 3=MUNMAP
	Size    uint64
	Addr    uint64

	// Lifecycle fields
	LCEventType uint32 // 1=CLONE, 2=EXEC, 3=EXIT
	ParentTid   uint32
	Comm        string
}

// V2EventHandler receives demuxed events for a specific sandbox.
type V2EventHandler func(event *V2Event)

// TraceMode describes the active tracing backend.
type TraceMode string

const (
	ModeCore   TraceMode = "ebpf_core"
	ModeNoCore TraceMode = "ebpf_nocore"
	ModeStrace TraceMode = "strace"
)

// ═══════════════════════════════════════════════════════════════════
// Global loader state
// ═══════════════════════════════════════════════════════════════════

// GlobalLoaderV2 is the singleton eBPF loader.  Created once at service
// startup via LoadV2().  All sandboxes share the same BPF programs and
// tracepoint attachments.
type GlobalLoaderV2 struct {
	mu        sync.Mutex
	mode      TraceMode
	running   atomic.Bool
	nextID    atomic.Uint32

	// Single collection holding all 3 BPF objects
	coll *ebpf.Collection

	// All tracepoint links (detach on shutdown)
	links []link.Link

	// Ring buffer readers (one per BPF ringbuf map)
	syscallRd    *ringbuf.Reader
	futexRd      *ringbuf.Reader
	memRd        *ringbuf.Reader
	lifecycleRd  *ringbuf.Reader

	// Sandbox state
	sandboxes map[uint32]*sandboxState
}

type sandboxState struct {
	sandboxID uint32
	innerMap  *ebpf.Map // the inner HASH map for this sandbox
	events    []*V2Event
	mu        sync.Mutex
}

var globalLoader *GlobalLoaderV2
var globalLoaderMu sync.Mutex

// ═══════════════════════════════════════════════════════════════════
// Raw C struct layouts (packed, little-endian — must match BPF side)
// ═══════════════════════════════════════════════════════════════════

// syscall_event from syscall_trace_v2.bpf.c (96 bytes packed)
type rawSyscallEvent struct {
	Pid         uint32
	Tid         uint32
	SyscallNr   uint32
	SandboxID   uint32
	Arg0        uint64
	Arg1        uint64
	Arg2        uint64
	Arg3        uint64
	Arg4        uint64
	Arg5        uint64
	Ret         int64
	DurationNs  uint64
	TimestampNs uint64
	IsThread    uint8
	_           [7]byte
}

// futex_event from futex_deadlock_v2.bpf.c (32 bytes packed)
type rawFutexEvent struct {
	Pid         uint32
	Tid         uint32
	Op          uint32
	SandboxID   uint32
	Uaddr       uint64
	TimestampNs uint64
}

// mem_event from mem_trace_v2.bpf.c (40 bytes packed)
type rawMemEvent struct {
	Pid         uint32
	Tid         uint32
	Type        uint32
	SandboxID   uint32
	Size        uint64
	Addr        uint64
	TimestampNs uint64
}

// lifecycle_event from trace_common_v2.h (48 bytes, naturally aligned)
type rawLifecycleEvent struct {
	Tid         uint32
	ParentTid   uint32
	EventType   uint32
	SandboxID   uint32
	IsThread    uint8
	_           [3]byte
	TimestampNs uint64
	Comm        [16]byte
}

// pid_key from trace_common_v2.h (16 bytes packed)
type rawPidKey struct {
	Tid       uint32
	_         [4]byte // padding to u64 alignment
	StartTime uint64
}

// ═══════════════════════════════════════════════════════════════════
// Detection
// ═══════════════════════════════════════════════════════════════════

// IsEBPFAvailable checks whether eBPF tracing can be used.
// Returns the recommended mode and whether it's available.
//
// Detection order:
//  1. Kernel version >= 5.4
//  2. CAP_BPF or CAP_SYS_ADMIN
//  3. CO-RE:  BTF present + _v2.bpf.o files present → ModeCore
//  4. NoCore: _v2_nocore.bpf.o present                 → ModeNoCore
//  5. Neither → ModeStrace
func IsEBPFAvailable(bpfDir string) (TraceMode, bool) {
	if !kernelVersionOK() {
		log.Printf("[ebpf-v2] kernel too old (need >= 5.4)")
		return ModeStrace, false
	}

	hasBTF := fileExists("/sys/kernel/btf/vmlinux")
	hasCoreObj := fileExists(bpfDir + "/syscall_trace_v2.bpf.o") &&
		fileExists(bpfDir + "/futex_deadlock_v2.bpf.o") &&
		fileExists(bpfDir + "/mem_trace_v2.bpf.o")

	if hasBTF && hasCoreObj {
		return ModeCore, true
	}

	hasNoCoreObj := fileExists(bpfDir + "/syscall_trace_v2_nocore.bpf.o")
	if hasNoCoreObj {
		return ModeNoCore, true
	}

	log.Printf("[ebpf-v2] no suitable BPF objects found in %s", bpfDir)
	return ModeStrace, false
}

// SelectMode is a convenience wrapper that returns the best available mode.
func SelectMode(bpfDir string) TraceMode {
	mode, ok := IsEBPFAvailable(bpfDir)
	if !ok {
		return ModeStrace
	}
	return mode
}

// ═══════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════

// LoadV2 loads all v2 BPF programs as a global singleton.
// Must be called once at service startup.  Idempotent — subsequent
// calls return the existing loader.
//
// bpfDir is the directory containing .bpf.o files
// (e.g. "services/core-service/bpf" or "ebpf/bpf").
func LoadV2(bpfDir string) (*GlobalLoaderV2, error) {
	globalLoaderMu.Lock()
	defer globalLoaderMu.Unlock()

	if globalLoader != nil && globalLoader.running.Load() {
		return globalLoader, nil
	}

	mode, ok := IsEBPFAvailable(bpfDir)
	if !ok {
		return nil, fmt.Errorf("eBPF not available")
	}

	_ = rlimit.RemoveMemlock()

	l := &GlobalLoaderV2{
		mode:      mode,
		sandboxes: make(map[uint32]*sandboxState),
	}

	// Determine which syscall object to load
	var syscallObj string
	switch mode {
	case ModeCore:
		syscallObj = bpfDir + "/syscall_trace_v2.bpf.o"
	case ModeNoCore:
		syscallObj = bpfDir + "/syscall_trace_v2_nocore.bpf.o"
	default:
		return nil, fmt.Errorf("unsupported mode: %s", mode)
	}

	// Load syscall tracer
	sysSpec, err := ebpf.LoadCollectionSpec(syscallObj)
	if err != nil {
		return nil, fmt.Errorf("load syscall spec: %w", err)
	}

	// Load futex tracer (CO-RE only for now — futex has no nocore variant)
	futexObj := bpfDir + "/futex_deadlock_v2.bpf.o"
	futexSpec, err := ebpf.LoadCollectionSpec(futexObj)
	if err != nil {
		// Futex is optional — log and continue
		log.Printf("[ebpf-v2] futex deadlock detector not available: %v (non-fatal)", err)
		futexSpec = nil
	}

	// Load mem tracer (CO-RE only for now)
	memObj := bpfDir + "/mem_trace_v2.bpf.o"
	memSpec, err := ebpf.LoadCollectionSpec(memObj)
	if err != nil {
		log.Printf("[ebpf-v2] memory tracer not available: %v (non-fatal)", err)
		memSpec = nil
	}

	// Merge futex and mem programs into the syscall collection.
	// The syscall collection owns the shared maps (sandbox_pids,
	// active_sandboxes, lifecycle_events).
	if futexSpec != nil {
		for name, prog := range futexSpec.Programs {
			if _, exists := sysSpec.Programs[name]; !exists {
				sysSpec.Programs[name] = prog
			}
		}
		for name, m := range futexSpec.Maps {
			if _, exists := sysSpec.Maps[name]; !exists {
				sysSpec.Maps[name] = m
			}
		}
	}

	if memSpec != nil {
		for name, prog := range memSpec.Programs {
			if _, exists := sysSpec.Programs[name]; !exists {
				sysSpec.Programs[name] = prog
			}
		}
		for name, m := range memSpec.Maps {
			if _, exists := sysSpec.Maps[name]; !exists {
				sysSpec.Maps[name] = m
			}
		}
	}

	// Load merged collection
	coll, err := ebpf.NewCollection(sysSpec)
	if err != nil {
		return nil, fmt.Errorf("load collection: %w", err)
	}
	l.coll = coll

	// Attach tracepoints
	if err := l.attachTracepoints(coll, futexSpec, memSpec); err != nil {
		coll.Close()
		return nil, fmt.Errorf("attach tracepoints: %w", err)
	}

	// Open ring buffer readers
	l.syscallRd, err = ringbuf.NewReader(coll.Maps["syscall_events"])
	if err != nil {
		l.closeAll()
		return nil, fmt.Errorf("open syscall ringbuf: %w", err)
	}

	if coll.Maps["futex_events"] != nil {
		l.futexRd, err = ringbuf.NewReader(coll.Maps["futex_events"])
		if err != nil {
			log.Printf("[ebpf-v2] futex ringbuf open failed: %v (non-fatal)", err)
		}
	}

	if coll.Maps["mem_events"] != nil {
		l.memRd, err = ringbuf.NewReader(coll.Maps["mem_events"])
		if err != nil {
			log.Printf("[ebpf-v2] mem ringbuf open failed: %v (non-fatal)", err)
		}
	}

	if coll.Maps["lifecycle_events"] != nil {
		l.lifecycleRd, err = ringbuf.NewReader(coll.Maps["lifecycle_events"])
		if err != nil {
			log.Printf("[ebpf-v2] lifecycle ringbuf open failed: %v (non-fatal)", err)
		}
	}

	l.running.Store(true)

	// Start demuxer goroutines
	go l.demuxSyscall()
	if l.futexRd != nil {
		go l.demuxFutex()
	}
	if l.memRd != nil {
		go l.demuxMem()
	}
	if l.lifecycleRd != nil {
		go l.demuxLifecycle()
	}

	globalLoader = l
	log.Printf("[ebpf-v2] global loader started (mode=%s)", mode)
	return l, nil
}

func (l *GlobalLoaderV2) attachTracepoints(coll *ebpf.Collection, futexSpec, memSpec *ebpf.CollectionSpec) error {
	// Syscall tracepoints
	tracepoints := map[string][2]string{
		"trace_syscall_enter": {"raw_syscalls", "sys_enter"},
		"trace_syscall_exit":  {"raw_syscalls", "sys_exit"},
		"trace_sched_fork":    {"sched", "sched_process_fork"},
		"trace_sched_exec":    {"sched", "sched_process_exec"},
		"trace_sched_exit":    {"sched", "sched_process_exit"},
	}

	// Futex tracepoint
	if futexSpec != nil {
		tracepoints["trace_futex_enter"] = [2]string{"syscalls", "sys_enter_futex"}
	}

	// Mem tracepoints
	if memSpec != nil {
		tracepoints["trace_enter_brk"] = [2]string{"syscalls", "sys_enter_brk"}
		tracepoints["trace_exit_brk"] = [2]string{"syscalls", "sys_exit_brk"}
		tracepoints["trace_enter_mmap"] = [2]string{"syscalls", "sys_enter_mmap"}
		tracepoints["trace_exit_mmap"] = [2]string{"syscalls", "sys_exit_mmap"}
		tracepoints["trace_enter_munmap"] = [2]string{"syscalls", "sys_enter_munmap"}
		tracepoints["trace_exit_munmap"] = [2]string{"syscalls", "sys_exit_munmap"}
	}

	for progName, tp := range tracepoints {
		prog := coll.Programs[progName]
		if prog == nil {
			log.Printf("[ebpf-v2] program %q not found in collection (skipping)", progName)
			continue
		}
		lk, err := link.Tracepoint(tp[0], tp[1], prog, nil)
		if err != nil {
			l.closeAll()
			return fmt.Errorf("attach %s/%s: %w", tp[0], tp[1], err)
		}
		l.links = append(l.links, lk)
		log.Printf("[ebpf-v2] attached %s/%s", tp[0], tp[1])
	}

	return nil
}

// ═══════════════════════════════════════════════════════════════════
// Sandbox lifecycle
// ═══════════════════════════════════════════════════════════════════

// AllocSandbox creates a new sandbox slot and inner PID map.
// Returns the sandbox_id for subsequent InjectPID / DrainEvents calls.
func (l *GlobalLoaderV2) AllocSandbox() (uint32, error) {
	if !l.running.Load() {
		return 0, fmt.Errorf("loader not running")
	}

	sandboxID := (l.nextID.Add(1) % 63) + 1  // range 1..63, 0 reserved as sentinel

	// Create inner map (HASH<pid_key, u64>, max 1024 entries)
	innerSpec := ebpf.MapSpec{
		Type:       ebpf.Hash,
		KeySize:    16, // struct pid_key (tid + pad + start_time)
		ValueSize:  8,  // u64 timestamp
		MaxEntries: 1024,
	}
	innerMap, err := ebpf.NewMap(&innerSpec)
	if err != nil {
		return 0, fmt.Errorf("create inner map: %w", err)
	}

	// Insert into HASH_OF_MAPS
	outerMap := l.coll.Maps["sandbox_pids"]
	if err := outerMap.Update(sandboxID, innerMap, ebpf.UpdateAny); err != nil {
		innerMap.Close()
		return 0, fmt.Errorf("insert into sandbox_pids: %w", err)
	}

	// Mark active
	activeMap := l.coll.Maps["active_sandboxes"]
	one := uint8(1)
	if err := activeMap.Update(sandboxID, one, ebpf.UpdateAny); err != nil {
		outerMap.Delete(sandboxID)
		innerMap.Close()
		return 0, fmt.Errorf("mark sandbox active: %w", err)
	}

	l.mu.Lock()
	l.sandboxes[sandboxID] = &sandboxState{
		sandboxID: sandboxID,
		innerMap:  innerMap,
		events:    make([]*V2Event, 0, 4096),
	}
	l.mu.Unlock()

	log.Printf("[ebpf-v2] sandbox %d allocated", sandboxID)
	return sandboxID, nil
}

// InjectPID adds a PID to the sandbox's tracking set.
//
// tid: host-side thread ID (from /proc/<pid>/stat)
// startTime: process start time in clock ticks since boot
//   (from /proc/<pid>/stat field 22)
//
// For non-CO-RE mode, also populates the pid_start_times map
// so BPF programs can look up start_time without BPF_CORE_READ.
func (l *GlobalLoaderV2) InjectPID(sandboxID uint32, tid uint32, startTime uint64) error {
	l.mu.Lock()
	state, ok := l.sandboxes[sandboxID]
	l.mu.Unlock()
	if !ok {
		return fmt.Errorf("sandbox %d not found", sandboxID)
	}

	// Write to inner map (HASH<pid_key, u64>)
	key := rawPidKey{Tid: tid, StartTime: startTime}
	val := uint64(0) // value is timestamp_ns (placeholder, BPF overwrites)
	if err := state.innerMap.Update(key, val, ebpf.UpdateAny); err != nil {
		return fmt.Errorf("inject PID %d: %w", tid, err)
	}

	// For non-CO-RE: also populate pid_start_times map
	if l.mode == ModeNoCore {
		if startTimesMap := l.coll.Maps["pid_start_times"]; startTimesMap != nil {
			_ = startTimesMap.Update(tid, startTime, ebpf.UpdateAny)
		}
	}

	return nil
}

// DrainEvents returns all buffered events for a sandbox.
// Call after execution completes.  Events are accumulated in-memory
// from ring buffer demux goroutines.
func (l *GlobalLoaderV2) DrainEvents(sandboxID uint32) []*V2Event {
	l.mu.Lock()
	state, ok := l.sandboxes[sandboxID]
	l.mu.Unlock()
	if !ok {
		return nil
	}

	state.mu.Lock()
	events := state.events
	state.events = make([]*V2Event, 0, 4096)
	state.mu.Unlock()

	return events
}

// FreeSandbox removes the sandbox from HASH_OF_MAPS.
// The kernel automatically reclaims the inner map.
func (l *GlobalLoaderV2) FreeSandbox(sandboxID uint32) {
	// Clear active flag
	if activeMap := l.coll.Maps["active_sandboxes"]; activeMap != nil {
		zero := uint8(0)
		_ = activeMap.Update(sandboxID, zero, ebpf.UpdateAny)
	}

	// Delete from HASH_OF_MAPS → kernel reclaims inner map
	if outerMap := l.coll.Maps["sandbox_pids"]; outerMap != nil {
		_ = outerMap.Delete(sandboxID)
	}

	l.mu.Lock()
	if state, ok := l.sandboxes[sandboxID]; ok {
		state.innerMap.Close()
		delete(l.sandboxes, sandboxID)
	}
	l.mu.Unlock()

	log.Printf("[ebpf-v2] sandbox %d freed", sandboxID)
}

// ═══════════════════════════════════════════════════════════════════
// Ring buffer demux (one goroutine per ring buffer)
// ═══════════════════════════════════════════════════════════════════

func (l *GlobalLoaderV2) dispatch(sandboxID uint32, evt *V2Event) {
	l.mu.Lock()
	state, ok := l.sandboxes[sandboxID]
	l.mu.Unlock()
	if !ok {
		return
	}
	state.mu.Lock()
	state.events = append(state.events, evt)
	state.mu.Unlock()
}

func (l *GlobalLoaderV2) demuxSyscall() {
	var raw rawSyscallEvent
	for l.running.Load() {
		record, err := l.syscallRd.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) {
				return
			}
			continue
		}

		if err := binary.Read(bytes.NewReader(record.RawSample), binary.LittleEndian, &raw); err != nil {
			continue
		}

		l.dispatch(raw.SandboxID, &V2Event{
			Source:      "syscall",
			SandboxID:   raw.SandboxID,
			Pid:         raw.Pid,
			Tid:         raw.Tid,
			SyscallNr:   raw.SyscallNr,
			SyscallName: syscallName(raw.SyscallNr),
			Args: [6]uint64{
				raw.Arg0, raw.Arg1, raw.Arg2,
				raw.Arg3, raw.Arg4, raw.Arg5,
			},
			Ret:         raw.Ret,
			DurationNs:  raw.DurationNs,
			TimestampNs: raw.TimestampNs,
			IsThread:    raw.IsThread != 0,
		})
	}
}

func (l *GlobalLoaderV2) demuxFutex() {
	var raw rawFutexEvent
	for l.running.Load() {
		record, err := l.futexRd.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) {
				return
			}
			continue
		}

		if err := binary.Read(bytes.NewReader(record.RawSample), binary.LittleEndian, &raw); err != nil {
			continue
		}

		l.dispatch(raw.SandboxID, &V2Event{
			Source:      "futex",
			SandboxID:   raw.SandboxID,
			Pid:         raw.Pid,
			Tid:         raw.Tid,
			FutexOp:     raw.Op,
			Uaddr:       raw.Uaddr,
			TimestampNs: raw.TimestampNs,
		})
	}
}

func (l *GlobalLoaderV2) demuxMem() {
	var raw rawMemEvent
	for l.running.Load() {
		record, err := l.memRd.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) {
				return
			}
			continue
		}

		if err := binary.Read(bytes.NewReader(record.RawSample), binary.LittleEndian, &raw); err != nil {
			continue
		}

		l.dispatch(raw.SandboxID, &V2Event{
			Source:      "mem",
			SandboxID:   raw.SandboxID,
			Pid:         raw.Pid,
			Tid:         raw.Tid,
			MemType:     raw.Type,
			Size:        raw.Size,
			Addr:        raw.Addr,
			TimestampNs: raw.TimestampNs,
		})
	}
}

func (l *GlobalLoaderV2) demuxLifecycle() {
	var raw rawLifecycleEvent
	for l.running.Load() {
		record, err := l.lifecycleRd.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) {
				return
			}
			continue
		}

		if err := binary.Read(bytes.NewReader(record.RawSample), binary.LittleEndian, &raw); err != nil {
			continue
		}

		l.dispatch(raw.SandboxID, &V2Event{
			Source:      "lifecycle",
			SandboxID:   raw.SandboxID,
			Tid:         raw.Tid,
			ParentTid:   raw.ParentTid,
			LCEventType: raw.EventType,
			IsThread:    raw.IsThread != 0,
			TimestampNs: raw.TimestampNs,
			Comm:        cstring(raw.Comm[:]),
		})
	}
}

// ═══════════════════════════════════════════════════════════════════
// Health check
// ═══════════════════════════════════════════════════════════════════

// HealthCheck verifies the loader is operational.
func (l *GlobalLoaderV2) HealthCheck() error {
	if l == nil || !l.running.Load() {
		return fmt.Errorf("loader not running")
	}
	// TODO: ring buffer drop counter check
	return nil
}

// IsRunning returns whether the loader is active.
func (l *GlobalLoaderV2) IsRunning() bool {
	return l != nil && l.running.Load()
}

// Mode returns the active trace mode.
func (l *GlobalLoaderV2) Mode() TraceMode {
	return l.mode
}

// ═══════════════════════════════════════════════════════════════════
// Shutdown
// ═══════════════════════════════════════════════════════════════════

// Shutdown stops all ring buffer consumers and detaches tracepoints.
func (l *GlobalLoaderV2) Shutdown() {
	l.running.Store(false)

	// Close ring buffer readers (stops demux goroutines)
	if l.syscallRd != nil {
		l.syscallRd.Close()
	}
	if l.futexRd != nil {
		l.futexRd.Close()
	}
	if l.memRd != nil {
		l.memRd.Close()
	}
	if l.lifecycleRd != nil {
		l.lifecycleRd.Close()
	}

	l.closeAll()

	globalLoaderMu.Lock()
	globalLoader = nil
	globalLoaderMu.Unlock()

	log.Printf("[ebpf-v2] loader shut down")
}

func (l *GlobalLoaderV2) closeAll() {
	for _, lk := range l.links {
		lk.Close()
	}
	l.links = nil
	if l.coll != nil {
		l.coll.Close()
		l.coll = nil
	}
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func kernelVersionOK() bool {
	// Read /proc/version and check major.minor >= 5.4
	data, err := os.ReadFile("/proc/version")
	if err != nil {
		return false
	}
	// "Linux version 5.15.0-..." → extract "5.15"
	var major, minor int
	if _, err := fmt.Sscanf(string(data), "Linux version %d.%d", &major, &minor); err != nil {
		return false
	}
	return major > 5 || (major == 5 && minor >= 4)
}

func cstring(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

// syscallName maps x86_64 syscall numbers to human-readable names.
func syscallName(nr uint32) string {
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
		72: "fcntl", 73: "flock", 74: "fsync", 75: "fdatasync",
		76: "truncate", 77: "ftruncate", 78: "getdents", 79: "getcwd",
		80: "chdir", 81: "fchdir", 82: "rename", 83: "mkdir",
		84: "rmdir", 85: "creat", 86: "link", 87: "unlink",
		88: "symlink", 89: "readlink", 90: "chmod", 91: "fchmod",
		92: "chown", 93: "fchown", 94: "lchown", 95: "umask",
		96: "gettimeofday", 97: "getrlimit", 98: "getrusage", 99: "sysinfo",
		100: "times", 101: "ptrace", 102: "getuid",
		104: "getgid", 105: "setuid", 106: "setgid", 107: "geteuid",
		108: "getegid", 109: "setpgid", 110: "getppid", 111: "getpgrp",
		112: "setsid", 113: "setreuid", 114: "setregid",
		131: "sigaltstack", 132: "utime", 133: "mknod",
		137: "statfs", 138: "fstatfs",
		157: "prctl", 158: "arch_prctl",
		160: "setrlimit", 161: "chroot", 162: "sync",
		165: "mount", 166: "umount2",
		186: "gettid",
		202: "futex",
		203: "sched_setaffinity", 204: "sched_getaffinity",
		213: "epoll_create", 217: "getdents64",
		218: "set_tid_address",
		228: "clock_gettime", 229: "clock_getres",
		230: "clock_nanosleep", 231: "exit_group", 232: "epoll_wait",
		233: "epoll_ctl", 234: "tgkill",
		257: "openat", 258: "mkdirat", 259: "mknodat",
		260: "fchownat", 262: "newfstatat", 263: "unlinkat",
		264: "renameat", 265: "linkat", 266: "symlinkat", 267: "readlinkat",
		268: "fchmodat", 269: "faccessat",
		272: "unshare", 273: "set_robust_list", 274: "get_robust_list",
		281: "epoll_pwait", 288: "accept4", 291: "epoll_create1",
		292: "dup3", 293: "pipe2",
		302: "prlimit64",
		317: "seccomp", 318: "getrandom", 319: "memfd_create",
		321: "bpf", 322: "execveat",
		332: "statx", 334: "rseq",
		435: "clone3",
	}
	if name, ok := names[nr]; ok {
		return name
	}
	return fmt.Sprintf("sys_%d", nr)
}