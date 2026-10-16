"use client";

import React, { useMemo } from "react";
import { MemoryStick, AlertTriangle, TrendingUp, HardDrive } from "lucide-react";
import * as echarts from "echarts";
import { useLeakReport, useMemoryTrend, useAllocFlamegraph } from "@/hooks/useEbpfData";
import { useEChart } from "@/hooks/useEChart";
import { useEbpfChartTheme, severityColor } from "@/hooks/useEbpfChartTheme";
import { MetricCard } from "@/components/ebpf/shared/MetricCard";
import { EmptyState } from "@/components/ebpf/shared/EmptyState";
import { AIAskButton } from "@/components/ebpf/shared/AIAskButton";
import { Skeleton } from "@/components/ui/skeleton";
import type { LeakSeverity, LeakResult } from "@/types/ebpf";

interface Props {
  submissionId: string;
  experimentId: string;
}

const SEVERITY_LABELS: Record<LeakSeverity, string> = {
  definitely: "确定泄漏",
  indirectly: "间接泄漏",
  possibly:   "可能泄漏",
  reachable:  "仍可访问",
};

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function MemoryAnalysisTab({ submissionId, experimentId }: Props) {
  const { data: leak, loading: leakLoading, error: leakError } = useLeakReport(submissionId);
  const { data: trend, loading: trendLoading } = useMemoryTrend(submissionId);
  const { data: flamegraph, loading: fgLoading } = useAllocFlamegraph(submissionId);
  const chartTheme = useEbpfChartTheme();

  const loading = leakLoading || trendLoading || fgLoading;
  const error = leakError;

  // ── Heap trend chart ──
  const heapTrendOption = useMemo(() => {
    if (!trend?.heap_timeline || trend.heap_timeline.length === 0) return null;
    const points = trend.heap_timeline;
    return {
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { data: number[] }[]) => {
          const d = params[0]?.data;
          if (!d) return "";
          return `时间: ${new Date(d[0]).toLocaleTimeString()}<br/>堆大小: ${formatBytes(d[1])}<br/>峰值: ${formatBytes(d[2])}`;
        },
      },
      grid: { left: 60, right: 20, top: 20, bottom: 30 },
      xAxis: {
        type: "time" as const,
        axisLabel: { color: chartTheme.textSecondary, fontSize: 10 },
      },
      yAxis: {
        type: "value" as const,
        axisLabel: {
          color: chartTheme.textSecondary,
          fontSize: 10,
          formatter: (v: number) => formatBytes(v),
        },
      },
      series: [
        {
          name: "堆大小",
          type: "line",
          data: points.map((p) => [new Date(p.timestamp).getTime(), p.heap_size]),
          smooth: true,
          lineStyle: { color: chartTheme.cyan, width: 2 },
          itemStyle: { color: chartTheme.cyan },
          symbol: "none",
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: chartTheme.cyan + "40" },
            { offset: 1, color: chartTheme.cyan + "05" },
          ])},
        },
        {
          name: "峰值堆",
          type: "line",
          data: points.map((p) => [new Date(p.timestamp).getTime(), p.peak_heap]),
          smooth: true,
          lineStyle: { color: chartTheme.amber, width: 1.5, type: "dashed" as const },
          itemStyle: { color: chartTheme.amber },
          symbol: "none",
        },
      ],
    };
  }, [trend, chartTheme]);

  const heapChartRef = useEChart(() => heapTrendOption, [heapTrendOption]);

  // ── Top allocators bar chart ──
  const allocBarOption = useMemo(() => {
    if (!flamegraph?.top_allocators || flamegraph.top_allocators.length === 0) return null;
    const top = flamegraph.top_allocators.slice(0, 10);
    return {
      tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
      grid: { left: 120, right: 20, top: 10, bottom: 20 },
      xAxis: {
        type: "value" as const,
        axisLabel: { color: chartTheme.textSecondary, fontSize: 9, formatter: (v: number) => formatBytes(v) },
      },
      yAxis: {
        type: "category" as const,
        data: top.map((t) => t.function).reverse(),
        axisLabel: { color: chartTheme.textSecondary, fontSize: 10, width: 110, overflow: "truncate" },
      },
      series: [{
        type: "bar",
        data: top.map((t) => ({
          value: t.total_bytes,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: chartTheme.cyan + "40" },
              { offset: 1, color: chartTheme.cyan },
            ]),
            borderRadius: [0, 3, 3, 0],
          },
        })).reverse(),
        barWidth: 16,
        label: {
          show: true,
          position: "right" as const,
          color: chartTheme.textSecondary,
          fontSize: 9,
          formatter: (p: { value: number }) => formatBytes(p.value),
        },
      }],
    };
  }, [flamegraph, chartTheme]);

  const allocChartRef = useEChart(() => allocBarOption, [allocBarOption]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return <EmptyState type="error" description={error} />;
  }

  // ── No data ──
  if (!leak && !trend && !flamegraph) {
    return <EmptyState type="no-data" />;
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto kt-scroll">
      {/* ══════ Leak Summary Card ══════ */}
      {leak && (
        <div
          className="rounded-xl border p-4"
          style={{
            borderColor: leak.leak_summary.has_critical ? "var(--kt-red)" : "var(--kt-border)",
            backgroundColor: "var(--kt-bg-elevated)",
            borderLeftWidth: "4px",
            borderLeftColor: leak.leak_summary.has_critical ? "var(--kt-red)"
              : leak.leak_summary.total_leaks > 0 ? "var(--kt-amber)" : "var(--kt-green)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <MemoryStick
              className="size-4"
              style={{ color: leak.leak_summary.has_critical ? "var(--kt-red)" : "var(--kt-amber)" }}
              aria-hidden="true"
            />
            <span className="text-sm font-semibold text-[var(--kt-text)]">内存泄漏检测</span>
            {leak.leak_summary.total_leaks === 0 && (
              <span className="text-xs text-[var(--kt-green)] ml-auto">未检测到泄漏</span>
            )}
          </div>

          {/* Severity grid */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {(["definitely", "indirectly", "possibly", "reachable"] as LeakSeverity[]).map((sev) => {
              const count = leak.leak_summary[`${sev}_lost` as keyof typeof leak.leak_summary] as number;
              const color = severityColor(sev, chartTheme);
              return (
                <div
                  key={sev}
                  className="rounded-lg p-2 text-center"
                  style={{ backgroundColor: color + "15", border: `0.5px solid ${color}40` }}
                >
                  <div className="text-lg font-bold tabular-nums" style={{ color }}>{count}</div>
                  <div className="text-[9px] text-[var(--kt-text-tertiary)]">{SEVERITY_LABELS[sev]}</div>
                </div>
              );
            })}
          </div>

          {/* Heaptrack summary */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
            {[
              { label: "总分配", value: formatBytes(leak.heaptrack_summary.total_allocated) },
              { label: "总释放", value: formatBytes(leak.heaptrack_summary.total_freed) },
              { label: "净增长", value: formatBytes(leak.heaptrack_summary.still_allocated) },
              { label: "峰值堆", value: formatBytes(leak.heaptrack_summary.peak_heap) },
              { label: "泄漏概率", value: `${(leak.heaptrack_summary.leak_probability * 100).toFixed(0)}%` },
              { label: "分配次数", value: leak.heaptrack_summary.alloc_count.toLocaleString() },
            ].map((item) => (
              <div key={item.label}>
                <div className="text-xs font-bold text-[var(--kt-text)]">{item.value}</div>
                <div className="text-[9px] text-[var(--kt-text-tertiary)]">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════ Heap Trend Chart ══════ */}
      {trend?.heap_timeline && trend.heap_timeline.length > 0 && (
        <div
          className="rounded-lg border p-3"
          style={{ borderColor: "var(--kt-border)", backgroundColor: "var(--kt-bg-surface)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="size-3 text-[var(--kt-text-tertiary)]" aria-hidden="true" />
              <span className="text-[10px] font-medium text-[var(--kt-text-secondary)]">堆趋势</span>
            </div>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                color: trend.summary.trend_direction === "increasing" ? "var(--kt-red)" : "var(--kt-green)",
                backgroundColor: trend.summary.trend_direction === "increasing" ? "var(--kt-red-dim)" : "var(--kt-green-dim)",
              }}
            >
              {trend.summary.trend_direction === "increasing" ? "增长中" : trend.summary.trend_direction === "decreasing" ? "减少中" : "稳定"}
              {" "}{trend.summary.growth_rate_mbps.toFixed(2)} MB/s
            </span>
          </div>
          <div ref={heapChartRef} style={{ height: 240 }} />
        </div>
      )}

      {/* ══════ Leak Details + Top Allocators ══════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Leak details table */}
        <div
          className="rounded-lg border overflow-hidden"
          style={{ borderColor: "var(--kt-border)", backgroundColor: "var(--kt-bg-surface)" }}
        >
          <div className="flex items-center gap-1.5 px-3 py-2 border-b" style={{ borderColor: "var(--kt-border)" }}>
            <AlertTriangle className="size-3 text-[var(--kt-text-tertiary)]" aria-hidden="true" />
            <span className="text-[10px] font-medium text-[var(--kt-text-secondary)]">泄漏详情</span>
            <span className="text-[10px] text-[var(--kt-text-tertiary)] ml-auto">
              {leak?.leaks.length ?? 0} 条记录
            </span>
          </div>

          {leak && leak.leaks.length > 0 ? (
            <div className="max-h-[400px] overflow-y-auto kt-scroll">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--kt-border)" }}>
                    <th className="text-left px-3 py-1.5 text-[var(--kt-text-tertiary)] font-medium">严重度</th>
                    <th className="text-left px-3 py-1.5 text-[var(--kt-text-tertiary)] font-medium">大小</th>
                    <th className="text-left px-3 py-1.5 text-[var(--kt-text-tertiary)] font-medium hidden md:table-cell">源位置</th>
                    <th className="text-right px-3 py-1.5 text-[var(--kt-text-tertiary)] font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {leak.leaks.map((l, i) => (
                    <tr
                      key={i}
                      className="border-b hover:bg-[var(--kt-bg-elevated)]/50 transition-colors"
                      style={{ borderColor: "var(--kt-border)" }}
                    >
                      <td className="px-3 py-1.5">
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{
                            color: severityColor(l.severity, chartTheme),
                            backgroundColor: severityColor(l.severity, chartTheme) + "15",
                          }}
                        >
                          {SEVERITY_LABELS[l.severity]}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[var(--kt-text)]">{formatBytes(l.size)}</td>
                      <td className="px-3 py-1.5 text-[var(--kt-text-tertiary)] hidden md:table-cell">
                        {l.source_file}:{l.source_line}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <AIAskButton
                          experimentId={experimentId}
                          variant="icon"
                          context={`内存泄漏 #${i + 1}: ${l.description}，位于 ${l.source_file}:${l.source_line}，大小 ${formatBytes(l.size)}`}
                          question={`这个内存泄漏是什么原因？怎么修复？\n\n源位置: ${l.source_file}:${l.source_line}\n描述: ${l.description}\n修复建议: ${l.fix_suggestion}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState type="no-issues" title="未检测到泄漏" description="内存分配和释放均正常" />
          )}
        </div>

        {/* Top allocators */}
        <div
          className="rounded-lg border"
          style={{ borderColor: "var(--kt-border)", backgroundColor: "var(--kt-bg-surface)" }}
        >
          <div className="flex items-center gap-1.5 px-3 py-2 border-b" style={{ borderColor: "var(--kt-border)" }}>
            <HardDrive className="size-3 text-[var(--kt-text-tertiary)]" aria-hidden="true" />
            <span className="text-[10px] font-medium text-[var(--kt-text-secondary)]">Top 分配者</span>
          </div>
          {flamegraph?.top_allocators && flamegraph.top_allocators.length > 0 ? (
            <div ref={allocChartRef} style={{ height: 300 }} />
          ) : (
            <EmptyState type="no-data" title="暂无分配数据" />
          )}
        </div>
      </div>
    </div>
  );
}