"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { ragApi } from "@/lib/rag-api";
import {
  getActiveCourseId,
  CHUNKING_TEMPLATES,
  CHUNKING_TEMPLATE_KEYS,
  KNOWLEDGE_TYPES,
  KNOWLEDGE_TYPE_KEYS,
  TAG_SUGGESTIONS,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE_MB,
  knowledgeTypeMeta,
} from "@/lib/knowledge-constants";
import type { KnowledgeChunk, UploadResult } from "@/lib/knowledge-types";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  FileText,
  FileUp,
  Link2,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
  X,
  XCircle,
  Settings2,
} from "lucide-react";

type UploadMode = "file" | "text" | "url";
type Step = 1 | 2 | 3;

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e) || "未知错误";
}

// ── Stepper ─────────────────────────────────────────────────────────────────

const STEPS: Array<{ key: Step; label: string }> = [
  { key: 1, label: "上传与元数据" },
  { key: 2, label: "分块预览" },
  { key: 3, label: "提交结果" },
];

function StepIndicator({ step }: { step: Step }) {
  return (
    <ol className="mb-6 flex items-center gap-0" aria-label="上传流程">
      {STEPS.map((s, i) => {
        const active = step >= s.key;
        const current = step === s.key;
        return (
          <li key={s.key} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-[12px] font-semibold transition-all",
                  current
                    ? "bg-[var(--accent)] text-white shadow-[var(--shadow-glow)]"
                    : active
                      ? "bg-[var(--accent-light)] text-[var(--accent)] ring-1 ring-[var(--accent)]/30"
                      : "bg-[var(--secondary)] text-[var(--text-tertiary)]",
                )}
              >
                {active ? <CheckCircle2 className="size-4" /> : s.key}
              </span>
              <span
                className={cn(
                  "text-[11px] whitespace-nowrap",
                  current ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-tertiary)]",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-2 mb-5 h-px flex-1",
                  step > s.key ? "bg-[var(--accent)]/40" : "bg-[var(--border-default)]",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Dropzone ────────────────────────────────────────────────────────────────

function Dropzone({
  file,
  onFile,
  disabled,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const validate = useCallback((f: File): string | null => {
    const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
    if (SUPPORTED_EXTENSIONS.length > 0 && !SUPPORTED_EXTENSIONS.includes(ext) && f.name.includes(".")) {
      return `不支持的文件类型 ${ext}`;
    }
    if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return `文件超过 ${MAX_FILE_SIZE_MB}MB 上限`;
    }
    return null;
  }, []);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const f = files[0];
      const err = validate(f);
      if (err) {
        onFile(null);
        return;
      }
      onFile(f);
    },
    [onFile, validate],
  );

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-light)]">
          <FileText className="size-4 text-[var(--accent)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">{file.name}</p>
          <p className="text-[11px] text-[var(--text-tertiary)]">{(file.size / 1024).toFixed(1)} KB</p>
        </div>
        <button
          type="button"
          onClick={() => onFile(null)}
          disabled={disabled}
          aria-label="移除文件"
          className="rounded-lg p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--error-bg)] hover:text-[var(--error)] disabled:opacity-50"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      disabled={disabled}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all focus-visible:ring-2",
        dragOver
          ? "border-[var(--accent)] bg-[var(--accent-light)] drop-zone-active"
          : "border-[var(--border-strong)] hover:border-[var(--accent)]/40 hover:bg-[var(--accent-light)]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-xl bg-[var(--accent-light)]">
        <FileUp className="size-5 text-[var(--accent)]" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-[var(--text-secondary)]">点击或拖拽文件到此处</p>
        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
          支持 {SUPPORTED_EXTENSIONS.slice(0, 6).join(" / ")} 等 · 单文件 ≤ {MAX_FILE_SIZE_MB}MB
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={SUPPORTED_EXTENSIONS.join(",")}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </button>
  );
}

// ── Tag picker ──────────────────────────────────────────────────────────────

function TagPicker({
  tags,
  onChange,
  disabled,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState("");

  const toggle = (tag: string) => {
    if (disabled) return;
    onChange(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]);
  };

  const addCustom = () => {
    const v = custom.trim();
    if (!v || tags.includes(v) || disabled) return;
    onChange([...tags, v]);
    setCustom("");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {TAG_SUGGESTIONS.map((tag) => {
          const active = tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              disabled={disabled}
              className={cn(
                "rounded-md px-2.5 py-1 text-[12px] transition-colors",
                active
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--secondary)] text-[var(--text-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)]",
              )}
            >
              {tag}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="自定义标签，回车添加"
          disabled={disabled}
          className="h-8 text-[12px]"
        />
        <Button type="button" size="sm" variant="outline" onClick={addCustom} disabled={!custom.trim() || disabled} className="h-8">
          添加
        </Button>
      </div>
    </div>
  );
}

// ── Chunk preview list ──────────────────────────────────────────────────────

function ChunkPreviewList({ chunks }: { chunks: KnowledgeChunk[] }) {
  return (
    <div className="space-y-2">
      {chunks.map((c) => (
        <div
          key={`${c.chunk_index}-${c.start_offset}`}
          className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-3"
        >
          <div className="mb-1.5 flex items-center gap-2">
            <span className="rounded-md bg-[var(--secondary)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-tertiary)]">
              #{c.chunk_index + 1}
            </span>
            <span className="text-[10px] text-[var(--text-tertiary)]">{c.content.length} 字</span>
            {typeof c.start_offset === "number" && (
              <span className="ml-auto font-mono text-[10px] text-[var(--text-tertiary)]">
                {c.start_offset}–{c.end_offset}
              </span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-secondary)] line-clamp-5">
            {c.content}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function KnowledgeUploadPage() {
  const courseId = useMemo(() => getActiveCourseId(), []);

  const [mode, setMode] = useState<UploadMode>("file");
  const [step, setStep] = useState<Step>(1);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [url, setUrl] = useState("");
  const [knowledgeType, setKnowledgeType] = useState<string>("course_notes");
  const [tags, setTags] = useState<string[]>([]);
  const [experimentId, setExperimentId] = useState<string>("none");
  const [chunkingTemplate, setChunkingTemplate] = useState<string>("general");
  const [chunkSize, setChunkSize] = useState<string>("");
  const [chunkOverlap, setChunkOverlap] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [previewChunks, setPreviewChunks] = useState<KnowledgeChunk[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");

  const [experiments, setExperiments] = useState<Array<{ id: string; title: string }>>([]);

  useEffect(() => {
    api
      .getCourseExperiments(courseId)
      .then((res) => setExperiments(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setExperiments([]));
  }, [courseId]);

  const resetAll = useCallback(() => {
    setFile(null);
    setTitle("");
    setTextContent("");
    setUrl("");
    setKnowledgeType("course_notes");
    setTags([]);
    setExperimentId("none");
    setChunkingTemplate("general");
    setChunkSize("");
    setChunkOverlap("");
    setPreviewChunks([]);
    setResult(null);
    setError("");
    setStep(1);
  }, []);

  const switchMode = (m: UploadMode) => {
    setMode(m);
    setStep(1);
    setPreviewChunks([]);
    setResult(null);
    setError("");
  };

  const chunkConfig = useMemo(
    () => ({
      chunking_template: chunkingTemplate,
      chunk_size: chunkSize ? Number(chunkSize) : undefined,
      chunk_overlap: chunkOverlap ? Number(chunkOverlap) : undefined,
    }),
    [chunkingTemplate, chunkSize, chunkOverlap],
  );

  const hasContent = mode === "file" ? !!file : mode === "text" ? textContent.trim().length > 0 : url.trim().length > 0;

  const handlePreview = useCallback(async () => {
    if (!hasContent) return;
    setError("");
    setPreviewing(true);
    setPreviewChunks([]);
    try {
      if (mode === "file" && file) {
        const data = await ragApi.previewFile(courseId, file, chunkConfig);
        setPreviewChunks(data.chunks || []);
      } else if (mode === "text") {
        const data = await ragApi.previewText(courseId, textContent, chunkConfig);
        setPreviewChunks(data.chunks || []);
      }
      setStep(2);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setPreviewing(false);
    }
  }, [hasContent, mode, file, textContent, courseId, chunkConfig]);

  const handleSubmit = useCallback(async () => {
    if (!hasContent) return;
    setError("");
    setSubmitting(true);
    try {
      let res: UploadResult;
      if (mode === "file" && file) {
        res = await ragApi.uploadFile(courseId, file, {
          title: title || undefined,
          knowledge_type: knowledgeType,
          tags,
          experiment_id: experimentId !== "none" ? experimentId : undefined,
          ...chunkConfig,
        });
      } else if (mode === "text") {
        res = await ragApi.paste(courseId, {
          title: title || "粘贴文本",
          content: textContent,
          knowledge_type: knowledgeType,
          tags,
          experiment_id: experimentId !== "none" ? experimentId : undefined,
          ...chunkConfig,
        });
      } else {
        res = await ragApi.importUrl(courseId, {
          url,
          title: title || undefined,
          knowledge_type: knowledgeType,
          tags,
        });
      }
      setResult(res);
      setStep(3);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }, [hasContent, mode, file, textContent, url, title, knowledgeType, tags, experimentId, chunkConfig, courseId]);

  const typeMeta = knowledgeTypeMeta(knowledgeType);

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-8 pb-6 pt-6">
      {/* Header */}
      <header className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-[var(--accent-light)] ring-1 ring-[var(--accent)]/15">
            <Upload className="size-5 text-[var(--accent)]" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">知识库上传</h1>
            <p className="text-[13px] text-[var(--text-secondary)]">
              上传讲义 / 论文 / 代码，自动分块并建立检索索引（教师提交直接通过）
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={resetAll}>
          <RotateCcw className="size-4" />
          重置
        </Button>
      </header>

      {/* Mode tabs */}
      <div
        className="mb-4 flex w-fit items-center gap-1 rounded-xl bg-[var(--secondary)] p-1"
        role="tablist"
        aria-label="上传方式"
      >
        {(
          [
            { key: "file" as const, label: "文件上传", icon: FileUp },
            { key: "text" as const, label: "文本粘贴", icon: ClipboardPaste },
            { key: "url" as const, label: "URL 导入", icon: Link2 },
          ] as const
        ).map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={mode === m.key}
            onClick={() => switchMode(m.key)}
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
      </div>

      <StepIndicator step={step} />

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

      {/* Two-column layout */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[420px_1fr]">
        {/* Left: form */}
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
              <BookOpen className="size-4 text-[var(--accent)]" />
              内容来源
            </h2>
            {mode === "file" && <Dropzone file={file} onFile={setFile} disabled={step === 3} />}
            {mode === "text" && (
              <Textarea
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="在此粘贴文本知识内容，支持 Markdown 格式，系统将自动按语义分块建立索引"
                disabled={step === 3}
                className="min-h-[180px] resize-none font-mono text-[13px] leading-relaxed"
              />
            )}
            {mode === "url" && (
              <div className="space-y-1.5">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/article"
                  disabled={step === 3}
                />
                <p className="text-[11px] text-[var(--text-tertiary)]">系统将抓取页面正文并解析为知识（URL 模式不支持分块预览）</p>
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
              <Sparkles className="size-4 text-[var(--accent)]" />
              元数据
            </h2>

            <div className="space-y-1.5">
              <Label className="text-[12px] text-[var(--text-secondary)]">标题（可选）</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="为这段知识起个名字"
                disabled={step === 3}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12px] text-[var(--text-secondary)]">知识类型</Label>
              <Select value={knowledgeType} onValueChange={(v) => v && setKnowledgeType(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWLEDGE_TYPE_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-full" style={{ backgroundColor: KNOWLEDGE_TYPES[k].color }} />
                        {KNOWLEDGE_TYPES[k].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-[var(--text-tertiary)]">{typeMeta.description}</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12px] text-[var(--text-secondary)]">标签</Label>
              <TagPicker tags={tags} onChange={setTags} disabled={step === 3} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12px] text-[var(--text-secondary)]">关联实验（可选）</Label>
              <Select value={experimentId} onValueChange={(v) => v && setExperimentId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不关联</SelectItem>
                  {experiments.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-[var(--text-tertiary)]">实验上下文 RAG 暂缓，字段已预留</p>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
              <Settings2 className="size-4 text-[var(--accent)]" />
              分块策略
            </h2>
            <div className="space-y-1.5">
              <Select value={chunkingTemplate} onValueChange={(v) => v && setChunkingTemplate(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHUNKING_TEMPLATE_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {CHUNKING_TEMPLATES[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-[var(--text-tertiary)]">{CHUNKING_TEMPLATES[chunkingTemplate as keyof typeof CHUNKING_TEMPLATES]?.description}</p>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="mt-3 flex items-center gap-1 text-[12px] text-[var(--accent)]"
            >
              <ChevronDown className={cn("size-3.5 transition-transform", showAdvanced && "rotate-180")} />
              高级参数
            </button>
            {showAdvanced && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[12px] text-[var(--text-secondary)]">chunk_size</Label>
                  <Input
                    value={chunkSize}
                    onChange={(e) => setChunkSize(e.target.value.replace(/\D/g, ""))}
                    placeholder="默认"
                    inputMode="numeric"
                    disabled={step === 3}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px] text-[var(--text-secondary)]">chunk_overlap</Label>
                  <Input
                    value={chunkOverlap}
                    onChange={(e) => setChunkOverlap(e.target.value.replace(/\D/g, ""))}
                    placeholder="默认"
                    inputMode="numeric"
                    disabled={step === 3}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-1">
            {step < 2 && mode !== "url" && (
              <Button onClick={handlePreview} disabled={!hasContent || previewing} className="h-10 gap-2 px-5">
                {previewing ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                解析预览
              </Button>
            )}
            {(step >= 2 || mode === "url") && (
              <Button onClick={handleSubmit} disabled={!hasContent || submitting} className="h-10 gap-2 px-5">
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {submitting ? "提交中..." : mode === "url" ? "导入知识库" : "提交审核"}
              </Button>
            )}
            {step === 3 && (
              <Button variant="outline" onClick={resetAll} className="h-10">
                继续上传
              </Button>
            )}
          </div>
        </div>

        {/* Right: preview / result */}
        <div className="min-h-0 overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          {step === 1 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--secondary)]">
                <FileText className="size-5 text-[var(--text-tertiary)]" />
              </div>
              <p className="text-sm font-medium text-[var(--text-secondary)]">填写左侧信息后点击「解析预览」</p>
              <p className="max-w-[260px] text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                系统将按所选策略对文档分块，预览后可调整参数重新解析
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">分块预览</h3>
                <Badge variant="secondary" className="text-[11px]">
                  {previewChunks.length} 个分块
                </Badge>
              </div>
              {previewing ? (
                <div className="space-y-2">
                  <Skeleton className="h-20 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                </div>
              ) : previewChunks.length === 0 ? (
                <p className="py-10 text-center text-[12px] text-[var(--text-tertiary)]">未能解析出有效分块，请检查文档内容</p>
              ) : (
                <ChunkPreviewList chunks={previewChunks} />
              )}
              <p className="text-[11px] text-[var(--text-tertiary)]">
                预览为只读参考；若需编辑分块文本，可在提交后前往「知识审核」页面进行
              </p>
            </div>
          )}

          {step === 3 && result && (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
              {result.success ? (
                <>
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-[var(--success-bg)]">
                    <CheckCircle2 className="size-7 text-[var(--success)]" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-[var(--text-primary)]">提交成功</p>
                    <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                      {result.chunk_count} 个分块 · 版本 v{result.version_no ?? 1}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    <Badge variant="secondary" style={{ color: typeMeta.color }}>
                      {typeMeta.label}
                    </Badge>
                    {tags.map((t) => (
                      <Badge key={t} variant="outline" className="text-[11px] text-[var(--text-tertiary)]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                  <p className="max-w-[300px] text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                    教师/管理员提交直接通过并纳入检索索引；学生提交将进入待审核队列
                  </p>
                </>
              ) : (
                <>
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-[var(--error-bg)]">
                    <XCircle className="size-7 text-[var(--error)]" />
                  </div>
                  <p className="text-sm text-[var(--error)]">{result.error || "提交失败"}</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}