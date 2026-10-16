// SPDX-License-Identifier: GPL-2.0
// Copyright (c) 2026 TraceOS Lab. All rights reserved.
//
// futex_deadlock_v2.bpf.c — CO-RE futex tracing with sandbox filtering.
//
// Adapted from v1: now uses shared sandbox_pids HASH_OF_MAPS for PID
// filtering instead of a single target_pid.  Only futex events from
// tracked sandbox processes are emitted.
//
// The ring buffer (futex_events) remains separate from syscall_events
// for clean separation of concerns — the Go loader reads both buffers
// independently and correlates by (tid, timestamp_ns).

#include "trace_common_v2.h"

char LICENSE[] SEC("license") = "GPL";

// ── Futex op constants ─────────────────────────────────────────────

#define FUTEX_WAIT          0
#define FUTEX_WAKE          1
#define FUTEX_WAIT_BITSET   9
#define FUTEX_LOCK_PI       6
#define FUTEX_UNLOCK_PI     7
#define FUTEX_CMD_MASK      0x7F

// ── Ring buffer event ──────────────────────────────────────────────

struct futex_event {
    u32 pid;
    u32 tid;
    u32 op;             // futex command
    u32 sandbox_id;     // which sandbox this belongs to
    u64 uaddr;          // user-space address of the futex
    u64 timestamp_ns;
} __attribute__((packed));

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} futex_events SEC(".maps");

// ── Tracepoint handler ─────────────────────────────────────────────

SEC("tracepoint/syscalls/sys_enter_futex")
int trace_futex_enter(struct trace_event_raw_sys_enter *ctx)
{
    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 start_time = get_current_start_time();

    u8 found = 0;
    u32 sandbox_id = find_sandbox_for_pid(tid, start_time, &found);
    if (!found)
        return 0;

    // Extract futex command from args[1] (op field)
    int op = (int)ctx->args[1];
    int cmd = op & FUTEX_CMD_MASK;

    // Track ALL futex operations for the deadlock state machine.
    // WAKE and UNLOCK_PI are needed to build the lock-release graph;
    // WAIT / WAIT_BITSET / LOCK_PI are needed for lock-acquire edges.
    // Skip FUTEX_FD (2), FUTEX_REQUEUE (3), FUTEX_CMP_REQUEUE (4)
    // and other non-lock operations.
    switch (cmd) {
    case FUTEX_WAIT:
    case FUTEX_WAKE:
    case FUTEX_WAIT_BITSET:
    case FUTEX_LOCK_PI:
    case FUTEX_UNLOCK_PI:
        break;
    default:
        return 0;  // not a lock-related futex op
    }

    struct futex_event *evt;
    evt = bpf_ringbuf_reserve(&futex_events, sizeof(*evt), 0);
    if (!evt)
        return 0;

    u64 pid_tgid = bpf_get_current_pid_tgid();
    evt->pid = (u32)(pid_tgid >> 32);
    evt->tid = (u32)pid_tgid;
    evt->op = (u32)cmd;
    evt->sandbox_id = sandbox_id;
    evt->uaddr = ctx->args[0];  // futex uaddr (first argument)
    evt->timestamp_ns = bpf_ktime_get_ns();

    bpf_ringbuf_submit(evt, 0);
    return 0;
}