"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ragApi } from "@/lib/rag-api";
import { AnimatedCounter } from "@/components/knowledge/AnimatedCounter";
import {
  getActiveCourseId,
  KNOWLEDGE_TYPES,
  KNOWLEDGE_TYPE_KEYS,
  knowledgeTypeMeta,
  statusMeta,
} from "@/lib/knowledge-constants";
import type { KnowledgeChunk, KnowledgeEntry, KnowledgeStats } from "@/lib/knowledge-types";
import {
  Archive,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Tags,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  XCircle,
} from "lucide-react";

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e) || "未知错误";
}

function entryIdOf(e: KnowledgeEntry): string {
  return e.entry_id || e.id;
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.map(String);
  if (typeof tags === "string") return tags.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
}

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "pending_review", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已驳回" },
  { value: "unpublished", label: "已下架" },
];

// ── Stat card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
      <div className="flex size-10 items-center justify-center rounded-lg" style={{ backgroundColor: `${tone}1a`, color: tone }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[22px] font-bold leading-none tabular-nums text-[var(--text-primary)]">
          <AnimatedCounter value={value} />
        </p>
        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{label}</p>
      </div>
    </div>
  );
}

// ── Charts ──────────────────────────────────────────────────────────────────

function TypeDonut({ stats }: { stats: KnowledgeStats }) {
  const data = useMemo(
    () => stats.by_knowledge_type.map((t) => ({ ...t, meta: knowledgeTypeMeta(t.type) })),
    [stats],
  );
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const R = 56;
  const C = 2 * Math.PI * R;

  let acc = 0;
  const segments = data.map((d) => {
    const frac = total > 0 ? d.count / total : 0;
    const seg = { ...d, frac, offset: acc };
    acc += frac;
    return seg;
  });

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
          <circle cx="64" cy="64" r={R} fill="none" stroke="var(--secondary)" strokeWidth="14" />
          {segments.map((s) => (
            <circle
              key={s.type}
              cx="64"
              cy="64"
              r={R}
              fill="none"
              stroke={s.meta.color}
              strokeWidth="14"
              strokeLinecap="butt"
              strokeDasharray={`${s.frac * C} ${C}`}
              strokeDashoffset={-s.offset * C}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{total}</span>
          <span className="text-[10px] text-[var(--text-tertiary)]">文档</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {segments.map((s) => (
          <div key={s.type} className="flex items-center gap-2 text-[11px]">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.meta.color }} />
            <span className="flex-1 truncate text-[var(--text-secondary)]">{s.meta.label}</span>
            <span className="tabular-nums text-[var(--text-primary)]">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TagBar({ stats }: { stats: KnowledgeStats }) {
  const tags = stats.top_tags.slice(0, 8);
  const max = Math.max(1, ...tags.map((t) => t.count));
  return (
    <div className="space-y-2">
      {tags.map((t) => (
        <div key={t.tag} className="flex items-center gap-2">
          <span className="w-16 shrink-0 truncate text-right text-[11px] text-[var(--text-secondary)]">{t.tag}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--secondary)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
              style={{ width: `${(t.count / max) * 100}%` }}
            />
          </div>
          <span className="w-6 shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">{t.count}</span>
        </div>
      ))}
    </div>
  );
}

// ── Chunk editor sheet ──────────────────────────────────────────────────────

function ChunkEditorSheet({
  entry,
  courseId,
  open,
  onClose,
}: {
  entry: KnowledgeEntry | null;
  courseId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [embedDim, setEmbedDim] = useState<number | null>(null);

  const entryId = entry ? entryIdOf(entry) : "";

  useEffect(() => {
    if (!open || !entryId) return;
    setLoading(true);
    setError("");
    setChunks([]);
    setEditingId(null);
    setEmbedDim(null);
    ragApi
      .getChunks(courseId, entryId)
      .then((data) => setChunks(data.chunks || []))
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setLoading(false));
  }, [open, entryId, courseId]);

  const startEdit = (c: KnowledgeChunk) => {
    setEditingId(c.id);
    setDraft(c.content);
    setEmbedDim(null);
  };

  const saveEdit = async (c: KnowledgeChunk) => {
    setSavingId(c.id);
    try {
      const res = await ragApi.updateChunk(courseId, entryId, c.id, draft);
      setChunks((prev) => prev.map((x) => (x.id === c.id ? { ...x, content: draft } : x)));
      setEmbedDim(res.embedding_dim);
      setEditingId(null);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-xl p-0">
        <SheetHeader className="border-b border-[var(--border-default)]">
          <SheetTitle className="flex items-center gap-2">
            <FileText className="size-4 text-[var(--accent)]" />
            {entry?.title || "文档分块"}
          </SheetTitle>
          <SheetDescription>
            {chunks.length} 个分块 · 编辑文本后自动重新向量化
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">
              {error}
            </div>
          )}
          {!loading && !error && chunks.length === 0 && (
            <p className="py-16 text-center text-[12px] text-[var(--text-tertiary)]">暂无分块</p>
          )}
          {!loading &&
            chunks.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "rounded-xl border bg-[var(--bg-card)] p-3 transition-colors",
                  editingId === c.id ? "border-[var(--accent)]" : "border-[var(--border-default)]",
                )}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-md bg-[var(--secondary)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-tertiary)]">
                    #{c.chunk_index + 1}
                  </span>
                  <span className="text-[10px] text-[var(--text-tertiary)]">{c.content.length} 字</span>
                  {editingId === c.id ? (
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setEditingId(null)}>
                        取消
                      </Button>
                      <Button size="sm" className="h-7 text-[11px]" onClick={() => saveEdit(c)} disabled={savingId === c.id}>
                        {savingId === c.id ? <Loader2 className="size-3 animate-spin" /> : "保存"}
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" className="ml-auto h-7 text-[11px]" onClick={() => startEdit(c)}>
                      编辑
                    </Button>
                  )}
                </div>
                {editingId === c.id ? (
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="min-h-[120px] resize-none text-[12px] leading-relaxed"
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-secondary)]">{c.content}</p>
                )}
                {editingId === c.id && embedDim != null && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--success)]">
                    <CheckCircle2 className="size-3" />
                    已重新向量化 · {embedDim} 维
                  </p>
                )}
              </div>
            ))}
        </div>

        <SheetFooter className="border-t border-[var(--border-default)]">
          <p className="text-[11px] text-[var(--text-tertiary)]">修改保存后即时生效，无需重新审核</p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ── Reject dialog ───────────────────────────────────────────────────────────

function RejectDialog({
  entry,
  open,
  onClose,
  onSubmit,
  submitting,
}: {
  entry: KnowledgeEntry | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  submitting: boolean;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>驳回知识条目</DialogTitle>
          <DialogDescription>
            {entry?.title || "未命名"} · 驳回后状态变为「已驳回」，可重新提交
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-[12px] text-[var(--text-secondary)]">驳回理由</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="请说明驳回原因，供提交人参考"
            className="min-h-[100px] resize-none text-[13px]"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="destructive" onClick={() => onSubmit(reason)} disabled={submitting || !reason.trim()}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <ThumbsDown className="size-4" />}
            确认驳回
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete dialog ───────────────────────────────────────────────────────────

function DeleteDialog({
  entry,
  open,
  onClose,
  onSubmit,
  submitting,
}: {
  entry: KnowledgeEntry | null;
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>删除知识条目</DialogTitle>
          <DialogDescription>
            {entry?.title || "未命名"} · 删除后将移出知识库，无法在当前列表查看
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">
          此操作不可撤销，请确认后再删除。
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="destructive" onClick={onSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            确认删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function KnowledgeReviewPage() {
  const courseId = useMemo(() => getActiveCourseId(), []);

  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionStatus, setActionStatus] = useState<Record<string, "loading">>({});

  const [sheetEntry, setSheetEntry] = useState<KnowledgeEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<KnowledgeEntry | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, list] = await Promise.all([ragApi.stats(courseId), ragApi.listEntries(courseId)]);
      setStats(s);
      setEntries(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (typeFilter !== "all" && e.knowledge_type !== typeFilter) return false;
      if (q && !(e.title || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, statusFilter, typeFilter, search]);

  const pendingCount = stats?.by_status.find((s) => s.status === "pending_review")?.count ?? 0;
  const approvedCount = stats?.by_status.find((s) => s.status === "approved")?.count ?? 0;

  const toggleSelect = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (prev.size === filtered.length && filtered.length > 0) return new Set();
      return new Set(filtered.map(entryIdOf));
    });
  };

  const runAction = async (id: string, fn: () => Promise<unknown>) => {
    setActionStatus((p) => ({ ...p, [id]: "loading" }));
    setError("");
    try {
      await fn();
      await loadData();
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setActionStatus((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
    }
  };

  const handleApprove = (id: string) => runAction(id, () => ragApi.approve(courseId, id));
  const handleUnpublish = (id: string) => runAction(id, () => ragApi.unpublish(courseId, id));

  const handleReject = async (reason: string) => {
    if (!rejectTarget) return;
    const id = entryIdOf(rejectTarget);
    setRejecting(true);
    setError("");
    try {
      await ragApi.reject(courseId, id, reason);
      setRejectTarget(null);
      await loadData();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setRejecting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const id = entryIdOf(deleteTarget);
    setDeleting(true);
    setError("");
    try {
      await ragApi.deleteEntry(courseId, id);
      setDeleteTarget(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await loadData();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const handleBatch = async (action: "approve" | "reject") => {
    if (selected.size === 0) return;
    setBatchLoading(true);
    setError("");
    try {
      await ragApi.batchReview(courseId, Array.from(selected), action, action === "reject" ? "批量驳回" : "");
      setSelected(new Set());
      await loadData();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBatchLoading(false);
    }
  };

  const selectedPending = Array.from(selected).filter((id) => {
    const e = entries.find((x) => entryIdOf(x) === id);
    return e?.status === "pending_review";
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-8 pb-6 pt-6">
      {/* Header */}
      <header className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-[var(--accent-light)] ring-1 ring-[var(--accent)]/15">
            <ShieldCheck className="size-5 text-[var(--accent)]" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">知识审核</h1>
            <p className="text-[13px] text-[var(--text-secondary)]">审核用户上传的知识条目，通过后纳入检索索引</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          刷新
        </Button>
      </header>

      {/* Stats panel */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="总文档" value={stats?.total_documents ?? 0} tone="#0071e3" icon={<FileText className="size-5" />} />
        <StatCard label="总分块" value={stats?.total_chunks ?? 0} tone="#8b5cf6" icon={<Tags className="size-5" />} />
        <StatCard label="待审核" value={pendingCount} tone="#ff9f0a" icon={<Loader2 className="size-5" />} />
        <StatCard label="已通过" value={approvedCount} tone="#30d158" icon={<CheckCircle2 className="size-5" />} />
      </div>

      {/* Charts */}
      {stats && (stats.total_documents > 0 || stats.top_tags.length > 0) && (
        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h3 className="mb-2 text-[13px] font-semibold text-[var(--text-primary)]">知识类型分布</h3>
            <TypeDonut stats={stats} />
          </div>
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h3 className="mb-2 text-[13px] font-semibold text-[var(--text-primary)]">热门标签</h3>
            {stats.top_tags.length > 0 ? <TagBar stats={stats} /> : <p className="py-16 text-center text-[12px] text-[var(--text-tertiary)]">暂无标签数据</p>}
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--error)]/20 bg-[var(--error-bg)] px-3 py-2 text-[13px] text-[var(--error)]"
          role="alert"
          aria-live="polite"
        >
          <XCircle className="size-4" />
          {error}
        </div>
      )}

      {/* Filter + batch bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题..."
            className="h-8 w-52 pl-8 text-[12px]"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="h-8 w-[130px] text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => v && setTypeFilter(v)}>
          <SelectTrigger className="h-8 w-[130px] text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {KNOWLEDGE_TYPE_KEYS.map((k) => (
              <SelectItem key={k} value={k}>
                {KNOWLEDGE_TYPES[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5">
            <span className="text-[12px] text-[var(--text-secondary)]">已选 {selected.size} 项</span>
            <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={() => handleBatch("approve")} disabled={batchLoading || selectedPending.length === 0}>
              <ThumbsUp className="size-3" />
              批量通过
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] text-[var(--error)]" onClick={() => handleBatch("reject")} disabled={batchLoading || selectedPending.length === 0}>
              <ThumbsDown className="size-3" />
              批量驳回
            </Button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
              取消选择
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)]">
        {loading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--secondary)]">
              <ShieldCheck className="size-5 text-[var(--text-tertiary)]" />
            </div>
            <p className="text-sm text-[var(--text-tertiary)]">没有符合条件的知识条目</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onCheckedChange={() => toggleSelectAll()}
                    aria-label="全选"
                  />
                </TableHead>
                <TableHead className="text-[12px] text-[var(--text-tertiary)]">标题</TableHead>
                <TableHead className="text-[12px] text-[var(--text-tertiary)]">类型</TableHead>
                <TableHead className="text-[12px] text-[var(--text-tertiary)]">标签</TableHead>
                <TableHead className="text-[12px] text-[var(--text-tertiary)]">状态</TableHead>
                <TableHead className="text-[12px] text-[var(--text-tertiary)]">提交时间</TableHead>
                <TableHead className="pr-4 text-right text-[12px] text-[var(--text-tertiary)]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => {
                const id = entryIdOf(e);
                const tags = normalizeTags(e.tags);
                const sm = statusMeta(e.status);
                const acting = actionStatus[id] === "loading";
                return (
                  <TableRow key={id} data-state={selected.has(id) ? "selected" : undefined}>
                    <TableCell className="pl-4">
                      <Checkbox checked={selected.has(id)} onCheckedChange={(v) => toggleSelect(id, v)} aria-label={`选择 ${e.title}`} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-light)]">
                          <FileText className="size-3.5 text-[var(--accent)]" />
                        </div>
                        <span className="max-w-[260px] truncate text-[13px] font-medium text-[var(--text-primary)]">{e.title || "未命名"}</span>
                        <Badge variant="outline" className="text-[10px] text-[var(--text-tertiary)]">
                          {e.source_type}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="gap-1 text-[10px]" style={{ color: knowledgeTypeMeta(e.knowledge_type).color }}>
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: knowledgeTypeMeta(e.knowledge_type).color }} />
                        {knowledgeTypeMeta(e.knowledge_type).label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[180px] flex-wrap gap-1">
                        {tags.slice(0, 3).map((t) => (
                          <Badge key={t} variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-[var(--text-tertiary)]">
                            {t}
                          </Badge>
                        ))}
                        {tags.length > 3 && <span className="text-[10px] text-[var(--text-tertiary)]">+{tags.length - 3}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${sm.color}1a`, color: sm.color }}>
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: sm.color }} />
                        {sm.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-[12px] text-[var(--text-tertiary)]">
                      {e.created_at ? new Date(e.created_at).toLocaleDateString("zh-CN") : "—"}
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-[11px] text-[var(--text-secondary)]"
                          onClick={() => {
                            setSheetEntry(e);
                            setSheetOpen(true);
                          }}
                        >
                          <Eye className="size-3" />
                          预览
                        </Button>
                        {e.status === "pending_review" && (
                          <>
                            <Button size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => handleApprove(id)} disabled={acting}>
                              {acting ? <Loader2 className="size-3 animate-spin" /> : <ThumbsUp className="size-3" />}
                              通过
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-[11px] text-[var(--error)] hover:bg-[var(--error-bg)]"
                              onClick={() => setRejectTarget(e)}
                              disabled={acting}
                            >
                              <ThumbsDown className="size-3" />
                              驳回
                            </Button>
                          </>
                        )}
                        {e.status === "approved" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-bg)]"
                            onClick={() => handleUnpublish(id)}
                            disabled={acting}
                          >
                            <Archive className="size-3" />
                            下架
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-bg)]"
                          onClick={() => setDeleteTarget(e)}
                          disabled={acting}
                        >
                          <Trash2 className="size-3" />
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <ChunkEditorSheet entry={sheetEntry} courseId={courseId} open={sheetOpen} onClose={() => setSheetOpen(false)} />
      <RejectDialog entry={rejectTarget} open={!!rejectTarget} onClose={() => setRejectTarget(null)} onSubmit={handleReject} submitting={rejecting} />
      <DeleteDialog entry={deleteTarget} open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onSubmit={handleDelete} submitting={deleting} />
    </div>
  );
}