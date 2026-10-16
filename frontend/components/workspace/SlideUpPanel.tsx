"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspace";
import type { PanelSplitMode } from "@/stores/workspace";
import { cn } from "@/lib/utils";
import {
  PanelBottom, PanelRight, PictureInPicture2, Maximize2,
  Layers, X, GripHorizontal, GripVertical,
  Stethoscope, MessageSquare, Search, Activity, Flame,
  GitBranch, Box, Cpu, Eye, Bug,
} from "lucide-react";
import TierOverview from "@/components/panels/TierOverview";
import TierDeepAnalysis from "@/components/panels/TierDeepAnalysis";
import TierFunctionDebug from "@/components/panels/TierFunctionDebug";

interface SlideUpPanelProps {
  children: React.ReactNode;
  title?: string;
}

const HEIGHT_PRESETS = [30, 40, 50];
const MIN_HEIGHT = 100;
const MAX_HEIGHT_PCT = 50;

// Window mode defaults
const WIN_DEFAULT_W = 720;
const WIN_DEFAULT_H = 520;
const WIN_MIN_W = 400;
const WIN_MIN_H = 300;

export function SlideUpPanel({ children, title }: SlideUpPanelProps) {
  const {
    isPanelOpen,
    setIsPanelOpen,
    panelMode,
    setPanelMode,
    panelHeight,
    setPanelHeight,
    activeDockTool,
    setActiveDockTool,
    secondaryDockTool,
    isTierPanelOpen,
    setIsTierPanelOpen,
    tierState,
    panelSizes,
  } = useWorkspaceStore();

  // Vertical mode resize
  const [localHeight, setLocalHeight] = useState(panelHeight);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // Window mode state
  const [winPos, setWinPos] = useState({ x: -1, y: -1 });
  const [winSize, setWinSize] = useState({ w: WIN_DEFAULT_W, h: WIN_DEFAULT_H });
  const [isWinDragging, setIsWinDragging] = useState(false);
  const [isWinResizing, setIsWinResizing] = useState(false);
  const winDragOffset = useRef({ x: 0, y: 0 });
  const winResizeDir = useRef("");
  const winResizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const winInitialized = useRef(false);
  // Refs to avoid stale closures in drag/resize handlers
  const winPosRef = useRef(winPos);
  const winSizeRef = useRef(winSize);
  useEffect(() => { winPosRef.current = winPos; }, [winPos]);
  useEffect(() => { winSizeRef.current = winSize; }, [winSize]);

  // Sync local height with store
  useEffect(() => {
    setLocalHeight(panelHeight);
  }, [panelHeight]);

  // Initialize window position (centered)
  useEffect(() => {
    if (panelMode === "window" && !winInitialized.current) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setWinPos({
        x: Math.round((vw - WIN_DEFAULT_W) / 2),
        y: Math.round((vh - WIN_DEFAULT_H) / 2),
      });
      winInitialized.current = true;
    }
  }, [panelMode]);

  // Reset window initialized flag when mode changes away from window
  useEffect(() => {
    if (panelMode !== "window") {
      winInitialized.current = false;
    }
  }, [panelMode]);

  // --- Vertical mode drag resize ---
  const handleVerticalDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragStartY.current = clientY;
    dragStartHeight.current = localHeight;

    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      const moveClientY = "touches" in moveEvent ? moveEvent.touches[0].clientY : moveEvent.clientY;
      const deltaY = dragStartY.current - moveClientY;
      const viewportH = window.innerHeight;
      const newPct = Math.min(MAX_HEIGHT_PCT, Math.max(10, dragStartHeight.current + (deltaY / viewportH) * 100));
      setLocalHeight(Math.round(newPct));
    };

    const handleUp = () => {
      setPanelHeight(Math.round(localHeight));
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    document.addEventListener("touchmove", handleMove);
    document.addEventListener("touchend", handleUp);
  }, [localHeight, setPanelHeight]);

  // --- Window mode drag ---
  const handleWinDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsWinDragging(true);
    const pos = winPosRef.current;
    winDragOffset.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };

    const handleMove = (me: MouseEvent) => {
      setWinPos({
        x: Math.max(0, Math.min(window.innerWidth - 100, me.clientX - winDragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 60, me.clientY - winDragOffset.current.y)),
      });
    };

    const handleUp = () => {
      setIsWinDragging(false);
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, []);

  // --- Window mode resize ---
  const handleWinResizeStart = useCallback((e: React.MouseEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsWinResizing(true);
    winResizeDir.current = dir;
    const pos = winPosRef.current;
    const size = winSizeRef.current;
    winResizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    const startPos = { x: pos.x, y: pos.y };

    const handleMove = (me: MouseEvent) => {
      const dx = me.clientX - winResizeStart.current.x;
      const dy = me.clientY - winResizeStart.current.y;
      let newW = winResizeStart.current.w;
      let newH = winResizeStart.current.h;
      let newX = startPos.x;
      let newY = startPos.y;

      if (dir.includes("e")) newW = Math.max(WIN_MIN_W, winResizeStart.current.w + dx);
      if (dir.includes("w")) {
        newW = Math.max(WIN_MIN_W, winResizeStart.current.w - dx);
        newX = startPos.x + (winResizeStart.current.w - newW);
      }
      if (dir.includes("s")) newH = Math.max(WIN_MIN_H, winResizeStart.current.h + dy);
      if (dir.includes("n")) {
        newH = Math.max(WIN_MIN_H, winResizeStart.current.h - dy);
        newY = startPos.y + (winResizeStart.current.h - newH);
      }

      setWinSize({ w: newW, h: newH });
      setWinPos({ x: newX, y: newY });
    };

    const handleUp = () => {
      setIsWinResizing(false);
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    const cursors: Record<string, string> = { n: "n-resize", s: "s-resize", e: "e-resize", w: "w-resize", ne: "ne-resize", nw: "nw-resize", se: "se-resize", sw: "sw-resize" };
    document.body.style.cursor = cursors[dir] || "se-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, []);

  // --- Mode definitions ---
  const modeIcons: Record<PanelSplitMode, { icon: React.ReactNode; label: string }> = {
    vertical:   { icon: <PanelBottom className="size-3.5" />, label: "底部滑出" },
    horizontal: { icon: <PanelRight className="size-3.5" />, label: "右侧分屏" },
    floating:   { icon: <PictureInPicture2 className="size-3.5" />, label: "角落小窗" },
    fullscreen: { icon: <Maximize2 className="size-3.5" />, label: "全屏展开" },
    window:     { icon: <Layers className="size-3.5" />, label: "自由悬浮" },
  };

  const modeCycle: PanelSplitMode[] = ["vertical", "horizontal", "floating", "fullscreen", "window"];

  const isVisible = (isPanelOpen && !!activeDockTool) || isTierPanelOpen;
  if (!isVisible) return null;

  // --- Tool icon & label mapping ---
  const toolMeta = (tool: string | null) => {
    switch (tool) {
      case "diagnosis":  return { icon: <Stethoscope className="size-3.5" />, label: "AI 诊断" };
      case "chat":       return { icon: <MessageSquare className="size-3.5" />, label: "AI 提问" };
      case "audit":      return { icon: <Search className="size-3.5" />, label: "代码审计" };
      case "ebpf":       return { icon: <Activity className="size-3.5" />, label: "eBPF 追踪" };
      case "flamegraph": return { icon: <Flame className="size-3.5" />, label: "火焰图" };
      case "trace":      return { icon: <GitBranch className="size-3.5" />, label: "系统 Trace" };
      case "memory3d":   return { icon: <Box className="size-3.5" />, label: "内存3D地图" };
      case "resources":  return { icon: <Cpu className="size-3.5" />, label: "资源监控" };
      default: return null;
    }
  };
    const tierLabels: Record<number, { icon: React.ReactNode; label: string; color: string }> = {
    1: { icon: <Eye className="size-3.5" />, label: "T1 全景总览", color: "var(--kt-cyan)" },
    2: { icon: <Search className="size-3.5" />, label: "T2 深度分析", color: "var(--kt-purple)" },
    3: { icon: <Bug className="size-3.5" />, label: "T3 函数调试", color: "var(--kt-red)" },
  };
  const currentTier = tierState?.currentTier || 1;
  const tierInfo = tierLabels[currentTier];
  const isTierMode = isTierPanelOpen && !activeDockTool;

  const activeMeta = toolMeta(activeDockTool);
  const toolLabel = isTierMode ? tierInfo.label : (activeMeta?.label || title || "");
  const toolIcon = isTierMode ? tierInfo.icon : activeMeta?.icon;

  const secondaryMeta = toolMeta(secondaryDockTool);
  const secondaryLabel = secondaryMeta?.label || "";
  const secondaryIcon = secondaryMeta?.icon;

  // --- Render header ---
  const renderHeader = (showDragHandle = true, extraPadding = false) => (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 border-b border-[var(--kt-border)] flex-shrink-0 bg-[var(--kt-bg-elevated)]/80 backdrop-blur-sm select-none",
      extraPadding && "cursor-move"
    )}
      onMouseDown={panelMode === "window" ? handleWinDragStart : undefined}
    >
      {showDragHandle && panelMode !== "window" && (
        <div
          className="flex items-center justify-center flex-shrink-0 cursor-ns-resize py-1"
          onMouseDown={panelMode === "vertical" ? handleVerticalDragStart : undefined}
          onTouchStart={panelMode === "vertical" ? handleVerticalDragStart : undefined}
          title={panelMode === "vertical" ? "拖拽调整高度" : ""}
        >
          <GripHorizontal className="size-4 text-[var(--kt-text-tertiary)] hover:text-[var(--kt-cyan)] transition-colors" />
        </div>
      )}

      {/* Tool icon */}
      {toolIcon && (
        <span className="flex-shrink-0 text-[var(--kt-cyan)]">{toolIcon}</span>
      )}

      {/* Title */}
      <span className="text-xs font-semibold text-[var(--kt-text)] truncate">
        {toolLabel}
        {secondaryLabel && (
          <span className="text-[var(--kt-purple)] ml-2">
            {secondaryIcon && <span className="inline-flex align-middle mr-1">{secondaryIcon}</span>}
            + {secondaryLabel}
          </span>
        )}
      </span>

      <div className="flex-1" />

      {/* --- Mode switcher --- */}
      <div className="flex items-center gap-0.5 bg-[var(--kt-bg-surface)]/60 border border-[var(--kt-border)]/60 rounded-lg p-0.5 backdrop-blur-sm">
        {modeCycle.map((mode) => (
          <button
            key={mode}
            onClick={() => setPanelMode(mode)}
            className={cn(
              "flex items-center justify-center w-7 h-6 rounded-md transition-all duration-200",
              panelMode === mode
                ? "bg-[var(--kt-cyan)]/20 text-[var(--kt-cyan)] shadow-sm"
                : "text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-bg-hover)]"
            )}
            title={modeIcons[mode].label}
          >
            {modeIcons[mode].icon}
          </button>
        ))}
      </div>

      {/* Height presets (vertical mode only) */}
      {panelMode === "vertical" && (
        <div className="flex items-center gap-0.5 ml-1">
          {HEIGHT_PRESETS.map((pct) => (
            <button
              key={pct}
              onClick={() => { setLocalHeight(pct); setPanelHeight(pct); }}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded transition-colors font-mono",
                localHeight === pct
                  ? "bg-[var(--kt-cyan-dim)] text-[var(--kt-cyan)]"
                  : "text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text)]"
              )}
            >
              {pct}%
            </button>
          ))}
        </div>
      )}

      {/* Close button */}
      <button
        onClick={(e) => { e.stopPropagation(); setIsPanelOpen(false); setIsTierPanelOpen(false); setActiveDockTool(null); }}
        className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--kt-text-tertiary)] hover:text-[var(--kt-red)] hover:bg-[var(--kt-red)]/10 transition-colors ml-1"
        title="关闭"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );

  // --- Container classes and styles per mode ---
  const containerClasses = cn(
    "kt-panel kt-slide-up flex flex-col",
    panelMode !== "window" && "overflow-hidden",
    "bg-[var(--kt-bg-glass-heavy)]",
    "backdrop-blur-[24px]",
    "border border-[var(--kt-border)]",
    // Bottom
    panelMode === "vertical" && "absolute left-0 right-0 bottom-[52px] border-t border-b-0 z-30 rounded-t-2xl",
    // Right split
    panelMode === "horizontal" && "absolute right-0 top-0 bottom-[52px] w-[45%] border-l border-r-0 z-30",
    // Corner floating
    panelMode === "floating" && "absolute right-4 bottom-[60px] w-[480px] max-w-[90vw] rounded-2xl z-30",
    // Fullscreen
    panelMode === "fullscreen" && "absolute right-0 top-0 bottom-[52px] border-l border-r-0 z-30",
    // Window
    panelMode === "window" && "fixed rounded-2xl z-50",
    // Dragging state
    isWinDragging && "opacity-95",
    isWinResizing && "select-none"
  );

  const containerStyle: React.CSSProperties =
    panelMode === "vertical"
      ? { height: `${localHeight}vh`, maxHeight: `${MAX_HEIGHT_PCT}vh`, minHeight: `${MIN_HEIGHT}px` }
      : panelMode === "floating"
      ? { height: `${Math.min(localHeight * 1.2, 70)}vh`, maxHeight: "70vh" }
      : panelMode === "fullscreen"
      ? { left: `${panelSizes.description || 32}%` }
      : panelMode === "window"
      ? { left: winPos.x, top: winPos.y, width: winSize.w, height: winSize.h }
      : {};

  // --- Window resize handles (extend beyond border for easy grabbing) ---
  // Note: resize handles are rendered inline within the window mode JSX below

  // ====== Window mode ======
  if (panelMode === "window") {
    const HANDLE = 10; // total resize zone padding
    const OVERLAP = 5; // how much handle invades the panel for reliable grabbing

    return (
      <div
        className={cn(
          "fixed z-50",
          isWinDragging && "select-none",
          isWinResizing && "select-none"
        )}
        style={{
          left: winPos.x - HANDLE,
          top: winPos.y - HANDLE,
          width: winSize.w + HANDLE * 2,
          height: winSize.h + HANDLE * 2,
        }}
      >
        {/* Outer glow ring */}
        <div className="absolute rounded-2xl pointer-events-none"
          style={{
            inset: HANDLE - 1,
            background: `linear-gradient(135deg,
              var(--kt-cyan) 0%,
              var(--kt-purple) 30%,
              var(--kt-cyan) 60%,
              var(--kt-purple) 100%)`,
            opacity: 0.35,
            filter: "blur(1px)",
          }}
        />

        {/* Shadow layer */}
        <div className="absolute rounded-[20px] pointer-events-none"
          style={{
            inset: HANDLE - 14,
            background: `radial-gradient(ellipse at 30% 0%, var(--kt-cyan-glow) 0%, transparent 50%),
                         radial-gradient(ellipse at 70% 100%, var(--kt-purple-glow) 0%, transparent 50%)`,
            opacity: 0.6,
            filter: "blur(12px)",
          }}
        />

        {/* Main panel */}
        <div
          ref={panelRef}
          className={cn(
            "absolute flex flex-col",
            "rounded-2xl overflow-hidden",
          )}
          style={{
            inset: HANDLE,
            background: "var(--kt-bg-glass-heavy)",
            backdropFilter: "blur(24px) saturate(200%)",
            WebkitBackdropFilter: "blur(24px) saturate(200%)",
            border: "1px solid var(--kt-border)",
            boxShadow: `
              0 20px 60px rgba(0,0,0,0.4),
              0 0 0 0.5px rgba(255,255,255,0.06) inset,
              0 1px 0 rgba(255,255,255,0.04) inset
            `,
          }}
        >
          {/* Decorative top accent line */}
          <div className="absolute top-0 left-4 right-4 h-px pointer-events-none"
            style={{
              background: `linear-gradient(90deg,
                transparent 0%,
                var(--kt-cyan) 20%,
                var(--kt-purple) 50%,
                var(--kt-cyan) 80%,
                transparent 100%)`,
              opacity: 0.3,
            }}
          />

          {/* Header */}
          <div
            className="flex items-center gap-2.5 px-4 py-2.5 border-b border-[var(--kt-border)] flex-shrink-0 bg-[var(--kt-bg-elevated)]/60 backdrop-blur-sm cursor-move select-none group"
            onMouseDown={(e) => {
              // block drag when clicking mode/close buttons
              const target = e.target as HTMLElement;
              if (target.closest("button")) return;
              handleWinDragStart(e);
            }}
          >
            {/* Drag dots + tool icon */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className="flex items-center gap-0.5 text-[var(--kt-text-tertiary)] group-hover:text-[var(--kt-text-secondary)] transition-colors">
                <GripVertical className="size-3" />
              </div>
              {toolIcon && (
                <span className="text-[var(--kt-cyan)]">{toolIcon}</span>
              )}
            </div>

            <span className="text-xs font-semibold text-[var(--kt-text)] truncate flex-1">
              {toolLabel}
              {secondaryLabel && (
                <span className="text-[var(--kt-purple)] ml-2">
                  {secondaryIcon && <span className="inline-flex align-middle mr-0.5">{secondaryIcon}</span>}
                  + {secondaryLabel}
                </span>
              )}
            </span>

            {/* Mode switcher in window header */}
            <div className="flex items-center gap-0.5 bg-[var(--kt-bg-surface)]/60 border border-[var(--kt-border)]/40 rounded-lg p-0.5 backdrop-blur-sm">
              {modeCycle.map((mode) => (
                <button
                  key={mode}
                  onClick={() => setPanelMode(mode)}
                  className={cn(
                    "flex items-center justify-center w-7 h-6 rounded-md transition-all duration-200",
                    panelMode === mode
                      ? "bg-[var(--kt-cyan)]/20 text-[var(--kt-cyan)] shadow-sm"
                      : "text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-bg-hover)]"
                  )}
                  title={modeIcons[mode].label}
                >
                  {modeIcons[mode].icon}
                </button>
              ))}
            </div>

            {/* Close */}
            <button
              onClick={(e) => { e.stopPropagation(); setIsPanelOpen(false); setIsTierPanelOpen(false); setActiveDockTool(null); }}
              className="flex items-center justify-center w-7 h-7 rounded-lg text-[var(--kt-text-tertiary)] hover:text-[var(--kt-red)] hover:bg-[var(--kt-red)]/10 transition-all ml-1"
              title="关闭"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto kt-scroll">
            {isTierMode ? (
              <div key={currentTier} className="h-full overflow-y-auto kt-scroll p-3 bg-[var(--kt-bg-surface)]">
                {currentTier === 1 && <TierOverview />}
                {currentTier === 2 && <TierDeepAnalysis />}
                {currentTier === 3 && <TierFunctionDebug />}
              </div>
            ) : (
              children
            )}
          </div>

        </div>

        {/* Resize handles — extend from container edge into panel by OVERLAP */}
        {/* N  */}<div className="absolute z-50 kt-win-resize-handle" style={{ top: HANDLE - OVERLAP, left: OVERLAP * 2, right: OVERLAP * 2, height: OVERLAP + HANDLE, cursor: "n-resize" }} onMouseDown={(e) => handleWinResizeStart(e, "n")} />
        {/* S  */}<div className="absolute z-50 kt-win-resize-handle" style={{ bottom: HANDLE - OVERLAP, left: OVERLAP * 2, right: OVERLAP * 2, height: OVERLAP + HANDLE, cursor: "s-resize" }} onMouseDown={(e) => handleWinResizeStart(e, "s")} />
        {/* W  */}<div className="absolute z-50 kt-win-resize-handle" style={{ left: HANDLE - OVERLAP, top: OVERLAP * 2, bottom: OVERLAP * 2, width: OVERLAP + HANDLE, cursor: "w-resize" }} onMouseDown={(e) => handleWinResizeStart(e, "w")} />
        {/* E  */}<div className="absolute z-50 kt-win-resize-handle" style={{ right: HANDLE - OVERLAP, top: OVERLAP * 2, bottom: OVERLAP * 2, width: OVERLAP + HANDLE, cursor: "e-resize" }} onMouseDown={(e) => handleWinResizeStart(e, "e")} />
        {/* NW */}<div className="absolute z-50 kt-win-resize-handle" style={{ top: HANDLE - OVERLAP, left: HANDLE - OVERLAP, width: OVERLAP + HANDLE, height: OVERLAP + HANDLE, cursor: "nw-resize" }} onMouseDown={(e) => handleWinResizeStart(e, "nw")} />
        {/* NE */}<div className="absolute z-50 kt-win-resize-handle" style={{ top: HANDLE - OVERLAP, right: HANDLE - OVERLAP, width: OVERLAP + HANDLE, height: OVERLAP + HANDLE, cursor: "ne-resize" }} onMouseDown={(e) => handleWinResizeStart(e, "ne")} />
        {/* SW */}<div className="absolute z-50 kt-win-resize-handle" style={{ bottom: HANDLE - OVERLAP, left: HANDLE - OVERLAP, width: OVERLAP + HANDLE, height: OVERLAP + HANDLE, cursor: "sw-resize" }} onMouseDown={(e) => handleWinResizeStart(e, "sw")} />
        {/* SE */}<div className="absolute z-50 kt-win-resize-handle" style={{ bottom: HANDLE - OVERLAP, right: HANDLE - OVERLAP, width: OVERLAP + HANDLE, height: OVERLAP + HANDLE, cursor: "se-resize" }} onMouseDown={(e) => handleWinResizeStart(e, "se")} />
      </div>
    );
  }

  // ====== Non-window modes ======
  return (
    <div ref={panelRef} className={containerClasses} style={containerStyle}>
      {renderHeader()}
      <div className="flex-1 overflow-hidden kt-scroll">{isTierMode ? (
              <div key={currentTier} className="h-full overflow-y-auto kt-scroll p-3 bg-[var(--kt-bg-surface)]">
                {currentTier === 1 && <TierOverview />}
                {currentTier === 2 && <TierDeepAnalysis />}
                {currentTier === 3 && <TierFunctionDebug />}
              </div>
            ) : (
              children
            )}</div>
    </div>
  );
}


