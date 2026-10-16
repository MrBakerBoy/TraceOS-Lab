"use client";

import React, { useMemo } from "react";
import { HeartPulse, Clock, Activity, Cpu, ShieldAlert, MemoryStick, Network } from "lucide-react";
import { useEbpfHealth, useTraces, useSandboxMetrics, useLeakReport, useRaceReport, useDeadlockEvolution } from "@/hooks/useEbpfData";
import { useEbpfStore } from "@/stores/ebpfStore";
import { useEChart } from "@/hooks/useEChart";
import { useEbpfChartTheme } from "@/hooks/useEbpfChartTheme";
import { MetricCard } from "@/components/ebpf/shared/MetricCard";
import { DetectionSummaryCard } from "@/components/ebpf/shared/DetectionSummaryCard";
import { EmptyState } from "@/components/ebpf/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import type { HealthStatus, HealthScore } from "@/types/ebpf";

interface Props {
  submissionId: string;
  experimentId: string;
}

export default function HealthOverviewTab({ submissionId, experimentId }: Props) {
  const { healthScore, loading, error } = useEbpfHealth(submissionId);
  const sandbox = useSandboxMetrics(submissionId);
  const leak = useLeakReport(submissionId);
  const race = useRaceReport(submissionId);
  const deadlock = useDeadlockEvolution(submissionId);
  const traces = useTraces(submissionId);
  const navigateTo = useEbpfStore((s) => s.navigateTo);
  const chartTheme = useEbpfChartTheme();

  // ── Score gauge chart ──
  const gaugeOption = useMemo(() => {
    if (!healthScore) return null;
    const score = healthScore.total;
    return {
      series: [{
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        center: ["50%", "55%"],
        radius: "85%",
        min: 0,
        max: 100,
        splitNumber: 10,
        axisLine: {
          lineStyle: {
            width: 14,
            color: [
              [0.5, chartTheme.red],
              [0.75, chartTheme.amber],
              [0.9, chartTheme.green],
              [1, chartTheme.green],
            ],
          },
        },
        pointer: {
          length: "60%",
          width: 6,
          itemStyle: { color: chartTheme.text },
        },
        axisTick: { length: 6, lineStyle: { color: "auto", width: 1 } },
        splitLine: { length: 12, lineStyle: { color: "auto", width: 2 } },
        axisLabel: { color: chartTheme.textSecondary, fontSize: 9, distance: -25 },
        detail: {
          valueAnimation: true,
          formatter: `{value}`,
          color: chartTheme.text,
          fontSize: 28,
          fontWeight: "bold",
          offsetCenter: [0, "40%"],
        },
        title: { offsetCenter: [0, "78%"], color: chartTheme.textSecondary, fontSize: 11 },
        data: [{ value: score, name: "健康评分" }],
      }],
    };
  }, [healthScore, chartTheme]);

  const gaugeRef = useEChart(() => gaugeOption, [gaugeOption]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-48 rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return <EmptyState type="error" description={error} />;
  }

  // ── No data ──
  if (!healthScore && !sandbox.data && !traces.data) {
    return <EmptyState type="no-data" />;
  }

  // ── Score color ──
  const scoreColor =
    healthScore?.status === "healthy" ? chartTheme.green :
    healthScore?.status === "warning" ? chartTheme.amber :
    chartTheme.red;

  return (
    <div className="p-4 space-y-4 overflow-y-auto kt-scroll">
      {/* ══════ Health Score Banner ══════ */}
      <div
        className="rounded-xl border p-5"
        style={{
          borderColor: "var(--kt-border)",
          backgroundColor: "var(--kt-bg-elevated)",
          borderLeftWidth: "4px",
          borderLeftColor: scoreColor,
        }}
      >
        <div className="flex items-start gap-6">
          {/* Gauge */}
          <div ref={gaugeRef} className="flex-shrink-0" style={{ width: 160, height: 140 }} />

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <HeartPulse className="size-5" style={{ color: scoreColor }} aria-hidden="true" />
              <h2 className="text-lg font-bold text-[var(--kt-text)]">
                健康评分：{healthScore?.total ?? "--"}/100
              </h2>
            </div>
            <p className="text-sm text-[var(--kt-text-secondary)] mb-3">
              {healthScore?.summary ?? "正在分析..."}
            </p>

            {/* Dimension scores */}
            <div className="flex flex-wrap gap-2">
              {healthScore?.dimensions.map((dim) => (
                <button
                  key={dim.label}
                  type="button"
                  onClick={() => navigateTo(dim.tabId)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors hover:brightness-110"
                  style={{
                    backgroundColor: dim.status === "healthy" ? "var(--kt-green-dim)" :
                      dim.status === "warning" ? "var(--kt-amber-dim)" : "var(--kt-red-dim)",
                    color: dim.status === "healthy" ? "var(--kt-green)" :
                      dim.status === "warning" ? "var(--kt-amber)" : "var(--kt-red)",
                    border: `0.5px solid ${dim.status === "healthy" ? "var(--kt-green)" : dim.status === "warning" ? "var(--kt-amber)" : "var(--kt-red)"}`,
                    opacity: dim.status === "unknown" ? 0.5 : 1,
                  }}
                >
                  {dim.label} {dim.score}/{dim.maxScore}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ══════ KPI Row 1: Execution Summary ══════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          title="执行时间"
          value={sandbox.data?.duration_sec ? `${sandbox.data.duration_sec.toFixed(2)}` : "--"}
          unit="秒"
          icon={Clock}
        />
        <MetricCard
          title="系统调用总数"
          value={traces.data?.summary?.total_count ?? "--"}
          unit="次"
          icon={Activity}
        />
        <MetricCard
          title="唯一系统调用"
          value={traces.data?.summary?.unique_syscalls ?? "--"}
          unit="种"
          icon={Cpu}
        />
        <MetricCard
          title="线程峰值"
          value={sandbox.data?.thread_count ?? "--"}
          unit="个"
          icon={Network}
        />
      </div>

      {/* ══════ KPI Row 2: Detection Summary ══════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DetectionSummaryCard
          title="内存泄漏"
          icon={MemoryStick}
          status={leak.data?.leak_summary.has_critical ? "critical" : leak.data?.leak_summary.total_leaks ? "warning" : "healthy"}
          summary={leak.data
            ? `${leak.data.leak_summary.total_leaks > 0 ? `发现 ${leak.data.leak_summary.total_leaks} 个泄漏` : "未检测到泄漏"}`
            : "分析中..."}
          details={leak.data
            ? `确定: ${leak.data.leak_summary.definitely_lost} · 间接: ${leak.data.leak_summary.indirectly_lost} · 可能: ${leak.data.leak_summary.possibly_lost}`
            : undefined}
          onClick={() => navigateTo("memory")}
        />
        <DetectionSummaryCard
          title="数据竞态"
          icon={ShieldAlert}
          status={race.data?.has_races ? "critical" : race.data ? "healthy" : "unknown"}
          summary={race.data
            ? `${race.data.has_races ? `发现 ${race.data.race_summary.total_races} 个竞态` : "未检测到竞态"}`
            : "分析中..."}
          details={race.data
            ? `涉及 ${race.data.thread_count} 个线程 · 置信度 ${(race.data.race_summary.confidence_score * 100).toFixed(0)}%`
            : undefined}
          onClick={() => navigateTo("concurrency")}
        />
        <DetectionSummaryCard
          title="死锁检测"
          icon={Network}
          status={deadlock.data?.detected ? "critical" : deadlock.data ? "healthy" : "unknown"}
          summary={deadlock.data
            ? `${deadlock.data.detected ? "检测到死锁" : "未检测到死锁"}`
            : "分析中..."}
          details={deadlock.data?.detected ? `循环涉及 ${deadlock.data.cycle_nodes?.length ?? 0} 个线程` : undefined}
          onClick={() => navigateTo("concurrency")}
        />
        <DetectionSummaryCard
          title="资源告警"
          icon={Cpu}
          status={sandbox.data?.alerts?.some((a) => a.severity === "critical") ? "critical"
            : sandbox.data?.alerts?.some((a) => a.severity === "warning") ? "warning"
            : sandbox.data ? "healthy" : "unknown"}
          summary={sandbox.data
            ? `${sandbox.data.alerts.length > 0 ? `${sandbox.data.alerts.length} 个告警` : "资源正常"}`
            : "分析中..."}
          details={sandbox.data?.alerts.length
            ? sandbox.data.alerts.slice(0, 2).map((a) => a.message).join(" · ")
            : undefined}
          onClick={() => navigateTo("resources")}
        />
      </div>
    </div>
  );
}