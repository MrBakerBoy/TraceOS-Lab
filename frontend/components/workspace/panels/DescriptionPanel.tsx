"use client";

import React from "react";
import { useWorkspaceStore } from "@/stores/workspace";

interface DescriptionPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function DescriptionPanel({ collapsed, onToggleCollapse }: DescriptionPanelProps) {
  const experiment = useWorkspaceStore((s) => s.experiment);

  if (collapsed) {
    return (
      <div className="w-full flex flex-col items-center pt-2 bg-[var(--bg-card)] border-r border-[var(--border-default)]">
        <button onClick={onToggleCollapse} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs p-1" title="展开实验说明">
          ▶
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[var(--bg-card)] flex flex-col overflow-hidden">
      <div className="h-8 flex items-center justify-between px-3 border-b border-[var(--border-default)] flex-shrink-0">
        <span className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">实验说明</span>
        <button onClick={onToggleCollapse} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs">◀</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-[13px] leading-relaxed">
        {experiment ? (
          <>
            <h3 className="text-[15px] font-semibold mb-1">{experiment.title}</h3>
            <div className="flex gap-2 mb-3">
              <span className="text-[11px] text-[var(--text-secondary)]">
                难度: <span className="font-medium text-[var(--warning)]">{experiment.difficulty || "中等"}</span>
              </span>
              <span className="text-[11px] text-[var(--text-secondary)]">
                类别: <span className="font-medium">{experiment.category || "-"}</span>
              </span>
            </div>
            {experiment.description && (
              <>
                <h4 className="text-[12px] font-semibold uppercase text-[var(--text-tertiary)] tracking-wider mt-4 mb-2">题目描述</h4>
                <p className="text-[var(--text-secondary)] whitespace-pre-wrap">{experiment.description}</p>
              </>
            )}
            {experiment.instructions && (
              <>
                <h4 className="text-[12px] font-semibold uppercase text-[var(--text-tertiary)] tracking-wider mt-4 mb-2">要求</h4>
                <p className="text-[var(--text-secondary)] whitespace-pre-wrap">{experiment.instructions}</p>
              </>
            )}
          </>
        ) : (
          <p className="text-[var(--text-tertiary)]">加载中...</p>
        )}
      </div>
    </div>
  );
}
