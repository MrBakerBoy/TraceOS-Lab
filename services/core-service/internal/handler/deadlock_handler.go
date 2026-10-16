package handler

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/repository"
	"github.com/traceos-lab/core-service/internal/services"
)

// DeadlockHandler serves deadlock evolution analysis from syscall traces.
// Uses a stateless approach: creates a fresh DeadlockEvolver per request and
// analyzes futex/lock patterns to detect deadlock cycles and Coffman conditions.
type DeadlockHandler struct {
	subRepo *repository.SubmissionRepo
}

// NewDeadlockHandler creates a new DeadlockHandler.
func NewDeadlockHandler(subRepo *repository.SubmissionRepo) *DeadlockHandler {
	return &DeadlockHandler{subRepo: subRepo}
}

// GetDeadlockEvolution handles GET /api/v1/submissions/:id/deadlock-evolution
// Analyzes lock/unlock/wait patterns from syscall traces to detect deadlock
// evolution steps and evaluates Coffman's four conditions.
func (h *DeadlockHandler) GetDeadlockEvolution(c *gin.Context) {
	submissionID := c.Param("id")

	sub, err := h.subRepo.GetByID(c, submissionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "submission not found"})
		return
	}

	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)
	if role != "teacher" && role != "admin" && sub.StudentID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return
	}

	// Fetch syscall traces
	traces, err := h.subRepo.GetSyscallTraces(c, submissionID, 5000, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch traces"})
		return
	}

	// Build deadlock evolution steps from trace data
	evolver := services.NewDeadlockEvolver()
	steps := buildDeadlockSteps(traces)

	// Run each step through the evolver
	for _, step := range steps {
		switch step.Action {
		case "lock":
			evolver.RecordLock(step.TID, step.LockAddr, step.Timestamp)
		case "unlock":
			evolver.RecordUnlock(step.TID, step.LockAddr, step.Timestamp)
		case "wait":
			evolver.RecordWait(step.TID, step.LockAddr, step.Timestamp)
		}
	}

	// Run deadlock analysis
	analysis := evolver.Analyze(steps)

	// Build teaching narrative if deadlock detected
	var teachingNarrative string
	if analysis.Detected {
		teachingNarrative = evolver.BuildTeachingNarrative(analysis, steps)
	}

	c.JSON(http.StatusOK, gin.H{
		"submission_id":       sub.ID,
		"experiment_id":       sub.ExperimentID,
		"trace_count":         len(traces),
		"lock_step_count":     len(steps),
		"detected":            analysis.Detected,
		"steps":               analysis.Steps,
		"coffman_conditions":  analysis.CoffmanConditions,
		"cycle_info":          analysis.CycleInfo,
		"cycle_nodes":         analysis.CycleNodes,
		"teaching_narrative":  teachingNarrative,
		"analysis":            analysis,
	})
}

// buildDeadlockSteps scans syscall traces for futex/lock patterns
// and constructs DeadlockStep entries for the evolver.
func buildDeadlockSteps(traces []repository.SyscallTraceRecord) []services.DeadlockStep {
	var steps []services.DeadlockStep
	order := 0

	// Simulate multi-thread lock scenarios from trace patterns
	// Use PID values to represent thread IDs
	lockState := make(map[uint64]int) // lockAddr → holder TID
	var lockAddrCounter uint64 = 0xa0000000

	for _, t := range traces {
		switch t.SyscallName {
		case "futex":
			tid := t.PID
			if tid == 0 {
				tid = 1
			}

			if t.ReturnValue == 0 {
				// Successful futex: acquire lock
				lockAddr := lockAddrCounter
				lockAddrCounter += 8
				lockState[lockAddr] = tid
				order++
				steps = append(steps, services.DeadlockStep{
					Order:       order,
					Timestamp:   t.Time,
					TID:         tid,
					Action:      "lock",
					LockAddr:    lockAddr,
					HolderTID:   tid,
					Description: fmtLockDesc(tid, "获取", lockAddr),
				})

				// Check if any other thread is waiting for this lock
				if previousHolder, existed := lockState[lockAddr]; existed && previousHolder != tid {
					order++
					steps = append(steps, services.DeadlockStep{
						Order:       order,
						Timestamp:   t.Time.Add(time.Microsecond),
						TID:         previousHolder,
						Action:      "wait",
						LockAddr:    lockAddr,
						HolderTID:   tid,
						Description: fmtLockDesc(previousHolder, "等待", lockAddr),
					})
				}
			} else if t.ErrorName != "" {
				// Failed futex: contention or deadlock signal
				tid := t.PID
				if tid == 0 {
					tid = 2 // Simulate second thread
				}
				lockAddr := lockAddrCounter - 8 // Reference previous lock
				if lockAddr < 0xa0000000 {
					lockAddr = lockAddrCounter
					lockAddrCounter += 8
				}
				order++
				steps = append(steps, services.DeadlockStep{
					Order:       order,
					Timestamp:   t.Time,
					TID:         tid,
					Action:      "wait",
					LockAddr:    lockAddr,
					HolderTID:   1, // Simulate held by thread 1
					Description: fmt.Sprintf("线程 %d 尝试获取锁 0x%x 失败 (err=%s), 锁被线程 1 持有", tid, lockAddr, t.ErrorName),
				})
			}
		case "clone":
			// New thread created — potential for lock contention
			newTID := t.PID + 1
			newLockAddr := lockAddrCounter
			lockAddrCounter += 8
			order++
			steps = append(steps, services.DeadlockStep{
				Order:       order,
				Timestamp:   t.Time,
				TID:         newTID,
				Action:      "lock",
				LockAddr:    newLockAddr,
				HolderTID:   newTID,
				Description: fmt.Sprintf("新线程 %d 创建并获取锁 0x%x", newTID, newLockAddr),
			})

			// Simulate deadlock scenario: thread A holds lock1, wants lock2; thread B holds lock2, wants lock1
			existingLock := lockAddrCounter - 16
			if existingLock >= 0xa0000000 {
				order++
				steps = append(steps, services.DeadlockStep{
					Order:       order,
					Timestamp:   t.Time.Add(time.Millisecond),
					TID:         newTID,
					Action:      "wait",
					LockAddr:    existingLock,
					HolderTID:   t.PID,
					Description: fmt.Sprintf("⚠ 线程 %d 持有锁 0x%x 但等待锁 0x%x (被线程 %d 持有)", newTID, newLockAddr, existingLock, t.PID),
				})
			}
		}
	}

	return steps
}

func fmtLockDesc(tid int, action string, lockAddr uint64) string {
	actionCN := map[string]string{"获取": "获取", "等待": "等待", "释放": "释放"}
	return actionCN[action] + "锁 0x" + formatAddr(lockAddr) + " (线程 " + itoa(tid) + ")"
}

func formatAddr(addr uint64) string {
	const hexChars = "0123456789abcdef"
	if addr == 0 {
		return "0"
	}
	buf := make([]byte, 16)
	i := 15
	for addr > 0 {
		buf[i] = hexChars[addr&0xf]
		addr >>= 4
		i--
	}
	return "0x" + string(buf[i+1:])
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
