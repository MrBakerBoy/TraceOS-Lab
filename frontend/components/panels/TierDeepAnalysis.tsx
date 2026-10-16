'use client';

import React from 'react';
import { useWorkspaceStore } from '@/stores/workspace';
import type { DockTool } from '@/stores/workspace';
import {
  Activity, AlertTriangle, Bug, Cpu, Flame,
  GitBranch, Layers, Search, Zap,
  TrendingUp, TrendingDown, Info,
  ExternalLink, ArrowRight
} from 'lucide-react';

/**
 * TierDeepAnalysis — Tier 2 (深度分析) of the TraceOS three-tier observability system.
 *
 * Shows process-level deep analysis: flamegraph hotspots, syscall traces,
 * lock contention, memory snapshots, resource metrics, and perf events.
 * Provides drill-down links to specific dock tools.
 */
export default function TierDeepAnalysis() {
  const obsContext = useWorkspaceStore((s) => s.obsContext);
  const setTier = useWorkspaceStore((s) => s.setTier);
  const setActiveDockTool = useWorkspaceStore((s) => s.setActiveDockTool);

  if (!obsContext) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        暂无观测数据。提交实验代码后将自动生成深度分析。
      </div>
    );
  }

  const {
    anomaly_summary, process_graph, flamegraph,
    syscall_traces, memory_snapshots, lock_events,
    resource_metrics, perf_events
  } = obsContext;

  const openTool = (tool: DockTool) => {
    setActiveDockTool(tool);
  };

  return (
    <div className="tier-deep-analysis space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-[var(--kt-cyan)]" />
          <h3 className="text-sm font-semibold text-[var(--kt-text)]">深度分析</h3>
          <span className="text-[10px] text-[var(--kt-text-tertiary)] bg-[var(--kt-bg-elevated)] px-1.5 py-0.5 rounded">
            进程 / 资源 / 锁
          </span>
        </div>
      </div>

      {/* Row: Anomaly drill-down */}
      {anomaly_summary && anomaly_summary.length > 0 && (
        <AnomalyDrillDown
          anomalies={anomaly_summary}
          onOpenTool={openTool}
          onDrillDown={(panel) => {
            setTier(3);
            // Also try to open relevant dock tool
            const toolMap: Record<string, DockTool> = {
              'diagnosis': 'diagnosis', 'audit': 'audit',
              'flamegraph': 'flamegraph', 'trace': 'trace',
              'ebpf': 'ebpf', 'memory3d': 'memory3d'
            };
            const tool = toolMap[panel];
            if (tool) openTool(tool);
          }}
        />
      )}

      {/* Row: Process Graph + Flamegraph Hotspots + Lock Summary */}
      <div className="grid grid-cols-2 gap-3">
        <ProcessGraphCard graph={process_graph} />
        <FlameHotspotsCard flamegraph={flamegraph} onOpenTool={() => openTool('flamegraph')} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SyscallStatsCard traces={syscall_traces} onOpenTool={() => openTool('trace')} />
        <LockSummaryCard lockEvents={lock_events} onOpenTool={() => openTool('diagnosis')} />
      </div>

      {/* Row: Memory + Resources */}
      <div className="grid grid-cols-2 gap-3">
        <MemorySummaryCard snapshots={memory_snapshots} onOpenTool={() => openTool('memory3d')} />
        <ResourceSummaryCard metrics={resource_metrics} onOpenTool={() => openTool('resources')} />
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 pt-1">
        <QuickAction icon={<StethoscopeIcon />} label="AI 诊断" onClick={() => openTool('diagnosis')} />
        <QuickAction icon={<SearchIcon />} label="代码审计" onClick={() => openTool('audit')} />
        <QuickAction icon={<GitBranchIcon />} label="系统 Trace" onClick={() => openTool('trace')} />
        <QuickAction icon={<FlameIcon />} label="火焰图" onClick={() => openTool('flamegraph')} />
      </div>
    </div>
  );
}

// ── Anomaly Drill-Down ──

function AnomalyDrillDown({ anomalies, onOpenTool, onDrillDown }: {
  anomalies: any[];
  onOpenTool: (tool: DockTool) => void;
  onDrillDown: (panel: string) => void;
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-4 py-2 bg-[var(--kt-bg-elevated)] border-b flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-[var(--kt-amber)]" />
        <span className="text-sm font-medium">异常详情 ({anomalies.length}个) — 点击展开到 Tier 3</span>
      </div>
      <div className="divide-y">
        {anomalies.map((a, i) => (
          <button
            key={i}
            onClick={() => onDrillDown(a.link_to_tier2_panel)}
            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left group"
          >
            <SeverityIcon severity={a.severity} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{a.summary}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {a.type} · 点击进入 Tier 3 函数调试
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Process Graph Card ──

function ProcessGraphCard({ graph }: { graph: any }) {
  if (!graph?.nodes || graph.nodes.length === 0) {
    return (
      <div className="rounded-lg border p-4">
        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" /> 进程拓扑
        </div>
        <div className="text-xs text-muted-foreground">暂无进程数据</div>
      </div>
    );
  }

  const meta = graph.metadata || {};
  const processes = graph.nodes.filter((n: any) => n.type === 'process');
  const threads = graph.nodes.filter((n: any) => n.type === 'thread');
  const edges = graph.edges || [];

  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5 text-[var(--kt-cyan)]" /> 进程拓扑
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <StatBox label="进程" value={processes.length} color="var(--kt-cyan)" />
        <StatBox label="线程" value={threads.length} color="var(--kt-purple)" />
        <StatBox label="IPC 边" value={edges.length} color="var(--kt-amber)" />
      </div>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {processes.slice(0, 5).map((p: any) => (
          <div key={p.id} className="flex items-center justify-between text-[11px]">
            <span className="font-mono text-[var(--kt-text)] truncate">{p.name || `PID ${p.pid}`}</span>
            <span className="text-[var(--kt-text-tertiary)]">
              {p.syscall_count} 次调用 · {p.error_count > 0 ? (
                <span className="text-[var(--kt-red)]">{p.error_count} 错误</span>
              ) : '0 错误'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Flame Hotspots Card ──

function FlameHotspotsCard({ flamegraph, onOpenTool }: { flamegraph: any; onOpenTool: () => void }) {
  const hotFunctions = flamegraph?.hot_functions || [];

  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-[var(--kt-orange)]" /> 热点函数
        </span>
        {hotFunctions.length > 0 && (
          <button onClick={onOpenTool} className="text-[10px] text-[var(--kt-cyan)] hover:underline flex items-center gap-1">
            完整火焰图 <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>
      {hotFunctions.length === 0 ? (
        <div className="text-xs text-muted-foreground">暂无火焰图数据</div>
      ) : (
        <div className="space-y-1.5 max-h-32 overflow-y-auto">
          {hotFunctions.slice(0, 6).map((f: any, i: number) => (
            <div key={i} className="flex items-center justify-between text-[11px]">
              <span className="font-mono text-[var(--kt-text)] truncate flex-1 mr-2">{f.name}</span>
              <span className="text-[var(--kt-text-tertiary)] flex-shrink-0">
                {f.percentage.toFixed(1)}%
              </span>
              <div className="w-16 h-1.5 bg-[var(--kt-bg-elevated)] rounded-full ml-2 flex-shrink-0">
                <div
                  className="h-full rounded-full bg-[var(--kt-orange)]"
                  style={{ width: `${Math.min(f.percentage, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Syscall Stats Card ──

function SyscallStatsCard({ traces, onOpenTool }: { traces: any[]; onOpenTool: () => void }) {
  if (!traces || traces.length === 0) {
    return (
      <div className="rounded-lg border p-4">
        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" /> 系统调用统计
        </div>
        <div className="text-xs text-muted-foreground">暂无调用数据</div>
      </div>
    );
  }

  // Aggregate by syscall name
  const counts: Record<string, { count: number; errors: number; totalDuration: number }> = {};
  for (const t of traces) {
    const name = t.syscall || 'unknown';
    if (!counts[name]) counts[name] = { count: 0, errors: 0, totalDuration: 0 };
    counts[name].count++;
    if (t.error_code || t.error_name) counts[name].errors++;
    counts[name].totalDuration += t.duration_ns || 0;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1].count - a[1].count);
  const total = traces.length;
  const totalErrors = traces.filter((t) => t.error_code || t.error_name).length;

  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-[var(--kt-green)]" /> 系统调用
        </span>
        <button onClick={onOpenTool} className="text-[10px] text-[var(--kt-cyan)] hover:underline flex items-center gap-1">
          完整 Trace <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <StatBox label="总调用" value={total} color="var(--kt-green)" />
        <StatBox label="错误" value={totalErrors} color={totalErrors > 0 ? 'var(--kt-red)' : 'var(--kt-green)'} />
        <StatBox label="种类" value={sorted.length} color="var(--kt-cyan)" />
      </div>
      <div className="space-y-1 max-h-24 overflow-y-auto">
        {sorted.slice(0, 5).map(([name, stats]) => (
          <div key={name} className="flex items-center justify-between text-[11px]">
            <span className="font-mono text-[var(--kt-text)] truncate">{name}</span>
            <span className="text-[var(--kt-text-tertiary)]">
              {stats.count}次
              {stats.errors > 0 && (
                <span className="text-[var(--kt-red)] ml-1">({stats.errors}错)</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Lock Summary Card ──

function LockSummaryCard({ lockEvents, onOpenTool }: { lockEvents: any[]; onOpenTool: () => void }) {
  if (!lockEvents || lockEvents.length === 0) {
    return (
      <div className="rounded-lg border p-4">
        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
          <Bug className="w-3.5 h-3.5" /> 锁分析
        </div>
        <div className="text-xs text-muted-foreground">未检测到锁事件</div>
      </div>
    );
  }

  const lockOps = lockEvents.filter((l: any) => l.op === 'lock');
  const unlockOps = lockEvents.filter((l: any) => l.op === 'unlock');
  const trylockOps = lockEvents.filter((l: any) => l.op === 'trylock');
  const waitEvents = lockEvents.filter((l: any) => l.wait_duration_ns && l.wait_duration_ns > 0);
  const maxWait = waitEvents.length > 0
    ? Math.max(...waitEvents.map((l: any) => l.wait_duration_ns))
    : 0;

  const hasContention = waitEvents.length > 2;

  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Bug className={`w-3.5 h-3.5 ${hasContention ? 'text-[var(--kt-red)]' : 'text-[var(--kt-green)]'}`} /> 锁分析
        </span>
        <button onClick={onOpenTool} className="text-[10px] text-[var(--kt-cyan)] hover:underline flex items-center gap-1">
          AI 诊断 <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2 mb-2">
        <StatBox label="加锁" value={lockOps.length} color="var(--kt-amber)" />
        <StatBox label="解锁" value={unlockOps.length} color="var(--kt-green)" />
        <StatBox label="尝试" value={trylockOps.length} color="var(--kt-cyan)" />
        <StatBox label="等待" value={waitEvents.length} color={hasContention ? 'var(--kt-red)' : 'var(--kt-green)'} />
      </div>
      {hasContention && (
        <div className="text-[11px] text-[var(--kt-red)] bg-[var(--kt-red)]/5 rounded px-2 py-1">
          ⚠️ 检测到锁竞争 — 最长等待 {(maxWait / 1e6).toFixed(1)}ms, {waitEvents.length}次等待事件
        </div>
      )}
      {!hasContention && lockEvents.length > 0 && (
        <div className="text-[11px] text-[var(--kt-green)] bg-[var(--kt-green)]/5 rounded px-2 py-1">
          ✓ 锁操作正常，未检测到明显竞争
        </div>
      )}
    </div>
  );
}

// ── Memory Summary Card ──

function MemorySummaryCard({ snapshots, onOpenTool }: { snapshots: any[]; onOpenTool: () => void }) {
  if (!snapshots || snapshots.length === 0) {
    return (
      <div className="rounded-lg border p-4">
        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5" /> 内存快照
        </div>
        <div className="text-xs text-muted-foreground">暂无内存数据</div>
      </div>
    );
  }

  const latest = snapshots[snapshots.length - 1];
  const heapMB = ((latest.heap_size || 0) / (1024 * 1024)).toFixed(1);
  const stackMB = ((latest.stack_size || 0) / (1024 * 1024)).toFixed(1);
  const mmapMB = ((latest.mmap_total || 0) / (1024 * 1024)).toFixed(1);
  const totalMB = (parseFloat(heapMB) + parseFloat(stackMB) + parseFloat(mmapMB)).toFixed(1);

  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-[var(--kt-purple)]" /> 内存快照
        </span>
        <button onClick={onOpenTool} className="text-[10px] text-[var(--kt-cyan)] hover:underline flex items-center gap-1">
          内存3D <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <StatBox label="堆" value={`${heapMB}MB`} color="var(--kt-purple)" />
        <StatBox label="栈" value={`${stackMB}MB`} color="var(--kt-cyan)" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatBox label="mmap" value={`${mmapMB}MB`} color="var(--kt-amber)" />
        <StatBox label="总计" value={`${totalMB}MB`} color="var(--kt-text)" />
      </div>
    </div>
  );
}

// ── Resource Summary Card ──

function ResourceSummaryCard({ metrics, onOpenTool }: { metrics: any[]; onOpenTool: () => void }) {
  if (!metrics || metrics.length === 0) {
    return (
      <div className="rounded-lg border p-4">
        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" /> 资源指标
        </div>
        <div className="text-xs text-muted-foreground">暂无资源数据</div>
      </div>
    );
  }

  const latest = metrics[metrics.length - 1];
  const cpuColor = (latest.cpu_percent || 0) > 80 ? 'var(--kt-red)' :
    (latest.cpu_percent || 0) > 60 ? 'var(--kt-amber)' : 'var(--kt-green)';
  const memColor = (latest.mem_rss || 0) > 0.8 * (latest.mem_virtual || 1) ? 'var(--kt-red)' : 'var(--kt-green)';

  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-[var(--kt-amber)]" /> 资源指标
        </span>
        <button onClick={onOpenTool} className="text-[10px] text-[var(--kt-cyan)] hover:underline flex items-center gap-1">
          资源监控 <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <StatBox label="CPU" value={`${(latest.cpu_percent || 0).toFixed(0)}%`} color={cpuColor} />
        <StatBox label="线程" value={latest.thread_count || 0} color="var(--kt-cyan)" />
        <StatBox label="FD" value={latest.fd_count || 0} color="var(--kt-amber)" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatBox label="上下文切换" value={latest.context_switches || 0} color="var(--kt-text-tertiary)" />
        <StatBox label="缺页" value={latest.page_fault_min || 0} color="var(--kt-text-tertiary)" />
      </div>
    </div>
  );
}

// ── Helpers ──

function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-[var(--kt-bg-elevated)] rounded px-2 py-1.5 text-center">
      <div className="text-[10px] text-[var(--kt-text-tertiary)]">{label}</div>
      <div className="text-sm font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
        bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)]
        hover:border-[var(--kt-cyan)] hover:bg-[var(--kt-cyan)]/10
        text-[var(--kt-text-secondary)] hover:text-[var(--kt-cyan)]
        transition-all duration-200"
    >
      {icon}
      {label}
    </button>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case 'critical':
      return <Zap className="w-4 h-4 text-red-500 flex-shrink-0" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />;
    default:
      return <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />;
  }
}

// Inline SVG icons for QuickActions to avoid re-imports
function StethoscopeIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
      <path d="M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4" />
      <circle cx="20" cy="10" r="2" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function GitBranchIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

