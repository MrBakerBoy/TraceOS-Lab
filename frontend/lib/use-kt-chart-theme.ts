"use client";

import { useMemo, useState, useEffect } from "react";

// ── Types ──

export interface KTChartTokens {
  colors: string[];
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderGap: string;
  bgElevated: string;
  cyan: string;
  cyanDim: string;
  green: string;
  amber: string;
  red: string;
  purple: string;
}

// ── SSR Fallback (dark theme defaults) ──

function getFallbackTokens(): KTChartTokens {
  return {
    colors:            ["#00D4FF", "#30D158", "#FF9F0A", "#FF453A", "#BF5AF2", "#00D4FF"],
    textPrimary:       "#F5F5F7",
    textSecondary:     "#B4B4BE",
    textTertiary:      "#8D8D97",
    border:            "rgba(255,255,255,0.06)",
    borderGap:         "rgba(255,255,255,0.1)",
    bgElevated:        "#18181F",
    cyan:              "#00D4FF",
    cyanDim:           "rgba(0,212,255,0.15)",
    green:             "#30D158",
    amber:             "#FF9F0A",
    red:               "#FF453A",
    purple:            "#BF5AF2",
  };
}

// ── Live CSS Variable Reader ──

function readTokens(): KTChartTokens {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return getFallbackTokens();
  }
  const s = getComputedStyle(document.documentElement);
  const get = (v: string) => s.getPropertyValue(v).trim() || getFallbackTokens()[v as keyof KTChartTokens] as string;

  return {
    colors: [
      get("--kt-cyan"),
      get("--kt-green"),
      get("--kt-amber"),
      get("--kt-red"),
      get("--kt-purple"),
      get("--kt-cyan"),
    ],
    textPrimary:       get("--kt-text"),
    textSecondary:     get("--kt-text-secondary"),
    textTertiary:      get("--kt-text-tertiary"),
    border:            get("--kt-border"),
    borderGap:         get("--kt-border-strong") || "rgba(255,255,255,0.1)",
    bgElevated:        get("--kt-bg-elevated"),
    cyan:              get("--kt-cyan"),
    cyanDim:           get("--kt-cyan-dim"),
    green:             get("--kt-green"),
    amber:             get("--kt-amber"),
    red:               get("--kt-red"),
    purple:            get("--kt-purple"),
  };
}

// ── Hook: Static (read once, no reactivity) ──

/**
 * Read KT design tokens as ECharts-compatible color map.
 * Used for charts that don't need theme-adaptive reactivity.
 *
 * @deprecated Prefer useKTChartThemeReactive() for theme-switching support.
 */
export function useKTChartTheme(): KTChartTokens {
  return useMemo(() => readTokens(), []);
}

// ── Hook: Reactive (re-reads on .settings-light toggle) ──

/**
 * Read KT design tokens AND re-render when theme class changes
 * (e.g. .settings-light toggle). Returns { tokens, themeKey }
 * — include themeKey in React key or useEffect deps to force
 * chart option rebuild.
 */
export function useKTChartThemeReactive(): { tokens: KTChartTokens; themeKey: number } {
  const [key, setKey] = useState(0);
  const tokens = useMemo(() => readTokens(), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const html = document.documentElement;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === "class") {
          setKey((k) => k + 1);
          return;
        }
      }
    });
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return { tokens, themeKey: key };
}

export { getFallbackTokens };
