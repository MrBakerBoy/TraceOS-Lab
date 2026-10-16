"use client";

import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { EbpfTabId } from "@/types/ebpf";

export interface TabDef {
  id: EbpfTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

export interface TabHeaderProps {
  tabs: TabDef[];
  activeTab: EbpfTabId;
  onTabChange: (id: EbpfTabId) => void;
  rightContent?: React.ReactNode;
  className?: string;
}

export function TabHeader({ tabs, activeTab, onTabChange, rightContent, className }: TabHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 px-2 py-1.5 border-b flex-shrink-0 overflow-x-auto",
        className,
      )}
      style={{
        borderColor: "var(--kt-border)",
        backgroundColor: "var(--kt-bg-surface)",
      }}
      role="tablist"
      aria-label="eBPF 分析面板"
    >
      <div className="flex items-center gap-0.5 flex-1 min-w-0">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`ebpf-tabpanel-${tab.id}`}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap",
                "hover:bg-[var(--kt-bg-elevated)]",
                isActive
                  ? "text-[var(--kt-cyan)]"
                  : "text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text-secondary)]",
              )}
            >
              <Icon className="size-3.5 flex-shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">{tab.label}</span>

              {/* Active indicator */}
              {isActive && (
                <motion.div
                  layoutId="ebpf-tab-indicator"
                  className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                  style={{ backgroundColor: "var(--kt-cyan)" }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Right slot (e.g., realtime toggle) */}
      {rightContent && (
        <div className="flex items-center flex-shrink-0 ml-2">
          {rightContent}
        </div>
      )}
    </div>
  );
}