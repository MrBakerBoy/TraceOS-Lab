"use client";

import React from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { GlassCard, GlassCardGroup } from "../controls/GlassCard";
import { GlassSelect } from "../controls/GlassSelect";
import { Button } from "@/components/ui/button";
import { Wrench, Info, Terminal } from "lucide-react";

export function SystemPanel() {
  const { system, updateSystem, resetAll, canUndo, undo, exportConfig } =
    useSettingsStore();

  return (
    <div className="space-y-4">
      <GlassCardGroup title="通用">
        <GlassCard>
          <GlassSelect
            label="界面语言"
            value={system.language}
            options={[
              { value: "zh-CN", label: "简体中文" },
              { value: "zh-TW", label: "繁体中文" },
              { value: "en", label: "English" },
              { value: "ja", label: "日本語" },
            ]}
            onChange={(v) => updateSystem({ language: v })}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSelect
            label="时区"
            value={system.timezone}
            options={[
              { value: "Asia/Shanghai", label: "Asia/Shanghai (UTC+8)" },
              { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9)" },
              { value: "America/New_York", label: "America/New York (UTC-5)" },
              { value: "Europe/London", label: "Europe/London (UTC+0)" },
            ]}
            onChange={(v) => updateSystem({ timezone: v })}
          />
        </GlassCard>
      </GlassCardGroup>

      <GlassCardGroup title="操作">
        <GlassCard hoverLift={false}>
          <div className="space-y-2">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--kt-radius-sm)] text-[13px] text-[var(--kt-text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed hover:text-[var(--kt-cyan)] hover:bg-[var(--kt-cyan-dim)] transition-colors"
            >
              ↩ 撤销上一步修改
            </button>
          </div>
        </GlassCard>
      </GlassCardGroup>

      <GlassCardGroup title="关于">
        <GlassCard hoverLift={false}>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{
                  background:
                    "linear-gradient(135deg, var(--kt-cyan), var(--kt-purple))",
                }}
              >
                <Terminal className="size-6 text-white" />
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-[var(--kt-text)]">
                  TraceOS Lab
                </h3>
                <p className="text-[11px] text-[var(--kt-text-tertiary)]">
                  操作系统实验教学平台 · v3.2.1
                </p>
              </div>
            </div>
            <p className="text-[11px] text-[var(--kt-text-secondary)] leading-relaxed">
              玻璃实验室主题 — Glassmorphism Design System.
              所有外观参数实时生效，配置自动持久化到本地存储。
            </p>
          </div>
        </GlassCard>
      </GlassCardGroup>
    </div>
  );
}
