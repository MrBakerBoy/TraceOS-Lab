"use client";

import React from "react";
import Link from "next/link";
import { useWorkspaceStore } from "@/stores/workspace";
import type { LayoutPreset } from "@/stores/workspace";
import { cn } from "@/lib/utils";
import { ArrowLeft, Play, Send, Code2, Bug, BarChart3, BookOpen } from "lucide-react";
import { ThemeSwitcher } from "@/components/workspace/ThemeSwitcher";

export function KernelNavbar() {
  const {
    experiment,
    layoutPreset,
    setLayoutPreset,
    submitting,
    submitCode,
    canViewAnswer,
    setShowAnswerModal,
  } = useWorkspaceStore();

  const presets: { id: LayoutPreset; label: string; icon: React.ReactNode; hint: string }[] = [
    { id: "coding", label: "编码", icon: <Code2 className="size-3.5" />, hint: "收起全部面板，编辑器最大化" },
    { id: "debugging", label: "调试", icon: <Bug className="size-3.5" />, hint: "默认上下分屏，编辑器+工具面板" },
    { id: "analyzing", label: "分析", icon: <BarChart3 className="size-3.5" />, hint: "展开右侧指标，左右分屏对比" },
  ];

  return (
    <div className="kt-navbar flex items-center gap-3 px-4 flex-shrink-0 select-none">
      {/* Back button */}
      <Link
        href="/experiments"
        className="flex items-center gap-1.5 text-xs text-[var(--kt-text-secondary)] hover:text-[var(--kt-cyan)] transition-colors px-2 py-1 rounded-md hover:bg-[var(--kt-cyan-dim)]"
        title="返回实验列表"
      >
        <ArrowLeft className="size-3.5" />
        <span className="hidden sm:inline">返回</span>
      </Link>

      {/* Separator */}
      <div className="w-px h-5 bg-[var(--kt-border)]" />

      {/* Experiment title */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-[var(--kt-cyan)] via-[var(--kt-purple)] to-[var(--kt-green)] flex items-center justify-center flex-shrink-0 shadow-sm">
          <span className="text-[10px] font-bold text-black">OS</span>
        </div>
        <h2 className="text-sm font-semibold text-[var(--kt-text)] truncate max-w-[260px]">
          {experiment?.title || "实验工作区"}
        </h2>
        {experiment?.category && (
          <span className="hidden md:inline text-[10px] text-[var(--kt-text-tertiary)] bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)] px-1.5 py-0.5 rounded font-mono">
            {experiment.category}
          </span>
        )}
      </div>

<div className="flex-1" />

      {/* Theme switcher */}
      <ThemeSwitcher />

      {/* Layout presets */}
      <div className="flex items-center gap-1 bg-[var(--kt-bg-surface)] border border-[var(--kt-border)] rounded-lg p-0.5">
        {presets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => setLayoutPreset(preset.id)}
            className={cn(
              "kt-preset-btn",
              layoutPreset === preset.id && "active"
            )}
            title={preset.hint}
          >
            {preset.icon}
            <span className="hidden lg:inline">{preset.label}</span>
          </button>
        ))}
      </div>

      {/* Reference answer button */}
      <button
        onClick={() => setShowAnswerModal(true)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-[var(--kt-border)] bg-[var(--kt-bg-elevated)] text-[var(--kt-text-secondary)] hover:text-[var(--kt-amber)] hover:border-[var(--kt-amber)] hover:bg-[var(--kt-amber-dim)] transition-all"
        title="查看参考答案"
      >
        <BookOpen className="size-3.5" />
        <span className="hidden lg:inline">答案</span>
      </button>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={submitCode}
          disabled={submitting}
          className="kt-run-btn"
        >
          {submitting ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin mr-1" />
              运行中
            </>
          ) : (
            <>
              <Play className="size-3.5" />
              <span className="hidden sm:inline ml-1">运行</span>
            </>
          )}
        </button>
        <button
          onClick={submitCode}
          disabled={submitting}
          className="kt-submit-btn"
          title="提交代码并评测"
        >
          <Send className="size-3.5" />
          <span className="hidden sm:inline ml-1">提交</span>
        </button>
      </div>
    </div>
  );
}
