/// <reference types="vitest/globals" />
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("echarts", () => {
  const mockChart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn(), off: vi.fn(), dispatchAction: vi.fn() };
  return { default: { init: vi.fn(() => mockChart) }, init: vi.fn(() => mockChart) };
});

import WaterfallTimeline from "@/components/workspace/panels/WaterfallTimeline";

const mockTraces = [
  { time: "2026-07-26T10:00:00.000Z", submission_id: "sub-1", pid: 100, syscall_name: "read", return_value: 128, error_name: "", duration_ns: 15000 },
  { time: "2026-07-26T10:00:00.001Z", submission_id: "sub-1", pid: 100, syscall_name: "write", return_value: 64, error_name: "", duration_ns: 8000 },
  { time: "2026-07-26T10:00:00.002Z", submission_id: "sub-1", pid: 101, syscall_name: "fork", return_value: 101, error_name: "", duration_ns: 500000 },
  { time: "2026-07-26T10:00:00.003Z", submission_id: "sub-1", pid: 100, syscall_name: "open", return_value: -1, error_name: "ENOENT", duration_ns: 12000 },
];

describe("WaterfallTimeline", () => {
  it("renders chart container with trace data", () => {
    const { container } = render(<WaterfallTimeline traces={mockTraces} />);
    expect(container.firstChild).toBeTruthy();
  });

  it("handles empty traces array gracefully", () => {
    render(<WaterfallTimeline traces={[]} />);
    expect(screen.getByText("暂无系统调用追踪数据")).toBeTruthy();
  });

  it("renders legend categories", () => {
    render(<WaterfallTimeline traces={mockTraces} />);
    expect(screen.getByText("文件I/O")).toBeTruthy();
    expect(screen.getByText("进程")).toBeTruthy();
    expect(screen.getByText("内存")).toBeTruthy();
  });

  it("renders swimlane count", () => {
    render(<WaterfallTimeline traces={mockTraces} />);
    expect(screen.getByText("泳道")).toBeTruthy();
  });

  it("renders call count", () => {
    render(<WaterfallTimeline traces={mockTraces} />);
    expect(screen.getByText("调用")).toBeTruthy();
  });

  it("renders interaction hints", () => {
    render(<WaterfallTimeline traces={mockTraces} />);
    expect(screen.getByText(/点击缩放/)).toBeTruthy();
  });
});
