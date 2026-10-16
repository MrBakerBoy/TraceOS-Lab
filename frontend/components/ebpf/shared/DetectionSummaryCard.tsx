"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import type { HealthStatus } from "@/types/ebpf";

export interface DetectionSummaryCardProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  status: HealthStatus;
  summary: string;
  details?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
}

const STATUS_STYLE: Record<HealthStatus, {
  bg: string;
  border: string;
  titleColor: string;
}> = {
  healthy:  { bg: "var(--kt-green-dim)",  border: "var(--kt-green)/30",  titleColor: "var(--kt-green)" },
  warning:  { bg: "var(--kt-amber-dim)",  border: "var(--kt-amber)/30",  titleColor: "var(--kt-amber)" },
  critical: { bg: "var(--kt-red-dim)",    border: "var(--kt-red)/30",    titleColor: "var(--kt-red)" },
  unknown:  { bg: "var(--kt-bg-elevated)", border: "var(--kt-border)",   titleColor: "var(--kt-text-secondary)" },
};

export function DetectionSummaryCard({
  title, icon: Icon, status, summary, details, onClick, children, className,
}: DetectionSummaryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const style = STATUS_STYLE[status];

  return (
    <div
      className={cn(
        "rounded-lg border transition-all duration-200",
        onClick && "cursor-pointer hover:brightness-105",
        className,
      )}
      style={{
        borderColor: style.border,
        backgroundColor: style.bg,
        borderLeftWidth: "3px",
        borderLeftColor: style.titleColor,
      }}
    >
      {/* Clickable header */}
      <button
        type="button"
        onClick={onClick || (children ? () => setExpanded(!expanded) : undefined)}
        disabled={!onClick && !children}
        className="w-full flex items-center gap-3 p-3 text-left"
      >
        {/* Icon */}
        <div
          className="flex items-center justify-center size-9 rounded-lg flex-shrink-0"
          style={{ backgroundColor: style.titleColor, opacity: 0.15 }}
        >
          <Icon className="size-4" style={{ color: style.titleColor }} aria-hidden="true" />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold" style={{ color: style.titleColor }}>
              {title}
            </span>
          </div>
          <p className="text-[11px] text-[var(--kt-text-secondary)] mt-0.5 truncate">
            {summary}
          </p>
          {details && (
            <p className="text-[10px] text-[var(--kt-text-tertiary)] mt-0.5 truncate">
              {details}
            </p>
          )}
        </div>

        {/* Action indicators */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {onClick && (
            <span className="text-[10px] opacity-60" style={{ color: style.titleColor }}>查看详情 →</span>
          )}
          {children && !onClick && (
            <motion.div
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="size-3.5" style={{ color: style.titleColor }} />
            </motion.div>
          )}
        </div>
      </button>

      {/* Expandable content */}
      <AnimatePresence initial={false}>
        {expanded && children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 border-t mx-3" style={{ borderColor: "var(--kt-border)" }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}