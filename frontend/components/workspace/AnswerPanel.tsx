"use client";

import React, { useState } from "react";
import { BookOpen, Copy, Check, Lock, Code2, FileText, X } from "lucide-react";
import type { Experiment } from "@/types/workspace";

interface Props {
  experiment: Experiment | null;
  canViewAnswer: boolean;
  isTeacherOrAdmin: boolean;
  onClose: () => void;
}

export default function AnswerPanel({ experiment, canViewAnswer, isTeacherOrAdmin, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<"code" | "explanation">("code");
  const [copied, setCopied] = useState(false);

  const hasAccess = isTeacherOrAdmin || canViewAnswer;

  // Collect reference solution from templates or experiment
  const templates = experiment?.templates;
  const refSolution = templates?.find((t) => t.reference_solution)?.reference_solution
    || experiment?.reference_solution;

  const explanation = experiment?.answer_explanation;

  const handleCopy = async () => {
    if (!refSolution) return;
    try {
      await navigator.clipboard.writeText(refSolution);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = refSolution;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Build line-numbered code display
  const codeLines = refSolution ? refSolution.split("\n") : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex flex-col overflow-hidden w-[92vw] max-w-5xl max-h-[88vh] rounded-xl border shadow-2xl"
        style={{
          background: "var(--kt-bg-glass-heavy, rgba(18,18,24,0.95))",
          borderColor: "var(--kt-border, #2a2a3a)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-5 py-3.5 border-b flex-shrink-0"
          style={{ borderColor: "var(--kt-border, #2a2a3a)", background: "var(--kt-bg-surface, #16161e)" }}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ background: "var(--kt-amber-dim, rgba(245,158,11,0.15))" }}>
              <BookOpen className="size-4" style={{ color: "var(--kt-amber, #f59e0b)" }} />
            </div>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--kt-text, #e0e0e0)" }}>参考答案</h2>
              <p className="text-[11px]" style={{ color: "var(--kt-text-tertiary, #666)" }}>
                {experiment?.title || "实验"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-md transition-colors"
            style={{ color: "var(--kt-text-tertiary, #666)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--kt-bg-elevated, #222)"; e.currentTarget.style.color = "var(--kt-text, #e0e0e0)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--kt-text-tertiary, #666)"; }}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* ── Content ── */}
        {hasAccess && refSolution ? (
          <>
            {/* Tabs */}
            <div
              className="flex items-center gap-0 px-5 pt-3 flex-shrink-0"
              style={{ background: "var(--kt-bg-deep, #0d0d14)" }}
            >
              <button
                onClick={() => setActiveTab("code")}
                className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-t-md transition-colors"
                style={{
                  color: activeTab === "code" ? "var(--kt-amber, #f59e0b)" : "var(--kt-text-tertiary, #666)",
                  borderBottom: activeTab === "code" ? "2px solid var(--kt-amber, #f59e0b)" : "2px solid transparent",
                }}
              >
                <Code2 className="size-3.5" />
                参考代码
              </button>
              {explanation && (
                <button
                  onClick={() => setActiveTab("explanation")}
                  className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-t-md transition-colors"
                  style={{
                    color: activeTab === "explanation" ? "var(--kt-amber, #f59e0b)" : "var(--kt-text-tertiary, #666)",
                    borderBottom: activeTab === "explanation" ? "2px solid var(--kt-amber, #f59e0b)" : "2px solid transparent",
                  }}
                >
                  <FileText className="size-3.5" />
                  解题思路
                </button>
              )}
              <div className="flex-1 border-b" style={{ borderColor: "var(--kt-border, #2a2a3a)" }} />
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md transition-all mb-1"
                style={{
                  background: copied ? "var(--kt-green-dim, rgba(34,197,94,0.15))" : "var(--kt-amber-dim, rgba(245,158,11,0.12))",
                  color: copied ? "var(--kt-green, #22c55e)" : "var(--kt-amber, #f59e0b)",
                }}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? "已复制" : "复制代码"}
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-auto" style={{ background: "var(--kt-bg-deep, #0d0d14)" }}>
              {activeTab === "code" ? (
                <div className="flex">
                  {/* Line numbers */}
                  <div
                    className="flex-shrink-0 select-none py-4 pl-4 pr-3 text-right font-mono text-[12px] leading-6"
                    style={{ color: "var(--kt-text-tertiary, #444)", minWidth: "3rem" }}
                  >
                    {codeLines.map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  {/* Code */}
                  <pre
                    className="flex-1 py-4 pr-4 font-mono text-[13px] leading-6 whitespace-pre overflow-x-auto m-0"
                    style={{ color: "var(--editor-fg, #d4d4d4)" }}
                  >
                    {refSolution}
                  </pre>
                </div>
              ) : (
                <div className="p-5">
                  <div
                    className="text-[13px] leading-relaxed whitespace-pre-wrap"
                    style={{ color: "var(--kt-text-secondary, #aaa)" }}
                  >
                    {explanation}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Locked state */
          <div
            className="flex-1 flex flex-col items-center justify-center gap-4 p-10"
            style={{ background: "var(--kt-bg-deep, #0d0d14)" }}
          >
            <div
              className="flex items-center justify-center w-16 h-16 rounded-full"
              style={{ background: "var(--kt-bg-elevated, #1a1a24)" }}
            >
              <Lock className="size-7" style={{ color: "var(--kt-text-tertiary, #555)" }} />
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm font-medium" style={{ color: "var(--kt-text, #e0e0e0)" }}>答案尚未解锁</p>
              <p className="text-[12px] max-w-sm" style={{ color: "var(--kt-text-tertiary, #666)" }}>
                提交代码并获得 <span style={{ color: "var(--kt-amber, #f59e0b)", fontWeight: 600 }}>60%</span> 以上的分数后，即可查看参考答案
              </p>
            </div>
            {!hasAccess && !refSolution && (
              <div
                className="mt-2 px-4 py-2 rounded-lg text-[11px]"
                style={{ background: "var(--kt-bg-elevated, #1a1a24)", color: "var(--kt-text-tertiary, #555)" }}
              >
                本题暂未配置参考答案
              </div>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-2.5 border-t flex-shrink-0"
          style={{ borderColor: "var(--kt-border, #2a2a3a)", background: "var(--kt-bg-surface, #16161e)" }}
        >
          <span className="text-[10px] mr-auto" style={{ color: "var(--kt-text-tertiary, #555)" }}>
            {hasAccess ? "教师/管理员可查看" : "通过测试后自动解锁"}
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors"
            style={{
              background: "var(--kt-bg-elevated, #222)",
              color: "var(--kt-text-secondary, #aaa)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--kt-border, #333)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--kt-bg-elevated, #222)"; }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
