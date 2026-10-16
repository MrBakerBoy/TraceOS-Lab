"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import KnowledgePreviewPanel from "@/components/KnowledgePreviewPanel";
import CitationMarkdown from "@/components/rag/CitationMarkdown";
import ExportDialog from "@/components/rag/ExportDialog";
import ReferencePanel from "@/components/rag/ReferencePanel";
import { cn } from "@/lib/utils";
import { getActiveCourseId } from "@/lib/knowledge-constants";
import type { RagChatItem, Reference, RetrievalMeta, StageInfo } from "@/lib/knowledge-types";
import { ragApi } from "@/lib/rag-api";
import {
  Brain,
  CornerDownLeft,
  Eraser,
  FlaskConical,
  Loader2,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  FileDown,
} from "lucide-react";

type Mode = "ask" | "search";

const SUGGESTED_QUESTIONS = [
  "操作系统内核的主要功能是什么？",
  "进程调度有哪些经典算法？",
  "虚拟内存如何实现地址映射？",
  "死锁产生的必要条件是什么？",
];

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e) || "未知错误";
}

export default function RagPage() {
  const courseId = useMemo(() => getActiveCourseId(), []);

  const [mode, setMode] = useState<Mode>("ask");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<RagChatItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [meta, setMeta] = useState<RetrievalMeta | null>(null);
  const [activeCite, setActiveCite] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<Reference[]>([]);
  const [searchMeta, setSearchMeta] = useState<RetrievalMeta | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [previewEntry, setPreviewEntry] = useState<{ id?: string; title?: string; source_type?: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const streamIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const storageKey = `traceos_rag_${courseId}`;

  // Persist conversation locally.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed.slice(-20));
      }
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  useEffect(() => {
    if (messages.length === 0) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(messages.slice(-20)));
      } catch {
        /* ignore */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [messages, storageKey]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  const patchStreamMessage = useCallback((id: string, updater: (m: RagChatItem) => RagChatItem) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  }, []);

  const handleAsk = useCallback(async () => {
    const q = input.trim();
    if (!q || streaming) return;
    setInput("");
    setError("");
    setActiveCite(null);

    const userItem: RagChatItem = { id: `u-${Date.now()}`, role: "user", content: q, createdAt: Date.now() };
    const assistantId = `a-${Date.now()}`;
    const assistantItem: RagChatItem = { id: assistantId, role: "assistant", content: "", createdAt: Date.now() };
    setMessages((prev) => [...prev, userItem, assistantItem]);
    setReferences([]);
    setMeta(null);
    setStreaming(true);
    setStages([]);
    streamIdRef.current = assistantId;
    scrollToBottom();

    await ragApi.askStream(
      courseId,
      q,
      {
        onStage: setStages,
        onChunk: (delta) => {
          patchStreamMessage(assistantId, (m) => ({ ...m, content: m.content + delta }));
          scrollToBottom();
        },
        onReplace: (content) => {
          patchStreamMessage(assistantId, (m) => ({ ...m, content }));
          scrollToBottom();
        },
        onHarness: (data) => {
          setMeta(data.retrieval_meta);
          setReferences(data.references || []);
          patchStreamMessage(assistantId, (m) => ({ ...m, references: data.references, retrieval_meta: data.retrieval_meta }));
        },
        onError: (e) => {
          setError(getErrorMessage(e));
          patchStreamMessage(assistantId, (m) => ({ ...m, content: m.content || `错误：${getErrorMessage(e)}` }));
        },
      },
    );
    setStreaming(false);
    streamIdRef.current = null;
  }, [input, streaming, courseId, patchStreamMessage, scrollToBottom]);

  const handleSearch = useCallback(async () => {
    const q = input.trim();
    if (!q || searchLoading) return;
    setInput("");
    setError("");
    setSearchLoading(true);
    setSearchResults([]);
    setSearchMeta(null);
    try {
      const data = await ragApi.search(courseId, q, 8);
      setSearchResults(data.results || []);
      setSearchMeta(data.retrieval_meta);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSearchLoading(false);
    }
  }, [input, searchLoading, courseId]);

  const handleClear = useCallback(() => {
    setMessages([]);
    setReferences([]);
    setMeta(null);
    setSearchResults([]);
    setSearchMeta(null);
    setError("");
    setActiveCite(null);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const handleCite = useCallback((n: number) => {
    setActiveCite((prev) => (prev === n ? null : n));
    requestAnimationFrame(() => {
      document.getElementById(`reference-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  const handleCiteToInput = useCallback((ref: Reference) => {
    const snippet = `> ${ref.content.slice(0, 200).replace(/\n/g, "\n> ")}`;
    setInput((prev) => (prev ? `${prev}\n\n${snippet}\n\n` : `${snippet}\n\n`));
  }, []);

  const handleViewSource = useCallback((ref: Reference) => {
    setPreviewEntry({ id: ref.entry_id, title: ref.title, source_type: ref.knowledge_type });
    setPreviewOpen(true);
  }, []);

  const handleSuggested = useCallback((q: string) => {
    setInput(q);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        mode === "ask" ? handleAsk() : handleSearch();
      }
    },
    [mode, handleAsk, handleSearch],
  );

  const showWelcome = !streaming && !searchLoading && messages.length === 0 && searchResults.length === 0 && !error;

  return (
    <div className="flex h-full flex-col overflow-hidden px-8 pb-6 pt-6">
      {/* Header */}
      <header className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-[var(--accent-light)] ring-1 ring-[var(--accent)]/15">
            <Brain className="size-5 text-[var(--accent)]" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">RAG 智能检索</h1>
            <p className="text-[13px] text-[var(--text-secondary)]">基于知识库的溯源式问答 · 回答内 [n] 可点击定位原文</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleClear} disabled={messages.length === 0 && searchResults.length === 0}>
            <Eraser className="size-4" />
            清空对话
          </Button>
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)} disabled={messages.length === 0}>
            <FileDown className="size-4" />
            导出对话
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-1 rounded-xl bg-[var(--secondary)] p-1 w-fit" role="tablist" aria-label="检索模式">
        {(
          [
            { key: "ask" as const, label: "AI 问答", icon: Sparkles },
            { key: "search" as const, label: "语义搜索", icon: Search },
          ] as const
        ).map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={mode === m.key}
            onClick={() => setMode(m.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all",
              mode === m.key
                ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--border-default)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}
          >
            <m.icon className="size-4" />
            {m.label}
          </button>
        ))}
        <button
          role="tab"
          aria-disabled
          title="实验上下文 RAG 尚未启用"
          className="flex cursor-not-allowed items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-medium text-[var(--text-tertiary)] opacity-50"
        >
          <FlaskConical className="size-4" />
          实验上下文
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--error)]/20 bg-[var(--error-bg)] px-3 py-2 text-[13px] text-[var(--error)]" role="alert" aria-live="polite">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <Group orientation="horizontal" className="h-full">
          {/* Left: chat / search */}
          <Panel defaultSize={70} minSize={45} className="min-w-0">
            <div className="flex h-full flex-col pr-3">
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {showWelcome && (
                  <div className="flex h-full flex-col items-center justify-center">
                    <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-[var(--accent-light)]">
                      <Sparkles className="size-6 text-[var(--accent)]" />
                    </div>
                    <p className="mb-4 text-sm text-[var(--text-tertiary)]">试试这些问题</p>
                    <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                      {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                          key={q}
                          onClick={() => handleSuggested(q)}
                          className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-3 text-left text-[13px] text-[var(--text-secondary)] transition-all hover:border-[var(--accent)]/30 hover:bg-[var(--accent-light)] hover:text-[var(--text-primary)]"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {mode === "ask" && (
                  <div className="space-y-4">
                    {messages.map((item) => (
                      <ChatBubble
                        key={item.id}
                        item={item}
                        streaming={streaming && item.id === streamIdRef.current}
                        onCite={handleCite}
                      />
                    ))}
                    {streaming && stages.length > 0 && <StageIndicator stages={stages} />}
                    <div ref={bottomRef} />
                  </div>
                )}

                {mode === "search" && (
                  <div className="space-y-3">
                    {searchLoading && (
                      <div className="space-y-2">
                        <Skeleton className="h-24 w-full rounded-xl" />
                        <Skeleton className="h-24 w-full rounded-xl" />
                        <Skeleton className="h-24 w-full rounded-xl" />
                      </div>
                    )}
                    {!searchLoading && searchResults.length === 0 && !error && (
                      <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
                        <Search className="size-8 text-[var(--text-tertiary)]" />
                        <p className="text-sm text-[var(--text-tertiary)]">输入关键词，检索知识库中的相关内容</p>
                      </div>
                    )}
                    {searchResults.map((ref, i) => (
                      <ReferenceCardInline key={ref.id || i} reference={ref} index={i + 1} onView={handleViewSource} />
                    ))}
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="mt-3 border-t border-[var(--border-default)] pt-3">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={mode === "ask" ? "向知识库提问，支持 Markdown 回答与引用溯源…" : "搜索知识库中的相关内容…"}
                  rows={3}
                  className="resize-none rounded-xl bg-[var(--bg-card)] text-sm"
                  disabled={streaming}
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
                    <CornerDownLeft className="size-3" />
                    Enter 发送 · Shift+Enter 换行
                  </span>
                  <Button
                    size="sm"
                    onClick={mode === "ask" ? handleAsk : handleSearch}
                    disabled={!input.trim() || streaming || searchLoading}
                    className="gap-1.5"
                  >
                    {streaming || searchLoading ? <Loader2 className="size-4 animate-spin" /> : mode === "ask" ? <Send className="size-4" /> : <Search className="size-4" />}
                    {mode === "ask" ? "发送" : "搜索"}
                  </Button>
                </div>
              </div>
            </div>
          </Panel>

          <Separator className="flex w-3 cursor-col-resize items-center justify-center transition-colors hover:bg-[var(--accent)]/10">
            <div className="h-8 w-px bg-[var(--border-default)]" />
          </Separator>

          {/* Right: reference panel */}
          <Panel defaultSize={30} minSize={25} className="min-w-0">
            <aside className="h-full pl-1" aria-label="召回来源">
              <ReferencePanel
                references={references}
                meta={meta}
                activeCite={activeCite}
                loading={streaming}
                onCite={handleCite}
                onView={handleViewSource}
                onCiteToInput={handleCiteToInput}
              />
            </aside>
          </Panel>
        </Group>
      </div>

      <ExportDialog open={exportOpen} messages={messages} onClose={() => setExportOpen(false)} />
      <KnowledgePreviewPanel
        entry={previewEntry}
        open={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewEntry(null);
        }}
        courseId={courseId}
      />
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ChatBubble({
  item,
  streaming,
  onCite,
}: {
  item: RagChatItem;
  streaming: boolean;
  onCite: (n: number) => void;
}) {
  if (item.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--accent-light)] px-4 py-2.5 text-sm text-[var(--text-primary)] ring-1 ring-inset ring-[var(--accent)]/15">
          {item.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]">
        <MessageSquare className="size-3.5 text-white" />
      </div>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-3">
        {streaming && !item.content ? (
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-4/6" />
          </div>
        ) : (
          <>
            <CitationMarkdown content={item.content} onCite={onCite} />
            {item.references && item.references.length > 0 && (
              <div className="mt-3 border-t border-[var(--border-default)] pt-2.5">
                <p className="mb-1.5 text-[11px] text-[var(--text-tertiary)]">引用来源</p>
                <div className="flex flex-wrap gap-1.5">
                  {item.references.map((r, i) => (
                    <button
                      key={r.id || i}
                      onClick={() => onCite(i + 1)}
                      className="rounded-md bg-[var(--secondary)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--accent)]"
                    >
                      [{i + 1}] {r.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StageIndicator({ stages }: { stages: StageInfo[] }) {
  const current = stages.find((s) => s.status === "running");
  const labelMap: Record<string, string> = {
    guard: "输入守卫",
    retrieve: "知识检索",
    rerank: "结果重排",
    generate: "生成回答",
    cite: "构造溯源",
  };
  return (
    <div className="flex items-center gap-2 pl-9 text-[11px] text-[var(--text-tertiary)]" aria-live="polite">
      <Loader2 className="size-3 animate-spin text-[var(--accent)]" />
      {current ? labelMap[current.name] ?? current.label : "处理中…"}
    </div>
  );
}

function ReferenceCardInline({
  reference,
  index,
  onView,
}: {
  reference: Reference;
  index: number;
  onView: (ref: Reference) => void;
}) {
  const similarity = Number.isFinite(reference.similarity) ? reference.similarity : 0;
  const content = typeof reference.content === "string" ? reference.content : "";
  const title = reference.title || "未命名文档";
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-md bg-[var(--secondary)] text-[11px] font-semibold text-[var(--text-secondary)]">
          {index}
        </span>
        <h3 className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{title}</h3>
        <span className="ml-auto text-xs font-semibold tabular-nums text-[var(--accent)]">
          {(similarity * 100).toFixed(1)}%
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">{content.slice(0, 300)}</p>
      <div className="mt-2 flex justify-end">
        <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => onView(reference)}>
          查看原文
        </Button>
      </div>
    </div>
  );
}