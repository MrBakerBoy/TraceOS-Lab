/// <reference types="vitest/globals" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("echarts", () => {
  const mockChart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn(), off: vi.fn(), dispatchAction: vi.fn() };
  return { default: { init: vi.fn(() => mockChart) }, init: vi.fn(() => mockChart) };
});

import { useWorkspaceStore } from "@/stores/workspace";
import ExecutionReplayBar from "@/components/workspace/ExecutionReplayBar";
import type { SyscallTrace } from "@/lib/api";

function makeTrace(overrides: Partial<SyscallTrace> = {}): SyscallTrace {
  return { time: "2026-07-26T10:00:00.000Z", submission_id: "sub-1", pid: 100, syscall_name: "read", return_value: 128, error_name: "", duration_ns: 15000, ...overrides };
}

const traces: SyscallTrace[] = [
  makeTrace({ syscall_name: "read", pid: 100 }),
  makeTrace({ syscall_name: "write", pid: 100 }),
  makeTrace({ syscall_name: "fork", pid: 100 }),
  makeTrace({ syscall_name: "open", pid: 101 }),
];

describe("ExecutionReplayBar", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ replayActive: false, replayTimestamp: null, replayTraces: [], replayIndex: 0, replayPlaying: false, replaySpeed: 1 });
  });

  it("renders nothing when replay is not active", () => {
    const { container } = render(<ExecutionReplayBar />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when replayTraces is empty", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: [] });
    const { container } = render(<ExecutionReplayBar />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the replay bar when active with traces", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: traces, replayIndex: 0 });
    render(<ExecutionReplayBar />);
    expect(screen.getByTestId("execution-replay-bar")).toBeTruthy();
  });

  it("shows current syscall name and counter at index 0", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: traces, replayIndex: 0 });
    render(<ExecutionReplayBar />);
    const label = screen.getByTitle("read");
    expect(label.textContent).toContain("read #1/4");
  });

  it("shows second syscall when index is 1", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: traces, replayIndex: 1 });
    render(<ExecutionReplayBar />);
    const label = screen.getByTitle("write");
    expect(label.textContent).toContain("write #2/4");
  });

  it("togglePlay calls store togglePlay", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: traces, replayIndex: 0 });
    render(<ExecutionReplayBar />);
    fireEvent.click(screen.getByLabelText("播放"));
    expect(useWorkspaceStore.getState().replayPlaying).toBe(true);
  });

  it("pause button shows when playing", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: traces, replayIndex: 0, replayPlaying: true });
    render(<ExecutionReplayBar />);
    expect(screen.getByLabelText("暂停")).toBeTruthy();
  });

  it("stop button calls stopReplay", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: traces, replayIndex: 0 });
    render(<ExecutionReplayBar />);
    fireEvent.click(screen.getByLabelText("退出回放"));
    expect(useWorkspaceStore.getState().replayActive).toBe(false);
  });

  it("skip-to-start seeks to index 0", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: traces, replayIndex: 3 });
    render(<ExecutionReplayBar />);
    fireEvent.click(screen.getByLabelText("跳到开头"));
    expect(useWorkspaceStore.getState().replayIndex).toBe(0);
  });

  it("skip-to-end seeks to last index", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: traces, replayIndex: 0 });
    render(<ExecutionReplayBar />);
    fireEvent.click(screen.getByLabelText("跳到结尾"));
    expect(useWorkspaceStore.getState().replayIndex).toBe(3);
  });

  it("renders speed buttons and clicking one changes speed", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: traces, replayIndex: 0 });
    render(<ExecutionReplayBar />);
    fireEvent.click(screen.getByTitle("速度 2x"));
    expect(useWorkspaceStore.getState().replaySpeed).toBe(2);
  });

  it("renders the range slider", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: traces, replayIndex: 0 });
    render(<ExecutionReplayBar />);
    expect(screen.getByLabelText("回放进度滑块")).toBeTruthy();
  });

  it("shows last syscall as active when at end index", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: traces, replayIndex: 3 });
    render(<ExecutionReplayBar />);
    const label = screen.getByTitle("open");
    expect(label.textContent).toContain("open #4/4");
  });

  it("handles single trace gracefully", () => {
    useWorkspaceStore.setState({ replayActive: true, replayTraces: [makeTrace({ syscall_name: "exit" })], replayIndex: 0 });
    render(<ExecutionReplayBar />);
    expect(screen.getByTitle("exit")).toBeTruthy();
  });
});
