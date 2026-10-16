"use client";

import React from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { GlassCard, GlassCardGroup } from "../controls/GlassCard";
import { GlassSlider } from "../controls/GlassSlider";
import { GlassToggle } from "../controls/GlassToggle";
import { Type } from "lucide-react";

export function TypographyPanel() {
  const { typography, updateTypography } = useSettingsStore();

  return (
    <div className="space-y-4">
      {/* UI Font */}
      <GlassCardGroup title="界面字体">
        <GlassCard>
          <GlassSlider
            label="UI 字号缩放"
            description="整体界面文字大小（不影响编辑器）"
            value={typography.uiScale}
            min={0.85}
            max={1.3}
            step={0.05}
            onChange={(v) => updateTypography({ uiScale: v })}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            leftLabel="小"
            rightLabel="大"
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSlider
            label="字间距"
            description="全局文字的 letter-spacing 微调"
            value={typography.letterSpacing}
            min={-0.5}
            max={2}
            step={0.25}
            onChange={(v) => updateTypography({ letterSpacing: v })}
            formatValue={(v) => `${v > 0 ? "+" : ""}${v}px`}
          />
        </GlassCard>
      </GlassCardGroup>

      {/* Editor Font */}
      <GlassCardGroup title="编辑器字体">
        <GlassCard>
          <GlassSlider
            label="代码字号"
            description="Monaco 编辑器的字体大小"
            value={typography.editorFontSize}
            min={10}
            max={22}
            step={1}
            onChange={(v) => updateTypography({ editorFontSize: v })}
            formatValue={(v) => `${v}px`}
            leftLabel="10"
            rightLabel="22"
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSlider
            label="行高"
            description="编辑器代码行间距"
            value={typography.editorLineHeight}
            min={1.2}
            max={2.0}
            step={0.1}
            onChange={(v) => updateTypography({ editorLineHeight: v })}
            formatValue={(v) => v.toFixed(1)}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassToggle
            label="代码连字 (Ligatures)"
            description="将 => != >= 等符号渲染为连字字符"
            checked={typography.editorLigatures}
            onChange={(v) => updateTypography({ editorLigatures: v })}
          />
        </GlassCard>
      </GlassCardGroup>

      {/* Preview sample */}
      <GlassCardGroup title="预览">
        <GlassCard>
          <div className="space-y-3">
            <div>
              <p className="text-[10px] text-[var(--kt-text-tertiary)] uppercase tracking-wider mb-1">
                UI 文字
              </p>
              <p
                className="text-[var(--kt-text)]"
                style={{
                  fontSize: `${Math.round(typography.uiScale * 14)}px`,
                  letterSpacing: `${typography.letterSpacing}px`,
                }}
              >
                TraceOS 玻璃实验室 — 操作系统实验平台
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--kt-text-tertiary)] uppercase tracking-wider mb-1">
                代码文字
              </p>
              <pre
                className="p-3 rounded-[var(--kt-radius-sm)] bg-[var(--kt-bg-elevated)] text-[var(--kt-cyan)] font-mono overflow-x-auto"
                style={{
                  fontSize: `${typography.editorFontSize}px`,
                  lineHeight: typography.editorLineHeight,
                  fontVariantLigatures: typography.editorLigatures
                    ? "common-ligatures"
                    : "none",
                }}
              >
{`fn main() {
    let x = 1 + 2;
    if x >= 0 && x <= 10 {
        println!("=> {}", x);
    }
}`}
              </pre>
            </div>
          </div>
        </GlassCard>
      </GlassCardGroup>
    </div>
  );
}
