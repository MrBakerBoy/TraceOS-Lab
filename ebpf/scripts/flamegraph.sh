#!/bin/bash
#
# flamegraph.sh — eBPF火焰图生成器
# TraceOS Lab 观测引擎 — 教师端性能分析
#
# 用法:
#   ./flamegraph.sh <pid> [duration_sec] [output_name]
#
# 输出: ebpf/output/<name>_user.svg, <name>_kernel.svg

PID="${1:-}"
DURATION="${2:-30}"
NAME="${3:-flamegraph_$(date +%Y%m%d_%H%M%S)}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../output"
FLAMEGRAPH_DIR="$SCRIPT_DIR/../tools/FlameGraph"

if [ -z "$PID" ]; then
    echo "Usage: $0 <pid> [duration_sec] [output_name]"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

if ! kill -0 "$PID" 2>/dev/null; then
    echo "Error: PID $PID does not exist"
    exit 1
fi

echo "=== TraceOS FlameGraph Generator ==="
echo "Target PID:  $PID"
echo "Duration:    ${DURATION}s"
echo "Output:      $OUTPUT_DIR/${NAME}*.svg"
echo ""

for target in user kernel; do
    if [ "$target" = "user" ]; then
        STACK="ustack(perf)"
        COLOR="java"
        LABEL="User-Space"
    else
        STACK="kstack(perf)"
        COLOR="io"
        LABEL="Kernel-Space"
    fi

    echo "[$target] Collecting $LABEL stack samples (${DURATION}s)..."
    STACK_FILE="$OUTPUT_DIR/${NAME}.${target}stacks"

    timeout "$((DURATION + 5))" bpftrace -e "
        profile:hz:99 /pid == $PID/ {
            @stack[$STACK] = count();
        }
        interval:s:$DURATION { exit(); }
        END { print(@stack); clear(@stack); }
    " > "$STACK_FILE" 2>/dev/null || true

    if [ -s "$STACK_FILE" ]; then
        echo "  -> $(wc -l < "$STACK_FILE") lines collected"
        "$FLAMEGRAPH_DIR/stackcollapse-bpftrace.pl" "$STACK_FILE" | \
            "$FLAMEGRAPH_DIR/flamegraph.pl" \
                --title "TraceOS $LABEL Flame Graph (PID=$PID, ${DURATION}s)" \
                --countname "samples" \
                --colors "$COLOR" \
                --hash \
            > "$OUTPUT_DIR/${NAME}_${target}.svg" 2>/dev/null && \
            echo "  -> SVG: ${NAME}_${target}.svg ($(du -h "$OUTPUT_DIR/${NAME}_${target}.svg" | cut -f1))"
    else
        echo "  -> No samples (process may be idle)"
    fi
done

echo ""
echo "Done. Open the SVG in a browser:"
ls "$OUTPUT_DIR/${NAME}"*.svg 2>/dev/null && echo "  file://$OUTPUT_DIR/"
