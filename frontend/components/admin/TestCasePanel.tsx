"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Hammer, Plus, Pencil, Trash2, ChevronDown, ChevronRight, RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { cn } from "@/lib/utils";

interface AdminTestCase {
  id: string;
  name: string;
  type: string;
  compare_mode: string;
  input_data: string;
  expected_output: string;
  is_public: boolean;
  score_weight: number;
  order_index: number;
  recent_fail_count?: number;
  recent_pass_count?: number;
}

interface ExperimentOption {
  id: string;
  title: string;
}

const TC_TYPES = ["normal", "edge_case", "performance", "security"];
const COMPARE_MODES = ["normalized_contains", "exact", "regex"];

const compareModeClass = (m: string) =>
  m === "regex" ? "bg-purple-500/10 text-purple-500"
    : m === "exact" ? "bg-blue-500/10 text-blue-500"
    : "bg-teal-500/10 text-teal-500";

export default function TestCasePanel() {
  const [experiments, setExperiments] = useState<ExperimentOption[]>([]);
  const [expId, setExpId] = useState("");
  const [cases, setCases] = useState<AdminTestCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminTestCase | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminTestCase | null>(null);

  useEffect(() => {
    api.getExperiments({ page_size: 200 })
      .then((res: any) => setExperiments(res.data || []))
      .catch(() => {});
  }, []);

  const load = useCallback((id: string) => {
    if (!id) { setCases([]); return; }
    setLoading(true);
    setError("");
    api.getAdminTestCases(id)
      .then((res: any) => setCases(res.test_cases || res.data || []))
      .catch((e: any) => setError(e?.message || "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const handleSelectExp = (id: string) => {
    if (id === "none") {
      setExpId("");
      setCases([]);
      setExpanded(null);
      return;
    }
    setExpId(id);
    setExpanded(null);
    load(id);
  };

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (tc: AdminTestCase) => {
    setEditing(tc);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteTestCase(deleteTarget.id);
      showToast("success", "测试用例已删除");
      setDeleteTarget(null);
      load(expId);
    } catch (e: any) {
      showToast("error", e?.message || "删除失败");
    }
  };

  return (
    <div className="space-y-4">
      <PanelHeader
        icon={Hammer}
        title="测试用例管理"
        subtitle="新建、编辑与删除实验测试用例"
        actions={
          expId && (
            <Button variant="ghost" size="sm" onClick={() => load(expId)} className="gap-1.5">
              <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} /> 刷新
            </Button>
          )
        }
      />

      <div className="flex items-center gap-3">
        <Select value={expId || "none"} onValueChange={(v) => { if (v) handleSelectExp(v); }}>
          <SelectTrigger className="h-9 w-full max-w-xs text-xs">
            <SelectValue placeholder="选择实验..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">选择实验...</SelectItem>
            {experiments.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {expId && (
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="size-3.5" /> 新建用例
          </Button>
        )}
      </div>

      {!expId ? (
        <EmptyState variant="no-data" title="请先选择一个实验" description="选择实验后即可管理其测试用例" />
      ) : loading ? (
        <SkeletonTable rows={4} />
      ) : error ? (
        <EmptyState variant="error" title="用例加载失败" description={error} action={<Button variant="outline" size="sm" onClick={() => load(expId)}>重试</Button>} />
      ) : cases.length === 0 ? (
        <EmptyState
          variant="no-data"
          title="该实验无测试用例"
          description="点击上方按钮添加第一个测试用例"
          action={<Button size="sm" onClick={openCreate}><Plus className="size-3.5" /> 新建用例</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30 text-left">
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5 text-xs font-medium text-muted-foreground">名称</th>
                <th className="px-3 py-2.5 text-xs font-medium text-muted-foreground">类型</th>
                <th className="px-3 py-2.5 text-xs font-medium text-muted-foreground">比较</th>
                <th className="px-3 py-2.5 text-xs font-medium text-muted-foreground">权重</th>
                <th className="px-3 py-2.5 text-xs font-medium text-muted-foreground">通过/失败</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((tc) => {
                const isExpanded = expanded === tc.id;
                return (
                  <FragmentRow
                    key={tc.id}
                    tc={tc}
                    isExpanded={isExpanded}
                    onToggle={() => setExpanded(isExpanded ? null : tc.id)}
                    onEdit={() => openEdit(tc)}
                    onDelete={() => setDeleteTarget(tc)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialogOpen && (
        <TestCaseDialog
          expId={expId}
          testCase={editing}
          onClose={() => setDialogOpen(false)}
          onSaved={() => { setDialogOpen(false); load(expId); }}
        />
      )}

      {deleteTarget && (
        <Dialog open onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>删除测试用例</DialogTitle>
              <DialogDescription>此操作不可撤销。</DialogDescription>
            </DialogHeader>
            <div className="text-sm text-muted-foreground">
              确认删除 <span className="font-medium text-foreground">{deleteTarget.name}</span>？
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
              <Button variant="destructive" onClick={handleDelete}>确认删除</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function FragmentRow({ tc, isExpanded, onToggle, onEdit, onDelete }: {
  tc: AdminTestCase; isExpanded: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const pass = tc.recent_pass_count ?? 0;
  const fail = tc.recent_fail_count ?? 0;
  return (
    <>
      <tr className="cursor-pointer border-b border-border/30 last:border-0 hover:bg-muted/20" onClick={onToggle}>
        <td className="px-3 py-2.5 text-muted-foreground">
          {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </td>
        <td className="px-3 py-2.5">
          <span className="font-medium">{tc.name}</span>
          {!tc.is_public && <Badge variant="secondary" className="ml-2 text-[10px]">隐藏</Badge>}
        </td>
        <td className="px-3 py-2.5"><Badge variant="outline" className="text-[11px]">{tc.type}</Badge></td>
        <td className="px-3 py-2.5">
          <span className={cn("rounded px-1.5 py-0.5 font-mono text-[11px]", compareModeClass(tc.compare_mode))}>
            {tc.compare_mode}
          </span>
        </td>
        <td className="px-3 py-2.5 text-xs text-muted-foreground">{tc.score_weight}</td>
        <td className="px-3 py-2.5">
          <span className="text-xs text-emerald-500">{pass}</span>
          <span className="text-xs text-muted-foreground"> / </span>
          <span className="text-xs text-rose-500">{fail}</span>
        </td>
        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" className="size-7" onClick={onEdit} aria-label="编辑">
              <Pencil className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="删除">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-border/30 bg-muted/10">
          <td colSpan={7} className="px-6 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-[10px] uppercase tracking-wider text-muted-foreground">输入数据</span>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/30 bg-background/50 p-3 font-mono text-xs">{tc.input_data || <span className="italic text-muted-foreground">（空）</span>}</pre>
              </div>
              <div>
                <span className="mb-1.5 block text-[10px] uppercase tracking-wider text-muted-foreground">期望输出</span>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/30 bg-background/50 p-3 font-mono text-xs">{tc.expected_output || <span className="italic text-muted-foreground">（空）</span>}</pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TestCaseDialog({ expId, testCase, onClose, onSaved }: {
  expId: string; testCase: AdminTestCase | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: testCase?.name ?? "",
    type: testCase?.type ?? "normal",
    compare_mode: testCase?.compare_mode ?? "normalized_contains",
    input_data: testCase?.input_data ?? "",
    expected_output: testCase?.expected_output ?? "",
    is_public: testCase?.is_public ?? true,
    score_weight: testCase?.score_weight ?? 10,
    order_index: testCase?.order_index ?? 0,
  });
  const [busy, setBusy] = useState(false);

  const update = (key: string, value: unknown) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      showToast("error", "测试用例名称不能为空");
      return;
    }
    setBusy(true);
    try {
      if (testCase) {
        await api.updateTestCase(testCase.id, {
          name: form.name.trim(),
          type: form.type,
          compare_mode: form.compare_mode,
          input_data: form.input_data,
          expected_output: form.expected_output,
          is_public: form.is_public,
          score_weight: form.score_weight,
          order_index: form.order_index,
        });
        showToast("success", "测试用例已更新");
      } else {
        await api.createTestCase({
          experiment_id: expId,
          name: form.name.trim(),
          type: form.type,
          compare_mode: form.compare_mode,
          input_data: form.input_data,
          expected_output: form.expected_output,
          is_public: form.is_public,
          score_weight: form.score_weight,
          order_index: form.order_index,
        });
        showToast("success", "测试用例已创建");
      }
      onSaved();
    } catch (e: any) {
      showToast("error", e?.message || "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{testCase ? "编辑测试用例" : "新建测试用例"}</DialogTitle>
          <DialogDescription>填写测试用例的详细信息</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">名称</Label>
            <Input className="h-9 text-xs" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="例如: 基本功能测试" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">类型</Label>
              <Select value={form.type} onValueChange={(v) => update("type", v)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{TC_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">比较模式</Label>
              <Select value={form.compare_mode} onValueChange={(v) => update("compare_mode", v)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{COMPARE_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">输入数据</Label>
            <Textarea className="min-h-[120px] resize-y font-mono text-xs" value={form.input_data} onChange={(e) => update("input_data", e.target.value)} placeholder="测试输入..." />
          </div>
          <div>
            <Label className="text-xs">期望输出</Label>
            <Textarea className="min-h-[120px] resize-y font-mono text-xs" value={form.expected_output} onChange={(e) => update("expected_output", e.target.value)} placeholder="期望输出..." />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">分数权重</Label>
              <Input type="number" min={1} max={100} className="h-9 text-xs" value={form.score_weight} onChange={(e) => update("score_weight", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">排序</Label>
              <Input type="number" min={0} className="h-9 text-xs" value={form.order_index} onChange={(e) => update("order_index", parseInt(e.target.value) || 0)} />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Switch checked={form.is_public} onCheckedChange={(v) => update("is_public", v)} id="tc-public" />
              <Label htmlFor="tc-public" className="text-xs">公开</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={busy} onClick={submit}>{busy ? "保存中..." : testCase ? "保存修改" : "创建"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}