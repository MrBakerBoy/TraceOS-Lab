"use client";

import React, { useState } from "react";
import { PanelHeader } from "@/components/ui/panel-header";
import ViewHelpButton from "@/components/ui/ViewHelpButton";
import { SPANTREE_HELP } from "@/lib/view-help-content";
import { ChevronRight, ChevronDown, Layers, Circle } from "lucide-react";

interface SpanTreeNode {
  span_id: string;
  parent_span_id?: string;
  operation_name: string;
  duration_ms: number;
  syscall_count: number;
  error_count: number;
  self_time_ms: number;
  tags?: Record<string, string>;
  children?: SpanTreeNode[];
}

const OPERATION_COLORS: Record<string, string> = {
  program_execution: "var(--kt-cyan)",
  fork_exec_workflow: "var(--kt-green)",
  parent_wait: "var(--kt-amber)",
  thread_create: "var(--kt-purple)",
  critical_section: "var(--kt-red)",
  malloc_workflow: "var(--kt-orange)",
  pipe_communication: "var(--kt-blue)",
  process_setup: "var(--kt-cyan)",
  thread_teardown: "var(--kt-red)",
  memory_protect: "var(--kt-orange)",
  signal_delivery: "var(--kt-pink)",
  shm_setup: "var(--kt-purple)",
};

function getColor(name: string): string {
  for (const [prefix, color] of Object.entries(OPERATION_COLORS)) {
    if (name.startsWith(prefix) || name.includes(prefix)) return color;
  }
  if (name.startsWith("syscall_")) return "var(--kt-text-tertiary)";
  return "var(--kt-text-secondary)";
}

function SpanRow({
  node,
  depth,
  maxDuration,
  totalDuration,
}: {
  node: SpanTreeNode;
  depth: number;
  maxDuration: number;
  totalDuration: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const color = getColor(node.operation_name);

  const barWidth = maxDuration > 0 ? (node.duration_ms / maxDuration) * 100 : 0;
  const selfWidth = maxDuration > 0 ? (node.self_time_ms / maxDuration) * 100 : 0;

  return (
    <>
      <div
        className="flex items-center gap-2 py-1.5 px-2 hover:bg-[var(--kt-bg-elevated)] rounded-sm cursor-pointer transition-colors group"
        style={{ paddingLeft: 12 + depth * 20 }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {/* expand icon */}
        <span className="w-4 flex-shrink-0">
          {hasChildren ? (
            expanded ? <ChevronDown size={14} className="text-[var(--kt-text-tertiary)]" /> : <ChevronRight size={14} className="text-[var(--kt-text-tertiary)]" />
          ) : (
            <Circle size={8} className="text-[var(--kt-text-tertiary)] ml-0.5" />
          )}
        </span>

        {/* name */}
        <span
          className="text-xs font-mono font-medium truncate min-w-0 flex-1"
          style={{ color }}
        >
          {node.operation_name}
        </span>

        {/* stats */}
        <span className="text-[10px] text-[var(--kt-text-tertiary)] font-mono tabular-nums whitespace-nowrap">
          {node.duration_ms >= 1
            ? `${node.duration_ms.toFixed(1)}ms`
            : `${(node.duration_ms * 1000).toFixed(0)}μs`}
        </span>

        {node.syscall_count > 1 && (
          <span className="text-[9px] text-[var(--kt-text-tertiary)] bg-[var(--kt-bg-tertiary)] px-1.5 py-0.5 rounded-full whitespace-nowrap">
            {node.syscall_count} call{node.syscall_count > 1 ? "s" : ""}
          </span>
        )}

        {node.error_count > 0 && (
          <span className="text-[9px] text-[var(--kt-red)] bg-[var(--kt-red-dim)] px-1.5 py-0.5 rounded-full whitespace-nowrap">
            {node.error_count} err
          </span>
        )}

        {/* duration bar */}
        <div className="hidden sm:block w-20 h-3 bg-[var(--kt-bg-tertiary)] rounded-full overflow-hidden flex-shrink-0 relative">
          <div className="absolute inset-y-0 left-0 rounded-full opacity-60" style={{ width: `${barWidth}%`, backgroundColor: color }} />
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${selfWidth}%`, backgroundColor: color }} />
        </div>
      </div>

      {expanded && hasChildren &&
        node.children!.map((child) => (
          <SpanRow
            key={child.span_id}
            node={child}
            depth={depth + 1}
            maxDuration={maxDuration}
            totalDuration={totalDuration}
          />
        ))}
    </>
  );
}

export default function SpanTreeView({ spanTree }: { spanTree?: SpanTreeNode | null }) {
  if (!spanTree) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader icon={Layers} title="Span 层级树" subtitle="Jaeger 风格" />
        <div className="flex-1 flex items-center justify-center text-[var(--kt-text-tertiary)] text-sm">
          暂无 Span 数据
        </div>
      </div>
    );
  }

  const allDurations = collectDurations(spanTree);
  const maxDuration = Math.max(...allDurations, 1);
  const totalDuration = spanTree.duration_ms || 1;

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        icon={Layers}
        title="Span 层级树"
        subtitle={`${countNodes(spanTree)} spans · ${spanTree.syscall_count} syscalls`}
        actions={<ViewHelpButton content={SPANTREE_HELP} />}
      />

      {/* Legend */}
      <div className="px-4 py-1.5 flex items-center gap-3 text-[10px] text-[var(--kt-text-tertiary)]">
        <span>■ 总耗时</span>
        <span>□ 自耗时(self)</span>
        <span className="flex-1" />
        <span>点击展开/折叠 · 共 {countErrors(spanTree)} 错误</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <SpanRow node={spanTree} depth={0} maxDuration={maxDuration} totalDuration={totalDuration} />
      </div>
    </div>
  );
}

function collectDurations(node: SpanTreeNode): number[] {
  const durs = [node.duration_ms];
  if (node.children) {
    for (const c of node.children) durs.push(...collectDurations(c));
  }
  return durs;
}

function countNodes(node: SpanTreeNode): number {
  let n = 1;
  if (node.children) for (const c of node.children) n += countNodes(c);
  return n;
}

function countErrors(node: SpanTreeNode): number {
  let e = node.error_count;
  if (node.children) for (const c of node.children) e += countErrors(c);
  return e;
}
