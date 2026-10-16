// SPDX-License-Identifier: GPL-2.0
// Copyright (c) 2026 TraceOS Lab. All rights reserved.
//
// syscall_trace_v2_nocore.bpf.c — Non-CO-RE global singleton syscall tracer.
//
// This is the kernel-version-bound fallback for environments without BTF.
// It uses minimal type definitions from trace_common_v2_nocore.h and
// reads start_time from the userspace-populated pid_start_times map
// instead of task_struct.start_boottime via BPF_CORE_READ.
//
// Architecture is identical to syscall_trace_v2.bpf.c:
//   5 tracepoints attached once globally.
//   HASH_OF_MAPS (sandbox_pids) isolates PID sets per sandbox.
//   Each syscall handler iterates active sandboxes to find the owning
//   sandbox and emit events with sandbox_id tag.
//
// Tracepoints (using minimal context structs):
//   raw_syscalls/sys_enter,  raw_syscalls/sys_exit
//   sched/sched_process_fork,  sched/sched_process_exec,
//   sched/sched_process_exit
//
// Go loader requirement: MUST populate pid_start_times map with
// (tid → start_time) entries from /proc/<pid>/stat before any
// sandbox PID is added to sandbox_pids.

#include "trace_common_v2_nocore.h"

char LICENSE[] SEC("license") = "GPL";

// ── Per-CPU scratch for enter→exit state tracking ──────────────────

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

struct syscall_args {
    u64 args[6];
};

struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __uint(max_entries, 1);
    __type(key, u32);
    __type(value, struct syscall_args);
} pending_args SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __uint(max_entries, 1);
    __type(key, u32);
    __type(value, u32);
} active_sandbox SEC(".maps");

// ── Per-syscall aggregation stats ──────────────────────────────────

struct syscall_key {
    u32 nr;
    u32 sandbox_id;
};

struct syscall_val {
    u64 count;
    u64 total_latency_ns;
    u64 max_latency_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 2048);
    __type(key, struct syscall_key);
    __type(value, struct syscall_val);
} syscall_stats SEC(".maps");

// ── Ring buffer for per-call syscall events ────────────────────────

struct syscall_event {
    u32 pid;
    u32 tid;
    u32 syscall_nr;
    u32 sandbox_id;
    u64 args[6];
    s64 ret;
    u64 duration_ns;
    u64 timestamp_ns;
    u8  is_thread;
    u8  pad[7];
} __attribute__((packed));

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} syscall_events SEC(".maps");

// ── Syscall enter ──────────────────────────────────────────────────

SEC("tracepoint/raw_syscalls/sys_enter")
int trace_syscall_enter(struct sys_enter_ctx *ctx)
{
    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 start_time = get_current_start_time();

    u8 found = 0;
    u32 sandbox_id = find_sandbox_for_pid(tid, start_time, &found);
    if (!found)
        return 0;

    u32 zero = 0;

    u64 *start = bpf_map_lookup_elem(&start_ns, &zero);
    if (!start)
        return 0;
    *start = bpf_ktime_get_ns();

    u32 *nr = bpf_map_lookup_elem(&active_syscall, &zero);
    if (!nr)
        return 0;
    *nr = (u32)ctx->id;

    u32 *sid = bpf_map_lookup_elem(&active_sandbox, &zero);
    if (!sid)
        return 0;
    *sid = sandbox_id;

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

// ── Syscall exit ───────────────────────────────────────────────────

SEC("tracepoint/raw_syscalls/sys_exit")
int trace_syscall_exit(struct sys_exit_ctx *ctx)
{

    u32 zero = 0;
    u64 *start = bpf_map_lookup_elem(&start_ns, &zero);
    u32 *nr    = bpf_map_lookup_elem(&active_syscall, &zero);
    u32 *sid   = bpf_map_lookup_elem(&active_sandbox, &zero);
    if (!start || !nr || !sid || *start == 0)
        return 0;

    u64 latency = bpf_ktime_get_ns() - *start;
    u64 ts = *start;
    u32 sandbox_id = *sid;
    *start = 0;

    struct syscall_event *evt;
    evt = bpf_ringbuf_reserve(&syscall_events, sizeof(*evt), 0);
    if (evt) {
        u64 pid_tgid = bpf_get_current_pid_tgid();
        evt->pid = (u32)(pid_tgid >> 32);
        evt->tid = (u32)pid_tgid;
        evt->syscall_nr = *nr;
        evt->sandbox_id = sandbox_id;
        evt->ret = ctx->ret;
        evt->duration_ns = latency;
        evt->timestamp_ns = ts;
        evt->is_thread = (evt->pid != evt->tid) ? 1 : 0;

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

    struct syscall_key key = { .nr = *nr, .sandbox_id = sandbox_id };
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

// ── sched:sched_process_fork ────────────────────────────────────────

SEC("tracepoint/sched/sched_process_fork")
int trace_sched_fork(struct sched_fork_ctx *ctx)
{
    // Direct field access — kernel-version-bound (~5.15 layout).
    // Verified offset matches Ubuntu 22.04 5.15 generic kernel.
    u32 child_tid = (u32)ctx->child_pid;
    if (child_tid == 0)
        return 0;

    u32 parent_tid = (u32)bpf_get_current_pid_tgid();
    u64 parent_start = get_current_start_time();

    u8 found = 0;
    u32 sandbox_id = find_sandbox_for_pid(parent_tid, parent_start, &found);
    if (!found)
        return 0;

    add_pid_to_sandbox(sandbox_id, child_tid, parent_start);
    emit_lifecycle(LIFECYCLE_CLONE, child_tid, parent_tid,
                   sandbox_id, 1);

    return 0;
}

// ── sched:sched_process_exec ───────────────────────────────────────

SEC("tracepoint/sched/sched_process_exec")
int trace_sched_exec(struct sched_exec_ctx *ctx)
{
    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 start_time = get_current_start_time();

    u8 found = 0;
    u32 sandbox_id = find_sandbox_for_pid(tid, start_time, &found);
    if (!found)
        return 0;

    emit_lifecycle(LIFECYCLE_EXEC, tid, 0, sandbox_id, 0);

    return 0;
}

// ── sched:sched_process_exit ───────────────────────────────────────

SEC("tracepoint/sched/sched_process_exit")
int trace_sched_exit(struct sched_exit_ctx *ctx)
{
    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 start_time = get_current_start_time();

    u8 found = 0;
    u32 sandbox_id = find_sandbox_for_pid(tid, start_time, &found);
    if (!found)
        return 0;

    remove_pid_from_all(tid, start_time);
    emit_lifecycle(LIFECYCLE_EXIT, tid, 0, sandbox_id, 0);

    return 0;
}