"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import type { HealthStatus } from "@/types/ebpf";

export interface HealthBadgeProps {
  status: HealthStatus;
  label: string;
  count?: number;
  onClick?: () => void;
  className?: string;
}

const STATUS_CONFIG: Record<HealthStatus, {
  icon: React.ComponentType<{ className?: string }>;
  baseColor: string;
  bgColor: string;
  labelDefault: string;
}> = {
  healthy:   { icon: CheckCircle2,  baseColor: "var(--kt-green)",  bgColor: "var(--kt-green-dim)",  labelDefault: "正常" },
  warning:   { icon: AlertTriangle, baseColor: "var(--kt-amber)",  bgColor: "var(--kt-amber-dim)",  labelDefault: "警告" },
  critical:  { icon: XCircle,       baseColor: "var(--kt-red)",    bgColor: "var(--kt-red-dim)",    labelDefault: "严重" },
  unknown:   { icon: HelpCircle,    baseColor: "var(--kt-text-tertiary)", bgColor: "transparent", labelDefault: "未知" },
};

export function HealthBadge({ status, label, count, onClick, className }: HealthBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 border",
        onClick && "cursor-pointer hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]",
        !onClick && "cursor-default",
        className,
      )}
      style={{
        color: config.baseColor,
        backgroundColor: config.bgColor,
        borderColor: config.baseColor,
        borderWidth: "0.5px",
        opacity: status === "unknown" ? 0.6 : 1,
      }}
      title={onClick ? `点击查看 ${label} 详情` : label}
    >
      <Icon className="size-3 flex-shrink-0" aria-hidden="true" />
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none"
          style={{
            backgroundColor: config.baseColor,
            color: status === "warning" ? "#000" : "#fff",
          }}
        >
          {count}
        </span>
      )}
      {onClick && (
        <span className="text-[10px] opacity-60 ml-0.5">→</span>
      )}
    </button>
  );
}