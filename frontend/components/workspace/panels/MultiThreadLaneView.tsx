"use client";

import React, { useEffect, useRef, useMemo } from "react";
import * as echarts from "echarts";
import { PanelHeader } from "@/components/ui/panel-header";
import ViewHelpButton from "@/components/ui/ViewHelpButton";
import { SWIMLANE_HELP } from "@/lib/view-help-content";
import { GitBranch } from "lucide-react";

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

const CATEGORY_COLORS: Record<string, string> = {
  io: "#3b82f6",
  process: "#22c55e",
  memory: "#f59e0b",
  network: "#f97316",
  ipc: "#a855f7",
  signal: "#ec4899",
  lock: "#ef4444",
  other: "#6b7280",
};

const CATEGORY_PATTERNS: [string, RegExp][] = [
  ["io", /^(read|write|open|close|stat|fstat|lstat|lseek|pread|pwrite|readv|writev|fcntl|ioctl|poll|select|epoll|fsync|fdatasync|getdents|link|unlink|symlink|rename|dup|pipe)_?/],
  ["memory", /^(mmap|munmap|mprotect|brk|sbrk|madvise|mlock|msync|mremap)_?/],
  ["process", /^(fork|vfork|clone|execve?|wait4?|exit|_exit|getpid|gettid|prctl|arch_prctl|set_tid_address|set_robust_list|exit_group)_?/],
  ["network", /^(socket|connect|bind|listen|accept|send|recv|sendto|recvfrom|sendmsg|recvmsg|shutdown|getsockopt|setsockopt)_?/],
  ["ipc", /^(shmget|shmat|shmdt|shmctl|semget|semop|semctl|msgget|msgsnd|msgrcv|msgctl|pipe2?)_?/],
  ["signal", /^(kill|tgkill|tkill|rt_sig|sigaction|sigprocmask|signalfd)_?/],
  ["lock", /^(futex)_?/],
];

const EVENT_SYSCALLS = new Set([
  "fork", "vfork", "clone", "execve", "execveat",
  "futex", "kill", "tgkill", "tkill", "exit", "exit_group",
]);

function getCategory(name: string): string {
  for (const [cat, p] of CATEGORY_PATTERNS) {
    if (p.test(name)) return cat;
  }
  return "other";
}

function isEventSyscall(name: string): boolean {
  return EVENT_SYSCALLS.has(name);
}

const EVENT_LABELS: Record<string, string> = {
  fork: "fork()",
  vfork: "vfork()",
  clone: "clone()",
  execve: "exec()",
  execveat: "exec()",
  futex: "futex",
  kill: "signal",
  tgkill: "signal",
  tkill: "signal",
  exit: "exit()",
  exit_group: "exit()",
};

export default function MultiThreadLaneView({ traces }: { traces: SyscallTrace[] }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const { lanes, ipcEdges, events, globalTime } = useMemo(() => {
    if (!traces.length) return { lanes: [], ipcEdges: [], events: [], globalTime: { min: 0, max: 1, span: 1 } };

    const threadMap = new Map<number, SyscallTrace[]>();
    for (const t of traces) {
      const key = t.tid ?? t.pid;
      if (!threadMap.has(key)) threadMap.set(key, []);
      threadMap.get(key)!.push(t);
    }

    const entries = Array.from(threadMap.entries());
    const sorted = entries
      .map(([tid, trs]) => ({
        tid,
        traces: trs.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()),
      }))
      .sort((a, b) => new Date(a.traces[0].time).getTime() - new Date(b.traces[0].time).getTime());

    const minTime = new Date(sorted[0].traces[0].time).getTime();
    const lastLane = sorted[sorted.length - 1];
    const maxTime = new Date(lastLane.traces[lastLane.traces.length - 1].time).getTime();
    const span = maxTime - minTime || 1;

    // Find events
    const evts: { tid: number; name: string; time: number; label: string }[] = [];
    for (const l of sorted) {
      for (const t of l.traces) {
        if (isEventSyscall(t.syscall_name)) {
          evts.push({
            tid: l.tid,
            name: t.syscall_name,
            time: new Date(t.time).getTime(),
            label: EVENT_LABELS[t.syscall_name] || t.syscall_name,
          });
        }
      }
    }

    // IPC edges
    const edges: { fromTid: number; toTid: number; fromTime: number; toTime: number; type: string }[] = [];
    for (const l of sorted) {
      for (const t of l.traces) {
        if ((t.syscall_name === "fork" || t.syscall_name === "vfork" || t.syscall_name === "clone") && t.return_value > 0) {
          const childPid = t.return_value as number;
          const childExists = sorted.some((sl) => sl.tid === childPid || sl.traces.some((st) => st.pid === childPid));
          if (childExists) {
            edges.push({
              fromTid: l.tid,
              toTid: childPid,
              fromTime: new Date(t.time).getTime(),
              toTime: new Date(t.time).getTime(),
              type: "fork",
            });
          }
        }
      }
    }

    return {
      lanes: sorted.map((l, i) => ({
        tid: l.tid,
        index: i,
        traces: l.traces.map((t) => ({
          start: ((new Date(t.time).getTime() - minTime) / span) * 100,
          width: Math.max((t.duration_ns / 1e6 / span) * 100, 0.5),
          category: getCategory(t.syscall_name),
          color: CATEGORY_COLORS[getCategory(t.syscall_name)] || CATEGORY_COLORS.other,
          name: t.syscall_name,
          pid: t.pid,
          tid: t.tid,
          error: !!t.error_name,
          dur: t.duration_ns,
        })),
      })),
      ipcEdges: edges,
      events: evts,
      globalTime: { min: minTime, max: maxTime, span },
    };
  }, [traces]);

  const chartOption = useMemo(() => {
    if (!lanes.length) return null;
    const laneNames = lanes.map((l) => `T${l.tid}`);
    const { span } = globalTime;
    const series: any[] = [];

    const laneData = lanes.flatMap((lane) =>
      lane.traces.map((b) => ({
        value: [b.start, lane.index, b.width, b.name, b.color, b.error, b.tid],
        itemStyle: { color: b.color, borderColor: b.error ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.1)", borderWidth: b.error ? 1.5 : 0.5 },
      }))
    );

    series.push({
      type: "custom",
      data: laneData,
      encode: { x: [0], y: [1] },
      renderItem: (_params: any, api: any) => {
        const point = api.coord([api.value(0), api.value(1)]);
        const laneH = api.size([0, 1])[1];
        const barH = Math.max(laneH * 0.55, 8);
        const chartW = api.size([0, 0])[0];
        const barW = Math.max((api.value(2) as number) / 100 * chartW, 4);
        const color = api.value(4);
        const name = api.value(3);
        return {
          type: "rect",
          shape: { x: point[0], y: point[1] - barH / 2, width: barW, height: barH, r: 3 },
          style: { fill: color, stroke: "rgba(255,255,255,0.15)", lineWidth: 0.5 },
          label: { show: barW > 50, formatter: name, position: "inside", color: "#fff", fontSize: 9, fontFamily: "monospace" },
        };
      },
    });

    // Event markers
    if (events.length) {
      const eventData = events.map((e) => {
        const laneIdx = lanes.findIndex((l) => l.tid === e.tid);
        const x = ((e.time - globalTime.min) / span) * 100;
        return { value: [x, laneIdx, e.label, e.name], itemStyle: { color: "#fff" } };
      });
      series.push({
        type: "custom",
        data: eventData,
        encode: { x: [0], y: [1] },
        renderItem: (_params: any, api: any) => {
          const point = api.coord([api.value(0), api.value(1)]);
          const size = 6;
          const x = point[0];
          const y = point[1];
          return {
            type: "polygon",
            shape: { points: [[x, y - size], [x + size, y], [x, y + size], [x - size, y]] },
            style: { fill: "#fff", stroke: "#f59e0b", lineWidth: 2 },
            label: { show: true, formatter: api.value(2), position: "top", distance: 6, color: "#f59e0b", fontSize: 9, fontFamily: "monospace" },
          };
        },
      });
    }

    // IPC arrows
    if (ipcEdges.length) {
      ipcEdges.forEach((edge) => {
        const fromIdx = lanes.findIndex((l) => l.tid === edge.fromTid);
        const toIdx = lanes.findIndex((l) => l.tid === edge.toTid);
        if (fromIdx < 0 || toIdx < 0) return;
        const xPos = ((edge.fromTime - globalTime.min) / span) * 100;
        series.push({
          type: "lines",
          coordinateSystem: "cartesian2d",
          polyline: false,
          data: [{ coords: [[xPos, fromIdx], [xPos, toIdx]] }],
          lineStyle: { color: "#a855f7", width: 1.5, type: "dashed", opacity: 0.7 },
          effect: { show: true, period: 4, trailLength: 0.2, symbol: "arrow", symbolSize: 6 },
          label: { show: true, formatter: edge.type, position: "middle", color: "#a855f7", fontSize: 9 },
        });
      });
    }

    return {
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(0,0,0,0.85)",
        borderColor: "rgba(255,255,255,0.15)",
        textStyle: { color: "#fff", fontSize: 12, fontFamily: "monospace" },
        formatter: (params: any) => {
          if (!params.data || !params.data.value) return "";
          const d = params.data.value;
          if (d.length < 5) return `<div><b>◆ ${d[2] || ""}</b></div>`;
          const durUs = d[6] > 0 ? (d[6] / 1000).toFixed(1) + "μs" : "<1μs";
          return `<div style="max-width:300px"><b style="color:${d[4]}">${d[3]}</b><br/>TID: ${d[6] || "?"} 耗时: ${durUs}<br/>${d[5] ? '<span style="color:#ef4444">⚠ Error</span>' : ""}</div>`;
        },
      },
      grid: { left: 70, right: 16, top: 10, bottom: 48, containLabel: false },
      xAxis: {
        type: "value", name: "Timeline", nameLocation: "middle", nameGap: 28,
        nameTextStyle: { color: "#999", fontSize: 11 },
        min: 0, max: 100,
        axisLabel: { color: "#999", fontSize: 10, formatter: (val: number) => { const ms = (val / 100) * span; return ms < 1 ? `${(ms * 1000).toFixed(0)}μs` : `${ms.toFixed(1)}ms`; } },
        splitLine: { show: true, lineStyle: { color: "rgba(128,128,128,0.1)", type: "dashed" } },
      },
      yAxis: {
        type: "category", data: laneNames,
        axisLabel: { fontSize: 11, fontFamily: "monospace", color: "#ccc" },
        axisLine: { lineStyle: { color: "rgba(128,128,128,0.2)" } },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: "rgba(128,128,128,0.08)" } },
        inverse: true,
      },
      dataZoom: [
        { type: "slider", xAxisIndex: 0, bottom: 4, height: 24, borderColor: "rgba(128,128,128,0.2)", fillerColor: "rgba(0,113,227,0.1)", handleStyle: { color: "#0071e3" }, textStyle: { color: "#999", fontSize: 10 } },
        { type: "inside", xAxisIndex: 0 },
      ],
      series,
    };
  }, [lanes, events, ipcEdges, globalTime]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstance.current) chartInstance.current = echarts.init(chartRef.current);
    const chart = chartInstance.current;
    if (chartOption) chart.setOption(chartOption, true);
    const h = () => chart.resize();
    window.addEventListener("resize", h);
    chart.on("dblclick", () => chart.dispatchAction({ type: "dataZoom", startValue: 0, endValue: 100 }));
    return () => { window.removeEventListener("resize", h); };
  }, [chartOption]);

  useEffect(() => { return () => { chartInstance.current?.dispose(); chartInstance.current = null; }; }, []);

  if (!traces.length) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader icon={GitBranch} title="多线程泳道" subtitle="Chrome DevTools 风格" />
        <div className="flex-1 flex items-center justify-center text-[var(--kt-text-tertiary)] text-sm">暂无数据</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader icon={GitBranch} title="多线程泳道" subtitle={`${lanes.length} 线程 · ${traces.length} 调用 · ${events.length} 事件 · ${ipcEdges.length} IPC`} actions={<ViewHelpButton content={SWIMLANE_HELP} />} />
      <div className="flex-1 p-1 min-h-0">
        <div ref={chartRef} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}
