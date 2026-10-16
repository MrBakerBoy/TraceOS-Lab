#!/usr/bin/env python3
"""
deadlock_analyzer.py — 死锁分析引擎
TraceOS Lab eBPF 观测引擎

从 mutex_trace.so 的输出（stderr JSONL）中分析死锁。

用法：
  LD_PRELOAD=./mutex_trace.so ./program 2>&1 | python3 deadlock_analyzer.py
  或
  python3 deadlock_analyzer.py trace_log.jsonl
"""

import sys
import json
from collections import defaultdict


class DeadlockAnalyzer:
    def __init__(self):
        self.lock_owner: dict[str, int] = {}     # mtx_addr -> holder_tid
        self.thread_holds: dict[int, set[str]] = defaultdict(set)
        self.waiting_for: dict[int, str] = {}     # waiter_tid -> mtx_addr
        self.event_log: list[dict] = []
        self.deadlocks: list[list[int]] = []

    def feed(self, event: dict):
        """处理一条追踪事件"""
        self.event_log.append(event)
        op = event["op"]
        tid = event["tid"]
        mtx = event["mtx"]
        ret = event.get("ret", 0)

        if op == "LOCK":
            # 线程尝试获取锁
            holder = self.lock_owner.get(mtx)
            if holder is not None and holder != tid:
                # 锁已被他人持有 -> 记录等待关系
                if self.waiting_for.get(tid) != mtx:
                    self.waiting_for[tid] = mtx
                    cycle = self._detect_cycle()
                    if cycle:
                        self.deadlocks.append(cycle)
                        self._print_deadlock(cycle)

        elif op == "LOCKED":
            # 锁获取结果（可能成功或失败）
            if ret == 0:
                # 成功获取 → 成为新持有者
                self.waiting_for.pop(tid, None)
                self.lock_owner[mtx] = tid
                self.thread_holds[tid].add(mtx)

        elif op == "UNLOCK":
            # 释放锁
            if self.lock_owner.get(mtx) == tid:
                self.lock_owner.pop(mtx, None)
            self.thread_holds[tid].discard(mtx)

            # 将锁转移给等待者
            for waiter, wmtx in list(self.waiting_for.items()):
                if wmtx == mtx:
                    self.waiting_for.pop(waiter, None)
                    self.lock_owner[mtx] = waiter
                    self.thread_holds[waiter].add(mtx)
                    break

        elif op == "TRYLOCKED":
            if ret == 0:
                self.lock_owner[mtx] = tid
                self.thread_holds[tid].add(mtx)

    def _detect_cycle(self) -> list[int] | None:
        """DFS 检测等待图中的环"""
        visited: set[int] = set()
        in_stack: set[int] = set()
        path: list[int] = []

        def dfs(node: int) -> bool:
            if node in in_stack:
                idx = path.index(node)
                self._cycle = path[idx:]
                return True
            if node in visited:
                return False
            visited.add(node)
            in_stack.add(node)
            path.append(node)
            wmtx = self.waiting_for.get(node)
            if wmtx is not None:
                holder = self.lock_owner.get(wmtx)
                if holder is not None and holder != node:
                    if dfs(holder):
                        return True
            in_stack.remove(node)
            path.pop()
            return False

        self._cycle = []
        for tid in self.waiting_for:
            if dfs(tid):
                return self._cycle
        return None

    def _print_deadlock(self, cycle: list[int]):
        n = len(cycle)
        header = [
            "",
            "=" * 55,
            f"  \033[1;31mDEADLOCK DETECTED!\033[0m  ({n} threads in cycle)",
            "=" * 55,
        ]
        if n == 0:
            print("\n".join(header) + "\n")
            return

        start_tid = cycle[0]
        context_before = [e for e in self.event_log[-50:]
                          if e["tid"] in cycle]
        print("\n".join(header))

        print(f"\n  Recent events leading to deadlock:")
        for e in context_before[-8:]:
            print(f"    [{e['op']:8s}] TID={e['tid']} mtx={e['mtx']}")

        print(f"\n  Deadlock cycle:")
        for i, tid in enumerate(cycle):
            nxt = cycle[(i + 1) % n]
            wmtx = self.waiting_for.get(tid, "?")
            print(f"    TID={tid}  ──waits──>  {wmtx}  ──held──>  TID={nxt}")

        print(f"\n  \033[33mFix: Reverse lock order — all threads must lock in same order.\033[0m")
        print("=" * 55 + "\n")

    def summary(self):
        print(f"\nTotal events: {len(self.event_log)}")
        print(f"Deadlocks found: {len(self.deadlocks)}")
        if not self.deadlocks and self.waiting_for:
            print(f"Active waits: {len(self.waiting_for)} (no cycle)")
        return self.deadlocks


def main():
    import argparse
    ap = argparse.ArgumentParser(description="TraceOS Deadlock Analyzer")
    ap.add_argument("file", nargs="?", help="JSONL trace file (stdin if omitted)")
    args = ap.parse_args()

    analyzer = DeadlockAnalyzer()

    if args.file:
        with open(args.file) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                    analyzer.feed(event)
                except json.JSONDecodeError:
                    pass  # skip non-JSON lines (like program output)
    else:
        # Read from stdin (live pipe from LD_PRELOAD)
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
                analyzer.feed(event)
            except json.JSONDecodeError:
                # Forward non-JSON lines (program output)
                print(line, flush=True)

    analyzer.summary()


if __name__ == "__main__":
    main()
