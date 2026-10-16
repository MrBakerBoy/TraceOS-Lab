"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { useWorkspaceStore } from "@/stores/workspace";
import { PanelHeader } from "@/components/ui/panel-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SkeletonText } from "@/components/ui/skeleton-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Zap, GitBranch, Clock, Shield, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import type { RaceReport } from "@/types/workspace";

function RaceCard({ report }: { report: RaceReport }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)]/30 rounded-[var(--radius-sm)] overflow-hidden"
    >
      {/* Summary row */}
      <div
        className="p-3 cursor-pointer hover:bg-[var(--kt-cyan-dim)]/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <GitBranch className="size-3.5 text-[var(--kt-cyan)]" />
            <span className="text-xs font-medium text-[var(--kt-text-primary)] font-mono">
              0x{report.address}
            </span>
            <StatusBadge variant="solid" tone="error" label="DATA RACE" />
          </div>
          {expanded ? (
            <ChevronDown size={14} className="text-[var(--kt-text-tertiary)]" />
          ) : (
            <ChevronRight size={14} className="text-[var(--kt-text-tertiary)]" />
          )}
        </div>

        {/* Thread conflict timeline (compact) */}
        <div className="flex flex-col gap-1.5 mb-2">
          {/* Thread 1 */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-[var(--kt-text-tertiary)] w-16">TID {report.thread1}</span>
            <div className="flex-1 h-2.5 bg-[var(--kt-bg-tertiary)] rounded-full overflow-hidden relative">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: "45%",
                  marginLeft: "5%",
                  backgroundColor: "var(--kt-cyan)",
                  opacity: 0.8,
                }}
              />
              <div
                className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full -translate-x-1/2 -translate-y-1/2"
                style={{ backgroundColor: "var(--kt-red)" }}
                title={`Epoch ${report.epoch1}`}
              />
            </div>
            <span className="text-[9px] font-mono text-[var(--kt-cyan)]">Ep {report.epoch1}</span>
          </div>
          {/* Thread 2 */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-[var(--kt-text-tertiary)] w-16">TID {report.thread2}</span>
            <div className="flex-1 h-2.5 bg-[var(--kt-bg-tertiary)] rounded-full overflow-hidden relative">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: "45%",
                  marginLeft: "40%",
                  backgroundColor: "var(--kt-purple)",
                  opacity: 0.8,
                }}
              />
              <div
                className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full -translate-x-1/2 -translate-y-1/2"
                style={{ backgroundColor: "var(--kt-red)" }}
                title={`Epoch ${report.epoch2}`}
              />
            </div>
            <span className="text-[9px] font-mono text-[var(--kt-purple)]">Ep {report.epoch2}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-[var(--kt-text-tertiary)]">
          <Clock className="size-3" />
          <span>{report.timestamp}</span>
          <span className="text-[var(--kt-border)]">|</span>
          <span>src:{report.sourceLine1} ↔ src:{report.sourceLine2}</span>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="border-t border-[var(--kt-border)]/30 px-3 py-3 space-y-3 bg-[var(--kt-bg-tertiary)]/20"
        >
          <p className="text-xs text-[var(--kt-text-secondary)] leading-relaxed">
            {report.description}
          </p>

          {/* HB analysis diagram */}
          <div className="bg-[var(--kt-bg-elevated)] rounded-[var(--radius-sm)] p-2.5 border border-[var(--kt-border)]/20">
            <div className="flex items-center gap-2 mb-2">
              <Shield size={12} className="text-[var(--kt-red)]" />
              <span className="text-[10px] font-semibold text-[var(--kt-red)]">Happens-Before 分析</span>
            </div>
            <div className="text-[9px] text-[var(--kt-text-tertiary)] font-mono space-y-0.5">
              <div>ThreadClock[T{report.thread1}] = {'{'} Epoch: {report.epoch1} {'}'}</div>
              <div>ThreadClock[T{report.thread2}] = {'{'} Epoch: {report.epoch2} {'}'}</div>
              <div className="text-[var(--kt-red)] mt-1">✗ clock[T{report.thread2}][T{report.thread1}] &lt; epoch(T{report.thread1}) = {report.epoch1}</div>
              <div className="text-[var(--kt-red)]">✗ 无 Happens-Before 关系 → 数据竞争!</div>
            </div>
          </div>

          {/* Teaching hint */}
          <div className="bg-[var(--kt-bg-elevated)] rounded-[var(--radius-sm)] p-2.5 border border-[var(--kt-amber-dim)]">
            <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-[var(--kt-amber)] shrink-0 mt-0.5" />
              <div className="text-[10px] text-[var(--kt-text-secondary)] leading-relaxed">
                <strong>教学要点:</strong> 这是经典的数据竞争 (data race)。两个线程同时访问共享内存地址，
                至少一个是写操作，且没有同步保护（mutex/spinlock）。
                修复方法：在访问前使用 <code className="text-[var(--kt-green)]">pthread_mutex_lock()</code>，
                访问后调用 <code className="text-[var(--kt-green)]">pthread_mutex_unlock()</code>。
                Epoch {report.epoch1} 和 Epoch {report.epoch2} 之间不存在 Happens-Before 关系，
                因为两个线程之间没有通过锁建立同步。
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

export default function RaceDetectionView() {
  const raceReports = useWorkspaceStore((s) => s.raceReports) || [];
  const obsContextLoading = useWorkspaceStore((s) => s.obsContextLoading);

  const stats = (raceReports && raceReports.length > 0) ? {
    totalRaces: (raceReports && raceReports.length) || 0,
    uniqueAddrs: new Set(raceReports.map((r) => r.address)).size,
    threadsInvolved: new Set(raceReports.flatMap((r) => [r.thread1, r.thread2])).size,
  } : null;

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        icon={Zap}
        title="竞态检测"
        subtitle={`Happens-Before 分析${stats ? ` · ${stats.totalRaces} 竞态 · ${stats.uniqueAddrs} 地址 · ${stats.threadsInvolved} 线程` : ""}`}
      />

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {obsContextLoading ? (
          <SkeletonText lines={4} />
        ) : (!raceReports || raceReports.length === 0) ? (
          <EmptyState
            variant="no-data"
            title="未检测到竞态"
            description="当前运行中未发现数据竞争。共享变量访问均受同步原语保护，或线程间存在 Happens-Before 关系。"
          />
        ) : (
          <>
            {/* Summary banner */}
            {stats && (
              <div className="flex items-center gap-3 px-3 py-2 mb-2 bg-[var(--kt-red-dim)]/20 border border-[var(--kt-red-dim)]/30 rounded-[var(--radius-sm)]">
                <AlertTriangle size={16} className="text-[var(--kt-red)]" />
                <span className="text-xs font-medium text-[var(--kt-text-primary)]">
                  检测到 <span className="text-[var(--kt-red)]">{stats.totalRaces}</span> 处数据竞争，
                  涉及 <span className="text-[var(--kt-cyan)]">{stats.uniqueAddrs}</span> 个内存地址，
                  <span className="text-[var(--kt-purple)]">{stats.threadsInvolved}</span> 个线程
                </span>
              </div>
            )}
            {raceReports.map((r) => (
              <RaceCard key={r.id} report={r} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
