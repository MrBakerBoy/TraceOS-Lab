"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import WaterfallTimeline from "./WaterfallTimeline";
import MultiThreadLaneView from "./MultiThreadLaneView";
import SpanTreeView from "./SpanTreeView";
import ThreadStateView from "./ThreadStateView";
import SchedVisualizer from "./SchedVisualizer";
import RaceDetectionView from "./RaceDetectionView";
import { PanelHeader } from "@/components/ui/panel-header";
import ViewHelpButton from "@/components/ui/ViewHelpButton";
import { TABLE_HELP } from "@/lib/view-help-content";
import { SkeletonChart } from "@/components/ui/skeleton-card";
import { EmptyState } from "@/components/ui/empty-state";
import { motion, AnimatePresence } from "framer-motion";
import { GanttChart, Filter } from "lucide-react";

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

type ViewMode = "swimlane" | "spantree" | "threadstate" | "sched" | "waterfall" | "table";

const VIEW_TABS: { mode: ViewMode; emoji: string; label: string }[] = [
  { mode: "swimlane", emoji: "🏊", label: "泳道" },
  { mode: "spantree", emoji: "🌳", label: "Span树" },
  { mode: "threadstate", emoji: "📊", label: "状态" },
  { mode: "sched", emoji: "🔄", label: "调度" },
  { mode: "waterfall", emoji: "📉", label: "瀑布" },
  { mode: "table", emoji: "📋", label: "表格" },
];

export default function TraceViewer({ submissionId }: { submissionId: string }) {
  const [traces, setTraces] = useState<SyscallTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("swimlane");
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (!submissionId) return;
    setLoading(true);
    api.getSubmissionTraces(submissionId, { limit: 500, errors_only: errorsOnly })
      .then((res) => setTraces(res.traces || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [submissionId, errorsOnly]);

  const totalCalls = traces.length;
  const errorCalls = traces.filter((t) => t.error_name).length;
  const uniqueSyscalls = new Set(traces.map((t) => t.syscall_name)).size;
  const threadSet = new Set(traces.map((t) => t.tid ?? t.pid));

  const syscallCounts: Record<string, number> = {};
  traces.forEach((t) => {
    syscallCounts[t.syscall_name] = (syscallCounts[t.syscall_name] || 0) + 1;
  });
  const topSyscalls = Object.entries(syscallCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader icon={GanttChart} title="系统 Trace" subtitle="调用时间线" />
        <div className="flex-1 p-4">
          <SkeletonChart />
        </div>
      </div>
    );
  }

  if (traces.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader icon={GanttChart} title="系统 Trace" subtitle="调用时间线" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState variant="no-data" title="暂无系统调用追踪数据" description="提交代码并运行实验后，将在此展示系统调用时间线" />
        </div>
      </div>
    );
  }

  const badgeLabel = errorsOnly ? "ERR" : errorCalls > 0 ? "WARN" : "OK";
  const badgeVariant = errorsOnly ? "pulse" as const : errorCalls > 0 ? "solid" as const : "solid" as const;
  const badgeTone = errorsOnly ? "error" as const : errorCalls > 0 ? "warning" as const : "success" as const;

  const statsBar = (
    <div className="grid grid-cols-4 gap-3 px-4 pt-3">
      <Card padding="12px">
        <div className="text-center">
          <div className="text-2xl font-bold">{totalCalls}</div>
          <div className="text-xs text-[var(--text-tertiary)]">总调用</div>
        </div>
      </Card>
      <Card padding="12px">
        <div className="text-center">
          <div className="text-2xl font-bold">{threadSet.size}</div>
          <div className="text-xs text-[var(--text-tertiary)]">线程/进程</div>
        </div>
      </Card>
      <Card padding="12px">
        <div className="text-center">
          <div className="text-2xl font-bold text-red-500">{errorCalls}</div>
          <div className="text-xs text-[var(--text-tertiary)]">错误</div>
        </div>
      </Card>
      <Card padding="12px">
        <div className="text-center">
          <div className="text-2xl font-bold">
            {totalCalls > 0 ? ((errorCalls / totalCalls) * 100).toFixed(1) : 0}%
          </div>
          <div className="text-xs text-[var(--text-tertiary)]">错误率</div>
        </div>
      </Card>
    </div>
  );

  const tableContent = (
    <>
      <div className="flex justify-end px-4 pt-2"><ViewHelpButton content={TABLE_HELP} /></div>
    <div className="p-4 flex flex-col gap-4">
      {statsBar}
      <Card padding="16px">
        <h4 className="font-medium mb-2">Top 10 系统调用</h4>
        {topSyscalls.map(([name2, count]) => (
          <div key={name2} className="flex items-center gap-2 mb-1">
            <span className="w-24 text-sm font-mono truncate">{name2}</span>
            <div className="flex-1 bg-[var(--bg-input)] rounded-full h-4 overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] rounded-full"
                style={{ width: `${(count / topSyscalls[0][1]) * 100}%` }}
              />
            </div>
            <span className="text-xs text-[var(--text-tertiary)] w-10 text-right">{count}</span>
          </div>
        ))}
      </Card>
      <Card padding="16px">
        <div className="max-h-[400px] overflow-y-auto">
          <h4 className="font-medium mb-2">调用详情 (最近 {Math.min(100, traces.length)} 条)</h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="py-1 pr-2">TID</th>
                <th className="py-1 pr-2">系统调用</th>
                <th className="py-1 pr-2">返回值</th>
                <th className="py-1 pr-2">耗时</th>
                <th className="py-1">错误</th>
              </tr>
            </thead>
            <tbody>
              {traces.slice(0, 100).map((t, i) => (
                <tr key={i} className="border-b border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]">
                  <td className="py-1 pr-2 font-mono">{t.tid ?? t.pid}</td>
                  <td className="py-1 pr-2 font-mono">{t.syscall_name}</td>
                  <td className="py-1 pr-2 font-mono">{t.return_value}</td>
                  <td className="py-1 pr-2 font-mono">{(t.duration_ns / 1000).toFixed(1)}μs</td>
                  <td className="py-1">
                    {t.error_name ? (
                      <Badge>{t.error_name}</Badge>
                    ) : (
                      <span className="text-green-500">✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
    </>
  );

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        icon={GanttChart}
        title="系统 Trace"
        subtitle={`${totalCalls} 调用 · ${threadSet.size} 线程 · ${uniqueSyscalls} 种`}
        badge={{ label: badgeLabel, variant: badgeVariant, tone: badgeTone }}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-[var(--bg-card-hover)] rounded-md p-0.5">
              {VIEW_TABS.map((tab) => (
                <button
                  key={tab.mode}
                  onClick={() => setViewMode(tab.mode)}
                  className={`px-3 py-1 text-xs rounded font-medium transition-colors whitespace-nowrap ${
                    viewMode === tab.mode
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {tab.emoji} {tab.label}
                </button>
              ))}
            </div>
            {selectedRange && (
              <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                {selectedRange.start.toFixed(1)}ms-{selectedRange.end.toFixed(1)}ms
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => setErrorsOnly(!errorsOnly)}>
              <Filter className="w-3 h-3 mr-1" />
              {errorsOnly ? "显示全部" : "仅错误"}
            </Button>
          </div>
        }
      />
      <div className="flex-1 min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={viewMode}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {viewMode === "swimlane" ? (
              <MultiThreadLaneView traces={traces} />
            ) : viewMode === "spantree" ? (
              <SpanTreeView spanTree={null} />
            ) : viewMode === "threadstate" ? (
              <ThreadStateView traces={traces} />
            ) : viewMode === "sched" ? (
              <SchedVisualizer />
            ) : viewMode === "waterfall" ? (
              <div className="flex flex-col h-full">
                {statsBar}
                <WaterfallTimeline traces={traces} />
              </div>
            ) : (
              tableContent
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
