"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface GlassToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  advanced?: boolean;
  disabled?: boolean;
}

export function GlassToggle({
  label,
  description,
  checked,
  onChange,
  advanced,
  disabled,
}: GlassToggleProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-2.5 px-1 transition-opacity",
        advanced && "opacity-70"
      )}
    >
      <div className="flex-1 min-w-0 mr-4">
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
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all duration-300 focus:outline-none",
          checked
            ? "shadow-[0_0_8px_var(--kt-cyan-glow)]"
            : "bg-[var(--kt-border)]",
          disabled && "opacity-40 cursor-not-allowed"
        )}
        style={
          checked
            ? {
                background:
                  "linear-gradient(135deg, var(--kt-purple), var(--kt-cyan))",
              }
            : undefined
        }
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md transform ring-0 transition-all duration-300",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}
