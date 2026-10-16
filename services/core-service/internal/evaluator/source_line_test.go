package evaluator

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// compileTestBinary compiles a simple C program with -g and returns its path.
// Skips the test if gcc is not available.
func compileTestBinary(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "main.c")
	binPath := filepath.Join(dir, "main")

	code := `#include <unistd.h>
int main() {
    write(1, "hello\n", 6);
    return 0;
}
`
	if err := os.WriteFile(srcPath, []byte(code), 0644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	cmd := exec.Command("gcc", "-g", "-o", binPath, srcPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("gcc not available: %v\n%s", err, out)
	}
	return binPath
}

// runStraceK runs strace -k on a binary and returns the strace output.
// Skips the test if strace -k is not available.
func runStraceK(t *testing.T, binPath string) string {
	t.Helper()
	outFile := filepath.Join(t.TempDir(), "strace.log")
	cmd := exec.Command("strace", "-tt", "-k", "-o", outFile, binPath)
	if err := cmd.Run(); err != nil {
		t.Skipf("strace -k not available: %v", err)
	}
	data, err := os.ReadFile(outFile)
	if err != nil {
		t.Fatalf("read strace output: %v", err)
	}
	return string(data)
}

// TestParseSourceLine_NormalParsing verifies that ParseSourceLine correctly
// resolves strace -k stack trace addresses to source line numbers.
func TestParseSourceLine_NormalParsing(t *testing.T) {
	binPath := compileTestBinary(t)
	straceOutput := runStraceK(t, binPath)

	result := ParseSourceLine(straceOutput, binPath)

	// At least one syscall should have a valid source line > 0
	found := false
	for _, lineNum := range result {
		if lineNum > 0 {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected at least one syscall with a valid source line, got %d entries", len(result))
	}
}

// TestParseSourceLine_Addr2LineFailure verifies graceful handling when
// addr2line cannot resolve addresses (e.g. non-existent binary).
func TestParseSourceLine_Addr2LineFailure(t *testing.T) {
	straceOutput := "12345 12:00:00.000000 write(1, \"hi\", 2) = 2\n" +
		" > /nonexistent/main(main+0x26) [0x116f]\n"
	result := ParseSourceLine(straceOutput, "/nonexistent/binary")

	if len(result) != 0 {
		t.Errorf("expected empty map for non-existent binary, got %v", result)
	}
}

// TestParseSourceLine_NotInSourceRange verifies that addresses outside
// source code (e.g. _start) are not included in the result.
func TestParseSourceLine_NotInSourceRange(t *testing.T) {
	binPath := compileTestBinary(t)

	// Synthetic strace output with an address that resolves to ??:?
	// _start is a linker-generated symbol with no source line
	straceOutput := "12345 12:00:00.000000 execve(\"" + binPath + "\", [\"" + binPath + "\"], 0x7fff) = 0\n" +
		" > " + binPath + "(_start+0x25) [0x1085]\n"

	result := ParseSourceLine(straceOutput, binPath)

	// _start resolves to ??:? so it should NOT produce a source line entry
	for _, lineNum := range result {
		if lineNum > 0 {
			t.Errorf("expected no valid source line for _start address, got line %d", lineNum)
		}
	}
}

// TestParseSourceLine_EmptyInput verifies handling of empty inputs.
func TestParseSourceLine_EmptyInput(t *testing.T) {
	if result := ParseSourceLine("", "/some/binary"); len(result) != 0 {
		t.Errorf("expected empty map for empty strace output, got %v", result)
	}
	if result := ParseSourceLine("some output", ""); len(result) != 0 {
		t.Errorf("expected empty map for empty binary path, got %v", result)
	}
}

// TestParseSourceLine_NoStackTrace verifies handling of strace output
// without -k stack trace entries.
func TestParseSourceLine_NoStackTrace(t *testing.T) {
	straceOutput := "12345 12:00:00.000000 write(1, \"hi\", 2) = 2\n" +
		"12345 12:00:00.000001 read(0, \"\", 0) = 0\n"
	result := ParseSourceLine(straceOutput, "/some/binary")

	if len(result) != 0 {
		t.Errorf("expected empty map for strace without stack traces, got %v", result)
	}
}

// TestParseSourceLine_OnlyLibcFrames verifies that stack trace entries
// from shared libraries (not the binary) are skipped.
func TestParseSourceLine_OnlyLibcFrames(t *testing.T) {
	straceOutput := "12345 12:00:00.000000 write(1, \"hi\", 2) = 2\n" +
		" > /usr/lib/x86_64-linux-gnu/libc.so.6(write+0x10) [0x114a0]\n"
	result := ParseSourceLine(straceOutput, "/tmp/myapp/main")

	if len(result) != 0 {
		t.Errorf("expected empty map when only libc frames present, got %v", result)
	}
}

// TestIsBinaryPath tests the binary path matching logic.
func TestIsBinaryPath(t *testing.T) {
	tests := []struct {
		stracePath string
		binaryPath string
		want       bool
	}{
		{"/tmp/main", "/tmp/main", true},
		{"/binary", "/tmp/traceos-compile-xxx/main", true},   // nsjail mount
		{"/different/path/main", "/other/path/main", true},  // basename match
		{"/path/libc.so", "/path/main", false},              // different basename
		{"", "/path/main", false},                           // empty strace path
	}
	for _, tt := range tests {
		got := isBinaryPath(tt.stracePath, tt.binaryPath)
		if got != tt.want {
			t.Errorf("isBinaryPath(%q, %q) = %v, want %v", tt.stracePath, tt.binaryPath, got, tt.want)
		}
	}
}

// TestParseAddr2LineOutput tests the addr2line output parser.
func TestParseAddr2LineOutput(t *testing.T) {
	tests := []struct {
		input string
		want  int
	}{
		{"/path/to/file.c:42", 42},
		{"/path/to/file.c:1", 1},
		{"??:?", 0},
		{"??:0", 0},
		{"", 0},
		{"nocolon", 0},
	}
	for _, tt := range tests {
		got := parseAddr2LineOutput(tt.input)
		if got != tt.want {
			t.Errorf("parseAddr2LineOutput(%q) = %d, want %d", tt.input, got, tt.want)
		}
	}
}
