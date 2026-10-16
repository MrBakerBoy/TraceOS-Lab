package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/repository"
)

type ObserveTask struct {
	PID           int      `json:"pid"`
	Probes        []string `json:"probes"`
	Code          string
	SubmissionID  string                   `json:"submission_id,omitempty"`
	Status        string                   `json:"status"`
	StartAt       time.Time                `json:"start_at"`
	Deadlock      *DeadlockReport          `json:"deadlock,omitempty"`
	SyscallCounts map[string]int           `json:"syscall_counts,omitempty"`
	MemSnapshots  []map[string]interface{} `json:"mem_snapshots,omitempty"`
	lastGraph     LockGraphState
	cancel        context.CancelFunc
	mu            sync.RWMutex
	clients       map[chan string]struct{}
	clientsMu     sync.Mutex
}

type DeadlockReport struct {
	Detected bool     `json:"detected"`
	Cycle    []int    `json:"cycle,omitempty"`
	Details  []string `json:"details,omitempty"`
	Fix      string   `json:"fix,omitempty"`
}

type LockGraphState struct {
	Threads []ThreadNode `json:"threads"`
	Locks   []LockNode   `json:"locks"`
}

type ThreadNode struct {
	Tid int `json:"tid"`
}

type LockNode struct {
	Uaddr   string `json:"uaddr"`
	Holder  int    `json:"holder"`
	Waiters []int  `json:"waiters"`
}

type EBPFHandler struct {
	tasks        map[int]*ObserveTask
	mu           sync.RWMutex
	scriptsDir   string
	deadlockRepo *repository.DeadlockReportRepo
}

func NewEBPFHandler(scriptsDir string, deadlockRepo *repository.DeadlockReportRepo) *EBPFHandler {
	return &EBPFHandler{tasks: make(map[int]*ObserveTask), scriptsDir: scriptsDir, deadlockRepo: deadlockRepo}
}

type StartObserveRequest struct {
	PID          int      `json:"pid"`
	Probes       []string `json:"probes"`
	Code         string   `json:"code,omitempty"`
	SubmissionID string   `json:"submission_id,omitempty"`
}

func (h *EBPFHandler) StartObserve(c *gin.Context) {
	var req StartObserveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	usePID := req.PID
	if usePID <= 0 {
		usePID = 0
	}
	h.mu.Lock()
	if t, ok := h.tasks[usePID]; ok && t.Status == "running" {
		pid := t.PID
		h.mu.Unlock()
		c.JSON(200, gin.H{"pid": pid, "status": "already_running", "task_pid": pid})
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &ObserveTask{
		PID: usePID, Probes: req.Probes, Code: req.Code, Status: "running", StartAt: time.Now(),
		SubmissionID: req.SubmissionID,
		cancel:       cancel, clients: make(map[chan string]struct{}),
	}
	h.tasks[usePID] = task
	h.mu.Unlock()
	go h.runObservation(ctx, task)
	c.JSON(200, gin.H{"pid": usePID, "status": "started"})
}

func (h *EBPFHandler) GetObserve(c *gin.Context) {
	pid, _ := strconv.Atoi(c.Param("pid"))
	h.mu.RLock()
	task, ok := h.tasks[pid]
	h.mu.RUnlock()
	if !ok {
		c.JSON(404, gin.H{"error": "no observation"})
		return
	}
	task.mu.RLock()
	defer task.mu.RUnlock()
	c.JSON(200, gin.H{"pid": task.PID, "status": task.Status, "probes": task.Probes, "deadlock": task.Deadlock})
}

func (h *EBPFHandler) StopObserve(c *gin.Context) {
	pid, _ := strconv.Atoi(c.Param("pid"))
	h.mu.Lock()
	if t, ok := h.tasks[pid]; ok {
		t.cancel()
		delete(h.tasks, pid)
	}
	h.mu.Unlock()
	c.JSON(200, gin.H{"pid": pid, "status": "stopped"})
}

func (h *EBPFHandler) StreamEvents(c *gin.Context) {
	pid, _ := strconv.Atoi(c.Param("pid"))
	h.mu.RLock()
	task, ok := h.tasks[pid]
	h.mu.RUnlock()
	if !ok {
		c.JSON(404, gin.H{"error": "no observation"})
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", "*")

	ch := make(chan string, 64)
	task.clientsMu.Lock()
	task.clients[ch] = struct{}{}
	// Immediately send current graph state to newly connected client
	task.mu.RLock()
	currentGraph := task.lastGraph
	deadlockReport := task.Deadlock
	currentStatus := task.Status
	task.mu.RUnlock()
	task.clientsMu.Unlock()

	defer func() {
		task.clientsMu.Lock()
		delete(task.clients, ch)
		task.clientsMu.Unlock()
	}()

	// Send cached state on connect
	if len(currentGraph.Threads) > 0 || len(currentGraph.Locks) > 0 {
		data, _ := json.Marshal(map[string]interface{}{"type": "graph", "payload": currentGraph})
		fmt.Fprintf(c.Writer, "data: %s\n\n", string(data))
		c.Writer.Flush()
	}
	if deadlockReport != nil && deadlockReport.Detected {
		data, _ := json.Marshal(map[string]interface{}{"type": "deadlock", "payload": deadlockReport})
		fmt.Fprintf(c.Writer, "data: %s\n\n", string(data))
		c.Writer.Flush()
	}
	if currentStatus == "done" {
		if deadlockReport == nil || !deadlockReport.Detected {
			data, _ := json.Marshal(map[string]interface{}{"type": "safe", "payload": map[string]string{"msg": "No deadlock detected"}})
			fmt.Fprintf(c.Writer, "data: %s\n\n", string(data))
			c.Writer.Flush()
		}
	}

	clientGone := c.Request.Context().Done()
	for {
		select {
		case msg := <-ch:
			fmt.Fprintf(c.Writer, "data: %s\n\n", msg)
			c.Writer.Flush()
		case <-clientGone:
			return
		case <-time.After(10 * time.Second):
			fmt.Fprintf(c.Writer, ": keepalive\n\n")
			c.Writer.Flush()
		}
	}
}

func (t *ObserveTask) broadcast(msgType string, payload interface{}) {
	t.clientsMu.Lock()
	defer t.clientsMu.Unlock()
	data, _ := json.Marshal(map[string]interface{}{"type": msgType, "payload": payload})
	// Accumulate data for persistence
	switch msgType {
	case "graph":
		if gs, ok := payload.(LockGraphState); ok {
			t.mu.Lock()
			t.lastGraph = gs
			t.mu.Unlock()
		}
	case "syscall":
		if m, ok := payload.(map[string]interface{}); ok {
			name, _ := m["syscall"].(string)
			cnt, _ := m["count"].(float64)
			if t.SyscallCounts == nil {
				t.SyscallCounts = make(map[string]int)
			}
			t.SyscallCounts[name] += int(cnt)
		}
	case "mem":
		if m, ok := payload.(map[string]interface{}); ok {
			t.MemSnapshots = append(t.MemSnapshots, m)
		}
	}
	for ch := range t.clients {
		select {
		case ch <- string(data):
		default:
		}
	}
}

func (h *EBPFHandler) runObservation(ctx context.Context, task *ObserveTask) {
	defer func() {
		task.mu.Lock()
		task.Status = "done"
		task.mu.Unlock()
		task.broadcast("done", nil)

		// Persist observation results for historical traceability
		h.persistObservation(task)

		// Keep task alive 30s for late SSE connections, then clean up
		go func() {
			time.Sleep(30 * time.Second)
			h.mu.Lock()
			delete(h.tasks, task.PID)
			h.mu.Unlock()
		}()
	}()
	var wg sync.WaitGroup
	for _, probe := range task.Probes {
		switch probe {
		case "deadlock":
			wg.Add(1)
			go func() { defer wg.Done(); h.runDeadlockProbe(ctx, task) }()
		case "syscall":
			wg.Add(1)
			go func() { defer wg.Done(); h.runSyscallProbe(ctx, task) }()
		case "sched":
			wg.Add(1)
			go func() { defer wg.Done(); h.runSchedProbe(ctx, task) }()
		case "mem":
			wg.Add(1)
			go func() { defer wg.Done(); h.runMemProbe(ctx, task) }()
		}
	}
	wg.Wait()
}

// persistObservation saves key observation results so they survive the 30s
// task TTL. Results are persisted to the deadlock_reports table (associated with
// submission_id when available) so the frontend/AI can replay them later.
// A best-effort /tmp JSON copy is kept for diagnostics when the DB is unavailable.
func (h *EBPFHandler) persistObservation(task *ObserveTask) {
	if task == nil {
		return
	}

	// Build lock graph snapshot for the record.
	graph := task.lastGraph
	detected := task.Deadlock != nil && task.Deadlock.Detected
	var cycle []int
	var details []string
	var fix string
	if task.Deadlock != nil {
		cycle = task.Deadlock.Cycle
		details = task.Deadlock.Details
		fix = task.Deadlock.Fix
	}

	lockGraph := map[string]interface{}{
		"threads": graph.Threads,
		"locks":   graph.Locks,
	}

	// 1) Persist to DB when a repo is configured.
	if h.deadlockRepo != nil {
		rec := repository.DeadlockReportRecord{
			SubmissionID:  task.SubmissionID,
			PID:           task.PID,
			Detected:      detected,
			Cycle:         cycle,
			Details:       details,
			Fix:           fix,
			LockGraph:     lockGraph,
			SyscallCounts: task.SyscallCounts,
			MemSnapshots:  task.MemSnapshots,
			Probes:        task.Probes,
			Status:        task.Status,
		}
		dbCtx, dbCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer dbCancel()
		if id, err := h.deadlockRepo.InsertDeadlockReport(dbCtx, rec); err != nil {
			log.Printf("[ebpf:persist] DB insert error: %v (falling back to /tmp)", err)
		} else {
			log.Printf("[ebpf:persist] saved to deadlock_reports id=%s pid=%d detected=%v submission=%s",
				id, task.PID, detected, task.SubmissionID)
		}
	}

	// 2) Best-effort /tmp copy for diagnostics.
	type obsRecord struct {
		PID           int                      `json:"pid"`
		SubmissionID  string                   `json:"submission_id,omitempty"`
		Status        string                   `json:"status"`
		StartAt       time.Time                `json:"start_at"`
		SyscallCounts map[string]int           `json:"syscall_counts,omitempty"`
		Deadlock      *DeadlockReport          `json:"deadlock,omitempty"`
		MemSnapshots  []map[string]interface{} `json:"mem_snapshots,omitempty"`
		LockGraph     map[string]interface{}   `json:"lock_graph,omitempty"`
	}
	rec := obsRecord{
		PID:           task.PID,
		SubmissionID:  task.SubmissionID,
		Status:        task.Status,
		StartAt:       task.StartAt,
		SyscallCounts: task.SyscallCounts,
		Deadlock:      task.Deadlock,
		MemSnapshots:  task.MemSnapshots,
		LockGraph:     lockGraph,
	}
	if data, err := json.MarshalIndent(rec, "", "  "); err == nil {
		path := fmt.Sprintf("/tmp/traceos_obs_%d.json", task.PID)
		if err := os.WriteFile(path, data, 0644); err != nil {
			log.Printf("[ebpf:persist] tmp write error: %v", err)
		}
	}
}

// GetSubmissionDeadlock returns the most recent persisted deadlock report for a
// submission. GET /api/v1/ebpf/deadlock/:submission_id
func (h *EBPFHandler) GetSubmissionDeadlock(c *gin.Context) {
	submissionID := c.Param("submission_id")
	if h.deadlockRepo == nil {
		c.JSON(503, gin.H{"error": "deadlock persistence not configured"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	rec, err := h.deadlockRepo.GetDeadlockReport(ctx, submissionID)
	if err != nil {
		c.JSON(404, gin.H{"error": "no deadlock report for this submission", "detail": err.Error()})
		return
	}
	c.JSON(200, gin.H{
		"submission_id":  rec.SubmissionID,
		"detected":       rec.Detected,
		"cycle":          rec.Cycle,
		"details":        rec.Details,
		"fix":            rec.Fix,
		"lock_graph":     rec.LockGraph,
		"syscall_counts": rec.SyscallCounts,
		"probes":         rec.Probes,
		"status":         rec.Status,
	})
}

// ── Syscall Probe (bpftrace eBPF primary, strace fallback) ──
//
// Architecture:
//   1. PRIMARY: bpftrace syscall_trace.bt — true eBPF raw_syscalls tracepoint
//   2. FALLBACK: strace — works without bpftrace

func (h *EBPFHandler) runSyscallProbe(ctx context.Context, task *ObserveTask) {
	bpftracePath, _ := exec.LookPath("bpftrace")

	// PID > 0 means we're tracing a live process via its PID
	if task.PID > 0 {
		if bpftracePath != "" {
			h.runSyscallWithBpftrace(ctx, task, bpftracePath)
			return
		}
		// Fallback: strace for live PID
		log.Printf("[ebpf:syscall] bpftrace not available, falling back to strace for PID=%d", task.PID)
		cmd := exec.CommandContext(ctx, "strace", "-tt", "-p", strconv.Itoa(task.PID))
		stderr, _ := cmd.StderrPipe()
		if err := cmd.Start(); err != nil {
			task.broadcast("error", map[string]string{"msg": err.Error()})
			return
		}
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			if line != "" {
				parseStraceLine(line, task)
			}
		}
		cmd.Wait()
		return
	}

	// PID=0: compile user code, run with bpftrace tracing
	h.runSyscallDemo(ctx, task)
}

// runSyscallWithBpftrace uses bpftrace raw_syscalls tracepoints for zero-overhead tracing.
func (h *EBPFHandler) runSyscallWithBpftrace(ctx context.Context, task *ObserveTask, bpftracePath string) {
	// Build inline bpftrace script with PID filter
	syscallScript := h.scriptsDir + "/syscall_trace.bt"
	if !fileExists(syscallScript) {
		log.Printf("[ebpf:syscall] script not found: %s, falling back to strace", syscallScript)
		h.runSyscallFallbackStrace(ctx, task)
		return
	}

	cmd := exec.CommandContext(ctx, bpftracePath, "-B", "none", syscallScript, strconv.Itoa(task.PID))
	stderr, _ := cmd.StderrPipe()
	stdout, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		log.Printf("[ebpf:syscall] bpftrace start error: %v, falling back to strace", err)
		h.runSyscallFallbackStrace(ctx, task)
		return
	}

	// Parse per-call trace_event JSONL and aggregated stats from stdout
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "Attaching") {
				continue
			}
			// Per-call trace event (JSONL from syscall_trace.bt)
			if strings.HasPrefix(line, "{") {
				var event map[string]interface{}
				if err := json.Unmarshal([]byte(line), &event); err == nil {
					if event["type"] == "trace_event" {
						task.broadcast("trace_event", event)
					}
					continue
				}
			}
			// Parse bpftrace aggregated map output: @sc_count[1]: 1234
			if strings.Contains(line, "@sc[") {
				parts := strings.SplitN(line, "]:", 2)
				if len(parts) == 2 {
					countStr := strings.TrimSpace(parts[1])
					if count, err := strconv.Atoi(countStr); err == nil {
						nrStr := strings.TrimPrefix(parts[0], "@sc[")
						nrStr = strings.TrimSuffix(nrStr, "]")
						if nr, err := strconv.Atoi(nrStr); err == nil {
							task.broadcast("syscall", map[string]interface{}{
								"syscall": syscallName(int32(nr)),
								"count":   count,
							})
						}
					}
				}
			}
		}
		// Drain stderr for debug
		errScanner := bufio.NewScanner(stderr)
		for errScanner.Scan() {
			log.Printf("[ebpf:bpftrace:syscall] %s", errScanner.Text())
		}
	}()

	<-ctx.Done()
	cmd.Process.Signal(os.Kill)
	cmd.Wait()
}

func (h *EBPFHandler) runSyscallFallbackStrace(ctx context.Context, task *ObserveTask) {
	cmd := exec.CommandContext(ctx, "strace", "-tt", "-p", strconv.Itoa(task.PID))
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		task.broadcast("error", map[string]string{"msg": err.Error()})
		return
	}
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		line := scanner.Text()
		if line != "" {
			parseStraceLine(line, task)
		}
	}
	cmd.Wait()
}

func (h *EBPFHandler) runSyscallDemo(ctx context.Context, task *ObserveTask) {
	bpftracePath, _ := exec.LookPath("bpftrace")

	// Compile user code
	code := syscallDemoCode
	if task.Code != "" {
		code = task.Code
	}
	demoPath := "/tmp/traceos_syscall_demo"
	os.WriteFile(demoPath+".c", []byte(code), 0644)
	defer os.Remove(demoPath + ".c")
	defer os.Remove(demoPath)

	var flags []string
	if strings.Contains(code, "pthread") || strings.Contains(code, "pthread.h") {
		flags = append(flags, "-lpthread")
	}
	if strings.Contains(code, "math.h") || strings.Contains(code, "pow(") || strings.Contains(code, "sqrt(") {
		flags = append(flags, "-lm")
	}
	if strings.Contains(code, "rt.h") || strings.Contains(code, "clock_gettime") || strings.Contains(code, "timer_") {
		flags = append(flags, "-lrt")
	}
	buildArgs := append([]string{"-std=gnu11", "-o", demoPath, demoPath + ".c"}, flags...)
	build := exec.CommandContext(ctx, "gcc", buildArgs...)
	if out, err := build.CombinedOutput(); err != nil {
		task.broadcast("error", map[string]string{"msg": "compile: " + string(out)})
		return
	}

	// Start binary and get its PID
	proc := exec.CommandContext(ctx, demoPath)
	if err := proc.Start(); err != nil {
		task.broadcast("error", map[string]string{"msg": "start: " + err.Error()})
		return
	}
	actualPID := proc.Process.Pid
	task.mu.Lock()
	task.PID = actualPID
	task.mu.Unlock()
	task.broadcast("info", map[string]interface{}{
		"pid": actualPID,
		"msg": fmt.Sprintf("Syscall trace PID=%d (bpftrace eBPF)", actualPID),
	})

	// PRIMARY: bpftrace eBPF tracepoints for syscall tracing
	if bpftracePath != "" {
		log.Printf("[ebpf:syscall] using bpftrace eBPF mode (raw_syscalls tracepoints) for PID=%d", actualPID)
		time.Sleep(200 * time.Millisecond) // let binary start

		syscallScript := h.scriptsDir + "/syscall_trace.bt"
		bpftraceCmd := exec.CommandContext(ctx, bpftracePath, "-B", "none", syscallScript, strconv.Itoa(actualPID))
		bpftraceOut, _ := bpftraceCmd.StdoutPipe()
		bpftraceErr, _ := bpftraceCmd.StderrPipe()
		if err := bpftraceCmd.Start(); err == nil {
			go func() {
				scanner := bufio.NewScanner(bpftraceOut)
				for scanner.Scan() {
					line := strings.TrimSpace(scanner.Text())
					if line == "" || strings.HasPrefix(line, "Attaching") {
						continue
					}
					// Per-call trace_event JSONL from syscall_trace.bt
					if strings.HasPrefix(line, "{") {
						var event map[string]interface{}
						if err := json.Unmarshal([]byte(line), &event); err == nil {
							if event["type"] == "trace_event" {
								task.broadcast("trace_event", event)
							}
							continue
						}
					}
					// Aggregated stats from interval output
					if strings.Contains(line, "@sc[") {
						parts := strings.SplitN(line, "]:", 2)
						if len(parts) == 2 {
							countStr := strings.TrimSpace(parts[1])
							if count, err := strconv.Atoi(countStr); err == nil {
								nrStr := strings.TrimPrefix(parts[0], "@sc[")
								nrStr = strings.TrimSuffix(nrStr, "]")
								if nr, err := strconv.Atoi(nrStr); err == nil {
									task.broadcast("syscall", map[string]interface{}{
										"syscall": syscallName(int32(nr)),
										"count":   count,
									})
								}
							}
						}
					}
				}
				errScanner := bufio.NewScanner(bpftraceErr)
				for errScanner.Scan() {
					log.Printf("[ebpf:bpftrace:syscall-demo] %s", errScanner.Text())
				}
			}()

			proc.Wait()
			bpftraceCmd.Process.Signal(os.Kill)
			bpftraceCmd.Wait()
			return
		}
		log.Printf("[ebpf:syscall] bpftrace failed, falling back to strace")
		proc.Process.Kill()
		proc.Wait()
	}

	// FALLBACK: strace
	log.Printf("[ebpf:syscall] using strace fallback for user code")

	straceCmd := exec.CommandContext(ctx, "strace", "-tt",
		"-e", "trace=read,write,open,openat,close,getpid,clock_gettime,nanosleep,mmap,munmap,brk,futex,clone,exit,exit_group",
		demoPath)
	straceStderr, _ := straceCmd.StderrPipe()
	if err := straceCmd.Start(); err != nil {
		task.broadcast("error", map[string]string{"msg": "strace: " + err.Error()})
		return
	}
	actualPID2 := straceCmd.Process.Pid
	task.mu.Lock()
	task.PID = actualPID2
	task.mu.Unlock()
	task.broadcast("info", map[string]interface{}{
		"pid": actualPID2,
		"msg": fmt.Sprintf("Syscall trace PID=%d (strace fallback)", actualPID2),
	})

	scanner := bufio.NewScanner(straceStderr)
	for scanner.Scan() {
		line := scanner.Text()
		if line != "" {
			parseStraceLine(line, task)
		}
	}
	straceCmd.Wait()
}

func parseStraceLine(line string, task *ObserveTask) {
	if line == "" {
		return
	}
	idx := strings.Index(line, "(")
	if idx < 0 {
		return
	}
	before := strings.TrimSpace(line[:idx])
	parts := strings.Fields(before)
	if len(parts) < 2 {
		return
	}
	task.broadcast("syscall", map[string]interface{}{"syscall": parts[len(parts)-1], "count": 1})
	// Frontend controls animation pacing via requestAnimationFrame / ECharts built-in
	// animation; the backend must push events as fast as they arrive for data fidelity.
}

// ── Deadlock State Machine ──

type deadlockSM struct {
	lockOwner   map[string]int
	threadWaits map[int]string
	threadHolds map[int][]string
	threads     map[int]bool
	locks       map[string]bool
	cycle       []int
	deadlocked  bool
}

func newDeadlockSM() *deadlockSM {
	return &deadlockSM{
		lockOwner:   make(map[string]int),
		threadWaits: make(map[int]string),
		threadHolds: make(map[int][]string),
		threads:     make(map[int]bool),
		locks:       make(map[string]bool),
	}
}

// handleEvent processes a single futex event from strace output.
// It does NOT make deadlock decisions during execution — only after binary exits.
func (sm *deadlockSM) handleEvent(event map[string]interface{}) (graphChanged bool) {
	op, _ := event["op"].(string)
	tidF, _ := event["tid"].(float64)
	tid := int(tidF)
	uaddr, _ := event["uaddr"].(string)
	if uaddr == "" {
		uaddr, _ = event["mtx"].(string)
	}

	if tid > 0 {
		sm.threads[tid] = true
	}
	if uaddr != "" && uaddr != "0x0" {
		sm.locks[uaddr] = true
	}

	switch op {
	case "FUTEX_WAIT", "FUTEX_WAIT_BITSET", "FUTEX_LOCK_PI":
		// Thread is blocking on a lock (the futex wait syscall).
		// Record the wait edge. The holder relationship is established
		// by FUTEX_WAKE events (lock release), not by FUTEX_WAIT.
		sm.threadWaits[tid] = uaddr
		return true

	case "FUTEX_WAKE", "FUTEX_UNLOCK_PI":
		// Thread is waking waiters: it held the lock and is releasing it.
		// Mark this thread as having held the lock, then release.
		// First, record holder if not known
		if _, held := sm.lockOwner[uaddr]; !held {
			sm.lockOwner[uaddr] = tid
			sm.threadHolds[tid] = append(sm.threadHolds[tid], uaddr)
		}

		// Clear waiters for this uaddr (they were woken)
		for wtid, wuaddr := range sm.threadWaits {
			if wuaddr == uaddr {
				delete(sm.threadWaits, wtid)
			}
		}

		// Keep lock ownership in graph for visualization (binary has exited,
		// we want to show historical hold relationships)
		return true

	// Backward compatibility with uprobe events
	case "LOCK", "TRYLOCK", "SEM_WAIT":
		sm.lockOwner[uaddr] = tid
		sm.threadHolds[tid] = append(sm.threadHolds[tid], uaddr)
		delete(sm.threadWaits, tid)
		return true

	case "UNLOCK", "SEM_POST":
		if sm.lockOwner[uaddr] == tid {
			delete(sm.lockOwner, uaddr)
		}
		holds := sm.threadHolds[tid]
		for i, h := range holds {
			if h == uaddr {
				sm.threadHolds[tid] = append(holds[:i], holds[i+1:]...)
				break
			}
		}
		return true
	}
	return false
}

// detectCycle performs DFS cycle detection on the wait-for graph.
// Only called after binary exits to check for true deadlocks.
func (sm *deadlockSM) detectCycle() bool {
	visited := make(map[int]bool)
	inStack := make(map[int]bool)
	var path []int

	var dfs func(int) bool
	dfs = func(tid int) bool {
		if inStack[tid] {
			for i, t := range path {
				if t == tid {
					sm.cycle = make([]int, len(path)-i)
					copy(sm.cycle, path[i:])
					break
				}
			}
			return true
		}
		if visited[tid] {
			return false
		}
		visited[tid] = true
		inStack[tid] = true
		path = append(path, tid)
		wuaddr, waiting := sm.threadWaits[tid]
		if waiting {
			if holder, held := sm.lockOwner[wuaddr]; held && holder != tid {
				if dfs(holder) {
					return true
				}
			}
		}
		path = path[:len(path)-1]
		inStack[tid] = false
		return false
	}

	sm.cycle = nil
	for tid := range sm.threadWaits {
		if dfs(tid) {
			return true
		}
	}
	return false
}

// finalCheck is called after binary exits.
// Returns true if deadlock detected, false if safe.
func (sm *deadlockSM) finalCheck() (deadlocked bool, cycle []int) {
	// If no threads are waiting, definitely safe
	if len(sm.threadWaits) == 0 {
		return false, nil
	}

	// Check for cycles via known lock holders
	if sm.detectCycle() {
		sm.deadlocked = true
		return true, sm.cycle
	}

	// Cross-wait check: two threads each waiting on different uaddrs
	// with no known holder — this is a deadlock (e.g. ABBA).
	type entry struct {
		tid   int
		uaddr string
	}
	var entries []entry
	for tid, wuaddr := range sm.threadWaits {
		if _, held := sm.lockOwner[wuaddr]; !held {
			entries = append(entries, entry{tid, wuaddr})
		}
	}
	for i := 0; i < len(entries); i++ {
		for j := i + 1; j < len(entries); j++ {
			if entries[i].tid != entries[j].tid && entries[i].uaddr != entries[j].uaddr {
				sm.cycle = []int{entries[i].tid, entries[j].tid}
				sm.deadlocked = true
				return true, sm.cycle
			}
		}
	}

	return false, nil
}

func (sm *deadlockSM) buildGraphState() LockGraphState {
	threads := make([]ThreadNode, 0, len(sm.threads))
	for tid := range sm.threads {
		threads = append(threads, ThreadNode{Tid: tid})
	}
	locks := make([]LockNode, 0, len(sm.locks))
	for uaddr := range sm.locks {
		lock := LockNode{Uaddr: uaddr, Holder: 0, Waiters: []int{}}
		if h, ok := sm.lockOwner[uaddr]; ok {
			lock.Holder = h
		}
		for tid, wuaddr := range sm.threadWaits {
			if wuaddr == uaddr {
				lock.Waiters = append(lock.Waiters, tid)
			}
		}
		locks = append(locks, lock)
	}
	return LockGraphState{Threads: threads, Locks: locks}
}

func buildDeadlockDetails(cycle []int, sm *deadlockSM) []string {
	details := make([]string, 0, len(cycle))
	for i, tid := range cycle {
		nxt := cycle[(i+1)%len(cycle)]
		wuaddr, waiting := sm.threadWaits[tid]
		if waiting {
			holder, held := sm.lockOwner[wuaddr]
			if held {
				details = append(details,
					fmt.Sprintf("TID=%d waits for lock %s held by TID=%d", tid, wuaddr, holder))
			} else {
				details = append(details,
					fmt.Sprintf("TID=%d waits for lock %s (inferred held by TID=%d)", tid, wuaddr, nxt))
			}
		}
	}
	return details
}

// ── Deadlock Probe (uprobe-based via bpftrace) ──

// ── Deadlock Probe (bpftrace eBPF primary, strace fallback) ──
//
// Architecture:
//   1. PRIMARY: bpftrace futex_trace.bt — true eBPF tracepoint, near-zero overhead
//   2. FALLBACK: strace -e trace=futex — works without bpftrace installed

func (h *EBPFHandler) runDeadlockProbe(ctx context.Context, task *ObserveTask) {
	code := task.Code
	if code == "" {
		log.Printf("[ebpf:deadlock] no user code, using demo")
		code = deadlockDemoCode
	}

	// ── Compile the binary ───────────────────────────────────────
	demoBin := "/tmp/traceos_dd_demo"
	if err := os.WriteFile(demoBin+".c", []byte(code), 0644); err != nil {
		log.Printf("[ebpf:deadlock] ERROR: %v", err)
		task.broadcast("error", map[string]string{"msg": "write source: " + err.Error()})
		return
	}
	defer os.Remove(demoBin + ".c")
	defer os.Remove(demoBin)

	build := exec.CommandContext(ctx, "gcc", "-o", demoBin, demoBin+".c", "-lpthread")
	if out, err := build.CombinedOutput(); err != nil {
		log.Printf("[ebpf:deadlock] compile error: %s", string(out))
		task.broadcast("error", map[string]string{"msg": "compile: " + string(out)})
		return
	}

	// ── Try bpftrace (true eBPF) first ──────────────────────────
	bpftracePath, _ := exec.LookPath("bpftrace")
	futexScript := h.scriptsDir + "/futex_trace.bt"

	if bpftracePath != "" && fileExists(futexScript) {
		log.Printf("[ebpf:deadlock] using bpftrace eBPF mode (futex tracepoints)")
		h.runDeadlockWithBpftrace(ctx, task, demoBin, futexScript)
		return
	}

	// ── Fallback: strace-based futex tracing ────────────────────
	log.Printf("[ebpf:deadlock] bpftrace not available, falling back to strace mode")
	h.runDeadlockWithStrace(ctx, task, demoBin)
}

// runDeadlockWithBpftrace uses bpftrace futex_trace.bt for true eBPF tracing.
// bpftrace outputs JSONL that the deadlock state machine consumes directly.
func (h *EBPFHandler) runDeadlockWithBpftrace(ctx context.Context, task *ObserveTask, demoBin string, scriptPath string) {
	timeoutCtx, timeoutCancel := context.WithTimeout(ctx, 15*time.Second)
	defer timeoutCancel()

	// Start the binary in background
	proc := exec.CommandContext(timeoutCtx, demoBin)
	if err := proc.Start(); err != nil {
		log.Printf("[ebpf:deadlock] binary start error: %v", err)
		task.broadcast("error", map[string]string{"msg": "start binary: " + err.Error()})
		return
	}
	actualPID := proc.Process.Pid
	task.mu.Lock()
	task.PID = actualPID
	task.mu.Unlock()
	task.broadcast("info", map[string]interface{}{
		"pid": actualPID,
		"msg": fmt.Sprintf("eBPF futex trace PID=%d (bpftrace tracepoints)", actualPID),
	})

	// Give the binary a moment to spawn threads
	time.Sleep(300 * time.Millisecond)

	// Run bpftrace with the futex script, filtering by PID
	bpftraceCmd := exec.CommandContext(timeoutCtx, "bpftrace", "-B", "none", scriptPath, strconv.Itoa(actualPID))
	bpftraceStdout, _ := bpftraceCmd.StdoutPipe()
	if err := bpftraceCmd.Start(); err != nil {
		proc.Process.Kill()
		proc.Wait()
		log.Printf("[ebpf:deadlock] bpftrace start error: %v, falling back to strace", err)
		task.broadcast("error", map[string]string{"msg": "bpftrace start: " + err.Error()})
		h.runDeadlockWithStrace(ctx, task, demoBin)
		return
	}

	sm := newDeadlockSM()

	// Consume JSONL events from bpftrace in real-time
	go func() {
		scanner := bufio.NewScanner(bpftraceStdout)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || !strings.HasPrefix(line, "{") {
				continue
			}

			var event map[string]interface{}
			if err := json.Unmarshal([]byte(line), &event); err != nil {
				// Try to parse as structured strace-like output
				parts := strings.Fields(line)
				if len(parts) >= 2 {
					tid := 0
					if p, err := strconv.Atoi(parts[0]); err == nil {
						tid = p
					}
					if tid > 0 {
						sm.threads[tid] = true
						task.broadcast("graph", sm.buildGraphState())
					}
				}
				continue
			}

			tidF, _ := event["tid"].(float64)
			pidF, _ := event["pid"].(float64)
			uaddr, _ := event["uaddr"].(string)
			tid := int(tidF)
			pid := int(pidF)

			if tid > 0 {
				sm.threads[tid] = true
			}
			if uaddr != "" {
				sm.locks[uaddr] = true
			}

			event["pid"] = float64(pid)
			if sm.handleEvent(event) {
				task.broadcast("graph", sm.buildGraphState())
			}
		}
	}()

	// Wait for binary to exit
	proc.Wait()
	time.Sleep(300 * time.Millisecond)
	bpftraceCmd.Process.Signal(os.Kill)
	bpftraceCmd.Wait()

	// Final deadlock check
	deadlocked, cycle := sm.finalCheck()
	h.finalizeDeadlock(task, sm, deadlocked, cycle)
}

// runDeadlockWithStrace is the fallback when bpftrace is unavailable.
func (h *EBPFHandler) runDeadlockWithStrace(ctx context.Context, task *ObserveTask, demoBin string) {
	timeoutCtx, timeoutCancel := context.WithTimeout(ctx, 15*time.Second)
	defer timeoutCancel()

	straceOut := "/tmp/traceos_dd_strace.log"
	straceCmd := exec.CommandContext(timeoutCtx, "strace", "-e", "trace=futex,clone,exit,exit_group", "-f", "-tt", "-o", straceOut, demoBin)
	stderr, _ := straceCmd.StderrPipe()
	if err := straceCmd.Start(); err != nil {
		log.Printf("[ebpf:deadlock] strace start error: %v", err)
		task.broadcast("error", map[string]string{"msg": "strace start: " + err.Error()})
		return
	}
	defer os.Remove(straceOut)

	actualPID := straceCmd.Process.Pid
	task.mu.Lock()
	task.PID = actualPID
	task.mu.Unlock()
	task.broadcast("info", map[string]interface{}{
		"pid": actualPID,
		"msg": fmt.Sprintf("Futex lock trace PID=%d (strace fallback)", actualPID),
	})

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			log.Printf("[ebpf:strace] %s", scanner.Text())
		}
	}()

	sm := newDeadlockSM()

	// Incremental strace log parser
	go func() {
		lastPos := int64(0)
		ticker := time.NewTicker(300 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				f, err := os.Open(straceOut)
				if err != nil {
					continue
				}
				fi, _ := f.Stat()
				if fi.Size() > lastPos {
					f.Seek(lastPos, 0)
					parseStraceFutexLog(f, sm, task)
					lastPos = fi.Size()
				}
				f.Close()
			case <-timeoutCtx.Done():
				return
			}
		}
	}()

	straceCmd.Wait()
	time.Sleep(500 * time.Millisecond)

	// Final parse
	f, err := os.Open(straceOut)
	if err == nil {
		parseStraceFutexLog(f, sm, task)
		f.Close()
	}

	deadlocked, cycle := sm.finalCheck()
	h.finalizeDeadlock(task, sm, deadlocked, cycle)
}

// finalizeDeadlock emits the final deadlock/safe verdict.
func (h *EBPFHandler) finalizeDeadlock(task *ObserveTask, sm *deadlockSM, deadlocked bool, cycle []int) {
	if deadlocked {
		log.Printf("[ebpf:deadlock] DEADLOCK cycle=%v", cycle)
		report := &DeadlockReport{
			Detected: true,
			Cycle:    cycle,
			Details:  buildDeadlockDetails(cycle, sm),
			Fix:      "All threads must acquire locks in the same order. Reorder lock acquisition to be consistent across all threads.",
		}
		task.mu.Lock()
		task.Deadlock = report
		task.mu.Unlock()
		task.broadcast("deadlock", report)
		return
	}

	task.mu.Lock()
	task.Deadlock = &DeadlockReport{Detected: false}
	task.mu.Unlock()
	task.broadcast("graph", sm.buildGraphState())
	task.broadcast("safe", map[string]string{"msg": "No deadlock detected — lock ordering is safe"})
	log.Printf("[ebpf:deadlock] safe: no deadlock (threads=%d, locks=%d, waiters=%d)",
		len(sm.threads), len(sm.locks), len(sm.threadWaits))
}

// parseStraceFutexLog reads strace output and feeds events to the deadlock state machine.
func parseStraceFutexLog(r io.Reader, sm *deadlockSM, task *ObserveTask) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "strace:") ||
			strings.HasPrefix(line, "+++") || strings.HasPrefix(line, "---") {
			continue
		}

		parts := strings.Fields(line)
		tid := 0
		if len(parts) >= 2 {
			if p, err := strconv.Atoi(parts[0]); err == nil {
				tid = p
			}
		}
		if tid == 0 {
			continue
		}

		op := ""
		for _, p := range parts {
			if strings.HasPrefix(p, "FUTEX_") {
				clean := p
				if idx := strings.Index(clean, "|"); idx >= 0 {
					clean = clean[:idx]
				}
				if strings.HasSuffix(clean, ",") {
					clean = clean[:len(clean)-1]
				}
				clean = strings.TrimSuffix(clean, "_PRIVATE")
				op = clean
				break
			}
		}
		if op == "" {
			if strings.Contains(line, "+++ exited") || strings.Contains(line, "clone(") {
				if tid > 0 {
					sm.threads[tid] = true
					if task != nil {
						task.broadcast("graph", sm.buildGraphState())
					}
				}
			}
			continue
		}

		uaddr := "0x0"
		if fi := strings.Index(line, "futex("); fi >= 0 {
			rest := line[fi+6:]
			if end := strings.Index(rest, ","); end > 0 {
				raw := strings.TrimSpace(rest[:end])
				if uf := strings.Index(raw, " <"); uf >= 0 {
					raw = raw[:uf]
				}
				uaddr = raw
			}
		}

		event := map[string]interface{}{
			"op": op, "tid": float64(tid), "pid": float64(tid), "uaddr": uaddr,
		}
		if sm.handleEvent(event) && task != nil {
			task.broadcast("graph", sm.buildGraphState())
		}
	}
}

func (h *EBPFHandler) runSchedProbe(ctx context.Context, task *ObserveTask) {
	code := task.Code
	if code == "" {
		code = syscallDemoCode
	}
	log.Printf("[ebpf:sched] starting scheduling observation")

	select {
	case <-ctx.Done():
		return
	case <-time.After(1 * time.Second):
	}

	demoBin := "/tmp/traceos_sched_demo"
	if err := os.WriteFile(demoBin+".c", []byte(code), 0644); err != nil {
		task.broadcast("error", map[string]string{"msg": "write source: " + err.Error()})
		return
	}
	defer os.Remove(demoBin + ".c")
	defer os.Remove(demoBin)

	build := exec.CommandContext(ctx, "gcc", "-o", demoBin, demoBin+".c", "-lpthread")
	if out, err := build.CombinedOutput(); err != nil {
		task.broadcast("error", map[string]string{"msg": "compile: " + string(out)})
		return
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	proc := exec.CommandContext(timeoutCtx, demoBin)
	if err := proc.Start(); err != nil {
		task.broadcast("error", map[string]string{"msg": "start: " + err.Error()})
		return
	}
	actualPID := proc.Process.Pid
	task.mu.Lock()
	task.PID = actualPID
	task.mu.Unlock()
	task.broadcast("info", map[string]interface{}{"pid": actualPID, "msg": fmt.Sprintf("Sched trace PID=%d", actualPID)})

	time.Sleep(200 * time.Millisecond)

	bpftracePath, _ := exec.LookPath("bpftrace")
	schedScript := h.scriptsDir + "/sched_trace.bt"

	if bpftracePath == "" || !fileExists(schedScript) {
		log.Printf("[ebpf:sched] bpftrace or sched_trace.bt not available, skipping sched probe")
		proc.Wait()
		return
	}
	bpfCmd := exec.CommandContext(timeoutCtx, bpftracePath, "-B", "none", schedScript, strconv.Itoa(actualPID))
	bpfStdout, _ := bpfCmd.StdoutPipe()
	if err := bpfCmd.Start(); err != nil {
		proc.Process.Kill()
		proc.Wait()
		task.broadcast("error", map[string]string{"msg": "bpftrace: " + err.Error()})
		return
	}

	// Parse interval reports from bpftrace via goroutine + channel
	// (avoids busy-wait polling in select default case)
	type schedStats struct {
		Switches   map[string]int `json:"switches"`
		Wakeups    map[string]int `json:"wakeups"`
		Migrations map[string]int `json:"migrations"`
	}
	type schedLine struct {
		line string
		done bool
	}

	lineCh := make(chan schedLine, 32)
	go func() {
		scanner := bufio.NewScanner(bpfStdout)
		for scanner.Scan() {
			select {
			case lineCh <- schedLine{line: scanner.Text()}:
			case <-timeoutCtx.Done():
				return
			}
		}
		lineCh <- schedLine{done: true}
	}()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	var current schedStats
	currentMap := ""

	for {
		select {
		case <-timeoutCtx.Done():
			return
		case <-ticker.C:
			task.broadcast("sched", current)
		case sl := <-lineCh:
			if sl.done {
				return
			}
			line := strings.TrimSpace(sl.line)
			if strings.Contains(line, "Context Switches") {
				current.Switches = make(map[string]int)
				current.Wakeups = make(map[string]int)
				current.Migrations = make(map[string]int)
				currentMap = "switch"
			} else if strings.Contains(line, "Wakeups") {
				currentMap = "wakeup"
			} else if strings.Contains(line, "Migrations") {
				currentMap = "migrate"
			} else if strings.Contains(line, "Scheduling Report") {
				// new report cycle
			} else if strings.Contains(line, "]:") && strings.Contains(line, "@[") {
				// Parse bpftrace map output: @name[comm]: count
				parts := strings.SplitN(line, "]:", 2)
				if len(parts) == 2 {
					countStr := strings.TrimSpace(parts[1])
					if count, err := strconv.Atoi(countStr); err == nil {
						namePart := strings.TrimPrefix(parts[0], "@")
						namePart = strings.TrimPrefix(namePart, " [")
						namePart = strings.TrimSuffix(namePart, "]")
						switch currentMap {
						case "switch":
							current.Switches[namePart] += count
						case "wakeup":
							current.Wakeups[namePart] += count
						case "migrate":
							current.Migrations[namePart] += count
						}
					}
				}
			}
		}
	}
}

func (h *EBPFHandler) runMemProbe(ctx context.Context, task *ObserveTask) {
	code := task.Code
	if code == "" {
		code = syscallDemoCode
	}
	log.Printf("[ebpf:mem] starting memory trace observation")

	select {
	case <-ctx.Done():
		return
	case <-time.After(1 * time.Second):
	}

	demoBin := "/tmp/traceos_mem_demo"
	if err := os.WriteFile(demoBin+".c", []byte(code), 0644); err != nil {
		task.broadcast("error", map[string]string{"msg": "write source: " + err.Error()})
		return
	}
	defer os.Remove(demoBin + ".c")
	defer os.Remove(demoBin)

	build := exec.CommandContext(ctx, "gcc", "-o", demoBin, demoBin+".c")
	if out, err := build.CombinedOutput(); err != nil {
		task.broadcast("error", map[string]string{"msg": "compile: " + string(out)})
		return
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	proc := exec.CommandContext(timeoutCtx, demoBin)
	if err := proc.Start(); err != nil {
		task.broadcast("error", map[string]string{"msg": "start: " + err.Error()})
		return
	}
	actualPID := proc.Process.Pid
	task.mu.Lock()
	task.PID = actualPID
	task.mu.Unlock()
	task.broadcast("info", map[string]interface{}{"pid": actualPID, "msg": fmt.Sprintf("Memory trace PID=%d", actualPID)})

	time.Sleep(200 * time.Millisecond)

	bpftracePath, _ := exec.LookPath("bpftrace")
	memScript := h.scriptsDir + "/mem_trace.bt"

	if bpftracePath == "" || !fileExists(memScript) {
		log.Printf("[ebpf:mem] bpftrace or mem_trace.bt not available, skipping mem probe")
		proc.Wait()
		return
	}
	bpfCmd := exec.CommandContext(timeoutCtx, bpftracePath, "-B", "none", memScript, strconv.Itoa(actualPID))
	bpfStdout, _ := bpfCmd.StdoutPipe()
	if err := bpfCmd.Start(); err != nil {
		proc.Process.Kill()
		proc.Wait()
		task.broadcast("error", map[string]string{"msg": "bpftrace: " + err.Error()})
		return
	}

	// Parse interval snapshots in real-time (mem_trace.bt emits JSONL every 1s)
	go func() {
		scanner := bufio.NewScanner(bpfStdout)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || !strings.HasPrefix(line, "{") {
				continue
			}
			var event map[string]interface{}
			if err := json.Unmarshal([]byte(line), &event); err != nil {
				continue
			}
			// Forward interval snapshot as SSE mem event
			task.broadcast("mem", event)
		}
		bpfCmd.Wait()
		proc.Wait()
	}()
}

const syscallDemoCode = `#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <time.h>
#include <fcntl.h>
int main() { srand(time(NULL)); for (int i=0;i<5000;i++) {
getpid(); usleep(100); char b[64]; sprintf(b,"iter=%d\n",i);
int f=open("/tmp/d.log",O_WRONLY|O_CREAT|O_APPEND,0644);
if(f>=0){write(f,b,__builtin_strlen(b));close(f);}
int *p=malloc(32); if(p){*p=i;free(p);} } return 0; }
`
const deadlockDemoCode = `#include <pthread.h>
#include <unistd.h>
pthread_mutex_t A=PTHREAD_MUTEX_INITIALIZER,B=PTHREAD_MUTEX_INITIALIZER;
void*t1(void*x){pthread_mutex_lock(&A);sleep(1);pthread_mutex_lock(&B);return NULL;}
void*t2(void*x){pthread_mutex_lock(&B);sleep(1);pthread_mutex_lock(&A);return NULL;}
int main(){pthread_t x,y;pthread_create(&x,NULL,t1,NULL);pthread_create(&y,NULL,t2,NULL);sleep(10);return 0;}
`

// syscallName maps x86_64 syscall numbers to human-readable names.
// Covers the most common syscalls seen in OS lab experiments.
func syscallName(nr int32) string {
	names := map[int32]string{
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
		124: "getsid", 125: "capget", 126: "capset",
		131: "sigaltstack", 132: "utime", 133: "mknod",
		137: "statfs", 138: "fstatfs", 139: "sysfs",
		140: "getpriority", 141: "setpriority",
		142: "sched_setparam", 143: "sched_getparam",
		144: "sched_setscheduler", 145: "sched_getscheduler",
		146: "sched_get_priority_max", 147: "sched_get_priority_min",
		148: "sched_rr_get_interval",
		157: "prctl", 158: "arch_prctl",
		186: "gettid", 201: "time", 202: "futex",
		203: "sched_setaffinity", 204: "sched_getaffinity",
		217: "getdents64", 218: "set_tid_address",
		220: "semtimedop", 228: "clock_gettime", 229: "clock_getres",
		230: "clock_nanosleep", 231: "exit_group", 232: "epoll_wait",
		233: "epoll_ctl", 234: "tgkill",
		251: "ioprio_set", 252: "ioprio_get",
		257: "openat", 258: "mkdirat", 259: "mknodat",
		260: "fchownat", 261: "futimesat", 262: "newfstatat",
		263: "unlinkat", 264: "renameat", 265: "linkat",
		266: "symlinkat", 267: "readlinkat", 268: "fchmodat",
		269: "faccessat", 273: "set_robust_list", 274: "get_robust_list",
		281: "epoll_pwait", 288: "accept4", 291: "epoll_create1",
		292: "dup3", 293: "pipe2", 294: "inotify_init1",
		298: "perf_event_open", 302: "prlimit64",
		314: "sched_setattr", 315: "sched_getattr",
		318: "getrandom", 319: "memfd_create",
		321: "bpf", 324: "membarrier", 326: "copy_file_range",
		332: "statx", 334: "rseq",
		336: "io_uring_setup", 337: "io_uring_enter", 338: "io_uring_register",
		345: "pidfd_open", 346: "clone3", 347: "close_range",
		348: "openat2", 349: "pidfd_getfd", 350: "faccessat2",
		351: "process_madvise", 435: "clone3", 436: "close_range",
		437: "openat2", 438: "pidfd_getfd", 439: "faccessat2",
		440: "process_madvise", 441: "epoll_pwait2",
	}
	if name, ok := names[nr]; ok {
		return name
	}
	return fmt.Sprintf("sys_%d", nr)
}
func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
