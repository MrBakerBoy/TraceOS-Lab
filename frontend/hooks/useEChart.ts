"use client";

import { useEffect, useRef, useState, DependencyList } from "react";
import * as echarts from "echarts";
import { registerDynamicTheme, getThemeVersion } from "@/lib/setup-echarts";

/**
 * Shared ECharts lifecycle hook with dynamic theme support.
 *
 * Usage:
 *   const chartRef = useEChart(() => ({ ...echartsOption... }), [data, theme]);
 *   return <div ref={chartRef} style={{ width: "100%", height: "100%" }} />;
 *
 * Auto-inits on mount, updates on deps change, resizes on window resize,
 * re-registers the kt-dynamic theme on CSS-variable change, and disposes on unmount.
 */
export function useEChart(
  builder: () => any,
  deps: DependencyList,
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [themeKey, setThemeKey] = useState(0);

  // ── Listen for theme class changes (e.g. .settings-light toggle) ──
  useEffect(() => {
    const html = document.documentElement;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === "class") {
          registerDynamicTheme();
          setThemeKey((k) => k + 1);
          return;
        }
      }
    });
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // ── Init / re-init on theme change ──
  useEffect(() => {
    if (!ref.current) return;

    // Dispose old instance on theme change
    if (chartRef.current) {
      chartRef.current.dispose();
      chartRef.current = null;
    }

    // Re-register theme and init with current CSS vars
    const currentVersion = getThemeVersion();
    if (currentVersion === 0) registerDynamicTheme();
    chartRef.current = echarts.init(ref.current, "kt-dynamic", { renderer: "canvas" });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey]);

  // ── Update options on dep changes ──
  useEffect(() => {
    if (!chartRef.current || !ref.current) return;
    const chart = chartRef.current;
    chart.setOption(builder(), true);

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey, ...deps]);

  // ── Dispose on unmount ──
  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return ref;
}

export type { echarts };
