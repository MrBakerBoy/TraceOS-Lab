"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/**
 * KT theme tokens read from a container element's computed styles.
 * Follows the same pattern as LivePerfDashboard.readTheme().
 */
export interface EbpfTheme {
  // Categorical slots (mapped to dataviz categorical order)
  cyan: string;
  purple: string;
  green: string;
  amber: string;
  red: string;

  // Ink tokens
  text: string;
  textSec: string;
  textTer: string;

  // Surface tokens
  border: string;
  surface: string;
  bgCard: string;
}

function readFrom(el: HTMLElement | null): EbpfTheme {
  if (typeof getComputedStyle === "undefined") {
    return FALLBACK_THEME;
  }
  const source = el || document.documentElement;
  const c = (name: string, fallback: string): string => {
    const v = getComputedStyle(source).getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    cyan:    c("--kt-cyan",    "#00D4FF"),
    purple:  c("--kt-purple",  "#BF5AF2"),
    green:   c("--kt-green",   "#30D158"),
    amber:   c("--kt-amber",   "#FF9F0A"),
    red:     c("--kt-red",     "#FF453A"),
    text:    c("--kt-text",            "#F5F5F7"),
    textSec: c("--kt-text-secondary",  "#B4B4BE"),
    textTer: c("--kt-text-tertiary",   "#8D8D97"),
    border:  c("--kt-border",          "rgba(255,255,255,0.06)"),
    surface: c("--kt-bg-surface",      "#12121A"),
    bgCard:  c("--kt-bg-elevated",     "#18181F"),
  };
}

const FALLBACK_THEME: EbpfTheme = {
  cyan: "#00D4FF", purple: "#BF5AF2", green: "#30D158",
  amber: "#FF9F0A", red: "#FF453A",
  text: "#F5F5F7", textSec: "#B4B4BE", textTer: "#8D8D97",
  border: "rgba(255,255,255,0.06)", surface: "#12121A", bgCard: "#18181F",
};

/**
 * Hook: read KT theme tokens from a container ref, auto-refresh on theme change.
 *
 * Usage:
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   const theme = useEbpfTheme(containerRef);
 *   // theme.cyan, theme.text, etc. — always up to date
 */
export function useEbpfTheme(
  containerRef: React.RefObject<HTMLElement | null>,
): EbpfTheme {
  const [theme, setTheme] = useState<EbpfTheme>(() =>
    readFrom(containerRef.current),
  );

  const refresh = useCallback(() => {
    setTheme(readFrom(containerRef.current));
  }, [containerRef]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Listen for theme changes (data-theme attribute or class toggle)
  useEffect(() => {
    const observer = new MutationObserver(() => refresh());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => observer.disconnect();
  }, [refresh]);

  return theme;
}

/**
 * Build a categorical palette from theme tokens (4 slots, dataviz order).
 */
export function catPalette(t: EbpfTheme): string[] {
  return [t.cyan, t.amber, t.green, t.purple];
}

/**
 * Build a sequential heatmap ramp from the cyan token.
 * Produces 6 steps: surface → cyan (light→dark).
 */
export function heatPalette(t: EbpfTheme): string[] {
  return [
    t.bgCard,
    t.cyan + "33",
    t.cyan + "66",
    t.cyan + "99",
    t.cyan + "CC",
    t.cyan,
  ];
}
