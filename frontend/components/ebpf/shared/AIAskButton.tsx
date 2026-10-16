"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Bot, X, Sparkles, Loader2 } from "lucide-react";

export interface AIAskButtonProps {
  experimentId: string;
  context: string;
  question?: string;
  variant?: "inline" | "icon";
  className?: string;
}

export function AIAskButton({ experimentId, context, question, variant = "inline", className }: AIAskButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAsk = useCallback(async () => {
    if (variant === "inline" && open) {
      setOpen(false);
      return;
    }

    setOpen(true);
    setLoading(true);
    setError(null);

    try {
      const { api } = await import("@/lib/api");
      const prompt = question || `请分析以下 eBPF 追踪上下文中发现的问题：${context}`;
      const result = await api.aiChat(experimentId, prompt, "", "c");
      setAnswer(typeof result === "string" ? result : result?.reply || JSON.stringify(result));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "AI 请求失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [context, question, variant, open, experimentId]);

  if (variant === "icon") {
    return (
      <>
        <button
          type="button"
          onClick={handleAsk}
          className={cn(
            "inline-flex items-center justify-center size-6 rounded-md transition-colors",
            "text-[var(--kt-text-tertiary)] hover:text-[var(--kt-cyan)] hover:bg-[var(--kt-cyan-dim)]",
            className,
          )}
          title="问 AI"
          aria-label="问 AI 分析此问题"
        >
          <Bot className="size-3.5" />
        </button>

        <AnimatePresence>
          {open && (
            <AISidePanel
              loading={loading}
              answer={answer}
              error={error}
              onClose={() => { setOpen(false); setAnswer(null); }}
            />
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleAsk}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md transition-all duration-200",
          "bg-[var(--kt-cyan-dim)] text-[var(--kt-cyan)]",
          "hover:bg-[var(--kt-cyan)]/20 active:scale-[0.97]",
          className,
        )}
      >
        <Sparkles className="size-3" aria-hidden="true" />
        <span>问 AI</span>
      </button>

      <AnimatePresence>
        {open && (
          <AISidePanel
            loading={loading}
            answer={answer}
            error={error}
            onClose={() => { setOpen(false); setAnswer(null); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function AISidePanel({
  loading, answer, error, onClose,
}: {
  loading: boolean;
  answer: string | null;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="fixed right-0 top-0 bottom-[52px] w-[380px] max-w-[90vw] z-50 flex flex-col border-l shadow-2xl"
      style={{
        backgroundColor: "var(--kt-bg-glass-heavy)",
        backdropFilter: "blur(24px) saturate(200%)",
        borderColor: "var(--kt-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--kt-border)" }}
      >
        <Bot className="size-4 text-[var(--kt-cyan)]" aria-hidden="true" />
        <span className="text-sm font-semibold text-[var(--kt-text)]">AI 分析</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="flex items-center justify-center size-7 rounded-md text-[var(--kt-text-tertiary)] hover:text-[var(--kt-red)] hover:bg-[var(--kt-red-dim)] transition-colors"
          aria-label="关闭 AI 面板"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto kt-scroll p-4">
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="size-6 text-[var(--kt-cyan)] animate-spin" aria-hidden="true" />
            <p className="text-sm text-[var(--kt-text-secondary)]">AI 正在分析...</p>
          </div>
        )}

        {error && (
          <div
            className="rounded-lg p-4 text-sm"
            style={{ backgroundColor: "var(--kt-red-dim)", color: "var(--kt-red)" }}
          >
            {error}
          </div>
        )}

        {answer && !loading && (
          <div className="prose prose-sm max-w-none" style={{ color: "var(--kt-text)" }}>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</div>
          </div>
        )}
      </div>
    </motion.div>
  );
}