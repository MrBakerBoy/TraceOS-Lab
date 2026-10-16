"use client";

import React from "react";
import { useWorkspaceStore } from "@/stores/workspace";
import { cn } from "@/lib/utils";
import { History, GitCompare, CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";

export function RunHistoryPanel() {
  const {
    runHistory,
    clearRunHistory,
    compareRunIds,
    setCompareRunIds,
  } = useWorkspaceStore();

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 className="size-3 text-[var(--kt-green)]" />;
    if (status === "failed") return <XCircle className="size-3 text-[var(--kt-red)]" />;
    if (status === "compile_error") return <AlertTriangle className="size-3 text-[var(--kt-amber)]" />;
    return <Clock className="size-3 text-[var(--kt-text-tertiary)]" />;
  };

  const toggleCompare = (id: string) => {
    if (!compareRunIds) {
      setCompareRunIds([id, ""] as [string, string]);
    } else if (compareRunIds[0] === id) {
      setCompareRunIds(null);
    } else if (!compareRunIds[1]) {
      setCompareRunIds([compareRunIds[0], id]);
    } else {
      setCompareRunIds([id, ""] as [string, string]);
    }
  };

  const isCompared = (id: string) => compareRunIds?.includes(id);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--kt-border)] flex-shrink-0">
        <History className="size-3.5 text-[var(--kt-amber)]" />
        <span className="text-xs font-semibold text-[var(--kt-text)]">运行历史</span>
        <div className="flex-1" />
        {compareRunIds && compareRunIds[0] && compareRunIds[1] && (
          <span className="text-[10px] text-[var(--kt-purple)]">对比模式</span>
        )}
        <button
          onClick={clearRunHistory}
          className="text-[10px] text-[var(--kt-text-tertiary)] hover:text-[var(--kt-red)] transition-colors"
          title="清空历史"
        >
          清空
        </button>
      </div>

      {/* History list */}
      <div className="flex-1 overflow-y-auto kt-scroll">
        {runHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <History className="size-6 text-[var(--kt-text-tertiary)] mb-2" />
            <p className="text-[11px] text-[var(--kt-text-tertiary)]">暂无运行记录</p>
            <p className="text-[10px] text-[var(--kt-text-tertiary)] mt-0.5">运行代码后自动保存</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {runHistory.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "flex items-center gap-2 p-2 rounded-md border transition-colors cursor-pointer",
                  isCompared(entry.id)
                    ? "border-[var(--kt-purple)]/40 bg-[var(--kt-purple-dim)]"
                    : "border-transparent hover:border-[var(--kt-border)] hover:bg-[var(--kt-bg-elevated)]"
                )}
                onClick={() => toggleCompare(entry.id)}
              >
                {statusIcon(entry.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-[var(--kt-text)]">
                      {entry.score}/{entry.totalScore}
                    </span>
                    <span className="text-[10px] text-[var(--kt-text-tertiary)]">
                      {entry.passedTests}/{entry.totalTests} 通过
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--kt-text-tertiary)]">
                    {new Date(entry.timestamp).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleCompare(entry.id); }}
                  className={cn(
                    "p-1 rounded transition-colors",
                    isCompared(entry.id)
                      ? "text-[var(--kt-purple)] bg-[var(--kt-purple-dim)]"
                      : "text-[var(--kt-text-tertiary)] hover:text-[var(--kt-cyan)]"
                  )}
                  title="选择对比"
                >
                  <GitCompare className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Compare action bar */}
      {compareRunIds && compareRunIds[0] && compareRunIds[1] && (
        <div className="px-3 py-2 border-t border-[var(--kt-border)] bg-[var(--kt-purple-dim)] flex-shrink-0">
          <div className="flex items-center gap-2">
            <GitCompare className="size-3.5 text-[var(--kt-purple)]" />
            <span className="text-[11px] text-[var(--kt-purple)] font-medium">已选择 2 项进行对比</span>
            <button
              onClick={() => setCompareRunIds(null)}
              className="ml-auto text-[10px] text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text)]"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
