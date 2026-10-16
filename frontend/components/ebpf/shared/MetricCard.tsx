"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { HealthStatus } from "@/types/ebpf";

export interface MetricCardProps {
  title: string;
  value: number | string;
  unit?: string;
  trend?: "up" | "down" | "stable";
  trendValue?: string;
  status?: HealthStatus;
  comparisonValue?: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  className?: string;
}

const STATUS_BORDER: Record<HealthStatus, string> = {
  healthy:  "var(--kt-green)",
  warning:  "var(--kt-amber)",
  critical: "var(--kt-red)",
  unknown:  "var(--kt-border)",
};

const TREND_CONFIG = {
  up:      { icon: TrendingUp,   color: "var(--kt-green)" },
  down:    { icon: TrendingDown, color: "var(--kt-red)" },
  stable:  { icon: Minus,        color: "var(--kt-text-tertiary)" },
};

export function MetricCard({
  title, value, unit, trend, trendValue, status, comparisonValue,
  icon: Icon, onClick, className,
}: MetricCardProps) {
  const trendCfg = trend ? TREND_CONFIG[trend] : null;
  const TrendIcon = trendCfg?.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "relative flex flex-col rounded-lg border p-3 text-left transition-all duration-200",
        "hover:bg-[var(--kt-bg-elevated)]/80",
        onClick && "cursor-pointer hover:border-[var(--kt-cyan)]/30",
        !onClick && "cursor-default",
        className,
      )}
      style={{
        borderColor: status ? STATUS_BORDER[status] : "var(--kt-border)",
        backgroundColor: "var(--kt-bg-surface)",
        borderLeftWidth: status ? "3px" : "1px",
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon className="size-3 text-[var(--kt-text-tertiary)]" aria-hidden="true" />}
        <span className="text-[10px] text-[var(--kt-text-tertiary)] truncate">{title}</span>
      </div>

      {/* Value row */}
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold tabular-nums text-[var(--kt-text)] leading-none">
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {unit && (
          <span className="text-[11px] text-[var(--kt-text-tertiary)]">{unit}</span>
        )}
      </div>

      {/* Trend + comparison row */}
      {(trendCfg || comparisonValue) && (
        <div className="flex items-center gap-2 mt-1.5">
          {trendCfg && TrendIcon && (
            <div className="flex items-center gap-0.5" style={{ color: trendCfg.color }}>
              <TrendIcon className="size-3" aria-hidden="true" />
              {trendValue && (
                <span className="text-[10px] font-medium tabular-nums">{trendValue}</span>
              )}
            </div>
          )}
          {comparisonValue && (
            <span className="text-[10px] text-[var(--kt-text-tertiary)] truncate">
              {comparisonValue}
            </span>
          )}
        </div>
      )}

      {/* Click indicator */}
      {onClick && (
        <span
          className="absolute top-2 right-2 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "var(--kt-cyan)" }}
        >
          →
        </span>
      )}
    </button>
  );
}