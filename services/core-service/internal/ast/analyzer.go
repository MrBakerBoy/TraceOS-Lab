package ast

import "fmt"

// Analyzer orchestrates code analysis: parse → detect patterns → assemble result.
type Analyzer struct {
	parser    *Parser
	detector  *PatternDetector
	cfg       *CFGBuilder
}

// NewAnalyzer creates a full code analyzer.
func NewAnalyzer() *Analyzer {
	parser := NewParser()
	return &Analyzer{
		parser:   parser,
		detector: NewPatternDetector(),
		cfg:      NewCFGBuilder(parser),
	}
}

// Analyze performs full analysis on source code.
func (a *Analyzer) Analyze(code string) *AuditResult {
	pr := a.parser.Parse(code)
	cfg := a.cfg.BuildCFG(code, pr)

	// Detect patterns (no LLM needed)
	issues := a.detector.Detect(code, pr, cfg)

	// Build annotations for LLM
	annotations := a.buildAnnotations(pr, cfg)

	// Build summary
	summary := a.buildSummary(issues, pr)

	return &AuditResult{
		Issues:      issues,
		Summary:     summary,
		Annotations: annotations,
	}
}

func (a *Analyzer) buildAnnotations(pr *ParseResult, cfg *CFGResult) []LineAnnotation {
	var annotations []LineAnnotation

	// Mark mutex operations
	for _, m := range pr.MutexOps {
		tag := fmt.Sprintf("mutex_%s", m.OpType)
		detail := fmt.Sprintf("%s on %s", m.OpType, m.MutexVar)
		annotations = append(annotations, LineAnnotation{
			Line: m.Line, Tag: tag, Detail: detail,
		})
	}

	// Mark memory operations
	for _, alloc := range pr.AllocOps {
		tag := fmt.Sprintf("mem_%s", alloc.OpType)
		annotations = append(annotations, LineAnnotation{
			Line: alloc.Line, Tag: tag, Detail: alloc.OpType,
		})
	}

	// Mark fd operations
	for _, fd := range pr.FDOps {
		annotations = append(annotations, LineAnnotation{
			Line: fd.Line, Tag: "fd_op", Detail: fd.OpType,
		})
	}

	// Mark early returns
	cfgBuilder := NewCFGBuilder(a.parser)
	unreachables := cfgBuilder.FindUnreachableCleanup("", pr)
	for _, u := range unreachables {
		if u.SkipsCleanup {
			annotations = append(annotations, LineAnnotation{
				Line:   u.ReturnLine,
				Tag:    "early_return",
				Detail: fmt.Sprintf("跳过第%v行的cleanup", u.CleanupLines),
			})
		}
	}

	return annotations
}

func (a *Analyzer) buildSummary(issues []CodeIssue, pr *ParseResult) AuditSummary {
	summary := AuditSummary{
		TotalIssues: len(issues),
		Categories:  make(map[string]int),
	}

	for _, issue := range issues {
		switch issue.Severity {
		case "error":
			summary.CriticalCount++
		case "warning":
			summary.WarningCount++
		default:
			summary.InfoCount++
		}
		summary.Categories[issue.Category]++
	}

	// Overall quality assessment
	switch {
	case summary.CriticalCount > 3:
		summary.OverallQuality = "poor"
	case summary.CriticalCount > 0:
		summary.OverallQuality = "fair"
	case summary.WarningCount > 3:
		summary.OverallQuality = "good"
	default:
		summary.OverallQuality = "excellent"
	}

	return summary
}
