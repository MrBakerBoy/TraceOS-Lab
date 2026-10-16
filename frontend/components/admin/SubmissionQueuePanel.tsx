"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Layers, RefreshCw, RotateCcw, CheckCircle2, Clock, Activity,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelHeader } from "@/components/ui/panel-header";
import { SkeletonTable } from "@/components/ui/skeleton-card";
import { showToast } from "@/components/ui/Toast";

interface StuckSubmission {
  id: string;
  experiment_id: string;
  student_name: string;
  status: string;
  created_at: string;
  stuck_minutes: number;
  experiment_title: string;
}

const statusVariant = (s: string): "default" | "secondary" | "outline" | "destructive" => {
  switch (s) {
    case "completed": return "default";
    case "running": return "secondary";
    case "pending": return "outline";
    case "failed":
    case "compile_error": return "destructive";
    default: return "secondary";
  }
};

export default function SubmissionQueuePanel() {
  const [queue, setQueue] = useState<StuckSubmission[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resetting, setResetting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getAdminSubmissionQueue({ stuck_minutes: 10 })
      .then((res: any) => {
        setQueue(res.data || []);
        setSummary(res.summary || {});
        setSelected(new Set());
      })
      .catch((e: any) => setError(e?.message || "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleReset = async () => {
    if (selected.size === 0) return;
    setResetting(true);
    try {
      const res: any = await api.batchResetSubmissions(Array.from(selected), "pending");
      showToast("success", `已重置 ${res?.reset_count ?? 0} 条提交`);
      load();
    } catch (e: any) {
      showToast("error", e?.message || "重置失败");
    } finally {
      setResetting(false);
    }
  };

  const summaryItems = [
    { key: "pending_count", label: "等待中", tone: "text-amber-500" },
    { key: "running_count", label: "运行中", tone: "text-blue-500" },
    { key: "stuck_count", label: "卡住", tone: "text-rose-500" },
    { key: "completed_count", label: "已完成", tone: "text-emerald-500" },
    { key: "failed_count", label: "失败", tone: "text-rose-500" },
    { key: "compile_error_count", label: "编译错误", tone: "text-orange-500" },
  ];

  return (
    <div className="space-y-4">
      <PanelHeader
        icon={Layers}
        title="提交队列"
        subtitle="卡住 / 运行中的提交"
        actions={
          <Button variant="ghost" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} /> 刷新
          </Button>
        }
      />

      {/* 概览 */}
      {Object.keys(summary).length > 0 && (
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          {summaryItems.map(({ key, label, tone }) => (
            <div key={key} className="rounded-xl border border-border/50 bg-card p-3 text-center">
              <div className={`text-xl font-semibold tabular-nums ${tone}`}>{summary[key] ?? 0}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">卡住的提交 ({queue.length})</span>
        <Button
          size="sm"
          variant="outline"
          disabled={selected.size === 0 || resetting}
          onClick={handleReset}
          className="gap-1.5"
        >
          <RotateCcw className="size-3.5" /> 批量重置 ({selected.size})
        </Button>
      </div>

      {loading ? (
        <SkeletonTable rows={5} />
      ) : error ? (
        <EmptyState variant="error" title="队列加载失败" description={error} action={<Button variant="outline" size="sm" onClick={load}>重试</Button>} />
      ) : queue.length === 0 ? (
        <EmptyState variant="no-data" title="没有卡住的提交" description="当前没有长时间处于运行中的提交" />
      ) : (
        <div className="space-y-2">
          {queue.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => toggleSelect(item.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleSelect(item.id); }}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors ${
                selected.has(item.id)
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/50 bg-card hover:border-border"
              }`}
            >
              <div
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                  selected.has(item.id) ? "border-primary bg-primary" : "border-muted-foreground/30"
                }`}
              >
                {selected.has(item.id) && <CheckCircle2 className="size-3 text-primary-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {item.experiment_title || item.experiment_id.slice(0, 8)}
                  </span>
                  <Badge variant={statusVariant(item.status)} className="text-[10px]">{item.status}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {item.student_name} · {new Date(item.created_at).toLocaleString("zh-CN")}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className="flex items-center gap-1 text-sm font-semibold text-amber-500">
                  <Clock className="size-3.5" /> {Math.round(item.stuck_minutes)}min
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}