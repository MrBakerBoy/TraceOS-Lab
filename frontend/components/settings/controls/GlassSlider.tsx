"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface GlassSliderProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Show the current value next to the slider */
  showValue?: boolean;
  /** Format the displayed value */
  formatValue?: (value: number) => string;
  /** Whether this is an advanced/dev option */
  advanced?: boolean;
  /** Left icon label */
  leftLabel?: string;
  /** Right icon label */
  rightLabel?: string;
  disabled?: boolean;
}

export function GlassSlider({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  onChange,
  showValue = true,
  formatValue,
  advanced,
  leftLabel,
  rightLabel,
  disabled,
}: GlassSliderProps) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 py-1",
        advanced && "opacity-70"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0 mr-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium text-[var(--kt-text)]">
              {label}
            </span>
            {advanced && (
              <span className="text-[9px] font-mono text-[var(--kt-purple)] bg-[var(--kt-purple-dim)] px-1 py-0.5 rounded">
                DEV
              </span>
            )}
          </div>
          {description && (
            <p className="text-[11px] text-[var(--kt-text-tertiary)] mt-0.5 leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {showValue && (
          <span className="text-[11px] font-mono text-[var(--kt-cyan)] tabular-nums flex-shrink-0">
            {formatValue ? formatValue(value) : value}
          </span>
        )}
      </div>

      <div className="relative flex items-center gap-2">
        {leftLabel && (
          <span className="text-[10px] text-[var(--kt-text-tertiary)] w-8 text-right">
            {leftLabel}
          </span>
        )}
        <div className="relative flex-1 h-7 flex items-center">
          {/* Track background */}
          <div className="absolute inset-x-0 h-1.5 rounded-full bg-[var(--kt-border)] overflow-hidden">
            {/* Filled track with prism gradient */}
            <div
              className="h-full rounded-full transition-all duration-150"
              style={{
                width: `${pct}%`,
                background: "linear-gradient(to right, var(--kt-purple), var(--kt-cyan))",
                opacity: disabled ? 0.3 : 1,
              }}
            />
          </div>
          {/* Native range input (invisible, for interaction) */}
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            disabled={disabled}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            style={{ margin: 0 }}
          />
        </div>
        {rightLabel && (
          <span className="text-[10px] text-[var(--kt-text-tertiary)] w-8 text-left">
            {rightLabel}
          </span>
        )}
      </div>
    </div>
  );
}
