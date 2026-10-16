"use client";

import React from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { GlassCard, GlassCardGroup } from "../controls/GlassCard";
import { GlassSlider } from "../controls/GlassSlider";
import { GlassToggle } from "../controls/GlassToggle";
import { MonitorPlay } from "lucide-react";

export function AnimationPanel() {
  const { animation, updateAnimation } = useSettingsStore();

  return (
    <div className="space-y-4">
      {/* Global controls */}
      <GlassCardGroup title="全局控制">
        <GlassCard>
          <GlassToggle
            label="全局动画开关"
            description="关闭后禁用所有动效（性能模式）"
            checked={animation.globalEnable}
            onChange={(v) => updateAnimation({ globalEnable: v })}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSlider
            label="动画速度倍率"
            description="0.5x 慢动作 → 2.0x 快进"
            value={animation.speedMultiplier}
            min={0.5}
            max={2.0}
            step={0.1}
            onChange={(v) => updateAnimation({ speedMultiplier: v })}
            formatValue={(v) => `${v.toFixed(1)}x`}
            leftLabel="慢"
            rightLabel="快"
            disabled={!animation.globalEnable}
          />
        </GlassCard>
      </GlassCardGroup>

      {/* Individual toggles */}
      <GlassCardGroup title="分项开关" subtitle="精细控制每一项动效">
        <GlassCard>
          <GlassToggle
            label="页面入场动画"
            description="设置页面打开时的淡入编排效果"
            checked={animation.pageEntrance}
            onChange={(v) => updateAnimation({ pageEntrance: v })}
            disabled={!animation.globalEnable}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassToggle
            label="Dock 悬浮视差"
            description="底部工具栏随鼠标轻微偏移阴影"
            checked={animation.dockParallax}
            onChange={(v) => updateAnimation({ dockParallax: v })}
            disabled={!animation.globalEnable}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassToggle
            label="棱镜反射光带"
            description="卡片顶部的彩虹棱镜反射效果"
            checked={animation.prismReflection}
            onChange={(v) => updateAnimation({ prismReflection: v })}
            disabled={!animation.globalEnable}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassToggle
            label="环境光晕旋转"
            description="右上角缓慢旋转的青紫渐变光晕"
            checked={animation.ambientOrb}
            onChange={(v) => updateAnimation({ ambientOrb: v })}
            disabled={!animation.globalEnable}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassToggle
            label="卡片 hover 视差"
            description="鼠标悬停时卡片轻微上浮"
            checked={animation.cardHover}
            onChange={(v) => updateAnimation({ cardHover: v })}
            disabled={!animation.globalEnable}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassToggle
            label="扫描线动画"
            description="Dock 上的青紫色扫描线效果"
            checked={animation.scanline}
            onChange={(v) => updateAnimation({ scanline: v })}
            disabled={!animation.globalEnable}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassToggle
            label="运行脉冲光晕"
            description="代码运行时编辑器的脉冲边框效果"
            checked={animation.runGlow}
            onChange={(v) => updateAnimation({ runGlow: v })}
            disabled={!animation.globalEnable}
          />
        </GlassCard>
      </GlassCardGroup>
    </div>
  );
}
