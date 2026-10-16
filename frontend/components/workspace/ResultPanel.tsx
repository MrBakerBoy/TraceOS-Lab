"use client";

import React from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceStore } from "@/stores/workspace";
import type { EvalResult } from "@/types/workspace";

interface ResultPanelProps {
  evalResult: EvalResult | null;
  submissionId?: string;
}

export default function ResultPanel({ evalResult, submissionId }: ResultPanelProps) {
  const { diagnosis, diagnosisLoading, clearEvalResult } = useWorkspaceStore();
  if (!evalResult) return null;

  const { status, score, total_score, core_score, edge_score, is_qualified, passed_test_cases, total_test_cases, compile_error, runtime_error, execution_time } = evalResult;

  const pct = total_score && total_score > 0 ? Math.round((score || 0) / total_score * 100) : 0;
  const passedColor = pct >= 80 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--error)";

  return (
    <div className="border-t border-[var(--border-default)] bg-[var(--bg-card)]">
      <div className="flex items-center gap-3 px-3 py-2">
        <Badge variant={status === "completed" ? "success" : status === "compile_error" ? "error" : "warning"}>
          {status === "completed" ? "✅ 完成" : status === "compile_error" ? "❌ 编译错误" : status === "running" ? "🔄 运行中" : "⚠️ 失败"}
        </Badge>

        {score != null && (
          <>
            <span className="text-[13px] font-semibold" style={{ color: passedColor }}>
              {score} / {total_score || 100} 分
            </span>
            <span className="text-[12px] text-[var(--text-secondary)]">
              通过 {passed_test_cases || 0}/{total_test_cases || 0} 测试
            </span>
            {is_qualified !== undefined && (
              <Badge variant={is_qualified ? "success" : "error"}>
                {is_qualified ? "合格" : "未达标"}
              </Badge>
            )}
            {(core_score !== undefined || edge_score !== undefined) && (
              <span className="text-[11px] text-[var(--text-tertiary)]">
                核心{core_score ?? 0} · 边界{edge_score ?? 0}
              </span>
            )}
          </>
        )}

        {execution_time != null && (
          <span className="text-[11px] text-[var(--text-tertiary)] ml-auto">
            {execution_time > 1000 ? `${(execution_time / 1000).toFixed(1)}s` : `${execution_time}ms`}
          </span>
        )}

        <button
          onClick={clearEvalResult}
          className="ml-auto flex-shrink-0 p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)] transition-colors"
          title="关闭"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {compile_error && (
        <div className="px-3 pb-2">
          <pre className="text-[11px] text-[var(--error)] bg-[rgba(255,69,58,0.06)] p-2 rounded overflow-x-auto whitespace-pre-wrap">
            {compile_error}
          </pre>
        </div>
      )}

      {runtime_error && (
        <div className="px-3 pb-2">
          <pre className="text-[11px] text-[var(--warning)] bg-[rgba(255,159,10,0.06)] p-2 rounded overflow-x-auto whitespace-pre-wrap">
            {runtime_error}
          </pre>
        </div>
      )}
    </div>
  );
}
