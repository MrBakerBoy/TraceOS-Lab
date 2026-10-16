"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Search, AlertTriangle, Inbox, Loader2, RefreshCw } from "lucide-react";

export type EmptyStateType = "no-data" | "no-issues" | "loading" | "error";

export interface EmptyStateProps {
  type: EmptyStateType;
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

const CONFIG: Record<EmptyStateType, {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  defaultTitle: string;
  defaultDescription: string;
}> = {
  "no-data": {
    icon: Inbox,
    iconColor: "var(--kt-text-tertiary)",
    iconBg: "var(--kt-bg-elevated)",
    defaultTitle: "暂无数据",
    defaultDescription: "提交代码运行后即可查看 eBPF 追踪结果",
  },
  "no-issues": {
    icon: Search,
    iconColor: "var(--kt-green)",
    iconBg: "var(--kt-green-dim)",
    defaultTitle: "未检测到问题",
    defaultDescription: "程序运行正常，各项指标均在安全范围内",
  },
  loading: {
    icon: Loader2,
    iconColor: "var(--kt-cyan)",
    iconBg: "var(--kt-cyan-dim)",
    defaultTitle: "正在分析...",
    defaultDescription: "eBPF 正在追踪程序运行数据",
  },
  error: {
    icon: AlertTriangle,
    iconColor: "var(--kt-red)",
    iconBg: "var(--kt-red-dim)",
    defaultTitle: "加载失败",
    defaultDescription: "数据获取出错，请检查网络连接后重试",
  },
};

export function EmptyState({
  type, title, description, onRetry, className,
}: EmptyStateProps) {
  const config = CONFIG[type];
  const Icon = config.icon;
  const isLoading = type === "loading";

  return (
    <div className={cn("flex flex-col items-center justify-center py-16 px-6", className)}>
      {/* Icon container */}
      <div
        className="flex items-center justify-center size-16 rounded-2xl mb-4"
        style={{ backgroundColor: config.iconBg }}
      >
        <Icon
          className={cn("size-8", isLoading && "animate-spin")}
          style={{ color: config.iconColor }}
          aria-hidden={!isLoading}
        />
      </div>

      {/* Title */}
      <p className="text-sm font-semibold text-[var(--kt-text-secondary)] mb-1">
        {title || config.defaultTitle}
      </p>

      {/* Description */}
      <p className="text-xs text-[var(--kt-text-tertiary)] text-center max-w-xs leading-relaxed">
        {description || config.defaultDescription}
      </p>

      {/* Retry button (error state only) */}
      {type === "error" && onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 hover:brightness-110 active:scale-[0.97]"
          style={{
            backgroundColor: "var(--kt-cyan)",
            color: "#000",
          }}
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          重试
        </button>
      )}
    </div>
  );
}