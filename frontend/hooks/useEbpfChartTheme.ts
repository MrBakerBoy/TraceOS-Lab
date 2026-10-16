"use client";

import { useMemo } from "react";
import { cssVar } from "@/lib/utils";

export interface EbpfChartTheme {
  cyan: string;
  green: string;
  amber: string;
  red: string;
  purple: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderStrong: string;
  bgSurface: string;
  bgElevated: string;
}

function readTheme(): EbpfChartTheme {
  return {
    cyan:           cssVar("--kt-cyan", "#00D4FF"),
    green:          cssVar("--kt-green", "#30D158"),
    amber:          cssVar("--kt-amber", "#FF9F0A"),
    red:            cssVar("--kt-red", "#FF453A"),
    purple:         cssVar("--kt-purple", "#BF5AF2"),
    text:           cssVar("--kt-text", "#F5F5F7"),
    textSecondary:  cssVar("--kt-text-secondary", "#B4B4BE"),
    textTertiary:   cssVar("--kt-text-tertiary", "#8D8D97"),
    border:         cssVar("--kt-border", "rgba(255,255,255,0.10)"),
    borderStrong:   cssVar("--kt-border-strong", "rgba(255,255,255,0.16)"),
    bgSurface:      cssVar("--kt-bg-surface", "#12121A"),
    bgElevated:     cssVar("--kt-bg-elevated", "#18181F"),
  };
}

export function useEbpfChartTheme(): EbpfChartTheme {
  const theme = useMemo(() => readTheme(), []);
  return theme;
}

/** Syscall category palette: [io, mem, sync, proc] */
export function catPalette(theme: EbpfChartTheme): string[] {
  return [theme.cyan, theme.amber, theme.green, theme.purple];
}

/** Heat palette for severity: [low, medium, high, critical] */
export function heatPalette(theme: EbpfChartTheme): string[] {
  return [theme.green, theme.amber, theme.red, theme.purple];
}

/** Status color mapping */
export function statusColor(status: string, theme: EbpfChartTheme): string {
  switch (status) {
    case "healthy":   return theme.green;
    case "warning":   return theme.amber;
    case "critical":  return theme.red;
    default:          return theme.textTertiary;
  }
}

/** Get a readable color for a severity level */
export function severityColor(severity: string, theme: EbpfChartTheme): string {
  switch (severity) {
    case "definitely":  return theme.red;
    case "indirectly":  return theme.amber;
    case "possibly":    return theme.purple;
    case "reachable":   return theme.textTertiary;
    default:            return theme.textTertiary;
  }
}

/**
 * Returns a version number that changes when theme CSS vars change.
 * Use as a React key to force chart re-initialization.
 */
let _version = 0;
export function getChartThemeVersion(): number {
  return _version;
}

// Listen for theme changes and bump version
if (typeof window !== "undefined" && typeof MutationObserver !== "undefined") {
  const observer = new MutationObserver(() => {
    _version++;
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });
}