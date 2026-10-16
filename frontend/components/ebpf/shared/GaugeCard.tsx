"use client";

import React, { useEffect, useRef } from "react";
import * as echarts from "echarts";
import "@/lib/setup-echarts";
import { cn } from "@/lib/utils";
import { useEbpfChartTheme } from "@/hooks/useEbpfChartTheme";

export interface GaugeCardProps {
  title: string;
  value: number;           // 0-100
  unit?: string;
  colorStops?: [number, string][];  // e.g. [[0.3, "green"], [0.7, "amber"], [1, "red"]]
  subtitle?: string;
  className?: string;
}

export function GaugeCard({
  title, value, unit = "%", colorStops, subtitle, className,
}: GaugeCardProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartTheme = useEbpfChartTheme();

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = echarts.init(chartRef.current, "kt-dynamic");
    const clampedValue = Math.max(0, Math.min(100, value));

    const defaultStops: [number, string][] = colorStops || [
      [0.5, chartTheme.green],
      [0.8, chartTheme.amber],
      [1, chartTheme.red],
    ];

    chart.setOption({
      series: [{
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        center: ["50%", "58%"],
        radius: "80%",
        min: 0,
        max: 100,
        splitNumber: 10,
        axisLine: {
          show: true,
          lineStyle: {
            width: 12,
            color: defaultStops,
          },
        },
        pointer: {
          icon: `path://M12.8,0.7l12,40.1H0.7L12.8,0.7z`,
          length: "60%",
          width: 6,
          offsetCenter: [0, "-10%"],
          itemStyle: {
            color: chartTheme.text,
          },
        },
        axisTick: {
          length: 8,
          lineStyle: { color: "auto", width: 1 },
        },
        splitLine: {
          length: 16,
          lineStyle: { color: "auto", width: 2 },
        },
        axisLabel: {
          color: chartTheme.textSecondary,
          fontSize: 10,
          distance: -30,
          formatter: (v: number) => `${v}`,
        },
        title: {
          offsetCenter: [0, "80%"],
          fontSize: 12,
          color: chartTheme.textSecondary,
        },
        detail: {
          valueAnimation: true,
          formatter: (v: number) => `${v.toFixed(1)}${unit}`,
          color: chartTheme.text,
          fontSize: 20,
          fontWeight: "bold",
          offsetCenter: [0, "35%"],
        },
        data: [{ value: clampedValue, name: title }],
      }],
    }, true);

    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
    };
  }, [value, title, unit, chartTheme, colorStops]);

  return (
    <div
      className={cn("flex flex-col rounded-lg border p-3", className)}
      style={{
        borderColor: "var(--kt-border)",
        backgroundColor: "var(--kt-bg-surface)",
      }}
    >
      <div ref={chartRef} className="flex-1 min-h-0" style={{ height: 160 }} />
      {subtitle && (
        <p className="text-[10px] text-center text-[var(--kt-text-tertiary)] mt-1 -mb-1">
          {subtitle}
        </p>
      )}
    </div>
  );
}