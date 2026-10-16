package sandbox

import (
	"context"
	"fmt"
	"log"
	"time"
)

// SandboxPool manages a pool of pre-allocated sandboxes.
type SandboxPool struct {
	pool    chan *SandboxInstance
	manager SandboxManager
	maxSize int
}

// NewPool creates a new sandbox pool.
func NewPool(manager SandboxManager, maxSize int) *SandboxPool {
	return &SandboxPool{
		pool:    make(chan *SandboxInstance, maxSize),
		manager: manager,
		maxSize: maxSize,
	}
}

// Acquire gets a sandbox from the pool or creates a new one.
func (p *SandboxPool) Acquire(ctx context.Context, level SandboxLevel) (*SandboxInstance, error) {
	select {
	case sb := <-p.pool:
		sb.Status = StatusBusy
		return sb, nil
	default:
		sb, err := p.manager.Acquire(ctx, level)
		if err != nil {
			return nil, fmt.Errorf("pool: acquire sandbox: %w", err)
		}
		sb.Status = StatusBusy
		return sb, nil
	}
}

// Release returns a sandbox to the pool.
func (p *SandboxPool) Release(sandbox *SandboxInstance) error {
	sandbox.Status = StatusIdle
	select {
	case p.pool <- sandbox:
		return nil
	default:
		if err := p.manager.Release(sandbox); err != nil {
			log.Printf("[Pool] failed to release sandbox %s: %v", sandbox.ID, err)
			return err
		}
		return nil
	}
}

// Execute delegates execution to the underlying sandbox manager.
func (p *SandboxPool) Execute(ctx context.Context, sb *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error) {
	return p.manager.Execute(ctx, sb, binary, stdin, timeout)
}

// ExecuteEBPF delegates eBPF-mode execution to the underlying sandbox manager.
func (p *SandboxPool) ExecuteEBPF(ctx context.Context, sb *SandboxInstance, binary string, stdin []byte, timeout time.Duration) (*ExecResult, error) {
	return p.manager.ExecuteEBPF(ctx, sb, binary, stdin, timeout)
}

// WaitEBPF delegates eBPF-mode wait to the underlying sandbox manager.
func (p *SandboxPool) WaitEBPF(sb *SandboxInstance) (*ExecResult, error) {
	return p.manager.WaitEBPF(sb)
}

// Shutdown cleans up the pool and all sandboxes.
func (p *SandboxPool) Shutdown() error {
	close(p.pool)
	return p.manager.Shutdown()
}

// StartPrealloc pre-allocates sandboxes up to count.
func (p *SandboxPool) StartPrealloc(ctx context.Context, count int, level SandboxLevel) {
	for i := 0; i < count; i++ {
		sb, err := p.manager.Acquire(ctx, level)
		if err != nil {
			log.Printf("[Pool] prealloc failed: %v", err)
			continue
		}
		sb.Status = StatusIdle
		select {
		case p.pool <- sb:
		default:
			if err := p.manager.Release(sb); err != nil {
				log.Printf("[Pool] prealloc release failed: %v", err)
			}
		}
	}
	log.Printf("[Pool] pre-allocated %d sandboxes at level %d", count, level)
}

// Size returns the current number of idle sandboxes in the pool.
func (p *SandboxPool) Size() int {
	return len(p.pool)
}
