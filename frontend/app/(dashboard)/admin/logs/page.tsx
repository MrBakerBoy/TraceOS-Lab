"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getUser } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelHeader } from "@/components/ui/panel-header";
import { cn } from "@/lib/utils";
import {
  ScrollText, Search, ChevronLeft, ChevronRight, User, Globe, Clock, Activity, RefreshCw,
} from "lucide-react";

interface AuditLogEntry {
  id: string; user_id: string | null; username: string; action: string;
  resource_type: string | null; resource_id: string | null;
  ip_address: string | null; response_status: number | null; created_at: string;
}

const PAGE_SIZE = 50;

const ACTION_META: Record<string, { label: string; className: string }> = {
  login: { label: "登录", className: "text-blue-500 bg-blue-500/10" },
  submit_code: { label: "提交代码", className: "text-emerald-500 bg-emerald-500/10" },
  create_experiment: { label: "创建实验", className: "text-purple-500 bg-purple-500/10" },
  update_experiment: { label: "更新实验", className: "text-amber-500 bg-amber-500/10" },
  delete_experiment: { label: "删除实验", className: "text-rose-500 bg-rose-500/10" },
};

export default function AdminLogsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [searchUser, setSearchUser] = useState("");

  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== "admin") {
      router.replace("/experiments");
      return;
    }
    setUser(u);
  }, [router]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getAdminLogs({
        page,
        page_size: PAGE_SIZE,
        action: actionFilter || undefined,
      });
      setLogs((res.data || []) as AuditLogEntry[]);
      setTotal(res.total || 0);
    } catch (e: any) {
      setError(e?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => { if (user) fetchLogs(); }, [user, fetchLogs]);

  const filtered = useMemo(() => {
    if (!searchUser.trim()) return logs;
    const q = searchUser.toLowerCase();
    return logs.filter((l) =>
      (l.username || "").toLowerCase().includes(q) || l.id.toLowerCase().includes(q));
  }, [logs, searchUser]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!user) return null;

  const statusBadge = (code: number | null) => {
    if (!code) return null;
    const ok = code >= 200 && code < 300;
    return <Badge variant={ok ? "default" : "destructive"} className="text-[10px] px-1.5 h-5">{code}</Badge>;
  };

  return (
    <div className="px-4 py-6 md:px-6">
      <PanelHeader
        icon={ScrollText}
        title="审计日志"
        subtitle="系统操作记录与安全审计追踪"
        actions={
          <Button variant="ghost" size="sm" onClick={fetchLogs} className="gap-1.5">
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} /> 刷新
          </Button>
        }
      />

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索用户名..."
            value={searchUser}
            onChange={(e) => setSearchUser(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-[13px] rounded-lg border border-border/50 bg-card text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer transition-all h-9"
        >
          <option value="">全部操作</option>
          {Object.entries(ACTION_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <Button onClick={() => { setPage(1); fetchLogs(); }} size="sm" variant="outline" className="h-9 gap-1.5">
          <Activity className="size-4" /> 查询
        </Button>
      </div>

      {/* Stats bar */}
      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground bg-card/50 rounded-xl border border-border/30 px-4 py-2.5">
        <span className="flex items-center gap-1.5">
          <ScrollText className="size-3.5" /> 共 <span className="font-bold text-foreground">{total}</span> 条记录
        </span>
        <span className="w-px h-3 bg-border" />
        <span>第 <span className="font-bold text-foreground">{page}</span> / {totalPages} 页</span>
      </div>

      {/* Table */}
      <Card className="mt-4 overflow-hidden border-border/50">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : error ? (
            <EmptyState
              variant="error"
              title="日志加载失败"
              description={error}
              action={<Button variant="outline" size="sm" onClick={fetchLogs}>重试</Button>}
            />
          ) : filtered.length === 0 ? (
            <EmptyState variant="no-data" title="暂无日志记录" description="当前筛选条件下没有操作记录" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-left">
                  <th className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider"><Clock className="size-3 inline mr-1" />时间</th>
                  <th className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider"><User className="size-3 inline mr-1" />用户</th>
                  <th className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider"><Activity className="size-3 inline mr-1" />操作</th>
                  <th className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">资源</th>
                  <th className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider"><Globe className="size-3 inline mr-1" />IP</th>
                  <th className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {filtered.map((log, i) => {
                  const meta = ACTION_META[log.action];
                  return (
                    <tr key={log.id} className={cn(
                      "transition-colors duration-150",
                      i % 2 === 0 ? "bg-transparent" : "bg-muted/10",
                      "hover:bg-primary/5",
                    )}>
                      <td className="py-3 px-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString("zh-CN")}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium">{log.username || "—"}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium",
                          meta?.className || "text-muted-foreground bg-muted/50",
                        )}>
                          {meta?.label || log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground font-mono">
                        {log.resource_type && <span className="text-foreground/70">{log.resource_type}</span>}
                        {log.resource_id && <span> / {log.resource_id.slice(0, 12)}</span>}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-muted-foreground">{log.ip_address || "—"}</td>
                      <td className="py-3 px-4">{statusBadge(log.response_status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && !loading && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-muted/20">
            <span className="text-xs text-muted-foreground">共 {total} 条</span>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="h-8 w-8 p-0 rounded-lg"><ChevronLeft className="size-4" /></Button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pn = page <= 3 ? i + 1 : Math.min(i + page - 2, totalPages);
                if (pn > totalPages) return null;
                return (
                  <Button key={pn} variant={pn === page ? "default" : "ghost"} size="sm"
                    onClick={() => setPage(pn)} className="h-8 w-8 p-0 rounded-lg text-xs font-medium">{pn}</Button>
                );
              })}
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
                className="h-8 w-8 p-0 rounded-lg"><ChevronRight className="size-4" /></Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}