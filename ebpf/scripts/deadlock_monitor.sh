#!/bin/bash
#
# deadlock_monitor.sh — 死锁监视脚本
# TraceOS Lab eBPF 观测引擎
#
# 原理：
#   pthread_mutex_lock 内部调用 futex(FUTEX_WAIT_PRIVATE, &mutex->__data.__lock, ...)
#   第一次成功的 lock 不会触发 futex（fastpath）
#   竞争时才会触发 futex_wait → 我们可以追踪到"谁在等待谁持有的锁"
#
# 用法：./deadlock_monitor.sh <pid> [duration_sec]

PID="${1:-}"
DURATION="${2:-30}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../output"
mkdir -p "$OUTPUT_DIR"

if [ -z "$PID" ]; then
    echo "Usage: $0 <pid> [duration_sec]"
    exit 1
fi

EVENTS_FILE="$OUTPUT_DIR/deadlock_events_$(date +%Y%m%d_%H%M%S).json"

echo "=== TraceOS Deadlock Monitor ==="
echo "Target PID:  $PID"
echo "Duration:    ${DURATION}s"
echo ""

# Step 1: 用 bpftrace 采集所有 futex 事件（不仅是 WAIT，还包括 WAKE）
echo "[1/2] Collecting futex events (${DURATION}s)..."
timeout "$((DURATION + 5))" bpftrace -o "$EVENTS_FILE" -e "
    tracepoint:syscalls:sys_enter_futex
    / pid == $PID /
    {
        printf(\"{\\\"tid\\\":%d,\\\"uaddr\\\":\\\"%lx\\\",\\\"op\\\":%d,\\\"ts\\\":%lu}\\n\",
            tid, args->uaddr, args->op, nsecs);
    }
    interval:s:$DURATION { exit(); }
" 2>/dev/null || true

echo "[2/2] Analyzing deadlock..."
python3 - "$EVENTS_FILE" << 'PYEOF'
import sys, json
from collections import defaultdict

with open(sys.argv[1]) as f:
    raw = [json.loads(l) for l in f if l.strip().startswith("{")]

print(f"Total futex events: {len(raw)}")

if len(raw) == 0:
    print("No futex events. Done.")
    sys.exit(0)

# pthread_mutex internals:
#   FUTEX_WAIT = 0, FUTEX_WAIT_PRIVATE = 128
#   FUTEX_WAKE = 1, FUTEX_WAKE_PRIVATE = 129
#
# uaddr points to mutex->__data.__lock (field at offset 0)
# When an uncontested lock is taken, no futex call (fastpath via atomic CAS).
# When contested: 1st holder takes lock (no futex)
#                  2nd caller does futex(FUTEX_WAIT_PRIVATE, &lock_field)

WAIT_OPS = {0, 128, 9, 137}  # WAIT, WAIT_PRIVATE, WAIT_BITSET, WAIT_BITSET_PRIVATE
WAKE_OPS = {1, 129}

lock_holder: dict[int, int] = {}   # uaddr -> tid (who currently holds the lock)
waiting_for: dict[int, int] = {}    # waiter_tid -> uaddr
thread_first_seen: dict[int, int] = {}  # tid -> first uaddr it accessed
unlock_events: set = set()           # (tid, uaddr) pairs seen in FUTEX_WAKE

for evt in sorted(raw, key=lambda x: x["ts"]):
    tid = evt["tid"]
    uaddr = int(evt["uaddr"], 16)
    op = evt["op"]
    cmd = op & 0x7F

    if cmd in {0, 9}:  # FUTEX_WAIT variants
        holder = lock_holder.get(uaddr)
        if holder and holder != tid:
            waiting_for[tid] = uaddr
        else:
            # No holder yet -> this thread takes the lock (after wake? or uncontested fastpath missed)
            lock_holder[uaddr] = tid
            waiting_for.pop(tid, None)

    elif cmd == 1:  # FUTEX_WAKE -> thread is releasing lock, wake waiters
        # The waker (tid) is the lock holder
        # Record the uaddr as "about to be released"
        unlock_events.add((tid, uaddr))
        # Actually, FUTEX_WAKE is called by the holder to wake waiters
        # So: tid holds uaddr, and is releasing it
        was_holder = lock_holder.get(uaddr)
        if was_holder == tid:
            # Transfer lock to first waiter
            for wt, wu in list(waiting_for.items()):
                if wu == uaddr:
                    waiting_for.pop(wt, None)
                    lock_holder[uaddr] = wt
                    break
            else:
                lock_holder.pop(uaddr, None)

# Now detect cycle
def detect_cycle(waiting, owners):
    visited, in_stack, path = set(), set(), []
    def dfs(node):
        if node in in_stack:
            idx = path.index(node)
            return path[idx:]
        if node in visited:
            return None
        visited.add(node)
        in_stack.add(node)
        path.append(node)
        wl = waiting.get(node)
        if wl is not None:
            h = owners.get(wl)
            if h and h != node:
                r = dfs(h)
                if r: return r
        in_stack.remove(node)
        path.pop()
        return None
    for t in waiting:
        r = dfs(t)
        if r: return r
    return None

cycle = detect_cycle(waiting_for, lock_holder)

if cycle:
    n = len(cycle)
    print()
    print("=" * 55)
    print(f"  \033[1;31mDEADLOCK DETECTED!\033[0m ({n} threads in cycle)")
    print("=" * 55)
    for i, tid in enumerate(cycle):
        nxt = cycle[(i + 1) % n]
        wl = waiting_for.get(tid, 0)
        print(f"    TID={tid} --futex_wait--> mtx=0x{wl:x} --held--> TID={nxt}")
    print("=" * 55)
    print(f"  Events analyzed: {len(raw)}")
    print()
else:
    print()
    print(f"  \033[32m✓ No deadlock detected\033[0m in {len(raw)} events")
    print(f"  Active wait relationships: {len(waiting_for)}")
    for wt, wu in waiting_for.items():
        holder = lock_holder.get(wu, 0)
        print(f"    TID={wt} waits on 0x{wu:x} (held by TID={holder})")

PYEOF

echo ""
echo "Events file: $EVENTS_FILE"
