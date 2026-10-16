"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { showToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { FlaskConical, Plus, Edit, Eye, Trash2, Search, Filter, BookOpen, BarChart3 } from "lucide-react";

interface Experiment { id: string; name: string; title: string; category: string; difficulty: string; description?: string; submission_count?: number; pass_rate?: number; }

const CAT_MAP: Record<string, { label: string; color: string }> = {
  process: { label: "进程", color: "#0A84FF" },
  thread: { label: "线程", color: "#BF5AF2" },
  memory: { label: "内存", color: "#30D158" },
  fs: { label: "文件系统", color: "#FF9F0A" },
  scheduler: { label: "调度", color: "#FF453A" },
  deadlock: { label: "死锁", color: "#EC4899" },
};

const DIFF_LABEL: Record<string, string> = { easy: "入门", medium: "进阶", hard: "挑战" };

export default function TeacherExperimentsPage() {
  const router = useRouter();
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Experiment | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { loadExperiments(); }, []);

  const loadExperiments = async () => {
    setLoading(true);
    try { const res = await api.getExperiments({}); setExperiments(res.data || []); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteExperiment(deleteTarget.id);
      showToast("success", `实验 "${deleteTarget.title || deleteTarget.name}" 已删除`);
      setDeleteTarget(null);
      loadExperiments();
    } catch (err: any) {
      showToast("error", err?.message || "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const filtered = experiments.filter(e => {
    if (catFilter && e.category !== catFilter) return false;
    if (search) { const q = search.toLowerCase(); if (!(e.title||e.name).toLowerCase().includes(q) && !(e.description||"").toLowerCase().includes(q)) return false; }
    return true;
  });

  const cats = [...new Set(experiments.map(e => e.category))];

  return (
    <div className="p-8 animate-fade-in">
      <div className="absolute top-0 left-0 right-0 h-[2px] kernel-scan opacity-40" />

      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF9F0A] via-[#FF453A] to-[#BF5AF2] flex items-center justify-center shadow-lg shadow-orange-500/25">
              <FlaskConical className="size-5 text-white" strokeWidth={1.8} />
            </div>
          </div>
          <div>
            <h1 className="text-[28px] font-bold tracking-[-0.02em]">实验管理</h1>
            <p className="text-sm text-muted-foreground">管理操作系统实验题库</p>
          </div>
        </div>
        <Button
          className="rounded-xl gap-2 h-11 shadow-lg shadow-primary/20"
          onClick={() => router.push("/teacher/experiments/create")}
        >
          <Plus className="size-4" /> 创建实验
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="搜索实验..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-10 h-10 rounded-xl bg-muted/50 border-border/50 focus:bg-card transition-all" />
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          className="px-3.5 py-2 text-[13px] rounded-xl border border-border/50 bg-card text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer transition-all h-10">
          <option value="">全部类别</option>
          {cats.map(c => <option key={c} value={c}>{CAT_MAP[c]?.label || c}</option>)}
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <FlaskConical className="size-12 opacity-20" />
          <span className="text-sm">暂无实验</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 stagger-children">
          {filtered.map(exp => {
            const cat = CAT_MAP[exp.category] || { label: exp.category, color: "#6B7280" };
            return (
              <div key={exp.id}
                className="group rounded-xl border border-border/50 bg-card p-6 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:border-primary/20 card-inner-glow relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#FF9F0A] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                <div className="flex items-start justify-between mb-3">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium"
                    style={{ backgroundColor: `${cat.color}15`, color: cat.color }}>
                    {cat.label}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost" size="icon" className="size-7 rounded-lg"
                      onClick={(e) => { e.preventDefault(); router.push(`/teacher/experiments/${exp.id}/edit`); }}
                    >
                      <Edit className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="size-7 rounded-lg hover:text-destructive"
                      onClick={(e) => { e.preventDefault(); setDeleteTarget(exp); }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                <h3 className="text-[16px] font-semibold mb-1.5 line-clamp-1">{exp.title || exp.name}</h3>
                {exp.description && <p className="text-[13px] text-muted-foreground line-clamp-2 mb-4 leading-relaxed">{exp.description}</p>}

                <div className="flex items-center justify-between pt-4 border-t border-border/30 text-xs">
                  <Badge variant="outline" className="text-[11px]">{DIFF_LABEL[exp.difficulty] || exp.difficulty}</Badge>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    {exp.submission_count != null && (
                      <span className="flex items-center gap-1"><BarChart3 className="size-3" />{exp.submission_count} 提交</span>
                    )}
                    {exp.pass_rate != null && (
                      <span className="flex items-center gap-1"><BookOpen className="size-3" />{exp.pass_rate}%</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogPortal>
          <DialogOverlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
          <DialogContent className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6">
            <DialogTitle className="text-lg font-semibold mb-2">确认删除</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mb-6">
              确定要删除实验 <span className="font-medium text-foreground">"{deleteTarget?.title || deleteTarget?.name}"</span> 吗？此操作可恢复（软删除），但删除后学生将无法访问。
            </DialogDescription>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting} className="rounded-xl">
                取消
              </Button>
              <Button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-xl bg-destructive hover:bg-destructive/90"
              >
                {deleting ? "删除中..." : "确认删除"}
              </Button>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </div>
  );
}
