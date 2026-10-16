/// <reference types="vitest/globals" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ── Mocks for the 3D stack (jsdom has no WebGL) ──────────────────────────────
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: any) => <div data-testid="memory-canvas">{children}</div>,
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: (props: any) => <div data-testid="orbit-controls" data-target={JSON.stringify(props.target)} />,
  Text: ({ children }: any) => <div data-testid="seg-label">{children}</div>,
  Html: ({ children }: any) => <div data-testid="html-overlay">{children}</div>,
}));

vi.mock("@react-spring/three", () => {
  const passthrough = (Tag: string) => (props: any) =>
    React.createElement(Tag, props);
  const animated = new Proxy({}, { get: (_t, key: string) => passthrough(key) });
  return {
    useSpring: vi.fn((cfg: any) => {
      // Return plain numeric values derived from the spring config target.
      const out: Record<string, number> = {};
      if (cfg && typeof cfg === "object") {
        for (const k of Object.keys(cfg)) {
          if (k === "config") continue;
          const v = (cfg as any)[k];
          out[k] = typeof v === "number" ? v : 0;
        }
      }
      return out;
    }),
    animated,
  };
});

// Stub the workspace store so the component's store subscription works in tests.
vi.mock("@/stores/workspace", () => ({
  useWorkspaceStore: (sel: any) =>
    sel({ replayTimestamp: null }),
}));

import { api } from "@/lib/api";
import MemoryLayout3D from "@/components/workspace/panels/MemoryLayout3D";

const mockSnapshots = [
  {
    timestamp: "2026-07-27T10:00:00.000Z",
    text_start: 0x400000, text_size: 4096,
    data_start: 0x601000, data_size: 2048,
    bss_start: 0x602000, bss_size: 1024,
    heap_start: 0x603000, heap_size: 4096,
    stack_start: 0x7fff0000, stack_size: 8388608,
    mmap_regions: [
      { start: 0x7f000000, size: 4096, perms: "r-xp", path: "/lib/libc.so" },
      { start: 0x7f100000, size: 8192, perms: "rw-p", path: "/lib/libm.so" },
    ],
  },
  {
    timestamp: "2026-07-27T10:00:01.000Z",
    text_start: 0x400000, text_size: 4096,
    data_start: 0x601000, data_size: 2048,
    bss_start: 0x602000, bss_size: 1024,
    heap_start: 0x603000, heap_size: 16384, // brk grew the heap
    stack_start: 0x7fff0000, stack_size: 8388608,
    mmap_regions: [
      { start: 0x7f000000, size: 4096, perms: "r-xp", path: "/lib/libc.so" },
    ],
  },
];

describe("MemoryLayout3D", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the 3D canvas with segment boxes when data is present", async () => {
    const spy = vi.spyOn(api, "getMemoryLayout").mockResolvedValue({
      submission_id: "sub-1",
      snapshots: mockSnapshots,
    });

    render(<MemoryLayout3D submissionId="sub-1" />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("memory-canvas")).toBeTruthy(),
    );

    // 5 core segments (Text, Data, BSS, Heap, Stack) + 2 mmap regions at t0 = 7 labels
    const labels = screen.getAllByTestId("seg-label");
    expect(labels.length).toBe(7);
  });

  it("shows empty-data message when snapshots is empty", async () => {
    vi.spyOn(api, "getMemoryLayout").mockResolvedValue({
      submission_id: "sub-2",
      snapshots: [],
    });

    render(<MemoryLayout3D submissionId="sub-2" />);

    await waitFor(() => expect(screen.getByText(/无内存布局快照/)).toBeTruthy());
    expect(screen.queryByTestId("memory-canvas")).toBeNull();
  });

  it("shows a loading state before data resolves", () => {
    vi.spyOn(api, "getMemoryLayout").mockReturnValue(new Promise(() => {}));
    render(<MemoryLayout3D submissionId="sub-3" />);
    expect(screen.getByText("加载内存地图...")).toBeTruthy();
  });

  it("renders the fixed color legend", async () => {
    vi.spyOn(api, "getMemoryLayout").mockResolvedValue({
      submission_id: "sub-4",
      snapshots: mockSnapshots,
    });

    render(<MemoryLayout3D submissionId="sub-4" />);

    await waitFor(() => expect(screen.getByText("内存段图例")).toBeTruthy());
    const items = screen.getAllByTestId("legend-item");
    // Text, Data, BSS, Heap, mmap, Stack = 6 legend entries
    expect(items.length).toBe(6);
  });

  it("calls the memory-layout API with the submission id", async () => {
    const spy = vi.spyOn(api, "getMemoryLayout").mockResolvedValue({
      submission_id: "sub-5",
      snapshots: mockSnapshots,
    });

    render(<MemoryLayout3D submissionId="sub-5" />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("sub-5"));
  });

  it("renders mmap region labels with their path", async () => {
    vi.spyOn(api, "getMemoryLayout").mockResolvedValue({
      submission_id: "sub-6",
      snapshots: mockSnapshots,
    });

    render(<MemoryLayout3D submissionId="sub-6" />);

    await waitFor(() =>
      expect(screen.getByText(/libc\.so/)).toBeTruthy(),
    );
  });
});
