#!/usr/bin/env python3
"""
deadlock_detector.py — eBPF futex 死锁检测引擎
TraceOS Lab

用法: python3 deadlock_detector.py --demo
"""

import argparse
import ctypes
import os
import subprocess
import sys
import tempfile
import threading
import time
from collections import defaultdict

from bcc import BPF

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/futex.h>

struct futex_event {
    u32 pid;
    u32 tid;
    u64 uaddr;
};

BPF_PERF_OUTPUT(events);
BPF_ARRAY(target_pid_map, u32, 1);

static inline int filter_pid(u32 tgid) {
    u32 key = 0;
    u32 *target = target_pid_map.lookup(&key);
    if (target && *target != 0 && tgid != *target) return 0;
    return 1;
}

TRACEPOINT_PROBE(syscalls, sys_enter_futex) {
    u32 tgid = (u32)(bpf_get_current_pid_tgid() >> 32);
    if (!filter_pid(tgid)) return 0;

    int op = (int)args->op;
    int cmd = op & FUTEX_CMD_MASK;
    if (cmd != FUTEX_WAIT && cmd != FUTEX_WAIT_PRIVATE) return 0;

    struct futex_event evt = {};
    evt.pid = tgid;
    evt.tid = (u32)bpf_get_current_pid_tgid();
    evt.uaddr = (u64)args->uaddr;
    events.perf_submit(args, &evt, sizeof(evt));
    return 0;
}
"""


class DeadlockDetector:
    def __init__(self):
        self.bpf = None
        self.lock_owner: dict[int, int] = {}
        self.waiting_for: dict[int, int] = {}
        self.thread_holds: dict[int, set[int]] = defaultdict(set)
        self.event_count = 0
        self.deadlocks_found = 0
        self.running = False

    def _detect_cycle(self) -> list[int] | None:
        visited, in_stack, path = set(), set(), []

        def dfs(tid):
            if tid in in_stack:
                idx = path.index(tid)
                self._cycle = path[idx:]
                return True
            if tid in visited:
                return False
            visited.add(tid)
            in_stack.add(tid)
            path.append(tid)
            wl = self.waiting_for.get(tid)
            if wl is not None:
                holder = self.lock_owner.get(wl)
                if holder and holder != tid:
                    if dfs(holder):
                        return True
            in_stack.remove(tid)
            path.pop()
            return False

        self._cycle = []
        for tid in self.waiting_for:
            if dfs(tid):
                return self._cycle
        return None

    def _handle_event(self, cpu, data, size):
        event = self.bpf["events"].event(data)
        self.event_count += 1
        tid, uaddr = event.tid, event.uaddr

        holder = self.lock_owner.get(uaddr, 0)
        if holder and holder != tid:
            self.waiting_for[tid] = uaddr
            cycle = self._detect_cycle()
            if cycle and len(cycle) >= 2:
                self.deadlocks_found += 1
                self._report(cycle)
        else:
            self.waiting_for.pop(tid, None)
            self.lock_owner[uaddr] = tid
            self.thread_holds[tid].add(uaddr)

    def _report(self, cycle):
        n = len(cycle)
        print(f"\n{'='*55}")
        print(f"  DEADLOCK DETECTED! ({n} threads)")
        print(f"{'='*55}")
        for i, tid in enumerate(cycle):
            nxt = cycle[(i + 1) % n]
            wl = self.waiting_for.get(tid, 0)
            print(f"    TID={tid} --futex_wait--> mtx=0x{wl:x} --held--> TID={nxt}")
        print(f"{'='*55}\n")

    def set_target_pid(self, pid):
        if self.bpf:
            idx = self.bpf["target_pid_map"].Key(0)
            self.bpf["target_pid_map"][idx] = ctypes.c_uint(pid)

    def start(self):
        self.bpf = BPF(text=BPF_PROGRAM, cflags=["-w"])
        self.bpf["events"].open_perf_buffer(self._handle_event, page_cnt=512)
        self.running = True
        print("[eBPF] Ready (futex tracepoint)")

    def poll_loop(self):
        try:
            while self.running:
                self.bpf.perf_buffer_poll(timeout=50)
        except KeyboardInterrupt:
            pass

    def stop(self):
        self.running = False
        print(f"\n[eBPF] Events: {self.event_count}  Deadlocks: {self.deadlocks_found}")


DEADLOCK_DEMO = r"""
#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <unistd.h>

pthread_mutex_t lock_a = PTHREAD_MUTEX_INITIALIZER;
pthread_mutex_t lock_b = PTHREAD_MUTEX_INITIALIZER;

void* thread1(void* arg) {
    printf("[T1] lock A...\n"); fflush(stdout);
    pthread_mutex_lock(&lock_a);
    printf("[T1] have A\n"); fflush(stdout);
    sleep(2);
    printf("[T1] lock B...\n"); fflush(stdout);
    pthread_mutex_lock(&lock_b);
    printf("[T1] got B\n");
    pthread_mutex_unlock(&lock_b);
    pthread_mutex_unlock(&lock_a);
    return NULL;
}
void* thread2(void* arg) {
    sleep(1);
    printf("[T2] lock B...\n"); fflush(stdout);
    pthread_mutex_lock(&lock_b);
    printf("[T2] have B\n"); fflush(stdout);
    sleep(2);
    printf("[T2] lock A...\n"); fflush(stdout);
    pthread_mutex_lock(&lock_a);
    printf("[T2] got A\n");
    pthread_mutex_unlock(&lock_a);
    pthread_mutex_unlock(&lock_b);
    return NULL;
}
int main() {
    printf("=== DEADLOCK DEMO ===\n"); fflush(stdout);
    pthread_t t1, t2;
    pthread_create(&t1, NULL, thread1, NULL);
    pthread_create(&t2, NULL, thread2, NULL);
    sleep(8);
    return 0;
}
"""


def main():
    p = argparse.ArgumentParser(description="TraceOS eBPF Deadlock Detector")
    p.add_argument("-p", "--pid", type=int)
    p.add_argument("--demo", action="store_true")
    args = p.parse_args()

    if args.demo:
        demo_bin = "/tmp/traceos_deadlock_demo"
        with tempfile.NamedTemporaryFile(mode='w', suffix='.c', delete=False) as f:
            f.write(DEADLOCK_DEMO)
            src = f.name
        subprocess.run(["gcc", "-o", demo_bin, src, "-lpthread", "-g"],
                       check=True, capture_output=True)
        os.unlink(src)

        detector = DeadlockDetector()
        detector.start()

        proc = subprocess.Popen([demo_bin],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        time.sleep(0.3)
        detector.set_target_pid(proc.pid)
        print(f"[Demo] PID={proc.pid}\n")

        def show_output():
            for line in iter(proc.stdout.readline, b''):
                sys.stdout.write(line.decode())
                sys.stdout.flush()

        t = threading.Thread(target=show_output, daemon=True)
        t.start()

        detector.poll_loop()
        proc.kill()
        detector.stop()

    elif args.pid:
        detector = DeadlockDetector()
        detector.set_target_pid(args.pid)
        detector.start()
        detector.poll_loop()
        detector.stop()
    else:
        p.print_help()


if __name__ == "__main__":
    main()
