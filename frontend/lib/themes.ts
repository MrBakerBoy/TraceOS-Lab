/**
 * Experiment Workspace Theme Definitions
 * 4 built-in theme color schemes for the experiment page.
 */

export type ThemeMode = "light" | "dark" | "warm" | "slate" | "neon";

export interface ThemeDefinition {
  id: ThemeMode;
  label: string;
  icon: string;           // emoji icon for the switcher button
  bgClass: string;         // Tailwind background class for root div
  cssVars: Record<string, string>;
}

const LIGHT_VARS: Record<string, string> = {
  "--kt-bg-deep": "#f2f2f5",
  "--kt-bg-surface": "#fafafa",
  "--kt-bg-elevated": "#f5f5f7",
  "--kt-bg-glass": "rgba(255, 255, 255, 0.78)",
  "--kt-bg-glass-light": "rgba(255, 255, 255, 0.55)",
  "--kt-bg-glass-heavy": "rgba(250, 250, 252, 0.92)",
  "--kt-cyan": "#0071e3",
  "--kt-cyan-dim": "rgba(0, 113, 227, 0.1)",
  "--kt-cyan-glow": "rgba(0, 113, 227, 0.2)",
  "--kt-purple": "#8b5cf6",
  "--kt-purple-dim": "rgba(139, 92, 246, 0.1)",
  "--kt-purple-glow": "rgba(139, 92, 246, 0.2)",
  "--kt-green": "#30d158",
  "--kt-green-dim": "rgba(48, 209, 88, 0.1)",
  "--kt-amber": "#ff9f0a",
  "--kt-amber-dim": "rgba(255, 159, 10, 0.1)",
  "--kt-red": "#ff453a",
  "--kt-red-dim": "rgba(255, 69, 58, 0.08)",
  "--kt-border": "rgba(0, 0, 0, 0.08)",
  "--kt-border-strong": "rgba(0, 0, 0, 0.12)",
  "--kt-border-glow": "rgba(0, 113, 227, 0.15)",
  "--kt-text": "rgba(0, 0, 0, 0.88)",
  "--kt-text-secondary": "rgba(0, 0, 0, 0.58)",
  "--kt-text-tertiary": "rgba(0, 0, 0, 0.36)",
  "--kt-shadow-depth": "0 1px 4px rgba(0, 0, 0, 0.08)",
  "--kt-noise-opacity": "0",
};

const DARK_VARS: Record<string, string> = {
  "--kt-bg-deep": "#0A0A0F",
  "--kt-bg-surface": "#12121A",
  "--kt-bg-elevated": "#18181F",
  "--kt-bg-glass": "rgba(18, 18, 26, 0.85)",
  "--kt-bg-glass-light": "rgba(24, 24, 31, 0.65)",
  "--kt-bg-glass-heavy": "rgba(10, 10, 15, 0.92)",
  "--kt-cyan": "#00D4FF",
  "--kt-cyan-dim": "rgba(0, 212, 255, 0.15)",
  "--kt-cyan-glow": "rgba(0, 212, 255, 0.25)",
  "--kt-purple": "#BF5AF2",
  "--kt-purple-dim": "rgba(191, 90, 242, 0.15)",
  "--kt-purple-glow": "rgba(191, 90, 242, 0.25)",
  "--kt-green": "#30D158",
  "--kt-green-dim": "rgba(48, 209, 88, 0.15)",
  "--kt-amber": "#FF9F0A",
  "--kt-amber-dim": "rgba(255, 159, 10, 0.15)",
  "--kt-red": "#FF453A",
  "--kt-red-dim": "rgba(255, 69, 58, 0.12)",
  "--kt-border": "rgba(255, 255, 255, 0.10)",
  "--kt-border-strong": "rgba(255, 255, 255, 0.16)",
  "--kt-border-glow": "rgba(0, 212, 255, 0.2)",
  "--kt-text": "#F5F5F7",
  "--kt-text-secondary": "#B4B4BE",
  "--kt-text-tertiary": "#8D8D97",
  "--kt-shadow-depth": "0 8px 32px rgba(0, 0, 0, 0.6)",
  "--kt-noise-opacity": "0.012",
};

const WARM_VARS: Record<string, string> = {
  "--kt-bg-deep": "#faf3e6",
  "--kt-bg-surface": "#fdf8f0",
  "--kt-bg-elevated": "#f5eddc",
  "--kt-bg-glass": "rgba(253, 248, 240, 0.85)",
  "--kt-bg-glass-light": "rgba(245, 237, 220, 0.65)",
  "--kt-bg-glass-heavy": "rgba(250, 243, 230, 0.94)",
  "--kt-cyan": "#d97706",
  "--kt-cyan-dim": "rgba(217, 119, 6, 0.1)",
  "--kt-cyan-glow": "rgba(217, 119, 6, 0.2)",
  "--kt-purple": "#a855f7",
  "--kt-purple-dim": "rgba(168, 85, 247, 0.1)",
  "--kt-purple-glow": "rgba(168, 85, 247, 0.2)",
  "--kt-green": "#16a34a",
  "--kt-green-dim": "rgba(22, 163, 74, 0.1)",
  "--kt-amber": "#f59e0b",
  "--kt-amber-dim": "rgba(245, 158, 11, 0.1)",
  "--kt-red": "#dc2626",
  "--kt-red-dim": "rgba(220, 38, 38, 0.08)",
  "--kt-border": "rgba(0, 0, 0, 0.08)",
  "--kt-border-strong": "rgba(0, 0, 0, 0.14)",
  "--kt-border-glow": "rgba(217, 119, 6, 0.15)",
  "--kt-text": "#3d3522",
  "--kt-text-secondary": "#6B6152",
  "--kt-text-tertiary": "#7B715E",
  "--kt-shadow-depth": "0 1px 6px rgba(0, 0, 0, 0.06)",
  "--kt-noise-opacity": "0",
};

const SLATE_VARS: Record<string, string> = {
  "--kt-bg-deep": "#1e293b",
  "--kt-bg-surface": "#1e293b",
  "--kt-bg-elevated": "#334155",
  "--kt-bg-glass": "rgba(30, 41, 59, 0.88)",
  "--kt-bg-glass-light": "rgba(51, 65, 85, 0.68)",
  "--kt-bg-glass-heavy": "rgba(15, 23, 42, 0.94)",
  "--kt-cyan": "#38bdf8",
  "--kt-cyan-dim": "rgba(56, 189, 248, 0.12)",
  "--kt-cyan-glow": "rgba(56, 189, 248, 0.22)",
  "--kt-purple": "#a78bfa",
  "--kt-purple-dim": "rgba(167, 139, 250, 0.12)",
  "--kt-purple-glow": "rgba(167, 139, 250, 0.22)",
  "--kt-green": "#34d399",
  "--kt-green-dim": "rgba(52, 211, 153, 0.12)",
  "--kt-amber": "#fbbf24",
  "--kt-amber-dim": "rgba(251, 191, 36, 0.12)",
  "--kt-red": "#f87171",
  "--kt-red-dim": "rgba(248, 113, 113, 0.1)",
  "--kt-border": "rgba(255, 255, 255, 0.10)",
  "--kt-border-strong": "rgba(255, 255, 255, 0.14)",
  "--kt-border-glow": "rgba(56, 189, 248, 0.18)",
  "--kt-text": "#f1f5f9",
  "--kt-text-secondary": "#C9D2E0",
  "--kt-text-tertiary": "#9BA6B8",
  "--kt-shadow-depth": "0 4px 24px rgba(0, 0, 0, 0.5)",
  "--kt-noise-opacity": "0.008",
};

const NEON_VARS: Record<string, string> = {
  "--kt-bg-deep": "#0a0a0f",
  "--kt-bg-surface": "#0d1117",
  "--kt-bg-elevated": "#161b22",
  "--kt-bg-glass": "rgba(13, 17, 23, 0.88)",
  "--kt-bg-glass-light": "rgba(22, 27, 34, 0.65)",
  "--kt-bg-glass-heavy": "rgba(10, 10, 15, 0.94)",
  "--kt-cyan": "#00ff41",
  "--kt-cyan-dim": "rgba(0, 255, 65, 0.10)",
  "--kt-cyan-glow": "rgba(0, 255, 65, 0.25)",
  "--kt-purple": "#bf5af2",
  "--kt-purple-dim": "rgba(191, 90, 242, 0.12)",
  "--kt-purple-glow": "rgba(191, 90, 242, 0.22)",
  "--kt-green": "#39ff14",
  "--kt-green-dim": "rgba(57, 255, 20, 0.12)",
  "--kt-amber": "#ffd700",
  "--kt-amber-dim": "rgba(255, 215, 0, 0.12)",
  "--kt-red": "#ff3333",
  "--kt-red-dim": "rgba(255, 51, 51, 0.12)",
  "--kt-border": "rgba(0, 255, 65, 0.10)",
  "--kt-border-strong": "rgba(0, 255, 65, 0.15)",
  "--kt-border-glow": "rgba(0, 255, 65, 0.2)",
  "--kt-text": "#e6edf3",
  "--kt-text-secondary": "#B9C1CB",
  "--kt-text-tertiary": "#919AA5",
  "--kt-shadow-depth": "0 4px 24px rgba(0, 255, 65, 0.08)",
  "--kt-noise-opacity": "0.015",
};

/** All available themes */
export const THEMES: ThemeDefinition[] = [
  {
    id: "light",
    label: "浅白",
    icon: "☀️",
    bgClass: "#f5f5f7",
    cssVars: LIGHT_VARS,
  },
  {
    id: "dark",
    label: "暗黑",
    icon: "🌙",
    bgClass: "#0A0A0F",
    cssVars: DARK_VARS,
  },
  {
    id: "warm",
    label: "暖黄",
    icon: "🔥",
    bgClass: "#faf3e6",
    cssVars: WARM_VARS,
  },
  {
    id: "slate",
    label: "墨蓝",
    icon: "💎",
    bgClass: "#1e293b",
    cssVars: SLATE_VARS,
  },
  {
    id: "neon",
    label: "霓虹",
    icon: "💚",
    bgClass: "#0a0a0f",
    cssVars: NEON_VARS,
  },
];

/** Get theme definition by id */
export function getTheme(mode: ThemeMode): ThemeDefinition {
  return THEMES.find((t) => t.id === mode) ?? THEMES[0];
}

/** localStorage key for theme persistence */
export const THEME_STORAGE_KEY = "traceos_experiment_theme";
