"use client";

import { useState } from "react";
import { Check, X, ChevronDown } from "lucide-react";
import type { TestPoint, AssertionCategory } from "@/types/workspace";

const CATEGORY_LABEL: Record<AssertionCategory, string> = {
  exit_code: "退出码",
  output: "输出",
  syscall: "系统调用",
  behavior: "行为",
  numeric: "数值",
};

function formatExpectedOutput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return raw;
    }
  }
  return raw;
}

interface TestPointItemProps {
  point: TestPoint;
  index: number;
}

export default function TestPointItem({ point, index }: TestPointItemProps) {
  // Failed points expand by default so the failure reason is immediately visible.
  const [expanded, setExpanded] = useState(!point.passed);
  const earned = point.passed ? point.weight : 0;

  return (
    <div className="border-b border-app-border last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-[var(--bg-elevated)]"
      >
        <span
          aria-hidden="true"
          className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
            point.passed ? "bg-[var(--success-bg)]" : "bg-[var(--error-bg)]"
          }`}
        >
          {point.passed ? (
            <Check className="size-3 text-app-success" strokeWidth={3} />
          ) : (
            <X className="size-3 text-app-error" strokeWidth={3} />
          )}
        </span>
        <span className="sr-only">{point.passed ? "通过" : "未通过"}</span>

        <span className="w-6 shrink-0 text-[13px] font-medium text-app-text-3">
          #{index + 1}
        </span>

        <span className="min-w-0 flex-1 truncate text-sm font-medium text-app-text">
          {point.name}
        </span>

        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            point.type === "core"
              ? "bg-[var(--accent-light)] text-app-accent"
              : "bg-[var(--bg-elevated)] text-app-text-2"
          }`}
        >
          {point.type === "core" ? "核心" : "附加"}
        </span>

        <span
          className={`w-16 shrink-0 text-right text-xs font-semibold ${
            point.passed ? "text-app-success" : "text-app-error"
          }`}
        >
          {earned}/{point.weight} 分
        </span>

        <span className="w-14 shrink-0 text-right text-xs text-app-text-3">
          {point.exec_time_ms != null ? `${point.exec_time_ms}ms` : "-"}
        </span>

        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-app-text-3 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="space-y-3 px-3 pb-3 pl-14">
          {point.fail_reason && (
            <p className="text-xs leading-relaxed text-app-text-2">
              {point.fail_reason}
            </p>
          )}

          {point.runtime_error && (
            <p className="text-xs leading-relaxed text-app-error">
              运行错误：{point.runtime_error}
            </p>
          )}

          {point.assertions && point.assertions.length > 0 && (
            <div className="space-y-1.5">
              {point.assertions.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 shrink-0 ${
                      a.passed ? "text-app-success" : "text-app-error"
                    }`}
                  >
                    {a.passed ? (
                      <Check className="size-3" strokeWidth={3} />
                    ) : (
                      <X className="size-3" strokeWidth={3} />
                    )}
                  </span>
                  <span className="shrink-0 font-medium text-app-text-3">
                    {CATEGORY_LABEL[a.category] ?? a.category}
                  </span>
                  <span className="text-app-text-2">{a.detail}</span>
                </div>
              ))}
            </div>
          )}

          {point.actual_output != null && point.actual_output !== "" && (
            <div>
              <div className="mb-1 text-[11px] font-medium text-app-text-3">
                实际输出
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--bg-elevated)] p-2.5 text-xs leading-relaxed text-app-text">
                {point.actual_output}
              </pre>
            </div>
          )}

          {point.expected_output != null && point.expected_output !== "" && (
            <div>
              <div className="mb-1 text-[11px] font-medium text-app-text-3">
                期望输出
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--bg-elevated)] p-2.5 text-xs leading-relaxed text-app-text-2">
                {formatExpectedOutput(point.expected_output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}