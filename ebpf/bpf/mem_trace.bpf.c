// SPDX-License-Identifier: GPL-2.0
// Copyright (c) 2026 TraceOS Lab. All rights reserved.
//
// mem_trace.bpf.c — CO-RE memory allocation tracing
//
// Tracks brk/mmap/munmap calls per target PID to detect:
//   - Memory leak patterns (mmap without matching munmap)
//   - Excessive sbrk growth (brk without release)
//   - Allocation size distribution
//
// Compile: clang -O2 -g -target bpf -D__TARGET_ARCH_x86 \
//           -I/usr/include/x86_64-linux-gnu \
//           -c mem_trace.bpf.c -o mem_trace.bpf.o

#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

char LICENSE[] SEC("license") = "GPL";

volatile const u32 target_pid = 0;

// ── Memory event types ─────────────────────────────────────────────

#define MEM_EVENT_BRK     1
#define MEM_EVENT_MMAP    2
#define MEM_EVENT_MUNMAP  3

struct mem_event {
    u32 pid;
    u32 tid;
    u32 type;       // MEM_EVENT_*
    u64 size;       // allocation size in bytes
    u64 addr;       // returned address (0 if enter probe)
    u64 timestamp_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} mem_events SEC(".maps");

// ── Per-thread scratch for tracking args across enter→exit ────────

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, u32);   // tid
    __type(value, u64); // pending size (brk/mmap arg)
} pending_alloc SEC(".maps");

// ── Aggregate stats ────────────────────────────────────────────────

struct mem_stats {
    u64 brk_count;
    u64 brk_total_bytes;
    u64 mmap_count;
    u64 mmap_total_bytes;
    u64 munmap_count;
    u64 munmap_total_bytes;
    u64 alloc_failures;
};

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key, u32);
    __type(value, struct mem_stats);
} mem_aggregate SEC(".maps");

static __always_inline void emit_mem_event(u32 type, u64 size, u64 addr)
{
    struct mem_event *evt;
    evt = bpf_ringbuf_reserve(&mem_events, sizeof(*evt), 0);
    if (!evt)
        return;

    evt->pid = (u32)(bpf_get_current_pid_tgid() >> 32);
    evt->tid = (u32)bpf_get_current_pid_tgid();
    evt->type = type;
    evt->size = size;
    evt->addr = addr;
    evt->timestamp_ns = bpf_ktime_get_ns();

    bpf_ringbuf_submit(evt, 0);
}

// ── Per-thread last program-break for brk growth tracking ──────────

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, u32);   // tid
    __type(value, u64); // last program break
} last_brk SEC(".maps");

// ── brk ────────────────────────────────────────────────────────────

SEC("tracepoint/syscalls/sys_enter_brk")
int trace_enter_brk(struct trace_event_raw_sys_enter *ctx)
{
    u32 pid = (u32)(bpf_get_current_pid_tgid() >> 32);
    if (target_pid != 0 && pid != target_pid)
        return 0;

    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 brk_addr = ctx->args[0];
    bpf_map_update_elem(&pending_alloc, &tid, &brk_addr, BPF_ANY);

    // Don't emit event here — growth is unknown until exit.
    return 0;
}

SEC("tracepoint/syscalls/sys_exit_brk")
int trace_exit_brk(struct trace_event_raw_sys_exit *ctx)
{
    u32 pid = (u32)(bpf_get_current_pid_tgid() >> 32);
    if (target_pid != 0 && pid != target_pid)
        return 0;

    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 *prev_val = bpf_map_lookup_elem(&pending_alloc, &tid);
    u64 requested = prev_val ? *prev_val : 0;
    bpf_map_delete_elem(&pending_alloc, &tid);

    u32 zero = 0;
    struct mem_stats *stats = bpf_map_lookup_elem(&mem_aggregate, &zero);
    if (!stats)
        return 0;

    __sync_fetch_and_add(&stats->brk_count, 1);

    s64 ret = ctx->ret;
    if (ret >= 0) {
        // Compute actual growth: new program break − previous program break
        u64 *prev = bpf_map_lookup_elem(&last_brk, &tid);
        u64 prev_brk = prev ? *prev : 0;
        if (prev_brk > 0 && (u64)ret > prev_brk) {
            u64 growth = (u64)ret - prev_brk;
            __sync_fetch_and_add(&stats->brk_total_bytes, growth);
            emit_mem_event(MEM_EVENT_BRK, growth, (u64)ret);
        }
        // Update stored baseline for next brk call
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
    u32 pid = (u32)(bpf_get_current_pid_tgid() >> 32);
    if (target_pid != 0 && pid != target_pid)
        return 0;

    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 len = ctx->args[1]; // mmap length
    bpf_map_update_elem(&pending_alloc, &tid, &len, BPF_ANY);

    return 0;
}

SEC("tracepoint/syscalls/sys_exit_mmap")
int trace_exit_mmap(struct trace_event_raw_sys_exit *ctx)
{
    u32 pid = (u32)(bpf_get_current_pid_tgid() >> 32);
    if (target_pid != 0 && pid != target_pid)
        return 0;

    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 *prev = bpf_map_lookup_elem(&pending_alloc, &tid);
    u64 len = prev ? *prev : 0;
    bpf_map_delete_elem(&pending_alloc, &tid);

    u32 zero = 0;
    struct mem_stats *stats = bpf_map_lookup_elem(&mem_aggregate, &zero);
    if (!stats)
        return 0;

    __sync_fetch_and_add(&stats->mmap_count, 1);
    if (ctx->ret >= 0) {
        __sync_fetch_and_add(&stats->mmap_total_bytes, len);
        emit_mem_event(MEM_EVENT_MMAP, len, (u64)ctx->ret);
    } else {
        __sync_fetch_and_add(&stats->alloc_failures, 1);
    }

    return 0;
}

// ── munmap ─────────────────────────────────────────────────────────

SEC("tracepoint/syscalls/sys_enter_munmap")
int trace_enter_munmap(struct trace_event_raw_sys_enter *ctx)
{
    u32 pid = (u32)(bpf_get_current_pid_tgid() >> 32);
    if (target_pid != 0 && pid != target_pid)
        return 0;

    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 len = ctx->args[1]; // munmap length
    bpf_map_update_elem(&pending_alloc, &tid, &len, BPF_ANY);

    return 0;
}

SEC("tracepoint/syscalls/sys_exit_munmap")
int trace_exit_munmap(struct trace_event_raw_sys_exit *ctx)
{
    u32 pid = (u32)(bpf_get_current_pid_tgid() >> 32);
    if (target_pid != 0 && pid != target_pid)
        return 0;

    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 *prev = bpf_map_lookup_elem(&pending_alloc, &tid);
    u64 len = prev ? *prev : 0;
    bpf_map_delete_elem(&pending_alloc, &tid);

    u32 zero = 0;
    struct mem_stats *stats = bpf_map_lookup_elem(&mem_aggregate, &zero);
    if (!stats)
        return 0;

    if (ctx->ret == 0) {
        __sync_fetch_and_add(&stats->munmap_count, 1);
        __sync_fetch_and_add(&stats->munmap_total_bytes, len);
        emit_mem_event(MEM_EVENT_MUNMAP, len, 0);
    }

    return 0;
}
