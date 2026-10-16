import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";
export type EditorTheme =
  | "one-dark-pro"
  | "dracula"
  | "monokai"
  | "github-light";

interface ThemeState {
  mode: ThemeMode;
  resolvedMode: "light" | "dark";
  editorTheme: EditorTheme;
  setMode: (mode: ThemeMode) => void;
  setEditorTheme: (theme: EditorTheme) => void;
  toggleMode: () => void;
}

const THEME_KEY = "traceos_theme";
const EDITOR_THEME_KEY = "traceos_editor_theme";

function getSystemPreference(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function loadInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: "system",
  resolvedMode: "light",
  editorTheme: "one-dark-pro",

  setMode: (mode) => {
    localStorage.setItem(THEME_KEY, mode);
    const resolvedMode = mode === "system" ? getSystemPreference() : mode;
    set({ mode, resolvedMode });
  },

  setEditorTheme: (theme) => {
    localStorage.setItem(EDITOR_THEME_KEY, theme);
    set({ editorTheme: theme });
  },

  toggleMode: () => {
    const { resolvedMode, setMode } = get();
    setMode(resolvedMode === "dark" ? "light" : "dark");
  },
}));

if (typeof window !== "undefined") {
  const mode = loadInitialMode();
  useThemeStore.setState({
    mode,
    resolvedMode: mode === "system" ? getSystemPreference() : mode,
    editorTheme: (localStorage.getItem(EDITOR_THEME_KEY) as EditorTheme) || "one-dark-pro",
  });
}
