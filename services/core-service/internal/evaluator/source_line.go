package evaluator

import (
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// stackTraceRe matches strace -k stack trace entries.
// Format: " > /path/binary(func+offset) [0xADDR]"
var stackTraceRe = regexp.MustCompile(`^\s*>\s+(\S+)\(.+?\)\s+\[0x([0-9a-fA-F]+)\]`)

// ParseSourceLine parses strace -k output and resolves stack trace addresses
// to source line numbers using addr2line.
//
// It returns a map where the key is the 0-indexed line number in straceOutput
// at which a syscall appears, and the value is the resolved source line number.
// Entries that cannot be resolved (addr2line failure, address not in binary,
// or address outside source code) are omitted from the map.
func ParseSourceLine(straceOutput string, binaryPath string) map[int]int {
	result := make(map[int]int)
	if straceOutput == "" || binaryPath == "" {
		return result
	}

	lines := strings.Split(straceOutput, "\n")

	// Collect (syscallLineIndex, address) pairs - only the first binary frame per syscall.
	type addrEntry struct {
		syscallLine int
		addr        string
	}
	var entries []addrEntry
	currentSyscallLine := -1
	seenSyscalls := make(map[int]bool)

	for i, line := range lines {
		// Detect syscall lines using the existing strace parser
		parsed := parseStraceLine(line)
		if parsed != nil && parsed.syscall != "" {
			currentSyscallLine = i
			continue
		}

		// Detect stack trace lines from strace -k
		m := stackTraceRe.FindStringSubmatch(line)
		if m != nil && currentSyscallLine >= 0 {
			path := m[1]
			addr := m[2]
			// Only resolve addresses belonging to the target binary.
			// Only take the first (innermost) binary frame per syscall.
			if isBinaryPath(path, binaryPath) && !seenSyscalls[currentSyscallLine] {
				entries = append(entries, addrEntry{syscallLine: currentSyscallLine, addr: addr})
				seenSyscalls[currentSyscallLine] = true
			}
		}
	}

	if len(entries) == 0 {
		return result
	}

	// Batch-resolve all addresses in a single addr2line invocation.
	addrs := make([]string, len(entries))
	for i, e := range entries {
		addrs[i] = "0x" + e.addr
	}

	cmd := exec.Command("addr2line", append([]string{"-e", binaryPath, "-f"}, addrs...)...)
	out, err := cmd.Output()
	if err != nil {
		// addr2line failed or not installed - return empty map (no source lines)
		return result
	}

	// addr2line -f output: pairs of (function-name, file:line) per address
	outLines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i, e := range entries {
		idx := i * 2
		if idx+1 >= len(outLines) {
			break
		}
		lineNum := parseAddr2LineOutput(outLines[idx+1])
		if lineNum > 0 {
			result[e.syscallLine] = lineNum
		}
	}

	return result
}

// isBinaryPath checks whether a strace stack-trace path corresponds to the
// target binary. Handles exact path match, /binary (nsjail mount point),
// and basename match.
func isBinaryPath(stracePath, binaryPath string) bool {
	if stracePath == binaryPath {
		return true
	}
	if stracePath == "/binary" {
		return true
	}
	straceBase := stracePath
	if idx := strings.LastIndex(stracePath, "/"); idx >= 0 {
		straceBase = stracePath[idx+1:]
	}
	binaryBase := binaryPath
	if idx := strings.LastIndex(binaryPath, "/"); idx >= 0 {
		binaryBase = binaryPath[idx+1:]
	}
	return straceBase != "" && straceBase == binaryBase
}

// parseAddr2LineOutput extracts the line number from an addr2line file:line string.
// Returns 0 for unresolved addresses (??:? or ??:0).
func parseAddr2LineOutput(fileLine string) int {
	fileLine = strings.TrimSpace(fileLine)
	if fileLine == "??:?" || fileLine == "??:0" || fileLine == "" {
		return 0
	}
	idx := strings.LastIndex(fileLine, ":")
	if idx < 0 {
		return 0
	}
	lineNum, err := strconv.Atoi(fileLine[idx+1:])
	if err != nil {
		return 0
	}
	return lineNum
}
