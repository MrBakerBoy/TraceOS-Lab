package ast

import (
	"testing"
)

func TestCheckMutexBalanceLockMoreThanUnlock(t *testing.T) {
	pr := &ParseResult{
		MutexOps: []MutexOp{
			{Line: 3, OpType: "lock", MutexVar: "m", FuncName: "test"},
			{Line: 4, OpType: "unlock", MutexVar: "m", FuncName: "test"},
			{Line: 7, OpType: "lock", MutexVar: "m", FuncName: "test"},
		},
	}
	tracker := &ResourceTracker{}
	leaks := tracker.TrackResources(pr)

	if len(leaks) == 0 {
		t.Fatal("expected at least 1 leak for unbalanced mutex, got none")
	}

	found := false
	for _, l := range leaks {
		if l.Kind == ResourceMutex && l.Issue == "mutex lock没有对应的unlock" {
			found = true
			break
		}
	}
	if !found {
		t.Error("did not find missing-unlock issue")
	}
}

func TestCheckMutexDoubleLockDeadlockRisk(t *testing.T) {
	pr := &ParseResult{
		MutexOps: []MutexOp{
			{Line: 3, OpType: "lock", MutexVar: "m", FuncName: "test"},
			{Line: 5, OpType: "lock", MutexVar: "m", FuncName: "test"},
			{Line: 7, OpType: "unlock", MutexVar: "m", FuncName: "test"},
			{Line: 8, OpType: "unlock", MutexVar: "m", FuncName: "test"},
		},
	}
	tracker := &ResourceTracker{}
	leaks := tracker.TrackResources(pr)

	found := false
	for _, l := range leaks {
		if l.Issue == "连续两次lock，可能死锁" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected deadlock warning for consecutive locks without intermediate unlock")
	}
}

func TestCheckMemoryBalanceMallocGreaterThanFree(t *testing.T) {
	pr := &ParseResult{
		AllocOps: []AllocOp{
			{Line: 3, OpType: "malloc", FuncName: "test"},
			{Line: 4, OpType: "malloc", FuncName: "test"},
			{Line: 5, OpType: "free", FuncName: "test"},
		},
	}
	tracker := &ResourceTracker{}
	leaks := tracker.TrackResources(pr)

	if len(leaks) == 0 {
		t.Fatal("expected leak detection for malloc > free")
	}

	found := false
	for _, l := range leaks {
		if l.Kind == ResourceMemory && l.Confidence == 0.7 {
			found = true
			break
		}
	}
	if !found {
		t.Error("did not find memory leak issue")
	}
}

func TestCheckMemoryBalanceBalanced(t *testing.T) {
	pr := &ParseResult{
		AllocOps: []AllocOp{
			{Line: 3, OpType: "malloc", FuncName: "test"},
			{Line: 4, OpType: "malloc", FuncName: "test"},
			{Line: 5, OpType: "free", FuncName: "test"},
			{Line: 6, OpType: "free", FuncName: "test"},
		},
	}
	tracker := &ResourceTracker{}
	leaks := tracker.TrackResources(pr)

	for _, l := range leaks {
		if l.Kind == ResourceMemory {
			t.Errorf("did not expect memory leak issue when balanced, got: %s", l.Issue)
		}
	}
}

func TestCheckFDBalanceOpenGreaterThanClose(t *testing.T) {
	pr := &ParseResult{
		FDOps: []FDOp{
			{Line: 3, OpType: "open", FuncName: "test", Target: "f1"},
			{Line: 4, OpType: "open", FuncName: "test", Target: "f2"},
			{Line: 5, OpType: "close", FuncName: "test", Target: ""},
		},
	}
	tracker := &ResourceTracker{}
	leaks := tracker.TrackResources(pr)

	if len(leaks) == 0 {
		t.Fatal("expected fd leak detection")
	}

	found := false
	for _, l := range leaks {
		if l.Kind == ResourceFD {
			found = true
			break
		}
	}
	if !found {
		t.Error("did not find fd leak issue")
	}
}

func TestTrackResourcesNoIssues(t *testing.T) {
	pr := &ParseResult{
		MutexOps: []MutexOp{
			{Line: 3, OpType: "lock", MutexVar: "m", FuncName: "test"},
			{Line: 4, OpType: "unlock", MutexVar: "m", FuncName: "test"},
		},
		AllocOps: []AllocOp{
			{Line: 5, OpType: "malloc", FuncName: "test"},
			{Line: 6, OpType: "free", FuncName: "test"},
		},
		FDOps: []FDOp{
			{Line: 7, OpType: "open", FuncName: "test", Target: "f"},
			{Line: 8, OpType: "close", FuncName: "test", Target: ""},
		},
	}
	tracker := &ResourceTracker{}
	leaks := tracker.TrackResources(pr)

	if len(leaks) != 0 {
		t.Errorf("expected 0 leaks for balanced resources, got %d: %+v", len(leaks), leaks)
	}
}
