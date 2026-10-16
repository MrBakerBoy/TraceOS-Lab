/**
 * AI Chat theme definitions — follows the 5 experiment workspace themes.
 * Each theme ensures WCAG AA contrast (4.5:1 for normal text, 3:1 for large text).
 */
import type { ThemeMode } from "./themes";

export interface ChatThemeColors {
  /** Chat panel background */
  panelBg: string;
  /** Sidebar background */
  sidebarBg: string;
  /** AI message bubble background */
  aiBubbleBg: string;
  /** AI bubble border */
  aiBubbleBorder: string;
  /** User message bubble gradient start */
  userBubbleFrom: string;
  /** User message bubble gradient end */
  userBubbleTo: string;
  /** User bubble text color */
  userBubbleText: string;
  /** Input area background */
  inputBg: string;
  /** Input area border */
  inputBorder: string;
  /** Input area focus border */
  inputFocusBorder: string;
  /** Input placeholder text */
  inputPlaceholder: string;
  /** Header gradient start */
  headerGradientFrom: string;
  /** Header gradient to */
  headerGradientTo: string;
  /** Accent color (used for links, active states) */
  accent: string;
  /** Accent dim (used for hover backgrounds) */
  accentDim: string;
  /** Divider color */
  divider: string;
  /** Primary text */
  textPrimary: string;
  /** Secondary text */
  textSecondary: string;
  /** Tertiary / muted text */
  textTertiary: string;
  /** Hover background for sidebar items */
  sidebarHover: string;
  /** Active background for sidebar items */
  sidebarActiveBg: string;
  /** Active text for sidebar items */
  sidebarActiveText: string;
  /** Code block background */
  codeBlockBg: string;
  /** Inline code background */
  inlineCodeBg: string;
  /** Inline code text */
  inlineCodeText: string;
  /** Send button gradient start */
  sendBtnFrom: string;
  /** Send button gradient to */
  sendBtnTo: string;
}

/** Pre-computed theme colors for all 5 themes */
export const CHAT_THEMES: Record<ThemeMode, ChatThemeColors> = {
  light: {
    panelBg: "#f5f5f7",
    sidebarBg: "#f2f2f5",
    aiBubbleBg: "#ffffff",
    aiBubbleBorder: "rgba(0,0,0,0.06)",
    userBubbleFrom: "#0071e3",
    userBubbleTo: "#3b82f6",
    userBubbleText: "#ffffff",
    inputBg: "#ffffff",
    inputBorder: "rgba(0,0,0,0.08)",
    inputFocusBorder: "rgba(0,113,227,0.4)",
    inputPlaceholder: "rgba(0,0,0,0.24)",
    headerGradientFrom: "rgba(0,113,227,0.04)",
    headerGradientTo: "rgba(139,92,246,0.02)",
    accent: "#0071e3",
    accentDim: "rgba(0,113,227,0.08)",
    divider: "rgba(0,0,0,0.06)",
    textPrimary: "rgba(0,0,0,0.88)",
    textSecondary: "rgba(0,0,0,0.58)",
    textTertiary: "rgba(0,0,0,0.36)",
    sidebarHover: "rgba(0,0,0,0.04)",
    sidebarActiveBg: "rgba(0,113,227,0.08)",
    sidebarActiveText: "#0071e3",
    codeBlockBg: "#eceef2",
    inlineCodeBg: "rgba(0,113,227,0.08)",
    inlineCodeText: "#0058b3",
    sendBtnFrom: "#0071e3",
    sendBtnTo: "#3b82f6",
  },

  dark: {
    panelBg: "#0A0A0F",
    sidebarBg: "#0A0A0F",
    aiBubbleBg: "#18181F",
    aiBubbleBorder: "rgba(255,255,255,0.10)",
    userBubbleFrom: "#00D4FF",
    userBubbleTo: "#6366F1",
    userBubbleText: "#ffffff",
    inputBg: "#14141D",
    inputBorder: "rgba(255,255,255,0.10)",
    inputFocusBorder: "rgba(0,212,255,0.40)",
    inputPlaceholder: "rgba(255,255,255,0.30)",
    headerGradientFrom: "rgba(0,212,255,0.05)",
    headerGradientTo: "rgba(191,90,242,0.03)",
    accent: "#00D4FF",
    accentDim: "rgba(0,212,255,0.12)",
    divider: "rgba(255,255,255,0.10)",
    textPrimary: "#F5F5F7",
    textSecondary: "#B4B4BE",
    textTertiary: "#8D8D97",
    sidebarHover: "rgba(255,255,255,0.05)",
    sidebarActiveBg: "rgba(0,212,255,0.12)",
    sidebarActiveText: "#00D4FF",
    codeBlockBg: "#0f0f17",
    inlineCodeBg: "rgba(0,212,255,0.12)",
    inlineCodeText: "#33DFFF",
    sendBtnFrom: "#00D4FF",
    sendBtnTo: "#6366F1",
  },

  warm: {
    panelBg: "#faf3e6",
    sidebarBg: "#f5eddc",
    aiBubbleBg: "#fdf8f0",
    aiBubbleBorder: "rgba(0,0,0,0.08)",
    userBubbleFrom: "#d97706",
    userBubbleTo: "#f59e0b",
    userBubbleText: "#ffffff",
    inputBg: "#ffffff",
    inputBorder: "rgba(0,0,0,0.1)",
    inputFocusBorder: "rgba(217,119,6,0.4)",
    inputPlaceholder: "rgba(0,0,0,0.2)",
    headerGradientFrom: "rgba(217,119,6,0.06)",
    headerGradientTo: "rgba(168,85,247,0.03)",
    accent: "#d97706",
    accentDim: "rgba(217,119,6,0.08)",
    divider: "rgba(0,0,0,0.08)",
    textPrimary: "#3d3522",
    textSecondary: "#6B6152",
    textTertiary: "#7B715E",
    sidebarHover: "rgba(0,0,0,0.04)",
    sidebarActiveBg: "rgba(217,119,6,0.1)",
    sidebarActiveText: "#b45309",
    codeBlockBg: "#f2e8d8",
    inlineCodeBg: "rgba(217,119,6,0.1)",
    inlineCodeText: "#b45309",
    sendBtnFrom: "#d97706",
    sendBtnTo: "#f59e0b",
  },

  slate: {
    panelBg: "#1a2332",
    sidebarBg: "#1a2332",
    aiBubbleBg: "#2d3a4d",
    aiBubbleBorder: "rgba(255,255,255,0.12)",
    userBubbleFrom: "#38bdf8",
    userBubbleTo: "#818cf8",
    userBubbleText: "#ffffff",
    inputBg: "#0f172a",
    inputBorder: "rgba(255,255,255,0.12)",
    inputFocusBorder: "rgba(56,189,248,0.45)",
    inputPlaceholder: "rgba(255,255,255,0.32)",
    headerGradientFrom: "rgba(56,189,248,0.06)",
    headerGradientTo: "rgba(167,139,250,0.03)",
    accent: "#38bdf8",
    accentDim: "rgba(56,189,248,0.12)",
    divider: "rgba(255,255,255,0.10)",
    textPrimary: "#f1f5f9",
    textSecondary: "#C9D2E0",
    textTertiary: "#9BA6B8",
    sidebarHover: "rgba(255,255,255,0.05)",
    sidebarActiveBg: "rgba(56,189,248,0.12)",
    sidebarActiveText: "#38bdf8",
    codeBlockBg: "#1a2635",
    inlineCodeBg: "rgba(56,189,248,0.14)",
    inlineCodeText: "#56C8FA",
    sendBtnFrom: "#38bdf8",
    sendBtnTo: "#818cf8",
  },

  neon: {
    panelBg: "#0a0a0f",
    sidebarBg: "#0a0a0f",
    aiBubbleBg: "#0d1117",
    aiBubbleBorder: "rgba(0,255,65,0.12)",
    userBubbleFrom: "#00ff41",
    userBubbleTo: "#00cc33",
    userBubbleText: "#0a0a0f",
    inputBg: "#161b22",
    inputBorder: "rgba(0,255,65,0.10)",
    inputFocusBorder: "rgba(0,255,65,0.35)",
    inputPlaceholder: "rgba(230,240,243,0.30)",
    headerGradientFrom: "rgba(0,255,65,0.04)",
    headerGradientTo: "rgba(191,90,242,0.02)",
    accent: "#00ff41",
    accentDim: "rgba(0,255,65,0.10)",
    divider: "rgba(0,255,65,0.10)",
    textPrimary: "#e6edf3",
    textSecondary: "#B9C1CB",
    textTertiary: "#919AA5",
    sidebarHover: "rgba(0,255,65,0.04)",
    sidebarActiveBg: "rgba(0,255,65,0.12)",
    sidebarActiveText: "#00ff41",
    codeBlockBg: "#1a2530",
    inlineCodeBg: "rgba(0,255,65,0.12)",
    inlineCodeText: "#33FF5C",
    sendBtnFrom: "#00ff41",
    sendBtnTo: "#00cc33",
  },
};

/** Get chat theme colors for a given experiment theme mode */
export function getChatTheme(mode: ThemeMode): ChatThemeColors {
  return CHAT_THEMES[mode] ?? CHAT_THEMES.dark;
}