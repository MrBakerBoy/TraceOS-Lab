"use client";

import React from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { GlassCard, GlassCardGroup } from "../controls/GlassCard";
import { GlassToggle } from "../controls/GlassToggle";
import { GlassSelect } from "../controls/GlassSelect";
import type { MaxFps } from "@/stores/settingsStore";
import { Gauge, AlertTriangle } from "lucide-react";

export function PerformancePanel() {
  const { performance: perf, updatePerformance } = useSettingsStore();

  return (
    <div className="space-y-4">
      <GlassCardGroup title="渲染性能">
        <GlassCard>
          <GlassToggle
            label="硬件加速"
            description="启用 WebGL/GPU 加速渲染（推荐开启）"
            checked={perf.hwAccel}
            onChange={(v) => updatePerformance({ hwAccel: v })}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSelect
            label="最大帧率"
            description="限制动态光晕和动画的渲染帧率"
            value={String(perf.maxFps)}
            options={[
              { value: "60", label: "60 FPS（流畅）" },
              { value: "30", label: "30 FPS（省电）" },
            ]}
            onChange={(v) => updatePerformance({ maxFps: parseInt(v) as MaxFps })}
          />
        </GlassCard>
      </GlassCardGroup>

      <GlassCardGroup title="性能提示">
        <GlassCard hoverLift={false}>
          <div className="flex items-start gap-3 p-2">
            <AlertTriangle className="size-4 text-[var(--kt-amber)] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-medium text-[var(--kt-text)]">
                玻璃效果性能说明
              </p>
              <p className="text-[11px] text-[var(--kt-text-secondary)] mt-1 leading-relaxed">
                多层 backdrop-filter 模糊效果在低配设备上可能造成渲染延迟。
                建议在「外观 → 玻璃质感」中降低模糊强度，
                或在「动画」面板启用性能模式关闭所有动效。
              </p>
            </div>
          </div>
        </GlassCard>
      </GlassCardGroup>
    </div>
  );
}
