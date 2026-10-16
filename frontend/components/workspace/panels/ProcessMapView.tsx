"use client";

import { useEffect, useRef, useMemo } from "react";
import { GitFork, Network, Share2, ArrowUpRight } from "lucide-react";
import { useEChart } from "@/hooks/useEChart";
import { useEbpfTheme } from "@/hooks/useEbpfTheme";
import type { SyscallTrace } from "@/types/ebpf";

interface ProcessNode {
  id: number; pid: number; tid?: number; name: string;
  type: "process" | "thread"; syscallCount: number;
}

interface ProcessEdge {
  source: number; target: number; type: string; count: number;
}

interface Props {
  traces: SyscallTrace[];
}

export default function ProcessMapView({ traces }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useEbpfTheme(containerRef);

  const { nodes, edges } = useMemo(() => buildTopology(traces), [traces]);

  const graphRef = useEChart(() => {
    if (nodes.length === 0) {
      return {
        title: { text: "暂无进程拓扑数据", left: "center", top: "center",
          textStyle: { color: theme.textTer, fontSize: 13 } },
      };
    }

    const graphNodes = nodes.map((n) => ({
      id: String(n.id),
      name: n.name,
      symbolSize: Math.max(20, Math.min(50, 20 + n.syscallCount * 2)),
      category: n.type === "process" ? 0 : 1,
      itemStyle: { color: n.type === "process" ? theme.cyan : theme.purple },
      label: { show: true, fontSize: 10, color: theme.text,
        formatter: `{b}\n{n.syscallCount} calls` },
    }));

    const graphLinks = edges.map((e) => ({
      source: String(e.source),
      target: String(e.target),
      lineStyle: {
        color: e.type === "fork" ? theme.green :
               e.type === "pipe" ? theme.amber :
               e.type === "signal" ? theme.red : theme.textTer,
        width: Math.max(1, Math.min(4, e.count)),
        curveness: 0.2,
      },
      label: { show: true, formatter: `${e.type}(${e.count})`, fontSize: 8,
        color: theme.textSec },
    }));

    return {
      tooltip: {
        formatter: (p: any) => {
          const n = nodes.find(nn => String(nn.id) === p.data?.id);
          return n ? `${n.name}<br/>类型: ${n.type}<br/>调用: ${n.syscallCount}` : p.name;
        },
      },
      legend: {
        data: ["进程", "线程"],
        bottom: 0,
        textStyle: { fontSize: 10, color: theme.textTer },
      },
      series: [{
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        force: { repulsion: 250, edgeLength: [60, 200], gravity: 0.08 },
        categories: [
          { name: "进程", itemStyle: { color: theme.cyan } },
          { name: "线程", itemStyle: { color: theme.purple } },
        ],
        data: graphNodes,
        links: graphLinks,
        emphasis: { focus: "adjacency", lineStyle: { width: 4 } },
      }],
    };
  }, [nodes, edges, theme]);

  const stats = useMemo(() => ({
    processes: nodes.filter(n => n.type === "process").length,
    threads: nodes.filter(n => n.type === "thread").length,
    ipc: edges.length,
    forks: edges.filter(e => e.type === "fork" || e.type === "clone").length,
  }), [nodes, edges]);

  if (traces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-[var(--kt-text-tertiary)] text-xs space-y-2">
        <Network className="size-8 opacity-30" />
        <p>暂无追踪数据用于构建进程拓扑</p>
        <p className="text-[10px]">提交代码并运行后可自动发现进程/线程关系</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="进程数" value={stats.processes} color={theme.cyan} icon={GitFork} />
        <StatCard label="线程数" value={stats.threads} color={theme.purple} icon={Share2} />
        <StatCard label="IPC 关系" value={stats.ipc} color={theme.amber} icon={ArrowUpRight} />
        <StatCard label="fork 事件" value={stats.forks} color={theme.green} icon={Network} />
      </div>

      {/* Graph */}
      <div className="border border-[var(--kt-border)] rounded-lg bg-[var(--kt-bg-card)] p-3">
        <h4 className="text-[11px] font-semibold text-[var(--kt-text)] mb-2 flex items-center gap-1.5">
          <Network className="size-3 text-[var(--kt-cyan)]" />
          进程/线程拓扑图
          <span className="text-[var(--kt-text-tertiary)] font-normal text-[10px]">
            · eBPF 自动发现 · 拖拽节点 · 滚轮缩放
          </span>
        </h4>
        <div ref={graphRef} className="h-[400px]" />
      </div>

      {/* Legend */}
      <div className="grid grid-cols-4 gap-2 text-[10px] text-[var(--kt-text-tertiary)]">
        <div className="flex items-center gap-1.5">
          <div className="size-3 rounded-full" style={{ background: theme.cyan }} /> 进程节点
        </div>
        <div className="flex items-center gap-1.5">
          <div className="size-3 rounded-full" style={{ background: theme.purple }} /> 线程节点
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-0 border-t-2" style={{ borderColor: theme.green }} /> fork/clone
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-0 border-t-2" style={{ borderColor: theme.amber }} /> pipe IPC
        </div>
      </div>

      {/* Process list */}
      <div className="border border-[var(--kt-border)] rounded-lg bg-[var(--kt-bg-card)] overflow-hidden">
        <h4 className="text-[11px] font-semibold text-[var(--kt-text)] px-3 py-2 border-b border-[var(--kt-border)]">
          进程/线程列表
        </h4>
        <div className="max-h-[200px] overflow-y-auto">
          {nodes.map((n) => (
            <div key={n.id}
              className="flex items-center gap-3 px-3 py-1.5 border-b border-[var(--kt-border)]/30 text-[11px] hover:bg-[var(--kt-bg-hover)]">
              <span className="font-mono text-[var(--kt-cyan)] w-16">
                {n.type === "process" ? `PID=${n.pid}` : `TID=${n.tid}`}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                n.type === "process"
                  ? "bg-[var(--kt-cyan)]/10 text-[var(--kt-cyan)]"
                  : "bg-[var(--kt-purple)]/10 text-[var(--kt-purple)]"
              }`}>{n.type}</span>
              <span className="text-[var(--kt-text-secondary)] flex-1">{n.name}</span>
              <span className="text-[var(--kt-text-tertiary)]">{n.syscallCount} 次调用</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon: Icon }: {
  label: string; value: number; color: string; icon: any;
}) {
  return (
    <div className="border border-[var(--kt-border)] rounded-lg bg-[var(--kt-bg-card)] p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="size-3.5" style={{ color }} />
        <span className="text-[10px] text-[var(--kt-text-tertiary)]">{label}</span>
      </div>
      <div className="text-lg font-bold text-[var(--kt-text)] tabular-nums">{value}</div>
    </div>
  );
}

// ── Topology builder: parse syscall traces into process/thread graph ──
function buildTopology(traces: SyscallTrace[]): { nodes: ProcessNode[]; edges: ProcessEdge[] } {
  const pidMap = new Map<number, ProcessNode>();
  const tidMap = new Map<number, ProcessNode>();
  const edges: ProcessEdge[] = [];
  const edgeKeySet = new Set<string>();

  for (const t of traces) {
    const pid = t.pid || 0;
    const tid = t.tid || 0;

    // Track process
    if (pid > 0 && !pidMap.has(pid)) {
      pidMap.set(pid, { id: pid, pid, name: `PID=${pid}`, type: "process", syscallCount: 0 });
    }
    if (pid > 0) {
      const n = pidMap.get(pid)!;
      n.syscallCount++;
    }

    // Track thread (TID != PID means thread)
    if (tid > 0 && tid !== pid && !tidMap.has(tid)) {
      tidMap.set(tid, { id: tid, pid, tid, name: `TID=${tid}`, type: "thread", syscallCount: 0 });
    }
    if (tid > 0 && tid !== pid) {
      const n = tidMap.get(tid)!;
      n.syscallCount++;
      // Thread belongs to process
      const key = `thread_${pid}_${tid}`;
      if (!edgeKeySet.has(key)) {
        edgeKeySet.add(key);
        edges.push({ source: pid, target: tid, type: "clone", count: 1 });
      }
    }

    // Detect fork/clone: return value > 0 means child PID created
    if ((t.syscall_name === "clone" || t.syscall_name === "fork") && (t.return_value ?? 0) > 0) {
      const childPid = t.return_value!;
      if (!pidMap.has(childPid)) {
        pidMap.set(childPid, { id: childPid, pid: childPid, name: `PID=${childPid}`, type: "process", syscallCount: 0 });
      }
      const key = `fork_${pid}_${childPid}`;
      if (!edgeKeySet.has(key)) {
        edgeKeySet.add(key);
        edges.push({ source: pid, target: childPid, type: "fork", count: 1 });
      }
    }

    // Detect pipe communication
    if (t.syscall_name === "pipe2" || t.syscall_name === "pipe") {
      // pipe creates fd pair used for IPC between parent and future child
      for (const [otherPid] of pidMap) {
        if (otherPid !== pid) {
          const key = `pipe_${pid}_${otherPid}`;
          if (!edgeKeySet.has(key)) {
            edgeKeySet.add(key);
            edges.push({ source: pid, target: otherPid, type: "pipe", count: 1 });
          }
        }
      }
    }
  }

  const nodes = [...pidMap.values(), ...tidMap.values()];
  return { nodes, edges };
}
