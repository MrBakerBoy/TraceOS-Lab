"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Play, Send, Columns3, PanelRight, Maximize2, Columns2, Code2 } from "lucide-react";
import type { LayoutType } from "@/stores/workspace";

interface WorkspaceToolbarProps {
  title: string;
  onRun: () => void;
  onSubmit: () => void;
  isRunning: boolean;
  activeLayout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
}

const layoutOptions: { type: LayoutType; label: string; icon: React.ReactNode }[] = [
  { type: "three-column", label: "三栏布局", icon: <Columns3 className="size-4" /> },
  { type: "two-column-terminal", label: "双栏+终端", icon: <PanelRight className="size-4" /> },
  { type: "focus", label: "专注模式", icon: <Maximize2 className="size-4" /> },
  { type: "compare", label: "对比模式", icon: <Columns2 className="size-4" /> },
];

export function WorkspaceToolbar({ title, onRun, onSubmit, isRunning, activeLayout, onLayoutChange }: WorkspaceToolbarProps) {
  return (
    <div className="h-12 flex items-center gap-3 px-4 bg-card border-b flex-shrink-0 select-none">
      <div className="flex items-center gap-2.5 mr-3">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary via-purple-500 to-teal-500 flex items-center justify-center flex-shrink-0 shadow-sm">
          <Code2 className="size-3 text-white" strokeWidth={2.5} />
        </div>
        <h2 className="text-sm font-semibold truncate max-w-[300px]">{title}</h2>
      </div>

      <div className="flex items-center gap-1.5">
        <Button size="sm" onClick={onRun} disabled={isRunning} className="text-xs gap-1">
          <Play className="size-3.5" /> {isRunning ? "运行中" : "运行"}
        </Button>
        <Button size="sm" variant="outline" onClick={onSubmit} disabled={isRunning} className="text-xs gap-1">
          <Send className="size-3.5" /> 提交
        </Button>
      </div>

      <div className="flex-1" />

      <div className="flex gap-0.5 bg-muted rounded-lg p-0.5">
        {layoutOptions.map((opt) => (
          <button key={opt.type} onClick={() => onLayoutChange(opt.type)}
            className={cn(
              "w-8 h-7 flex items-center justify-center rounded-md transition-all duration-150",
              activeLayout === opt.type
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:bg-background hover:text-foreground"
            )}
            title={opt.label}
          >
            {opt.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
