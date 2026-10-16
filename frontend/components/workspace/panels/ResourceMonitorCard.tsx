"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWorkspaceStore } from "@/stores/workspace";
import { PanelHeader } from "@/components/ui/panel-header";
import ViewHelpButton from "@/components/ui/ViewHelpButton";
import { RESOURCE_HELP } from "@/lib/view-help-content";
import {
  Cpu, MemoryStick, HardDrive, Activity, Zap, FileDigit,
  GitBranch, AlertTriangle, Layers, ArrowUp, ArrowDown, Minus,
  Clock, Radio, Gauge, Timer
} from "lucide-react";
import type { RiskIndicators } from "@/types/workspace";

// ── AnimatedCounter ─────────────────────────────────────────
function AnimatedCounter({ value, suffix = "", duration = 600 }: {
  value: number; suffix?: string; duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const prevValue = useRef(value);
  const rafRef = useRef<number>();

  useEffect(() => {
    const start = prevValue.current;
    const end = value;
    if (start === end) { setDisplay(end); return; }
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
      else prevValue.current = end;
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  return <span className="tabular-nums font-mono font-bold">{display.toFixed(1)}{suffix}</span>;
}

// ── StatChange badge ────────────────────────────────────────
function StatChange({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const delta = current - previous;
  const pct = (delta / previous) * 100;
  if (Math.abs(pct) < 1) return <Minus className="size-3 text-kt-text-tertiary" />;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-mono ${up ? 'text-red-400' : 'text-green-400'}`}>
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

// ── formatters ──────────────────────────────────────────────
function round1(v: number): number { return Math.round(v * 10) / 10; }
function formatPct(v: number): string { return round1(v).toFixed(1) + "%"; }
function formatBytes(b: number): string {
  if (b <= 0) return "0 B";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + " MB";
  return (b / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

// ── StatusBadge (alarm linkage) ─────────────────────────────
function StatusBadge({ healthScore, hasAlerts }: { healthScore: number; hasAlerts: boolean }) {
  const isCritical = healthScore < 50 || hasAlerts;
  const isWarning = !isCritical && healthScore < 70;
  const color = isCritical ? "text-red-400" : isWarning ? "text-yellow-400" : "text-green-400";
  const bg = isCritical ? "bg-red-950/40 border-red-500/40" : isWarning ? "bg-yellow-950/40 border-yellow-500/40" : "bg-green-950/40 border-green-500/40";
  const label = isCritical ? "异常" : isWarning ? "注意" : "正常";

  return (
    <motion.div
      animate={isCritical ? { x: [0, -2, 2, -2, 0] } : {}}
      transition={isCritical ? { repeat: Infinity, duration: 0.4, repeatDelay: 2 } : {}}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${bg}`}
    >
      <span className={`relative flex h-2 w-2`}>
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isCritical ? 'bg-red-400' : isWarning ? 'bg-yellow-400' : 'bg-green-400'}`} />
        <span className={`relative inline-flex rounded-full h-2 w-2 ${isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-green-500'}`} />
      </span>
      <span className={color}>{label}</span>
    </motion.div>
  );
}

// ── Mini gauge ring ─────────────────────────────────────────
function MiniGauge({ value, max, label, unit = "%" }: { value: number; max: number; label: string; unit?: string }) {
  const pct = Math.min((value / (max || 1)) * 100, 100);
  const color = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#22c55e";
  const r = 26;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct / 100);

  return (
    <div className="flex flex-col items-center">
      <svg width="64" height="64" className="transform -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="5"
          className="text-kt-bg-tertiary opacity-50" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease", filter: pct >= 90 ? 'drop-shadow(0 0 4px rgba(239,68,68,0.5))' : undefined }} />
      </svg>
      <div className="-mt-10 text-center">
        <span className="text-xs font-bold font-mono" style={{ color }}>{round1(pct)}{unit}</span>
      </div>
      <span className="text-[10px] text-kt-text-tertiary mt-1">{label}</span>
    </div>
  );
}

// ── Stat chip (cAdvisor fine metric) ────────────────────────
function StatChip({ icon, label, value, sub, alert, prevValue }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; alert?: boolean; prevValue?: number;
}) {
  return (
    <div className={`flex items-center gap-2 px-2.5 py-2 rounded border transition-colors ${
      alert ? "bg-red-950/20 border-red-500/30" : "bg-kt-bg-tertiary/50 border-kt-border/30"
    }`}>
      <span className={alert ? "text-red-400" : "text-kt-text-tertiary"}>{icon}</span>
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-bold font-mono ${alert ? "text-red-400" : "text-kt-text-primary"}`}>
            {value}
          </span>
          {prevValue !== undefined && <StatChange current={parseFloat(value)} previous={prevValue} />}
        </div>
        <span className="text-[9px] text-kt-text-tertiary truncate">{label}{sub ? ` · ${sub}` : ""}</span>
      </div>
    </div>
  );
}

// ── cgroup limit bar ────────────────────────────────────────
function CgroupBar({ label, used, limit, unit, icon }: {
  label: string; used: number; limit: number; unit: string; icon?: React.ReactNode;
}) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-2">
      {icon && <span className="text-kt-text-tertiary shrink-0">{icon}</span>}
      <span className="text-[10px] text-kt-text-tertiary w-8 text-right shrink-0">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-kt-bg-tertiary overflow-hidden">
        <motion.div className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }} />
      </div>
      <span className="text-[10px] text-kt-text-tertiary font-mono w-28 text-right shrink-0">
        {typeof used === 'number' ? round1(used) : used}{unit} / {limit}{unit}
      </span>
    </div>
  );
}

// ── Event annotation timeline ───────────────────────────────
function EventTimeline({ events }: { events: { time: string; label: string; type: string }[] }) {
  if (!events || events.length === 0) return null;
  return (
    <div className="mx-3 mt-2 p-2 rounded bg-kt-bg-tertiary/30 border border-kt-border/20">
      <div className="text-[10px] text-kt-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
        <Clock className="size-3" /> 事件时间轴
      </div>
      <div className="relative pl-4 border-l border-kt-border/40 space-y-1">
        {events.slice(-6).map((ev, i) => (
          <div key={i} className="relative text-[10px]">
            <span className={`absolute -left-[17px] top-1 w-2 h-2 rounded-full ${
              ev.type === 'critical' ? 'bg-red-500' : ev.type === 'warning' ? 'bg-yellow-500' : 'bg-kt-cyan'
            }`} />
            <span className="text-kt-text-tertiary font-mono mr-1.5">{ev.time}</span>
            <span className="text-kt-text-secondary">{ev.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── RED metrics row ─────────────────────────────────────────
function REDMetricsRow({ metrics }: { metrics?: { rate: number; error_rate: number; p95: number } }) {
  if (!metrics) return null;
  return (
    <div className="mx-3 grid grid-cols-3 gap-2">
      <div className="flex flex-col items-center p-1.5 rounded bg-kt-bg-tertiary/30">
        <span className="text-[9px] text-kt-text-tertiary">Rate</span>
        <span className="text-xs font-bold font-mono text-kt-text-primary">{metrics.rate.toFixed(1)}/s</span>
      </div>
      <div className="flex flex-col items-center p-1.5 rounded bg-kt-bg-tertiary/30">
        <span className="text-[9px] text-kt-text-tertiary">Errors</span>
        <span className={`text-xs font-bold font-mono ${metrics.error_rate > 5 ? 'text-red-400' : 'text-green-400'}`}>
          {metrics.error_rate.toFixed(1)}%
        </span>
      </div>
      <div className="flex flex-col items-center p-1.5 rounded bg-kt-bg-tertiary/30">
        <span className="text-[9px] text-kt-text-tertiary">P95</span>
        <span className="text-xs font-bold font-mono text-kt-text-primary">{metrics.p95.toFixed(1)}ms</span>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────
export default function ResourceMonitorCard() {
  type ViewMode = "gauges" | "risk" | "events" | "alerts";
  const [viewMode, setViewMode] = useState<ViewMode>("gauges");

  const sandboxMetrics = useWorkspaceStore((s: any) => s.sandboxMetrics ?? null);
  const compositeTrigger = useWorkspaceStore((s: any) => s.compositeTrigger ?? null);
  const riskIndicators = useWorkspaceStore((s: any) => s.riskIndicators ?? null) as RiskIndicators | null;
  const obsContext = useWorkspaceStore((s: any) => s.obsContext ?? null);

  // Derive alert state from risk indicators
  const hasAlerts = useMemo(() => {
    if (compositeTrigger?.should_trigger) return true;
    if (!riskIndicators) return false;
    return riskIndicators.health_score < 70 || riskIndicators.oom_risk_rate > 0.8;
  }, [riskIndicators, compositeTrigger]);

  // Derive events for timeline
  const eventAnnotations = useMemo(() => {
    const events: { time: string; label: string; type: string }[] = [];

    // Backend event annotations (take priority)
    if (obsContext?.event_annotations) {
      for (const ea of obsContext.event_annotations) {
        if (!ea) continue;
        events.push({
          time: ea.timestamp || ea.time || '',
          label: ea.label || ea.description || '',
          type: ea.severity === 'critical' ? 'critical' : ea.severity === 'warning' ? 'warning' : 'info',
        });
      }
    }

    // Composite trigger signals as events
    if (compositeTrigger?.should_trigger && compositeTrigger.active_signals) {
      for (const signal of compositeTrigger.active_signals) {
        if (!signal) continue;
        let sev = 'warning';
        if (signal === 'deadlock' || signal === 'race_condition') sev = 'critical';
        events.push({
          time: compositeTrigger.evaluated_at || '',
          label: signal.replace(/_/g, ' '),
          type: sev,
        });
      }
    }

    // Sandbox metrics thresholds (fallback)
    if (riskIndicators?.oom_risk_rate > 0.8) events.push({ time: 'now', label: 'OOM 风险 (>80%)', type: 'critical' });
    if (sandboxMetrics?.mem_oom_events > 0) events.push({ time: 'now', label: 'OOM Kill 事件', type: 'critical' });
    if (sandboxMetrics?.cpu_cfs_throttled_ms > 0) events.push({ time: 'now', label: 'CFS 节流', type: 'warning' });
    if (sandboxMetrics?.fd_count > 20) events.push({ time: 'now', label: 'FD 泄漏风险', type: 'warning' });

    return events;
  }, [riskIndicators, sandboxMetrics, obsContext, compositeTrigger]);

  if (!sandboxMetrics && !riskIndicators) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader icon={Activity} title="沙箱资源监控" subtitle="cAdvisor 风格 · cgroup 限制 + OOM 检测" actions={<ViewHelpButton content={RESOURCE_HELP} />} />
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-kt-border/20">
          {(["gauges", "risk", "events", "alerts"] as ViewMode[]).map((m) => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors ${
                viewMode === m ? "bg-kt-accent text-white" : "text-kt-text-secondary hover:text-kt-text-primary"
              }`}>
              {{ gauges: "仪表盘", risk: "风险评估", events: "事件标注", alerts: "告警" }[m]}
            </button>
          ))}
        </div>
        <div className="flex-1 flex items-center justify-center flex-col gap-2 px-6 text-kt-text-tertiary">
          <Layers className="w-10 h-10 opacity-30" />
          <p className="text-sm">运行实验后展示沙箱资源指标</p>
          <p className="text-xs opacity-60">CPU 节流 · 内存限制 · FD · Page Fault · OOM 事件</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader icon={Activity} title="沙箱资源监控" subtitle="Grafana 风格 · 细粒度指标" actions={<ViewHelpButton content={RESOURCE_HELP} />} />

      {/* View switcher + status badge */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-kt-border/20 justify-between">
        <div className="flex items-center gap-1">
          {(["gauges", "risk", "events", "alerts"] as ViewMode[]).map((m) => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors ${
                viewMode === m ? "bg-kt-accent text-white" : "text-kt-text-secondary hover:text-kt-text-primary"
              }`}>
              {{ gauges: "仪表盘", risk: "风险评估", events: "事件标注", alerts: "告警" }[m]}
            </button>
          ))}
        </div>
        {riskIndicators && (
          <StatusBadge healthScore={riskIndicators.health_score} hasAlerts={hasAlerts} />
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={viewMode}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }} className="flex-1 overflow-y-auto">

          {viewMode === "gauges" && sandboxMetrics && (
            <div className="space-y-3 py-2">
              {/* Row 1: Health score + big numbers */}
              {riskIndicators && (
                <div className="mx-3 flex items-center justify-between px-3 py-2 rounded-lg bg-kt-bg-secondary border border-kt-border">
                  <div className="flex items-center gap-3">
                    <Gauge className="size-5 text-kt-accent" />
                    <div>
                      <div className="text-[10px] text-kt-text-tertiary uppercase">健康评分</div>
                      <div className="flex items-baseline gap-1">
                        <AnimatedCounter value={riskIndicators.health_score} />
                        <span className="text-[11px] text-kt-text-tertiary">/100</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-kt-text-tertiary">趋势</div>
                    <span className={`text-xs font-semibold ${
                      (riskIndicators as any).trend_direction === 'degrading' ? 'text-red-400' :
                      (riskIndicators as any).trend_direction === 'improving' ? 'text-green-400' : 'text-kt-text-secondary'
                    }`}>
                      {(riskIndicators as any).trend_direction === 'degrading' ? '⚠ 降级' :
                       (riskIndicators as any).trend_direction === 'improving' ? '↑ 改善' : '→ 稳定'}
                    </span>
                  </div>
                </div>
              )}

              {/* Row 2: RED metrics */}
              <REDMetricsRow metrics={obsContext?.red_metrics ? {
                rate: obsContext.red_metrics.request_rate,
                error_rate: obsContext.red_metrics.error_rate,
                p95: obsContext.red_metrics.duration_p95,
              } : undefined} />

              {/* Row 3: Primary gauges (USE) */}
              <div className="mx-3 grid grid-cols-4 gap-2">
                <MiniGauge value={sandboxMetrics.cpu_percent} max={100} label="CPU" />
                <MiniGauge value={sandboxMetrics.mem_percent} max={100} label="Memory" />
                <MiniGauge value={sandboxMetrics.io_wait_percent} max={100} label="I/O" />
                <MiniGauge value={sandboxMetrics.mem_oom_risk ? sandboxMetrics.mem_oom_risk * 100 : 0} max={100} label="OOM" />
              </div>

              {/* Row 4: cgroup limits */}
              <div className="mx-3 p-3 rounded-lg bg-kt-bg-secondary border border-kt-border">
                <div className="text-[10px] text-kt-text-tertiary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Radio className="size-3" /> cgroup 限制
                </div>
                <div className="space-y-2">
                  <CgroupBar label="CPU" used={round1(sandboxMetrics.cpu_percent)} limit={100} unit="%"
                    icon={<Cpu className="size-3" />} />
                  <CgroupBar label="内存"
                    used={sandboxMetrics.mem_working_set_bytes > 0
                      ? round1(sandboxMetrics.mem_working_set_bytes / 1024 / 1024) : 0}
                    limit={sandboxMetrics.mem_limit_bytes > 0
                      ? round1(sandboxMetrics.mem_limit_bytes / 1024 / 1024) : 256}
                    unit="MB" icon={<MemoryStick className="size-3" />} />
                  <CgroupBar label="OOM"
                    used={sandboxMetrics.mem_oom_risk ? round1(sandboxMetrics.mem_oom_risk * 100) : 0}
                    limit={100} unit="%" icon={<AlertTriangle className="size-3" />} />
                </div>
              </div>

              {/* Row 5: cAdvisor fine-grained metrics */}
              <div className="mx-3 grid grid-cols-2 gap-2">
                <StatChip icon={<GitBranch className="size-3" />}
                  label="线程数" value={String(sandboxMetrics.thread_count)}
                  sub={`运行: ${sandboxMetrics.thread_running ?? '-'} · 休眠: ${sandboxMetrics.thread_sleeping ?? '-'}`} />
                <StatChip icon={<FileDigit className="size-3" />}
                  label="FD 数" value={`${sandboxMetrics.fd_count}/${sandboxMetrics.fd_soft_limit ?? 1024}`}
                  alert={sandboxMetrics.fd_count > 20}
                  sub={sandboxMetrics.fd_count > 20 ? "⚠ FD 泄漏风险" : "正常"} />
                <StatChip icon={<Zap className="size-3" />}
                  label="Page Faults" value={String(sandboxMetrics.page_faults_minor ?? 0)}
                  sub={`次: ${sandboxMetrics.page_faults_minor ?? 0} · 主: ${sandboxMetrics.page_faults_major ?? 0}`} />
                <StatChip icon={<Timer className="size-3" />}
                  label="CFS 节流" value={sandboxMetrics.cpu_cfs_throttled_ms > 0 ? `${round1(sandboxMetrics.cpu_cfs_throttled_ms)}ms` : "无"}
                  alert={sandboxMetrics.cpu_cfs_throttled_ms > 0} />
                <StatChip icon={<AlertTriangle className="size-3" />}
                  label="OOM 事件" value={String(sandboxMetrics.mem_oom_events ?? 0)}
                  alert={(sandboxMetrics.mem_oom_events ?? 0) > 0}
                  sub={(sandboxMetrics.mem_oom_events ?? 0) > 0 ? "程序被 OOM Kill!" : "安全"} />
                <StatChip icon={<Activity className="size-3" />}
                  label="上下文切换" value={String(sandboxMetrics.context_switches ?? 0)}
                  sub="vol + invol" />
                <StatChip icon={<HardDrive className="size-3" />}
                  label="磁盘 I/O" value={formatBytes((sandboxMetrics.io_read_bytes ?? 0) + (sandboxMetrics.io_write_bytes ?? 0))}
                  sub={`读: ${formatBytes(sandboxMetrics.io_read_bytes ?? 0)} · 写: ${formatBytes(sandboxMetrics.io_write_bytes ?? 0)}`} />
                <StatChip icon={<MemoryStick className="size-3" />}
                  label="Working Set" value={formatBytes(sandboxMetrics.mem_working_set_bytes ?? 0)}
                  sub={`限制: ${formatBytes(sandboxMetrics.mem_limit_bytes ?? 0)}`} />
              </div>

              {/* Event timeline */}
              <EventTimeline events={eventAnnotations} />
            </div>
          )}

          {viewMode === "risk" && riskIndicators && (
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded bg-kt-bg-elevated border border-kt-border/30">
                  <div className="text-[10px] text-kt-text-tertiary uppercase">饱和度指数</div>
                  <div className="text-lg font-bold font-mono text-kt-text-primary mt-1">
                    {(riskIndicators.saturation_index * 100).toFixed(0)}%
                  </div>
                  <div className="mt-1.5 space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-kt-text-tertiary">CPU</span>
                      <span className="text-kt-text-secondary">{riskIndicators.cpu_saturation_pct.toFixed(0)}%</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-kt-text-tertiary">Memory</span>
                      <span className="text-kt-text-secondary">{riskIndicators.mem_saturation_pct.toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
                <div className="p-3 rounded bg-kt-bg-elevated border border-kt-border/30">
                  <div className="text-[10px] text-kt-text-tertiary uppercase">依赖风险</div>
                  <div className="text-lg font-bold font-mono text-kt-text-primary mt-1">
                    {(riskIndicators.dependency_risk * 100).toFixed(0)}%
                  </div>
                  <div className="mt-1.5 space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-kt-text-tertiary">FD 压力</span>
                      <span className="text-kt-text-secondary">{riskIndicators.fd_saturation_pct.toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
                <div className="p-3 rounded bg-kt-bg-elevated border border-kt-border/30">
                  <div className="text-[10px] text-kt-text-tertiary uppercase">积压增长</div>
                  <div className="text-lg font-bold font-mono text-kt-text-primary mt-1">
                    {riskIndicators.backlog_growth.toFixed(1)}/s
                  </div>
                </div>
                <div className="p-3 rounded bg-kt-bg-elevated border border-kt-border/30">
                  <div className="text-[10px] text-kt-text-tertiary uppercase">OOM 风险</div>
                  <div className={`text-lg font-bold font-mono mt-1 ${riskIndicators.oom_risk_rate > 0.8 ? 'text-red-400' : 'text-kt-text-primary'}`}>
                    {(riskIndicators.oom_risk_rate * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
            </div>
          )}

          {viewMode === "events" && (
            <div className="p-3">
              <div className="p-3 rounded bg-kt-bg-elevated border border-kt-border/30">
                <div className="text-[10px] text-kt-text-tertiary uppercase tracking-wider mb-2">Datadog 风格事件标注</div>
                <EventTimeline events={eventAnnotations} />
                {eventAnnotations.length === 0 && (
                  <p className="text-xs text-kt-text-tertiary py-3 text-center">暂无异常事件</p>
                )}
              </div>
            </div>
          )}

          {viewMode === "alerts" && (
            <div className="p-3 space-y-2">
              {eventAnnotations.filter(e => e.type !== 'info').length === 0 ? (
                <div className="p-3 rounded bg-kt-bg-elevated border border-kt-border/30 text-center">
                  <p className="text-xs text-kt-text-tertiary">✅ 无告警</p>
                </div>
              ) : (
                eventAnnotations.filter(e => e.type !== 'info').map((ev, i) => (
                  <div key={i} className={`p-2.5 rounded border ${
                    ev.type === 'critical' ? 'bg-red-950/20 border-red-500/30' : 'bg-yellow-950/20 border-yellow-500/30'
                  }`}>
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      {ev.type === 'critical' ? '🔴' : '🟡'} {ev.label}
                    </div>
                    <div className="text-[10px] text-kt-text-tertiary mt-0.5">{ev.time}</div>
                  </div>
                ))
              )}
            </div>
          )}

        </motion.div>
      </AnimatePresence>
    </div>
  );
}
