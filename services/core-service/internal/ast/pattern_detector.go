package ast

import (
	"regexp"
	"strings"
)

// PatternDetector detects known error patterns without LLM.
type PatternDetector struct {
	patterns []Pattern
}

// NewPatternDetector creates a detector with built-in patterns.
func NewPatternDetector() *PatternDetector {
	return &PatternDetector{
		patterns: []Pattern{
			{
				Name:        "unlock-in-early-return",
				Category:    "resource_leak",
				Severity:    "error",
				Description: "early return跳过mutex unlock",
				Suggestion:  "使用goto cleanup模式或确保所有路径都释放锁",
				Tags:        []string{"mutex", "lock", "concurrency"},
			},
			{
				Name:        "double-lock",
				Category:    "race_condition",
				Severity:    "error",
				Description: "同一mutex被连续lock两次",
				Suggestion:  "检查是否误用了不同mutex，或是否应在两次lock之间unlock",
				Tags:        []string{"mutex", "deadlock", "concurrency"},
			},
			{
				Name:        "missing-free",
				Category:    "resource_leak",
				Severity:    "warning",
				Description: "malloc没有对应的free",
				Suggestion:  "每次malloc/calloc都应该有对应的free，建议使用valgrind检查",
				Tags:        []string{"memory", "leak"},
			},
			{
				Name:        "fd-leak",
				Category:    "resource_leak",
				Severity:    "warning",
				Description: "open/fopen没有对应的close/fclose",
				Suggestion:  "确保所有打开的文件描述符都在使用后被关闭",
				Tags:        []string{"fd", "leak", "file"},
			},
			{
				Name:        "unchecked-return",
				Category:    "logic_error",
				Severity:    "warning",
				Description: "系统调用返回值未检查",
				Suggestion:  "检查malloc/fopen/pthread_create等调用的返回值",
				Tags:        []string{"error_handling"},
			},
			{
				Name:        "buffer-overflow-pattern",
				Category:    "logic_error",
				Severity:    "error",
				Description: "sprintf/strcpy等不安全函数",
				Suggestion:  "使用snprintf/strncpy等安全版本并检查缓冲区大小",
				Tags:        []string{"buffer", "security"},
			},
			{
				Name:        "missing-pthread-join",
				Category:    "resource_leak",
				Severity:    "warning",
				Description: "pthread_create后缺少pthread_join",
				Suggestion:  "确保所有线程都被join或detach，否则会导致资源泄漏",
				Tags:        []string{"thread", "resource"},
			},
			{
				Name:        "race-on-shared-var",
				Category:    "race_condition",
				Severity:    "error",
				Description: "多线程访问共享变量无同步保护",
				Suggestion:  "使用mutex、semaphore或atomic操作保护共享变量",
				Tags:        []string{"race", "concurrency"},
			},
		},
	}
}

// Detect runs all pattern checks and returns found issues.
func (d *PatternDetector) Detect(code string, pr *ParseResult, cfg *CFGResult) []CodeIssue {
	var issues []CodeIssue

	// Run CFG-based checks
	cfgBuilder := NewCFGBuilder(NewParser())
	unreachables := cfgBuilder.FindUnreachableCleanup(code, pr)
	for _, u := range unreachables {
		issues = append(issues, CodeIssue{
			Line:     u.ReturnLine,
			Severity: "error",
			Category: "resource_leak",
			Title:    "提前return跳过了资源清理",
			Description: "此return语句之后的unlock/free/close操作将不会被执行，可能导致资源泄漏",
			Suggestion: "使用goto cleanup模式或将清理代码移到return之前",
			Tags:     []string{"unlock-in-early-return", "mutex", "resource"},
		})
	}

	// Run resource tracker
	tracker := &ResourceTracker{}
	leaks := tracker.TrackResources(pr)
	for _, l := range leaks {
		issues = append(issues, CodeIssue{
			Line:        l.Line,
			Severity:    severityFromConfidence(l.Confidence),
			Category:    "resource_leak",
			Title:       l.Issue,
			Description: l.Issue,
			Suggestion:  getSuggestionForIssue(l.Issue),
			Tags:        []string{string(l.Kind)},
		})
	}

	// Mutex patterns: lock without unlock, double lock
	d.detectMutexPatterns(pr.MutexOps, pr, &issues)

	// Memory patterns: malloc without free
	d.detectMemoryPatterns(pr.AllocOps, pr, &issues)

	// File descriptor patterns: open without close
	d.detectFDPatterns(pr.FDOps, pr, &issues)

	// Pattern-based checks on raw code
	issues = append(issues, d.checkPatterns(code)...)

	// --- Security vulnerability detection ---
	issues = append(issues, d.checkSecurity(code)...)

	return issues
}

func (d *PatternDetector) checkPatterns(code string) []CodeIssue {
	var issues []CodeIssue
	lines := strings.Split(code, "\n")

	for i, line := range lines {
		lineNum := i + 1

		// sprintf without snprintf
		if strings.Contains(line, "sprintf(") && !strings.Contains(line, "snprintf") {
			issues = append(issues, CodeIssue{
				Line:     lineNum,
				Severity: "warning",
				Category: "logic_error",
				Title:    "使用了不安全的sprintf",
				Description: "sprintf不检查缓冲区大小，可能导致缓冲区溢出",
				Suggestion: "改用snprintf并指定缓冲区大小",
				Tags:     []string{"buffer-overflow-pattern", "security"},
			})
		}

		// strcpy without strncpy
		if strings.Contains(line, "strcpy(") && !strings.Contains(line, "strncpy") {
			issues = append(issues, CodeIssue{
				Line:     lineNum,
				Severity: "warning",
				Category: "logic_error",
				Title:    "使用了不安全的strcpy",
				Description: "strcpy不检查目标缓冲区大小",
				Suggestion: "改用strncpy并指定最大长度",
				Tags:     []string{"buffer-overflow-pattern", "security"},
			})
		}

		// pthread_create without join/detach check
		if strings.Contains(line, "pthread_create") {
			hasJoin := false
			for _, l := range lines[i+1:] {
				if strings.Contains(l, "pthread_join") || strings.Contains(l, "pthread_detach") {
					hasJoin = true
					break
				}
			}
			if !hasJoin {
				issues = append(issues, CodeIssue{
					Line:     lineNum,
					Severity: "warning",
					Category: "resource_leak",
					Title:    "pthread_create后缺少pthread_join",
					Description: "创建的线程没有被join或detach，可能导致zombie线程",
					Suggestion: "在合适的位置调用pthread_join等待线程结束",
					Tags:     []string{"missing-pthread-join", "thread"},
				})
			}
		}
	}

	return issues
}

// securityRule defines a security vulnerability pattern to detect.
type securityRule struct {
	pattern  string
	cwe      string
	title    string
	desc     string
	fix      string
	severity string
	isRegex  bool
}

// checkSecurity runs security vulnerability pattern checks.
func (d *PatternDetector) checkSecurity(code string) []CodeIssue {
	var issues []CodeIssue

	securityRules := []securityRule{
		{`gets\(`, "CWE-242", "使用危险的 gets() 函数", "gets() 不检查缓冲区边界，可导致缓冲区溢出", "使用 fgets(buf, sizeof(buf), stdin) 替代", "high", false},
		{`scanf\("%s"`, "CWE-120", `scanf("%s") 无边界检查`, `scanf("%s", buf) 不限制输入长度`, `使用 scanf("%99s", buf) 限制宽度`, "high", false},
		{`strcpy\(`, "CWE-120", "strcpy() 可能导致缓冲区溢出", "strcpy() 不检查目标缓冲区大小", "使用 strncpy(dst, src, n) 替代", "medium", false},
		{`strcat\(`, "CWE-120", "strcat() 可能导致缓冲区溢出", "strcat() 拼接时不检查目标缓冲区剩余空间", "使用 strncat(dst, src, n) 替代", "medium", false},
		{`sprintf\(`, "CWE-120", "sprintf() 缓冲区溢出风险", "sprintf() 不限制输出长度", "使用 snprintf(buf, sizeof(buf), ...) 替代", "medium", false},
		{`printf\([^")]*\)`, "CWE-134", "格式化字符串漏洞", "printf(user_input) 中用户输入作为格式字符串", `使用 printf("%s", user_input)`, "high", true},
		{`system\(`, "CWE-78", "system() 命令注入风险", "system() 执行外部命令可能存在注入", "检查输入是否来自用户。推荐使用 exec 系列函数", "medium", false},
		{`chmod\(.*, 0777\)`, "CWE-732", "宽松的文件权限", "chmod 0777 赋予所有人读写执行权限", "使用更严格的权限如 0644", "low", true},
		{`strncpy\(\s*\w+\s*,\s*\w+\s*,\s*sizeof`, "CWE-120", "strncpy 使用不当", "strncpy(dst, src, sizeof(dst)) 不会自动加 null 终止符", `确保最后手动设置 dst[sizeof(dst)-1] = 0`, "low", true},
	}

	for _, rule := range securityRules {
		if rule.isRegex {
			re := regexp.MustCompile(rule.pattern)
			matches := re.FindAllStringIndex(code, -1)
			for _, m := range matches {
				start := m[0]
				line := findLine(code, start)
				issues = append(issues, CodeIssue{
					Line:        line,
					Column:      0,
					Severity:    rule.severity,
					Category:    "security",
					Title:       rule.title,
					Description: rule.desc,
					Suggestion:  rule.fix,
					Tags:        []string{"security", rule.cwe},
					Security:    true,
					CWE:         rule.cwe,
				})
			}
		} else {
			lines := strings.Split(code, "\n")
			for i, line := range lines {
				if strings.Contains(line, rule.pattern) {
					issues = append(issues, CodeIssue{
						Line:        i + 1,
						Column:      0,
						Severity:    rule.severity,
						Category:    "security",
						Title:       rule.title,
						Description: rule.desc,
						Suggestion:  rule.fix,
						Tags:        []string{"security", rule.cwe},
						Security:    true,
						CWE:         rule.cwe,
					})
				}
			}
		}
	}

	return issues
}

// findLine returns the line number (1-based) for a byte offset in the code.
func findLine(code string, offset int) int {
	if offset < 0 || offset >= len(code) {
		return 0
	}
	lineCount := 1
	for i := 0; i < offset; i++ {
		if code[i] == '\n' {
			lineCount++
		}
	}
	return lineCount
}

func severityFromConfidence(c float64) string {
	if c >= 0.8 {
		return "error"
	}
	if c >= 0.5 {
		return "warning"
	}
	return "info"
}

func getSuggestionForIssue(issue string) string {
	switch {
	case strings.Contains(issue, "lock没有对应"):
		return "确保每个lock都有对应的unlock，使用goto cleanup模式"
	case strings.Contains(issue, "连续两次lock"):
		return "检查是否误用了mutex；如需可重入锁，使用递归mutex"
	case strings.Contains(issue, "内存泄漏"):
		return "使用valgrind --leak-check=full检查内存泄漏"
	case strings.Contains(issue, "fd泄漏"):
		return "确保所有open/fopen都有对应的close/fclose"
	default:
		return "请仔细检查相关代码逻辑"
	}
}
