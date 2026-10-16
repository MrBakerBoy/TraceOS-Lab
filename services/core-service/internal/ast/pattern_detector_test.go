package ast

import (
	"testing"
)

func TestDetectSprintfWarning(t *testing.T) {
	detector := NewPatternDetector()
	p := NewParser()
	code := `
void test() {
    char buf[10];
    sprintf(buf, "hello %s", name);
}
`
	pr := p.Parse(code)
	cfg := NewCFGBuilder(p).BuildCFG(code, pr)
	issues := detector.Detect(code, pr, cfg)

	found := false
	for _, issue := range issues {
		if issue.Title == "使用了不安全的sprintf" {
			found = true
			if issue.Severity != "warning" {
				t.Errorf("expected warning severity, got %s", issue.Severity)
			}
			break
		}
	}
	if !found {
		t.Error("did not find sprintf buffer-overflow warning")
	}
}

func TestDetectStrcpyWarning(t *testing.T) {
	detector := NewPatternDetector()
	p := NewParser()
	code := `
void test() {
    char buf[10];
    strcpy(buf, source);
}
`
	pr := p.Parse(code)
	cfg := NewCFGBuilder(p).BuildCFG(code, pr)
	issues := detector.Detect(code, pr, cfg)

	found := false
	for _, issue := range issues {
		if issue.Title == "使用了不安全的strcpy" {
			found = true
			break
		}
	}
	if !found {
		t.Error("did not find strcpy buffer-overflow warning")
	}
}

func TestDetectMissingPthreadJoin(t *testing.T) {
	detector := NewPatternDetector()
	p := NewParser()
	code := `
void test() {
    pthread_t t;
    pthread_create(&t, NULL, worker, NULL);
}
`
	pr := p.Parse(code)
	cfg := NewCFGBuilder(p).BuildCFG(code, pr)
	issues := detector.Detect(code, pr, cfg)

	found := false
	for _, issue := range issues {
		if issue.Title == "pthread_create后缺少pthread_join" {
			found = true
			break
		}
	}
	if !found {
		t.Error("did not find missing pthread_join warning")
	}
}

func TestDetectEmptyCodeNoIssuesFromPatterns(t *testing.T) {
	detector := NewPatternDetector()
	p := NewParser()
	code := ""
	pr := p.Parse(code)
	cfg := NewCFGBuilder(p).BuildCFG(code, pr)
	issues := detector.Detect(code, pr, cfg)

	// should have 0 issues
	patternIssues := 0
	for _, issue := range issues {
		if issue.Category == "logic_error" || issue.Category == "resource_leak" {
			// only count ones from checkPatterns, not resource tracker
			if issue.Title == "使用了不安全的sprintf" || issue.Title == "使用了不安全的strcpy" ||
				issue.Title == "pthread_create后缺少pthread_join" {
				patternIssues++
			}
		}
	}
	if patternIssues != 0 {
		t.Errorf("expected 0 pattern issues for empty code, got %d", patternIssues)
	}
}

func TestDetectSnprintfNoWarning(t *testing.T) {
	detector := NewPatternDetector()
	p := NewParser()
	code := `
void test() {
    char buf[10];
    snprintf(buf, sizeof(buf), "hello %s", name);
}
`
	pr := p.Parse(code)
	cfg := NewCFGBuilder(p).BuildCFG(code, pr)
	issues := detector.Detect(code, pr, cfg)

	for _, issue := range issues {
		if issue.Title == "使用了不安全的sprintf" {
			t.Error("snprintf should not trigger sprintf warning")
		}
	}
}

func TestDetectPthreadJoinPresentNoWarning(t *testing.T) {
	detector := NewPatternDetector()
	p := NewParser()
	code := `
void test() {
    pthread_t t;
    pthread_create(&t, NULL, worker, NULL);
    pthread_join(t, NULL);
}
`
	pr := p.Parse(code)
	cfg := NewCFGBuilder(p).BuildCFG(code, pr)
	issues := detector.Detect(code, pr, cfg)

	for _, issue := range issues {
		if issue.Title == "pthread_create后缺少pthread_join" {
			t.Error("should not warn when pthread_join is present")
		}
	}
}
