import * as echarts from 'echarts';

// ── Read CSS variable or fallback ─────────────────────────────────────
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// ── Build ECharts theme from CSS variables ────────────────────────────
function buildTheme() {
  const cyan = cssVar("--kt-cyan", "#00D4FF");
  const green = cssVar("--kt-green", "#30D158");
  const amber = cssVar("--kt-amber", "#FF9F0A");
  const red = cssVar("--kt-red", "#FF453A");
  const purple = cssVar("--kt-purple", "#BF5AF2");
  const text = cssVar("--kt-text", "#F5F5F7");
  const textSec = cssVar("--kt-text-secondary", "#B4B4BE");
  const textTer = cssVar("--kt-text-tertiary", "#8D8D97");
  const border = cssVar("--kt-border", "rgba(255,255,255,0.06)");
  const borderStrong = cssVar("--kt-border-strong", "rgba(255,255,255,0.12)");
  const bgElevated = cssVar("--kt-bg-elevated", "#18181F");
  const bgSurface = cssVar("--kt-bg-surface", "#0F0F15");

  return {
    color: [cyan, green, amber, red, purple, cyan],
    backgroundColor: "transparent",
    textStyle: {},
    title: {
      textStyle: { color: text },
      subtextStyle: { color: textSec },
    },
    line: {
      itemStyle: { borderWidth: 2 },
      lineStyle: { width: 2 },
      symbolSize: 6,
      symbol: "circle",
      smooth: true,
    },
    radar: {
      itemStyle: { borderWidth: 2 },
      lineStyle: { width: 2 },
      symbolSize: 6,
      symbol: "circle",
      smooth: true,
    },
    bar: {
      itemStyle: { barBorderWidth: 0, barBorderColor: bgSurface },
    },
    pie: {
      itemStyle: { borderWidth: 0, borderColor: bgSurface },
    },
    scatter: {
      itemStyle: { borderWidth: 0, borderColor: bgSurface },
    },
    boxplot: {
      itemStyle: { borderWidth: 0, borderColor: bgSurface },
    },
    parallel: {
      itemStyle: { borderWidth: 0, borderColor: bgSurface },
    },
    sankey: {
      itemStyle: { borderWidth: 0, borderColor: bgSurface },
    },
    funnel: {
      itemStyle: { borderWidth: 0, borderColor: bgSurface },
    },
    gauge: {
      itemStyle: { borderWidth: 0, borderColor: bgSurface },
    },
    candlestick: {
      itemStyle: {
        color: red, color0: green,
        borderColor: red, borderColor0: green, borderWidth: 1,
      },
    },
    graph: {
      itemStyle: { borderWidth: 0, borderColor: bgSurface },
      lineStyle: { width: 1, color: borderStrong },
      symbolSize: 6, symbol: "circle", smooth: false,
      color: [cyan, green, amber, red],
      label: { color: textSec },
    },
    map: {
      itemStyle: { areaColor: bgElevated, borderColor: borderStrong, borderWidth: 0.5 },
      label: { color: textSec },
      emphasis: {
        itemStyle: { areaColor: cyan + "40" },
        label: { color: text },
      },
    },
    geo: {
      itemStyle: { areaColor: bgElevated, borderColor: borderStrong, borderWidth: 0.5 },
      label: { color: textSec },
      emphasis: {
        itemStyle: { areaColor: cyan + "40" },
        label: { color: text },
      },
    },
    categoryAxis: {
      axisLine: { show: true, lineStyle: { color: borderStrong } },
      axisTick: { show: false },
      axisLabel: { color: textSec },
      splitLine: { show: false, lineStyle: { color: [bgElevated] } },
      splitArea: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textSec },
      splitLine: { show: true, lineStyle: { color: [border, border], type: "dashed" } },
      splitArea: { show: false },
    },
    logAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textSec },
      splitLine: { show: true, lineStyle: { color: [border], type: "dashed" } },
      splitArea: { show: false },
    },
    timeAxis: {
      axisLine: { show: true, lineStyle: { color: borderStrong } },
      axisTick: { show: false },
      axisLabel: { color: textSec },
      splitLine: { show: false },
      splitArea: { show: false },
    },
    toolbox: {
      iconStyle: { borderColor: textSec },
      emphasis: { iconStyle: { borderColor: text } },
    },
    legend: { textStyle: { color: textSec } },
    tooltip: {
      axisPointer: {
        lineStyle: { color: borderStrong, width: 1 },
        crossStyle: { color: borderStrong, width: 1 },
      },
    },
    timeline: {
      lineStyle: { color: borderStrong },
      itemStyle: { color: cyan },
      controlStyle: { color: textSec, borderColor: borderStrong },
    },
    visualMap: {
      color: [cyan + "80", cyan, cyan],
    },
    dataZoom: {
      backgroundColor: bgElevated + "99",
      dataBackground: {
        areaStyle: { color: borderStrong },
        lineStyle: { color: borderStrong },
      },
      selectedDataBackground: {
        areaStyle: { color: cyan },
        lineStyle: { color: cyan },
      },
      textStyle: { color: textSec },
      handleStyle: { color: textTer },
    },
    markPoint: {
      label: { color: text },
      emphasis: { label: { color: text } },
    },
  };
}

// ── Public API ─────────────────────────────────────────────────────────

let _themeVersion = 0;

/**
 * Register (or re-register) the kt-dynamic ECharts theme with current CSS variables.
 * Returns a version number that increments on each call — use as a React key
 * to force chart re-initialization when the theme changes.
 */
export function registerDynamicTheme(): number {
  _themeVersion++;
  const theme = buildTheme();
  echarts.registerTheme("kt-dynamic", theme);
  return _themeVersion;
}

/** Get the current theme version (for React deps tracking). */
export function getThemeVersion(): number {
  return _themeVersion;
}


// Auto-register on first import
registerDynamicTheme();

export type { echarts };
