"use client";

import { useWorkspaceStore } from "@/stores/workspace";
import { useState } from "react";
import { Camera, RotateCcw, AlertTriangle } from "lucide-react";

const ALL_LANGUAGES = [
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "python", label: "Python" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
];

const FONT_SIZES = [12, 14, 16, 18, 20];

export default function EditorToolbar() {
  const { language, setLanguage, submitting, submitCode, addSnapshot, resetCodeWithOptions, experiment } =
    useWorkspaceStore();
  const [fontSize, setFontSize] = useState(14);
  const [theme, setTheme] = useState<"vs-dark" | "vs-light">("vs-dark");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Only show languages that have templates for this experiment
  const templates = experiment?.templates;
  const availableLangs = templates && templates.length > 0
    ? ALL_LANGUAGES.filter((l) => templates.some((t) => t.language === l.value && t.is_published))
    : ALL_LANGUAGES;

  const handleFontSize = (delta: number) => {
    setFontSize((prev) => {
      const idx = FONT_SIZES.indexOf(prev);
      if (idx === -1) return prev;
      const next = idx + delta;
      if (next < 0 || next >= FONT_SIZES.length) return prev;
      return FONT_SIZES[next];
    });
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b bg-[var(--kt-bg-surface)]">
      <div className="flex items-center gap-2">
        {/* Language selector */}
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="px-2 py-1 border border-[var(--kt-border)] rounded text-sm bg-[var(--kt-bg-elevated)] text-[var(--kt-text)] outline-none focus:border-[var(--kt-cyan)]"
        >
          {availableLangs.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>

        {/* Theme toggle */}
        <button
          onClick={() =>
            setTheme(theme === "vs-dark" ? "vs-light" : "vs-dark")
          }
          className="px-2 py-1 text-sm border border-[var(--kt-border)] rounded hover:bg-[var(--kt-bg-elevated)] text-[var(--kt-text-secondary)] hover:text-[var(--kt-text)] transition-colors"
          title={theme === "vs-dark" ? "亮色主题" : "暗色主题"}
        >
          {theme === "vs-dark" ? "🌙" : "☀️"}
        </button>

        {/* Font size control */}
        <div className="flex items-center border border-[var(--kt-border)] rounded">
          <button
            onClick={() => handleFontSize(-1)}
            className="px-2 py-1 text-sm hover:bg-[var(--kt-bg-elevated)] text-[var(--kt-text-secondary)]"
            title="缩小字体"
          >
            A-
          </button>
          <span className="px-2 py-1 text-xs text-[var(--kt-text-tertiary)] border-x border-[var(--kt-border)]">
            {fontSize}px
          </span>
          <button
            onClick={() => handleFontSize(1)}
            className="px-2 py-1 text-sm hover:bg-[var(--kt-bg-elevated)] text-[var(--kt-text-secondary)]"
            title="放大字体"
          >
            A+
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {/* Save snapshot */}
        <button
          onClick={() => addSnapshot("手动保存")}
          className="px-3 py-1 text-xs border border-[var(--kt-border)] rounded text-[var(--kt-text-secondary)] hover:text-[var(--kt-cyan)] hover:border-[var(--kt-cyan)] transition-colors flex items-center gap-1"
          title="保存代码快照 (Ctrl+S)"
        >
          <Camera className="size-3" />
          快照
        </button>

        {/* Reset with confirmation */}
        <button
          onClick={() => setShowResetConfirm(true)}
          disabled={submitting}
          className="px-3 py-1 text-xs border border-[var(--kt-red)]/30 rounded text-[var(--kt-red)] hover:bg-[var(--kt-red-dim)] disabled:opacity-30 transition-colors flex items-center gap-1"
          title="重置代码"
        >
          <RotateCcw className="size-3" />
          重置
        </button>

        <button
          onClick={submitCode}
          disabled={submitting}
          className="px-4 py-1 text-xs bg-[var(--kt-green)] text-black rounded hover:opacity-90 disabled:opacity-50 font-semibold transition-opacity"
        >
          {submitting ? "提交中..." : "▶ 提交"}
        </button>
      </div>

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowResetConfirm(false)}>
          <div
            className="bg-[var(--kt-bg-glass-heavy)] backdrop-blur-xl border border-[var(--kt-border)] rounded-[var(--kt-radius-lg)] p-6 w-[400px] max-w-[90vw] shadow-2xl kt-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[var(--kt-red-dim)] flex items-center justify-center">
                <AlertTriangle className="size-5 text-[var(--kt-red)]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--kt-text)]">确认重置代码</h3>
                <p className="text-[11px] text-[var(--kt-text-secondary)]">此操作将清除编辑器中的代码</p>
              </div>
            </div>

            <div className="space-y-2 mb-4">
              <button
                onClick={() => { resetCodeWithOptions(true); setShowResetConfirm(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--kt-border)] hover:border-[var(--kt-amber)] hover:bg-[var(--kt-amber-dim)] transition-colors text-left"
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--kt-amber-dim)] flex items-center justify-center">
                  <span className="text-sm">📋</span>
                </div>
                <div>
                  <div className="text-xs font-medium text-[var(--kt-text)]">保留框架代码</div>
                  <div className="text-[10px] text-[var(--kt-text-tertiary)]">保留 #include、main 函数框架，仅清空自定义实现</div>
                </div>
              </button>

              <button
                onClick={() => { resetCodeWithOptions(false); setShowResetConfirm(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--kt-border)] hover:border-[var(--kt-red)] hover:bg-[var(--kt-red-dim)] transition-colors text-left"
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--kt-red-dim)] flex items-center justify-center">
                  <span className="text-sm">🗑️</span>
                </div>
                <div>
                  <div className="text-xs font-medium text-[var(--kt-text)]">全部重置</div>
                  <div className="text-[10px] text-[var(--kt-text-tertiary)]">完全恢复为实验初始模板代码</div>
                </div>
              </button>
            </div>

            <button
              onClick={() => setShowResetConfirm(false)}
              className="w-full py-2 text-xs text-[var(--kt-text-secondary)] hover:text-[var(--kt-text)] transition-colors border border-[var(--kt-border)] rounded-lg hover:bg-[var(--kt-bg-elevated)]"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
