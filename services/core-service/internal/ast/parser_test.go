package ast

import (
	"testing"
)

func TestParseSimpleCFunction(t *testing.T) {
	p := NewParser()
	code := `
int main() {
    return 0;
}
`
	result := p.Parse(code)

	if len(result.Functions) != 1 {
		t.Fatalf("expected 1 function, got %d", len(result.Functions))
	}
	fn := result.Functions[0]
	if fn.Name != "main" {
		t.Errorf("expected function name main, got %s", fn.Name)
	}
	if fn.StartLine != 2 {
		t.Errorf("expected StartLine 2, got %d", fn.StartLine)
	}
}

func TestParseMutexLockUnlock(t *testing.T) {
	p := NewParser()
	code := `
void worker() {
    pthread_mutex_lock(&lock);
    pthread_mutex_unlock(&lock);
}
`
	result := p.Parse(code)

	if len(result.MutexOps) != 2 {
		t.Fatalf("expected 2 mutex ops, got %d", len(result.MutexOps))
	}
	if result.MutexOps[0].OpType != "lock" {
		t.Errorf("first op should be lock, got %s", result.MutexOps[0].OpType)
	}
	if result.MutexOps[0].MutexVar != "lock" {
		t.Errorf("mutex var should be lock, got %s", result.MutexOps[0].MutexVar)
	}
	if result.MutexOps[1].OpType != "unlock" {
		t.Errorf("second op should be unlock, got %s", result.MutexOps[1].OpType)
	}
}

func TestParseMallocFree(t *testing.T) {
	p := NewParser()
	code := `
void alloc_test() {
    void* p = malloc(100);
    free(p);
}
`
	result := p.Parse(code)

	if len(result.AllocOps) != 2 {
		t.Fatalf("expected 2 alloc ops, got %d", len(result.AllocOps))
	}
	if result.AllocOps[0].OpType != "malloc" {
		t.Errorf("first op should be malloc, got %s", result.AllocOps[0].OpType)
	}
	if result.AllocOps[1].OpType != "free" {
		t.Errorf("second op should be free, got %s", result.AllocOps[1].OpType)
	}
}

func TestParseOpenClose(t *testing.T) {
	p := NewParser()
	code := `
void file_test() {
    int fd = open("test.txt", O_RDONLY);
    close(fd);
}
`
	result := p.Parse(code)

	if len(result.FDOps) != 2 {
		t.Fatalf("expected 2 fd ops, got %d", len(result.FDOps))
	}
	if result.FDOps[0].OpType != "open" {
		t.Errorf("first op should be open, got %s", result.FDOps[0].OpType)
	}
	if result.FDOps[1].OpType != "close" {
		t.Errorf("second op should be close, got %s", result.FDOps[1].OpType)
	}
}

func TestParseReturnStatement(t *testing.T) {
	p := NewParser()
	code := `
int foo() {
    return 42;
}
`
	result := p.Parse(code)

	if len(result.ControlFlows) != 1 {
		t.Fatalf("expected 1 control flow, got %d", len(result.ControlFlows))
	}
	if result.ControlFlows[0].Type != "return" {
		t.Errorf("expected return, got %s", result.ControlFlows[0].Type)
	}
	if result.ControlFlows[0].Line != 3 {
		t.Errorf("expected line 3, got %d", result.ControlFlows[0].Line)
	}
}

func TestParseEmptyCode(t *testing.T) {
	p := NewParser()
	result := p.Parse("")

	if len(result.Functions) != 0 {
		t.Errorf("expected 0 functions for empty code, got %d", len(result.Functions))
	}
}

func TestParseMultiFunction(t *testing.T) {
	p := NewParser()
	code := `
int add(int a, int b) {
    return a + b;
}

void say_hello() {
    printf("hello\n");
}
`
	result := p.Parse(code)

	if len(result.Functions) != 2 {
		t.Fatalf("expected 2 functions, got %d", len(result.Functions))
	}
	if result.Functions[0].Name != "add" {
		t.Errorf("first function should be add, got %s", result.Functions[0].Name)
	}
	if result.Functions[1].Name != "say_hello" {
		t.Errorf("second function should be say_hello, got %s", result.Functions[1].Name)
	}
}

func TestLines(t *testing.T) {
	p := NewParser()
	code := "line1\nline2\nline3"
	lines := p.Lines(code)

	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d", len(lines))
	}
	if lines[0] != "line1" {
		t.Errorf("line 0 should be line1, got %s", lines[0])
	}
	if lines[2] != "line3" {
		t.Errorf("line 2 should be line3, got %s", lines[2])
	}
}
