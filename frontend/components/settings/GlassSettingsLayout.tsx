"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { GlassSidebar } from "./GlassSidebar";
import { GlassPreview } from "./GlassPreview";
import { GlassSearchBar } from "./controls/GlassSelect";
import { AppearancePanel } from "./panels/AppearancePanel";
import { AnimationPanel } from "./panels/AnimationPanel";
import { TypographyPanel } from "./panels/TypographyPanel";
import { EditorPanel } from "./panels/EditorPanel";
import { PerformancePanel } from "./panels/PerformancePanel";
import { DockPanel } from "./panels/DockPanel";
import { PresetPanel } from "./panels/PresetPanel";
import { SystemPanel } from "./panels/SystemPanel";
import type { SettingsCategory } from "./GlassSidebar";
import { Dialog } from "@/components/ui/dialog";
import { Search, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Search index ──

interface SearchEntry {
  label: string;
  category: SettingsCategory;
  categoryLabel: string;
}

const SEARCH_INDEX: SearchEntry[] = [
  { label: "毛玻璃模糊强度", category: "appearance", categoryLabel: "外观" },
  { label: "卡片透明度", category: "appearance", categoryLabel: "外观" },
  { label: "饱和度", category: "appearance", categoryLabel: "外观" },
  { label: "边框透明度", category: "appearance", categoryLabel: "外观" },
  { label: "背景亮度", category: "appearance", categoryLabel: "外观" },
  { label: "噪点纹理", category: "appearance", categoryLabel: "外观" },
  { label: "阴影深度", category: "appearance", categoryLabel: "外观" },
  { label: "渐变光晕色", category: "appearance", categoryLabel: "外观" },
  { label: "全局圆角", category: "appearance", categoryLabel: "外观" },
  { label: "预设配色", category: "appearance", categoryLabel: "外观" },
  { label: "全局动画开关", category: "animation", categoryLabel: "动画" },
  { label: "动画速度倍率", category: "animation", categoryLabel: "动画" },
  { label: "页面入场动画", category: "animation", categoryLabel: "动画" },
  { label: "Dock 悬浮视差", category: "animation", categoryLabel: "动画" },
  { label: "棱镜反射光带", category: "animation", categoryLabel: "动画" },
  { label: "环境光晕旋转", category: "animation", categoryLabel: "动画" },
  { label: "卡片 hover 视差", category: "animation", categoryLabel: "动画" },
  { label: "扫描线动画", category: "animation", categoryLabel: "动画" },
  { label: "运行脉冲光晕", category: "animation", categoryLabel: "动画" },
  { label: "UI 字号缩放", category: "typography", categoryLabel: "字体" },
  { label: "字间距", category: "typography", categoryLabel: "字体" },
  { label: "代码字号", category: "typography", categoryLabel: "字体" },
  { label: "行高", category: "typography", categoryLabel: "字体" },
  { label: "代码连字", category: "typography", categoryLabel: "字体" },
  { label: "光标样式", category: "editor", categoryLabel: "编辑器" },
  { label: "Tab 大小", category: "editor", categoryLabel: "编辑器" },
  { label: "自动换行", category: "editor", categoryLabel: "编辑器" },
  { label: "平滑滚动", category: "editor", categoryLabel: "编辑器" },
  { label: "行号", category: "editor", categoryLabel: "编辑器" },
  { label: "缩略图", category: "editor", categoryLabel: "编辑器" },
  { label: "代码高亮对比度", category: "editor", categoryLabel: "编辑器" },
  { label: "自动保存", category: "editor", categoryLabel: "编辑器" },
  { label: "硬件加速", category: "performance", categoryLabel: "性能" },
  { label: "最大帧率", category: "performance", categoryLabel: "性能" },
  { label: "Dock 位置", category: "dock", categoryLabel: "Dock" },
  { label: "图标缩放", category: "dock", categoryLabel: "Dock" },
  { label: "激活光晕强度", category: "dock", categoryLabel: "Dock" },
  { label: "自动隐藏 Dock", category: "dock", categoryLabel: "Dock" },
  { label: "界面语言", category: "system", categoryLabel: "系统" },
  { label: "时区", category: "system", categoryLabel: "系统" },
  { label: "撤销", category: "system", categoryLabel: "系统" },
  { label: "预设模板", category: "presets", categoryLabel: "预设" },
  { label: "导出配置", category: "presets", categoryLabel: "预设" },
  { label: "导入配置", category: "presets", categoryLabel: "预设" },
  { label: "恢复出厂设置", category: "presets", categoryLabel: "预设" },
];

export function GlassSettingsLayout() {
  const { system, toggleAdvancedMode } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<SettingsCategory>("appearance");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Keyboard shortcut: Ctrl+K to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return SEARCH_INDEX.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.categoryLabel.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const categoryLabel = (cat: SettingsCategory) => {
    const map: Record<SettingsCategory, string> = {
      appearance: "外观",
      animation: "动画",
      typography: "字体",
      editor: "编辑器",
      performance: "性能",
      dock: "Dock",
      shortcuts: "快捷键",
      presets: "预设",
      system: "系统",
    };
    return map[cat];
  };

  const renderPanel = () => {
    switch (activeTab) {
      case "appearance":
        return <AppearancePanel />;
      case "animation":
        return <AnimationPanel />;
      case "typography":
        return <TypographyPanel />;
      case "editor":
        return <EditorPanel />;
      case "performance":
        return <PerformancePanel />;
      case "dock":
        return <DockPanel />;
      case "presets":
        return <PresetPanel />;
      case "system":
        return <SystemPanel />;
      case "shortcuts":
        return (
          <div className="flex items-center justify-center h-64 text-[var(--kt-text-tertiary)] text-sm">
            快捷键自定义面板 — 开发中
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="settings-light relative flex h-screen overflow-hidden bg-[#f5f5f7]"
      style={{
        "--kt-bg-deep": "#f2f2f5",
        "--kt-bg-surface": "#fafafa",
        "--kt-bg-elevated": "#f5f5f7",
        "--kt-bg-glass": "rgba(255, 255, 255, 0.78)",
        "--kt-bg-glass-light": "rgba(255, 255, 255, 0.55)",
        "--kt-bg-glass-heavy": "rgba(250, 250, 252, 0.92)",
        "--kt-cyan": "#0071e3",
        "--kt-cyan-dim": "rgba(0, 113, 227, 0.1)",
        "--kt-cyan-glow": "rgba(0, 113, 227, 0.2)",
        "--kt-purple": "#8b5cf6",
        "--kt-purple-dim": "rgba(139, 92, 246, 0.1)",
        "--kt-purple-glow": "rgba(139, 92, 246, 0.2)",
        "--kt-green": "#30d158",
        "--kt-green-dim": "rgba(48, 209, 88, 0.1)",
        "--kt-amber": "#ff9f0a",
        "--kt-amber-dim": "rgba(255, 159, 10, 0.1)",
        "--kt-red": "#ff453a",
        "--kt-red-dim": "rgba(255, 69, 58, 0.08)",
        "--kt-border": "rgba(0, 0, 0, 0.08)",
        "--kt-border-strong": "rgba(0, 0, 0, 0.12)",
        "--kt-border-glow": "rgba(0, 113, 227, 0.15)",
        "--kt-text": "rgba(0, 0, 0, 0.88)",
        "--kt-text-secondary": "rgba(0, 0, 0, 0.56)",
        "--kt-text-tertiary": "rgba(0, 0, 0, 0.32)",
        "--kt-shadow-depth": "0 1px 4px rgba(0, 0, 0, 0.08)",
        "--kt-noise-opacity": "0",
      } as React.CSSProperties}
    >
      {/* Ambient orbs — soft blue-violet for light bg */}
      <div
        className="fixed top-[-20%] right-[-5%] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)",
          filter: "blur(100px)",
        }}
      />
      <div
        className="fixed bottom-[-15%] left-[-5%] w-[400px] h-[400px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(0,113,227,0.08) 0%, transparent 70%)",
          filter: "blur(80px)",
        }}
      />

      {/* Sidebar */}
      <GlassSidebar
        active={activeTab}
        onSelect={setActiveTab}
        advancedMode={system.advancedMode}
        onToggleAdvanced={toggleAdvancedMode}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-3 border-b border-[var(--kt-border)] flex-shrink-0">
          <h2 className="text-[15px] font-semibold text-[var(--kt-text)]">
            {categoryLabel(activeTab)}
          </h2>
          <div className="flex-1 max-w-xs">
            <GlassSearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              onFocus={() => setSearchOpen(true)}
            />
          </div>
          {searchQuery && filteredResults.length > 0 && (
            <span className="text-[10px] text-[var(--kt-text-tertiary)]">
              {filteredResults.length} 个结果
            </span>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto kt-scroll p-6 max-w-2xl">
          {/* Preview window */}
          <div className="mb-6">
            <GlassPreview />
          </div>

          {/* Search results overlay */}
          {searchQuery && filteredResults.length > 0 && (
            <div className="mb-6 p-1 rounded-[var(--kt-radius-md)] border border-[var(--kt-border)] kt-glass">
              {filteredResults.map((result, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setActiveTab(result.category);
                    setSearchQuery("");
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-[var(--kt-radius-sm)] text-[13px] text-[var(--kt-text-secondary)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-border)] transition-colors"
                >
                  <span className="text-[10px] text-[var(--kt-text-tertiary)] bg-[var(--kt-bg-elevated)] px-1.5 py-0.5 rounded font-mono">
                    {result.categoryLabel}
                  </span>
                  <span className="flex-1 text-left">{result.label}</span>
                  <ChevronRight className="size-3 text-[var(--kt-text-tertiary)]" />
                </button>
              ))}
            </div>
          )}

          {/* Panel content */}
          <div className="animate-[fadeInUp_400ms_ease-out_both]" key={activeTab}>
            {renderPanel()}
          </div>

          {/* Bottom spacer */}
          <div className="h-12" />
        </div>
      </main>

      {/* Search dialog */}
      {searchOpen && !searchQuery && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setSearchOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg rounded-[var(--kt-radius-lg)] border border-[var(--kt-border)] kt-glass-heavy shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--kt-border)]">
              <Search className="size-4 text-[var(--kt-cyan)]" />
              <input
                autoFocus
                placeholder="搜索设置项..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--kt-text)] placeholder:text-[var(--kt-text-tertiary)]"
              />
              <kbd className="px-1.5 py-0.5 rounded-md border border-[var(--kt-border)] text-[10px] font-mono text-[var(--kt-text-tertiary)]">
                ESC
              </kbd>
            </div>
            <div className="max-h-[300px] overflow-y-auto kt-scroll py-2">
              {SEARCH_INDEX.slice(0, 15).map((entry, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setActiveTab(entry.category);
                    setSearchOpen(false);
                    setSearchQuery("");
                  }}
                  className="w-full flex items-center gap-3 px-5 py-2.5 text-[13px] text-[var(--kt-text-secondary)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-border)] transition-colors"
                >
                  <span className="text-[10px] text-[var(--kt-text-tertiary)] bg-[var(--kt-bg-elevated)] px-1.5 py-0.5 rounded font-mono">
                    {entry.categoryLabel}
                  </span>
                  <span className="flex-1 text-left">{entry.label}</span>
                  <ChevronRight className="size-3 text-[var(--kt-text-tertiary)]" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
