"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Search } from "lucide-react";

// ── GlassSelect ──

interface GlassSelectProps<T extends string> {
  label: string;
  description?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  advanced?: boolean;
}

export function GlassSelect<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  advanced,
}: GlassSelectProps<T>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-2.5 px-1",
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
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="appearance-none bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)] rounded-lg py-1.5 pl-3 pr-8 text-xs text-[var(--kt-text)] cursor-pointer focus:outline-none focus:border-[var(--kt-cyan)] transition-colors hover:border-[var(--kt-border-strong)]"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-[var(--kt-text-tertiary)] pointer-events-none" />
      </div>
    </div>
  );
}

// ── GlassSearchBar ──

interface GlassSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  shortcut?: string;
  onFocus?: () => void;
}

export function GlassSearchBar({
  value,
  onChange,
  placeholder = "搜索设置...",
  shortcut = "Ctrl+K",
  onFocus,
}: GlassSearchBarProps) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--kt-text-tertiary)]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        className="w-full bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)] rounded-lg py-2 pl-9 pr-16 text-xs text-[var(--kt-text)] placeholder:text-[var(--kt-text-tertiary)] focus:outline-none focus:border-[var(--kt-cyan)] transition-colors"
      />
      {shortcut && (
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md border border-[var(--kt-border)] text-[10px] font-mono text-[var(--kt-text-tertiary)]">
          {shortcut}
        </kbd>
      )}
    </div>
  );
}
