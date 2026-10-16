"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";
import { Database, Search, Activity, ServerCrash } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──

export type EmptyStateVariant = "no-data" | "no-results" | "no-activity" | "error";

const variantConfig: Record<
  EmptyStateVariant,
  { icon: LucideIcon; defaultTitle: string; defaultDescription: string }
> = {
  "no-data": {
    icon: Database,
    defaultTitle: "暂无数据",
    defaultDescription: "运行程序后，数据将在此处展示",
  },
  "no-results": {
    icon: Search,
    defaultTitle: "未找到匹配结果",
    defaultDescription: "尝试调整筛选条件或搜索关键词",
  },
  "no-activity": {
    icon: Activity,
    defaultTitle: "暂无活动",
    defaultDescription: "当前没有实时事件，启动程序后会自动刷新",
  },
  error: {
    icon: ServerCrash,
    defaultTitle: "加载失败",
    defaultDescription: "数据请求遇到问题，请稍后重试",
  },
};

export interface EmptyStateProps {
  variant?: EmptyStateVariant;
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** Compact mode: smaller padding, icon, text */
  compact?: boolean;
}

// ── Component ──

export const EmptyState: React.FC<EmptyStateProps> = ({
  variant = "no-data",
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}) => {
  const config = variantConfig[variant];
  const Icon = icon || config.icon;
  const displayTitle = title || config.defaultTitle;
  const displayDescription = description || config.defaultDescription;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-6 px-4 gap-2" : "py-12 px-6 gap-4",
        className,
      )}
    >
      {/* Icon with subtle glow */}
      <div
        className={cn(
          "relative flex items-center justify-center rounded-full",
          "bg-[var(--kt-cyan-dim)]",
          compact ? "w-12 h-12" : "w-16 h-16",
        )}
      >
        <Icon
          size={compact ? 22 : 28}
          className="text-[var(--kt-cyan)] opacity-60"
          strokeWidth={1.5}
        />
        {/* Subtle glow ring */}
        <div className="absolute inset-0 rounded-full border border-[var(--kt-cyan)]/10" />
      </div>

      {/* Title */}
      <p
        className={cn(
          "font-medium text-[var(--kt-text-secondary)]",
          compact ? "text-sm" : "text-base",
        )}
      >
        {displayTitle}
      </p>

      {/* Description */}
      {displayDescription && (
        <p
          className={cn(
            "text-[var(--kt-text-tertiary)] max-w-xs leading-relaxed",
            compact ? "text-xs" : "text-sm",
          )}
        >
          {displayDescription}
        </p>
      )}

      {/* Action */}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
};

// ── Inline loading state (sits inside a panel instead of replacing content) ──

export const InlineLoading: React.FC<{
  message?: string;
  className?: string;
}> = ({ message = "加载中...", className }) => {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-3 py-12",
        className,
      )}
    >
      <div className="w-5 h-5 border-2 border-[var(--kt-cyan)]/30 border-t-[var(--kt-cyan)] rounded-full animate-spin" />
      <span className="text-sm text-[var(--kt-text-tertiary)]">
        {message}
      </span>
    </div>
  );
};
