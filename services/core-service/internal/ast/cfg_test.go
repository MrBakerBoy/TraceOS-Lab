package ast

import (
	"testing"
)

func TestFindUnreachableCleanupEarlyReturn(t *testing.T) {
	builder := NewCFGBuilder(NewParser())
	p := NewParser()
	code := `
int process_data() {
    pthread_mutex_lock(&lock);
    if (error) {
        return -1;
    }
    pthread_mutex_unlock(&lock);
    return 0;
}
`
	pr := p.Parse(code)
	unreachables := builder.FindUnreachableCleanup(code, pr)

	if len(unreachables) == 0 {
		t.Fatal("expected at least one unreachable return, got none")
	}

	found := false
	for _, u := range unreachables {
		if u.SkipsCleanup && u.ReturnLine == 5 {
			found = true
			if u.FuncName != "process_data" {
				t.Errorf("expected funcName process_data, got %s", u.FuncName)
			}
			break
		}
	}
	if !found {
		t.Errorf("did not find unreachable return at line 5 with SkipsCleanup=true")
	}
}

func TestBuildCFG(t *testing.T) {
	builder := NewCFGBuilder(NewParser())
	p := NewParser()
	code := `
int main() {
    return 0;
}
`
	pr := p.Parse(code)
	cfg := builder.BuildCFG(code, pr)

	if len(cfg.Blocks) != 1 {
		t.Fatalf("expected 1 basic block, got %d", len(cfg.Blocks))
	}
	if cfg.EntryBlock != 0 {
		t.Errorf("expected entry block 0, got %d", cfg.EntryBlock)
	}
	block := cfg.Blocks[0]
	if block.StartLine != 2 {
		t.Errorf("expected StartLine 2, got %d", block.StartLine)
	}
}

func TestFindUnreachableCleanupNoIssue(t *testing.T) {
	builder := NewCFGBuilder(NewParser())
	p := NewParser()
	code := `
int clean_function() {
    pthread_mutex_lock(&lock);
    pthread_mutex_unlock(&lock);
    return 0;
}
`
	pr := p.Parse(code)
	unreachables := builder.FindUnreachableCleanup(code, pr)

	if len(unreachables) != 0 {
		t.Errorf("expected 0 unreachable returns, got %d", len(unreachables))
	}
}
