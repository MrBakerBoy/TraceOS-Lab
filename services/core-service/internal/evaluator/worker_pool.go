package evaluator

import (
	"fmt"
	"runtime/debug"
	"context"
	"log"
	"sync"
	"time"

	"github.com/traceos-lab/core-service/internal/repository"
)

const (
	DefaultWorkers   = 4
	DefaultQueueSize = 100
	PerTaskTimeout   = 300 * time.Second
)

// Task represents a single evaluation job.
type Task struct {
	SubmissionID string
	ExperimentID string
	StudentID    string
}

// WorkerPool manages a pool of concurrent evaluation workers.
type WorkerPool struct {
	pipeline *Pipeline
	subRepo  *repository.SubmissionRepo
	taskChan chan Task
	workers  int
	wg       sync.WaitGroup
	ctx      context.Context
	cancel   context.CancelFunc
	onComplete func(Task)
}

// NewWorkerPool creates a new worker pool.
func NewWorkerPool(pipeline *Pipeline, subRepo *repository.SubmissionRepo, workers int) *WorkerPool {
	if workers <= 0 {
		workers = DefaultWorkers
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &WorkerPool{
		pipeline: pipeline,
		subRepo:  subRepo,
		taskChan: make(chan Task, DefaultQueueSize),
		workers:  workers,
		ctx:      ctx,
		cancel:   cancel,
	}
}

// SetOnComplete registers a callback invoked after each task finishes (both
// normal completion and timeout). Used to trigger achievement evaluation.
func (wp *WorkerPool) SetOnComplete(fn func(Task)) {
	wp.onComplete = fn
}

// Start launches all worker goroutines.
func (wp *WorkerPool) Start() {
	for i := 0; i < wp.workers; i++ {
		wp.wg.Add(1)
		go wp.worker(i)
	}
	log.Printf("[WorkerPool] %d workers started", wp.workers)
}

// Submit enqueues a task. Returns false if the queue is full.
func (wp *WorkerPool) Submit(task Task) bool {
	select {
	case wp.taskChan <- task:
		return true
	default:
		log.Printf("[WorkerPool] queue full, rejecting task %s", task.SubmissionID)
		return false
	}
}

// Shutdown gracefully stops all workers.
func (wp *WorkerPool) Shutdown() {
	wp.cancel()
	wp.wg.Wait()
	close(wp.taskChan)
	log.Println("[WorkerPool] all workers stopped")
}

func (wp *WorkerPool) worker(id int) {
	defer wp.wg.Done()
	for {
		select {
		case <-wp.ctx.Done():
			return
		case task := <-wp.taskChan:
			wp.processTask(id, task)
		}
	}
}

func (wp *WorkerPool) processTask(workerID int, task Task) {
	// Per-task context with timeout
	ctx, cancel := context.WithTimeout(wp.ctx, PerTaskTimeout)
	defer cancel()

	log.Printf("[Worker-%d] processing submission %s for experiment %s", workerID, task.SubmissionID, task.ExperimentID)

	// Mark as running
	_ = wp.subRepo.UpdateResult(ctx, task.SubmissionID, "running", 0, 0, 0, 0, nil, nil, nil, nil)

	done := make(chan struct{})
	go func() {
		defer close(done)
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[Worker-%d] PANIC in pipeline for %s: %v\nstack: %s", workerID, task.SubmissionID, r, debug.Stack())
				errMsg := fmt.Sprintf("internal evaluation panic: %v", r)
				_ = wp.subRepo.UpdateResult(context.Background(), task.SubmissionID, "failed", 0, 0, 0, 0, &errMsg, nil, nil, nil)
			}
		}()
		_ = wp.pipeline.Run(ctx, task.SubmissionID, task.ExperimentID, task.StudentID)
	}()

	select {
	case <-done:
		// Completed normally
	case <-ctx.Done():
		log.Printf("[Worker-%d] timeout for submission %s, marking failed", workerID, task.SubmissionID)
		errMsg := "evaluation timeout (60s)"
		_ = wp.subRepo.UpdateResult(context.Background(), task.SubmissionID, "failed", 0, 0, 0, 0, &errMsg, nil, nil, nil)
	}

	if wp.onComplete != nil {
		wp.onComplete(task)
	}
}
