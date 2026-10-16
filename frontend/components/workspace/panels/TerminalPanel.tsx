"use client";

import React, { useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace";

interface TerminalPanelProps {
  visible: boolean;
}

export function TerminalPanel({ visible }: TerminalPanelProps) {
  const result = useWorkspaceStore((s) => s.evalResult);
  const submitting = useWorkspaceStore((s) => s.submitting);
  const [displayLines, setDisplayLines] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const outputText = result?.compile_error || result?.runtime_error || "";

  useEffect(() => {
    if (!outputText) {
      setDisplayLines([]);
      return;
    }
    const lines = outputText.split("\n");
    setDisplayLines([]);

    let i = 0;
    const timer = setInterval(() => {
      if (i < lines.length) {
        setDisplayLines((prev) => [...prev, lines[i]]);
        i++;
      } else {
        clearInterval(timer);
      }
    }, 25);

    return () => clearInterval(timer);
  }, [outputText]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayLines]);

  if (!visible) return null;

  return (
    <div
      className="bg-[var(--terminal-bg)] border-t border-[#333] flex flex-col flex-shrink-0"
      style={{ height: "220px" }}
    >
      {/* Terminal header */}
      <div className="h-8 flex items-center px-3 border-b border-[#333] flex-shrink-0 gap-3">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        </div>
        <span className="text-[11px] font-semibold text-[#999] uppercase tracking-wider">
          终端输出
        </span>
        {submitting && (
          <span className="text-[11px] text-[var(--accent)] ml-auto flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            运行中...
          </span>
        )}
        {result && !submitting && (
          <span className="text-[11px] text-[#999] ml-auto">
            {result.score != null ? `${result.score}/${result.total_score || 100} 分` : ""}
          </span>
        )}
      </div>

      {/* Terminal body */}
      <div className="flex-1 overflow-y-auto p-3 font-mono text-[12px] leading-relaxed">
        {displayLines.length === 0 && !submitting && (
          <div className="text-[#6a9955] space-y-1">
            {result ? (
              <>
                <div>{">>> 评测完成 <<<"}</div>
                <div>状态: {result.status === "completed" ? "✅ 通过" : result.status === "failed" ? "❌ 失败" : result.status === "compile_error" ? "⚠️ 编译错误" : result.status}</div>
                {result.score != null && <div>得分: {result.score} / {result.total_score || 100}</div>}
                <div>通过: {result.passed_test_cases} / {result.total_test_cases} 个测试用例</div>
                {result.execution_time != null && <div>执行时间: {result.execution_time}s</div>}
              </>
            ) : (
              <span>等待运行...</span>
            )}
          </div>
        )}
        {displayLines.map((line, i) => {
          const safeLine = line ?? "";
          const lowerLine = safeLine.toLowerCase();
          return (
            <div key={i} className="text-[#cccccc]">
              {safeLine.startsWith("Error") || lowerLine.includes("error") ? (
                <span className="text-[#f44747]">{safeLine}</span>
              ) : safeLine.startsWith("$") ? (
                <span className="text-[#4ec9b0]">{safeLine}</span>
              ) : safeLine.startsWith("warning") || lowerLine.includes("warning") ? (
                <span className="text-[#febc2e]">{safeLine}</span>
              ) : (
                safeLine
              )}
            </div>
          );
        })}
        {submitting && displayLines.length === 0 && (
          <div className="text-[#6a9955] space-y-1">
            <div>{"$ gcc main.c -lpthread -o solution"}</div>
            <div className="animate-pulse">编译中...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
