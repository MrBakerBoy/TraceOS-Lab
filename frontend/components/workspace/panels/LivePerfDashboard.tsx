"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import "@/lib/setup-echarts";
import { usePerfMetrics, type PerfMetrics } from "@/hooks/usePerfMetrics";
import { useWorkspaceStore } from "@/stores/workspace";

// ── Theme helper: read CSS custom properties at runtime ────────────────────
// Reads from the given element (or documentElement) so that inline style
// overrides on parent elements (e.g. workspace theme) are picked up.
function cssVar(el: HTMLElement | null, name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const source = el || document.documentElement;
  const v = getComputedStyle(source).getPropertyValue(name).trim();
  return v || fallback;
}

// Snapshot all theme colors needed by charts. Called in effect so it
// re-reads on theme switch.
interface ThemeColors {
  bg: string;
  text: string;
  axis: string;
  split: string;
  border: string;
  barBg: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
}
function readTheme(el?: HTMLElement | null): ThemeColors {
  const c = (n: string, f: string) => cssVar(el || null, n, f);
  return {
    bg: c("--kt-bg-surface", "#12121A"),
    text: c("--kt-text", "#F5F5F7"),
    axis: c("--kt-text-tertiary", "#8D8D97"),
    split: c("--kt-border", "rgba(255,255,255,0.06)"),
    border: c("--kt-border", "rgba(255,255,255,0.06)"),
    barBg: c("--kt-bg-elevated", "#18181F"),
    accent: c("--kt-cyan", "#00D4FF"),
    error: c("--kt-red", "#FF453A"),
    warning: c("--kt-amber", "#FF9F0A"),
    success: c("--kt-green", "#30D158"),
  };
}

const MAX_POINTS = 60;

const EMPTY_METRICS: PerfMetrics = {
  timestamp: 0,
  cpu_percent: 0,
  memory_percent: 0,
  ctx_switches_per_sec: 0,
  page_faults_per_sec: 0,
  disk_iops: 0,
  network_rx_bytes: 0,
  network_tx_bytes: 0,
};

// ── Formatting helpers ─────────────────────────────────────────────────────
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function formatPct(v: number): string {
  return `${round1(v).toFixed(1)}%`;
}
function formatCompact(n: number): string {
  if (n < 1000) return n.toFixed(0);
  if (n < 1000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1000_000).toFixed(1)}M`;
}
function formatBytes(b: number): string {
  if (b < 1024) return `${b} B/s`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB/s`;
  return `${(b / 1024 / 1024).toFixed(1)} MB/s`;
}

function capHistory(points: PerfMetrics[]): PerfMetrics[] {
  if (points.length <= MAX_POINTS) return points.slice();
  return points.slice(points.length - MAX_POINTS);
}

// ── ECharts option builders (theme-aware) ─────────────────────────────────
function gaugeOption(value: number, t: ThemeColors, name: string, thresholds: [number, string][]): any {
  return {
    backgroundColor: "transparent",
    textStyle: { color: t.text },
    series: [{
      type: "gauge", name, min: 0, max: 100, center: ["50%", "60%"], radius: "88%",
      splitNumber: 5,
      progress: { show: true, width: 10, roundCap: true },
      axisLine: { lineStyle: { width: 10, color: thresholds } },
      axisTick: { show: false },
      splitLine: { length: 6, lineStyle: { color: t.axis, width: 1 } },
      axisLabel: { color: t.axis, fontSize: 9, distance: 12 },
      pointer: { length: "55%", width: 3, itemStyle: { color: t.text } },
      anchor: { show: false },
      title: { show: false },
      detail: { valueAnimation: true, formatter: "{value}%", color: t.text, fontSize: 16, offsetCenter: [0, "60%"] },
      data: [{ value: round1(value), name }],
    }],
  };
}

function lineOption(name: string, unit: string, color: string, data: [number, number][], t: ThemeColors): any {
  return {
    backgroundColor: "transparent",
    textStyle: { color: t.text },
    grid: { left: 4, right: 10, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis" },
    xAxis: { type: "value", axisLabel: { color: t.axis, fontSize: 9, hideOverlap: true }, splitLine: { show: false }, axisLine: { lineStyle: { color: t.split } } },
    yAxis: { type: "value", name: unit, nameTextStyle: { color: t.axis, fontSize: 9 }, axisLabel: { color: t.axis, fontSize: 9 }, splitLine: { lineStyle: { color: t.split } }, axisLine: { show: false } },
    series: [{ type: "line", name, smooth: true, showSymbol: false, areaStyle: { opacity: 0.2 }, lineStyle: { width: 2, color }, itemStyle: { color }, data }],
  };
}

function networkOption(history: PerfMetrics[], t: ThemeColors): any {
  const rx = history.map((h) => [h.timestamp, h.network_rx_bytes] as [number, number]);
  const tx = history.map((h) => [h.timestamp, h.network_tx_bytes] as [number, number]);
  return {
    backgroundColor: "transparent",
    textStyle: { color: t.text },
    legend: { textStyle: { color: t.text, fontSize: 9 }, top: 0, right: 6, itemWidth: 10, itemHeight: 6 },
    grid: { left: 4, right: 10, top: 16, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis" },
    xAxis: { type: "value", axisLabel: { color: t.axis, fontSize: 9, hideOverlap: true }, splitLine: { show: false }, axisLine: { lineStyle: { color: t.split } } },
    yAxis: { type: "value", name: "B/s", nameTextStyle: { color: t.axis, fontSize: 9 }, axisLabel: { color: t.axis, fontSize: 9, formatter: (v: number) => formatBytes(v) }, splitLine: { lineStyle: { color: t.split } }, axisLine: { show: false } },
    series: [
      { type: "line", name: "接收", smooth: true, showSymbol: false, areaStyle: { opacity: 0.15 }, lineStyle: { width: 2, color: t.accent }, itemStyle: { color: t.accent }, data: rx },
      { type: "line", name: "发送", smooth: true, showSymbol: false, areaStyle: { opacity: 0.15 }, lineStyle: { width: 2, color: t.warning }, itemStyle: { color: t.warning }, data: tx },
    ],
  };
}

// Mini sparkline option for the collapsed bar
function sparklineOption(data: [number, number][], color: string, t: ThemeColors): any {
  return {
    backgroundColor: "transparent",
    grid: { left: 0, right: 0, top: 2, bottom: 0 },
    xAxis: { type: "value", show: false, min: data.length ? data[0][0] : 0, max: data.length ? data[data.length - 1][0] : 1 },
    yAxis: { type: "value", show: false },
    series: [{ type: "line", showSymbol: false, smooth: true, lineStyle: { width: 1.5, color }, areaStyle: { opacity: 0.15, color }, data }],
  };
}

// ── ECharts lifecycle hook ─────────────────────────────────────────────────
function useEChart(builder: () => any, deps: React.DependencyList) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(ref.current, 'kt-dynamic');
    const chart = chartRef.current;
    chart.setOption(builder(), true);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    return () => { chartRef.current?.dispose(); chartRef.current = null; };
  }, []);
  return ref;
}

// ── Chart card ──────────────────────────────────────────────────────────────
interface ChartCardProps {
  testid: string;
  title: string;
  value: React.ReactNode;
  dataPoints?: number;
  children: React.ReactNode;
}
function ChartCard({ testid, title, value, dataPoints, children }: ChartCardProps) {
  return (
    <div
      data-testid={testid}
      data-points={dataPoints == null ? undefined : String(dataPoints)}
      className="rounded-md border flex flex-col overflow-hidden"
      style={{ borderColor: "var(--kt-border)", backgroundColor: "var(--kt-bg-surface)" }}
    >
      <div className="flex items-center justify-between px-2 py-1 border-b flex-shrink-0" style={{ borderColor: "var(--kt-border)" }}>
        <span className="text-[10px] font-medium text-[var(--kt-text-secondary)] truncate">{title}</span>
        <span className="text-[10px] font-mono text-[var(--kt-text-tertiary)] truncate ml-2">{value}</span>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

// ── Collapsed sparkline strip item ──────────────────────────────────────────
interface StripItemProps {
  testid: string;
  label: string;
  value: string;
  data: [number, number][];
  color: string;
  t: ThemeColors;
}
function StripItem({ testid, label, value, data, color, t }: StripItemProps) {
  const ref = useEChart(() => sparklineOption(data, color, t), [data, color, t]);
  return (
    <div data-testid={testid} className="flex items-center gap-1.5 flex-1 min-w-0 px-2">
      <div className="flex-1 min-w-0">
        <div className="text-[9px] text-[var(--kt-text-tertiary)] truncate leading-tight">{label}</div>
        <div className="text-[10px] font-mono text-[var(--kt-text-secondary)] truncate leading-tight">{value}</div>
      </div>
      <div ref={ref} className="h-6 flex-shrink-0" style={{ width: 56 }} />
    </div>
  );
}

// ── Main dashboard ──────────────────────────────────────────────────────────
interface LivePerfDashboardProps {
  submissionId: string;
  experimentId?: string;
  initialMetrics?: Partial<PerfMetrics>;
  initialHistory?: PerfMetrics[];
}

export default function LivePerfDashboard({
  submissionId,
  experimentId,
  initialMetrics,
  initialHistory,
}: LivePerfDashboardProps) {
  const { perfPhase, setPerfPhase } = useWorkspaceStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ThemeColors>(() => readTheme());
  const [metrics, setMetrics] = useState<PerfMetrics>({ ...EMPTY_METRICS, ...initialMetrics });
  const [history, setHistory] = useState<PerfMetrics[]>(() => capHistory(initialHistory || []));
  const [expanded, setExpanded] = useState(false);
  const [countdown, setCountdown] = useState(6);
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-read theme on mount and when theme may have changed.
  // Uses containerRef so that --kt-* inline style overrides from the
  // workspace parent are visible to getComputedStyle.
  useEffect(() => {
    const el = containerRef.current;
    setTheme(readTheme(el));
    const observer = new MutationObserver(() => setTheme(readTheme(el)));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => observer.disconnect();
  }, []);

  const ingest = useCallback((m: PerfMetrics) => {
    setMetrics(m);
    setHistory((prev) => {
      const next = prev.length >= MAX_POINTS ? prev.slice(prev.length - MAX_POINTS + 1) : prev.slice();
      next.push(m);
      return next;
    });
  }, []);

  // Sync initial metrics when provided
  useEffect(() => {
    if (!initialMetrics) return;
    setMetrics({ ...EMPTY_METRICS, ...initialMetrics });
  }, [initialMetrics]);

  // Real-time WS
  usePerfMetrics(experimentId, ingest, !!experimentId);

  // ── perfPhase lifecycle ───────────────────────────────────────────────────
  // 'running' → live updates, always expanded-optional
  // 'final'   → freeze last values, show 6s countdown, then idle
  // 'pinned'  → stays visible regardless of countdown
  useEffect(() => {
    if (perfPhase === "final" && countdown === 0) {
      setPerfPhase("idle");
    }
  }, [perfPhase, countdown, setPerfPhase]);

  useEffect(() => {
    if (perfPhase !== "final") {
      setCountdown(6);
      return;
    }
    if (countdown <= 0) return;
    countdownRef.current = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => { if (countdownRef.current) clearTimeout(countdownRef.current); };
  }, [perfPhase, countdown]);

  // Visibility: only render when we have something to show
  const visible = perfPhase !== "idle";

  if (!visible) return null;

  const t = theme;
  const last = history.length > 0 ? history[history.length - 1] : null;
  const chartStyle: React.CSSProperties = { width: "100%", height: "100%" };

  // Expanded charts (deps include `expanded` so charts init when the panel mounts)
  const cpuRef = useEChart(() => gaugeOption(metrics.cpu_percent, t, "CPU", [[0.9, t.success], [1, t.error]]), [metrics.cpu_percent, t, expanded]);
  const memRef = useEChart(() => gaugeOption(metrics.memory_percent, t, "内存", [[0.8, t.success], [1, t.warning]]), [metrics.memory_percent, t, expanded]);
  const ctxRef = useEChart(() => lineOption("上下文切换", "/s", t.accent, history.map((h) => [h.timestamp, h.ctx_switches_per_sec]), t), [history, t, expanded]);
  const pageFaultRef = useEChart(() => lineOption("缺页", "/s", t.error, history.map((h) => [h.timestamp, h.page_faults_per_sec]), t), [history, t, expanded]);
  const diskRef = useEChart(() => lineOption("磁盘 IOPS", "IOPS", t.success, history.map((h) => [h.timestamp, h.disk_iops]), t), [history, t, expanded]);
  const netRef = useEChart(() => networkOption(history, t), [history, t, expanded]);

  const stripData = (fn: (h: PerfMetrics) => number): [number, number][] =>
    history.map((h) => [h.timestamp, fn(h)] as [number, number]);

  const handleDismiss = () => setPerfPhase("idle");
  const handlePin = () => {
    if (perfPhase === "pinned") {
      // Unpin: if we were in final, resume countdown
      setPerfPhase("final");
    } else {
      setPerfPhase("pinned");
    }
  };
  const isPinned = perfPhase === "pinned";

  return (
    <div
      ref={containerRef}
      data-testid="live-perf-dashboard"
      className="flex flex-col flex-shrink-0 border-t"
      style={{ borderColor: "var(--kt-border)", backgroundColor: "var(--kt-bg-surface)" }}
    >
      {/* Control bar (always visible) */}
      <div className="h-7 flex items-center px-3 gap-2 flex-shrink-0">
        <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: perfPhase === "running" ? "var(--kt-green)" : "var(--kt-amber)" }} />
        <span className="text-[10px] font-medium text-[var(--kt-text-secondary)]">实时性能监控</span>
        <span className="flex-1" />
        {!isPinned && perfPhase === "final" && (
          <span className="text-[9px] font-mono text-[var(--kt-text-tertiary)]">{countdown}s</span>
        )}
        <button
          onClick={handlePin}
          className="text-[11px] text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text)] transition-colors"
          title={isPinned ? "取消固定" : "保持显示"}
          aria-label={isPinned ? "取消固定" : "保持显示"}
          data-testid="pin-btn"
        >
          {isPinned ? "📌" : "📍"}
        </button>
        <button
          onClick={handleDismiss}
          className="text-[11px] text-[var(--kt-text-tertiary)] hover:text-[var(--kt-red)] transition-colors"
          title="关闭"
          aria-label="关闭"
          data-testid="dismiss-btn"
        >
          ✕
        </button>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-[11px] text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text)] transition-colors"
          title={expanded ? "收起图表" : "展开图表"}
          aria-label={expanded ? "收起图表" : "展开图表"}
          data-testid="expand-btn"
        >
          {expanded ? "▾" : "▸"}
        </button>
      </div>

      {/* Collapsed strip: sparklines */}
      <div className="flex items-stretch h-8 gap-1 px-2 pb-1 flex-shrink-0 border-b" style={{ borderColor: "var(--kt-border)" }}>
        <StripItem testid="strip-cpu" label="CPU" value={formatPct(metrics.cpu_percent)} data={stripData((h) => h.cpu_percent)} color={t.accent} t={t} />
        <StripItem testid="strip-mem" label="内存" value={formatPct(metrics.memory_percent)} data={stripData((h) => h.memory_percent)} color={t.warning} t={t} />
        <StripItem testid="strip-ctx" label="上下文" value={`${formatCompact(last?.ctx_switches_per_sec ?? 0)}/s`} data={stripData((h) => h.ctx_switches_per_sec)} color={t.success} t={t} />
        <StripItem testid="strip-disk" label="IOPS" value={formatCompact(last?.disk_iops ?? 0)} data={stripData((h) => h.disk_iops)} color={t.accent} t={t} />
        <StripItem testid="strip-net" label="网络" value={`↓${formatBytes(last?.network_rx_bytes ?? 0)}`} data={stripData((h) => h.network_rx_bytes)} color={t.warning} t={t} />
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div
          className="grid grid-cols-2 grid-rows-3 gap-2 p-2 flex-shrink-0"
          style={{ height: "clamp(220px, 38vh, 320px)" }}
        >
          <ChartCard testid="perf-cpu-gauge" title="CPU 使用率" value={<span data-testid="cpu-value">{formatPct(metrics.cpu_percent)}</span>}>
            <div ref={cpuRef} style={chartStyle} />
          </ChartCard>
          <ChartCard testid="perf-mem-gauge" title="内存使用率" value={<span data-testid="mem-value">{formatPct(metrics.memory_percent)}</span>}>
            <div ref={memRef} style={chartStyle} />
          </ChartCard>
          <ChartCard testid="perf-ctx-line" title="上下文切换" value={`${formatCompact(last?.ctx_switches_per_sec ?? 0)}/s`} dataPoints={history.length}>
            <div ref={ctxRef} style={chartStyle} />
          </ChartCard>
          <ChartCard testid="perf-pagefault-line" title="缺页次数" value={`${formatCompact(last?.page_faults_per_sec ?? 0)}/s`} dataPoints={history.length}>
            <div ref={pageFaultRef} style={chartStyle} />
          </ChartCard>
          <ChartCard testid="perf-disk-line" title="磁盘 IOPS" value={`${formatCompact(last?.disk_iops ?? 0)}`} dataPoints={history.length}>
            <div ref={diskRef} style={chartStyle} />
          </ChartCard>
          <ChartCard
            testid="perf-network-line"
            title="网络吞吐"
            value={`↓${formatBytes(last?.network_rx_bytes ?? 0)} ↑${formatBytes(last?.network_tx_bytes ?? 0)}`}
            dataPoints={history.length}
          >
            <div ref={netRef} style={chartStyle} />
          </ChartCard>
        </div>
      )}
    </div>
  );
}
