/// <reference types="vitest/globals" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("echarts", () => {
  const mockChart = {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    dispatchAction: vi.fn(),
  };
  const init = vi.fn(() => mockChart);
  (globalThis as any).__ECHARTS_MOCK_CHART = mockChart;
  return {
    default: { init },
    init,
  };
});

// jsdom does not provide ResizeObserver; supply a no-op polyfill.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = MockResizeObserver;

// Capture EventSource instances so tests can push SSE messages.
const esInstances: any[] = [];
class MockEventSource {
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  url: string;
  constructor(url: string) {
    this.url = url;
    esInstances.push(this);
  }
  close = vi.fn();
}
(globalThis as any).EventSource = MockEventSource;

import DeadlockGraph from "@/components/workspace/DeadlockGraph";

function mockChart() {
  return (globalThis as any).__ECHARTS_MOCK_CHART;
}

function pushMessage(msg: any) {
  act(() => {
    esInstances.forEach((es) => es.onmessage && es.onmessage({ data: JSON.stringify(msg) }));
  });
}

function lastSeries() {
  const calls = mockChart().setOption.mock.calls;
  const option = calls[calls.length - 1][0];
  return option.series[0];
}

const graphPayload = {
  threads: [{ tid: 1 }, { tid: 2 }],
  locks: [
    { uaddr: "0xdeadbeef1111", holder: 1, waiters: [2] },
    { uaddr: "0xdeadbeef2222", holder: 2, waiters: [1] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  esInstances.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("DeadlockGraph", () => {
  it("renders the panel header when a pid is provided", () => {
    render(<DeadlockGraph pid={1} />);
    expect(screen.getByText("🔒 锁依赖图")).toBeTruthy();
  });

  it("renders nothing when pid is null", () => {
    const { container } = render(<DeadlockGraph pid={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders thread and lock nodes from a graph SSE message", () => {
    render(<DeadlockGraph pid={1} />);
    pushMessage({ type: "graph", payload: graphPayload });

    const data = lastSeries().data;
    const t1 = data.find((n: any) => n.id === "t1");
    const l1 = data.find((n: any) => n.id === "l0xdeadbeef1111");
    expect(t1).toBeTruthy();
    expect(l1).toBeTruthy();
    // Links present for both holder and waiter relationships.
    const links: any[] = lastSeries().links;
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it("uses circles for processes and rects for resources (RAG shapes)", () => {
    render(<DeadlockGraph pid={1} />);
    pushMessage({ type: "graph", payload: graphPayload });

    const data: any[] = lastSeries().data;
    const thread = data.find((n: any) => n.id === "t1");
    const lock = data.find((n: any) => n.id === "l0xdeadbeef1111");
    expect(thread.symbol).toBe("circle");
    expect(thread.itemStyle.color).toBe("#3b82f6");
    expect(lock.symbol).toBe("rect");
    expect(lock.itemStyle.color).toBe("#f59e0b");
  });

  it("distinguishes solid holder edges from dashed waiter edges", () => {
    render(<DeadlockGraph pid={1} />);
    pushMessage({ type: "graph", payload: graphPayload });

    const links: any[] = lastSeries().links;
    const holder = links.find(
      (l) => l.source === "t1" && l.target === "l0xdeadbeef1111"
    );
    const waiter = links.find(
      (l) => l.source === "t2" && l.target === "l0xdeadbeef1111"
    );
    expect(holder).toBeTruthy();
    expect(holder.label.formatter).toBe("持有");
    expect(holder.lineStyle.color).toBe("#3b82f6");
    expect(holder.lineStyle.type).toBeUndefined();
    expect(waiter).toBeTruthy();
    expect(waiter.label.formatter).toBe("等待");
    expect(waiter.lineStyle.color).toBe("#ef4444");
    expect(waiter.lineStyle.type).toBe("dashed");
  });

  it("shows the deadlock alert bar after a detected cycle", () => {
    render(<DeadlockGraph pid={1} />);
    pushMessage({ type: "graph", payload: graphPayload });
    pushMessage({
      type: "deadlock",
      payload: { detected: true, cycle: [1, 2], details: [], fix: "acquire locks in order" },
    });

    expect(screen.getByText(/检测到死锁环/)).toBeTruthy();
    // The dynamically-built path should include both threads.
    expect(screen.getByText(/T1.*T2/)).toBeTruthy();
  });

  it("highlights cycle nodes via dispatchAction on deadlock", () => {
    render(<DeadlockGraph pid={1} />);
    pushMessage({ type: "graph", payload: graphPayload });
    pushMessage({
      type: "deadlock",
      payload: { detected: true, cycle: [1, 2] },
    });

    const calls = mockChart().dispatchAction.mock.calls;
    const highlights = calls.filter((c: any[]) => c[0]?.type === "highlight");
    expect(highlights.length).toBeGreaterThan(0);
  });

  it("does not highlight when no deadlock is detected", () => {
    render(<DeadlockGraph pid={1} />);
    pushMessage({ type: "graph", payload: graphPayload });

    const calls = mockChart().dispatchAction.mock.calls;
    const highlights = calls.filter((c: any[]) => c[0]?.type === "highlight");
    expect(highlights.length).toBe(0);
  });
});
