// SPDX-License-Identifier: GPL-2.0
// Copyright (c) 2026 TraceOS Lab. All rights reserved.
//
// syscall_trace.bpf.c — CO-RE syscall tracing via raw tracepoints
//
// Traces all syscalls for a target PID with zero-overhead eBPF.
// Exports:
//   - Per-call ring buffer events (syscall nr, args, ret, duration)
//   - Per-syscall counts and latency histograms via hash map
//
// Compile: clang -O2 -g -target bpf -D__TARGET_ARCH_x86 \
//           -I/usr/include/x86_64-linux-gnu \
//           -c syscall_trace.bpf.c -o syscall_trace.bpf.o

#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

char LICENSE[] SEC("license") = "GPL";

// ── Configuration ──────────────────────────────────────────────────

// target_pid=0 means trace all processes
volatile const u32 target_pid = 0;

// ── Per-CPU scratch maps for enter→exit state tracking ─────────────

struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __uint(max_entries, 1);
    __type(key, u32);
    __type(value, u64);
} start_ns SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __uint(max_entries, 1);
    __type(key, u32);
    __type(value, u32);
} active_syscall SEC(".maps");

// Per-CPU scratch for syscall args (args[0-5] from sys_enter)
struct syscall_args {
    u64 args[6];
};

struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __uint(max_entries, 1);
    __type(key, u32);
    __type(value, struct syscall_args);
} pending_args SEC(".maps");

// ── Aggregation map (count + latency) ──────────────────────────────

struct syscall_key {
    u32 nr;
};

struct syscall_val {
    u64 count;
    u64 total_latency_ns;
    u64 max_latency_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 512);
    __type(key, struct syscall_key);
    __type(value, struct syscall_val);
} syscall_stats SEC(".maps");

// ── Ring buffer for per-call events ────────────────────────────────

struct syscall_event {
    u32 pid;
    u32 tid;
    u32 syscall_nr;
    u64 args[6];       // syscall arguments (for teaching diagnostics)
    s64 ret;           // return value
    u64 duration_ns;
    u64 timestamp_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024); // 256 KB
} syscall_events SEC(".maps");

// ── Syscall enter: record start time + capture args ────────────────

SEC("tracepoint/raw_syscalls/sys_enter")
int trace_syscall_enter(struct trace_event_raw_sys_enter *ctx)
{
    u32 pid = (u32)(bpf_get_current_pid_tgid() >> 32);

    if (target_pid != 0 && pid != target_pid)
        return 0;

    u32 zero = 0;
    u64 *start = bpf_map_lookup_elem(&start_ns, &zero);
    if (!start)
        return 0;
    *start = bpf_ktime_get_ns();

    u32 *nr = bpf_map_lookup_elem(&active_syscall, &zero);
    if (!nr)
        return 0;
    *nr = ctx->id;

    // Capture syscall arguments
    struct syscall_args *args = bpf_map_lookup_elem(&pending_args, &zero);
    if (args) {
        args->args[0] = ctx->args[0];
        args->args[1] = ctx->args[1];
        args->args[2] = ctx->args[2];
        args->args[3] = ctx->args[3];
        args->args[4] = ctx->args[4];
        args->args[5] = ctx->args[5];
    }

    return 0;
}

// ── Syscall exit: compute latency, emit event, update stats ────────

SEC("tracepoint/raw_syscalls/sys_exit")
int trace_syscall_exit(struct trace_event_raw_sys_exit *ctx)
{
    u32 pid = (u32)(bpf_get_current_pid_tgid() >> 32);

    if (target_pid != 0 && pid != target_pid)
        return 0;

    u32 zero = 0;
    u64 *start = bpf_map_lookup_elem(&start_ns, &zero);
    u32 *nr    = bpf_map_lookup_elem(&active_syscall, &zero);
    if (!start || !nr || *start == 0)
        return 0;

    u64 latency = bpf_ktime_get_ns() - *start;
    u64 ts = *start;
    *start = 0;

    // ── Emit per-call ring buffer event ─────────────────────────
    struct syscall_event *evt;
    evt = bpf_ringbuf_reserve(&syscall_events, sizeof(*evt), 0);
    if (evt) {
        evt->pid = pid;
        evt->tid = (u32)bpf_get_current_pid_tgid();
        evt->syscall_nr = *nr;
        evt->ret = ctx->ret;
        evt->duration_ns = latency;
        evt->timestamp_ns = ts;

        // Copy captured arguments
        struct syscall_args *args = bpf_map_lookup_elem(&pending_args, &zero);
        if (args) {
            evt->args[0] = args->args[0];
            evt->args[1] = args->args[1];
            evt->args[2] = args->args[2];
            evt->args[3] = args->args[3];
            evt->args[4] = args->args[4];
            evt->args[5] = args->args[5];
        }

        bpf_ringbuf_submit(evt, 0);
    }

    // ── Update aggregation stats ────────────────────────────────
    struct syscall_key key = { .nr = *nr };
    struct syscall_val *val = bpf_map_lookup_elem(&syscall_stats, &key);
    if (val) {
        __sync_fetch_and_add(&val->count, 1);
        __sync_fetch_and_add(&val->total_latency_ns, latency);
        if (latency > val->max_latency_ns)
            val->max_latency_ns = latency;
    } else {
        struct syscall_val new_val = {
            .count = 1,
            .total_latency_ns = latency,
            .max_latency_ns = latency,
        };
        bpf_map_update_elem(&syscall_stats, &key, &new_val, BPF_ANY);
    }

    return 0;
}
