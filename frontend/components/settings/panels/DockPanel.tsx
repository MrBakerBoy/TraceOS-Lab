"use client";

import React from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { GlassCard, GlassCardGroup } from "../controls/GlassCard";
import { GlassSlider } from "../controls/GlassSlider";
import { GlassToggle } from "../controls/GlassToggle";
import { GlassSelect } from "../controls/GlassSelect";
import type { DockPosition } from "@/stores/settingsStore";
import { LayoutPanelTop } from "lucide-react";

export function DockPanel() {
  const { dock, updateDock } = useSettingsStore();

  return (
    <div className="space-y-4">
      <GlassCardGroup title="Dock 工具栏">
        <GlassCard>
          <GlassSelect
            label="Dock 位置"
            value={dock.position}
            options={[
              { value: "bottom", label: "底部居中" },
              { value: "left", label: "左侧垂直" },
            ]}
            onChange={(v) => updateDock({ position: v as DockPosition })}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSlider
            label="图标缩放"
            value={dock.iconScale}
            min={0.8}
            max={1.3}
            step={0.05}
            onChange={(v) => updateDock({ iconScale: v })}
            formatValue={(v) => `${Math.round(v * 100)}%`}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSlider
            label="激活光晕强度"
            value={dock.glowIntensity}
            min={0}
            max={1}
            step={0.1}
            onChange={(v) => updateDock({ glowIntensity: v })}
            formatValue={(v) => `${Math.round(v * 100)}%`}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassToggle
            label="自动隐藏 Dock"
            description="鼠标移开后自动收起工具栏"
            checked={dock.autoHide}
            onChange={(v) => updateDock({ autoHide: v })}
          />
        </GlassCard>
      </GlassCardGroup>
    </div>
  );
}
