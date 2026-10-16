package model

import "time"

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
	Category string `json:"category"` // text, data, bss, heap, stack, anon, mmap, ...
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
