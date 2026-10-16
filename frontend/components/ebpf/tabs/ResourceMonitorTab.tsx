"use client";

import React from "react";
import { Cpu, HardDrive, FileText, Network, AlertTriangle } from "lucide-react";
import { useSandboxMetrics } from "@/hooks/useEbpfData";
import { useEbpfChartTheme } from "@/hooks/useEbpfChartTheme";
import { GaugeCard } from "@/components/ebpf/shared/GaugeCard";
import { MetricCard } from "@/components/ebpf/shared/MetricCard";
import { EmptyState } from "@/components/ebpf/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useEChart } from "@/hooks/useEChart";
import * as echarts from "echarts";
import { useMemo } from "react";

interface Props {
  submissionId: string;
  experimentId: string;
}

export default function ResourceMonitorTab({ submissionId, experimentId }: Props) {
  const { data: metrics, loading, error } = useSandboxMetrics(submissionId);
  const chartTheme = useEbpfChartTheme();

  // ── IO bar chart ──
  const ioChartOption = useMemo(() => {
    if (!metrics) return null;
    return {
      tooltip: { trigger: "axis" as const },
      grid: { left: 50, right: 20, top: 10, bottom: 30 },
      xAxis: {
        type: "category" as const,
        data: ["读取", "写入"],
        axisLabel: { color: chartTheme.textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: "value" as const,
        axisLabel: {
          color: chartTheme.textSecondary,
          fontSize: 10,
          formatter: (v: number) => v >= 1048576 ? `${(v / 1048576).toFixed(1)}MB` : v >= 1024 ? `${(v / 1024).toFixed(1)}KB` : `${v}B`,
        },
      },
      series: [{
        type: "bar",
        data: [
          { value: metrics.io_read_bytes, itemStyle: { color: chartTheme.cyan, borderRadius: [4, 4, 0, 0] } },
          { value: metrics.io_write_bytes, itemStyle: { color: chartTheme.purple, borderRadius: [4, 4, 0, 0] } },
        ],
        barWidth: 40,
      }],
    };
  }, [metrics, chartTheme]);

  const ioChartRef = useEChart(() => ioChartOption, [ioChartOption]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return <EmptyState type="error" description={error} />;
  }

  // ── No data ──
  if (!metrics) {
    return <EmptyState type="no-data" />;
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto kt-scroll">
      {/* ── Alerts banner ── */}
      {metrics.alerts.length > 0 && (
        <div
          className="rounded-lg border p-3 space-y-2"
          style={{
            borderColor: metrics.alerts.some((a) => a.severity === "critical") ? "var(--kt-red)" : "var(--kt-amber)",
            backgroundColor: metrics.alerts.some((a) => a.severity === "critical") ? "var(--kt-red-dim)" : "var(--kt-amber-dim)",
          }}
        >
          {metrics.alerts.map((alert, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertTriangle
                className="size-3.5 mt-0.5 flex-shrink-0"
                style={{ color: alert.severity === "critical" ? "var(--kt-red)" : "var(--kt-amber)" }}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--kt-text)]">{alert.message}</p>
                <p className="text-[10px] text-[var(--kt-text-tertiary)]">
                  当前值: {alert.currentValue}{alert.limitValue ? ` / 阈值: ${alert.limitValue}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── CPU & Memory Gauges ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <GaugeCard
          title="CPU"
          value={metrics.cpu_percent}
          subtitle={`上下文切换: ${metrics.context_switches.toLocaleString()} · 线程: ${metrics.thread_count}`}
          colorStops={[
            [0.5, chartTheme.green],
            [0.8, chartTheme.amber],
            [1, chartTheme.red],
          ]}
        />
        <GaugeCard
          title="内存"
          value={metrics.mem_percent}
          subtitle={`RSS: ${metrics.mem_rss_mb.toFixed(1)}MB / 限制: ${metrics.mem_limit_mb}MB · OOM: ${(metrics.mem_oom_risk * 100).toFixed(0)}%`}
          colorStops={[
            [0.5, chartTheme.green],
            [0.8, chartTheme.amber],
            [1, chartTheme.red],
          ]}
        />
      </div>

      {/* ── CPU details ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          title="CFS 节流"
          value={metrics.cfs_throttled_ms > 0 ? `${metrics.cfs_throttled_ms.toFixed(1)}` : "0"}
          unit="ms"
          status={metrics.cfs_throttled_ms > 0 ? "warning" : "healthy"}
          icon={Cpu}
        />
        <MetricCard
          title="线程运行中"
          value={metrics.thread_running}
          unit="个"
          icon={Network}
        />
        <MetricCard
          title="线程休眠"
          value={metrics.thread_sleeping}
          unit="个"
          icon={Network}
        />
        <MetricCard
          title="缺页 (Minor)"
          value={metrics.page_faults_minor}
          unit="次"
          icon={FileText}
        />
      </div>

      {/* ── IO & FD ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* IO chart */}
        <div
          className="rounded-lg border p-3"
          style={{ borderColor: "var(--kt-border)", backgroundColor: "var(--kt-bg-surface)" }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <HardDrive className="size-3 text-[var(--kt-text-tertiary)]" aria-hidden="true" />
            <span className="text-[10px] font-medium text-[var(--kt-text-secondary)]">磁盘 I/O</span>
          </div>
          <div ref={ioChartRef} style={{ height: 160 }} />
          <p className="text-[10px] text-center text-[var(--kt-text-tertiary)] mt-1">
            I/O 等待: {metrics.io_wait_percent.toFixed(1)}%
          </p>
        </div>

        {/* FD & threads */}
        <div
          className="rounded-lg border p-3 space-y-3"
          style={{ borderColor: "var(--kt-border)", backgroundColor: "var(--kt-bg-surface)" }}
        >
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-[var(--kt-text-tertiary)]">文件描述符</span>
              <span className="text-[10px] font-mono text-[var(--kt-text-secondary)]">
                {metrics.fd_count} / {metrics.fd_soft_limit}
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--kt-bg-elevated)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (metrics.fd_count / metrics.fd_soft_limit) * 100)}%`,
                  backgroundColor: metrics.fd_count > metrics.fd_soft_limit * 0.8 ? "var(--kt-red)" : "var(--kt-cyan)",
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t" style={{ borderColor: "var(--kt-border)" }}>
            <div className="text-center">
              <div className="text-lg font-bold text-[var(--kt-text)]">{metrics.thread_count}</div>
              <div className="text-[9px] text-[var(--kt-text-tertiary)]">总线程</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-[var(--kt-green)]">{metrics.thread_running}</div>
              <div className="text-[9px] text-[var(--kt-text-tertiary)]">运行中</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-[var(--kt-text-tertiary)]">{metrics.thread_sleeping}</div>
              <div className="text-[9px] text-[var(--kt-text-tertiary)]">休眠中</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t" style={{ borderColor: "var(--kt-border)" }}>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-[var(--kt-text-tertiary)]">缺页 (Major)</span>
                <span className="text-[10px] font-mono text-[var(--kt-text-secondary)]">{metrics.page_faults_major}</span>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-[var(--kt-text-tertiary)]">上下文切换</span>
                <span className="text-[10px] font-mono text-[var(--kt-text-secondary)]">{metrics.context_switches.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}