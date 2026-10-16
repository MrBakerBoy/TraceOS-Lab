package evaluator

// BehaviorMetrics holds objective runtime metrics extracted from strace/eBPF traces.
type BehaviorMetrics struct {
	// FD management
	FDOpenCount  int
	FDCloseCount int
	FDLeaked     int
	HasFDLeak    bool

	// Process management
	ForkCount  int
	WaitCount  int
	HasZombies bool

	// Concurrency
	DeadlockDetected bool
	ThreadCount      int

	// Syscall counts
	SyscallMap    map[string]int
	SyscallErrors map[string]int

	// Resources
	RuntimeMs float64
	MemoryKB  int64
	ExitCode  int
	WasKilled bool
}

// NewBehaviorMetrics creates a default empty metrics struct.
func NewBehaviorMetrics() *BehaviorMetrics {
	return &BehaviorMetrics{
		SyscallMap:    make(map[string]int),
		SyscallErrors: make(map[string]int),
	}
}

// MergeSyscallMap merges an external syscall count map into the metrics.
func (m *BehaviorMetrics) MergeSyscallMap(external map[string]int) {
	if m.SyscallMap == nil {
		m.SyscallMap = make(map[string]int)
	}
	for k, v := range external {
		m.SyscallMap[k] += v
	}
}

// FromExecutionResult fills metrics from a test execution result.
func (m *BehaviorMetrics) FromExecutionResult(exitCode int, runtimeMs float64, memoryKB int64, wasKilled bool) {
	m.ExitCode = exitCode
	m.RuntimeMs = runtimeMs
	m.MemoryKB = memoryKB
	m.WasKilled = wasKilled
}

// AnalyzeFDLeak computes FD leak from open/close syscall counts.
func (m *BehaviorMetrics) AnalyzeFDLeak() {
	openCount := 0
	closeCount := 0
	for _, alias := range syscallAliases("open") {
		openCount += m.SyscallMap[alias]
	}
	for _, alias := range syscallAliases("close") {
		closeCount += m.SyscallMap[alias]
	}
	m.FDOpenCount = openCount
	m.FDCloseCount = closeCount
	m.FDLeaked = openCount - closeCount
	m.HasFDLeak = m.FDLeaked > 0
}

// AnalyzeZombies computes zombie state from clone/wait4 counts.
func (m *BehaviorMetrics) AnalyzeZombies() {
	cloneCount := 0
	waitCount := 0
	for _, alias := range syscallAliases("clone") {
		cloneCount += m.SyscallMap[alias]
	}
	for _, alias := range syscallAliases("wait4") {
		waitCount += m.SyscallMap[alias]
	}
	m.ForkCount = cloneCount
	m.WaitCount = waitCount
	m.HasZombies = cloneCount > waitCount
}

// AnalyzeDeadlock checks if deadlock was detected (timeout or kill).
func (m *BehaviorMetrics) AnalyzeDeadlock(timeoutMs int64) {
	m.DeadlockDetected = m.WasKilled || (timeoutMs > 0 && m.RuntimeMs >= float64(timeoutMs))
}

// AnalyzeThreadCount estimates thread count from clone syscall count.
func (m *BehaviorMetrics) AnalyzeThreadCount() {
	m.ThreadCount = 0
	for _, alias := range syscallAliases("clone") {
		m.ThreadCount += m.SyscallMap[alias]
	}
}