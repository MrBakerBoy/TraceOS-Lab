package ebpf

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/sandbox"
)

// RunResult holds the output of an eBPF-traced sandbox execution.
type RunResult struct {
	// Test result from sandbox execution
	Stdout   string
	Stderr   string
	ExitCode int
	Killed   bool
	ExecTime time.Duration

	// Trace records derived from eBPF events
	TraceRecords []repository.SyscallTraceRecord
}

// Adapter bridges the eBPF loader and sandbox manager to the pipeline.
// It handles the full eBPF lifecycle for a single evaluation.
type Adapter struct {
	loader   *GlobalLoaderV2
	sandboxMgr sandbox.SandboxManager
	bpfDir   string
}

// NewAdapter creates a new eBPF adapter.
func NewAdapter(loader *GlobalLoaderV2, sm sandbox.SandboxManager, bpfDir string) *Adapter {
	return &Adapter{loader: loader, sandboxMgr: sm, bpfDir: bpfDir}
}

// IsAvailable returns whether eBPF tracing is available.
func (a *Adapter) IsAvailable() bool {
	if a.loader == nil || !a.loader.IsRunning() {
		return false
	}
	return a.loader.HealthCheck() == nil
}

// RunWithEBPF runs the binary in a sandbox with eBPF tracing.
//
// Flow:
//  1. Allocate sandbox slot in BPF (HASH_OF_MAPS)
//  2. Start nsjail in background (no strace)
//  3. Locate the student binary's host-side PID
//  4. Inject PID into BPF tracker
//  5. Wait for nsjail to complete
//  6. Drain BPF ring buffer events
//  7. Free sandbox slot
func (a *Adapter) RunWithEBPF(ctx context.Context, binaryPath string, stdin []byte, level sandbox.SandboxLevel, timeout time.Duration, submissionID string) (*RunResult, error) {
	// 1. Allocate sandbox
	sandboxID, err := a.loader.AllocSandbox()
	if err != nil {
		return nil, fmt.Errorf("alloc sandbox: %w", err)
	}
	defer a.loader.FreeSandbox(sandboxID)

	// 2. Acquire sandbox instance + mark for eBPF mode
	si, err := a.sandboxMgr.Acquire(ctx, level)
	if err != nil {
		return nil, fmt.Errorf("acquire sandbox: %w", err)
	}
	si.DisableTrace = true // triggers eBPF mode in nsjail manager
	defer a.sandboxMgr.Release(si)

	// 3. Start nsjail in background
	_, err = a.sandboxMgr.ExecuteEBPF(ctx, si, binaryPath, stdin, timeout)
	if err != nil {
		return nil, fmt.Errorf("start nsjail (ebpf): %w", err)
	}

	// 4. Locate student binary PID
	binaryName := filepath.Base(binaryPath)
	studentPID, err := sandbox.LocateStudentPID(si.HostPID, binaryName, 5*time.Second)
	if err != nil {
		// Best effort — some binaries finish before we find them
		log.Printf("[ebpf-adapter] failed to locate student PID: %v (continuing)", err)
	} else {
		// 5. Get start time and inject PID
		startTime, err := sandbox.GetStudentStartTime(studentPID)
		if err != nil {
			log.Printf("[ebpf-adapter] failed to get start time for PID %d: %v", studentPID, err)
		} else {
			if err := a.loader.InjectPID(sandboxID, uint32(studentPID), startTime); err != nil {
				log.Printf("[ebpf-adapter] failed to inject PID %d: %v", studentPID, err)
			} else {
				log.Printf("[ebpf-adapter] injected PID %d (start_time=%d) into sandbox %d",
					studentPID, startTime, sandboxID)
			}
		}
	}

	// 6. Wait for nsjail to complete
	result, err := a.sandboxMgr.WaitEBPF(si)
	if err != nil {
		return nil, fmt.Errorf("wait nsjail: %w", err)
	}

	// 7. Drain eBPF events
	events := a.loader.DrainEvents(sandboxID)

	// 8. Convert events to trace records
	traces := convertEventsToRecords(events, submissionID, result.ExecTime)

	return &RunResult{
		Stdout:       result.Stdout,
		Stderr:       result.Stderr,
		ExitCode:     result.ExitCode,
		Killed:       result.Killed,
		ExecTime:     result.ExecTime,
		TraceRecords: traces,
	}, nil
}

// convertEventsToRecords converts V2Event array to SyscallTraceRecord array.
// Only syscall events are included; futex, mem, and lifecycle events
// are stored separately via their own collection paths.
func convertEventsToRecords(events []*V2Event, submissionID string, baseTime time.Duration) []repository.SyscallTraceRecord {
	if len(events) == 0 {
		return nil
	}

	// Find the minimum timestamp among syscall events as baseline.
	// BPF timestamps are absolute boottime nanoseconds, not relative
	// to execution start. We normalize them here.
	var minTs uint64 = ^uint64(0)
	for _, evt := range events {
		if evt.Source == "syscall" && evt.TimestampNs < minTs {
			minTs = evt.TimestampNs
		}
	}
	if minTs == ^uint64(0) {
		return nil
	}

	var records []repository.SyscallTraceRecord
	execStart := time.Now().Add(-baseTime)

	for _, evt := range events {
		if evt.Source != "syscall" {
			continue
		}
		relativeNs := evt.TimestampNs - minTs
		recordTime := execStart.Add(time.Duration(relativeNs) * time.Nanosecond)
		records = append(records, repository.SyscallTraceRecord{
			Time:         recordTime,
			SubmissionID: submissionID,
			PID:          int(evt.Pid),
			SyscallName:  evt.SyscallName,
			Args:         argsToMap(evt),
			ReturnValue:  evt.Ret,
			ErrorName:    errnoName(evt.Ret),
			DurationNs:   int64(evt.DurationNs),
		})
	}

	return records
}

// argsToMap converts raw syscall args to the map format expected by SyscallTraceRecord.
func argsToMap(evt *V2Event) map[string]interface{} {
	m := make(map[string]interface{})
	m["a0"] = evt.Args[0]
	m["a1"] = evt.Args[1]
	m["a2"] = evt.Args[2]
	m["a3"] = evt.Args[3]
	m["a4"] = evt.Args[4]
	m["a5"] = evt.Args[5]
	return m
}

// errnoName returns the errno name for a negative return value.
func errnoName(ret int64) string {
	if ret >= 0 {
		return ""
	}
	errno := -ret
	switch errno {
	case 1: return "EPERM"
	case 2: return "ENOENT"
	case 3: return "ESRCH"
	case 4: return "EINTR"
	case 5: return "EIO"
	case 6: return "ENXIO"
	case 9: return "EBADF"
	case 11: return "EAGAIN"
	case 12: return "ENOMEM"
	case 13: return "EACCES"
	case 14: return "EFAULT"
	case 17: return "EEXIST"
	case 19: return "ENODEV"
	case 20: return "ENOTDIR"
	case 21: return "EISDIR"
	case 22: return "EINVAL"
	case 28: return "ENOSPC"
	case 32: return "EPIPE"
	case 38: return "ENOSYS"
	case 110: return "ETIMEDOUT"
	default: return fmt.Sprintf("ERRNO_%d", errno)
	}
}

// EnsureBPFObjectDir checks that BPF objects are available for loading.
func EnsureBPFObjectDir(bpfDir string) error {
	if _, err := os.Stat(bpfDir); os.IsNotExist(err) {
		return fmt.Errorf("BPF object directory not found: %s (compile with: make -C ebpf/bpf ebpf-v2-core)", bpfDir)
	}
	return nil
}

// Shutdown shuts down the eBPF loader and detaches all tracepoints.
func (a *Adapter) Shutdown() {
	if a.loader != nil {
		a.loader.Shutdown()
	}
}