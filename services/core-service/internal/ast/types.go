package ast

// CodeIssue represents a single code-level issue found by the analyzer.
type CodeIssue struct {
	Line        int      `json:"line"`
	Column      int      `json:"column"`
	EndLine     int      `json:"end_line,omitempty"`
	Severity    string   `json:"severity"` // error, warning, info
	Category    string   `json:"category"` // resource_leak, race_condition, logic_error, style
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Suggestion  string   `json:"suggestion"`
	Tags        []string `json:"tags"`
	Security    bool     `json:"security,omitempty"`
	CWE         string   `json:"cwe,omitempty"`
}

// AuditResult holds the complete code audit output.
type AuditResult struct {
	Issues      []CodeIssue          `json:"issues"`
	Summary     AuditSummary         `json:"summary"`
	Annotations []LineAnnotation     `json:"annotations"`
}

// AuditSummary is a high-level overview.
type AuditSummary struct {
	TotalIssues    int               `json:"total_issues"`
	CriticalCount  int               `json:"critical_count"`
	WarningCount   int               `json:"warning_count"`
	InfoCount      int               `json:"info_count"`
	Categories     map[string]int    `json:"categories"`
	OverallQuality string            `json:"overall_quality"` // excellent, good, fair, poor
}

// LineAnnotation is a structured annotation for feeding to the LLM.
type LineAnnotation struct {
	Line    int    `json:"line"`
	Tag     string `json:"tag"`
	Detail  string `json:"detail"`
}

// Pattern represents a known error pattern for detection.
type Pattern struct {
	Name        string   `json:"name"`
	Category    string   `json:"category"`
	Severity    string   `json:"severity"`
	Description string   `json:"description"`
	Suggestion  string   `json:"suggestion"`
	Tags        []string `json:"tags"`
}
