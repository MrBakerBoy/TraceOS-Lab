"use client";

import React from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { GlassCard, GlassCardGroup } from "../controls/GlassCard";
import { Star, Download, Upload, RotateCcw, Trash2 } from "lucide-react";

export function PresetPanel() {
  const { applyPreset, activePreset, exportConfig, importConfig, resetAll } =
    useSettingsStore();

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const ok = importConfig(reader.result as string);
        if (!ok) alert("导入失败：JSON 格式无效");
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleExport = () => {
    const json = exportConfig();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `traceos-glass-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <GlassCardGroup title="预设模板" subtitle="一键切换整套配置">
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              {
                id: "balanced" as const,
                label: "默认平衡",
                desc: "出厂推荐配置",
                emoji: "⚖️",
              },
              {
                id: "focus" as const,
                label: "专注编码",
                desc: "弱化所有背景动画",
                emoji: "🧘",
              },
              {
                id: "showcase" as const,
                label: "视觉展示",
                desc: "全开特效，录屏演示",
                emoji: "✨",
              },
            ]
          ).map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              className={`p-4 rounded-[var(--kt-radius-sm)] border text-center transition-all duration-300 ${
                activePreset === preset.id
                  ? "border-[var(--kt-cyan)] bg-[var(--kt-cyan-dim)]"
                  : "border-[var(--kt-border)] hover:border-[var(--kt-border-strong)]"
              }`}
            >
              <span className="text-2xl block mb-1">{preset.emoji}</span>
              <p className="text-[13px] font-semibold text-[var(--kt-text)]">
                {preset.label}
              </p>
              <p className="text-[10px] text-[var(--kt-text-tertiary)] mt-0.5">
                {preset.desc}
              </p>
            </button>
          ))}
        </div>
      </GlassCardGroup>

      <GlassCardGroup title="配置管理">
        <GlassCard hoverLift={false}>
          <div className="space-y-2">
            <button
              onClick={handleExport}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--kt-radius-sm)] text-[13px] text-[var(--kt-text-secondary)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-border)] transition-colors"
            >
              <Download className="size-4 text-[var(--kt-cyan)]" />
              导出配置 JSON
            </button>
            <button
              onClick={handleImport}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--kt-radius-sm)] text-[13px] text-[var(--kt-text-secondary)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-border)] transition-colors"
            >
              <Upload className="size-4 text-[var(--kt-purple)]" />
              导入配置 JSON
            </button>
            <div className="h-px bg-[var(--kt-border)] my-1" />
            <button
              onClick={resetAll}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--kt-radius-sm)] text-[13px] text-[var(--kt-text-secondary)] hover:text-[var(--kt-red)] hover:bg-[var(--kt-red-dim)] transition-colors"
            >
              <RotateCcw className="size-4" />
              恢复出厂设置
            </button>
          </div>
        </GlassCard>
      </GlassCardGroup>
    </div>
  );
}
