package sandbox

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// LocalSandboxManager executes binaries locally with resource limits.
// This is a simple implementation for M3. M5 will provide Docker/nsjail sandboxing.
type LocalSandboxManager struct{}

// NewLocalSandboxManager creates a new local sandbox manager.
func NewLocalSandboxManager() *LocalSandboxManager {
	return &LocalSandboxManager{}
}

func (m *LocalSandboxManager) Acquire(_ context.Context, level SandboxLevel) (*SandboxInstance, error) {
	return &SandboxInstance{
		ID:     fmt.Sprintf("local-%d-%d", level, time.Now().UnixNano()),
		Level:  level,
		Status: StatusBusy,
		CreatedAt: time.Now(),
	}, nil
}

func (m *LocalSandboxManager) Execute(ctx context.Context, sb *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var tracePath string
	var cmd *exec.Cmd

	// Prefer strace-based execution for syscall tracing, but never let a
	// missing/unsupported tracer prevent the binary from running. If strace is
	// unavailable we fall back to direct execution so evaluation still works.
	if sb != nil && sb.DisableTrace {
		cmd = exec.CommandContext(ctx, binary)
	} else if _, lookErr := exec.LookPath("strace"); lookErr != nil {
		log.Printf("[Sandbox] strace not found (%v); running %s directly without tracing", lookErr, binary)
		cmd = exec.CommandContext(ctx, binary)
	} else {
		traceFile, err := os.CreateTemp("", "traceos-strace-*.log")
		if err == nil {
			tracePath = traceFile.Name()
			traceFile.Close()
		}
		if tracePath != "" {
			cmd = exec.CommandContext(ctx, "strace", "-f", "-tt", "-T", "-k", "-o", tracePath, binary)
		} else {
			cmd = exec.CommandContext(ctx, binary)
		}
	}

	if len(stdin) > 0 {
		cmd.Stdin = bytes.NewReader(stdin)
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}

	// Ensure process group is killed when context is done (timeout or cancel)
	// This prevents stuck processes from stale strace + signal-handling combos
	go func() {
		<-ctx.Done()
		if cmd.Process != nil {
			pgid, err := syscall.Getpgid(cmd.Process.Pid)
			if err == nil {
				syscall.Kill(-pgid, syscall.SIGKILL)
			} else {
				cmd.Process.Kill()
			}
		}
	}()

	start := time.Now()
	err := cmd.Run()
	elapsed := time.Since(start)

	result := &ExecResult{
		Stdout:    stdout.String(),
		Stderr:    stderr.String(),
		ExecTime:  elapsed,
		TraceFile: tracePath,
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else if ctx.Err() == context.DeadlineExceeded {
			result.Killed = true
			result.ExitCode = -1
		} else {
			result.ExitCode = -1
			result.Stderr += "\n" + err.Error()
		}
	}

	return result, nil
}

// ExecuteEBPF is not supported in local mode — use nsjail for eBPF.
func (m *LocalSandboxManager) ExecuteEBPF(ctx context.Context, si *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error) {
	return nil, fmt.Errorf("ExecuteEBPF not supported with local backend")
}

// WaitEBPF is not supported in local mode.
func (m *LocalSandboxManager) WaitEBPF(si *SandboxInstance) (*ExecResult, error) {
	return nil, fmt.Errorf("WaitEBPF not supported with local backend")
}

func (m *LocalSandboxManager) Release(_ *SandboxInstance) error {
	return nil
}

func (m *LocalSandboxManager) Shutdown() error {
	return nil
}
