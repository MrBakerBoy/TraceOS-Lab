"use client";

import { useCallback, useEffect, useState } from "react";
import { Settings, RefreshCw, Pencil, Trash2, Layers } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelHeader } from "@/components/ui/panel-header";
import { SkeletonTable } from "@/components/ui/skeleton-card";
import { showToast } from "@/components/ui/Toast";

interface ExpConfig {
  id: string;
  name: string;
  title: string;
  category: string;
  difficulty: string;
  time_limit: number;
  memory_limit: number;
  sandbox_level: number;
  max_submissions: number;
  is_published: boolean;
  submission_count: number;
  pass_rate: number;
  test_case_count: number;
}

const CATEGORY_NAMES: Record<string, string> = {
  process: "进程", thread: "线程", memory: "内存",
  scheduler: "调度", fs: "文件系统", deadlock: "死锁",
};
const CATEGORY_DOT: Record<string, string> = {
  process: "bg-blue-500", thread: "bg-purple-500", memory: "bg-emerald-500",
  scheduler: "bg-amber-500", fs: "bg-rose-500", deadlock: "bg-pink-500",
};
const DIFFICULTIES = [
  { value: "easy", label: "入门" },
  { value: "medium", label: "进阶" },
  { value: "hard", label: "挑战" },
];

const toMB = (bytes: number) => Math.round(bytes / 1048576);

export default function ExperimentConfigPanel() {
  const [configs, setConfigs] = useState<ExpConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [editTarget, setEditTarget] = useState<ExpConfig | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpConfig | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getAdminExperimentConfigs(catFilter ? { category: catFilter } : {})
      .then((res: any) => setConfigs(res.data || []))
      .catch((e: any) => setError(e?.message || "加载失败"))
      .finally(() => setLoading(false));
  }, [catFilter]);

  useEffect(() => { load(); }, [load]);

  const togglePublish = async (cfg: ExpConfig) => {
    try {
      await api.updateExperiment(cfg.id, { is_published: !cfg.is_published });
      showToast("success", cfg.is_published ? "已下架" : "已发布");
      load();
    } catch (e: any) {
      showToast("error", e?.message || "操作失败");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.deleteExperiment(deleteTarget.id);
      showToast("success", "实验已删除");
      setDeleteTarget(null);
      load();
    } catch (e: any) {
      showToast("error", e?.message || "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PanelHeader
        icon={Settings}
        title="实验配置"
        subtitle={`共 ${configs.length} 个实验`}
        actions={
          <Button variant="ghost" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} /> 刷新
          </Button>
        }
      />

      <div className="flex items-center gap-2">
        <Select value={catFilter || "all"} onValueChange={(v) => setCatFilter(!v || v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue placeholder="全部类别" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类别</SelectItem>
            {Object.entries(CATEGORY_NAMES).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <SkeletonTable rows={5} />
      ) : error ? (
        <EmptyState variant="error" title="配置加载失败" description={error} action={<Button variant="outline" size="sm" onClick={load}>重试</Button>} />
      ) : configs.length === 0 ? (
        <EmptyState variant="no-data" title="暂无实验" description="当前分类下没有实验配置" />
      ) : (
        <div className="grid gap-2">
          {configs.map((cfg) => (
            <div
              key={cfg.id}
              className="flex items-center gap-3 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-border"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY_DOT[cfg.category] || "bg-muted-foreground"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{cfg.title}</span>
                  <Badge variant={cfg.is_published ? "default" : "secondary"} className="text-[10px]">
                    {cfg.is_published ? "已发布" : "未发布"}
                  </Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{CATEGORY_NAMES[cfg.category] || cfg.category}</span>
                  <span>{DIFFICULTIES.find((d) => d.value === cfg.difficulty)?.label || cfg.difficulty}</span>
                  <span>限时 {cfg.time_limit}s</span>
                  <span>内存 {toMB(cfg.memory_limit)}MB</span>
                  <span>用例 {cfg.test_case_count ?? 0}</span>
                  <span>提交 {cfg.submission_count ?? 0}</span>
                  <span>通过率 {cfg.pass_rate ?? 0}%</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={cfg.is_published}
                  onCheckedChange={() => togglePublish(cfg)}
                  aria-label="发布状态"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setEditTarget(cfg)}
                  aria-label="编辑"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteTarget(cfg)}
                  aria-label="删除"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editTarget && (
        <EditConfigDialog
          config={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load(); }}
        />
      )}

      {deleteTarget && (
        <Dialog open onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>删除实验</DialogTitle>
              <DialogDescription>此操作将软删除该实验及其关联数据，不可撤销。</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Layers className="size-4" />
              确认删除 <span className="font-medium text-foreground">{deleteTarget.title}</span>？
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
              <Button variant="destructive" disabled={busy} onClick={handleDelete}>
                {busy ? "删除中..." : "删除"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function EditConfigDialog({ config, onClose, onSaved }: {
  config: ExpConfig; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(config.title);
  const [difficulty, setDifficulty] = useState(config.difficulty);
  const [timeLimit, setTimeLimit] = useState(config.time_limit);
  const [memoryMB, setMemoryMB] = useState(toMB(config.memory_limit));
  const [sandboxLevel, setSandboxLevel] = useState(config.sandbox_level);
  const [maxSubmissions, setMaxSubmissions] = useState(config.max_submissions);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.updateExperiment(config.id, {
        title: title.trim(),
        difficulty,
        time_limit: timeLimit,
        memory_limit: memoryMB * 1048576,
        sandbox_level: sandboxLevel,
        max_submissions: maxSubmissions,
      });
      showToast("success", "配置已更新");
      onSaved();
    } catch (e: any) {
      showToast("error", e?.message || "更新失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>编辑实验配置</DialogTitle>
          <DialogDescription>{config.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">标题</Label>
            <Input className="h-9 text-xs" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">难度</Label>
            <Select value={difficulty} onValueChange={(v) => { if (v) setDifficulty(v); }}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DIFFICULTIES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">时间限制 (秒)</Label>
              <Input type="number" min={1} className="h-9 text-xs" value={timeLimit} onChange={(e) => setTimeLimit(parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">内存限制 (MB)</Label>
              <Input type="number" min={1} className="h-9 text-xs" value={memoryMB} onChange={(e) => setMemoryMB(parseInt(e.target.value) || 0)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">沙箱等级 (1-3)</Label>
              <Input type="number" min={1} max={3} className="h-9 text-xs" value={sandboxLevel} onChange={(e) => setSandboxLevel(parseInt(e.target.value) || 1)} />
            </div>
            <div>
              <Label className="text-xs">最大提交次数</Label>
              <Input type="number" min={1} className="h-9 text-xs" value={maxSubmissions} onChange={(e) => setMaxSubmissions(parseInt(e.target.value) || 0)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={busy} onClick={submit}>{busy ? "保存中..." : "保存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}