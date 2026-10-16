// SPDX-License-Identifier: GPL-2.0
// Copyright (c) 2026 TraceOS Lab. All rights reserved.
//
// syscall_trace_v2.bpf.c — CO-RE global singleton syscall tracer.
//
// Architecture:
//   5 tracepoints attached ONCE globally (no per-task re-attach).
//   HASH_OF_MAPS (sandbox_pids) isolates PID sets per sandbox.
//   Each syscall handler iterates active sandboxes (max 5 concurrent)
//   to find the owning sandbox and emit events with sandbox_id tag.
//
// Tracepoints:
//   raw_syscalls/sys_enter       — capture syscall args + start timestamp
//   raw_syscalls/sys_exit        — compute latency, emit ringbuf event
//   sched/sched_process_fork     — track child process/thread creation
//   sched/sched_process_exec     — track execve (comm change)
//   sched/sched_process_exit     — clean up exited PIDs
//
// Compile: clang -O2 -g -target bpf -D__TARGET_ARCH_x86 \
//           -I. -I/usr/include/x86_64-linux-gnu \
//           -c syscall_trace_v2.bpf.c -o syscall_trace_v2.bpf.o

#include "trace_common_v2.h"

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

// ── Per-CPU scratch for sandbox_id (set by enter, read by exit) ────

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
    __uint(max_entries, 2048);  // ~32 syscalls × 64 sandboxes
    __type(key, struct syscall_key);
    __type(value, struct syscall_val);
} syscall_stats SEC(".maps");

// ── Ring buffer for per-call syscall events ────────────────────────

struct syscall_event {
    u32 pid;            // TGID
    u32 tid;
    u32 syscall_nr;
    u32 sandbox_id;
    u64 args[6];
    s64 ret;
    u64 duration_ns;
    u64 timestamp_ns;
    u8  is_thread;
    u8  pad[7];         // align to 8 bytes
} __attribute__((packed));

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);  // 256 KB shared ring buffer
} syscall_events SEC(".maps");

// ── Error name lookup (x86_64 errno) ───────────────────────────────

// Extracts errno name from negative return value and stores as device
// major + minor format so userspace can map it.  The maximum errno
// we care about is ~133 (EOWNERDEAD).  Values beyond that are kernel
// internal errors and are not interesting for teaching diagnostics.

// ── Syscall enter: resolve sandbox, record start + args ────────────

SEC("tracepoint/raw_syscalls/sys_enter")
int trace_syscall_enter(struct trace_event_raw_sys_enter *ctx)
{
    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 start_time = get_current_start_time();

    u8 found = 0;
    u32 sandbox_id = find_sandbox_for_pid(tid, start_time, &found);
    if (!found)
        return 0;  // not tracked by any sandbox

    u32 zero = 0;

    // Record start timestamp
    u64 *start = bpf_map_lookup_elem(&start_ns, &zero);
    if (!start)
        return 0;
    *start = bpf_ktime_get_ns();

    // Record syscall number
    u32 *nr = bpf_map_lookup_elem(&active_syscall, &zero);
    if (!nr)
        return 0;
    *nr = ctx->id;

    // Record sandbox_id
    u32 *sid = bpf_map_lookup_elem(&active_sandbox, &zero);
    if (!sid)
        return 0;
    *sid = sandbox_id;

    // Capture syscall arguments (raw_syscalls exposes args[] directly)
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

    // ── Emit per-call ring buffer event ─────────────────────────────
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

    // ── Update aggregation stats ────────────────────────────────────
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

// ── sched:sched_process_fork — track all process/thread creation ───

SEC("tracepoint/sched/sched_process_fork")
int trace_sched_fork(struct trace_event_raw_sched_process_fork *ctx)
{
    // CO-RE safe read of child_pid (handles kernel version differences)
    u32 child_tid = BPF_CORE_READ(ctx, child_pid);
    if (child_tid == 0)
        return 0;  // clone failed or invalid

    // Get parent process info
    u32 parent_tid = (u32)bpf_get_current_pid_tgid();
    u64 parent_start = get_current_start_time();

    // Find which sandbox the parent belongs to
    u8 found = 0;
    u32 sandbox_id = find_sandbox_for_pid(parent_tid, parent_start, &found);
    if (!found)
        return 0;  // parent not tracked

    // Determine if this is a thread (CLONE_THREAD) or new process
    // CLONE_THREAD = 0x00010000
    // We can read clone_flags from task_struct, but for simplicity
    // we set is_thread = 1 for all clone events; Go-loader can refine
    // by comparing child TGID vs parent TGID from /proc.
    u8 is_thread = 1;  // Pessimistic: assume CLONE_THREAD
                       // If it was actually fork, Go loader corrects it.

    // Add child to the same sandbox
    // Note: child's start_time may not be available yet in BPF context,
    // so we use parent's start_time as a placeholder. Go loader will
    // update it with the real start_time from /proc/<child>/stat.
    add_pid_to_sandbox(sandbox_id, child_tid, parent_start);

    // Emit lifecycle event
    emit_lifecycle(LIFECYCLE_CLONE, child_tid, parent_tid,
                   sandbox_id, is_thread);

    return 0;
}

// ── sched:sched_process_exec — track execve ────────────────────────

SEC("tracepoint/sched/sched_process_exec")
int trace_sched_exec(struct trace_event_raw_sched_process_exec *ctx)
{
    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 start_time = get_current_start_time();

    u8 found = 0;
    u32 sandbox_id = find_sandbox_for_pid(tid, start_time, &found);
    if (!found)
        return 0;

    // Update the pid_key in the sandbox's inner map to use new comm
    // (start_time stays the same for the same process after exec)
    emit_lifecycle(LIFECYCLE_EXEC, tid, 0, sandbox_id, 0);

    return 0;
}

// ── sched:sched_process_exit — cleanup exited PIDs ─────────────────

SEC("tracepoint/sched/sched_process_exit")
int trace_sched_exit(struct trace_event_raw_sched_process_template *ctx)
{
    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 start_time = get_current_start_time();

    u8 found = 0;
    u32 sandbox_id = find_sandbox_for_pid(tid, start_time, &found);
    if (!found)
        return 0;  // not tracked (or already cleaned up)

    // Remove from all sandboxes (safety: might be tracked in multiple)
    remove_pid_from_all(tid, start_time);

    // Emit lifecycle event
    emit_lifecycle(LIFECYCLE_EXIT, tid, 0, sandbox_id, 0);

    return 0;
}