package ast

import (
	"testing"
)

func TestAnalyzeMutexBug(t *testing.T) {
	analyzer := NewAnalyzer()
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
	result := analyzer.Analyze(code)

	if len(result.Issues) == 0 {
		t.Fatal("expected issues for mutex bug code, got none")
	}

	// Verify annotations are present
	if len(result.Annotations) == 0 {
		t.Fatal("expected annotations, got none")
	}

	// Verify at least one mutex annotation
	hasMutexAnnotation := false
	for _, a := range result.Annotations {
		if a.Tag == "mutex_lock" || a.Tag == "mutex_unlock" {
			hasMutexAnnotation = true
		}
		// early_return annotation should exist
		if a.Tag == "early_return" {
			t.Logf("found early_return annotation at line %d: %s", a.Line, a.Detail)
		}
	}
	if !hasMutexAnnotation {
		t.Error("expected mutex annotations")
	}

	// Verify summary
	if result.Summary.TotalIssues != len(result.Issues) {
		t.Errorf("TotalIssues mismatch: %d vs %d", result.Summary.TotalIssues, len(result.Issues))
	}
	if result.Summary.OverallQuality == "" {
		t.Error("OverallQuality should not be empty")
	}
	t.Logf("OverallQuality: %s", result.Summary.OverallQuality)
}

func TestAnalyzeCleanCode(t *testing.T) {
	analyzer := NewAnalyzer()
	code := `
int add(int a, int b) {
    return a + b;
}
`
	result := analyzer.Analyze(code)

	// Clean code should have minimal issues
	if len(result.Issues) > 0 {
		t.Logf("clean code issues: %+v", result.Issues)
	}
	// Should still have annotations for function structure
	if result.Summary.OverallQuality == "" {
		t.Error("OverallQuality should not be empty")
	}
}

func TestAnalyzeMemoryLeak(t *testing.T) {
	analyzer := NewAnalyzer()
	code := `
void leaky() {
    void* p = malloc(100);
    void* q = malloc(200);
    free(p);
}
`
	result := analyzer.Analyze(code)

	hasMemoryLeak := false
	for _, issue := range result.Issues {
		if issue.Category == "resource_leak" {
			t.Logf("resource leak issue: %s", issue.Title)
			hasMemoryLeak = true
		}
	}
	if !hasMemoryLeak {
		t.Error("expected memory leak issue")
	}
}

func TestAnalyzeBufferOverflow(t *testing.T) {
	analyzer := NewAnalyzer()
	code := `
void unsafe_func() {
    char buf[10];
    strcpy(buf, user_input);
    sprintf(buf + 5, "%d", value);
}
`
	result := analyzer.Analyze(code)

	sprintfCount := 0
	strcpyCount := 0
	for _, issue := range result.Issues {
		if issue.Title == "使用了不安全的sprintf" {
			sprintfCount++
		}
		if issue.Title == "使用了不安全的strcpy" {
			strcpyCount++
		}
	}
	if sprintfCount < 1 {
		t.Error("expected at least 1 sprintf warning")
	}
	if strcpyCount < 1 {
		t.Error("expected at least 1 strcpy warning")
	}
}

func TestAnalyzeEmptyCode(t *testing.T) {
	analyzer := NewAnalyzer()
	result := analyzer.Analyze("")

	if len(result.Issues) != 0 {
		t.Errorf("expected 0 issues for empty code, got %d", len(result.Issues))
	}
	if result.Summary.TotalIssues != 0 {
		t.Errorf("expected 0 total issues, got %d", result.Summary.TotalIssues)
	}
	if result.Summary.OverallQuality != "excellent" {
		t.Errorf("expected excellent quality for empty code, got %s", result.Summary.OverallQuality)
	}
}
