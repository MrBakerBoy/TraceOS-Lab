"use client";

import { useEffect, useCallback } from "react";
import { useWorkspaceStore } from "@/stores/workspace";
import type { DockTool } from "@/stores/workspace";

/**
 * Keyboard shortcuts for the experiment workspace.
 *
 * Shortcuts:
 *   Ctrl+1      → AI Diagnosis
 *   Ctrl+2      → AI Chat
 *   Ctrl+3      → Code Audit
 *   Ctrl+4      → eBPF Trace
 *   Ctrl+5      → Flame Graph
 *   Ctrl+6      → System Trace
 *   Ctrl+E      → Toggle slide-up panel
 *   Ctrl+B      → Toggle left info panel (handled by ExperimentWorkspace)
 *   Ctrl+Shift+B → Toggle right sidebar
 *   Ctrl+Shift+D → Toggle Dock visibility
 *   Ctrl+S      → Save code snapshot
 *   Ctrl+K      → Open command palette
 *   F5          → Run code
 *   Escape      → Close panel / close palette
 */

const TOOL_MAP: Record<string, DockTool> = {
  "1": "diagnosis",
  "2": "chat",
  "3": "audit",
  "4": "ebpf",
  "5": "flamegraph",
  "6": "trace",
};

export function useExperimentShortcuts(
  onOpenPalette: () => void,
  onClosePalette: () => void,
) {
  const {
    setActiveDockTool,
    isPanelOpen,
    setIsPanelOpen,
    setIsDockVisible,
    isDockVisible,
    setIsRightVisible,
    isRightVisible,
    addSnapshot,
    submitCode,
    submitting,
  } = useWorkspaceStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl+Shift combinations
      if (mod && e.shiftKey) {
        switch (e.key.toUpperCase()) {
          case "B":
            e.preventDefault();
            setIsRightVisible(!isRightVisible);
            return;
          case "D":
            e.preventDefault();
            setIsDockVisible(!isDockVisible);
            return;
        }
        return;
      }

      // Ctrl combinations
      if (mod && !e.shiftKey) {
        // Dock tool shortcuts (Ctrl+1~6)
        if (TOOL_MAP[e.key]) {
          e.preventDefault();
          setActiveDockTool(TOOL_MAP[e.key]);
          return;
        }

        switch (e.key) {
          case "e":
          case "E":
            e.preventDefault();
            setIsPanelOpen(!isPanelOpen);
            return;
          case "b":
          case "B":
            e.preventDefault();
            // Toggle left panel - dispatched as custom event for ExperimentWorkspace
            window.dispatchEvent(new CustomEvent("toggle-left-panel"));
            return;
          case "s":
          case "S":
            e.preventDefault();
            addSnapshot("快捷键保存");
            return;
          case "k":
          case "K":
            e.preventDefault();
            onOpenPalette();
            return;
        }
        return;
      }

      // Non-modifier keys
      switch (e.key) {
        case "F5":
          e.preventDefault();
          if (!submitting) submitCode();
          return;
        case "Escape":
          if (isPanelOpen) {
            e.preventDefault();
            setIsPanelOpen(false);
          }
          onClosePalette();
          return;
      }
    },
    [
      setActiveDockTool,
      isPanelOpen,
      setIsPanelOpen,
      setIsDockVisible,
      isDockVisible,
      setIsRightVisible,
      isRightVisible,
      addSnapshot,
      submitCode,
      submitting,
      onOpenPalette,
      onClosePalette,
    ]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
