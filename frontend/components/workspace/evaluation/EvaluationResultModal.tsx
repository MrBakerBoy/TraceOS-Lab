"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import confetti from "canvas-confetti";
import {
  X,
  Clock,
  FileCode2,
  MemoryStick,
  Sparkles,
  ChevronRight,
  ListOrdered,
  Gauge,
  Layers,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { EvalResult } from "@/types/workspace";
import VerdictBanner from "./VerdictBanner";
import ScoreRing from "./ScoreRing";
import TestPointItem from "./TestPointItem";

interface Experiment {
  id: string;
  name: string;
  title: string;
  category: string;
  difficulty: string;
}

type NavMode = "order" | "difficulty" | "category";

const CATEGORY_ORDER = [
  "process",
  "thread",
  "memory",
  "fs",
  "scheduler",
  "deadlock",
];
const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

const NAV_OPTIONS: { mode: NavMode; label: string; icon: typeof ListOrdered }[] = [
  { mode: "order", label: "按顺序", icon: ListOrdered },
  { mode: "difficulty", label: "按难度", icon: Gauge },
  { mode: "category", label: "按类型", icon: Layers },
];

interface EvaluationResultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evalResult: EvalResult;
  experimentTitle: string;
  experimentId: string;
  courseId?: string;
  onViewDetails: () => void;
  onAIDiagnosis: () => void;
}

function formatExecTime(ms: number | undefined): string {
  if (ms == null) return "-";
  return ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatMemory(bytes: number | undefined): string {
  if (bytes == null) return "-";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function EvaluationResultModal({
  open,
  onOpenChange,
  evalResult,
  experimentTitle,
  experimentId,
  courseId,
  onViewDetails,
  onAIDiagnosis,
}: EvaluationResultModalProps) {
  const router = useRouter();
  const confettiFired = useRef(false);
  const [navMode, setNavMode] = useState<NavMode>("order");
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loadingNext, setLoadingNext] = useState(false);

  const {
    status,
    score = 0,
    total_score = 0,
    core_score,
    edge_score,
    is_qualified,
    passed_test_cases = 0,
    total_test_cases = 0,
    test_points = [],
    compile_error,
    execution_time,
    memory_usage,
  } = evalResult;

  const qualified = is_qualified === true;

  useEffect(() => {
    if (!open || !experimentId) return;
    setLoadingNext(true);
    api
      .getExperiments({})
      .then((res: any) => setExperiments(res.data || []))
      .catch(() => setExperiments([]))
      .finally(() => setLoadingNext(false));
  }, [open, experimentId]);

  const nextExperiment = useMemo(() => {
    if (experiments.length === 0) return null;
    const current = experiments.find((e) => e.id === experimentId);
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
      default:
        sorted = experiments.filter((e) => e.category === current.category);
        break;
    }

    const idx = sorted.findIndex((e) => e.id === experimentId);
    if (idx >= 0 && idx < sorted.length - 1) return sorted[idx + 1];
    return null;
  }, [experiments, experimentId, navMode]);

  useEffect(() => {
    if (open && qualified && !confettiFired.current) {
      confettiFired.current = true;
      confetti({
        particleCount: 100,
        spread: 120,
        origin: { x: 0.5, y: 0.15 },
        colors: ["#30d158", "#22c55e", "#16a34a", "#ff9f0a", "#0a84ff"],
        zIndex: 999,
        gravity: 0.8,
      });
      setTimeout(
        () =>
          confetti({
            particleCount: 70,
            spread: 70,
            origin: { x: 0.15, y: 0.6 },
            colors: ["#30d158", "#22c55e", "#ff9f0a"],
            zIndex: 999,
            angle: 60,
          }),
        120,
      );
      setTimeout(
        () =>
          confetti({
            particleCount: 70,
            spread: 70,
            origin: { x: 0.85, y: 0.6 },
            colors: ["#30d158", "#22c55e", "#ff9f0a"],
            zIndex: 999,
            angle: 120,
          }),
        220,
      );
    }
    return () => {
      confettiFired.current = false;
    };
  }, [open, qualified]);

  const handleContinue = useCallback(() => {
    onOpenChange(false);
    if (nextExperiment) {
      router.push(`/experiments/${nextExperiment.id}`);
    } else {
      router.push("/experiments");
    }
  }, [onOpenChange, router, nextExperiment]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[88vh] gap-0 overflow-hidden border-0 bg-[var(--bg-card)] p-0 text-[var(--text-primary)] shadow-[var(--shadow-modal)] ring-1 ring-[var(--border-strong)] sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">评测结果</DialogTitle>
        <DialogDescription className="sr-only">
          本次提交的评测结果、得分与测试点明细
        </DialogDescription>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="关闭评测结果"
          className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-app-text-3 transition-colors hover:bg-[var(--bg-elevated)] hover:text-app-text"
        >
          <X className="size-4" />
        </button>

        {/* Header */}
        <div className="px-5 pb-4 pt-5">
          <VerdictBanner
            status={status}
            isQualified={is_qualified}
            score={score}
            totalScore={total_score}
          />
        </div>

        {/* Scrollable body */}
        <div className="max-h-[56vh] space-y-5 overflow-y-auto px-5 py-1">
          {status === "compile_error" ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--error-bg)] p-3 text-xs leading-relaxed text-app-error">
              {compile_error}
            </pre>
          ) : (
            <>
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <ScoreRing
                  score={score}
                  totalScore={total_score}
                  coreScore={core_score}
                  edgeScore={edge_score}
                  isQualified={is_qualified}
                />

                <div className="grid flex-1 grid-cols-2 gap-2 text-sm sm:max-w-xs">
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2.5">
                    <FileCode2 className="size-4 shrink-0 text-app-accent" />
                    <div>
                      <div className="text-[11px] text-app-text-3">通过</div>
                      <div className="font-semibold text-app-text">
                        {passed_test_cases}/{total_test_cases}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2.5">
                    <Clock className="size-4 shrink-0 text-app-accent" />
                    <div>
                      <div className="text-[11px] text-app-text-3">耗时</div>
                      <div className="font-semibold text-app-text">
                        {formatExecTime(execution_time)}
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 flex items-center gap-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2.5">
                    <MemoryStick className="size-4 shrink-0 text-app-accent" />
                    <div>
                      <div className="text-[11px] text-app-text-3">内存</div>
                      <div className="font-semibold text-app-text">
                        {formatMemory(memory_usage)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-app-text">
                  测试点明细
                </h3>
                {test_points.length > 0 ? (
                  <div className="rounded-lg border border-app-border">
                    {test_points.map((tp, i) => (
                      <TestPointItem key={tp.id ?? i} point={tp} index={i} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-app-text-3">暂无测试点明细</p>
                )}
              </div>

              {qualified && (
                <div className="rounded-lg border border-app-border p-4">
                  <div className="mb-2 text-xs text-app-text-3">
                    下一关导航方式
                  </div>
                  <div className="flex gap-1.5">
                    {NAV_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const active = navMode === opt.mode;
                      return (
                        <button
                          key={opt.mode}
                          type="button"
                          onClick={() => setNavMode(opt.mode)}
                          aria-pressed={active}
                          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                            active
                              ? "bg-app-accent text-white"
                              : "bg-[var(--bg-elevated)] text-app-text-2 hover:text-app-text"
                          }`}
                        >
                          <Icon className="size-3.5" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5 text-xs">
                    {loadingNext ? (
                      <span className="inline-block h-3 w-20 animate-pulse rounded bg-[var(--bg-elevated)]" />
                    ) : nextExperiment ? (
                      <>
                        <ChevronRight className="size-3 text-app-accent" />
                        <span className="text-app-text-2">
                          {nextExperiment.title || nextExperiment.name}
                        </span>
                      </>
                    ) : (
                      <span className="text-app-text-3">已是最后一关</span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-app-border px-5 py-4">
          {qualified && (
            <button
              type="button"
              onClick={handleContinue}
              className="flex items-center gap-1.5 rounded-lg bg-app-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-app-accent-hover"
            >
              <Sparkles className="size-4" />
              {nextExperiment ? "继续下一关" : "返回实验列表"}
            </button>
          )}
          <button
            type="button"
            onClick={onViewDetails}
            className="rounded-lg bg-[var(--bg-elevated)] px-4 py-2.5 text-sm font-medium text-app-text-2 transition-colors hover:text-app-text"
          >
            查看提交详情
          </button>
          <button
            type="button"
            onClick={onAIDiagnosis}
            className="rounded-lg bg-[var(--bg-elevated)] px-4 py-2.5 text-sm font-medium text-app-text-2 transition-colors hover:text-app-text"
          >
            AI 诊断
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}