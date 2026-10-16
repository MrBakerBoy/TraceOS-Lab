"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export interface ErrorStateProps {
  /** Error message to display */
  message: string;
  /** Optional retry callback. When provided, renders a retry button. */
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="p-6">
      <div className="border border-[var(--kt-red)]/20 rounded-xl p-5 bg-[var(--kt-red-dim)]">
        <div className="flex items-center gap-2.5 mb-2">
          <AlertTriangle className="size-4 text-[var(--kt-red)]" />
          <span className="font-semibold text-[var(--kt-red)] text-sm">加载失败</span>
        </div>
        <p className="text-xs text-[var(--kt-text-secondary)]">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-3 px-4 py-2 bg-[var(--kt-cyan)] text-black text-xs rounded-lg hover:opacity-80"
          >
            <RefreshCw className="size-3 inline mr-1" />
            重试
          </button>
        )}
      </div>
    </div>
  );
}