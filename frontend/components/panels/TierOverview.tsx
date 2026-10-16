'use client';

import React from 'react';
import ViewHelpButton from "@/components/ui/ViewHelpButton";
import { TIER_HELP } from "@/lib/view-help-content";
import { useWorkspaceStore } from '@/stores/workspace';
import { Activity, AlertTriangle, CheckCircle2, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import type { ObsContext, HealthScore, REDMetrics, USEMetrics, AnomalyDigest } from '@/types/obs_context';

/**
 * TierOverview — Tier 1 (全景总览) of the TraceOS three-tier observability system.
 *
 * Design references:
 *   - Grafana "5-second rule": key insights must be identifiable within 5 seconds, no scrolling
 *   - F-type visual flow: KPI top-left, charts middle, tables bottom
 *   - RED+USE golden signals: Rate/Errors/Duration + Utilization/Saturation/Errors
 *
 * Composition: 4-6 panels max (anti-pattern: >40 panels per view)
 */
export default function TierOverview() {
  const obsContext = useWorkspaceStore((s) => s.obsContext);
  const setTier = useWorkspaceStore((s) => s.setTier);
  const setSelectedPanel = useWorkspaceStore((s) => s.setSelectedPanel);

  if (!obsContext) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        暂无观测数据。提交实验代码后将自动生成全景分析。
      </div>
    );
  }

  const { health_score, red_metrics, use_metrics, anomaly_summary } = obsContext;

  return (
    <div className="tier-overview space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--kt-text)]">全景总览</h3>
        <ViewHelpButton content={TIER_HELP} />
      </div>
      {/* Row 1: Health Score + Big Numbers (F-type: top-left priority) */}
      <div className="grid grid-cols-5 gap-3">
        <HealthScoreCard score={health_score} />
        <REDRateCard red={red_metrics} />
        <REDErrorCard red={red_metrics} />
        <REDDurationCard red={red_metrics} />
        <USESummaryCard use={use_metrics} />
      </div>

      {/* Row 2: Anomaly Summary */}
      <AnomalyPanel anomalies={anomaly_summary} onDrillDown={(panel) => {
        setSelectedPanel(panel);
        setTier(2);
      }} />
    </div>
  );
}

// ── Health Score Card ────────────────────────────────────────────

function HealthScoreCard({ score }: { score: HealthScore }) {
  const colorClass =
    score.score >= 85 ? 'text-emerald-500' :
    score.score >= 70 ? 'text-amber-500' :
    'text-red-500';

  const bgClass =
    score.score >= 85 ? 'bg-emerald-500/10' :
    score.score >= 70 ? 'bg-amber-500/10' :
    'bg-red-500/10';

  return (
    <div className={`rounded-lg border p-3 ${bgClass}`}>
      <div className="text-xs text-muted-foreground mb-1">健康评分</div>
      <div className={`text-2xl font-bold ${colorClass}`}>{score.score}</div>
      <div className="text-xs text-muted-foreground mt-1">
        {score.trend_direction === 'improving' ? (
          <span className="text-emerald-500 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> 改善中
          </span>
        ) : score.trend_direction === 'degrading' ? (
          <span className="text-red-500 flex items-center gap-1">
            <TrendingDown className="w-3 h-3" /> 退化中
          </span>
        ) : (
          <span className="flex items-center gap-1">稳定</span>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">
        SLO: {score.slo_compliance ? '达标' : '未达标'} · {score.active_anomalies}个异常
      </div>
    </div>
  );
}

// ── RED: Rate ─────────────────────────────────────────────────────

function REDRateCard({ red }: { red: REDMetrics }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-1">Rate (调用速率)</div>
      <div className="text-xl font-bold">{red.request_rate.toFixed(0)}</div>
      <div className="text-[10px] text-muted-foreground">syscalls/s</div>
    </div>
  );
}

// ── RED: Errors ───────────────────────────────────────────────────

function REDErrorCard({ red }: { red: REDMetrics }) {
  const colorClass = red.error_rate > 5 ? 'text-red-500' : red.error_rate > 1 ? 'text-amber-500' : 'text-emerald-500';
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-1">Errors (错误率)</div>
      <div className={`text-xl font-bold ${colorClass}`}>{red.error_rate.toFixed(1)}%</div>
      <div className="text-[10px] text-muted-foreground">
        {red.error_rate > 5 ? '⚠️ 需关注' : red.error_rate > 1 ? '注意' : '正常'}
      </div>
    </div>
  );
}

// ── RED: Duration ─────────────────────────────────────────────────

function REDDurationCard({ red }: { red: REDMetrics }) {
  const p99Color = red.duration_p99 > 100 ? 'text-red-500' : red.duration_p99 > 50 ? 'text-amber-500' : 'text-emerald-500';
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-1">Duration (延迟)</div>
      <div className={`text-xl font-bold ${p99Color}`}>{red.duration_p99.toFixed(1)}ms</div>
      <div className="text-[10px] text-muted-foreground">
        p50: {red.duration_p50.toFixed(1)} · p95: {red.duration_p95.toFixed(1)}
      </div>
    </div>
  );
}

// ── USE Summary ───────────────────────────────────────────────────

function USESummaryCard({ use }: { use: USEMetrics }) {
  const cpuColor = use.cpu_utilization > 80 ? 'text-red-500' : use.cpu_utilization > 60 ? 'text-amber-500' : 'text-emerald-500';
  const memColor = use.mem_utilization > 80 ? 'text-red-500' : use.mem_utilization > 60 ? 'text-amber-500' : 'text-emerald-500';

  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-1">USE (资源)</div>
      <div className="flex gap-3 text-xs">
        <span className={cpuColor}>CPU {use.cpu_utilization.toFixed(0)}%</span>
        <span className={memColor}>MEM {use.mem_utilization.toFixed(0)}%</span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">
        错误: {use.error_count} · 饱和: {use.cpu_saturation.toFixed(1)}
      </div>
    </div>
  );
}

// ── Anomaly Panel ─────────────────────────────────────────────────

function AnomalyPanel({ anomalies, onDrillDown }: {
  anomalies: AnomalyDigest[];
  onDrillDown: (panel: string) => void;
}) {
  if (!anomalies || anomalies.length === 0) {
    return (
      <div className="rounded-lg border p-4 flex items-center gap-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
        <div>
          <div className="text-sm font-medium">无检测到的异常</div>
          <div className="text-xs text-muted-foreground">程序运行正常，未发现死锁、泄漏或性能问题</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-4 py-2 bg-muted/50 border-b flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500" />
        <span className="text-sm font-medium">异常摘要 ({anomalies.length}个)</span>
      </div>
      <div className="divide-y">
        {anomalies.map((a, i) => (
          <button
            key={i}
            onClick={() => onDrillDown(a.link_to_tier2_panel)}
            className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left"
          >
            <SeverityIcon severity={a.severity} />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{a.summary}</div>
              <div className="text-[10px] text-muted-foreground">
                {a.type} · 点击展开到 Tier 2 深度分析
              </div>
            </div>
            {a.coffman_conditions && a.coffman_conditions.length > 0 && (
              <span className="text-[10px] text-amber-500 px-1.5 py-0.5 rounded bg-amber-500/10">
                Coffman: {a.coffman_conditions.length}/4
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case 'critical':
      return <Zap className="w-4 h-4 text-red-500 flex-shrink-0" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />;
    default:
      return <Activity className="w-4 h-4 text-blue-500 flex-shrink-0" />;
  }
}
