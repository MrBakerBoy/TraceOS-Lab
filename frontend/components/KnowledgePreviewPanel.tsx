"use client";

import { useState, useEffect } from "react";
import { X, FileText, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface KnowledgePreviewPanelProps {
  entry: { id?: string; title?: string; source_type?: string } | null;
  open: boolean;
  onClose: () => void;
  courseId: string;
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function KnowledgePreviewPanel({
  entry,
  open,
  onClose,
  courseId,
}: KnowledgePreviewPanelProps) {
  const [chunks, setChunks] = useState<{ content: string; chunk_index: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !entry?.id) return;
    setLoading(true);
    setError("");
    fetch(
      `${API_BASE}/api/v1/courses/${encodeURIComponent(courseId)}/knowledge/${encodeURIComponent(entry.id)}/chunks`,
      { headers: authHeaders() },
    )
      .then((r) => {
        if (!r.ok) throw new Error(`请求失败 (${r.status})`);
        return r.json();
      })
      .then((data) => {
        setChunks(data.chunks || data || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, entry?.id, courseId]);

  if (!open || !entry) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl max-h-[85vh] bg-card rounded-2xl border border-[var(--border-default)] shadow-2xl flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border-default)]">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent-light)] flex items-center justify-center flex-shrink-0">
            <FileText className="size-4 text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {entry.title || "未命名文档"}
            </h3>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              {entry.source_type || "知识库"} · {chunks.length} 个分块
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--secondary)] transition-all"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full bg-[var(--secondary)]" />
              <Skeleton className="h-20 w-full bg-[var(--secondary)]" />
              <Skeleton className="h-20 w-full bg-[var(--secondary)]" />
            </div>
          )}
          {error && (
            <div className="p-4 rounded-xl bg-[var(--error-bg)] border border-[var(--error)]/20 text-[var(--error)] text-sm">
              {error}
            </div>
          )}
          {!loading && !error && chunks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--text-tertiary)] gap-2">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-xs">加载中...</span>
            </div>
          )}
          {chunks.map((chunk, i) => (
            <div
              key={i}
              className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-default)]"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-mono text-[var(--text-tertiary)] bg-[var(--secondary)] px-2 py-0.5 rounded-md">
                  Chunk {chunk.chunk_index ?? i + 1}
                </span>
              </div>
              <pre className="text-[12px] text-[var(--text-secondary)] whitespace-pre-wrap font-sans leading-relaxed">
                {chunk.content}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}