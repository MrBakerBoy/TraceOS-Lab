"use client";

import React from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { GlassCard, GlassCardGroup } from "../controls/GlassCard";
import { GlassSlider } from "../controls/GlassSlider";
import { GlassToggle } from "../controls/GlassToggle";
import { GlassSelect } from "../controls/GlassSelect";
import type { CursorStyle } from "@/stores/settingsStore";
import { Code } from "lucide-react";

export function EditorPanel() {
  const { editor, updateEditor, system } = useSettingsStore();

  return (
    <div className="space-y-4">
      <GlassCardGroup title="编辑器行为">
        <GlassCard>
          <GlassSelect
            label="光标样式"
            value={editor.cursorStyle}
            options={[
              { value: "line", label: "垂直线 (|)" },
              { value: "block", label: "方块 (█)" },
              { value: "underline", label: "下划线 (_)" },
            ]}
            onChange={(v) => updateEditor({ cursorStyle: v as CursorStyle })}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassSelect
            label="Tab 大小"
            value={String(editor.tabSize)}
            options={[
              { value: "2", label: "2 空格" },
              { value: "4", label: "4 空格" },
              { value: "8", label: "8 空格" },
            ]}
            onChange={(v) => updateEditor({ tabSize: parseInt(v) as 2 | 4 | 8 })}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassToggle
            label="自动换行"
            description="代码超出编辑器宽度时自动换行"
            checked={editor.wordWrap}
            onChange={(v) => updateEditor({ wordWrap: v })}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassToggle
            label="平滑滚动"
            description="编辑器使用平滑滚动动画"
            checked={editor.smoothScroll}
            onChange={(v) => updateEditor({ smoothScroll: v })}
          />
        </GlassCard>
      </GlassCardGroup>

      <GlassCardGroup title="显示">
        <GlassCard>
          <GlassToggle
            label="行号"
            checked={editor.lineNumbers}
            onChange={(v) => updateEditor({ lineNumbers: v })}
          />
          <div className="h-px bg-[var(--kt-border)] my-1" />
          <GlassToggle
            label="缩略图 (Minimap)"
            checked={editor.minimap}
            onChange={(v) => updateEditor({ minimap: v })}
          />
          {system.advancedMode && (
            <>
              <div className="h-px bg-[var(--kt-border)] my-1" />
              <GlassSlider
                label="代码高亮对比度"
                value={editor.highlightContrast}
                min={0.5}
                max={1.5}
                step={0.1}
                onChange={(v) => updateEditor({ highlightContrast: v })}
                formatValue={(v) => v.toFixed(1)}
                advanced
              />
            </>
          )}
        </GlassCard>
      </GlassCardGroup>

      <GlassCardGroup title="保存">
        <GlassCard>
          <GlassToggle
            label="自动保存"
            description="编辑代码时自动保存草稿"
            checked={editor.autoSave}
            onChange={(v) => updateEditor({ autoSave: v })}
          />
        </GlassCard>
      </GlassCardGroup>
    </div>
  );
}
