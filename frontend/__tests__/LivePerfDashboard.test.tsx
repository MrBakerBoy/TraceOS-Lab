/// <reference types="vitest/globals" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ECharts mock: a fresh instance per init, recording every setOption call so
// tests can assert on option shape (theme, series data lengths).
vi.mock("echarts", () => {
  const setOptionCalls: any[] = [];
  const makeInstance = () => ({
    setOption: vi.fn((opt: any) => {
      setOptionCalls.push(opt);
    }),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    dispatchAction: vi.fn(),
  });
  return {
    default: { init: vi.fn(() => makeInstance()) },
    init: vi.fn(() => makeInstance()),
    __setOptionCalls: setOptionCalls,
  };
});

// Mock the workspace store so perfPhase = "running" by default (dashboard visible)
vi.mock("@/stores/workspace", () => ({
  useWorkspaceStore: () => ({
    perfPhase: "running",
    setPerfPhase: vi.fn(),
  }),
}));

import * as echarts from "echarts";
import LivePerfDashboard from "@/components/workspace/panels/LivePerfDashboard";
import type { PerfMetrics } from "@/hooks/usePerfMetrics";

const ZERO: PerfMetrics = {
  timestamp: 0,
  cpu_percent: 0,
  memory_percent: 0,
  ctx_switches_per_sec: 0,
  page_faults_per_sec: 0,
  disk_iops: 0,
  network_rx_bytes: 0,
  network_tx_bytes: 0,
};

function calls(): any[] {
  return (echarts as any).__setOptionCalls as any[];
}

function makeHistory(n: number): PerfMetrics[] {
  return Array.from({ length: n }, (_, i) => ({
    ...ZERO,
    timestamp: i,
    ctx_switches_per_sec: i,
    page_faults_per_sec: i,
    disk_iops: i,
    network_rx_bytes: i * 1000,
    network_tx_bytes: i * 500,
  }));
}

describe("LivePerfDashboard", () => {
  beforeEach(() => {
    calls().length = 0;
  });

  it("renders the dashboard when perfPhase is active", () => {
    render(<LivePerfDashboard submissionId="sub-1" />);
    expect(screen.getByTestId("live-perf-dashboard")).toBeTruthy();
  });

  it("renders collapsed sparkline strip items", () => {
    render(<LivePerfDashboard submissionId="sub-1" />);
    expect(screen.getByTestId("strip-cpu")).toBeTruthy();
    expect(screen.getByTestId("strip-mem")).toBeTruthy();
    expect(screen.getByTestId("strip-ctx")).toBeTruthy();
    expect(screen.getByTestId("strip-disk")).toBeTruthy();
    expect(screen.getByTestId("strip-net")).toBeTruthy();
  });

  it("does not render expanded charts until expanded", () => {
    render(<LivePerfDashboard submissionId="sub-1" />);
    expect(screen.queryByTestId("perf-cpu-gauge")).toBeNull();
  });

  it("renders expanded charts when expand button clicked", () => {
    render(<LivePerfDashboard submissionId="sub-1" />);
    const expandBtn = screen.getByTestId("expand-btn");
    fireEvent.click(expandBtn);
    expect(screen.getByTestId("perf-cpu-gauge")).toBeTruthy();
    expect(screen.getByTestId("perf-mem-gauge")).toBeTruthy();
    expect(screen.getByTestId("perf-ctx-line")).toBeTruthy();
    expect(screen.getByTestId("perf-pagefault-line")).toBeTruthy();
    expect(screen.getByTestId("perf-disk-line")).toBeTruthy();
    expect(screen.getByTestId("perf-network-line")).toBeTruthy();
  });

  it("starts sparkline strip values at 0%", () => {
    render(<LivePerfDashboard submissionId="sub-1" />);
    expect(screen.getByTestId("strip-cpu").textContent).toContain("0.0%");
    expect(screen.getByTestId("strip-mem").textContent).toContain("0.0%");
  });

  it("starts expanded gauge values at 0%", () => {
    render(<LivePerfDashboard submissionId="sub-1" />);
    fireEvent.click(screen.getByTestId("expand-btn"));
    expect(screen.getByTestId("cpu-value").textContent).toBe("0.0%");
    expect(screen.getByTestId("mem-value").textContent).toBe("0.0%");
  });

  it("reflects gauge values in ECharts when expanded", () => {
    render(<LivePerfDashboard submissionId="sub-1" />);
    fireEvent.click(screen.getByTestId("expand-btn"));
    const gauges = calls().filter((o) => o.series?.[0]?.type === "gauge");
    expect(gauges.length).toBe(2);
    expect(gauges[0].series[0].data[0].value).toBe(0);
  });

  it("updates gauge values when new metrics arrive", () => {
    const { rerender } = render(<LivePerfDashboard submissionId="sub-1" />);
    fireEvent.click(screen.getByTestId("expand-btn"));
    expect(screen.getByTestId("cpu-value").textContent).toBe("0.0%");

    rerender(
      <LivePerfDashboard
        submissionId="sub-1"
        initialMetrics={{ cpu_percent: 75.3, memory_percent: 50 }}
      />,
    );

    expect(screen.getByTestId("cpu-value").textContent).toBe("75.3%");
    expect(screen.getByTestId("mem-value").textContent).toBe("50.0%");

    const gauges = calls().filter((o) => o.series?.[0]?.type === "gauge");
    const cpu = gauges.find((o) => o.series[0].data[0].value === 75.3);
    expect(cpu).toBeTruthy();
  });

  it("caps the line-chart buffer at 60 points (evicts oldest)", () => {
    render(<LivePerfDashboard submissionId="sub-1" initialHistory={makeHistory(65)} />);
    fireEvent.click(screen.getByTestId("expand-btn"));

    expect(screen.getByTestId("perf-ctx-line").getAttribute("data-points")).toBe("60");
    expect(screen.getByTestId("perf-network-line").getAttribute("data-points")).toBe("60");

    const lineOpts = calls().filter((o) => o.series?.[0]?.type === "line");
    expect(lineOpts.length).toBeGreaterThan(0);
    for (const o of lineOpts) {
      expect(o.series[0].data.length).toBe(60);
    }
  });

  it("keeps the buffer at 60 when more data would overflow", () => {
    render(<LivePerfDashboard submissionId="sub-1" initialHistory={makeHistory(60)} />);
    fireEvent.click(screen.getByTestId("expand-btn"));
    expect(screen.getByTestId("perf-ctx-line").getAttribute("data-points")).toBe("60");
  });

  it("renders the network chart with two distinguishable lines", () => {
    render(<LivePerfDashboard submissionId="sub-1" initialHistory={makeHistory(10)} />);
    fireEvent.click(screen.getByTestId("expand-btn"));
    const net = calls().find((o) => o.series?.length === 2);
    expect(net).toBeTruthy();
    expect(net.series[0].data.length).toBe(10);
    expect(net.series[1].data.length).toBe(10);
    expect(net.series[0].lineStyle.color).not.toBe(net.series[1].lineStyle.color);
  });

  it("sets backgroundColor to transparent (theme-driven via CSS vars)", () => {
    render(<LivePerfDashboard submissionId="sub-1" />);
    const all = calls();
    expect(all.length).toBeGreaterThan(0);
    for (const o of all) {
      expect(o.backgroundColor).toBe("transparent");
    }
  });
});
