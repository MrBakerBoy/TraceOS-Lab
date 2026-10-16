"use client";

import { useCallback, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Users, FileCode, Layers, Activity, Shield, Brain, CheckCircle2,
  XCircle, Gauge, AlertTriangle, BarChart3, RefreshCw,
} from "lucide-react";
import { api, type AdminOverview } from "@/lib/api";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelHeader } from "@/components/ui/panel-header";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusVariant } from "@/components/ui/status-badge";
import { SkeletonKpiCard } from "@/components/ui/skeleton-card";
import { Button } from "@/components/ui/button";

const CATEGORY_NAMES: Record<string, string> = {
  process: "进程", thread: "线程", memory: "内存",
  scheduler: "调度", fs: "文件系统", deadlock: "死锁",
};
const CATEGORY_DOT: Record<string, string> = {
  process: "bg-blue-500", thread: "bg-purple-500", memory: "bg-emerald-500",
  scheduler: "bg-amber-500", fs: "bg-rose-500", deadlock: "bg-pink-500",
};

const statusVariant = (s: string): StatusVariant => {
  switch (s) {
    case "completed": return "success";
    case "running": return "running";
    case "pending": return "pending";
    case "failed":
    case "compile_error": return "error";
    case "timeout":
    case "memory_exceeded": return "warning";
    default: return "idle";
  }
};

function KpiCard({ label, value, suffix, icon: Icon }: {
  label: string; value: number; suffix?: string; icon: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-border">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground/70" strokeWidth={1.8} />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
        <AnimatedCounter value={value} suffix={suffix} />
      </div>
    </div>
  );
}

export default function AdminOverviewPanel() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getAdminOverview()
      .then(setOverview)
      .catch((e: any) => setError(e?.message || "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <PanelHeader
        icon={BarChart3}
        title="系统概览"
        subtitle="用户、提交、诊断与实验分布"
        actions={
          <Button variant="ghost" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} /> 刷新
          </Button>
        }
      />

      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonKpiCard key={i} />)}
        </div>
      ) : error || !overview ? (
        <EmptyState
          variant="error"
          title="概览加载失败"
          description={error || "无法获取系统概览数据"}
          action={<Button variant="outline" size="sm" onClick={load}>重试</Button>}
        />
      ) : (
        <>
          {/* 用户统计 */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Users className="size-4 text-muted-foreground" /> 用户统计
            </h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <KpiCard label="总用户" value={overview.users.total} icon={Users} />
              <KpiCard label="学生" value={overview.users.students} icon={Users} />
              <KpiCard label="教师" value={overview.users.teachers} icon={Users} />
              <KpiCard label="管理员" value={overview.users.admins} icon={Shield} />
              <KpiCard label="今日活跃" value={overview.users.active_today} icon={Activity} />
            </div>
          </section>

          {/* 提交统计 */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FileCode className="size-4 text-muted-foreground" /> 提交统计
            </h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard label="总提交" value={overview.submissions.total} icon={FileCode} />
              <KpiCard label="今日提交" value={overview.submissions.today} icon={Activity} />
              <KpiCard label="本周提交" value={overview.submissions.this_week} icon={Layers} />
              <KpiCard label="实验总数" value={overview.experiments.total} icon={Layers} />
            </div>
          </section>

          {/* 提交状态分布 */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Activity className="size-4 text-muted-foreground" /> 提交状态分布
            </h3>
            <div className="flex flex-wrap gap-3">
              {Object.entries(overview.submissions.status_breakdown).map(([status, count]) => (
                <div
                  key={status}
                  className="flex items-center gap-2 rounded-xl border border-border/50 bg-card px-4 py-3"
                >
                  <StatusBadge variant={statusVariant(status)} label={status} size="sm" />
                  <span className="text-lg font-semibold tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 诊断与类别分布 */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border/50 bg-card p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                <Brain className="size-4 text-muted-foreground" /> AI 诊断统计
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard label="总诊断" value={overview.diagnoses.total} icon={Brain} />
                <KpiCard label="已完成" value={overview.diagnoses.completed} icon={CheckCircle2} />
                <KpiCard label="失败" value={overview.diagnoses.failed} icon={XCircle} />
                <div className="rounded-xl border border-border/50 bg-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">平均置信度</span>
                    <Gauge className="size-4 text-muted-foreground/70" strokeWidth={1.8} />
                  </div>
                  <div className="mt-2 text-2xl font-semibold tabular-nums">
                    <AnimatedCounter value={overview.diagnoses.avg_confidence * 100} suffix="%" decimals={1} />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/50 bg-card p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                <Layers className="size-4 text-muted-foreground" /> 实验类别分布
              </h3>
              <div className="space-y-3">
                {Object.entries(overview.experiments.by_category).map(([cat, count]) => {
                  const pct = overview.experiments.total
                    ? Math.round((count / overview.experiments.total) * 100)
                    : 0;
                  return (
                    <div key={cat} className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CATEGORY_DOT[cat] || "bg-muted-foreground"}`} />
                      <span className="w-16 shrink-0 text-xs text-muted-foreground">
                        {CATEGORY_NAMES[cat] || cat}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${CATEGORY_DOT[cat] || "bg-muted-foreground"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* 热门错误 */}
          {overview.recent_errors.length > 0 && (
            <section className="rounded-xl border border-border/50 bg-card p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="size-4 text-muted-foreground" /> 热门错误类型 Top 5
              </h3>
              <div className="flex flex-wrap gap-2">
                {overview.recent_errors.map((e) => (
                  <span
                    key={e.error_type}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-3 py-1 text-xs"
                  >
                    {e.error_type}
                    <span className="font-semibold text-muted-foreground">{e.count}</span>
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}