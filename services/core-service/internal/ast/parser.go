package ast

import (
	"bufio"
	"regexp"
	"strings"
)

// Parser does lightweight structural analysis of C source code.
// For OCaml competition constraints, we implement regex+state-machine parsing
// instead of depending on external C libraries like tree-sitter.
type Parser struct{}

// NewParser creates a new parser.
func NewParser() *Parser {
	return &Parser{}
}

// ParseResult holds the structured analysis of source code.
type ParseResult struct {
	Functions    []Function    `json:"functions"`
	MutexOps     []MutexOp     `json:"mutex_ops"`
	AllocOps     []AllocOp     `json:"alloc_ops"`
	FDOps        []FDOp        `json:"fd_ops"`
	ControlFlows []ControlFlow `json:"control_flows"`
}

// Function represents a parsed C function.
type Function struct {
	Name       string `json:"name"`
	StartLine  int    `json:"start_line"`
	EndLine    int    `json:"end_line"`
	ReturnType string `json:"return_type"`
}

// MutexOp represents a mutex operation (lock/unlock).
type MutexOp struct {
	Line     int    `json:"line"`
	OpType   string `json:"op_type"` // lock, unlock, init, destroy
	MutexVar string `json:"mutex_var"`
	FuncName string `json:"func_name"`
}

// AllocOp represents a memory allocation/free operation.
type AllocOp struct {
	Line     int    `json:"line"`
	OpType   string `json:"op_type"` // malloc, calloc, realloc, free
	VarName  string `json:"var_name,omitempty"`
	FuncName string `json:"func_name"`
}

// FDOp represents a file descriptor operation.
type FDOp struct {
	Line     int    `json:"line"`
	OpType   string `json:"op_type"` // open, close, fopen, fclose, socket
	Target   string `json:"target"`
	FuncName string `json:"func_name"`
}

// ControlFlow represents a control flow branch point.
type ControlFlow struct {
	Line     int    `json:"line"`
	Type     string `json:"type"` // return, goto, break, continue, if_return
	FuncName string `json:"func_name"`
}

// Parse analyzes C source code and extracts structural information.
func (p *Parser) Parse(code string) *ParseResult {
	lines := strings.Split(code, "\n")
	result := &ParseResult{}

	funcRe := regexp.MustCompile(`^\s*(?:static\s+)?(?:inline\s+)?(?:void|int|char|long|short|float|double|unsigned|signed|struct\s+\w+|pthread_\w+_t|size_t|ssize_t|pid_t|FILE\s*\*)\s*\*?\s*(\w+)\s*\(`)
	mutexLockRe := regexp.MustCompile(`pthread_mutex_lock\s*\(\s*&?(\w+)`)
	mutexUnlockRe := regexp.MustCompile(`pthread_mutex_unlock\s*\(\s*&?(\w+)`)
	mallocRe := regexp.MustCompile(`(?:\([^)]*\)\s*=\s*)?(?:malloc|calloc|realloc)\s*\(`)
	freeRe := regexp.MustCompile(`free\s*\(\s*(\w+)`)
	fopenRe := regexp.MustCompile(`fopen\s*\(`)
	fcloseRe := regexp.MustCompile(`fclose\s*\(`)
	openRe := regexp.MustCompile(`(?:\bopen\s*\()`)
	closeRe := regexp.MustCompile(`(?:\bclose\s*\(\s*(\w+))`)
	returnRe := regexp.MustCompile(`\breturn\b`)
	gotoRe := regexp.MustCompile(`\bgoto\b`)

	var currentFunc string
	var funcStart int
	braceDepth := 0

	for i, line := range lines {
		lineNum := i + 1
		trimmed := strings.TrimSpace(line)

		// Skip comments and preprocessor
		if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "/*") {
			continue
		}

		// Track braces
		braceDepth += strings.Count(trimmed, "{") - strings.Count(trimmed, "}")

		// Function detection
		if matches := funcRe.FindStringSubmatch(trimmed); len(matches) >= 2 && !strings.Contains(trimmed, ";") {
			currentFunc = matches[1]
			funcStart = lineNum
		}

		// Track function end
		if braceDepth == 0 && currentFunc != "" {
			result.Functions = append(result.Functions, Function{
				Name: currentFunc, StartLine: funcStart, EndLine: lineNum,
			})
			currentFunc = ""
		}

		// Mutex operations
		if matches := mutexLockRe.FindStringSubmatch(trimmed); len(matches) >= 2 {
			result.MutexOps = append(result.MutexOps, MutexOp{
				Line: lineNum, OpType: "lock", MutexVar: matches[1], FuncName: currentFunc,
			})
		}
		if matches := mutexUnlockRe.FindStringSubmatch(trimmed); len(matches) >= 2 {
			result.MutexOps = append(result.MutexOps, MutexOp{
				Line: lineNum, OpType: "unlock", MutexVar: matches[1], FuncName: currentFunc,
			})
		}

		// Memory operations
		if mallocRe.MatchString(trimmed) {
			result.AllocOps = append(result.AllocOps, AllocOp{
				Line: lineNum, OpType: "malloc", FuncName: currentFunc,
			})
		}
		if matches := freeRe.FindStringSubmatch(trimmed); len(matches) >= 2 {
			result.AllocOps = append(result.AllocOps, AllocOp{
				Line: lineNum, OpType: "free", VarName: matches[1], FuncName: currentFunc,
			})
		}

		// FD operations
		if openRe.MatchString(trimmed) || fopenRe.MatchString(trimmed) {
			result.FDOps = append(result.FDOps, FDOp{
				Line: lineNum, OpType: "open", Target: trimmed, FuncName: currentFunc,
			})
		}
		if matches := closeRe.FindStringSubmatch(trimmed); len(matches) >= 2 || fcloseRe.MatchString(trimmed) {
			target := ""
			if len(matches) >= 2 {
				target = matches[1]
			}
			result.FDOps = append(result.FDOps, FDOp{
				Line: lineNum, OpType: "close", Target: target, FuncName: currentFunc,
			})
		}

		// Control flow
		if returnRe.MatchString(trimmed) {
			result.ControlFlows = append(result.ControlFlows, ControlFlow{
				Line: lineNum, Type: "return", FuncName: currentFunc,
			})
		}
		if gotoRe.MatchString(trimmed) {
			result.ControlFlows = append(result.ControlFlows, ControlFlow{
				Line: lineNum, Type: "goto", FuncName: currentFunc,
			})
		}
	}

	return result
}

// Lines returns the source code split into lines.
func (p *Parser) Lines(code string) []string {
	scanner := bufio.NewScanner(strings.NewReader(code))
	var lines []string
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	return lines
}
