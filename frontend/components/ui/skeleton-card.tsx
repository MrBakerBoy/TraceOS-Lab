"use client";

import { cn } from "@/lib/utils";

// ── KPI Card Skeleton ──
// Mimics a KPI stat card: icon placeholder + title + large number + subtitle

export function SkeletonKpiCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "kt-card p-4 space-y-3 animate-pulse",
        className,
      )}
      aria-hidden="true"
    >
      {/* Icon + label row */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-[var(--kt-border)] shimmer" />
        <div className="h-3 w-16 rounded bg-[var(--kt-border)] shimmer" />
      </div>
      {/* Big number */}
      <div className="h-7 w-20 rounded bg-[var(--kt-border)] shimmer" />
      {/* Subtitle / trend */}
      <div className="h-3 w-28 rounded bg-[var(--kt-border)] shimmer" />
    </div>
  );
}

// ── Chart Skeleton ──
// Full chart container with inner shimmer bars

export function SkeletonChart({
  className,
  rows = 6,
}: {
  className?: string;
  rows?: number;
}) {
  return (
    <div
      className={cn(
        "kt-card p-4 space-y-3 animate-pulse",
        className,
      )}
      aria-hidden="true"
    >
      {/* Chart title bar */}
      <div className="flex items-center justify-between">
        <div className="h-4 w-24 rounded bg-[var(--kt-border)] shimmer" />
        <div className="h-3 w-12 rounded bg-[var(--kt-border)] shimmer" />
      </div>
      {/* Fake chart area */}
      <div className="flex items-end gap-2 h-40 pt-2">
        {Array.from({ length: rows * 2 }).map((_, i) => {
          const h = 20 + Math.sin(i * 0.8) * 30 + Math.random() * 40;
          return (
            <div
              key={i}
              className="flex-1 rounded-t bg-[var(--kt-border)] shimmer"
              style={{ height: `${Math.max(10, h)}%` }}
            />
          );
        })}
      </div>
      {/* X-axis label area */}
      <div className="flex justify-between pt-1">
        <div className="h-2 w-8 rounded bg-[var(--kt-border)] shimmer" />
        <div className="h-2 w-8 rounded bg-[var(--kt-border)] shimmer" />
        <div className="h-2 w-8 rounded bg-[var(--kt-border)] shimmer" />
      </div>
    </div>
  );
}

// ── Table Skeleton ──
// Mimics a data table with header + rows

export function SkeletonTable({
  className,
  rows = 5,
  cols = 4,
}: {
  className?: string;
  rows?: number;
  cols?: number;
}) {
  return (
    <div
      className={cn(
        "kt-card overflow-hidden animate-pulse",
        className,
      )}
      aria-hidden="true"
    >
      {/* Header row */}
      <div
        className="grid gap-4 px-4 py-3 border-b border-[var(--kt-border)]"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <div
            key={`h-${i}`}
            className="h-3 rounded bg-[var(--kt-border)] shimmer"
            style={{ width: `${40 + Math.random() * 40}%` }}
          />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid gap-4 px-4 py-3 border-b border-[var(--kt-border)]/50"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={`${r}-${c}`}
              className="h-3 rounded bg-[var(--kt-border)] shimmer"
              style={{ width: `${30 + Math.random() * 60}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Alias for backward compatibility
export const SkeletonCard = SkeletonChart;

// ── Text Block Skeleton ──
// Paragraph-like placeholder

export function SkeletonText({

  className,
  lines = 3,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <div
      className={cn("space-y-2 animate-pulse", className)}
      aria-hidden="true"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded bg-[var(--kt-border)] shimmer"
          style={{
            width: i === lines - 1 ? "60%" : "100%",
          }}
        />
      ))}
    </div>
  );
}
