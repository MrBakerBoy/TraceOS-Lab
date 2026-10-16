"use client";

import React, { useEffect, useRef } from "react";
import { useWorkspaceStore } from "@/stores/workspace";

const SPEEDS = [0.5, 1, 2];

export default function ExecutionReplayBar() {
  const {
    replayActive,
    replayIndex,
    replayTraces,
    replayPlaying,
    replaySpeed,
    seekToIndex,
    togglePlay,
    stopReplay,
    setReplaySpeed,
  } = useWorkspaceStore();

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const traces = replayTraces;
  const total = traces.length;
  const currentTrace = total > 0 ? traces[replayIndex] : null;
  const isAtEnd = replayIndex >= total - 1;

  // Auto-play: advance to next trace by index every 500ms / speed
  useEffect(() => {
    if (!replayPlaying) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const interval = 500 / replaySpeed;
    timerRef.current = setInterval(() => {
      const state = useWorkspaceStore.getState();
      const idx = state.replayIndex;
      const trcs = state.replayTraces;
      if (!trcs.length) {
        useWorkspaceStore.setState({ replayPlaying: false });
        return;
      }
      if (idx >= trcs.length - 1) {
        useWorkspaceStore.setState({ replayPlaying: false });
        return;
      }
      state.seekToIndex(idx + 1);
    }, interval);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [replayPlaying, replaySpeed]);

  // Conditional render AFTER all hooks
  if (!replayActive || total === 0 || !currentTrace) return null;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    seekToIndex(Number(e.target.value));
  };

  const skipToStart = () => seekToIndex(0);
  const skipToEnd = () => seekToIndex(total - 1);

  const btnBase =
    "w-7 h-7 flex items-center justify-center rounded text-[13px] transition-colors ";
  const btnIdle =
    "bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]";
  const playBtn =
    "w-8 h-7 flex items-center justify-center rounded text-[13px] font-bold bg-[var(--accent)] text-white hover:opacity-90";

  return (
    <div
      className="flex items-center gap-2 px-4 h-10 bg-[var(--bg-card)] border-b border-[var(--border-default)] flex-shrink-0 select-none"
      data-testid="execution-replay-bar"
    >
      <button onClick={skipToStart} className={btnBase + btnIdle} title="跳到开头" aria-label="跳到开头">
        ⏮
      </button>

      <button onClick={togglePlay} className={playBtn} title={replayPlaying ? "暂停" : "播放"} aria-label={replayPlaying ? "暂停" : "播放"}>
        {replayPlaying ? "⏸" : "▶"}
      </button>

      <button onClick={skipToEnd} className={btnBase + btnIdle} title="跳到结尾" aria-label="跳到结尾">
        ⏭
      </button>

      <input
        type="range"
        min={0}
        max={total - 1}
        step={1}
        value={replayIndex}
        onChange={handleSliderChange}
        aria-label="回放进度滑块"
        className="flex-1 min-w-[120px] accent-[var(--accent)] cursor-pointer"
      />

      <div className="flex items-center gap-0.5 bg-[var(--bg-input)] rounded-md p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setReplaySpeed(s)}
            className={
              "px-2 h-6 text-[11px] font-medium rounded transition-colors " +
              (replaySpeed === s
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]")
            }
            title={`速度 ${s}x`}
          >
            {s}x
          </button>
        ))}
      </div>

      <span
        className="text-[11px] font-mono text-[var(--text-secondary)] max-w-[200px] truncate"
        title={currentTrace.syscall_name}
      >
        {currentTrace.syscall_name} #{replayIndex + 1}/{total}
      </span>

      <button
        onClick={stopReplay}
        className="w-7 h-7 flex items-center justify-center rounded text-[13px] text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--bg-input)] transition-colors"
        title="退出回放"
        aria-label="退出回放"
      >
        ✕
      </button>
    </div>
  );
}
