"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ShieldAlert, Network, CheckCircle2, XCircle, Play, Pause, RotateCcw, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import { useRaceReport, useDeadlockEvolution } from "@/hooks/useEbpfData";
import { useEbpfChartTheme, severityColor } from "@/hooks/useEbpfChartTheme";
import { EmptyState } from "@/components/ebpf/shared/EmptyState";
import { AIAskButton } from "@/components/ebpf/shared/AIAskButton";
import { Skeleton } from "@/components/ui/skeleton";
import type { RaceResult, DeadlockStep } from "@/types/ebpf";

interface Props {
  submissionId: string;
  experimentId: string;
}

const COFFMAN_LABELS: Record<string, string> = {
  mutual_exclusion: "互斥",
  hold_and_wait: "持有并等待",
  no_preemption: "不可抢占",
  circular_wait: "循环等待",
};

export default function ConcurrencyAnalysisTab({ submissionId, experimentId }: Props) {
  const { data: race, loading: raceLoading, error: raceError } = useRaceReport(submissionId);
  const { data: deadlock, loading: dlLoading, error: dlError } = useDeadlockEvolution(submissionId);
  const chartTheme = useEbpfChartTheme();

  // ── Deadlock replay state ──
  const [replayExpanded, setReplayExpanded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const steps = deadlock?.steps ?? [];
  const hasDeadlock = deadlock?.detected ?? false;

  // Play/pause/reset
  useEffect(() => {
    if (playing && steps.length > 0) {
      timerRef.current = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev >= steps.length - 1) {
            setPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 400);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, steps.length]);

  const handlePlay = useCallback(() => {
    if (currentStep >= steps.length - 1) setCurrentStep(0);
    setPlaying(true);
  }, [currentStep, steps.length]);

  const handlePause = useCallback(() => setPlaying(false), []);
  const handleReset = useCallback(() => { setPlaying(false); setCurrentStep(0); }, []);

  const loading = raceLoading || dlLoading;
  const error = raceError || dlError;

  // ── Loading ──
  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return <EmptyState type="error" description={error} />;
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto kt-scroll">
      {/* ══════ Race + Deadlock cards ══════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Race detection card */}
        <div
          className="rounded-xl border p-4"
          style={{
            borderColor: race?.has_races ? "var(--kt-red)" : "var(--kt-border)",
            backgroundColor: "var(--kt-bg-elevated)",
            borderLeftWidth: "4px",
            borderLeftColor: race?.has_races ? "var(--kt-red)" : race ? "var(--kt-green)" : "var(--kt-border)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert
              className="size-4"
              style={{ color: race?.has_races ? "var(--kt-red)" : "var(--kt-green)" }}
              aria-hidden="true"
            />
            <span className="text-sm font-semibold text-[var(--kt-text)]">数据竞态检测</span>
          </div>

          {race ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="text-center">
                  <div className="text-lg font-bold" style={{ color: race.has_races ? "var(--kt-red)" : "var(--kt-green)" }}>
                    {race.race_summary.total_races}
                  </div>
                  <div className="text-[9px] text-[var(--kt-text-tertiary)]">竞态数量</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-[var(--kt-text)]">{race.thread_count}</div>
                  <div className="text-[9px] text-[var(--kt-text-tertiary)]">线程数</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-[var(--kt-text)]">{race.race_summary.unique_addresses}</div>
                  <div className="text-[9px] text-[var(--kt-text-tertiary)]">访问地址</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-[var(--kt-cyan)]">
                    {(race.race_summary.confidence_score * 100).toFixed(0)}%
                  </div>
                  <div className="text-[9px] text-[var(--kt-text-tertiary)]">置信度</div>
                </div>
              </div>

              {/* Race list */}
              {race.races.length > 0 && (
                <div className="space-y-2 max-h-[200px] overflow-y-auto kt-scroll">
                  {race.races.map((r, i) => (
                    <div
                      key={i}
                      className="rounded-lg p-2.5 text-[11px]"
                      style={{
                        backgroundColor: r.has_hb ? "var(--kt-green-dim)" : "var(--kt-red-dim)",
                        border: `0.5px solid ${r.has_hb ? "var(--kt-green)" : "var(--kt-red)"}30`,
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="font-medium text-[var(--kt-text)]">竞态 #{i + 1}</span>
                        <span className="text-[var(--kt-text-tertiary)]">
                          线程 {r.thread1} ↔ 线程 {r.thread2}
                        </span>
                        <span
                          className="ml-auto text-[10px] px-1 py-0.5 rounded"
                          style={{
                            color: r.has_hb ? "var(--kt-green)" : "var(--kt-red)",
                            backgroundColor: r.has_hb ? "var(--kt-green-dim)" : "var(--kt-red-dim)",
                          }}
                        >
                          {r.has_hb ? "HB成立" : "无HB"}
                        </span>
                      </div>
                      <p className="text-[var(--kt-text-secondary)]">{r.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-[var(--kt-text-tertiary)]">
                          {r.source_file1}:{r.source_line1} vs {r.source_file2}:{r.source_line2}
                        </span>
                        <AIAskButton
                          experimentId={experimentId}
                          variant="icon"
                          context={`数据竞态 #${i + 1}: ${r.description}`}
                          question={r.teaching_hint}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {race.races.length === 0 && (
                <EmptyState type="no-issues" title="未检测到竞态" description="所有内存访问均有正确的同步保护" />
              )}
            </>
          ) : (
            <EmptyState type="no-data" />
          )}
        </div>

        {/* Deadlock detection card */}
        <div
          className="rounded-xl border p-4"
          style={{
            borderColor: hasDeadlock ? "var(--kt-red)" : "var(--kt-border)",
            backgroundColor: "var(--kt-bg-elevated)",
            borderLeftWidth: "4px",
            borderLeftColor: hasDeadlock ? "var(--kt-red)" : deadlock ? "var(--kt-green)" : "var(--kt-border)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Network
              className="size-4"
              style={{ color: hasDeadlock ? "var(--kt-red)" : "var(--kt-green)" }}
              aria-hidden="true"
            />
            <span className="text-sm font-semibold text-[var(--kt-text)]">死锁检测</span>
          </div>

          {deadlock ? (
            <>
              <p className="text-[11px] text-[var(--kt-text-secondary)] mb-3">
                {hasDeadlock ? `检测到死锁，循环涉及 ${deadlock.cycle_nodes?.length ?? 0} 个线程` : "未检测到死锁"}
              </p>

              {/* Coffman conditions */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                {Object.entries(deadlock.coffman_conditions ?? {}).map(([key, satisfied]) => (
                  <div
                    key={key}
                    className="flex items-center gap-1.5 rounded-lg p-2"
                    style={{
                      backgroundColor: satisfied ? "var(--kt-red-dim)" : "var(--kt-bg-elevated)",
                      border: `0.5px solid ${satisfied ? "var(--kt-red)" : "var(--kt-border)"}40`,
                    }}
                  >
                    {satisfied
                      ? <CheckCircle2 className="size-3 text-[var(--kt-red)]" aria-label="满足" />
                      : <XCircle className="size-3 text-[var(--kt-text-tertiary)]" aria-label="不满足" />
                    }
                    <span className="text-[10px] text-[var(--kt-text-secondary)]">{COFFMAN_LABELS[key] || key}</span>
                  </div>
                ))}
              </div>

              {hasDeadlock && steps.length > 0 && (
                <>
                  <p className="text-[11px] text-[var(--kt-text)] font-medium mb-1">
                    循环: {deadlock.cycle_info}
                  </p>
                  <button
                    type="button"
                    onClick={() => setReplayExpanded(!replayExpanded)}
                    className="inline-flex items-center gap-1 text-[11px] text-[var(--kt-cyan)] hover:underline transition-colors"
                  >
                    <ChevronRight
                      className="size-3 transition-transform"
                      style={{ transform: replayExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                    />
                    查看演化步骤
                  </button>
                </>
              )}
            </>
          ) : (
            <EmptyState type="no-data" />
          )}
        </div>
      </div>

      {/* ══════ Deadlock Evolution Replay ══════ */}
      {replayExpanded && hasDeadlock && steps.length > 0 && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="rounded-xl border p-4 overflow-hidden"
          style={{ borderColor: "var(--kt-border)", backgroundColor: "var(--kt-bg-elevated)" }}
        >
          {/* Controls */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-[var(--kt-text)]">死锁演化步骤</span>
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <button
                onClick={playing ? handlePause : handlePlay}
                className="flex items-center justify-center size-7 rounded-md transition-colors hover:bg-[var(--kt-cyan-dim)]"
                style={{ color: "var(--kt-cyan)" }}
                aria-label={playing ? "暂停" : "播放"}
              >
                {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </button>
              <button
                onClick={handleReset}
                className="flex items-center justify-center size-7 rounded-md transition-colors hover:bg-[var(--kt-bg-elevated)]"
                style={{ color: "var(--kt-text-tertiary)" }}
                aria-label="重置"
              >
                <RotateCcw className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Steps timeline */}
          <div className="space-y-1 max-h-[300px] overflow-y-auto kt-scroll mb-3">
            {steps.map((step, i) => {
              const isCurrent = i === currentStep;
              const isPast = i < currentStep;
              const isDeadlockStep = step.action === "wait" && i >= steps.length - 1 && hasDeadlock;

              return (
                <motion.div
                  key={i}
                  animate={{
                    backgroundColor: isCurrent ? "var(--kt-cyan-dim)" : isPast ? "transparent" : "transparent",
                    opacity: isPast && !isCurrent ? 0.5 : 1,
                  }}
                  className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[11px]"
                  style={{
                    borderLeft: isCurrent ? "2px solid var(--kt-cyan)" : "2px solid transparent",
                  }}
                >
                  <span className="text-[10px] font-mono text-[var(--kt-text-tertiary)] w-6 text-right flex-shrink-0">
                    {step.order}
                  </span>
                  <span
                    className="font-medium"
                    style={{
                      color: isDeadlockStep ? "var(--kt-red)" : isCurrent ? "var(--kt-cyan)" : "var(--kt-text)",
                    }}
                  >
                    {step.description}
                  </span>
                  {isCurrent && (
                    <span className="text-[9px] text-[var(--kt-cyan)] ml-auto animate-pulse">◀ 当前</span>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Teaching narrative */}
          {deadlock.teaching_narrative && (
            <div
              className="rounded-lg p-3"
              style={{ backgroundColor: "var(--kt-purple-dim)", border: "0.5px solid var(--kt-purple)30" }}
            >
              <p className="text-xs font-medium text-[var(--kt-purple)] mb-1">教学提示</p>
              <p className="text-[11px] text-[var(--kt-text-secondary)] leading-relaxed whitespace-pre-wrap">
                {deadlock.teaching_narrative}
              </p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}