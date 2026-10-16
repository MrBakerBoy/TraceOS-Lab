"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Palette, MonitorPlay, Type, Code, Cpu, LayoutPanelTop,
  Keyboard, Star, Wrench, ChevronRight, Settings2, ArrowLeft,
  Gauge, Zap,
} from "lucide-react";

export type SettingsCategory =
  | "appearance"
  | "animation"
  | "typography"
  | "editor"
  | "performance"
  | "dock"
  | "shortcuts"
  | "presets"
  | "system";

interface CategoryDef {
  id: SettingsCategory;
  label: string;
  icon: React.ReactNode;
  /** P0=刚需, P1=进阶, P2=彩蛋 */
  tier: "P0" | "P1" | "P2";
}

const CATEGORIES: CategoryDef[] = [
  { id: "appearance", label: "外观", icon: <Palette className="size-4" />, tier: "P0" },
  { id: "animation", label: "动画", icon: <MonitorPlay className="size-4" />, tier: "P0" },
  { id: "typography", label: "字体", icon: <Type className="size-4" />, tier: "P0" },
  { id: "editor", label: "编辑器", icon: <Code className="size-4" />, tier: "P1" },
  { id: "performance", label: "性能", icon: <Gauge className="size-4" />, tier: "P1" },
  { id: "dock", label: "Dock", icon: <LayoutPanelTop className="size-4" />, tier: "P1" },
  { id: "shortcuts", label: "快捷键", icon: <Keyboard className="size-4" />, tier: "P2" },
  { id: "presets", label: "预设", icon: <Star className="size-4" />, tier: "P2" },
  { id: "system", label: "系统", icon: <Wrench className="size-4" />, tier: "P2" },
];

interface GlassSidebarProps {
  active: SettingsCategory;
  onSelect: (cat: SettingsCategory) => void;
  advancedMode: boolean;
  onToggleAdvanced: () => void;
}

export function GlassSidebar({
  active,
  onSelect,
  advancedMode,
  onToggleAdvanced,
}: GlassSidebarProps) {
  const router = useRouter();

  const isVisible = (cat: CategoryDef) => {
    if (cat.tier === "P0") return true;
    if (cat.tier === "P1") return advancedMode;
    if (cat.tier === "P2") return advancedMode;
    return false;
  };

  return (
    <aside className="w-60 flex-shrink-0 kt-glass-heavy border-r border-[var(--kt-border)] flex flex-col select-none">
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, var(--kt-cyan-dim), var(--kt-purple-dim))",
            }}
          >
            <Settings2 className="size-5 text-[var(--kt-cyan)]" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-[var(--kt-text)] tracking-tight">
              设置
            </h1>
            <p className="text-[10px] text-[var(--kt-text-tertiary)]">
              玻璃实验室
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 overflow-y-auto kt-scroll space-y-0.5">
        {CATEGORIES.filter(isVisible).map((cat) => (
          <button
            key={cat.id}
            onClick={() => onSelect(cat.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--kt-radius-sm)] text-[13px] transition-all duration-300 group relative overflow-hidden",
              active === cat.id
                ? "text-[var(--kt-text)] font-medium"
                : "text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text-secondary)] hover:bg-[var(--kt-border)]"
            )}
          >
            {/* Active indicator bar */}
            {active === cat.id && (
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                style={{
                  background:
                    "linear-gradient(to bottom, var(--kt-cyan), var(--kt-purple))",
                }}
              />
            )}
            {/* Active background gradient */}
            {active === cat.id && (
              <div
                className="absolute inset-0 rounded-[var(--kt-radius-sm)] opacity-15"
                style={{
                  background:
                    "linear-gradient(90deg, var(--kt-cyan-dim), transparent 60%)",
                }}
              />
            )}
            <span
              className={cn(
                "transition-all duration-300",
                active === cat.id && "text-[var(--kt-cyan)] scale-110"
              )}
            >
              {cat.icon}
            </span>
            <span className="flex-1 text-left">{cat.label}</span>
            {active === cat.id && (
              <ChevronRight className="size-3.5 text-[var(--kt-cyan)]" />
            )}
          </button>
        ))}
      </nav>

      {/* Bottom: Advanced mode toggle + back button */}
      <div className="px-4 py-3 border-t border-[var(--kt-border)] space-y-2">
        <button
          onClick={onToggleAdvanced}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-[var(--kt-radius-sm)] text-[12px] transition-all duration-300",
            advancedMode
              ? "text-[var(--kt-cyan)] bg-[var(--kt-cyan-dim)]"
              : "text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text-secondary)] hover:bg-[var(--kt-border)]"
          )}
          title={advancedMode ? "关闭高级模式" : "开启高级模式，解锁全部开发者选项"}
        >
          <Zap className={cn("size-3.5", advancedMode && "text-[var(--kt-cyan)]")} />
          <span>高级模式</span>
          <span
            className={cn(
              "ml-auto w-7 h-4 rounded-full transition-all duration-300 relative",
              advancedMode
                ? "shadow-[0_0_6px_var(--kt-cyan-glow)]"
                : "bg-[var(--kt-border)]"
            )}
            style={
              advancedMode
                ? {
                    background:
                      "linear-gradient(135deg, var(--kt-purple), var(--kt-cyan))",
                  }
                : undefined
            }
          >
            <span
              className={cn(
                "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all duration-300",
                advancedMode ? "left-3.5" : "left-0.5"
              )}
            />
          </span>
        </button>

        <button
          onClick={() => router.push("/experiments")}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-[var(--kt-radius-sm)] text-[12px] text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-border)] transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>返回</span>
        </button>
      </div>
    </aside>
  );
}
