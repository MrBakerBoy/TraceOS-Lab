package evaluator

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Compiler handles compiling student code for all supported languages.
type Compiler struct {
	tempDir string
	// Timeout for compilation (prevents infinite compilation loops)
	compileTimeout time.Duration
}

// NewCompiler creates a new compiler with default settings.
func NewCompiler(tempDir string) *Compiler {
	return &Compiler{
		tempDir:        tempDir,
		compileTimeout: 60 * time.Second,
	}
}

// Compile compiles source code and returns the result.
// Supports: c, cpp (C++), python, go, rust
func (c *Compiler) Compile(ctx context.Context, code string, lang string, extraFlags []string) (*CompileResult, error) {
	// Create temp directory for this compilation
	workDir, err := os.MkdirTemp(c.tempDir, "traceos-compile-*")
	if err != nil {
		return nil, fmt.Errorf("create temp dir: %w", err)
	}

	// Set compilation timeout
	compileCtx, cancel := context.WithTimeout(ctx, c.compileTimeout)
	defer cancel()

	var result *CompileResult

	switch lang {
	case "c":
		result = c.compileC(compileCtx, workDir, code, extraFlags)
	case "cpp", "c++":
		result = c.compileCpp(compileCtx, workDir, code, extraFlags)
	case "python", "py":
		result = c.compilePython(compileCtx, workDir, code)
	case "go", "golang":
		result = c.compileGo(compileCtx, workDir, code, extraFlags)
	case "rust", "rs":
		result = c.compileRust(compileCtx, workDir, code, extraFlags)
	default:
		os.RemoveAll(workDir)
		return nil, fmt.Errorf("unsupported language: %s", lang)
	}

	return result, nil
}

// compileC compiles C source code with GCC.
func (c *Compiler) compileC(ctx context.Context, workDir, code string, extraFlags []string) *CompileResult {
	ext := "c"
	compiler := "gcc"
	baseFlags := []string{"-Wall", "-Wextra", "-O2", "-std=gnu11"}
	// Auto-detect math.h and add -lm to avoid undefined reference to pow/sqrt/etc.
	if strings.Contains(code, "math.h") || strings.Contains(code, "<math>") {
		extraFlags = append(extraFlags, "-lm")
	}
	return c.compileWith(ctx, workDir, code, ext, "main", compiler, baseFlags, extraFlags)
}

// compileCpp compiles C++ source code with G++.
func (c *Compiler) compileCpp(ctx context.Context, workDir, code string, extraFlags []string) *CompileResult {
	ext := "cpp"
	compiler := "g++"
	baseFlags := []string{"-Wall", "-Wextra", "-O2", "-std=c++17"}
	return c.compileWith(ctx, workDir, code, ext, "main", compiler, baseFlags, extraFlags)
}

// compilePython checks syntax and creates a wrapper script.
// Python is an interpreted language, so we create a wrapper shell script
// that runs the code through python3.
func (c *Compiler) compilePython(ctx context.Context, workDir, code string) *CompileResult {
	srcFile := filepath.Join(workDir, "main.py")
	if err := os.WriteFile(srcFile, []byte(code), 0644); err != nil {
		return &CompileResult{Success: false, Stderr: fmt.Sprintf("write source: %v", err)}
	}

	// Check Python syntax (compile to bytecode to detect syntax errors)
	checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(checkCtx, "python3", "-m", "py_compile", srcFile)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return &CompileResult{
			Success:    false,
			ErrorLines: parsePythonErrors(string(out)),
			Stderr:     string(out),
		}
	}

	// Create a shell wrapper so the sandbox can execute it
	wrapperPath := filepath.Join(workDir, "main")
	wrapper := fmt.Sprintf("#!/bin/sh\nexec python3 %s \"$@\"\n", srcFile)
	if err := os.WriteFile(wrapperPath, []byte(wrapper), 0755); err != nil {
		return &CompileResult{Success: false, Stderr: fmt.Sprintf("write wrapper: %v", err)}
	}

	return &CompileResult{
		Success:    true,
		BinaryPath: wrapperPath,
	}
}

// compileGo compiles Go source code.
func (c *Compiler) compileGo(ctx context.Context, workDir, code string, extraFlags []string) *CompileResult {
	srcFile := filepath.Join(workDir, "main.go")
	if err := os.WriteFile(srcFile, []byte(code), 0644); err != nil {
		return &CompileResult{Success: false, Stderr: fmt.Sprintf("write source: %v", err)}
	}

	binFile := filepath.Join(workDir, "main")
	args := []string{"build", "-o", binFile}
	args = append(args, extraFlags...)
	args = append(args, srcFile)

	cmd := exec.CommandContext(ctx, "go", args...)
	cmd.Env = append(os.Environ(),
		"GO111MODULE=off", // Disable module mode for single-file compilation
		"GOCACHE="+filepath.Join(workDir, ".gocache"),
	)
	out, err := cmd.CombinedOutput()

	if err != nil {
		return &CompileResult{
			Success:    false,
			ErrorLines: parseGoErrors(string(out)),
			Stderr:     string(out),
		}
	}

	return &CompileResult{
		Success:    true,
		BinaryPath: binFile,
	}
}

// compileRust compiles Rust source code.
func (c *Compiler) compileRust(ctx context.Context, workDir, code string, extraFlags []string) *CompileResult {
	srcFile := filepath.Join(workDir, "main.rs")
	if err := os.WriteFile(srcFile, []byte(code), 0644); err != nil {
		return &CompileResult{Success: false, Stderr: fmt.Sprintf("write source: %v", err)}
	}

	binFile := filepath.Join(workDir, "main")
	args := []string{"rustc", "-o", binFile}
	args = append(args, extraFlags...)
	args = append(args, srcFile)

	cmd := exec.CommandContext(ctx, "rustc", args...)
	out, err := cmd.CombinedOutput()

	if err != nil {
		return &CompileResult{
			Success:    false,
			ErrorLines: parseRustErrors(string(out)),
			Stderr:     string(out),
		}
	}

	return &CompileResult{
		Success:    true,
		BinaryPath: binFile,
	}
}

// compileWith is a generic helper for compiled languages.
func (c *Compiler) compileWith(ctx context.Context, workDir, code, ext, binName, compiler string, baseFlags, extraFlags []string) *CompileResult {
	srcFile := filepath.Join(workDir, binName+"."+ext)
	binFile := filepath.Join(workDir, binName)

	if err := os.WriteFile(srcFile, []byte(code), 0644); err != nil {
		return &CompileResult{Success: false, Stderr: fmt.Sprintf("write source: %v", err)}
	}

	// Split extra flags: compile flags before source, link flags after source
	// This matters because GNU ld --as-needed ignores libraries before the objects that need them
	var compileFlags, linkFlags []string
	for _, f := range extraFlags {
		if strings.HasPrefix(f, "-l") || strings.HasPrefix(f, "-Wl,") {
			linkFlags = append(linkFlags, f)
		} else {
			compileFlags = append(compileFlags, f)
		}
	}
	args := append(baseFlags, compileFlags...)
	args = append(args, "-o", binFile, srcFile)
	args = append(args, linkFlags...)

	cmd := exec.CommandContext(ctx, compiler, args...)
	out, err := cmd.CombinedOutput()

	if err != nil {
		return &CompileResult{
			Success:    false,
			ErrorLines: parseCompileErrors(string(out)),
			Stderr:     string(out),
		}
	}

	return &CompileResult{
		Success:    true,
		BinaryPath: binFile,
	}
}

var gccErrorRe = regexp.MustCompile(`^(.+?):(\d+):(\d+):\s+(error|warning):\s+(.+)$`)

func parseCompileErrors(stderr string) []ErrorLine {
	var lines []ErrorLine
	for _, line := range strings.Split(stderr, "\n") {
		m := gccErrorRe.FindStringSubmatch(strings.TrimSpace(line))
		if m != nil {
			lineNum, _ := strconv.Atoi(m[2])
			colNum, _ := strconv.Atoi(m[3])
			lines = append(lines, ErrorLine{
				Type:    m[4],
				File:    m[1],
				Line:    lineNum,
				Column:  colNum,
				Message: m[5],
			})
		}
	}
	return lines
}

// parsePythonErrors extracts Python syntax error information.
func parsePythonErrors(stderr string) []ErrorLine {
	// Python syntax errors have format: SyntaxError: ... (file.py, line N)
	pyErrRe := regexp.MustCompile(`(?i)(SyntaxError|IndentationError|NameError|TypeError):?\s+(.+?)(?:\s*\(.*?,\s*line\s*(\d+)\))?$`)
	var lines []ErrorLine
	for _, line := range strings.Split(stderr, "\n") {
		m := pyErrRe.FindStringSubmatch(strings.TrimSpace(line))
		if m != nil {
			lineNum := 0
			if m[3] != "" {
				lineNum, _ = strconv.Atoi(m[3])
			}
			lines = append(lines, ErrorLine{
				Type:    "error",
				File:    "main.py",
				Line:    lineNum,
				Message: fmt.Sprintf("%s: %s", m[1], m[2]),
			})
		}
	}
	return lines
}

// parseGoErrors extracts Go compilation error information.
func parseGoErrors(stderr string) []ErrorLine {
	goErrRe := regexp.MustCompile(`^(.+?):(\d+):(\d+):\s+(.+)$`)
	var lines []ErrorLine
	for _, line := range strings.Split(stderr, "\n") {
		m := goErrRe.FindStringSubmatch(strings.TrimSpace(line))
		if m != nil {
			lineNum, _ := strconv.Atoi(m[2])
			colNum, _ := strconv.Atoi(m[3])
			lines = append(lines, ErrorLine{
				Type:    "error",
				File:    m[1],
				Line:    lineNum,
				Column:  colNum,
				Message: m[4],
			})
		}
	}
	return lines
}

// parseRustErrors extracts Rust compilation error information.
func parseRustErrors(stderr string) []ErrorLine {
	rustErrRe := regexp.MustCompile(`(?i)error(?:\[\w+\])?:\s+(.+?)\s*-->?\s*(.+?):(\d+):(\d+)`)
	var lines []ErrorLine
	for _, line := range strings.Split(stderr, "\n") {
		m := rustErrRe.FindStringSubmatch(strings.TrimSpace(line))
		if m != nil {
			lineNum, _ := strconv.Atoi(m[3])
			colNum, _ := strconv.Atoi(m[4])
			lines = append(lines, ErrorLine{
				Type:    "error",
				File:    m[2],
				Line:    lineNum,
				Column:  colNum,
				Message: m[1],
			})
		}
	}
	return lines
}
