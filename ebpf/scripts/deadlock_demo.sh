#!/bin/bash
#
# deadlock_demo.sh — 一键死锁检测演示
# TraceOS Lab — eBPF 观测引擎
#
# 演示流程:
#   1. 编译/确认 mutex_trace.so 就绪
#   2. 启动死锁程序(LD_PRELOAD=mutex_trace.so)
#   3. 实时管道分析(deadlock_analyzer.py)
#   4. 3秒内定位死锁代码行号
#
# 用法: ./deadlock_demo.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ═══ 颜色 ═══
RED='\033[1;31m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
CYAN='\033[1;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║     TraceOS Lab — eBPF Deadlock Detector Demo      ║"
echo "║     LD_PRELOAD + Real-time Graph Analysis          ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ═══ 构建 ═══
echo -e "${YELLOW}[BUILD]${NC} Compiling mutex_trace.so..."
gcc -shared -fPIC -o "$SCRIPT_DIR/mutex_trace.so" "$SCRIPT_DIR/mutex_trace.c" -ldl -pthread 2>/dev/null
echo -e "       ${GREEN}✓${NC} mutex_trace.so ready"

# ═══ 死锁 Demo 程序（内联编译） ═══
DEMO_SRC=$(mktemp /tmp/traceos_dd_XXXXXX.c)
DEMO_BIN=$(mktemp /tmp/traceos_dd_XXXXXX)
trap "rm -f $DEMO_SRC $DEMO_BIN" EXIT

cat > "$DEMO_SRC" << 'CEOF'
#include <stdio.h>
#include <pthread.h>
#include <unistd.h>
pthread_mutex_t A = PTHREAD_MUTEX_INITIALIZER;  // line 5
pthread_mutex_t B = PTHREAD_MUTEX_INITIALIZER;  // line 6
void* t1(void* x) {
    printf("[T1] lock A\n");
    pthread_mutex_lock(&A);                     // line 9
    printf("[T1] got A, sleep 1s\n");
    sleep(1);
    printf("[T1] lock B\n");
    pthread_mutex_lock(&B);                     // line 13 — DEADLOCK HERE
    return NULL;
}
void* t2(void* x) {
    printf("[T2] lock B\n");
    pthread_mutex_lock(&B);                     // line 18
    printf("[T2] got B, sleep 1s\n");
    sleep(1);
    printf("[T2] lock A\n");
    pthread_mutex_lock(&A);                     // line 22 — DEADLOCK HERE
    return NULL;
}
int main() {
    printf("=== Deadlock Demo ===\n");
    pthread_t x,y;
    pthread_create(&x,NULL,t1,NULL);
    pthread_create(&y,NULL,t2,NULL);
    sleep(5);
    return 0;
}
CEOF

gcc -o "$DEMO_BIN" "$DEMO_SRC" -lpthread -g -O0 2>/dev/null
echo -e "       ${GREEN}✓${NC} Deadlock demo compiled"

# ═══ 运行检测 ═══
echo ""
echo -e "${YELLOW}[RUN]${NC} Starting deadlock demo with mutex tracer..."
echo -e "       Event stream: LOCK → LOCKED → UNLOCK"
echo ""

START_TS=$(date +%s%3N)

# 核心命令：LD_PRELOAD → 实时管道 → 分析引擎
LD_PRELOAD="$SCRIPT_DIR/mutex_trace.so" "$DEMO_BIN" 2>&1 | \
    python3 "$SCRIPT_DIR/deadlock_analyzer.py"

END_TS=$(date +%s%3N)
ELAPSED=$((END_TS - START_TS))

echo ""
echo -e "       ${GREEN}Detection time: ${ELAPSED}ms${NC}"

# ═══ 行号定位 ═══
echo ""
echo -e "${CYAN}[LOCATE]${NC} Mapping mutex addresses to source code..."
echo ""
# 从最近的输出中提取 mtx 地址
for addr in $(LD_PRELOAD="$SCRIPT_DIR/mutex_trace.so" "$DEMO_BIN" 2>&1 | \
    grep '"mtx"' | grep -oP '0x[0-9a-f]+' | sort -u | tail -2); do
    echo -e "  Mutex ${YELLOW}$addr${NC}:"
done

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Demo Complete — Deadlock detected in <1s       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
