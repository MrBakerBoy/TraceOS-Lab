"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settingsStore";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";

export function GlassPreview() {
  const [collapsed, setCollapsed] = useState(false);
  const { appearance, animation } = useSettingsStore();

  return (
    <div
      className={cn(
        "kt-glass rounded-[var(--kt-radius-md)] border border-[var(--kt-border)] overflow-hidden transition-all duration-300",
        collapsed ? "h-10" : "h-[180px]"
      )}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-4 py-2 text-[11px] font-medium text-[var(--kt-text-secondary)] hover:text-[var(--kt-text)] transition-colors"
      >
        <Eye className="size-3.5 text-[var(--kt-cyan)]" />
        <span>实时预览</span>
        <span className="text-[10px] text-[var(--kt-text-tertiary)]">
          调整参数即时预览效果
        </span>
        <div className="flex-1" />
        {collapsed ? (
          <ChevronDown className="size-3.5 text-[var(--kt-text-tertiary)]" />
        ) : (
          <ChevronUp className="size-3.5 text-[var(--kt-text-tertiary)]" />
        )}
      </button>

      {/* Preview content */}
      {!collapsed && (
        <div className="px-4 pb-4">
          <div
            className="rounded-[var(--kt-radius-sm)] border border-[var(--kt-border)] overflow-hidden transition-all duration-300"
            style={{
              background: "var(--kt-bg-deep)",
              transform: "scale(0.85)",
              transformOrigin: "top left",
              width: "117.5%",
            }}
          >
            {/* Mini navbar */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--kt-border)]"
              style={{ background: "var(--kt-bg-elevated)" }}
            >
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-red-500/50" />
                <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
                <div className="w-2 h-2 rounded-full bg-green-500/50" />
              </div>
              <span className="text-[8px] text-[var(--kt-text-tertiary)] font-mono">
                experiment.c — traceos
              </span>
            </div>

            {/* Mini editor area */}
            <div className="flex" style={{ height: "80px" }}>
              {/* Left sidebar mini */}
              <div
                className="w-[24%] border-r border-[var(--kt-border)] p-2"
                style={{ background: "var(--kt-bg-elevated)" }}
              >
                <div className="h-2 w-3/4 rounded mb-1.5 bg-[var(--kt-cyan-dim)]" />
                <div className="h-1.5 w-1/2 rounded mb-1 bg-[var(--kt-border-strong)]" />
                <div className="h-1.5 w-2/3 rounded bg-[var(--kt-border-strong)]" />
              </div>

              {/* Editor center */}
              <div className="flex-1 p-2" style={{ background: "#ececf0" }}>
                <div className="space-y-1.5">
                  <div className="h-1.5 w-2/3 rounded bg-[var(--kt-purple-dim)]" />
                  <div className="h-1.5 w-1/3 rounded bg-[var(--kt-cyan-dim)]" />
                  <div className="h-1.5 w-1/2 rounded bg-[var(--kt-border-strong)]" />
                  <div className="h-1.5 w-4/5 rounded bg-[var(--kt-border)]" />
                  <div className="h-1.5 w-1/4 rounded bg-[var(--kt-green-dim)]" />
                </div>
              </div>

              {/* Right sidebar mini */}
              <div
                className="w-[18%] border-l border-[var(--kt-border)] p-2"
                style={{ background: "var(--kt-bg-elevated)" }}
              >
                {/* Score ring */}
                <div className="flex justify-center mb-1.5">
                  <svg width="24" height="24" viewBox="0 0 24 24">
                    <circle
                      cx="12" cy="12" r="9"
                      fill="none"
                      stroke="var(--kt-border-strong)"
                      strokeWidth="2"
                    />
                    <circle
                      cx="12" cy="12" r="9"
                      fill="none"
                      stroke="var(--kt-cyan)"
                      strokeWidth="2"
                      strokeDasharray="56.5"
                      strokeDashoffset="20"
                      transform="rotate(-90 12 12)"
                    />
                  </svg>
                </div>
                <div className="h-2 w-full rounded mb-1 bg-[var(--kt-border)]" />
                <div className="h-2 w-full rounded bg-[var(--kt-border)]" />
              </div>
            </div>

            {/* Mini dock */}
            <div
              className="flex justify-center gap-0.5 py-1.5 border-t border-[var(--kt-border)]"
              style={{
                background:
                  "linear-gradient(to top, var(--kt-bg-glass), transparent)",
                backdropFilter: `blur(${appearance.glassBlur}px) saturate(${appearance.glassSaturate}%)`,
              }}
            >
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="w-5 h-5 rounded-md transition-all"
                  style={{
                    background:
                      i === 0
                        ? `linear-gradient(135deg, ${appearance.accentPurple}44, ${appearance.accentCyan}44)`
                        : "var(--kt-border)",
                    border:
                      i === 0
                        ? `1px solid ${appearance.accentCyan}44`
                        : "1px solid var(--kt-border)",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Parameter readout */}
          <div className="flex gap-4 mt-2 text-[10px] text-[var(--kt-text-tertiary)] font-mono">
            <span>
              Blur: {appearance.glassBlur}px
            </span>
            <span>
              Opacity: {appearance.glassOpacity.toFixed(2)}
            </span>
            <span>
              Radius: {appearance.borderRadius}px
            </span>
            <span>
              Anim: {animation.globalEnable ? `${animation.speedMultiplier}x` : "OFF"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
