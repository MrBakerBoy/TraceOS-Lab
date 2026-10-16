// SPDX-License-Identifier: GPL-2.0
// Copyright (c) 2026 TraceOS Lab. All rights reserved.
//
// trace_common_v2.h — Shared structures and helpers for TraceOS v2 BPF programs.
//
// This header is included by syscall_trace_v2.bpf.c, futex_deadlock_v2.bpf.c,
// and mem_trace_v2.bpf.c. All three programs share the same sandbox_pids
// HASH_OF_MAPS for unified PID tracking and filtering.

#ifndef __TRACE_COMMON_V2_H__
#define __TRACE_COMMON_V2_H__

#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

// ── PID tracking key (TID + start_time for reuse safety) ───────────

struct pid_key {
    u32 tid;
    u64 start_time;   // from /proc/<pid>/stat field 22 (starttime)
};

// ── Active sandboxes bitmap ────────────────────────────────────────

// Indexed by sandbox_id (0-63). Value 1 = active, 0 = inactive.
// Used to iterate active sandboxes in tracepoint handlers
// without needing to iterate all 64 slots.

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 64);
    __type(key, u32);
    __type(value, u8);
} active_sandboxes SEC(".maps");

// ── Per-sandbox PID tracking (HASH_OF_MAPS) ────────────────────────

// Outer key: sandbox_id (u32, range 0-63)
// Inner map: HASH<struct pid_key → u64(timestamp)>
// When a sandbox finishes, delete the outer key → kernel auto-reclaims
// the entire inner map. No manual per-PID cleanup needed.

struct {
    __uint(type, BPF_MAP_TYPE_HASH_OF_MAPS);
    __uint(max_entries, 64);
    __type(key, u32);
    __array(values, struct {
        __uint(type, BPF_MAP_TYPE_HASH);
        __uint(max_entries, 1024);
        __type(key, struct pid_key);
        __type(value, u64);
    });
} sandbox_pids SEC(".maps");

// ── Helper: find sandbox_id for a given (tid, start_time) ──────────
//
// Iterates active sandboxes and checks each inner map for the pid_key.
// Returns sandbox_id on success, 0 on not-found (0 is a valid sandbox_id,
// so caller should check the return value against a sentinel or use
// a separate flag).

static __always_inline u32
find_sandbox_for_pid(u32 tid, u64 start_time, u8 *found_flag) {
    struct pid_key key = { .tid = tid, .start_time = start_time };

    for (u32 sid = 0; sid < 64; sid++) {
        // Check if sandbox is active
        u8 *active = bpf_map_lookup_elem(&active_sandboxes, &sid);
        if (!active || !*active)
            continue;

        // Get inner map for this sandbox
        void *inner_map = bpf_map_lookup_elem(&sandbox_pids, &sid);
        if (!inner_map)
            continue;

        // Look up pid_key in inner map
        u64 *found = bpf_map_lookup_elem(inner_map, &key);
        if (found) {
            if (found_flag)
                *found_flag = 1;
            return sid;
        }
    }
    if (found_flag)
        *found_flag = 0;
    return 0;
}

// ── Helper: insert a pid_key into a specific sandbox's inner map ───

static __always_inline int
add_pid_to_sandbox(u32 sandbox_id, u32 tid, u64 start_time) {
    // Mark sandbox as active
    u8 one = 1;
    bpf_map_update_elem(&active_sandboxes, &sandbox_id, &one, BPF_ANY);

    // Get inner map (must already exist, created by Go loader)
    void *inner_map = bpf_map_lookup_elem(&sandbox_pids, &sandbox_id);
    if (!inner_map)
        return -1;

    struct pid_key key = { .tid = tid, .start_time = start_time };
    u64 now_ns = bpf_ktime_get_ns();
    return bpf_map_update_elem(inner_map, &key, &now_ns, BPF_ANY);
}

// ── Helper: remove a pid_key from all sandboxes ────────────────────

static __always_inline void
remove_pid_from_all(u32 tid, u64 start_time) {
    struct pid_key key = { .tid = tid, .start_time = start_time };

    for (u32 sid = 0; sid < 64; sid++) {
        u8 *active = bpf_map_lookup_elem(&active_sandboxes, &sid);
        if (!active || !*active)
            continue;

        void *inner_map = bpf_map_lookup_elem(&sandbox_pids, &sid);
        if (!inner_map)
            continue;

        bpf_map_delete_elem(inner_map, &key);
    }
}

// ── Helper: get current process start_time from task_struct ────────

static __always_inline u64
get_current_start_time(void) {
    struct task_struct *task = (void *)bpf_get_current_task();
    u64 start_boottime = BPF_CORE_READ(task, start_boottime);
    return start_boottime;
}

// ── Lifecycle event (ring buffer) ──────────────────────────────────

#define LIFECYCLE_CLONE  1
#define LIFECYCLE_EXEC   2
#define LIFECYCLE_EXIT   3

struct lifecycle_event {
    u32 tid;
    u32 parent_tid;
    u32 event_type;     // LIFECYCLE_CLONE / EXEC / EXIT
    u32 sandbox_id;
    u8  is_thread;      // clone with CLONE_THREAD
    u8  _pad[3];         // explicit padding for natural alignment
    u64 timestamp_ns;
    char comm[16];      // process name
};  // 48 bytes — must NOT be packed; Go binary.Read requires natural alignment

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} lifecycle_events SEC(".maps");

// ── Helper: emit lifecycle event ───────────────────────────────────

static __always_inline void
emit_lifecycle(u32 event_type, u32 tid, u32 parent_tid, u32 sandbox_id,
               u8 is_thread) {
    struct lifecycle_event *evt;
    evt = bpf_ringbuf_reserve(&lifecycle_events, sizeof(*evt), 0);
    if (!evt)
        return;

    evt->tid = tid;
    evt->parent_tid = parent_tid;
    evt->event_type = event_type;
    evt->sandbox_id = sandbox_id;
    evt->is_thread = is_thread;
    evt->timestamp_ns = bpf_ktime_get_ns();
    bpf_get_current_comm(&evt->comm, sizeof(evt->comm));

    bpf_ringbuf_submit(evt, 0);
}

#endif // __TRACE_COMMON_V2_H__