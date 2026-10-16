"use client";

import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { useWorkspaceStore } from "@/stores/workspace";
import { AnimatedCounter, StatChange } from "@/components/ui/animated-counter";
import { cn } from "@/lib/utils";
import { AchievementIcon } from "./AchievementIcon";
import ResourceMonitorCard from "./panels/ResourceMonitorCard";
import SandboxResourcePanel from "@/components/panels/SandboxResourcePanel";
import TeachingHintPanel from "@/components/panels/TeachingHintPanel";
import type { HintLevel } from "@/components/panels/TeachingHintPanel";
import {
  ChevronRight, ChevronDown, Trophy, Activity, Cpu, Gauge,
  SlidersHorizontal, Zap, CheckCircle2, Lightbulb, HardDrive,
} from "lucide-react";

export function RightStatusCards() {
  const {
    setIsRightVisible,
    collapsedCards,
    toggleCardCollapse,
    evalResult,
    submitting,
    experiment,
    experimentParams,
    setExperimentParams,
    competitionMode,
    setCompetitionMode,
    submitting: isRunning,
  } = useWorkspaceStore();

  const obsContext = useWorkspaceStore((s: any) => s.obsContext);
  const diagnosis = useWorkspaceStore((s: any) => s.diagnosis);
  const achievements = useWorkspaceStore((s) => s.achievements);
  const unlockedCount = useWorkspaceStore((s) => s.unlockedCount);
  const achievementsLoading = useWorkspaceStore((s) => s.achievementsLoading);
  const loadAchievements = useWorkspaceStore((s) => s.loadAchievements);

  useEffect(() => {
    loadAchievements();
  }, [loadAchievements]);

  const score = evalResult?.score ?? 0;
  const total = evalResult?.total_score ?? 100;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const passedColor = pct >= 80 ? "var(--kt-green)" : pct >= 50 ? "var(--kt-amber)" : "var(--kt-red)";

  // Score ring SVG
  const ringR = 36;
  const ringCircumference = 2 * Math.PI * ringR;
  const ringOffset = ringCircumference - (pct / 100) * ringCircumference;

  const isCardCollapsed = (id: string) => collapsedCards.includes(id);

  const CardHeader = ({ id, title, icon }: { id: string; title: string; icon: React.ReactNode }) => (
    <button
      onClick={() => toggleCardCollapse(id)}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--kt-text-secondary)] hover:text-[var(--kt-text)] transition-colors"
    >
      {icon}
      <span>{title}</span>
      <div className="flex-1" />
      {isCardCollapsed(id) ? (
        <ChevronDown className="size-3 text-[var(--kt-text-tertiary)]" />
      ) : (
        <ChevronRight className="size-3 text-[var(--kt-text-tertiary)]" />
      )}
    </button>
  );

  return (
    <div className="bg-[var(--kt-bg-surface)] flex flex-col overflow-hidden h-full">
      {/* Header with collapse toggle */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--kt-border)] flex-shrink-0">
        <span className="text-[11px] font-semibold text-[var(--kt-text-tertiary)] uppercase tracking-wider">
          实验面板
        </span>
        <button
          onClick={() => setIsRightVisible(false)}
          className="text-[var(--kt-text-tertiary)] hover:text-[var(--kt-cyan)] text-xs p-0.5 transition-colors"
          title="折叠面板"
        >
          <ChevronRight className="size-4 rotate-180" />
        </button>
      </div>

      <motion.div
        className="flex-1 overflow-y-auto kt-scroll"
        initial="hidden"
        animate="visible"
        variants={{
          visible: { transition: { staggerChildren: 0.08 } },
        }}
      >
        {/* Score Card */}
        <motion.div
          variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
          className="kt-card mx-2 mt-2 overflow-hidden"
        >
          <CardHeader id="score" title="得分" icon={<Trophy className="size-3.5 text-[var(--kt-amber)]" />} />
          {!isCardCollapsed("score") && (
            <div className="px-3 pb-3">
              {evalResult ? (
                <div className="flex items-center gap-3">
                  {/* SVG Ring */}
                  <div className="relative w-[56px] h-[56px] flex-shrink-0">
                    <svg width="56" height="56" viewBox="0 0 80 80">
                      <circle
                        cx="40" cy="40" r={ringR}
                        className="kt-score-ring-bg"
                        strokeWidth="5"
                      />
                      <circle
                        cx="40" cy="40" r={ringR}
                        className="kt-score-ring-fg"
                        strokeWidth="5"
                        stroke={passedColor}
                        strokeDasharray={ringCircumference}
                        strokeDashoffset={ringOffset}
                        transform="rotate(-90 40 40)"
                        style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)" }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-bold" style={{ color: passedColor }}>{pct}</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <AnimatedCounter value={score} className="text-lg font-bold" /><span className="text-xs text-[var(--kt-text-tertiary)]">/{total}</span>
                      {evalResult.is_qualified !== undefined && (
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium",
                          evalResult.is_qualified
                            ? "bg-[var(--kt-green-dim)] text-[var(--kt-green)]"
                            : "bg-[var(--kt-red-dim)] text-[var(--kt-red)]"
                        )}>
                          {evalResult.is_qualified ? "合格" : "未达标"}
                        </span>
                      )}
                    </div>
                    {(evalResult.core_score !== undefined || evalResult.edge_score !== undefined) && (
                      <div className="text-[10px] text-[var(--kt-text-secondary)] mt-0.5 flex gap-2">
                        <span>核心 {evalResult.core_score ?? 0}</span>
                        <span>边界 {evalResult.edge_score ?? 0}</span>
                      </div>
                    )}
                    <div className="text-[11px] text-[var(--kt-text-secondary)]">
                      ✅ {evalResult.passed_test_cases ?? 0} 通过 · ❌ {(evalResult.total_test_cases ?? 0) - (evalResult.passed_test_cases ?? 0)} 失败
                    </div>
                    {pct > 0 && (
                      <div className="mt-0.5">
                        <StatChange delta={Math.abs(pct - 60)} direction={pct >= 60 ? "up" : "down"} label={pct >= 60 ? "超及格线" : "距及格线"} />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-3">
                  <div className="text-2xl mb-1">📝</div>
                  <p className="text-[11px] text-[var(--kt-text-tertiary)]">
                    {isRunning ? "运行中..." : "提交代码查看得分"}
                  </p>
                </div>
              )}
            </div>
          )}
        </motion.div>

        {/* Experiment Params Card */}
        <motion.div
          variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
          className="kt-card mx-2 mt-2 overflow-hidden"
        >
          <CardHeader id="params" title="参数调优" icon={<SlidersHorizontal className="size-3.5 text-[var(--kt-cyan)]" />} />
          {!isCardCollapsed("params") && (
            <div className="px-3 pb-3 space-y-2">
              <div>
                <label className="text-[10px] text-[var(--kt-text-tertiary)] block mb-0.5">线程数</label>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={experimentParams.threadCount}
                  onChange={(e) => setExperimentParams({ threadCount: parseInt(e.target.value) || 1 })}
                  className="w-full px-2 py-1 text-xs bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)] rounded text-[var(--kt-text)] focus:border-[var(--kt-cyan)] outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--kt-text-tertiary)] block mb-0.5">TOTAL_OPS</label>
                <input
                  type="number"
                  min={100}
                  max={100000000}
                  step={100000}
                  value={experimentParams.totalOps}
                  onChange={(e) => setExperimentParams({ totalOps: parseInt(e.target.value) || 100 })}
                  className="w-full px-2 py-1 text-xs bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)] rounded text-[var(--kt-text)] focus:border-[var(--kt-cyan)] outline-none"
                />
              </div>
            </div>
          )}
        </motion.div>

        {/* Competition Mode */}
        <motion.div
          variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
          className="kt-card mx-2 mt-2 overflow-hidden"
        >
          <CardHeader id="competition" title="竞争模拟" icon={<Zap className="size-3.5 text-[var(--kt-purple)]" />} />
          {!isCardCollapsed("competition") && (
            <div className="px-3 pb-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCompetitionMode("high")}
                  className={cn(
                    "flex-1 py-1.5 text-[11px] font-medium rounded border transition-all",
                    competitionMode === "high"
                      ? "bg-[var(--kt-red-dim)] border-[var(--kt-red)]/30 text-[var(--kt-red)]"
                      : "bg-[var(--kt-bg-elevated)] border-[var(--kt-border)] text-[var(--kt-text-secondary)] hover:border-[var(--kt-border-strong)]"
                  )}
                >
                  ⚡ 高并发
                </button>
                <button
                  onClick={() => setCompetitionMode("low")}
                  className={cn(
                    "flex-1 py-1.5 text-[11px] font-medium rounded border transition-all",
                    competitionMode === "low"
                      ? "bg-[var(--kt-green-dim)] border-[var(--kt-green)]/30 text-[var(--kt-green)]"
                      : "bg-[var(--kt-bg-elevated)] border-[var(--kt-border)] text-[var(--kt-text-secondary)] hover:border-[var(--kt-border-strong)]"
                  )}
                >
                  🌿 低竞争
                </button>
              </div>
              <p className="text-[10px] text-[var(--kt-text-tertiary)] mt-1.5 leading-relaxed">
                {competitionMode === "high"
                  ? "多线程同时竞争锁，模拟真实高并发场景"
                  : "少量线程顺序执行，验证基本正确性"}
              </p>
            </div>
          )}
        </motion.div>

        {/* Resource Monitor Card */}
        <motion.div
          variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
          className="kt-card mx-2 mt-2 overflow-hidden"
        >
          <CardHeader id="resources" title="资源监控" icon={<Cpu className="size-3.5 text-[var(--kt-green)]" />} />
          {!isCardCollapsed("resources") && (
            <div className="px-2 pb-2">
              <ResourceMonitorCard experimentId={experiment?.id} />
            </div>
          )}
        </motion.div>

        {/* Sandbox Resource Panel */}
        <motion.div
          variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
          className="kt-card mx-2 mt-2 overflow-hidden"
        >
          <CardHeader id="sandbox" title="沙箱资源" icon={<HardDrive className="size-3.5 text-[var(--kt-purple)]" />} />
          {!isCardCollapsed("sandbox") && (
            <div className="px-2 pb-2">
              <SandboxResourcePanel />
            </div>
          )}
        </motion.div>

        {/* Teaching Hint Panel */}
        {diagnosis?.feedback && (
          <TeachingHintCard feedback={diagnosis.feedback} />
        )}

        {/* Experiment Checklist Card */}
        <motion.div
          variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
          className="kt-card mx-2 mt-2 overflow-hidden"
        >
          <CardHeader id="checklist" title="校验清单" icon={<CheckCircle2 className="size-3.5 text-[var(--kt-green)]" />} />
          {!isCardCollapsed("checklist") && (
            <div className="px-3 pb-3 space-y-1.5">
              {(evalResult?.checklist?.length
                ? evalResult.checklist
                : [
                    { key: "compile", label: "代码通过编译", status: "unknown", detail: undefined },
                    { key: "core", label: "核心功能正确", status: "unknown", detail: undefined },
                    { key: "syscall", label: "系统调用符合要求", status: "unknown", detail: undefined },
                    { key: "behavior", label: "运行时行为正常", status: "unknown", detail: undefined },
                    { key: "resource", label: "资源无泄漏", status: "unknown", detail: undefined },
                  ]
              ).map((item) => {
                const passed = item.status === "passed";
                const failed = item.status === "failed";
                return (
                  <div key={item.key} className="flex items-start gap-2">
                    <span className={cn(
                      "flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] mt-[1px]",
                      passed
                        ? "bg-[var(--kt-green-dim)] text-[var(--kt-green)]"
                        : failed
                          ? "bg-[var(--kt-red-dim)] text-[var(--kt-red)]"
                          : "bg-[var(--kt-border)] text-[var(--kt-text-tertiary)]"
                    )}>
                      {passed ? "✓" : failed ? "✕" : "·"}
                    </span>
                    <span className={cn(
                      "text-[11px] leading-snug",
                      passed
                        ? "text-[var(--kt-text)]"
                        : failed
                          ? "text-[var(--kt-text-secondary)]"
                          : "text-[var(--kt-text-tertiary)]"
                    )}>
                      {item.label}
                      {item.detail && (
                        <span className="block text-[10px] text-[var(--kt-text-tertiary)]">{item.detail}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Achievements Card */}
        <motion.div
          variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
          className="kt-card mx-2 mt-2 mb-2 overflow-hidden"
        >
          <CardHeader id="achievements" title="成就" icon={<Trophy className="size-3.5 text-[var(--kt-amber)]" />} />
          {!isCardCollapsed("achievements") && (
            <div className="px-3 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-[var(--kt-text-tertiary)]">
                  {achievementsLoading
                    ? "加载中..."
                    : `${unlockedCount}/${achievements.length} 已解锁`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {achievements.length === 0 && !achievementsLoading ? (
                  <p className="col-span-4 text-[11px] text-[var(--kt-text-tertiary)] text-center py-2">
                    暂无成就
                  </p>
                ) : (
                  achievements.map((a) => (
                    <div
                      key={a.id}
                      className={cn(
                        "flex flex-col items-center gap-1 py-1.5 rounded-md border",
                        a.unlocked
                          ? "border-[var(--kt-amber)] bg-[var(--kt-amber-dim)]"
                          : "border-[var(--kt-border)] bg-[var(--kt-bg-elevated)]",
                      )}
                      title={`${a.unlocked ? "已解锁" : "未解锁"}：${a.name} — ${a.description}`}
                    >
                      <AchievementIcon
                        icon={a.icon}
                        className={cn("size-5", !a.unlocked && "opacity-30 grayscale")}
                      />
                      <span
                        className={cn(
                          "text-[9px] leading-none text-center truncate max-w-full px-0.5",
                          a.unlocked
                            ? "text-[var(--kt-text)]"
                            : "text-[var(--kt-text-tertiary)]",
                        )}
                      >
                        {a.name}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}

// ── Teaching Hint Card (derived from AI diagnosis feedback) ──

function TeachingHintCard({ feedback }: { feedback: any }) {
  const hints: HintLevel[] = [];

  if (feedback.level_1) {
    hints.push({
      level: 1,
      hints: [feedback.level_1],
      os_concept: "系统调用与内存管理基础",
    });
  }
  if (feedback.level_2) {
    hints.push({
      level: 2,
      hints: [feedback.level_2],
      os_concept: "进程调度与并发控制",
    });
  }
  if (feedback.level_3) {
    hints.push({
      level: 3,
      hints: [feedback.level_3],
      os_concept: "锁机制与同步原语",
    });
  }
  if (feedback.level_4) {
    hints.push({
      level: 4,
      hints: [feedback.level_4],
      os_concept: "性能分析与优化策略",
      further_reading: "深入理解Linux内核",
    });
  }

  if (hints.length === 0) return null;

  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
      initial="hidden"
      animate="visible"
      className="kt-card mx-2 mt-2 mb-2 overflow-hidden"
    >
      <TeachingHintPanel
        issueType="代码诊断"
        issueTitle="AI 教学提示"
        severity="info"
        hints={hints}
        fixSuggestion={feedback.fix_suggestion || undefined}
        relatedPanel="diagnosis"
      />
    </motion.div>
  );
}
