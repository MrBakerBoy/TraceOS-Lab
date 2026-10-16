package evaluator

import (
	"testing"
)

// sampleMaps mimics a realistic /proc/<pid>/maps dump.
const sampleMaps = `5595a1234000-5595a1235000 r--p 00000000 08:01 12345    /usr/bin/cat
5595a1235000-5595a1237000 r-xp 00001000 08:01 12345    /usr/bin/cat
5595a1237000-5595a1238000 r--p 00003000 08:01 12345    /usr/bin/cat
5595a1238000-5595a1239000 rw-p 00004000 08:01 12345    /usr/bin/cat
5595a1239000-5595a123b000 rw-p 00000000 00:00 0         [heap]
5595a123b000-5595a123c000 rw-p 00000000 00:00 0
7ffc12340000-7ffc12360000 rw-p 00000000 00:00 0         [stack]
7ffc12360000-7ffc12361000 r--p 00000000 00:00 0         [vvar]
7ffc12361000-7ffc12362000 r-xp 00000000 00:00 0         [vdso]
`

func TestParseProcMapsContent_StandardSegments(t *testing.T) {
	snap := ParseProcMapsContent(sampleMaps)
	if snap == nil {
		t.Fatal("expected non-nil snapshot")
	}

	// text = first r-xp region
	if snap.TextStart != 0x5595a1235000 {
		t.Errorf("TextStart = %#x, want 0x5595a1235000", snap.TextStart)
	}
	if snap.TextSize != 0x2000 {
		t.Errorf("TextSize = %#x, want 0x2000", snap.TextSize)
	}

	// data = first rw-p with a file path
	if snap.DataStart != 0x5595a1238000 {
		t.Errorf("DataStart = %#x, want 0x5595a1238000", snap.DataStart)
	}
	if snap.DataSize != 0x1000 {
		t.Errorf("DataSize = %#x, want 0x1000", snap.DataSize)
	}

	// bss = first rw-p with no path
	if snap.BSSStart != 0x5595a123b000 {
		t.Errorf("BSSStart = %#x, want 0x5595a123b000", snap.BSSStart)
	}
	if snap.BSSSize != 0x1000 {
		t.Errorf("BSSSize = %#x, want 0x1000", snap.BSSSize)
	}

	// heap
	if snap.HeapStart != 0x5595a1239000 {
		t.Errorf("HeapStart = %#x, want 0x5595a1239000", snap.HeapStart)
	}
	if snap.HeapSize != 0x2000 {
		t.Errorf("HeapSize = %#x, want 0x2000", snap.HeapSize)
	}

	// stack
	if snap.StackStart != 0x7ffc12340000 {
		t.Errorf("StackStart = %#x, want 0x7ffc12340000", snap.StackStart)
	}
	if snap.StackSize != 0x20000 {
		t.Errorf("StackSize = %#x, want 0x20000", snap.StackSize)
	}

	// all regions captured
	if len(snap.MmapRegions) != 9 {
		t.Errorf("MmapRegions len = %d, want 9", len(snap.MmapRegions))
	}
}

func TestParseProcMapsContent_Empty(t *testing.T) {
	snap := ParseProcMapsContent("")
	if snap == nil {
		t.Fatal("expected non-nil snapshot for empty input")
	}
	if len(snap.MmapRegions) != 0 {
		t.Errorf("MmapRegions len = %d, want 0 for empty maps", len(snap.MmapRegions))
	}
	if snap.TextSize != 0 || snap.HeapSize != 0 || snap.StackSize != 0 {
		t.Errorf("empty maps should yield zero segments, got text=%#x heap=%#x stack=%#x",
			snap.TextSize, snap.HeapSize, snap.StackSize)
	}
}

func TestParseProcMapsContent_MalformedLines(t *testing.T) {
	// Malformed lines are skipped; valid ones still parsed.
	content := "this is not a maps line\n\n5595a1235000-5595a1237000 r-xp 00001000 08:01 12345    /usr/bin/cat\n"
	snap := ParseProcMapsContent(content)
	if snap.TextStart != 0x5595a1235000 {
		t.Errorf("TextStart = %#x, want 0x5595a1235000", snap.TextStart)
	}
	if len(snap.MmapRegions) != 1 {
		t.Errorf("MmapRegions len = %d, want 1 (malformed skipped)", len(snap.MmapRegions))
	}
}

func TestCollectMemorySnapshots_Brk(t *testing.T) {
	initial := &MemoryLayoutSnapshot{
		HeapStart: 0x5595a1239000,
		HeapSize:  0x2000, // heap ends at 0x5595a123b000
	}
	strace := "1234 10:00:00.100000 brk(0x5595a123d000) = 0x5595a123d000 <0.000010>\n"

	snaps := CollectMemorySnapshots(initial, strace)
	if len(snaps) != 1 {
		t.Fatalf("snapshots = %d, want 1", len(snaps))
	}
	// heap grew to 0x5595a123d000 - 0x5595a1239000 = 0x4000
	if snaps[0].HeapStart != 0x5595a1239000 {
		t.Errorf("HeapStart = %#x, want 0x5595a1239000", snaps[0].HeapStart)
	}
	if snaps[0].HeapSize != 0x4000 {
		t.Errorf("HeapSize = %#x, want 0x4000", snaps[0].HeapSize)
	}
}

func TestCollectMemorySnapshots_BrkUnchangedNoSnapshot(t *testing.T) {
	initial := &MemoryLayoutSnapshot{
		HeapStart: 0x1000,
		HeapSize:  0x1000, // heap ends at 0x2000
	}
	// brk query returns current break unchanged -> no snapshot emitted
	strace := "1234 10:00:00.100000 brk(0) = 0x2000 <0.000010>\n"
	snaps := CollectMemorySnapshots(initial, strace)
	if len(snaps) != 0 {
		t.Errorf("snapshots = %d, want 0 for unchanged brk", len(snaps))
	}
}

func TestCollectMemorySnapshots_MmapMunmap(t *testing.T) {
	initial := &MemoryLayoutSnapshot{
		HeapStart:  0x1000,
		HeapSize:   0x1000,
		MmapRegions: []MmapRegion{{Start: 0xa000, End: 0xb000, Size: 0x1000, Category: "mmap"}},
	}
	strace := "1234 10:00:00.100000 mmap(NULL, 4096, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0) = 0x7f0000000000 <0.000010>\n" +
		"1234 10:00:00.200000 munmap(0x7f0000000000, 4096) = 0 <0.000020>\n"

	snaps := CollectMemorySnapshots(initial, strace)
	if len(snaps) != 2 {
		t.Fatalf("snapshots = %d, want 2", len(snaps))
	}

	// after mmap: 1 initial region + 1 new = 2
	if len(snaps[0].MmapRegions) != 2 {
		t.Errorf("after mmap regions = %d, want 2", len(snaps[0].MmapRegions))
	}
	if snaps[0].MmapRegions[1].Start != 0x7f0000000000 {
		t.Errorf("mmap region start = %#x, want 0x7f0000000000", snaps[0].MmapRegions[1].Start)
	}
	if snaps[0].MmapRegions[1].Size != 4096 {
		t.Errorf("mmap region size = %d, want 4096", snaps[0].MmapRegions[1].Size)
	}

	// after munmap: the mapped region removed -> back to 1
	if len(snaps[1].MmapRegions) != 1 {
		t.Errorf("after munmap regions = %d, want 1", len(snaps[1].MmapRegions))
	}
}

func TestCollectMemorySnapshots_Mprotect(t *testing.T) {
	initial := &MemoryLayoutSnapshot{
		MmapRegions: []MmapRegion{
			{Start: 0x7f0000000000, End: 0x7f0000001000, Size: 0x1000, Perms: "rw-p", Category: "mmap"},
		},
	}
	strace := "1234 10:00:00.100000 mprotect(0x7f0000000000, 4096, PROT_READ) = 0 <0.000010>\n"

	snaps := CollectMemorySnapshots(initial, strace)
	if len(snaps) != 1 {
		t.Fatalf("snapshots = %d, want 1", len(snaps))
	}
	if snaps[0].MmapRegions[0].Perms != "r--p" {
		t.Errorf("after mprotect perms = %q, want r--p", snaps[0].MmapRegions[0].Perms)
	}
}

func TestCollectMemorySnapshots_NilInitial(t *testing.T) {
	strace := "1234 10:00:00.100000 brk(0x5000) = 0x5000 <0.000010>\n"
	snaps := CollectMemorySnapshots(nil, strace)
	if len(snaps) != 1 {
		t.Fatalf("snapshots = %d, want 1 with nil initial", len(snaps))
	}
	if snaps[0].HeapSize != 0 {
		// heap base established at 0x5000, end at 0x5000 -> size 0
		t.Errorf("HeapSize = %#x, want 0", snaps[0].HeapSize)
	}
}

func TestCollectMemorySnapshots_IgnoresNonMemorySyscalls(t *testing.T) {
	initial := &MemoryLayoutSnapshot{HeapStart: 0x1000, HeapSize: 0x1000}
	strace := "1234 10:00:00.100000 write(1, \"hi\", 2) = 2 <0.000010>\n" +
		"1234 10:00:00.200000 read(0, 0x7f, 8) = 3 <0.000020>\n"
	snaps := CollectMemorySnapshots(initial, strace)
	if len(snaps) != 0 {
		t.Errorf("snapshots = %d, want 0 for non-memory syscalls", len(snaps))
	}
}
