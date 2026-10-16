"use client";

import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWorkspaceStore } from "@/stores/workspace";
import { PanelHeader } from "@/components/ui/panel-header";
import { EmptyState } from "@/components/ui/empty-state";
import { GitCompare, ArrowUp, ArrowDown, Minus, Plus, Trash2, CircleDot } from "lucide-react";
import type { MemorySnapshot } from "@/types/workspace";

interface DiffStats {
  increased: number;
  decreased: number;
  newSegments: number;
  released: number;
  totalChange: number;
}

const SEGMENTS = [
  { key: "heap_bytes" as const, label: "Heap 堆", color: "var(--kt-amber)", isBytes: true },
  { key: "heap_size" as const, label: "堆分配大小", color: "var(--kt-orange)", isBytes: true },
  { key: "mmap_total" as const, label: "mmap 总量", color: "var(--kt-purple)", isBytes: true },
  { key: "stack_size" as const, label: "Stack 栈", color: "var(--kt-red)", isBytes: true },
];

function humanBytes(b: number): string {
  if (b <= 0) return "0 B";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

function diffStats(a: MemorySnapshot, b: MemorySnapshot): DiffStats {
  let increased = 0, decreased = 0, newSegments = 0, released = 0, totalChange = 0;
  for (const seg of SEGMENTS) {
    const va = Number(a[seg.key]) || 0;
    const vb = Number(b[seg.key]) || 0;
    const d = vb - va;
    if (d > 0) increased++;
    else if (d < 0) decreased++;
    if (va === 0 && vb > 0) newSegments++;
    if (va > 0 && vb === 0) released++;
    totalChange += d;
  }
  return { increased, decreased, newSegments, released, totalChange };
}

// ── Side-by-side segment bar ────────────────────────────────
function SegmentCompareBar({ label, a, b, color, isBytes }: {
  label: string; a: number; b: number; color: string; isBytes: boolean;
}) {
  const diff = b - a;
  const pctChange = a > 0 ? ((diff / a) * 100) : b > 0 ? 100 : 0;
  const maxVal = Math.max(a, b, 1);
  const diffIcon = diff > 0
    ? <ArrowUp className="size-3 text-[var(--kt-red)]" />
    : diff < 0
      ? <ArrowDown className="size-3 text-[var(--kt-green)]" />
      : <Minus className="size-3 text-[var(--kt-text-tertiary)]" />;
  const valColor = diff > 0 ? "text-[var(--kt-red)]" : diff < 0 ? "text-[var(--kt-green)]" : "text-[var(--kt-text-secondary)]";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--kt-text-secondary)] font-medium">{label}</span>
        <span className={`text-[11px] font-mono font-bold flex items-center gap-0.5 ${valColor}`}>
          {diffIcon}{Math.abs(pctChange).toFixed(1)}%
          <span className="text-[10px] font-normal opacity-70 ml-1">
            {diff > 0 ? "+" : ""}{isBytes ? humanBytes(diff) : diff.toLocaleString()}
          </span>
        </span>
      </div>
      {/* Side-by-side bars */}
      <div className="flex items-center gap-3">
        <div className="flex-1 flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--kt-text-tertiary)] w-8 text-right shrink-0">快照A</span>
          <div className="flex-1 h-4 rounded-sm relative overflow-hidden bg-[var(--kt-bg-tertiary)]">
            <div className="h-full rounded-sm transition-all duration-300"
              style={{ width: `${Math.max((a / maxVal) * 100, 2)}%`, backgroundColor: color, opacity: 0.5 }} />
          </div>
          <span className="text-[11px] font-mono text-[var(--kt-text-secondary)] w-16 text-right shrink-0">
            {isBytes ? humanBytes(a) : a.toLocaleString()}
          </span>
        </div>
        <div className="flex-1 flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--kt-text-tertiary)] w-8 text-right shrink-0">快照B</span>
          <div className="flex-1 h-4 rounded-sm relative overflow-hidden bg-[var(--kt-bg-tertiary)]">
            <div className="h-full rounded-sm transition-all duration-300"
              style={{ width: `${Math.max((b / maxVal) * 100, 2)}%`, backgroundColor: color }} />
          </div>
          <span className="text-[11px] font-mono text-[var(--kt-text-primary)] w-16 text-right shrink-0">
            {isBytes ? humanBytes(b) : b.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Diff summary stats ──────────────────────────────────────
function DiffSummaryCards({ a, b }: { a: MemorySnapshot; b: MemorySnapshot }) {
  const stats = useMemo(() => diffStats(a, b), [a, b]);

  const cards = [
    { label: "增长", value: stats.increased, icon: ArrowUp, color: "text-[var(--kt-red)]" },
    { label: "减少", value: stats.decreased, icon: ArrowDown, color: "text-[var(--kt-green)]" },
    { label: "新增", value: stats.newSegments, icon: Plus, color: "text-[var(--kt-cyan)]" },
    { label: "释放", value: stats.released, icon: Trash2, color: "text-[var(--kt-purple)]" },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {cards.map((c) => (
        <div key={c.label} className="flex flex-col items-center p-2 rounded bg-[var(--kt-bg-tertiary)]/50 border border-[var(--kt-border)]/20">
          <c.icon className={`size-3.5 ${c.color}`} />
          <span className={`text-sm font-bold font-mono ${c.color}`}>{c.value}</span>
          <span className="text-[10px] text-[var(--kt-text-tertiary)]">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

const EMPTY_SNAPSHOTS: MemorySnapshot[] = [];

export default function MemorySnapshotDiff() {
  const memorySnapshots = useWorkspaceStore((s: any) => s.obsContext?.memory_snapshots ?? EMPTY_SNAPSHOTS) as MemorySnapshot[];
  const [idxA, setIdxA] = useState(0);
  const [idxB, setIdxB] = useState(Math.min(1, Math.max(0, memorySnapshots.length - 1)));
  const snapA = memorySnapshots[idxA] ?? null;
  const snapB = memorySnapshots[idxB] ?? null;
  const options = useMemo(() => memorySnapshots.map((s: MemorySnapshot, i: number) => ({
    value: i,
    label: new Date(s.timestamp).toLocaleTimeString('zh-CN'),
  })), [memorySnapshots]);

  return (
    <div className="h-full flex flex-col">
      <PanelHeader icon={GitCompare} title="快照对比" subtitle="左右分屏对比两个时刻的内存状态" />
      <div className="flex-1 overflow-y-auto p-3">
        {memorySnapshots.length < 2 ? (
          <EmptyState variant="no-data" title="快照不足" description="需要至少两个内存快照才能对比。" />
        ) : (
          <div className="space-y-3">
            {/* Selectors */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-[var(--kt-text-tertiary)]">时刻 A</label>
                <select value={idxA} onChange={(e) => setIdxA(Number(e.target.value))}
                  className="w-full mt-1 px-2 py-1.5 text-[11px] rounded bg-[var(--kt-bg-tertiary)] border border-[var(--kt-border)]/30 text-[var(--kt-text-primary)]">
                  {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-[var(--kt-text-tertiary)]">时刻 B</label>
                <select value={idxB} onChange={(e) => setIdxB(Number(e.target.value))}
                  className="w-full mt-1 px-2 py-1.5 text-[11px] rounded bg-[var(--kt-bg-tertiary)] border border-[var(--kt-border)]/30 text-[var(--kt-text-primary)]">
                  {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {snapA && snapB && (
              <AnimatePresence mode="wait">
                <motion.div key={`${idxA}-${idxB}`}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}
                  className="space-y-3"
                >
                  {/* Diff summary stats */}
                  <DiffSummaryCards a={snapA} b={snapB} />

                  {/* Side-by-side comparison */}
                  <div className="p-3 rounded bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)]/30 space-y-3">
                    <div className="flex items-center gap-2 text-[11px] text-[var(--kt-text-tertiary)]">
                      <CircleDot className="size-3 text-[var(--kt-cyan)]" />
                      左右分屏对比 — 左侧浅色为快照A，右侧实色为快照B
                    </div>
                    {SEGMENTS.map((seg) => (
                      <SegmentCompareBar key={seg.key}
                        label={seg.label}
                        a={Number(snapA[seg.key]) || 0}
                        b={Number(snapB[seg.key]) || 0}
                        color={seg.color}
                        isBytes={seg.isBytes}
                      />
                    ))}
                  </div>
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
