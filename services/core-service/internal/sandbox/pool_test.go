package sandbox

import (
	"context"
	"sync"
	"testing"
)

func TestPool_AcquireRelease(t *testing.T) {
	mock := &MockSandboxManager{}
	pool := NewPool(mock, 5)

	ctx := context.Background()
	sb, err := pool.Acquire(ctx, LevelStandard)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if sb.Status != StatusBusy {
		t.Errorf("Status = %v, want busy", sb.Status)
	}

	pool.Release(sb)
	if pool.Size() != 1 {
		t.Errorf("Size after release = %d, want 1", pool.Size())
	}
}

func TestPool_ConcurrentAccess(t *testing.T) {
	mock := &MockSandboxManager{}
	pool := NewPool(mock, 10)
	ctx := context.Background()

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sb, err := pool.Acquire(ctx, LevelStandard)
			if err != nil {
				t.Errorf("Acquire: %v", err)
				return
			}
			pool.Release(sb)
		}()
	}
	wg.Wait()
}

func TestPool_Prealloc(t *testing.T) {
	mock := &MockSandboxManager{}
	pool := NewPool(mock, 10)

	pool.StartPrealloc(context.Background(), 5, LevelStandard)
	if pool.Size() != 5 {
		t.Errorf("Size after prealloc = %d, want 5", pool.Size())
	}
}
