"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──

export interface PanelHeaderBadge {
  label: string;
  variant: "pulse" | "solid" | "outline";
  tone?: "success" | "warning" | "error" | "info" | "neutral";
}

export interface PanelHeaderProps {
  /** Lucide icon component */
  icon?: LucideIcon;
  /** Main title */
  title: string;
  /** Optional subtitle (shown after title) */
  subtitle?: string;
  /** Badge config (e.g. LIVE indicator) */
  badge?: PanelHeaderBadge;
  /** Action buttons on the right */
  actions?: React.ReactNode;
  /** Extra className */
  className?: string;
  /** Children (rendered below header line) */
  children?: React.ReactNode;
}

// ── Badge Styles ──

const badgeToneMap: Record<string, string> = {
  success: "text-[var(--kt-green)] bg-[var(--kt-green-dim)]",
  warning: "text-[var(--kt-amber)] bg-[var(--kt-amber-dim)]",
  error:   "text-[var(--kt-red)] bg-[var(--kt-red-dim)]",
  info:    "text-[var(--kt-cyan)] bg-[var(--kt-cyan-dim)]",
  neutral: "text-[var(--kt-text-secondary)] bg-[var(--kt-bg-elevated)]",
};

const badgeVariantMap: Record<string, string> = {
  pulse:  "",
  solid:  "border border-transparent",
  outline: "border border-current/20 bg-transparent",
};

// ── Component ──

export const PanelHeader = React.forwardRef<HTMLDivElement, PanelHeaderProps>(
  ({ icon: Icon, title, subtitle, badge, actions, className, children }, ref) => {
    return (
      <div ref={ref} className={cn("flex flex-col", className)}>
        {/* Main header row */}
        <div className="flex items-center gap-3 min-h-[36px] px-4 py-2">
          {/* Icon */}
          {Icon && (
            <Icon
              size={18}
              className="text-[var(--kt-cyan)] shrink-0"
              strokeWidth={1.8}
            />
          )}

          {/* Title + Subtitle */}
          <div className="flex items-baseline gap-2 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--kt-text)] truncate">
              {title}
            </h3>
            {subtitle && (
              <span className="text-xs text-[var(--kt-text-tertiary)] truncate hidden sm:inline">
                {subtitle}
              </span>
            )}
          </div>

          {/* Badge */}
          {badge && (
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide leading-none",
                badgeToneMap[badge.tone || "info"],
                badgeVariantMap[badge.variant || "solid"],
                badge.variant === "pulse" && "status-dot-live",
              )}
            >
              {badge.variant === "pulse" && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
                </span>
              )}
              {badge.label}
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action buttons */}
          {actions && (
            <div className="flex items-center gap-1 shrink-0">
              {actions}
            </div>
          )}
        </div>

        {/* Optional children (rendered below header, no extra padding by default) */}
        {children && <div className="px-4 pb-2">{children}</div>}

        {/* Bottom divider line */}
        <div className="mx-4 border-b border-[var(--kt-border)]" />
      </div>
    );
  },
);

PanelHeader.displayName = "PanelHeader";

// ── PanelHeader Action Button (small icon button for header) ──

export interface PanelHeaderActionProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label?: string;
  active?: boolean;
}

export const PanelHeaderAction: React.FC<PanelHeaderActionProps> = ({
  icon: Icon,
  label,
  active,
  className,
  ...props
}) => {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center w-7 h-7 rounded-md",
        "text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text)]",
        "hover:bg-[var(--kt-cyan-dim)] transition-colors duration-150",
        active && "text-[var(--kt-cyan)] bg-[var(--kt-cyan-dim)]",
        className,
      )}
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={14} strokeWidth={1.8} />
    </button>
  );
};
