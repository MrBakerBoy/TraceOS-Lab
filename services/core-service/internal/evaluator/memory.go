package evaluator

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// MmapRegion describes a single memory-mapped region from /proc/<pid>/maps.
type MmapRegion struct {
	Start    uint64 `json:"start"`
	End      uint64 `json:"end"`
	Size     uint64 `json:"size"`
	Perms    string `json:"perms"`
	Offset   uint64 `json:"offset"`
	Dev      string `json:"dev"`
	Inode    uint64 `json:"inode"`
	Path     string `json:"path"`
	Category string `json:"category"`
}

// MemoryLayoutSnapshot captures the process memory layout at a point in time.
type MemoryLayoutSnapshot struct {
	Timestamp   time.Time    `json:"timestamp"`
	TextStart   uint64       `json:"text_start"`
	TextSize    uint64       `json:"text_size"`
	DataStart   uint64       `json:"data_start"`
	DataSize    uint64       `json:"data_size"`
	BSSStart    uint64       `json:"bss_start"`
	BSSSize     uint64       `json:"bss_size"`
	HeapStart   uint64       `json:"heap_start"`
	HeapSize    uint64       `json:"heap_size"`
	StackStart  uint64       `json:"stack_start"`
	StackSize   uint64       `json:"stack_size"`
	MmapRegions []MmapRegion `json:"mmap_regions"`
}

// mapsLineRe matches a /proc/<pid>/maps line:
// start-end perms offset dev inode pathname
var mapsLineRe = regexp.MustCompile(
	`^([0-9a-fA-F]+)-([0-9a-fA-F]+)\s+(\S+)\s+([0-9a-fA-F]+)\s+(\S+)\s+(\d+)\s*(.*)$`,
)

// memStraceRe matches memory-related strace lines. Unlike the shared strace
// parser, it accepts hex return values (brk/mmap return addresses) as well as
// decimal values, so it does not interfere with the existing trace pipeline.
var memStraceRe = regexp.MustCompile(
	`^(?:(\d+)\s+)?\d{2}:\d{2}:\d{2}\.\d+\s+(\w+)\((.*)\)\s*=\s*(-?0x[0-9a-fA-F]+|-?\d+|\?)\s*(<[\d.]+>)?\s*(E\w+)?`,
)

// ParseProcMaps reads /proc/<pid>/maps and builds a MemoryLayoutSnapshot.
//
// Segment identification rules:
//   - "[heap]"  -> heap
//   - "[stack]" (or "[stack:<tid>]") -> stack
//   - "r-x" perms (executable) -> text
//   - "rw-" with a file path -> data
//   - "rw-" with no path (anonymous) -> bss
//   - everything else -> mapped region (mmap)
//
// The first region found for each standard segment populates the snapshot's
// Start/Size fields; all regions are also kept in MmapRegions for completeness.
func ParseProcMaps(pid int) (*MemoryLayoutSnapshot, error) {
	path := fmt.Sprintf("/proc/%d/maps", pid)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return ParseProcMapsContent(string(data)), nil
}

// ParseProcMapsContent parses the textual content of a /proc/<pid>/maps file
// into a MemoryLayoutSnapshot. An empty input yields a valid, zero-value snapshot.
func ParseProcMapsContent(content string) *MemoryLayoutSnapshot {
	snap := &MemoryLayoutSnapshot{Timestamp: time.Now()}

	scanner := bufio.NewScanner(strings.NewReader(content))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		region, ok := parseMapsLine(line)
		if !ok {
			continue
		}
		region.Category = classifyRegion(region)

		// Populate standard segment fields from the first matching region.
		switch region.Category {
		case "text":
			if snap.TextSize == 0 {
				snap.TextStart = region.Start
				snap.TextSize = region.Size
			}
		case "data":
			if snap.DataSize == 0 {
				snap.DataStart = region.Start
				snap.DataSize = region.Size
			}
		case "bss":
			if snap.BSSSize == 0 {
				snap.BSSStart = region.Start
				snap.BSSSize = region.Size
			}
		case "heap":
			if snap.HeapSize == 0 {
				snap.HeapStart = region.Start
				snap.HeapSize = region.Size
			}
		case "stack":
			if snap.StackSize == 0 {
				snap.StackStart = region.Start
				snap.StackSize = region.Size
			}
		}

		snap.MmapRegions = append(snap.MmapRegions, region)
	}

	return snap
}

// parseMapsLine parses a single maps line into an MmapRegion.
func parseMapsLine(line string) (MmapRegion, bool) {
	m := mapsLineRe.FindStringSubmatch(line)
	if m == nil {
		return MmapRegion{}, false
	}
	start, err1 := strconv.ParseUint(m[1], 16, 64)
	end, err2 := strconv.ParseUint(m[2], 16, 64)
	if err1 != nil || err2 != nil {
		return MmapRegion{}, false
	}
	offset, _ := strconv.ParseUint(m[4], 16, 64)
	inode, _ := strconv.ParseUint(m[6], 10, 64)
	return MmapRegion{
		Start:  start,
		End:    end,
		Size:   end - start,
		Perms:  m[3],
		Offset: offset,
		Dev:    m[5],
		Inode:  inode,
		Path:   strings.TrimSpace(m[7]),
	}, true
}

// classifyRegion maps a region's permissions/path to a standard segment name.
func classifyRegion(r MmapRegion) string {
	path, perms := r.Path, r.Perms
	switch {
	case path == "[heap]":
		return "heap"
	case path == "[stack]" || strings.HasPrefix(path, "[stack:"):
		return "stack"
	case strings.HasPrefix(path, "[vvar]") || strings.HasPrefix(path, "[vdso]") || strings.HasPrefix(path, "[vsyscall]"):
		return "vvar"
	case strings.HasPrefix(path, "[anon"):
		return "anon"
	case strings.Contains(perms, "x"):
		return "text" // executable segment (r-xp)
	case strings.HasPrefix(perms, "rw") && path == "":
		return "bss" // writable, anonymous, no file backing
	case strings.HasPrefix(perms, "rw") && path != "":
		return "data" // writable, file-backed
	case strings.HasPrefix(perms, "r--"):
		return "rodata"
	default:
		return "mmap"
	}
}

// memEvent is a parsed memory-related strace line.
type memEvent struct {
	syscall string
	retVal  int64 // parsed return value (hex or decimal)
	args    string // raw arguments inside the parentheses
}

// parseMemoryStraceLine parses a memory-related strace line, supporting hex
// return values for brk/mmap. Returns nil if the line does not match.
func parseMemoryStraceLine(line string) *memEvent {
	m := memStraceRe.FindStringSubmatch(strings.TrimSpace(line))
	if m == nil {
		return nil
	}
	ev := &memEvent{syscall: m[2], args: m[3]}
	raw := m[4]
	if raw == "?" {
		ev.retVal = -1
	} else if strings.HasPrefix(raw, "0x") || strings.HasPrefix(raw, "0X") {
		v, _ := strconv.ParseInt(raw[2:], 16, 64)
		ev.retVal = v
	} else if strings.HasPrefix(raw, "-0x") || strings.HasPrefix(raw, "-0X") {
		v, _ := strconv.ParseInt(raw[3:], 16, 64)
		ev.retVal = -v
	} else {
		v, _ := strconv.ParseInt(raw, 10, 64)
		ev.retVal = v
	}
	return ev
}

// CollectMemorySnapshots replays strace memory events (brk/mmap/munmap/mprotect)
// on top of an initial /proc/<pid>/maps snapshot, producing a timestamped
// snapshot after each event.
//
// The initial snapshot itself is NOT included in the returned slice; only the
// incremental snapshots derived from each event are returned.
func CollectMemorySnapshots(initialSnapshot *MemoryLayoutSnapshot, straceOutput string) []MemoryLayoutSnapshot {
	if initialSnapshot == nil {
		initialSnapshot = &MemoryLayoutSnapshot{Timestamp: time.Now()}
	}

	// Mutable working state copied from the initial snapshot.
	heapStart := initialSnapshot.HeapStart
	heapEnd := initialSnapshot.HeapStart + initialSnapshot.HeapSize
	regions := make([]MmapRegion, len(initialSnapshot.MmapRegions))
	copy(regions, initialSnapshot.MmapRegions)

	baseTime := initialSnapshot.Timestamp
	if baseTime.IsZero() {
		baseTime = time.Now()
	}

	var snapshots []MemoryLayoutSnapshot
	for idx, line := range strings.Split(straceOutput, "\n") {
		ev := parseMemoryStraceLine(line)
		if ev == nil {
			continue
		}

		var changed bool
		switch ev.syscall {
		case "brk":
			changed = applyBrk(ev, &heapStart, &heapEnd)
		case "mmap", "mmap2":
			changed = applyMmap(ev, &regions)
		case "munmap":
			changed = applyMunmap(ev, &regions)
		case "mprotect":
			changed = applyMprotect(ev, &regions)
		}
		if !changed {
			continue
		}

		snapshots = append(snapshots, MemoryLayoutSnapshot{
			Timestamp:   baseTime.Add(time.Duration(idx+1) * time.Millisecond),
			TextStart:   initialSnapshot.TextStart,
			TextSize:    initialSnapshot.TextSize,
			DataStart:   initialSnapshot.DataStart,
			DataSize:    initialSnapshot.DataSize,
			BSSStart:    initialSnapshot.BSSStart,
			BSSSize:     initialSnapshot.BSSSize,
			HeapStart:   heapStart,
			HeapSize:    heapEnd - heapStart,
			StackStart:  initialSnapshot.StackStart,
			StackSize:   initialSnapshot.StackSize,
			MmapRegions: cloneRegions(regions),
		})
	}

	return snapshots
}

// applyBrk handles a brk(addr) = new_break event, growing/shrinking the heap.
// The return value of brk is the new program break. A zero-break or unchanged
// break (query) produces no snapshot.
func applyBrk(ev *memEvent, heapStart, heapEnd *uint64) bool {
	if ev.retVal <= 0 {
		return false
	}
	newBreak := uint64(ev.retVal)
	if newBreak == *heapEnd {
		return false
	}
	if *heapStart == 0 {
		// First brk establishes the heap base.
		*heapStart = newBreak
	}
	*heapEnd = newBreak
	return true
}

// applyMmap handles mmap(...) = addr events by appending a new region.
func applyMmap(ev *memEvent, regions *[]MmapRegion) bool {
	if ev.retVal < 0 {
		return false
	}
	addr := uint64(ev.retVal)
	size := parseNthArg(ev.args, 2)   // mmap(addr, length, ...) -> 2nd positional arg
	if size == 0 {
		return false
	}
	*regions = append(*regions, MmapRegion{
		Start:    addr,
		End:      addr + size,
		Size:     size,
		Perms:    "rw-p",
		Category: "mmap",
	})
	return true
}

// applyMunmap handles munmap(addr, length) = 0 events by removing matching regions.
func applyMunmap(ev *memEvent, regions *[]MmapRegion) bool {
	if ev.retVal != 0 {
		return false
	}
	addr := parseNthArg(ev.args, 1)
	length := parseNthArg(ev.args, 2)
	if addr == 0 {
		return false
	}
	end := addr + length
	kept := (*regions)[:0]
	removed := false
	for _, r := range *regions {
		// Drop regions that fall fully inside the unmapped range.
		if r.Start >= addr && r.End <= end {
			removed = true
			continue
		}
		kept = append(kept, r)
	}
	if removed {
		*regions = kept
	}
	return removed
}

// applyMprotect handles mprotect(addr, len, prot) = 0 events by updating perms.
func applyMprotect(ev *memEvent, regions *[]MmapRegion) bool {
	if ev.retVal != 0 {
		return false
	}
	addr := parseNthArg(ev.args, 1)
	length := parseNthArg(ev.args, 2)
	prot := parseProt(ev.args, 3)
	if addr == 0 {
		return false
	}
	end := addr + length
	changed := false
	for i := range *regions {
		if (*regions)[i].Start >= addr && (*regions)[i].End <= end {
			(*regions)[i].Perms = prot
			changed = true
		}
	}
	return changed
}

// parseNthArg extracts the numeric/hex value of the n-th (1-based) positional
// argument from a comma-separated argument list. This is robust against
// non-numeric placeholders such as NULL appearing earlier in the list, which
// would otherwise shift a purely numeric extraction off by one.
func parseNthArg(args string, n int) uint64 {
	tokens := strings.Split(args, ",")
	if n <= 0 || n > len(tokens) {
		return 0
	}
	t := strings.TrimSpace(tokens[n-1])
	if t == "" {
		return 0
	}
	// Strip pointer casts like "0x7f...(void *)".
	if open := strings.IndexByte(t, '('); open >= 0 {
		if close := strings.LastIndexByte(t, ')'); close > open {
			t = strings.TrimSpace(t[open+1 : close])
		}
	}
	switch {
	case strings.HasPrefix(t, "0x"), strings.HasPrefix(t, "0X"):
		if v, err := strconv.ParseUint(t[2:], 16, 64); err == nil {
			return v
		}
	case strings.HasPrefix(t, "-0x"), strings.HasPrefix(t, "-0X"):
		// Negative hex not expected for sizes/addresses; ignore.
	default:
		if numStr := leadingInt(t); numStr != "" {
			if v, err := strconv.ParseUint(numStr, 10, 64); err == nil {
				return v
			}
		}
	}
	return 0
}

// leadingInt returns the leading decimal digits of a string, if any.
func leadingInt(s string) string {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	return s[:i]
}

// parseProt extracts the n-th argument and renders it as a perm string.
func parseProt(args string, n int) string {
	tokens := strings.Split(args, ",")
	if n <= 0 || n > len(tokens) {
		return "rw-p"
	}
	prot := strings.TrimSpace(tokens[n-1])
	perms := []byte("----")
	if strings.Contains(prot, "PROT_NONE") {
		return "----p"
	}
	if strings.Contains(prot, "READ") {
		perms[0] = 'r'
	}
	if strings.Contains(prot, "WRITE") {
		perms[1] = 'w'
	}
	if strings.Contains(prot, "EXEC") {
		perms[2] = 'x'
	}
	perms[3] = 'p'
	return string(perms)
}

// cloneRegions returns a deep copy of the region slice so snapshots are independent.
func cloneRegions(in []MmapRegion) []MmapRegion {
	if in == nil {
		return nil
	}
	out := make([]MmapRegion, len(in))
	copy(out, in)
	return out
}
