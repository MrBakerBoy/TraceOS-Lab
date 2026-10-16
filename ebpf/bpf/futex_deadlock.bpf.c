// SPDX-License-Identifier: GPL-2.0
// Copyright (c) 2026 TraceOS Lab. All rights reserved.
//
// futex_deadlock.bpf.c — CO-RE futex tracing for deadlock detection
//
// Hooks the sys_enter_futex tracepoint to capture every futex(FUTEX_WAIT)
// call and streams lock-acquire events to userspace via a BPF ring buffer.
// Userspace builds the wait-for graph and runs DFS cycle detection.
//
// Unlike ptrace-based strace, this eBPF program has near-zero overhead
// and does not serialize the target process.
//
// Compile: clang -O2 -g -target bpf -D__TARGET_ARCH_x86 \
//           -I/usr/include/x86_64-linux-gnu \
//           -c futex_deadlock.bpf.c -o futex_deadlock.bpf.o

#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

char LICENSE[] SEC("license") = "GPL";

volatile const u32 target_pid = 0;

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
    u32 op;      // futex command
    u64 uaddr;   // user-space address of the futex
    u64 timestamp_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024); // 256 KB ring buffer
} futex_events SEC(".maps");

// ── Tracepoint handler ─────────────────────────────────────────────

SEC("tracepoint/syscalls/sys_enter_futex")
int trace_futex_enter(struct trace_event_raw_sys_enter *ctx)
{
    u32 pid = (u32)(bpf_get_current_pid_tgid() >> 32);

    if (target_pid != 0 && pid != target_pid)
        return 0;

    int op = (int)ctx->args[1]; // args->op
    int cmd = op & FUTEX_CMD_MASK;

    // Only track wait/acquire operations (lock attempts that may block)
    if (cmd != FUTEX_WAIT && cmd != FUTEX_WAIT_BITSET && cmd != FUTEX_LOCK_PI)
        return 0;

    struct futex_event *evt;
    evt = bpf_ringbuf_reserve(&futex_events, sizeof(*evt), 0);
    if (!evt)
        return 0;

    evt->pid = pid;
    evt->tid = (u32)bpf_get_current_pid_tgid();
    evt->op = (u32)cmd;
    evt->uaddr = ctx->args[0]; // args->uaddr
    evt->timestamp_ns = bpf_ktime_get_ns();

    bpf_ringbuf_submit(evt, 0);
    return 0;
}
