package sandbox

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type nsjailSandbox struct {
	id      string
	workDir string
	level   SandboxLevel
	cmd     *exec.Cmd // background nsjail process (eBPF mode)
}

type NsjailSandboxManager struct {
	mu            sync.Mutex
	pool          map[string]*nsjailSandbox
	nextID        atomic.Int64
	nsjailBin     string
	workBase      string
	maxConcurrent int
	semaphore     chan struct{}
}

func NewNsjailSandboxManager() *NsjailSandboxManager {
	// Allow configuration via environment variables for container environments
	nsjailBin := os.Getenv("NSJAIL_BIN")
	if nsjailBin == "" {
		nsjailBin = "/usr/local/bin/nsjail"
	}
	workBase := os.Getenv("NSJAIL_WORK_DIR")
	if workBase == "" {
		workBase = "/tmp/traceos-nsjail"
	}
	maxConcStr := os.Getenv("NSJAIL_MAX_CONCURRENT")
	maxConc := 5
	if v, err := strconv.Atoi(maxConcStr); err == nil && v > 0 && v <= 20 {
		maxConc = v
	}

	m := &NsjailSandboxManager{
		pool:          make(map[string]*nsjailSandbox),
		nsjailBin:     nsjailBin,
		workBase:      workBase,
		maxConcurrent: maxConc,
		semaphore:     make(chan struct{}, maxConc),
	}
	_ = os.MkdirAll(m.workBase, 0o755)
	return m
}

func (m *NsjailSandboxManager) Acquire(ctx context.Context, level SandboxLevel) (*SandboxInstance, error) {
	select {
	case m.semaphore <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	id := fmt.Sprintf("nsjail-%d-%d", level, m.nextID.Add(1))
	workDir := filepath.Join(m.workBase, id)
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		<-m.semaphore
		return nil, fmt.Errorf("mkdir workdir: %w", err)
	}
	m.pool[id] = &nsjailSandbox{id: id, workDir: workDir, level: level}
	return &SandboxInstance{
		ID: id, ContainerID: id, Level: level,
		Status: StatusBusy, CreatedAt: time.Now(),
	}, nil
}

func (m *NsjailSandboxManager) Execute(ctx context.Context, si *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error) {
	m.mu.Lock()
	sb, ok := m.pool[si.ID]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("sandbox %s not found in pool", si.ID)
	}
	limits := resourceLimits(sb.level)
	cfgPath := filepath.Join(sb.workDir, "nsjail.cfg")
	traceDir := filepath.Join(sb.workDir, "strace-output")
	tracePath := filepath.Join(traceDir, "strace.log")
	if !si.DisableTrace {
		// Create host-side strace output dir so it can be bind-mounted into the jail
		os.MkdirAll(traceDir, 0o755)
		if err := writeNsjailConfig(cfgPath, binary, tracePath, traceDir, limits, timeout); err != nil {
			return nil, fmt.Errorf("write nsjail config: %w", err)
		}
	} else {
		if err := writeNsjailConfigNoTrace(cfgPath, binary, limits, timeout); err != nil {
			return nil, fmt.Errorf("write nsjail config: %w", err)
		}
	}
	ctx, cancel := context.WithTimeout(ctx, timeout+5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, m.nsjailBin, "--config", cfgPath)
	if len(stdin) > 0 {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	start := time.Now()
	err := cmd.Run()
	elapsed := time.Since(start)
	result := &ExecResult{Stdout: stdout.String(), Stderr: stderr.String(), ExecTime: elapsed}
	if si.DisableTrace {
		result.TraceFile = ""
	} else {
		result.TraceFile = tracePath
	}
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else if ctx.Err() == context.DeadlineExceeded {
			result.Killed = true
			result.ExitCode = -1
		} else {
			result.ExitCode = 137
			result.Killed = true
		}
	}
	result.MemoryUsage = parseMemoryUsage(stderr.String())
	return result, nil
}

// ExecuteEBPF starts a binary in eBPF mode (no strace wrapper).
// Starts nsjail in the background, sets si.HostPID, and returns
// immediately. The caller must locate the student binary PID,
// inject it into the eBPF tracker, then call WaitEBPF.
func (m *NsjailSandboxManager) ExecuteEBPF(ctx context.Context, si *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error) {
	m.mu.Lock()
	sb, ok := m.pool[si.ID]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("sandbox %s not found in pool", si.ID)
	}

	limits := resourceLimits(sb.level)
	cfgPath := filepath.Join(sb.workDir, "nsjail.cfg")
	if err := writeNsjailConfigNoTrace(cfgPath, binary, limits, timeout); err != nil {
		return nil, fmt.Errorf("write nsjail config: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, timeout+5*time.Second)
	// cancel is deferred until WaitEBPF; we leak intentionally for now.
	_ = cancel

	cmd := exec.CommandContext(ctx, m.nsjailBin, "--config", cfgPath)
	if len(stdin) > 0 {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("start nsjail: %w", err)
	}

	sb.cmd = cmd
	si.HostPID = cmd.Process.Pid

	return &ExecResult{
		Stdout:    stdout.String(),
		Stderr:    stderr.String(),
		TraceFile: "",
	}, nil
}

// WaitEBPF waits for a background eBPF-mode nsjail to complete.
func (m *NsjailSandboxManager) WaitEBPF(si *SandboxInstance) (*ExecResult, error) {
	m.mu.Lock()
	sb, ok := m.pool[si.ID]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("sandbox %s not found in pool", si.ID)
	}
	if sb.cmd == nil {
		return nil, fmt.Errorf("no background command for sandbox %s", si.ID)
	}

	start := time.Now()
	err := sb.cmd.Wait()
	elapsed := time.Since(start)

	var stdoutStr, stderrStr string
	if sb.cmd.Stdout != nil {
		if buf, ok := sb.cmd.Stdout.(*bytes.Buffer); ok {
			stdoutStr = buf.String()
		}
	}
	if sb.cmd.Stderr != nil {
		if buf, ok := sb.cmd.Stderr.(*bytes.Buffer); ok {
			stderrStr = buf.String()
		}
	}

	result := &ExecResult{
		Stdout:    stdoutStr,
		Stderr:    stderrStr,
		ExecTime:  elapsed,
		TraceFile: "",
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else if ctxErr := sb.cmd.ProcessState; ctxErr != nil && ctxErr.ExitCode() == -1 {
			result.Killed = true
			result.ExitCode = -1
		} else {
			result.ExitCode = 137
			result.Killed = true
		}
	}
	result.MemoryUsage = parseMemoryUsage(stderrStr)
	sb.cmd = nil
	return result, nil
}

// LocateStudentPID finds the host-side PID of the student binary
// running as a child of the nsjail process.
//
// nsjailPID is the host-side PID of the nsjail wrapper process.
// binaryName is the filename (not full path) of the student binary.
// Returns the child PID on success, or an error if not found
// within the timeout.
func LocateStudentPID(nsjailPID int, binaryName string, timeout time.Duration) (int, error) {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)

		taskDir := fmt.Sprintf("/proc/%d/task", nsjailPID)
		entries, err := os.ReadDir(taskDir)
		if err != nil {
			continue // process may not have task dir yet
		}

		for _, entry := range entries {
			tid, err := strconv.Atoi(entry.Name())
			if err != nil || tid == nsjailPID {
				continue
			}

			// Check children of this task
			childrenPath := fmt.Sprintf("/proc/%d/task/%s/children", nsjailPID, entry.Name())
			childrenData, err := os.ReadFile(childrenPath)
			if err != nil {
				continue
			}

			for _, field := range strings.Fields(string(childrenData)) {
				childPID, err := strconv.Atoi(field)
				if err != nil {
					continue
				}

				// Read comm to check if it matches the binary name
				commPath := fmt.Sprintf("/proc/%d/comm", childPID)
				commData, err := os.ReadFile(commPath)
				if err != nil {
					continue
				}

				comm := strings.TrimSpace(string(commData))
				if comm == binaryName {
					return childPID, nil
				}
			}
		}
	}

	return 0, fmt.Errorf("student binary %q not found under nsjail PID %d within %v", binaryName, nsjailPID, timeout)
}

// userHZ is the system's clock tick frequency, initialized once via init().
var userHZ uint64 = 100

func init() {
	// Detect CLK_TCK via getconf. On most x86_64 kernels this is 100.
	// Fall back to 100 if detection fails.
	out, err := exec.Command("getconf", "CLK_TCK").Output()
	if err == nil {
		hz, err := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 64)
		if err == nil && hz > 0 && hz <= 10000 {
			userHZ = hz
		}
	}
}

// GetStudentStartTime reads the process start time from /proc/<pid>/stat.
// Returns the start time in nanoseconds since boot, matching BPF's
// task->start_boottime (also in nanoseconds).
func GetStudentStartTime(pid int) (uint64, error) {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0, fmt.Errorf("read /proc/%d/stat: %w", pid, err)
	}
	// /proc/pid/stat format: pid (comm) state ... field22=starttime
	// The comm field may contain spaces and parentheses, so we
	// find the closing ')' and parse from there.
	closeParen := strings.LastIndexByte(string(data), ')')
	if closeParen == -1 {
		return 0, fmt.Errorf("malformed /proc/%d/stat", pid)
	}
	fields := strings.Fields(string(data[closeParen+2:]))
	if len(fields) < 20 {
		return 0, fmt.Errorf("too few fields in /proc/%d/stat", pid)
	}
	// field 22 in stat: index 19 after pid+comm removal
	ticks, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse starttime: %w", err)
	}
	// Convert ticks to nanoseconds: 1 tick = (1e9 / USER_HZ) ns
	// On HZ=100: 1 tick = 10,000,000 ns
	return ticks * (1_000_000_000 / userHZ), nil
}

func (m *NsjailSandboxManager) Release(si *SandboxInstance) error {
	m.mu.Lock()
	if sb, ok := m.pool[si.ID]; ok {
		delete(m.pool, si.ID)
		go func(dir string) { _ = os.RemoveAll(dir) }(sb.workDir)
	}
	m.mu.Unlock()
	<-m.semaphore
	return nil
}

func (m *NsjailSandboxManager) Shutdown() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, sb := range m.pool {
		_ = os.RemoveAll(sb.workDir)
		delete(m.pool, id)
	}
	return nil
}

type nsjailLimits struct {
	memLimitMB int
	cpuPercent int
	pidMax     int
	timeExtra  int
}

func resourceLimits(level SandboxLevel) nsjailLimits {
	switch level {
	case LevelHardened:
		return nsjailLimits{memLimitMB: 64, cpuPercent: 50, pidMax: 32, timeExtra: 3}
	case LevelSecure:
		return nsjailLimits{memLimitMB: 128, cpuPercent: 60, pidMax: 64, timeExtra: 3}
	default:
		return nsjailLimits{memLimitMB: 256, cpuPercent: 80, pidMax: 128, timeExtra: 3}
	}
}

func writeNsjailConfig(path, binary, tracePath, traceDir string, lim nsjailLimits, timeout time.Duration) error {
	timeSec := int(timeout.Seconds()) + lim.timeExtra
	cfg := "mode: ONCE\nmount_proc: true\n"
	cfg += fmt.Sprintf("mount { src: \"%s\" dst: \"/binary\" is_bind: true mandatory: true }\n", binary)
	cfg += "mount { src: \"none\" dst: \"/tmp\" is_bind: false fstype: \"tmpfs\" rw: true }\n"
	cfg += fmt.Sprintf("mount { src: \"%s\" dst: \"/trace-output\" is_bind: true rw: true }\n", traceDir)
	cfg += "clone_newuser: true\nclone_newpid: true\n"
	cfg += "clone_newuts: true\nclone_newipc: true\n"
	cfg += fmt.Sprintf("cgroup_mem_max: %d\ncgroup_pids_max: %d\ntime_limit: %d\n",
		lim.memLimitMB*1024*1024, lim.pidMax, timeSec)
	cfg += "exec_bin: \"/usr/bin/strace\"\nexec_args: [\"-tt\", \"-k\", \"-o\", \"/trace-output/strace.log\", \"/binary\"]\nexec_cwd: \"/tmp\"\n"
	return os.WriteFile(path, []byte(cfg), 0o644)
}

func writeNsjailConfigNoTrace(path, binary string, lim nsjailLimits, timeout time.Duration) error {
	timeSec := int(timeout.Seconds()) + lim.timeExtra
	cfg := "mode: ONCE\nmount_proc: true\n"
	cfg += fmt.Sprintf("mount { src: \"%s\" dst: \"/binary\" is_bind: true mandatory: true }\n", binary)
	cfg += "mount { src: \"none\" dst: \"/tmp\" is_bind: false fstype: \"tmpfs\" rw: true }\n"
	cfg += "clone_newuser: true\nclone_newpid: true\n"
	cfg += "clone_newuts: true\nclone_newipc: true\n"
	cfg += fmt.Sprintf("cgroup_mem_max: %d\ncgroup_pids_max: %d\ntime_limit: %d\n",
		lim.memLimitMB*1024*1024, lim.pidMax, timeSec)
	cfg += "exec_bin: \"/binary\"\nexec_cwd: \"/tmp\"\n"
	return os.WriteFile(path, []byte(cfg), 0o644)
}

func parseMemoryUsage(stderr string) int64 {
	for _, line := range strings.Split(stderr, "\n") {
		if strings.Contains(line, "memory.max_usage_in_bytes") {
			for _, p := range strings.Fields(line) {
				if v, err := strconv.ParseInt(p, 10, 64); err == nil && v > 0 {
					return v
				}
			}
		}
	}
	return 0
}
