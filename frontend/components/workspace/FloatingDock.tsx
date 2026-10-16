"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWorkspaceStore } from "@/stores/workspace";
import type { DockTool } from "@/stores/workspace";
import { cn } from "@/lib/utils";
import {
  Stethoscope, MessageSquare, Search, Activity, Flame, GitBranch,
  Box, ChevronUp, ChevronDown, Layers, MoreHorizontal, Zap, Cpu,
  Pin, PinOff, X,
} from "lucide-react";

interface ToolDef {
  id: DockTool;
  label: string;
  icon: React.ReactNode;
  shortcut: string;
  category: "core" | "primary" | "professional";
}

const ALL_TOOLS: ToolDef[] = [
  { id: "diagnosis",  label: "AI \u8bca\u65ad",   icon: <Stethoscope className="size-4" />,  shortcut: "Ctrl+1", category: "core" },
  { id: "chat",       label: "AI \u63d0\u95ee",   icon: <MessageSquare className="size-4" />, shortcut: "Ctrl+2", category: "core" },
  { id: "audit",      label: "\u4ee3\u7801\u5ba1\u8ba1", icon: <Search className="size-4" />,      shortcut: "Ctrl+3", category: "primary" },
  { id: "ebpf",       label: "eBPF \u8ffd\u8e2a",  icon: <Activity className="size-4" />,    shortcut: "Ctrl+4", category: "professional" },
  { id: "flamegraph", label: "\u706b\u7130\u56fe",   icon: <Flame className="size-4" />,       shortcut: "Ctrl+5", category: "professional" },
  { id: "trace",      label: "\u7cfb\u7edf Trace", icon: <GitBranch className="size-4" />,   shortcut: "Ctrl+6", category: "professional" },
  { id: "memory3d",   label: "\u5185\u5b583D\u5730\u56fe", icon: <Box className="size-4" />,        shortcut: "Ctrl+7", category: "professional" },
  { id: "resources",  label: "\u8d44\u6e90\u76d1\u63a7", icon: <Cpu className="size-4" />,         shortcut: "Ctrl+8", category: "primary" },
];

const CORE_TOOLS: DockTool[] = ["diagnosis", "chat"];

export function FloatingDock() {
  const {
    isDockVisible, setIsDockVisible,
    activeDockTool, secondaryDockTool,
    setActiveDockTool, parallelMode, setParallelMode,
    dockPinnedTools, setDockPinnedTools,
  } = useWorkspaceStore();

  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMore) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setShowMore(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMore]);

  useEffect(() => {
    const missing = CORE_TOOLS.filter((t) => !dockPinnedTools.includes(t));
    if (missing.length > 0) {
      setDockPinnedTools([...CORE_TOOLS, ...dockPinnedTools.filter((t) => !CORE_TOOLS.includes(t as DockTool))]);
    }
  }, []);

  const pinnedDefs = ALL_TOOLS.filter((t) => dockPinnedTools.includes(t.id));
  const moreDefs = ALL_TOOLS.filter((t) => !dockPinnedTools.includes(t.id));

  const togglePin = (toolId: DockTool) => {
    if (CORE_TOOLS.includes(toolId) && dockPinnedTools.includes(toolId)) return;
    if (dockPinnedTools.includes(toolId)) {
      setDockPinnedTools(dockPinnedTools.filter((t) => t !== toolId));
    } else {
      setDockPinnedTools([...dockPinnedTools, toolId]);
    }
  };

  const isCore = (id: DockTool) => CORE_TOOLS.includes(id);

  if (!isDockVisible) {
    return (
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40">
        <button
          onClick={() => setIsDockVisible(true)}
          className="kt-glass-heavy flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--kt-border)] text-xs text-[var(--kt-text-secondary)] hover:text-[var(--kt-cyan)] hover:border-[var(--kt-cyan)]/30 transition-all shadow-lg"
        >
          <ChevronUp className="size-3.5" />
          <Layers className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40">
      <motion.div
        className="kt-dock flex items-center gap-1 px-2 py-1.5 rounded-xl border border-[var(--kt-border)]/40 bg-[var(--kt-bg-glass)]/90 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.03)_inset]"
        initial={{ y: 20, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        {/* Core tools - always pinned, no unpin */}
        {pinnedDefs.filter((t) => isCore(t.id)).map((tool) => (
          <motion.button
            key={tool.id}
            onClick={() => setActiveDockTool(tool.id)}
            whileHover={{ scale: 1.08, y: -1 }}
            whileTap={{ scale: 0.93 }}
            className={cn(
              "kt-dock-btn transition-shadow duration-200",
              activeDockTool === tool.id && "active shadow-[0_0_12px_rgba(0,212,255,0.25)]",
              secondaryDockTool === tool.id && "ring-1 ring-[var(--kt-purple)]/30 shadow-[0_0_10px_rgba(191,90,242,0.2)]"
            )}
            title={`${tool.label} (${tool.shortcut})`}
          >
            {tool.icon}
            <span className="hidden md:inline text-[11px]">{tool.label}</span>
          </motion.button>
        ))}

        {/* Separator */}
        {pinnedDefs.some((t) => !isCore(t.id)) && (
          <div className="w-px h-5 bg-[var(--kt-border)] mx-0.5" />
        )}

        {/* User-pinned tools - show unpin X button always */}
        {pinnedDefs.filter((t) => !isCore(t.id)).map((tool) => (
          <motion.button
            key={tool.id}
            onClick={() => setActiveDockTool(tool.id)}
            whileHover={{ scale: 1.08, y: -1 }}
            whileTap={{ scale: 0.93 }}
            className={cn(
              "kt-dock-btn relative transition-shadow duration-200",
              activeDockTool === tool.id && "active shadow-[0_0_12px_rgba(0,212,255,0.25)]",
              secondaryDockTool === tool.id && "ring-1 ring-[var(--kt-purple)]/30 shadow-[0_0_10px_rgba(191,90,242,0.2)]"
            )}
            title={`${tool.label} (${tool.shortcut})`}
          >
            {tool.icon}
            <span className="hidden md:inline text-[11px]">{tool.label}</span>
            <span
              onClick={(e) => { e.stopPropagation(); togglePin(tool.id); }}
              className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)] flex items-center justify-center text-[var(--kt-text-tertiary)] hover:text-[var(--kt-red)] hover:border-[var(--kt-red)] transition-colors cursor-pointer opacity-60 hover:opacity-100"
              title={"\u53d6\u6d88\u56fa\u5b9a"}
            >
              <X className="size-2" />
            </span>
          </motion.button>
        ))}

        {/* More button + dropdown */}
        {moreDefs.length > 0 && (
          <>
            <div className="w-px h-5 bg-[var(--kt-border)] mx-0.5" />
            <div className="relative" ref={moreRef}>
              <button
                onClick={() => setShowMore(!showMore)}
                className={cn("kt-dock-btn", showMore && "active")}
                title={"\u66f4\u591a\u5de5\u5177"}
              >
                <MoreHorizontal className="size-4" />
              </button>

              <AnimatePresence>
                {showMore && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full left-0 mb-2 w-48 bg-[var(--kt-bg-glass-heavy)] backdrop-blur-xl border border-[var(--kt-border)] rounded-lg shadow-2xl py-1"
                >
                  {moreDefs.map((tool) => (
                    <div key={tool.id} className="flex items-center">
                      <button
                        onClick={() => { setActiveDockTool(tool.id); setShowMore(false); }}
                        className="flex-1 flex items-center gap-2 px-3 py-2 text-xs text-[var(--kt-text-secondary)] hover:text-[var(--kt-cyan)] hover:bg-[var(--kt-cyan-dim)] transition-colors"
                      >
                        {tool.icon}
                        <span>{tool.label}</span>
                        <span className="ml-auto text-[10px] text-[var(--kt-text-tertiary)]">{tool.shortcut}</span>
                      </button>
                      <button
                        onClick={() => togglePin(tool.id)}
                        className="px-2 py-2 text-[var(--kt-text-tertiary)] hover:text-[var(--kt-cyan)] transition-colors"
                        title={"\u56fa\u5b9a\u5230\u5de5\u5177\u680f"}
                      >
                        <Pin className="size-3" />
                      </button>
                    </div>
                  ))}

                  {pinnedDefs.filter((t) => !isCore(t.id)).length > 0 && (
                    <>
                      <div className="border-t border-[var(--kt-border)] mt-1 pt-1 px-3">
                        <span className="text-[9px] text-[var(--kt-text-tertiary)] uppercase tracking-wider">
                          {"\u5df2\u56fa\u5b9a"}
                        </span>
                      </div>
                      {pinnedDefs.filter((t) => !isCore(t.id)).map((tool) => (
                        <div key={"p-" + tool.id} className="flex items-center px-3 py-1.5 text-xs text-[var(--kt-text-tertiary)]">
                          <span className="mr-2">{tool.icon}</span>
                          <span className="flex-1 text-[var(--kt-text-secondary)]">{tool.label}</span>
                          <button
                            onClick={() => togglePin(tool.id)}
                            className="text-[var(--kt-text-tertiary)] hover:text-[var(--kt-red)] transition-colors"
                            title={"\u53d6\u6d88\u56fa\u5b9a"}
                          >
                            <PinOff className="size-3" />
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </motion.div>
              )}
              </AnimatePresence>
            </div>
          </>
        )}

        {/* Controls */}
        <div className="w-px h-5 bg-[var(--kt-border)] mx-0.5" />
        <button
          onClick={() => setParallelMode(!parallelMode)}
          className={cn("kt-dock-btn", parallelMode && "active")}
          title={parallelMode ? "\u5e76\u884c\u6a21\u5f0f\uff1a\u5f00" : "\u5e76\u884c\u6a21\u5f0f\uff1a\u5173"}
        >
          <Zap className={cn("size-3.5", parallelMode && "text-[var(--kt-purple)]")} />
          <span className="hidden md:inline text-[10px]">并行</span>
        </button>
        <button
          onClick={() => setIsDockVisible(false)}
          className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--kt-text-secondary)] hover:text-[var(--kt-cyan)] hover:bg-[var(--kt-cyan-dim)] transition-colors"
          title={"\u6536\u8d77\u5de5\u5177\u680f"}
        >
          <ChevronDown className="size-4" />
        </button>
      </motion.div>
    </div>
  );
}