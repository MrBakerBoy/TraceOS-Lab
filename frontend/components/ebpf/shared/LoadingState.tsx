"use client";

import React from "react";
import { Activity } from "lucide-react";

export interface LoadingStateProps {
  /** Loading message shown below spinner. Defaults to "加载中..." */
  message?: string;
}

export function LoadingState({ message = "加载中..." }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      <div className="relative mb-4">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-[var(--kt-cyan)]/20 border-t-[var(--kt-cyan)]" />
        <Activity className="absolute inset-0 m-auto size-4 text-[var(--kt-cyan)]/60" />
      </div>
      <p className="text-sm text-[var(--kt-text-secondary)] font-medium">{message}</p>
    </div>
  );
}