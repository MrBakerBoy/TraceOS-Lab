"use client";

import { useTheme as useNextTheme } from "next-themes";
import { useThemeStore } from "@/stores/theme";
import type { EditorTheme } from "@/stores/theme";

export function useTheme() {
  const { theme, setTheme } = useNextTheme();
  const editorTheme = useThemeStore((s) => s.editorTheme);
  const setEditorTheme = useThemeStore((s) => s.setEditorTheme);

  const isDark = theme === "dark";
  const toggleMode = () => setTheme(isDark ? "light" : "dark");

  return {
    mode: theme as "light" | "dark" | "system",
    isDark,
    editorTheme,
    toggleMode,
    setMode: (m: "light" | "dark" | "system") => setTheme(m),
    setEditorTheme: (t: EditorTheme) => setEditorTheme(t),
  };
}
