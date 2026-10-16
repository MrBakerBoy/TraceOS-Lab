"use client";

import React, { useEffect, useRef, useMemo, useState, forwardRef, useImperativeHandle } from "react";
import * as echarts from "echarts";
import { PanelHeader } from "@/components/ui/panel-header";
import ViewHelpButton from "@/components/ui/ViewHelpButton";
import { WATERFALL_HELP } from "@/lib/view-help-content";
import { motion } from "framer-motion";
import { GanttChart } from "lucide-react";
import { registerDynamicTheme as setupKTTheme } from "@/lib/setup-echarts";

interface SyscallTrace {
  time: string;
  submission_id: string;
  pid: number;
  tid?: number;
  args?: Record<string, unknown>;
  source_line?: number;
  syscall_name: string;
  return_value: number;
  error_name: string;
  duration_ns: number;
}

// Register kt-dynamic ECharts theme on module load
if (typeof window !== "undefined") { setupKTTheme(); }

const CATEGORY_COLORS: Record<string, string> = {
  io: "#ef4444",
  process: "#3b82f6",
  memory: "#22c55e",
  network: "#f97316",
  ipc: "#a855f7",
  other: "#6b7280",
};

const CATEGORY_PATTERNS: [string, RegExp][] = [
  ["io", /^(read|write|open|close|stat|fstat|lstat|lseek|pread|pwrite|readv|writev|fcntl|ioctl|poll|select|epoll|sendfile|copy_file_range|fsync|fdatasync|truncate|ftruncate|fallocate|getdents|readdir|link|unlink|symlink|readlink|rename|chmod|chown|access|dup|dup2|pipe)_?/],
  ["memory", /^(mmap|munmap|mprotect|brk|sbrk|madvise|mincore|mlock|mlockall|munlock|munlockall|msync|remap_file_pages|mremap)_?/],
  ["process", /^(fork|vfork|clone|exec|wait|waitpid|exit|_exit|getpid|getppid|gettid|setpgid|getpgid|setsid|kill|tgkill|tkill|rt_sig|sig|prctl|arch_prctl|set_tid_address|set_robust_list|rseq|execve|exit_group|newfstatat|getrandom|prlimit64)_?/],
  ["network", /^(socket|connect|bind|listen|accept|send|recv|sendto|recvfrom|sendmsg|recvmsg|shutdown|getsockopt|setsockopt|getpeername|getsockname)_?/],
  ["ipc", /^(shmget|shmat|shmdt|shmctl|semget|semop|semctl|msgget|msgsnd|msgrcv|msgctl|futex)_?/],
];

const EVENT_SYSCALLS: Record<string, string> = {
  fork: "◆ fork()", vfork: "◆ vfork()", clone: "◆ clone()",
  execve: "◆ exec()", execveat: "◆ exec()",
  futex: "◇ futex", kill: "◆ signal", tgkill: "◆ signal", tkill: "◆ signal",
  exit: "⬥ exit()", exit_group: "⬥ exit_group()",
};

function getCategory(syscallName: string): string {
  for (const [cat, pattern] of CATEGORY_PATTERNS) { if (pattern.test(syscallName)) return cat; }
  return "other";
}

export interface WaterfallTimelineHandle {
  scrollToTimestamp: (ts: number) => void;
  highlightTimestamp: (ts: number) => void;
}

interface WaterfallTimelineProps { traces: SyscallTrace[]; }

const WaterfallTimeline = forwardRef<WaterfallTimelineHandle, WaterfallTimelineProps>(
  function WaterfallTimeline({ traces }, ref) {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstance = useRef<echarts.ECharts | null>(null);
    const [highlightedTs, setHighlightedTs] = useState<number | null>(null);
    const [rangeStats, setRangeStats] = useState<{
      count: number; threads: number; errors: number; avgDuration: number;
    } | null>(null);

    const swimlaneData = useMemo(() => {
      if (!traces.length) return { pids: [] as number[], pidLanes: {} as Record<number, number> };
      const seen = new Set<number>();
      const pids: number[] = [];
      const parentChild: Record<number, number | null> = {};
      for (const t of traces) {
        if (!seen.has(t.pid)) { seen.add(t.pid); pids.push(t.pid); }
        if (t.syscall_name === "fork" || t.syscall_name === "clone" || t.syscall_name === "vfork") {
          if (t.return_value > 0) parentChild[t.return_value] = t.pid;
        }
      }
      const ordered: number[] = [];
      const rootPids = pids.filter((p) => !(p in parentChild));
      function addWithChildren(pid: number) { ordered.push(pid); pids.filter((c) => parentChild[c] === pid).forEach(addWithChildren); }
      for (const rp of rootPids) addWithChildren(rp);
      for (const p of pids) { if (!ordered.includes(p)) ordered.push(p); }
      const pidLanes: Record<number, number> = {};
      ordered.forEach((p, i) => { pidLanes[p] = i; });
      return { pids: ordered, pidLanes };
    }, [traces]);

    useImperativeHandle(ref, () => ({
      scrollToTimestamp: (ts: number) => {
        const chart = chartInstance.current;
        if (!chart || !traces.length) return;
        const minTime = new Date(traces[0].time).getTime();
        const maxTime = new Date(traces[traces.length - 1].time).getTime();
        const span = maxTime - minTime || 1;
        const norm = ((ts - minTime) / span) * 100;
        chart.dispatchAction({ type: "dataZoom", startValue: Math.max(0, norm - 15), endValue: Math.min(100, norm + 15) });
      },
      highlightTimestamp: (ts: number) => { setHighlightedTs(ts); },
    }), [traces]);

    const sortedTraces = useMemo(
      () => [...traces].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()),
      [traces]
    );
    const tMin = useMemo(() => sortedTraces.length ? new Date(sortedTraces[0].time).getTime() : 0, [sortedTraces]);
    const tMax = useMemo(() => sortedTraces.length ? new Date(sortedTraces[sortedTraces.length - 1].time).getTime() : 1, [sortedTraces]);
    const tSpan = tMax - tMin || 1;

    const chartOption = useMemo(() => {
      if (!traces.length || !swimlaneData.pids.length) return null;
      const { pids, pidLanes } = swimlaneData;
      const renderData = sortedTraces.map((t) => {
        const lane = pidLanes[t.pid] ?? 0;
        const startMs = new Date(t.time).getTime();
        const normStart = ((startMs - tMin) / tSpan) * 100;
        const durMs = t.duration_ns / 1e6;
        let width = (durMs / tSpan) * 100;
        if (width < 0.8) width = 0.8;
        if (width > 5) width = 5;
        const category = getCategory(t.syscall_name);
        const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
        const isError = !!t.error_name;
        return { value: [normStart, lane, width, t.syscall_name, t.return_value, t.error_name, t.duration_ns, color, t, isError], itemStyle: { color, borderColor: isError ? "#fff" : "transparent", borderWidth: isError ? 1.5 : 0 } };
      });
      const eventData = sortedTraces.filter((t) => EVENT_SYSCALLS[t.syscall_name]).map((t) => {
        const lane = pidLanes[t.pid] ?? 0;
        const startMs = new Date(t.time).getTime();
        const normStart = ((startMs - tMin) / tSpan) * 100;
        return { value: [normStart, lane, EVENT_SYSCALLS[t.syscall_name], t.syscall_name] };
      });
      const series: any[] = [{
        type: "custom",
        renderItem: (_params: any, api: any) => {
          const point = api.coord([api.value(0), api.value(1)]);
          const laneHeight = api.size([0, 1])[1];
          const barHeight = Math.max(laneHeight * 0.6, 10);
          const chartWidth = api.size([0, 0])[0];
          const barWidth = Math.max((api.value(2) as number) / 100 * chartWidth, 6);
          const color = api.value(7) as string;
          const trace = api.value(8) as SyscallTrace;
          const isError = api.value(9) as boolean;
          const isHL = highlightedTs != null && Math.abs(new Date(trace.time).getTime() - highlightedTs) < 1;
          return { type: "rect", shape: { x: point[0], y: point[1] - barHeight / 2, width: barWidth, height: barHeight, r: 2 }, style: { fill: color, stroke: isHL ? "#fff" : isError ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.15)", lineWidth: isHL ? 2.5 : isError ? 1 : 0.5 }, label: { show: barWidth > 40, formatter: trace.syscall_name, position: "inside", color: "#fff", fontSize: 9, fontFamily: "monospace", overflow: "truncate", ellipsis: ".." } };
        },
        data: renderData, encode: { x: [0], y: [1] },
      }];
      if (eventData.length > 0) {
        series.push({ type: "custom", data: eventData, encode: { x: [0], y: [1] }, z: 10, renderItem: (_params: any, api: any) => { const point = api.coord([api.value(0), api.value(1)]); const size = 6; const x = point[0]; const y = point[1]; return { type: "polygon", shape: { points: [[x, y - size], [x + size, y], [x, y + size], [x - size, y]] }, style: { fill: "#fff", stroke: "#f59e0b", lineWidth: 2 }, label: { show: true, formatter: api.value(2), position: "top", distance: 8, color: "#f59e0b", fontSize: 9, fontFamily: "monospace", fontWeight: "bold" } }; } });
      }

      return {
        tooltip: { trigger: "item", backgroundColor: "rgba(0,0,0,0.85)", borderColor: "rgba(255,255,255,0.15)", textStyle: { color: "#fff", fontSize: 12, fontFamily: "monospace" }, formatter: (params: any) => { if (!params.data || !params.data.value) return ""; const d = params.data; const trace = d.value[8] as SyscallTrace; if (!trace) return `<div><b>${d.value[2]}</b></div>`; const durationUs = trace.duration_ns > 0 ? (trace.duration_ns / 1000).toFixed(1) + "μs" : "<1μs"; const cat = getCategory(trace.syscall_name); const catLabel = cat === "io" ? "I/O" : cat === "memory" ? "内存" : cat === "process" ? "进程" : cat === "network" ? "网络" : cat === "ipc" ? "IPC" : "其他"; const argsStr = trace.args ? Object.entries(trace.args).map(([k, v]) => `${k}=${v}`).join(", ") : "-"; return `<div style="max-width:340px"><b style="color:${d.value[7]}">${trace.syscall_name}</b> <span style="opacity:0.6">[${catLabel}]</span><br/><span style="opacity:0.7">PID:</span> ${trace.pid} &nbsp; <span style="opacity:0.7">耗时:</span> ${durationUs}<br/><span style="opacity:0.7">返回值:</span> ${trace.return_value}<br/><span style="opacity:0.7">参数:</span> ${argsStr}<br/>${trace.error_name ? `<span style="color:#ef4444">⚠ ${trace.error_name}</span><br/>` : ""}${trace.source_line ? `<span style="opacity:0.5">源码行: ${trace.source_line}</span>` : ""}</div>`; } },
        grid: { left: 70, right: 16, top: 8, bottom: 48, containLabel: false },
        xAxis: { type: "value", name: "时间线", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: "#999", fontSize: 11 }, min: 0, max: 100, axisLabel: { color: "#999", fontSize: 10, formatter: (val: number) => { const ms = (val / 100) * tSpan; return ms < 1 ? `${(ms * 1000).toFixed(0)}μs` : `${ms.toFixed(1)}ms`; } }, splitLine: { show: true, lineStyle: { color: "rgba(128,128,128,0.1)", type: "dashed" } } },
        yAxis: { type: "category", data: pids.map((p) => `PID ${p}`), axisLabel: { fontSize: 11, fontFamily: "monospace", color: "#999" }, axisLine: { lineStyle: { color: "rgba(128,128,128,0.2)" } }, axisTick: { show: false }, splitLine: { show: true, lineStyle: { color: "rgba(128,128,128,0.08)" } }, inverse: true },
        brush: { toolbox: ["rect", "clear"], brushLink: "all", xAxisIndex: 0, brushMode: "single", throttleType: "debounce", throttleDelay: 300 },
        dataZoom: [{ type: "slider", xAxisIndex: 0, bottom: 4, height: 24, borderColor: "rgba(128,128,128,0.2)", fillerColor: "rgba(0,113,227,0.1)", handleStyle: { color: "var(--accent, #0071e3)" }, textStyle: { color: "#999", fontSize: 10 }, labelFormatter: (val: number) => { const ms = (val / 100) * tSpan; return ms < 1 ? `${(ms * 1000).toFixed(0)}μs` : `${ms.toFixed(1)}ms`; } }, { type: "inside", xAxisIndex: 0, minValueSpan: 1 }],
        series,
      };
    }, [traces, swimlaneData, highlightedTs, sortedTraces, tMin, tSpan]);

    useEffect(() => {
      if (!chartRef.current) return;
      if (!chartInstance.current) chartInstance.current = echarts.init(chartRef.current, "kt-dynamic");
      const chart = chartInstance.current;
      if (chartOption) chart.setOption(chartOption, true);
      const h = () => chart.resize();
      window.addEventListener("resize", h);
      const handleClick = (params: any) => {
        if (params.seriesType === "custom" && params.data && params.data.value && params.data.value.length > 3) {
          const start = params.data.value[0] as number;
          const width = params.data.value[2] as number;
          chart.dispatchAction({ type: "dataZoom", startValue: Math.max(0, start - 5), endValue: Math.min(100, start + width + 5) });
        }
      };
      const handleDblClick = () => { chart.dispatchAction({ type: "dataZoom", startValue: 0, endValue: 100 }); };
      const handleBrush = (params: any) => {
        if (params.batch && params.batch.length > 0 && params.batch[0].areas && params.batch[0].areas.length > 0) {
          const area = params.batch[0].areas[0];
          const [startPct, endPct] = area.coordRange;
          const minT = tMin;
          const spanT = tSpan;
          const selected = sortedTraces.filter((t) => { const norm = ((new Date(t.time).getTime() - minT) / spanT) * 100; return norm >= startPct && norm <= endPct; });
          const threads = new Set(selected.map((t) => t.tid ?? t.pid));
          const avgDur = selected.length > 0 ? selected.reduce((s, t2) => s + t2.duration_ns, 0) / selected.length / 1000 : 0;
          setRangeStats({ count: selected.length, threads: threads.size, errors: selected.filter((t2) => t2.error_name).length, avgDuration: avgDur });
        } else { setRangeStats(null); }
      };
      chart.on("click", handleClick);
      chart.on("dblclick", handleDblClick);
      chart.on("brushEnd", handleBrush);
      chart.on("brushSelected", handleBrush);
      return () => { window.removeEventListener("resize", h); chart.off("click", handleClick); chart.off("dblclick", handleDblClick); chart.off("brushEnd", handleBrush); chart.off("brushSelected", handleBrush); };
    }, [chartOption, tMin, tSpan, sortedTraces]);

    useEffect(() => { return () => { chartInstance.current?.dispose(); chartInstance.current = null; }; }, []);

    if (!traces.length) return (
      <div className="flex flex-col h-full">
        <PanelHeader icon={GanttChart} title="瀑布图" subtitle="Syscall 时间线" />
        <div className="flex-1 flex items-center justify-center h-full text-[var(--text-tertiary)] text-sm">暂无数据</div>
      </div>
    );

    const totalCalls = traces.length;
    const errorCalls = traces.filter((t) => t.error_name).length;
    const pidCount = swimlaneData.pids.length;

    return (
      <div className="flex flex-col h-full">
        <PanelHeader
          icon={GanttChart}
          title="瀑布图"
          subtitle={`${pidCount} 泳道 \u00b7 ${totalCalls} 调用`}
          badge={errorCalls > 0 ? { label: `${errorCalls}`, variant: "solid" as const, tone: "warning" as const } : undefined}
        />
        <div className="flex items-center gap-3 flex-wrap px-4 py-2 border-b border-[var(--border-default)] bg-[var(--bg-card)] flex-shrink-0">
          <div className="flex items-center gap-2.5 text-[11px]">
            <span className="flex items-center gap-1"><span className="text-[var(--text-tertiary)]">泳道</span><span className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">{pidCount}</span></span>
            <span className="w-px h-3 bg-[var(--border-default)]" />
            <span className="flex items-center gap-1"><span className="text-[var(--text-tertiary)]">调用</span><span className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">{totalCalls}</span></span>
            {errorCalls > 0 && (<><span className="w-px h-3 bg-[var(--border-default)]" /><span className="flex items-center gap-1"><span className="text-[var(--text-tertiary)]">错误</span><span className="font-mono font-semibold tabular-nums" style={{ color: "var(--error)" }}>{errorCalls}</span></span></>)}
          </div>
          <div className="w-px h-4 bg-[var(--border-default)]" />
          <div className="flex items-center gap-2.5 flex-wrap">
            {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (<span key={cat} className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />{cat === "io" ? "I/O" : cat === "memory" ? "内存" : cat === "process" ? "进程" : cat === "network" ? "网络" : cat === "ipc" ? "IPC" : "其他"}</span>))}
          </div>
          <div className="w-px h-4 bg-[var(--border-default)]" />
          <span className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]"><span className="text-[#f59e0b]">◆</span> 关键事件</span>
          <div className="flex-1" />
          {rangeStats && (<span className="text-[10px] text-[var(--text-tertiary)] font-mono">选中: {rangeStats.count}调用 · {rangeStats.threads}线程 · {rangeStats.errors}错误 · 均{rangeStats.avgDuration.toFixed(1)}μs</span>)}
          <span className="text-[10px] text-[var(--text-tertiary)]">点击缩放 · 双击重置 · 拖拽选择</span>
        </div>
        <div className="flex-1 min-h-0 p-1">
          <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="flex-1 min-h-0 p-1"
        >
          <div ref={chartRef} style={{ width: "100%", height: "100%" }} />
        </motion.div>
        </div>
      </div>
    );
  });

export default WaterfallTimeline;
