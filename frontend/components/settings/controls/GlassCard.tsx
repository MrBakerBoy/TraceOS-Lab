"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  /** Makes the card expand to fill its container */
  fullWidth?: boolean;
  /** Adds hover Z-axis parallax lift */
  hoverLift?: boolean;
  /** Whether the card contains advanced/dev options */
  advanced?: boolean;
  /** Card header title */
  title?: string;
  /** Card header icon */
  icon?: React.ReactNode;
  /** Optional subtitle */
  subtitle?: string;
}

export function GlassCard({
  children,
  className,
  fullWidth,
  hoverLift = true,
  advanced,
  title,
  icon,
  subtitle,
}: GlassCardProps) {
  return (
    <div
      className={cn(
        "kt-glass rounded-[var(--kt-radius-md)] border border-[var(--kt-border)] overflow-hidden transition-all duration-300",
        hoverLift && "hover:-translate-y-[2px] hover:shadow-lg hover:border-[var(--kt-border-strong)]",
        fullWidth && "w-full",
        advanced && "ring-1 ring-[var(--kt-purple)]/20",
        className
      )}
    >
      {(title || icon) && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--kt-border)]">
          {icon && (
            <span className="flex-shrink-0 text-[var(--kt-cyan)]">{icon}</span>
          )}
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-[var(--kt-text)] truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-[11px] text-[var(--kt-text-tertiary)] mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          {advanced && (
            <span className="flex-shrink-0 text-[9px] font-mono text-[var(--kt-purple)] bg-[var(--kt-purple-dim)] px-1.5 py-0.5 rounded">
              DEV
            </span>
          )}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function GlassCardGroup({
  children,
  className,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {(title || subtitle) && (
        <div className="pb-1">
          {title && (
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--kt-text-tertiary)]">
              {title}
            </h2>
          )}
          {subtitle && (
            <p className="text-[10px] text-[var(--kt-text-tertiary)]/60 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      )}
      <div className="space-y-3">{children}</div>
    </div>
  );
}
