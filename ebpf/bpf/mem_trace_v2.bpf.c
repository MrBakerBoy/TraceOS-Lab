// SPDX-License-Identifier: GPL-2.0
// Copyright (c) 2026 TraceOS Lab. All rights reserved.
//
// mem_trace_v2.bpf.c — CO-RE memory allocation tracing with sandbox filtering.
//
// Adapted from v1: now uses shared sandbox_pids HASH_OF_MAPS for PID
// filtering instead of a single target_pid.  Per-sandbox aggregation
// stats allow concurrent sandboxes without data leakage.
//
// Tracks brk/mmap/munmap calls to detect:
//   - Memory leak patterns (mmap without matching munmap)
//   - Excessive sbrk growth (brk without release)
//   - Per-sandbox allocation size distribution
//
// Six tracepoints (all attached once globally):
//   syscalls/sys_enter_brk,    syscalls/sys_exit_brk
//   syscalls/sys_enter_mmap,   syscalls/sys_exit_mmap
//   syscalls/sys_enter_munmap, syscalls/sys_exit_munmap

#include "trace_common_v2.h"

char LICENSE[] SEC("license") = "GPL";

// ── Memory event types ─────────────────────────────────────────────

#define MEM_EVENT_BRK     1
#define MEM_EVENT_MMAP    2
#define MEM_EVENT_MUNMAP  3

struct mem_event {
    u32 pid;
    u32 tid;
    u32 type;        // MEM_EVENT_BRK / MMAP / MUNMAP
    u32 sandbox_id;
    u64 size;        // allocation / deallocation bytes
    u64 addr;        // returned address (0 if enter probe)
    u64 timestamp_ns;
} __attribute__((packed));

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} mem_events SEC(".maps");

// ── Per-CPU scratch: pass sandbox_id from enter → exit ─────────────

struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __uint(max_entries, 1);
    __type(key, u32);
    __type(value, u32);
} active_mem_sandbox SEC(".maps");

// ── Per-thread scratch: pending allocation size (enter→exit) ───────

// Keyed by TID only — host-side TIDs are globally unique under nsjail,
// so no cross-sandbox collision risk.  A composite key (sandbox_id, tid)
// would be correct but adds map lookup overhead for no benefit.
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, u32);   // tid
    __type(value, u64); // pending size (brk target or mmap/munmap len)
} pending_alloc SEC(".maps");

// ── Aggregate stats (per-sandbox) ──────────────────────────────────

struct mem_stats {
    u64 brk_count;
    u64 brk_total_bytes;
    u64 mmap_count;
    u64 mmap_total_bytes;
    u64 munmap_count;
    u64 munmap_total_bytes;
    u64 alloc_failures;
};

// Indexed by sandbox_id (0-63), one entry per slot.
// Go loader reads these on sandbox teardown to summarize per-sandbox
// memory behavior, then zeroes the slot for reuse.
struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 64);
    __type(key, u32);
    __type(value, struct mem_stats);
} mem_aggregate SEC(".maps");

// ── Per-thread last program-break for brk growth tracking ──────────

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, u32);   // tid
    __type(value, u64); // last program break address
} last_brk SEC(".maps");

// ── Helpers ────────────────────────────────────────────────────────

static __always_inline u32 resolve_sandbox(void)
{
    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 start_time = get_current_start_time();

    u8 found = 0;
    u32 sandbox_id = find_sandbox_for_pid(tid, start_time, &found);
    return found ? sandbox_id : 0;
}

static __always_inline u32 resolve_and_scratch(void)
{
    u32 sid = resolve_sandbox();
    if (sid == 0) {
        // Not tracked.  Clear the scratch slot so exit handler
        // doesn't read a stale value from a previous call.
        u32 zero = 0;
        u32 *slot = bpf_map_lookup_elem(&active_mem_sandbox, &zero);
        if (slot)
            *slot = 0;
        return 0;
    }
    u32 zero = 0;
    u32 *slot = bpf_map_lookup_elem(&active_mem_sandbox, &zero);
    if (slot)
        *slot = sid;
    return sid;
}

static __always_inline u32 read_scratch_sandbox(void)
{
    u32 zero = 0;
    u32 *slot = bpf_map_lookup_elem(&active_mem_sandbox, &zero);
    if (!slot || *slot == 0)
        return 0;
    u32 sid = *slot;
    *slot = 0;
    return sid;
}

static __always_inline void emit_mem_event(u32 type, u32 sandbox_id,
                                           u64 size, u64 addr)
{
    struct mem_event *evt;
    evt = bpf_ringbuf_reserve(&mem_events, sizeof(*evt), 0);
    if (!evt)
        return;

    u64 pid_tgid = bpf_get_current_pid_tgid();
    evt->pid = (u32)(pid_tgid >> 32);
    evt->tid = (u32)pid_tgid;
    evt->type = type;
    evt->sandbox_id = sandbox_id;
    evt->size = size;
    evt->addr = addr;
    evt->timestamp_ns = bpf_ktime_get_ns();

    bpf_ringbuf_submit(evt, 0);
}

// ── brk ────────────────────────────────────────────────────────────

SEC("tracepoint/syscalls/sys_enter_brk")
int trace_enter_brk(struct trace_event_raw_sys_enter *ctx)
{
    u32 sandbox_id = resolve_and_scratch();
    if (sandbox_id == 0)
        return 0;

    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 brk_addr = ctx->args[0];
    bpf_map_update_elem(&pending_alloc, &tid, &brk_addr, BPF_ANY);

    return 0;
}

SEC("tracepoint/syscalls/sys_exit_brk")
int trace_exit_brk(struct trace_event_raw_sys_exit *ctx)
{
    u32 sandbox_id = read_scratch_sandbox();
    if (sandbox_id == 0)
        return 0;

    u32 tid = (u32)bpf_get_current_pid_tgid();
    bpf_map_delete_elem(&pending_alloc, &tid);

    struct mem_stats *stats = bpf_map_lookup_elem(&mem_aggregate, &sandbox_id);
    if (!stats)
        return 0;

    __sync_fetch_and_add(&stats->brk_count, 1);

    s64 ret = ctx->ret;
    if (ret >= 0) {
        u64 *prev = bpf_map_lookup_elem(&last_brk, &tid);
        u64 prev_brk = prev ? *prev : 0;
        if (prev_brk > 0 && (u64)ret > prev_brk) {
            u64 growth = (u64)ret - prev_brk;
            __sync_fetch_and_add(&stats->brk_total_bytes, growth);
            emit_mem_event(MEM_EVENT_BRK, sandbox_id, growth, (u64)ret);
        }
        bpf_map_update_elem(&last_brk, &tid, &ret, BPF_ANY);
    } else {
        __sync_fetch_and_add(&stats->alloc_failures, 1);
    }

    return 0;
}

// ── mmap ───────────────────────────────────────────────────────────

SEC("tracepoint/syscalls/sys_enter_mmap")
int trace_enter_mmap(struct trace_event_raw_sys_enter *ctx)
{
    u32 sandbox_id = resolve_and_scratch();
    if (sandbox_id == 0)
        return 0;

    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 len = ctx->args[1];  // mmap length
    bpf_map_update_elem(&pending_alloc, &tid, &len, BPF_ANY);

    return 0;
}

SEC("tracepoint/syscalls/sys_exit_mmap")
int trace_exit_mmap(struct trace_event_raw_sys_exit *ctx)
{
    u32 sandbox_id = read_scratch_sandbox();
    if (sandbox_id == 0)
        return 0;

    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 *prev = bpf_map_lookup_elem(&pending_alloc, &tid);
    u64 len = prev ? *prev : 0;
    bpf_map_delete_elem(&pending_alloc, &tid);

    struct mem_stats *stats = bpf_map_lookup_elem(&mem_aggregate, &sandbox_id);
    if (!stats)
        return 0;

    __sync_fetch_and_add(&stats->mmap_count, 1);
    if (ctx->ret >= 0) {
        __sync_fetch_and_add(&stats->mmap_total_bytes, len);
        emit_mem_event(MEM_EVENT_MMAP, sandbox_id, len, (u64)ctx->ret);
    } else {
        __sync_fetch_and_add(&stats->alloc_failures, 1);
    }

    return 0;
}

// ── munmap ─────────────────────────────────────────────────────────

SEC("tracepoint/syscalls/sys_enter_munmap")
int trace_enter_munmap(struct trace_event_raw_sys_enter *ctx)
{
    u32 sandbox_id = resolve_and_scratch();
    if (sandbox_id == 0)
        return 0;

    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 len = ctx->args[1];  // munmap length
    bpf_map_update_elem(&pending_alloc, &tid, &len, BPF_ANY);

    return 0;
}

SEC("tracepoint/syscalls/sys_exit_munmap")
int trace_exit_munmap(struct trace_event_raw_sys_exit *ctx)
{
    u32 sandbox_id = read_scratch_sandbox();
    if (sandbox_id == 0)
        return 0;

    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 *prev = bpf_map_lookup_elem(&pending_alloc, &tid);
    u64 len = prev ? *prev : 0;
    bpf_map_delete_elem(&pending_alloc, &tid);

    struct mem_stats *stats = bpf_map_lookup_elem(&mem_aggregate, &sandbox_id);
    if (!stats)
        return 0;

    if (ctx->ret == 0) {
        __sync_fetch_and_add(&stats->munmap_count, 1);
        __sync_fetch_and_add(&stats->munmap_total_bytes, len);
        emit_mem_event(MEM_EVENT_MUNMAP, sandbox_id, len, 0);
    }

    return 0;
}