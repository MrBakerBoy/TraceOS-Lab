'use client';

import React from 'react';
import { useWorkspaceStore } from '@/stores/workspace';
import type { DockTool } from '@/stores/workspace';
import {
  Bug, GitBranch, AlertTriangle, Zap, Box,
  Activity, Search, ArrowRight, Info,
  ExternalLink, Flame, Code, Cpu
} from 'lucide-react';

/**
 * TierFunctionDebug — Tier 3 (函数调试) of the TraceOS three-tier observability system.
 *
 * Shows function-level debugging data: call chains, race reports,
 * deadlock evolution, leak reports, source annotations, and span trees.
 * Provides drill-down links to debug dock tools.
 */
export default function TierFunctionDebug() {
  const obsContext = useWorkspaceStore((s) => s.obsContext);
  const setActiveDockTool = useWorkspaceStore((s) => s.setActiveDockTool);

  if (!obsContext) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        暂无观测数据。提交实验代码后将自动生成函数调试分析。
      </div>
    );
  }

  const {
    call_chains, source_annotations, race_reports,
    deadlock_evolution, leak_reports, span_tree,
    flamegraph_diff1, flamegraph_diff2,
    io_flamegraph, mem_alloc_flamegraph, lock_contention_fg
  } = obsContext;

  const openTool = (tool: DockTool) => {
    setActiveDockTool(tool);
  };

  const hasDiffFlamegraph = !!(flamegraph_diff1 && flamegraph_diff2);
  const hasSubFlamegraphs = !!(io_flamegraph || mem_alloc_flamegraph || lock_contention_fg);
  const hasCriticalIssue = (race_reports?.length || 0) > 0 ||
    (deadlock_evolution?.steps?.length || 0) > 0 ||
    (leak_reports?.length || 0) > 0;

  return (
    <div className="tier-function-debug space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bug className="w-4 h-4 text-[var(--kt-red)]" />
          <h3 className="text-sm font-semibold text-[var(--kt-text)]">函数调试</h3>
          <span className="text-[10px] text-[var(--kt-text-tertiary)] bg-[var(--kt-bg-elevated)] px-1.5 py-0.5 rounded">
            火焰图 / 源码 / 竞态
          </span>
        </div>
        {hasCriticalIssue && (
          <span className="text-[10px] text-[var(--kt-red)] bg-[var(--kt-red)]/10 px-2 py-0.5 rounded-full font-medium">
            ⚠ 存在关键问题
          </span>
        )}
      </div>

      {/* Critical Issues Section */}
      {hasCriticalIssue && (
        <div className="space-y-3">
          {race_reports && race_reports.length > 0 && (
            <RaceReportsCard reports={race_reports} onOpenTool={() => openTool('trace')} />
          )}
          {deadlock_evolution?.steps && deadlock_evolution.steps.length > 0 && (
            <DeadlockCard evolution={deadlock_evolution} onOpenTool={() => openTool('diagnosis')} />
          )}
          {leak_reports && leak_reports.length > 0 && (
            <LeakReportsCard reports={leak_reports} onOpenTool={() => openTool('memory3d')} />
          )}
        </div>
      )}

      {/* Call Chains */}
      {call_chains && call_chains.length > 0 && (
        <CallChainsCard chains={call_chains} onOpenTool={() => openTool('flamegraph')} />
      )}

      {/* Source Annotations */}
      {source_annotations && source_annotations.length > 0 && (
        <SourceAnnotationsCard annotations={source_annotations} onOpenTool={() => openTool('audit')} />
      )}

      {/* Flamegraph diffs */}
      {(hasDiffFlamegraph || hasSubFlamegraphs) && (
        <FlamegraphDiffCard
          diff1={flamegraph_diff1}
          diff2={flamegraph_diff2}
          ioFG={io_flamegraph}
          memFG={mem_alloc_flamegraph}
          lockFG={lock_contention_fg}
          onOpenTool={() => openTool('flamegraph')}
        />
      )}

      {/* Span Tree */}
      {span_tree && (
        <SpanTreeCard tree={span_tree} onOpenTool={() => openTool('trace')} />
      )}

      {/* Empty state */}
      {!hasCriticalIssue && (!call_chains || call_chains.length === 0) &&
        (!source_annotations || source_annotations.length === 0) && !hasDiffFlamegraph && !span_tree && (
        <div className="rounded-lg border p-4 flex items-center gap-3">
          <Info className="w-5 h-5 text-[var(--kt-cyan)]" />
          <div>
            <div className="text-sm font-medium">暂无深度调试数据</div>
            <div className="text-xs text-muted-foreground">程序运行正常，未检测到函数级异常</div>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex gap-2 pt-1">
        <QuickAction icon={<FlameIcon />} label="火焰图" onClick={() => openTool('flamegraph')} />
        <QuickAction icon={<SearchIcon />} label="代码审计" onClick={() => openTool('audit')} />
        <QuickAction icon={<GitBranchIcon />} label="Trace" onClick={() => openTool('trace')} />
        <QuickAction icon={<BoxIcon />} label="内存3D" onClick={() => openTool('memory3d')} />
        <QuickAction icon={<ActivityIcon />} label="eBPF" onClick={() => openTool('ebpf')} />
      </div>
    </div>
  );
}

// ── Race Reports ──

function RaceReportsCard({ reports, onOpenTool }: { reports: any[]; onOpenTool: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--kt-red)]/30 overflow-hidden">
      <div className="px-4 py-2 bg-[var(--kt-red)]/5 border-b border-[var(--kt-border)] flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-[var(--kt-red)]" />
        <span className="text-sm font-medium">数据竞态检测 ({reports.length}处)</span>
      </div>
      <div className="divide-y max-h-48 overflow-y-auto">
        {reports.slice(0, 5).map((r: any, i: number) => (
          <div key={i} className="px-4 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-[var(--kt-text)]">{r.description}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  线程 {r.thread1} ↔ 线程 {r.thread2}
                  {r.has_happens_before && <span className="text-[var(--kt-amber)] ml-1">· happens-before 检测</span>}
                </div>
                {(r.source_file1 || r.source_file2) && (
                  <div className="text-[10px] font-mono text-[var(--kt-cyan)] mt-0.5 truncate">
                    {r.source_file1}:{r.source_line1} · {r.source_file2}:{r.source_line2}
                  </div>
                )}
              </div>
            </div>
            {r.teaching_hint && (
              <div className="text-[10px] text-[var(--kt-purple)] mt-1 bg-[var(--kt-purple)]/5 rounded px-2 py-0.5">
                💡 {r.teaching_hint}
              </div>
            )}
          </div>
        ))}
      </div>
      {reports.length > 5 && (
        <div className="px-4 py-1.5 text-[10px] text-[var(--kt-text-tertiary)] border-t border-[var(--kt-border)]">
          还有 {reports.length - 5} 处未显示...
        </div>
      )}
    </div>
  );
}

// ── Deadlock Evolution ──

function DeadlockCard({ evolution, onOpenTool }: { evolution: any; onOpenTool: () => void }) {
  const steps = evolution.steps || [];
  const conditions = evolution.coffman_conditions || {};
  const conditionCount = Object.values(conditions).filter(Boolean).length;

  return (
    <div className="rounded-lg border border-[var(--kt-red)]/30 overflow-hidden">
      <div className="px-4 py-2 bg-[var(--kt-red)]/5 border-b border-[var(--kt-border)] flex items-center gap-2">
        <Zap className="w-4 h-4 text-[var(--kt-red)]" />
        <span className="text-sm font-medium">死锁演化</span>
        {evolution.cycle_info && (
          <span className="text-[10px] text-[var(--kt-text-tertiary)] truncate ml-2">{evolution.cycle_info}</span>
        )}
      </div>
      {/* Coffman conditions */}
      <div className="px-4 py-2 border-b border-[var(--kt-border)] flex items-center gap-3">
        <span className="text-[10px] text-muted-foreground">Coffman:</span>
        {Object.entries(conditions).map(([k, v]) => (
          <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            v ? 'bg-[var(--kt-red)]/10 text-[var(--kt-red)]' : 'bg-muted text-muted-foreground'
          }`}>
            {k}: {v ? '✓' : '✗'}
          </span>
        ))}
        <span className="text-[10px] text-[var(--kt-amber)] ml-auto">{conditionCount}/4 满足</span>
      </div>
      {/* Steps */}
      <div className="divide-y max-h-40 overflow-y-auto">
        {steps.map((s: any, i: number) => (
          <div key={i} className="px-4 py-2 flex items-center gap-3 text-xs">
            <span className="text-[10px] text-muted-foreground w-6">#{s.order}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
              s.action === 'lock' ? 'bg-[var(--kt-amber)]/10 text-[var(--kt-amber)]' :
              s.action === 'unlock' ? 'bg-[var(--kt-green)]/10 text-[var(--kt-green)]' :
              'bg-[var(--kt-red)]/10 text-[var(--kt-red)]'
            }`}>{s.action}</span>
            <span className="font-mono text-[11px]">T{s.tid}</span>
            <span className="text-muted-foreground truncate">{s.description}</span>
            <span className="text-[10px] text-muted-foreground ml-auto">{new Date(s.timestamp).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Leak Reports ──

function LeakReportsCard({ reports, onOpenTool }: { reports: any[]; onOpenTool: () => void }) {
  const definitely = reports.filter((r: any) => r.severity === 'definitely');
  const indirectly = reports.filter((r: any) => r.severity === 'indirectly');
  const totalLeaked = reports.reduce((sum: number, r: any) => sum + (r.size || 0), 0);

  return (
    <div className="rounded-lg border border-[var(--kt-red)]/30 overflow-hidden">
      <div className="px-4 py-2 bg-[var(--kt-red)]/5 border-b border-[var(--kt-border)] flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-[var(--kt-red)]" />
        <span className="text-sm font-medium">内存泄漏 ({reports.length}处)</span>
        <span className="text-[10px] text-[var(--kt-text-tertiary)]">
          总计 {(totalLeaked / 1024).toFixed(1)}KB
        </span>
      </div>
      <div className="grid grid-cols-2 gap-0">
        <div className="px-4 py-2 border-r border-b border-[var(--kt-border)]">
          <div className="text-[10px] text-muted-foreground">确认泄漏</div>
          <div className="text-lg font-bold text-[var(--kt-red)]">{definitely.length}</div>
        </div>
        <div className="px-4 py-2 border-b border-[var(--kt-border)]">
          <div className="text-[10px] text-muted-foreground">间接泄漏</div>
          <div className="text-lg font-bold text-[var(--kt-amber)]">{indirectly.length}</div>
        </div>
      </div>
      <div className="divide-y max-h-40 overflow-y-auto">
        {reports.slice(0, 5).map((r: any, i: number) => (
          <div key={i} className="px-4 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-[var(--kt-text)]">{r.description}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {(r.size / 1024).toFixed(1)}KB · {r.source_file}:{r.source_line}
                </div>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                r.severity === 'definitely' ? 'bg-[var(--kt-red)]/10 text-[var(--kt-red)]' :
                'bg-[var(--kt-amber)]/10 text-[var(--kt-amber)]'
              }`}>
                {r.severity === 'definitely' ? '确认' : '间接'}
              </span>
            </div>
            {r.fix_suggestion && (
              <div className="text-[10px] text-[var(--kt-green)] mt-1 bg-[var(--kt-green)]/5 rounded px-2 py-0.5">
                🔧 {r.fix_suggestion}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Call Chains ──

function CallChainsCard({ chains, onOpenTool }: { chains: any[]; onOpenTool: () => void }) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-4 py-2 bg-[var(--kt-bg-elevated)] border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-[var(--kt-cyan)]" />
          <span className="text-sm font-medium">调用链分析</span>
        </div>
        <button onClick={onOpenTool} className="text-[10px] text-[var(--kt-cyan)] hover:underline flex items-center gap-1">
          火焰图 <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className="divide-y max-h-48 overflow-y-auto">
        {chains.slice(0, 5).map((chain: any, i: number) => (
          <div key={i} className="px-4 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[var(--kt-text)]">{chain.root_call}</span>
              <span className="text-[10px] text-muted-foreground">
                总延迟 {(chain.total_latency_ns / 1e6).toFixed(2)}ms
              </span>
            </div>
            <div className="space-y-0.5">
              {(chain.chain || []).map((step: any, j: number) => (
                <div key={j} className="flex items-center gap-2 text-[10px]">
                  <span className="text-muted-foreground w-4 text-right">{j + 1}.</span>
                  <span className={`font-mono truncate ${step.is_kernel_space ? 'text-[var(--kt-amber)]' : 'text-[var(--kt-text)]'}`}>
                    {step.function}
                  </span>
                  <span className="text-muted-foreground ml-auto">
                    {(step.latency_ns / 1e6).toFixed(2)}ms
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Source Annotations ──

function SourceAnnotationsCard({ annotations, onOpenTool }: { annotations: any[]; onOpenTool: () => void }) {
  const byFile: Record<string, any[]> = {};
  for (const a of annotations) {
    const key = a.source_file || 'unknown';
    if (!byFile[key]) byFile[key] = [];
    byFile[key].push(a);
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-4 py-2 bg-[var(--kt-bg-elevated)] border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code className="w-4 h-4 text-[var(--kt-purple)]" />
          <span className="text-sm font-medium">源码标注 ({annotations.length}处)</span>
        </div>
        <button onClick={onOpenTool} className="text-[10px] text-[var(--kt-cyan)] hover:underline flex items-center gap-1">
          代码审计 <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className="divide-y max-h-48 overflow-y-auto">
        {Object.entries(byFile).map(([file, items]) => (
          <div key={file}>
            <div className="px-4 py-1 text-[10px] font-mono text-[var(--kt-cyan)] bg-[var(--kt-bg-elevated)]/50">
              {file}
            </div>
            {items.map((a: any, j: number) => (
              <div key={j} className="px-4 py-1.5 flex items-center gap-2 text-xs">
                <span className="text-[10px] text-muted-foreground w-8">L{a.line}</span>
                <SeverityLabel severity={a.severity} />
                <span className="text-[var(--kt-text)] truncate">{a.annotation}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Flamegraph Diff ──

function FlamegraphDiffCard({ diff1, diff2, ioFG, memFG, lockFG, onOpenTool }: {
  diff1: any; diff2: any; ioFG: any; memFG: any; lockFG: any; onOpenTool: () => void;
}) {
  const available = [
    { label: 'CPU 对比', data: diff1 && diff2, key: 'cpu-diff' },
    { label: 'I/O 火焰图', data: ioFG, key: 'io' },
    { label: '内存分配', data: memFG, key: 'mem' },
    { label: '锁竞争', data: lockFG, key: 'lock' },
  ].filter((f) => f.data);

  if (available.length === 0) return null;

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-4 py-2 bg-[var(--kt-bg-elevated)] border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-[var(--kt-orange)]" />
          <span className="text-sm font-medium">差异化火焰图</span>
        </div>
        <button onClick={onOpenTool} className="text-[10px] text-[var(--kt-cyan)] hover:underline flex items-center gap-1">
          完整火焰图 <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className="flex gap-2 px-4 py-2">
        {available.map((f) => (
          <div key={f.key} className="flex items-center gap-1.5 text-[10px] text-[var(--kt-text-tertiary)]
            bg-[var(--kt-bg-elevated)] rounded px-2 py-1 border border-[var(--kt-border)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--kt-cyan)]" />
            {f.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Span Tree ──

function SpanTreeCard({ tree, onOpenTool }: { tree: any; onOpenTool: () => void }) {
  const renderNode = (node: any, depth: number = 0) => {
    return (
      <div key={node.span_id} className="flex items-center gap-2 text-[11px] py-0.5"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}>
        <span className="font-mono text-[var(--kt-text)] truncate">{node.operation_name}</span>
        <span className="text-[var(--kt-text-tertiary)]">{node.duration_ms.toFixed(1)}ms</span>
        <span className="text-[var(--kt-text-tertiary)]">{node.syscall_count}次调用</span>
        {node.error_count > 0 && (
          <span className="text-[var(--kt-red)]">{node.error_count}错误</span>
        )}
        {node.children?.map((c: any) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-4 py-2 bg-[var(--kt-bg-elevated)] border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-[var(--kt-cyan)]" />
          <span className="text-sm font-medium">Span 调用树</span>
        </div>
        <button onClick={onOpenTool} className="text-[10px] text-[var(--kt-cyan)] hover:underline flex items-center gap-1">
          Trace <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className="py-1 max-h-48 overflow-y-auto">
        {renderNode(tree)}
      </div>
    </div>
  );
}

// ── Helpers ──

function SeverityLabel({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-[var(--kt-red)]/10 text-[var(--kt-red)]',
    warning: 'bg-[var(--kt-amber)]/10 text-[var(--kt-amber)]',
    info: 'bg-[var(--kt-cyan)]/10 text-[var(--kt-cyan)]',
  };
  const labels: Record<string, string> = {
    critical: '严重',
    warning: '警告',
    info: '提示',
  };
  return (
    <span className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${colors[severity] || colors.info}`}>
      {labels[severity] || severity}
    </span>
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

// Inline icons
function FlameIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function GitBranchIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}
function BoxIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
    </svg>
  );
}
function ActivityIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
    </svg>
  );
}

