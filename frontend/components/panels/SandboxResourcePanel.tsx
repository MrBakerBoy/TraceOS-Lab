'use client';

import React from 'react';
import { useWorkspaceStore } from '@/stores/workspace';
import { Cpu, HardDrive, Activity, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ResourceMetric, RiskIndicators } from '@/types/obs_context';

/**
 * SandboxResourcePanel — cAdvisor-style sandbox resource monitor.
 *
 * Design reference: cAdvisor per-container 90+ metrics + cgroup limit visualization.
 * Shows: CPU, Memory, I/O, FD, Threads, Page Faults, CFS throttling, OOM score.
 */
export default function SandboxResourcePanel() {
  const obsContext = useWorkspaceStore((s) => s.obsContext);
  const metrics: ResourceMetric[] = obsContext?.resource_metrics || [];
  const risk: RiskIndicators | undefined = obsContext?.risk_indicators;

  const latest = metrics.length > 0 ? metrics[metrics.length - 1] : null;

  if (!latest) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        暂无沙箱资源数据
      </div>
    );
  }

  const cpuColor = latest.cpu_percent > 80 ? 'text-red-500' : latest.cpu_percent > 60 ? 'text-amber-500' : 'text-emerald-500';
  const memColor = risk && risk.oom_risk_rate > 0.8 ? 'text-red-500' : risk && risk.oom_risk_rate > 0.6 ? 'text-amber-500' : 'text-emerald-500';
  const fdColor = latest.fd_count > 800 ? 'text-red-500' : latest.fd_count > 400 ? 'text-amber-500' : 'text-emerald-500';

  return (
    <div className="sandbox-resource-panel space-y-4">
      {/* Row 1: Risk Indicators (Grafana composite) */}
      {risk && (
        <div className="grid grid-cols-4 gap-3">
          <RiskCard label="健康评分" value={risk.health_score.toFixed(0)} unit="/100" color={risk.health_score > 70 ? 'text-emerald-500' : 'text-red-500'} />
          <RiskCard label="饱和度" value={risk.saturation_index.toFixed(2)} unit="" color={risk.saturation_index > 0.7 ? 'text-red-500' : 'text-amber-500'} />
          <RiskCard label="OOM风险" value={(risk.oom_risk_rate * 100).toFixed(0)} unit="%" color={risk.oom_risk_rate > 0.8 ? 'text-red-500' : 'text-emerald-500'} />
          <RiskCard label="依赖风险" value={risk.dependency_risk.toFixed(2)} unit="" color={risk.dependency_risk > 0.5 ? 'text-amber-500' : 'text-emerald-500'} />
        </div>
      )}

      {/* Row 2: Core metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricTile icon={<Cpu className="w-4 h-4" />} label="CPU" value={latest.cpu_percent.toFixed(1)} unit="%" color={cpuColor} />
        <MetricTile icon={<HardDrive className="w-4 h-4" />} label="Memory RSS" value={formatBytes(latest.mem_rss)} unit="" color={memColor} />
        <MetricTile icon={<FileText className="w-4 h-4" />} label="FD" value={String(latest.fd_count)} unit="" color={fdColor} />
        <MetricTile icon={<Activity className="w-4 h-4" />} label="线程" value={String(latest.thread_count)} unit="" color="text-foreground" />
      </div>

      {/* Row 3: cAdvisor-style detailed indicators */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
        <StatChip label="PageFault(次)" value={String(latest.page_fault_min)} />
        <StatChip label="PageFault(主)" value={String(latest.page_fault_maj)} />
        <StatChip label="上下文切换" value={String(latest.context_switches)} />
        <StatChip label="CFS节流" value={`${(latest.cfs_throttled_us / 1000).toFixed(0)}ms`} alert={latest.cfs_throttled_us > 0} />
        <StatChip label="OOM Score" value={String(latest.oom_score)} alert={latest.oom_score > 500} />
        <StatChip label="I/O写" value={formatBytes(latest.io_write_bytes)} />
      </div>

      {/* Row 4: cgroup limit gauges */}
      <div className="space-y-2">
        <LimitGauge label="CPU 限制" current={latest.cpu_percent} max={100} unit="%" />
        <LimitGauge label="内存限制" current={risk ? risk.mem_saturation_pct : 0} max={100} unit="%" />
        <LimitGauge label="FD 限制" current={latest.fd_count} max={latest.fd_count > 0 ? 1024 : 100} unit="个" />
      </div>

      {/* Alerts */}
      <AlertsSection metrics={latest} />
    </div>
  );
}

function RiskCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}<span className="text-xs font-normal">{unit}</span></div>
    </div>
  );
}

function MetricTile({ icon, label, value, unit, color }: { icon: React.ReactNode; label: string; value: string; unit: string; color: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className={`text-lg font-bold ${color}`}>{value}<span className="text-xs font-normal ml-1">{unit}</span></div>
    </div>
  );
}

function StatChip({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`rounded-md border px-2 py-1.5 ${alert ? 'border-amber-500/30 bg-amber-500/5' : ''}`}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-xs font-medium ${alert ? 'text-amber-600' : ''}`}>{value}</div>
    </div>
  );
}

function LimitGauge({ label, current, max, unit }: { label: string; current: number; max: number; unit: string }) {
  const pct = Math.min(100, (current / max) * 100);
  const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-muted-foreground flex-shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 text-right text-muted-foreground">
        {current.toFixed(0)}/{max}{unit}
      </span>
    </div>
  );
}

function AlertsSection({ metrics }: { metrics: ResourceMetric }) {
  const alerts: { type: string; msg: string }[] = [];

  if (metrics.oom_score > 500) alerts.push({ type: 'critical', msg: 'OOM Score > 500，OOM Kill 风险高' });
  if (metrics.cfs_throttled_us > 0) alerts.push({ type: 'warning', msg: 'CPU 配额耗尽，CFS 调度器已节流' });
  if (metrics.fd_count > 800) alerts.push({ type: 'warning', msg: `FD 使用 ${metrics.fd_count}，接近 1024 限制` });
  if (metrics.page_fault_maj > 0) alerts.push({ type: 'info', msg: `检测到 ${metrics.page_fault_maj} 次主缺页（磁盘 I/O）` });

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-600 px-1">
        <CheckCircle2 className="w-3.5 h-3.5" />
        无资源告警
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {alerts.map((a, i) => (
        <div key={i} className="flex items-center gap-2 text-xs px-1">
          <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 ${a.type === 'critical' ? 'text-red-500' : a.type === 'warning' ? 'text-amber-500' : 'text-blue-500'}`} />
          <span className="text-muted-foreground">{a.msg}</span>
        </div>
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(0) + 'MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + 'KB';
  return bytes + 'B';
}
