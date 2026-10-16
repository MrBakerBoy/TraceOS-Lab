"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useWorkspaceStore } from "@/stores/workspace";
import type { LayoutPreset, DockTool } from "@/stores/workspace";
import { cn } from "@/lib/utils";
import {
  Search, Code2, Bug, BarChart3, Stethoscope, MessageSquare,
  Search as SearchIcon, Activity, Flame, GitBranch, Camera,
  Play, PanelBottom, ChevronRight, Eye, EyeOff, Zap,
} from "lucide-react";

interface CommandItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
  category: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const {
    setLayoutPreset,
    setActiveDockTool,
    setIsPanelOpen,
    isPanelOpen,
    setIsDockVisible,
    isDockVisible,
    setIsRightVisible,
    isRightVisible,
    addSnapshot,
    submitCode,
    submitting,
  } = useWorkspaceStore();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build command list
  const commands: CommandItem[] = [
    // Layout
    {
      id: "layout-coding",
      label: "编码模式",
      description: "收起全部面板，编辑器最大化",
      icon: <Code2 className="size-4" />,
      shortcut: "Ctrl+0",
      action: () => setLayoutPreset("coding"),
      category: "布局",
    },
    {
      id: "layout-debugging",
      label: "调试模式",
      description: "默认上下分屏",
      icon: <Bug className="size-4" />,
      action: () => setLayoutPreset("debugging"),
      category: "布局",
    },
    {
      id: "layout-analyzing",
      label: "分析模式",
      description: "展开指标，左右分屏",
      icon: <BarChart3 className="size-4" />,
      action: () => setLayoutPreset("analyzing"),
      category: "布局",
    },
    // Dock tools
    {
      id: "tool-diagnosis",
      label: "AI 诊断",
      description: "查看代码诊断结果",
      icon: <Stethoscope className="size-4" />,
      shortcut: "Ctrl+1",
      action: () => setActiveDockTool("diagnosis"),
      category: "工具",
    },
    {
      id: "tool-chat",
      label: "AI 提问",
      description: "向 AI 助手提问",
      icon: <MessageSquare className="size-4" />,
      shortcut: "Ctrl+2",
      action: () => setActiveDockTool("chat"),
      category: "工具",
    },
    {
      id: "tool-audit",
      label: "代码审计",
      description: "检查代码质量与安全问题",
      icon: <SearchIcon className="size-4" />,
      shortcut: "Ctrl+3",
      action: () => setActiveDockTool("audit"),
      category: "工具",
    },
    {
      id: "tool-ebpf",
      label: "eBPF 追踪",
      description: "内核级系统调用追踪",
      icon: <Activity className="size-4" />,
      shortcut: "Ctrl+4",
      action: () => setActiveDockTool("ebpf"),
      category: "工具",
    },
    {
      id: "tool-flamegraph",
      label: "火焰图",
      description: "性能热点分析",
      icon: <Flame className="size-4" />,
      shortcut: "Ctrl+5",
      action: () => setActiveDockTool("flamegraph"),
      category: "工具",
    },
    {
      id: "tool-trace",
      label: "系统 Trace",
      description: "系统调用时序分析",
      icon: <GitBranch className="size-4" />,
      shortcut: "Ctrl+6",
      action: () => setActiveDockTool("trace"),
      category: "工具",
    },
    // Actions
    {
      id: "action-run",
      label: "运行代码",
      description: "提交并运行当前代码",
      icon: <Play className="size-4" />,
      shortcut: "F5",
      action: () => { if (!submitting) submitCode(); },
      category: "操作",
    },
    {
      id: "action-snapshot",
      label: "保存快照",
      description: "保存当前代码版本",
      icon: <Camera className="size-4" />,
      shortcut: "Ctrl+S",
      action: () => addSnapshot("命令面板保存"),
      category: "操作",
    },
    {
      id: "action-panel",
      label: isPanelOpen ? "关闭面板" : "打开面板",
      description: "切换底部滑出面板",
      icon: <PanelBottom className="size-4" />,
      shortcut: "Ctrl+E",
      action: () => setIsPanelOpen(!isPanelOpen),
      category: "操作",
    },
    // Visibility
    {
      id: "toggle-right",
      label: isRightVisible ? "隐藏右侧栏" : "显示右侧栏",
      description: "切换右侧状态面板",
      icon: isRightVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />,
      shortcut: "Ctrl+Shift+B",
      action: () => setIsRightVisible(!isRightVisible),
      category: "视图",
    },
    {
      id: "toggle-dock",
      label: isDockVisible ? "隐藏 Dock" : "显示 Dock",
      description: "切换底部工具栏",
      icon: isDockVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />,
      shortcut: "Ctrl+Shift+D",
      action: () => setIsDockVisible(!isDockVisible),
      category: "视图",
    },
  ];

  // Filter
  const filtered = query.trim()
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.description.toLowerCase().includes(query.toLowerCase()) ||
          c.category.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  // Group by category
  const grouped: Record<string, CommandItem[]> = {};
  filtered.forEach((c) => {
    if (!grouped[c.category]) grouped[c.category] = [];
    grouped[c.category].push(c);
  });

  const flatFiltered = filtered;
  const selected = flatFiltered[selectedIndex];

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, flatFiltered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (selected) {
            selected.action();
            onClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [flatFiltered, selected, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="kt-command-palette" onClick={onClose}>
      <div
        className="kt-command-palette-inner kt-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--kt-border)]">
          <Search className="size-4 text-[var(--kt-text-tertiary)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="搜索命令... (布局、工具、操作)"
            className="flex-1 bg-transparent text-sm text-[var(--kt-text)] outline-none placeholder:text-[var(--kt-text-tertiary)]"
          />
          <kbd className="text-[10px] text-[var(--kt-text-tertiary)] bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)] px-1.5 py-0.5 rounded font-mono">
            ESC
          </kbd>
        </div>

        {/* Command list */}
        <div className="max-h-[320px] overflow-y-auto kt-scroll p-2">
          {flatFiltered.length === 0 ? (
            <div className="text-center py-8 text-[var(--kt-text-tertiary)] text-sm">
              未找到匹配命令
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="mb-2">
                <div className="text-[10px] text-[var(--kt-text-tertiary)] uppercase tracking-wider px-2 py-1">
                  {category}
                </div>
                {items.map((item) => {
                  const idx = flatFiltered.indexOf(item);
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { item.action(); onClose(); }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors",
                        isSelected
                          ? "bg-[var(--kt-cyan-dim)] text-[var(--kt-cyan)]"
                          : "text-[var(--kt-text-secondary)] hover:bg-[var(--kt-bg-elevated)]"
                      )}
                    >
                      <span className={cn(isSelected ? "text-[var(--kt-cyan)]" : "text-[var(--kt-text-tertiary)]")}>
                        {item.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{item.label}</div>
                        <div className="text-[11px] text-[var(--kt-text-tertiary)]">{item.description}</div>
                      </div>
                      {item.shortcut && (
                        <kbd className="text-[10px] text-[var(--kt-text-tertiary)] bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)] px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                          {item.shortcut}
                        </kbd>
                      )}
                      {isSelected && <ChevronRight className="size-3.5 text-[var(--kt-cyan)]" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-[var(--kt-border)] text-[10px] text-[var(--kt-text-tertiary)]">
          <span>↑↓ 导航</span>
          <span>↵ 选择</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
