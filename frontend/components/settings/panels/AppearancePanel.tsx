"use client";

import React from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { GlassCard, GlassCardGroup } from "../controls/GlassCard";
import { GlassSlider } from "../controls/GlassSlider";
import { GlassColorWell } from "../controls/GlassColorWell";
import { Palette, Layers, Circle } from "lucide-react";

export function AppearancePanel() {
  const { appearance, updateAppearance, system, applyPreset, activePreset } =
    useSettingsStore();

  return (
    <div className="space-y-4">
      {/* Preset selector */}
      <GlassCardGroup title="快速预设" subtitle="一键切换整套外观参数">
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "balanced", label: "默认平衡", desc: "出厂推荐" },
              { id: "focus", label: "专注编码", desc: "弱化特效" },
              { id: "showcase", label: "视觉展示", desc: "全开特效" },
            ] as const
          ).map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              className={`p-3 rounded-[var(--kt-radius-sm)] border text-center transition-all duration-300 ${
                activePreset === preset.id
                  ? "border-[var(--kt-cyan)] bg-[var(--kt-cyan-dim)]"
                  : "border-[var(--kt-border)] hover:border-[var(--kt-border-strong)]"
              }`}
            >
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

      {/* Glass Parameters */}
      <GlassCardGroup title="玻璃质感">
        <GlassCard>
          <GlassSlider
            label="毛玻璃模糊强度"
            description="backdrop-filter blur 值，影响玻璃透感"
            value={appearance.glassBlur}
            min={12}
            max={40}
            step={1}
            onChange={(v) => updateAppearance({ glassBlur: v })}
            formatValue={(v) => `${v}px`}
            leftLabel="清"
            rightLabel="柔"
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSlider
            label="卡片透明度"
            description="玻璃卡片背景的不透明度"
            value={appearance.glassOpacity}
            min={0.6}
            max={0.95}
            step={0.01}
            onChange={(v) => updateAppearance({ glassOpacity: v })}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            leftLabel="透"
            rightLabel="实"
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSlider
            label="饱和度"
            description="玻璃背景的色彩饱和度"
            value={appearance.glassSaturate}
            min={100}
            max={250}
            step={5}
            onChange={(v) => updateAppearance({ glassSaturate: v })}
            formatValue={(v) => `${v}%`}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSlider
            label="边框透明度"
            description="全局边框的可见程度"
            value={appearance.borderOpacity}
            min={0.02}
            max={0.15}
            step={0.01}
            onChange={(v) => updateAppearance({ borderOpacity: v })}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            leftLabel="隐"
            rightLabel="显"
          />
        </GlassCard>
      </GlassCardGroup>

      {/* Background */}
      <GlassCardGroup title="背景">
        <GlassCard>
          <GlassSlider
            label="背景亮度"
            description="深色基底从纯黑到微亮的渐变偏移"
            value={appearance.bgIntensity}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => updateAppearance({ bgIntensity: v })}
            formatValue={(v) => `${Math.round(v * 100)}%`}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSlider
            label="噪点纹理"
            description="叠加胶片颗粒质感，0=纯平"
            value={appearance.noiseIntensity}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => updateAppearance({ noiseIntensity: v })}
            formatValue={(v) => `${Math.round(v * 100)}%`}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSlider
            label="阴影深度"
            description="卡片和面板的阴影强度"
            value={appearance.shadowDepth}
            min={0}
            max={3}
            step={1}
            onChange={(v) => updateAppearance({ shadowDepth: v })}
            formatValue={(v) => ["无", "轻", "中", "重"][v]}
          />
        </GlassCard>
      </GlassCardGroup>

      {/* Color */}
      <GlassCardGroup title="主题色">
        <GlassCard>
          <GlassColorWell
            label="渐变光晕色"
            description="界面中的渐变从青色过渡到紫色"
            cyanValue={appearance.accentCyan}
            purpleValue={appearance.accentPurple}
            onCyanChange={(v) => updateAppearance({ accentCyan: v })}
            onPurpleChange={(v) => updateAppearance({ accentPurple: v })}
          />
        </GlassCard>
      </GlassCardGroup>

      {/* Border Radius */}
      <GlassCardGroup title="圆角">
        <GlassCard>
          <GlassSlider
            label="全局圆角"
            description="统一控制所有组件的圆角大小"
            value={appearance.borderRadius}
            min={6}
            max={18}
            step={1}
            onChange={(v) => updateAppearance({ borderRadius: v })}
            formatValue={(v) => `${v}px`}
            leftLabel="方"
            rightLabel="圆"
          />
        </GlassCard>
      </GlassCardGroup>
    </div>
  );
}
