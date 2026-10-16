"use client";

import React from "react";
import { cn } from "@/lib/utils";

// ── Types ──

export type StatusVariant =
  | "live"
  | "running"
  | "success"
  | "warning"
  | "error"
  | "idle"
  | "offline"
  | "pending";

export type StatusSize = "sm" | "md" | "lg";

export interface StatusBadgeProps {
  variant: StatusVariant;
  label?: string;
  size?: StatusSize;
  /** Show only the dot (no text) */
  dotOnly?: boolean;
  /** Pulse animation for live/running states */
  pulse?: boolean;
  className?: string;
}

// ── Variant config ──

const variantConfig: Record<
  StatusVariant,
  { dotColor: string; bgClass: string; textClass: string; defaultLabel: string }
> = {
  live: {
    dotColor: "bg-[var(--kt-green)]",
    bgClass: "bg-[var(--kt-green-dim)]",
    textClass: "text-[var(--kt-green)]",
    defaultLabel: "LIVE",
  },
  running: {
    dotColor: "bg-[var(--kt-cyan)]",
    bgClass: "bg-[var(--kt-cyan-dim)]",
    textClass: "text-[var(--kt-cyan)]",
    defaultLabel: "RUN",
  },
  success: {
    dotColor: "bg-[var(--kt-green)]",
    bgClass: "bg-[var(--kt-green-dim)]",
    textClass: "text-[var(--kt-green)]",
    defaultLabel: "OK",
  },
  warning: {
    dotColor: "bg-[var(--kt-amber)]",
    bgClass: "bg-[var(--kt-amber-dim)]",
    textClass: "text-[var(--kt-amber)]",
    defaultLabel: "WARN",
  },
  error: {
    dotColor: "bg-[var(--kt-red)]",
    bgClass: "bg-[var(--kt-red-dim)]",
    textClass: "text-[var(--kt-red)]",
    defaultLabel: "ERR",
  },
  idle: {
    dotColor: "bg-[var(--kt-text-tertiary)]",
    bgClass: "bg-[var(--kt-bg-elevated)]",
    textClass: "text-[var(--kt-text-secondary)]",
    defaultLabel: "IDLE",
  },
  offline: {
    dotColor: "bg-[var(--kt-text-tertiary)]",
    bgClass: "bg-[var(--kt-bg-elevated)]",
    textClass: "text-[var(--kt-text-tertiary)]",
    defaultLabel: "OFF",
  },
  pending: {
    dotColor: "bg-[var(--kt-amber)]",
    bgClass: "bg-[var(--kt-amber-dim)]",
    textClass: "text-[var(--kt-amber)]",
    defaultLabel: "PEND",
  },
};

const sizeConfig: Record<StatusSize, { dot: string; text: string; padding: string }> = {
  sm: { dot: "w-1.5 h-1.5", text: "text-[10px]", padding: "px-1.5 py-0.5 gap-1" },
  md: { dot: "w-2 h-2", text: "text-[11px]", padding: "px-2 py-0.5 gap-1.5" },
  lg: { dot: "w-2.5 h-2.5", text: "text-xs", padding: "px-2.5 py-1 gap-1.5" },
};

// ── Component ──

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  variant,
  label,
  size = "md",
  dotOnly = false,
  pulse = false,
  className,
}) => {
  const v = variantConfig[variant];
  const s = sizeConfig[size];
  const shouldPulse = pulse || variant === "live" || variant === "running";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold uppercase tracking-wide leading-none",
        v.bgClass,
        v.textClass,
        s.text,
        s.padding,
        className,
      )}
      role="status"
      aria-label={label || v.defaultLabel}
    >
      {/* Dot */}
      <span className={cn("relative flex", s.dot)}>
        {shouldPulse && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full rounded-full opacity-75",
              v.dotColor,
              "animate-ping",
            )}
          />
        )}
        <span className={cn("relative inline-flex rounded-full", s.dot, v.dotColor)} />
      </span>

      {/* Label */}
      {!dotOnly && (
        <span>{label || v.defaultLabel}</span>
      )}
    </span>
  );
};

// ── Connection status (specialized for SSE/WebSocket) ──

export interface ConnectionStatusProps {
  connected: boolean;
  label?: string;
  className?: string;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  connected,
  label,
  className,
}) => {
  return (
    <StatusBadge
      variant={connected ? "live" : "offline"}
      label={label || (connected ? "连接" : "断开")}
      size="sm"
      pulse={connected}
      className={className}
    />
  );
};
