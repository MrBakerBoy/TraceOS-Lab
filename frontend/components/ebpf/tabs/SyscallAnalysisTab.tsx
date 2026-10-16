"use client";

import React, { useMemo, useState, useEffect, useRef } from "react";
import { Activity, FileText, AlertTriangle, Clock, Search, X } from "lucide-react";
import * as echarts from "echarts";
import { useTraces } from "@/hooks/useEbpfData";
import { useEChart } from "@/hooks/useEChart";
import { useEbpfChartTheme, catPalette } from "@/hooks/useEbpfChartTheme";
import { MetricCard } from "@/components/ebpf/shared/MetricCard";
import { EmptyState } from "@/components/ebpf/shared/EmptyState";
import { AIAskButton } from "@/components/ebpf/shared/AIAskButton";
import { Skeleton } from "@/components/ui/skeleton";
import { classifyWithColors, type SyscallCategory, type SyscallTrace } from "@/types/ebpf";

interface Props {
  submissionId: string;
  experimentId: string;
}

export default function SyscallAnalysisTab({ submissionId, experimentId }: Props) {
  const { data: traceData, loading, error } = useTraces(submissionId);
  const chartTheme = useEbpfChartTheme();
  const catCols = useMemo(() => catPalette(chartTheme), [chartTheme]);

  const [filterCategory, setFilterCategory] = useState<SyscallCategory | "all">("all");
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTrace, setSelectedTrace] = useState<SyscallTrace | null>(null);

  const traces = traceData?.traces ?? [];
  const summary = traceData?.summary;

  // ── Filter traces ──
  const filteredTraces = useMemo(() => {
    let result = traces;
    if (filterCategory !== "all") {
      result = result.filter((t) => classifyWithColors(t.syscall_name, catCols).cat === filterCategory);
    }
    if (showErrorsOnly) {
      result = result.filter((t) => !!t.error_name);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((t) => t.syscall_name.toLowerCase().includes(q));
    }
    return result;
  }, [traces, filterCategory, showErrorsOnly, searchQuery, catCols]);

  // ── Category pie chart ──
  const pieOption = useMemo(() => {
    if (!summary?.syscall_counts) return null;
    const cats: Record<SyscallCategory, number> = { io: 0, mem: 0, sync: 0, proc: 0, other: 0 };
    Object.entries(summary.syscall_counts).forEach(([name, count]) => {
      const cls = classifyWithColors(name, catCols);
      cats[cls.cat] += count;
    });
    const data = [
      { value: cats.io, name: "I/O", itemStyle: { color: catCols[0] } },
      { value: cats.mem, name: "内存", itemStyle: { color: catCols[1] } },
      { value: cats.sync, name: "同步", itemStyle: { color: catCols[2] } },
      { value: cats.proc, name: "进程", itemStyle: { color: catCols[3] } },
      { value: cats.other, name: "其他", itemStyle: { color: chartTheme.textTertiary } },
    ].filter((d) => d.value > 0);
    return {
      tooltip: { trigger: "item" as const, formatter: "{b}: {c} ({d}%)" },
      series: [{
        type: "pie",
        radius: ["50%", "75%"],
        center: ["50%", "50%"],
        data,
        label: { color: chartTheme.textSecondary, fontSize: 10 },
      }],
    };
  }, [summary, catCols, chartTheme]);

  const pieRef = useEChart(() => pieOption, [pieOption]);

  // ── Top 10 bar chart ──
  const barOption = useMemo(() => {
    if (!summary?.syscall_counts) return null;
    const entries = Object.entries(summary.syscall_counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);
    return {
      tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
      grid: { left: 100, right: 20, top: 10, bottom: 20 },
      xAxis: { type: "value" as const, axisLabel: { color: chartTheme.textSecondary, fontSize: 9 } },
      yAxis: {
        type: "category" as const,
        data: entries.map(([name]) => name).reverse(),
        axisLabel: { color: chartTheme.textSecondary, fontSize: 10 },
      },
      series: [{
        type: "bar",
        data: entries.map(([name, count]) => {
          const cls = classifyWithColors(name, catCols);
          return {
            value: count,
            itemStyle: { color: cls.color, borderRadius: [0, 3, 3, 0] },
          };
        }).reverse(),
        barWidth: 16,
      }],
    };
  }, [summary, catCols, chartTheme]);

  const barRef = useEChart(() => barOption, [barOption]);

  // ── Timeline chart (simplified: scatter with colors) ──
  const timelineOption = useMemo(() => {
    if (filteredTraces.length === 0 && traces.length === 0) return null;
    const source = filteredTraces.length > 0 ? filteredTraces : traces;
    const sample = source.length > 500 ? source.filter((_, i) => i % Math.ceil(source.length / 500) === 0) : source;
    const categories = ["io", "mem", "sync", "proc", "other"] as SyscallCategory[];
    const catData: Record<SyscallCategory, number[][]> = { io: [], mem: [], sync: [], proc: [], other: [] };

    sample.forEach((t, i) => {
      const cls = classifyWithColors(t.syscall_name, catCols);
      const ts = new Date(t.time).getTime();
      if (!isNaN(ts)) {
        catData[cls.cat].push([ts, i % 5, t.syscall_name, t.duration_ns, i]);
      }
    });

    return {
      tooltip: {
        trigger: "item" as const,
        formatter: (p: { data: (string | number)[] }) => {
          const d = p.data;
          return `${d[2]}<br/>时间: ${new Date(d[0] as number).toLocaleTimeString()}<br/>耗时: ${((d[3] as number) / 1000).toFixed(1)}μs`;
        },
      },
      grid: { left: 60, right: 20, top: 10, bottom: 30 },
      xAxis: {
        type: "time" as const,
        axisLabel: { color: chartTheme.textSecondary, fontSize: 9 },
      },
      yAxis: {
        show: false,
        min: 0,
        max: 6,
      },
      dataZoom: [
        { type: "slider" as const, bottom: 0, height: 20, borderColor: chartTheme.border },
        { type: "inside" as const },
      ],
      series: categories.map((cat) => ({
        name: cat,
        type: "scatter" as const,
        data: catData[cat],
        symbolSize: (val: number[]) => Math.max(4, Math.min(12, Math.log(val[3] / 1000 + 1) * 2)),
        itemStyle: { color: catCols[categories.indexOf(cat)], opacity: 0.7 },
      })),
    };
  }, [filteredTraces, traces, catCols, chartTheme]);

  const timelineRef = useEChart(() => timelineOption, [timelineOption]);

  // ── Store sampled traces for click lookup ──
  const sampledSourceRef = useRef<SyscallTrace[]>([]);
  useEffect(() => {
    const source = filteredTraces.length > 0 ? filteredTraces : traces;
    sampledSourceRef.current = source.length > 500
      ? source.filter((_, i) => i % Math.ceil(source.length / 500) === 0)
      : source;
  }, [filteredTraces, traces]);

  // ── Bind click events on timeline chart ──
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const instance = echarts.getInstanceByDom(el);
    if (!instance) return;
    const handler = (params: { data?: (string | number)[] }) => {
      const d = params.data;
      if (!d || d.length < 5) return;
      const idx = d[4] as number;
      const trace = sampledSourceRef.current[idx];
      if (trace) setSelectedTrace(trace);
    };
    instance.on("click", handler);
    return () => { instance.off("click", handler); };
  }, [timelineRef, filteredTraces, traces]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error) return <EmptyState type="error" description={error} />;
  if (!traceData || traces.length === 0) return <EmptyState type="no-data" />;

  return (
    <div className="p-4 space-y-4 overflow-y-auto kt-scroll">
      {/* ══════ KPI Row ══════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          title="总调用次数"
          value={summary?.total_count ?? "--"}
          unit="次"
          icon={Activity}
        />
        <MetricCard
          title="唯一系统调用"
          value={summary?.unique_syscalls ?? "--"}
          unit="种"
          icon={FileText}
        />
        <MetricCard
          title="错误次数"
          value={summary?.error_count ?? "--"}
          unit="次"
          status={summary && summary.error_count > 0 ? "warning" : "healthy"}
          icon={AlertTriangle}
        />
        <MetricCard
          title="执行时间"
          value={summary?.execution_time_ns ? `${(summary.execution_time_ns / 1e6).toFixed(1)}` : "--"}
          unit="ms"
          icon={Clock}
        />
      </div>

      {/* ══════ Charts Row ══════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          className="rounded-lg border p-3"
          style={{ borderColor: "var(--kt-border)", backgroundColor: "var(--kt-bg-surface)" }}
        >
          <span className="text-[10px] font-medium text-[var(--kt-text-secondary)]">分类分布</span>
          <div ref={pieRef} style={{ height: 200 }} />
        </div>
        <div
          className="rounded-lg border p-3"
          style={{ borderColor: "var(--kt-border)", backgroundColor: "var(--kt-bg-surface)" }}
        >
          <span className="text-[10px] font-medium text-[var(--kt-text-secondary)]">Top 10 系统调用</span>
          <div ref={barRef} style={{ height: 200 }} />
        </div>
      </div>

      {/* ══════ Filters ══════ */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "io", "mem", "sync", "proc", "other"] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className="text-[10px] px-2 py-1 rounded-md transition-colors font-medium"
            style={{
              backgroundColor: filterCategory === cat ? "var(--kt-cyan-dim)" : "var(--kt-bg-elevated)",
              color: filterCategory === cat ? "var(--kt-cyan)" : "var(--kt-text-tertiary)",
              border: `0.5px solid ${filterCategory === cat ? "var(--kt-cyan)" : "var(--kt-border)"}`,
            }}
          >
            {cat === "all" ? "全部" : ["I/O", "内存", "同步", "进程", "其他"][["all", "io", "mem", "sync", "proc", "other"].indexOf(cat) - 1]}
          </button>
        ))}
        <button
          onClick={() => setShowErrorsOnly(!showErrorsOnly)}
          className="text-[10px] px-2 py-1 rounded-md transition-colors font-medium"
          style={{
            backgroundColor: showErrorsOnly ? "var(--kt-red-dim)" : "var(--kt-bg-elevated)",
            color: showErrorsOnly ? "var(--kt-red)" : "var(--kt-text-tertiary)",
            border: `0.5px solid ${showErrorsOnly ? "var(--kt-red)" : "var(--kt-border)"}`,
          }}
        >
          仅错误
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-1 px-2 py-1 rounded-md border" style={{ borderColor: "var(--kt-border)" }}>
          <Search className="size-3 text-[var(--kt-text-tertiary)]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索..."
            className="text-[10px] bg-transparent border-none outline-none text-[var(--kt-text)] w-24"
            aria-label="搜索系统调用"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} aria-label="清除搜索">
              <X className="size-3 text-[var(--kt-text-tertiary)]" />
            </button>
          )}
        </div>
      </div>

      {/* ══════ Timeline ══════ */}
      <div
        className="rounded-lg border p-3"
        style={{ borderColor: "var(--kt-border)", backgroundColor: "var(--kt-bg-surface)" }}
      >
        <span className="text-[10px] font-medium text-[var(--kt-text-secondary)]">
          时间线 ({filteredTraces.length} / {traces.length} 条)
        </span>
        <div ref={timelineRef} style={{ height: 200 }} />
      </div>

      {/* ══════ Detail Drawer ══════ */}
      {selectedTrace && (
        <div
          className="rounded-lg border p-3"
          style={{ borderColor: "var(--kt-border)", backgroundColor: "var(--kt-bg-elevated)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-[var(--kt-text)]">
              {selectedTrace.syscall_name}
            </span>
            <span className="text-[10px] text-[var(--kt-text-tertiary)]">
              PID {selectedTrace.pid} · 耗时 {selectedTrace.duration_ns > 0 ? `${(selectedTrace.duration_ns / 1000).toFixed(1)}μs` : "-"}
            </span>
            {selectedTrace.error_name && (
              <span className="text-[10px] px-1 py-0.5 rounded" style={{ color: "var(--kt-red)", backgroundColor: "var(--kt-red-dim)" }}>
                {selectedTrace.error_name}
              </span>
            )}
            <div className="flex-1" />
            <AIAskButton
              experimentId={experimentId}
              variant="inline"
              context={`系统调用 ${selectedTrace.syscall_name}${selectedTrace.error_name ? ` 错误: ${selectedTrace.error_name}` : ""}`}
              question={`系统调用 ${selectedTrace.syscall_name} 是什么？${selectedTrace.error_name ? `错误 ${selectedTrace.error_name} 是什么意思？` : "它在这里起什么作用？"}`}
            />
          </div>
          <p className="text-[10px] text-[var(--kt-text-tertiary)]">
            时间: {new Date(selectedTrace.time).toLocaleString()} · 返回值: {selectedTrace.return_value}
          </p>
        </div>
      )}
    </div>
  );
}