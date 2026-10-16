// SPDX-License-Identifier: GPL-2.0
// Copyright (c) 2026 TraceOS Lab. All rights reserved.
//
// trace_common_v2_nocore.h — Shared structures and helpers for v2 BPF
// programs WITHOUT CO-RE (non-BTF kernel compatibility).
//
// Key differences from trace_common_v2.h:
//   1. No #include "vmlinux.h" — minimal type definitions instead.
//   2. No BPF_CORE_READ — direct field access (kernel-version-bound).
//   3. get_current_start_time() reads from a userspace-populated BPF
//      map (pid_start_times) instead of task_struct.start_boottime.
//   4. tracepoint context structs are minimally defined for kernel ~5.15.
//
// Go loader MUST populate pid_start_times map before sandbox PIDs are
// added to sandbox_pids, otherwise start_time lookups will fail and
// tracing will silently miss events.

#ifndef __TRACE_COMMON_V2_NOCORE_H__
#define __TRACE_COMMON_V2_NOCORE_H__

#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

// ── Minimal type definitions (no vmlinux.h) ────────────────────────
//
// libbpf 0.5.x (Ubuntu 22.04) does not typedef u32/u64/u8/s64.
// vmlinux.h normally provides these, but non-CO-RE skips vmlinux.h.
// Define them manually so the nocore path compiles standalone.

typedef unsigned int   u32;
typedef unsigned long  u64;
typedef unsigned char  u8;
typedef long long      s64;
typedef unsigned short u16;
typedef short          s16;
typedef int            s32;

// task_struct forward declaration for bpf_get_current_task()
struct task_struct;

// Minimal sched_process_fork context (verified against kernel 5.15 format)
struct sched_fork_ctx {
    /* common trace_event fields */
    unsigned short common_type;       // offset 0
    unsigned char  common_flags;      // offset 2
    unsigned char  common_preempt_count; // offset 3
    int            common_pid;        // offset 4
    /* sched_process_fork specific */
    char           parent_comm[16];   // offset 8
    int            parent_pid;        // offset 24
    char           child_comm[16];    // offset 28
    int            child_pid;         // offset 44
};

// Minimal sched_process_exec context
struct sched_exec_ctx {
    unsigned short common_type;
    unsigned char  common_flags;
    unsigned char  common_preempt_count;
    int            common_pid;
    int            data_loc_filename;
    int            pid;
    int            old_pid;
};

// Minimal sched_process_exit context
struct sched_exit_ctx {
    unsigned short common_type;
    unsigned char  common_flags;
    unsigned char  common_preempt_count;
    int            common_pid;
    char           comm[16];
    int            pid;
    int            prio;
};

// raw_syscalls tracepoint context (stable kernel ABI)
struct sys_enter_ctx {
    unsigned short common_type;
    unsigned char  common_flags;
    unsigned char  common_preempt_count;
    int            common_pid;
    long           id;
    unsigned long  args[6];
};

struct sys_exit_ctx {
    unsigned short common_type;
    unsigned char  common_flags;
    unsigned char  common_preempt_count;
    int            common_pid;
    long           id;
    long           ret;
};

// ── PID tracking key (TID + start_time for reuse safety) ───────────

struct pid_key {
    u32 tid;
    u64 start_time;
};

// ── Userspace-populated PID → start_time map ───────────────────────
//
// Go loader MUST write (tid → start_time) entries into this map
// before adding PIDs to sandbox_pids.  start_time is read from
// /proc/<pid>/stat field 22, converted to nanoseconds (matching
// the CO-RE path's task_struct.start_boottime unit).
//
// Since we can't use bpf_get_current_task() + BPF_CORE_READ in
// non-CO-RE mode, this map is the authoritative source of start_time.

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 8192);  // generous: all PIDs across all sandboxes
    __type(key, u32);           // tid
    __type(value, u64);         // start_time (from /proc/pid/stat)
} pid_start_times SEC(".maps");

// ── Active sandboxes bitmap ────────────────────────────────────────

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 64);
    __type(key, u32);
    __type(value, u8);
} active_sandboxes SEC(".maps");

// ── Per-sandbox PID tracking (HASH_OF_MAPS) ────────────────────────

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

// ── get_current_start_time: userspace-populated map lookup ─────────

static __always_inline u64
get_current_start_time(void)
{
    u32 tid = (u32)bpf_get_current_pid_tgid();
    u64 *val = bpf_map_lookup_elem(&pid_start_times, &tid);
    return val ? *val : 0;
}

// ── find_sandbox_for_pid ───────────────────────────────────────────

static __always_inline u32
find_sandbox_for_pid(u32 tid, u64 start_time, u8 *found_flag) {
    struct pid_key key = { .tid = tid, .start_time = start_time };

    for (u32 sid = 0; sid < 64; sid++) {
        u8 *active = bpf_map_lookup_elem(&active_sandboxes, &sid);
        if (!active || !*active)
            continue;

        void *inner_map = bpf_map_lookup_elem(&sandbox_pids, &sid);
        if (!inner_map)
            continue;

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

// ── add_pid_to_sandbox ─────────────────────────────────────────────

static __always_inline int
add_pid_to_sandbox(u32 sandbox_id, u32 tid, u64 start_time) {
    u8 one = 1;
    bpf_map_update_elem(&active_sandboxes, &sandbox_id, &one, BPF_ANY);

    void *inner_map = bpf_map_lookup_elem(&sandbox_pids, &sandbox_id);
    if (!inner_map)
        return -1;

    struct pid_key key = { .tid = tid, .start_time = start_time };
    u64 now_ns = bpf_ktime_get_ns();
    return bpf_map_update_elem(inner_map, &key, &now_ns, BPF_ANY);
}

// ── remove_pid_from_all ────────────────────────────────────────────

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

// ── Lifecycle event (ring buffer) ──────────────────────────────────

#define LIFECYCLE_CLONE  1
#define LIFECYCLE_EXEC   2
#define LIFECYCLE_EXIT   3

struct lifecycle_event {
    u32 tid;
    u32 parent_tid;
    u32 event_type;
    u32 sandbox_id;
    u8  is_thread;
    u8  _pad[3];         // explicit padding for natural alignment
    u64 timestamp_ns;
    char comm[16];
};  // 48 bytes — must NOT be packed; Go binary.Read requires natural alignment

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} lifecycle_events SEC(".maps");

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

#endif // __TRACE_COMMON_V2_NOCORE_H__