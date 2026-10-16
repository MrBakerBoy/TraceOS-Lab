"use client";

import { useMemo } from "react";
import { useWorkspaceStore } from "@/stores/workspace";
import { getChatTheme, type ChatThemeColors } from "@/lib/chat-theme";

/**
 * Hook that returns the current chat theme colors based on the active
 * experiment workspace theme (light/dark/warm/slate/neon).
 */
export function useChatTheme(): ChatThemeColors {
  const themeMode = useWorkspaceStore((s) => s.themeMode);
  return useMemo(() => getChatTheme(themeMode), [themeMode]);
}