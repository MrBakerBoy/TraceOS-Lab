package ast

// ResourceTracker tracks resource acquisition/release pairs.
type ResourceTracker struct{}

// ResourceKind represents types of tracked resources.
type ResourceKind string

const (
	ResourceMutex   ResourceKind = "mutex"
	ResourceMemory  ResourceKind = "memory"
	ResourceFD      ResourceKind = "fd"
)

// ResourceLeak represents a leaked or at-risk resource.
type ResourceLeak struct {
	Line       int          `json:"line"`
	Kind       ResourceKind `json:"kind"`
	VarName    string       `json:"var_name"`
	FuncName   string       `json:"func_name"`
	Issue      string       `json:"issue"`
	Confidence float64      `json:"confidence"`
}

// TrackResources checks for resource management issues.
func (t *ResourceTracker) TrackResources(pr *ParseResult) []ResourceLeak {
	var leaks []ResourceLeak

	// Check mutex lock/unlock balance per mutex variable per function
	leaks = append(leaks, t.checkMutexBalance(pr)...)

	// Check malloc/free balance
	leaks = append(leaks, t.checkMemoryBalance(pr)...)

	// Check open/close balance
	leaks = append(leaks, t.checkFDBalance(pr)...)

	return leaks
}

func (t *ResourceTracker) checkMutexBalance(pr *ParseResult) []ResourceLeak {
	var leaks []ResourceLeak

	// Group by function + mutex variable
	type mutexKey struct{ funcName, varName string }
	locks := make(map[mutexKey][]int)
	unlocks := make(map[mutexKey][]int)

	for _, op := range pr.MutexOps {
		key := mutexKey{op.FuncName, op.MutexVar}
		if op.OpType == "lock" {
			locks[key] = append(locks[key], op.Line)
		} else {
			unlocks[key] = append(unlocks[key], op.Line)
		}
	}

	for key, lockLines := range locks {
		unlockLines := unlocks[key]
		if len(unlockLines) < len(lockLines) {
			leaks = append(leaks, ResourceLeak{
				Line:       lockLines[len(lockLines)-1],
				Kind:       ResourceMutex,
				VarName:    key.varName,
				FuncName:   key.funcName,
				Issue:      "mutex lock没有对应的unlock",
				Confidence: 0.85,
			})
		}
		// Check sequential: lock, lock without intermediate unlock
		for i := 0; i < len(lockLines)-1; i++ {
			hasUnlockBetween := false
			for _, u := range unlockLines {
				if u > lockLines[i] && u < lockLines[i+1] {
					hasUnlockBetween = true
					break
				}
			}
			if !hasUnlockBetween {
				leaks = append(leaks, ResourceLeak{
					Line:       lockLines[i+1],
					Kind:       ResourceMutex,
					VarName:    key.varName,
					FuncName:   key.funcName,
					Issue:      "连续两次lock，可能死锁",
					Confidence: 0.9,
				})
			}
		}
	}

	return leaks
}

func (t *ResourceTracker) checkMemoryBalance(pr *ParseResult) []ResourceLeak {
	var leaks []ResourceLeak

	mallocCount := 0
	freeCount := 0
	for _, op := range pr.AllocOps {
		if op.OpType == "malloc" {
			mallocCount++
		} else {
			freeCount++
		}
	}

	// Global imbalance
	if mallocCount > freeCount {
		leaks = append(leaks, ResourceLeak{
			Line:       0, // global
			Kind:       ResourceMemory,
			VarName:    "",
			FuncName:   "全局",
			Issue:      "malloc次数 > free次数，可能存在内存泄漏",
			Confidence: 0.7,
		})
	}

	return leaks
}

func (t *ResourceTracker) checkFDBalance(pr *ParseResult) []ResourceLeak {
	var leaks []ResourceLeak

	openCount := 0
	closeCount := 0
	for _, op := range pr.FDOps {
		if op.OpType == "open" {
			openCount++
		} else {
			closeCount++
		}
	}

	if openCount > closeCount {
		leaks = append(leaks, ResourceLeak{
			Line:       0,
			Kind:       ResourceFD,
			VarName:    "",
			FuncName:   "全局",
			Issue:      "open次数 > close次数，可能存在fd泄漏",
			Confidence: 0.7,
		})
	}

	return leaks
}
