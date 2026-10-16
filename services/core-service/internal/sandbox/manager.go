package sandbox

import (
	"context"
	"fmt"
	"time"
)

// SandboxManager defines the interface for sandbox lifecycle management.
type SandboxManager interface {
	// Acquire creates or retrieves a sandbox at the specified level.
	Acquire(ctx context.Context, level SandboxLevel) (*SandboxInstance, error)
	// Execute runs a binary inside a sandbox (strace mode, blocking).
	Execute(ctx context.Context, sandbox *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error)
	// ExecuteEBPF starts the binary in the sandbox background (eBPF mode).
	// Sets sandbox.HostPID to the host-side nsjail PID. The caller must
	// locate the student binary PID, inject it into the eBPF tracker,
	// then call WaitEBPF to collect the result.
	ExecuteEBPF(ctx context.Context, sandbox *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error)
	// WaitEBPF waits for a background eBPF-mode execution to complete
	// and returns the final ExecResult with exit code and resource usage.
	WaitEBPF(sandbox *SandboxInstance) (*ExecResult, error)
	// Release returns a sandbox to the pool or destroys it.
	Release(sandbox *SandboxInstance) error
	// Shutdown cleans up all sandboxes.
	Shutdown() error
}

// MockSandboxManager is a mock implementation for testing.
type MockSandboxManager struct {
	AcquireFn    func(ctx context.Context, level SandboxLevel) (*SandboxInstance, error)
	ExecuteFn    func(ctx context.Context, sandbox *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error)
	ExecuteEBPFFn func(ctx context.Context, sandbox *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error)
	WaitEBPFFn   func(sandbox *SandboxInstance) (*ExecResult, error)
	ReleaseFn    func(sandbox *SandboxInstance) error
	ShutdownFn   func() error
}

func (m *MockSandboxManager) Acquire(ctx context.Context, level SandboxLevel) (*SandboxInstance, error) {
	if m.AcquireFn != nil {
		return m.AcquireFn(ctx, level)
	}
	return &SandboxInstance{
		ID:     "mock-sandbox",
		Level:  level,
		Status: StatusIdle,
	}, nil
}

func (m *MockSandboxManager) Execute(ctx context.Context, sandbox *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error) {
	if m.ExecuteFn != nil {
		return m.ExecuteFn(ctx, sandbox, binary, stdin, timeout)
	}
	return &ExecResult{
		Stdout:   "mock output",
		ExitCode: 0,
	}, nil
}

func (m *MockSandboxManager) ExecuteEBPF(ctx context.Context, sandbox *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error) {
	if m.ExecuteEBPFFn != nil {
		return m.ExecuteEBPFFn(ctx, sandbox, binary, stdin, timeout)
	}
	return nil, fmt.Errorf("ExecuteEBPF not implemented in mock")
}

func (m *MockSandboxManager) WaitEBPF(sandbox *SandboxInstance) (*ExecResult, error) {
	if m.WaitEBPFFn != nil {
		return m.WaitEBPFFn(sandbox)
	}
	return nil, fmt.Errorf("WaitEBPF not implemented in mock")
}

func (m *MockSandboxManager) Release(sandbox *SandboxInstance) error {
	if m.ReleaseFn != nil {
		return m.ReleaseFn(sandbox)
	}
	return nil
}

func (m *MockSandboxManager) Shutdown() error {
	if m.ShutdownFn != nil {
		return m.ShutdownFn()
	}
	return nil
}
