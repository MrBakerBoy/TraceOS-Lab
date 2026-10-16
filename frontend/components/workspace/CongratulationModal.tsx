"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import confetti from "canvas-confetti";
import { Check, X, Clock, FileCode, ChevronRight, ListOrdered, Gauge, Layers } from "lucide-react";
import { api } from "@/lib/api";
import type { EvalResult } from "@/types/workspace";

interface Experiment {
  id: string;
  name: string;
  title: string;
  category: string;
  difficulty: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onViewDetails: () => void;
  experimentTitle: string;
  experimentId: string;
  courseId?: string;
  evalResult: EvalResult;
}

type NavMode = "order" | "difficulty" | "category";

const CATEGORY_ORDER = ["process", "thread", "memory", "fs", "scheduler", "deadlock"];
const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

const NAV_OPTIONS: { mode: NavMode; label: string; icon: typeof ListOrdered }[] = [
  { mode: "order", label: "按顺序", icon: ListOrdered },
  { mode: "difficulty", label: "按难度", icon: Gauge },
  { mode: "category", label: "按类型", icon: Layers },
];

export default function CongratulationModal({
  open,
  onClose,
  onViewDetails,
  experimentTitle,
  experimentId,
  courseId,
  evalResult,
}: Props) {
  const confettiFired = useRef(false);
  const router = useRouter();
  const [navMode, setNavMode] = useState<NavMode>("order");
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loadingNext, setLoadingNext] = useState(false);

  // Load experiments for navigation
  useEffect(() => {
    if (!open || !experimentId) return;
    setLoadingNext(true);
    api.getExperiments({})
      .then((res: any) => setExperiments(res.data || []))
      .catch(() => setExperiments([]))
      .finally(() => setLoadingNext(false));
  }, [open, experimentId]);

  // Determine next experiment based on navMode
  const nextExperiment = useMemo(() => {
    if (experiments.length === 0) return null;

    const current = experiments.find(e => e.id === experimentId);
    if (!current) return null;

    let sorted: Experiment[];

    switch (navMode) {
      case "difficulty":
        sorted = [...experiments].sort((a, b) => {
          const da = DIFFICULTY_ORDER[a.difficulty] ?? 0;
          const db = DIFFICULTY_ORDER[b.difficulty] ?? 0;
          if (da !== db) return da - db;
          const ca = CATEGORY_ORDER.indexOf(a.category);
          const cb = CATEGORY_ORDER.indexOf(b.category);
          return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb);
        });
        break;
      case "category":
        sorted = [...experiments].sort((a, b) => {
          const ca = CATEGORY_ORDER.indexOf(a.category);
          const cb = CATEGORY_ORDER.indexOf(b.category);
          return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb);
        });
        break;
      default: // order — same category, creation order
        sorted = experiments.filter(e => e.category === current.category);
        break;
    }

    const idx = sorted.findIndex(e => e.id === experimentId);
    if (idx >= 0 && idx < sorted.length - 1) {
      return sorted[idx + 1];
    }
    return null;
  }, [experiments, experimentId, navMode]);

  const handleContinue = useCallback(() => {
    onClose();
    if (nextExperiment) {
      router.push(`/experiments/${nextExperiment.id}`);
    } else {
      router.push("/experiments");
    }
  }, [onClose, router, nextExperiment]);

  useEffect(() => {
    if (open && !confettiFired.current) {
      confettiFired.current = true;

      // Top burst — rains down over entire viewport
      confetti({
        particleCount: 100,
        spread: 120,
        origin: { x: 0.5, y: 0.15 },
        colors: ["#22c55e", "#16a34a", "#15803d", "#fbbf24", "#f59e0b", "#a3e635", "#84cc16"],
        zIndex: 999,
        gravity: 0.8,
      });

      // Left cannon
      setTimeout(() => {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { x: 0.15, y: 0.6 },
          colors: ["#22c55e", "#16a34a", "#15803d", "#fbbf24", "#f59e0b"],
          zIndex: 999,
          angle: 60,
        });
      }, 100);

      // Right cannon
      setTimeout(() => {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { x: 0.85, y: 0.6 },
          colors: ["#22c55e", "#16a34a", "#15803d", "#fbbf24", "#f59e0b"],
          zIndex: 999,
          angle: 120,
        });
      }, 200);

      // Center shower
      setTimeout(() => {
        confetti({
          particleCount: 60,
          spread: 140,
          origin: { x: 0.5, y: 0.35 },
          colors: ["#fbbf24", "#f59e0b", "#22c55e", "#a3e635"],
          zIndex: 999,
          gravity: 0.6,
          scalar: 0.8,
        });
      }, 350);
    }

    return () => {
      confettiFired.current = false;
    };
  }, [open]);

  if (!open) return null;

  const pct =
    evalResult.total_score && evalResult.total_score > 0
      ? Math.round(
          ((evalResult.score || 0) / evalResult.total_score) * 100
        )
      : 0;

  const passedTests = evalResult.passed_test_cases ?? 0;
  const totalTests = evalResult.total_test_cases ?? 0;
  const execTime = evalResult.execution_time;

  // Ring progress calculation
  const circumference = 2 * Math.PI * 42;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal card */}
      <div className="relative z-10 mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-[var(--kt-bg-surface)] shadow-2xl animate-in fade-in zoom-in-95 duration-300">
        {/* Green gradient header */}
        <div className="relative flex flex-col items-center bg-gradient-to-b from-emerald-500 to-green-600 px-6 pb-8 pt-8">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-3 top-3 rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>

          {/* Animated checkmark circle */}
          <div className="relative mb-3">
            <div className="flex size-20 items-center justify-center rounded-full bg-white/20">
              <div className="flex size-16 items-center justify-center rounded-full bg-white animate-bounce-in">
                <Check className="size-8 text-green-600" strokeWidth={3} />
              </div>
            </div>
          </div>

          <h2 className="mb-1 text-xl font-bold text-white">恭喜通关！</h2>
          <p className="text-center text-sm text-white/80">
            {experimentTitle}
          </p>
        </div>

        {/* Score section */}
        <div className="px-6 py-6">
          {/* Ring progress */}
          <div className="mb-4 flex justify-center">
            <div className="relative size-28">
              <svg
                className="size-28 -rotate-90"
                viewBox="0 0 100 100"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--kt-bg-elevated)"
                  strokeWidth="6"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="url(#gradeGradient)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-1000 ease-out"
                />
                <defs>
                  <linearGradient
                    id="gradeGradient"
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="0%"
                  >
                    <stop offset="0%" stopColor="#22c55e" />
                    <stop offset="100%" stopColor="#16a34a" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-[var(--kt-text)]">
                  {pct}
                </span>
                <span className="ml-0.5 text-sm text-[var(--kt-text-tertiary)]">
                  分
                </span>
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 rounded-lg bg-[var(--kt-bg-elevated)] px-3 py-2.5">
              <FileCode className="size-4 flex-shrink-0 text-emerald-500" />
              <div>
                <div className="text-xs text-[var(--kt-text-tertiary)]">
                  测试用例
                </div>
                <div className="text-sm font-semibold text-[var(--kt-text)]">
                  {passedTests}/{totalTests} 通过
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-[var(--kt-bg-elevated)] px-3 py-2.5">
              <Clock className="size-4 flex-shrink-0 text-emerald-500" />
              <div>
                <div className="text-xs text-[var(--kt-text-tertiary)]">
                  执行耗时
                </div>
                <div className="text-sm font-semibold text-[var(--kt-text)]">
                  {execTime != null
                    ? execTime > 1000
                      ? `${(execTime / 1000).toFixed(1)}s`
                      : `${execTime}ms`
                    : "-"}
                </div>
              </div>
            </div>
          </div>

          {/* Navigation mode selector */}
          <div className="mt-4 pt-4 border-t border-[var(--kt-border)]">
            <div className="text-xs text-[var(--kt-text-tertiary)] mb-2">
              下一关导航方式
            </div>
            <div className="flex gap-1.5">
              {NAV_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isActive = navMode === opt.mode;
                return (
                  <button
                    key={opt.mode}
                    onClick={() => setNavMode(opt.mode)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-200 ${
                      isActive
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "bg-[var(--kt-bg-elevated)] text-[var(--kt-text-tertiary)] hover:bg-[var(--kt-border)] hover:text-[var(--kt-text-secondary)]"
                    }`}
                  >
                    <Icon className="size-3.5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Next experiment hint */}
            <div className="mt-2.5 flex items-center gap-1.5 text-xs">
              <span className="text-[var(--kt-text-tertiary)]">
                {loadingNext ? (
                  <span className="inline-block h-3 w-20 rounded bg-[var(--kt-bg-elevated)] animate-pulse" />
                ) : nextExperiment ? (
                  <>
                    <ChevronRight className="inline size-3 text-emerald-500" />
                    {" "}
                    <span className="text-[var(--kt-text-secondary)]">
                      {nextExperiment.title || nextExperiment.name}
                    </span>
                  </>
                ) : (
                  <span className="text-[var(--kt-text-tertiary)]">已是最后一关</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={handleContinue}
            className="flex-1 rounded-lg bg-[var(--kt-bg-elevated)] px-4 py-2.5 text-sm font-medium text-[var(--kt-text-secondary)] transition-colors hover:bg-[var(--kt-border)]"
          >
            {nextExperiment ? "继续学习" : "返回列表"}
          </button>
          <button
            onClick={onViewDetails}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            查看提交详情
          </button>
        </div>
      </div>
    </div>
  );
}
