'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import '@/lib/setup-echarts';
import { useEbpfTheme, type EbpfTheme } from '@/hooks/useEbpfTheme';
import { PanelHeader } from '@/components/ui/panel-header';
import ViewHelpButton from "@/components/ui/ViewHelpButton";
import { DEADLOCK_HELP } from "@/lib/view-help-content";
import type { LockGraphState } from '@/types/ebpf';
import { Network } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { SkeletonCard } from '@/components/ui/skeleton-card';
import { EmptyState } from '@/components/ui/empty-state';

interface DeadlockInfo {
  detected: boolean;
  cycle?: number[];
  details?: string[];
  fix?: string;
}

interface DeadlockGraphProps {
  pid: number | null;
}

export default function DeadlockGraph({ pid }: DeadlockGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useEbpfTheme(containerRef);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);
  const [deadlock, setDeadlock] = useState<DeadlockInfo | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [graph, setGraph] = useState<LockGraphState>({ threads: [], locks: [] });
  const esRef = useRef<EventSource | null>(null);

  function shortAddr(uaddr: string) {
    return uaddr.substring(uaddr.length - 6);
  }

  function buildCyclePath(state: LockGraphState, cycle: number[] | undefined): string {
    if (!cycle || cycle.length < 2) return (cycle || []).map((t) => `T${t}`).join('→');
    const start = cycle[0];
    const path: string[] = [`T${start}`];
    let current: number = start;
    for (let i = 0; i < cycle.length; i++) {
      const waiter = cycle[(i + 1) % cycle.length];
      const lock = state.locks.find(
        (l) => l.holder === current && l.waiters.includes(waiter),
      );
      if (lock) path.push(`🔒${shortAddr(lock.uaddr)}`, `T${waiter}`);
      else path.push(`→T${waiter}`);
      current = waiter;
    }
    return path.join('→');
  }

  // SSE connection with Cookie auth
  useEffect(() => {
    if (pid == null) return;
    const token = localStorage.getItem('token');
    if (token && typeof document !== 'undefined') {
      document.cookie = `token=${encodeURIComponent(token)}; path=/; SameSite=Lax`;
    }
    const es = new EventSource(`/api/v1/ebpf/stream/${pid}`);
    esRef.current = es;

    es.onopen = () => setStatus('observing');
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setStatus('disconnected');
    };
    es.onmessage = (msg) => {
      try {
        const { type, payload } = JSON.parse(msg.data);
        if (type === 'graph') {
          setGraph({ threads: payload.threads || [], locks: payload.locks || [] });
        } else if (type === 'deadlock') {
          setDeadlock(payload);
          setStatus('deadlock');
        } else if (type === 'safe') {
          setStatus('safe');
        }
      } catch {}
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [pid]);

  // ECharts force graph
  useEffect(() => {
    if (!chartRef.current) return;
    syncEChartsTheme();
    if (!chartInst.current) chartInst.current = echarts.init(chartRef.current, 'kt-dynamic');
    const inst = chartInst.current;

    const nodes: any[] = [];
    const links: any[] = [];

    for (const t of graph.threads) {
      const inCycle = deadlock?.cycle?.includes(t.tid);
      nodes.push({
        id: `t${t.tid}`, name: `TID=${t.tid}`, category: 0,
        symbolSize: inCycle ? 38 : 28,
        itemStyle: { color: inCycle ? theme.red : theme.cyan },
        label: { show: true, fontSize: 10, color: theme.text },
      });
    }

    for (const l of graph.locks) {
      nodes.push({
        id: `l${l.uaddr}`, name: `🔒 ${shortAddr(l.uaddr)}`, category: 1,
        symbolSize: 22 + l.waiters.length * 4, symbol: "roundRect",
        itemStyle: { color: theme.amber },
        label: { show: true, fontSize: 9, color: theme.textTer, position: "bottom" },
      });
      if (l.holder > 0) {
        links.push({
          source: `t${l.holder}`, target: `l${l.uaddr}`,
          lineStyle: { color: theme.green, width: 2, curveness: 0.1 },
          label: { show: true, formatter: "持有", fontSize: 8, color: theme.green },
        });
      }
      for (const w of l.waiters) {
        links.push({
          source: `l${l.uaddr}`, target: `t${w}`,
          lineStyle: { color: theme.red, width: 1.5, type: "dashed", curveness: 0.1 },
          label: { show: true, formatter: "等待", fontSize: 8, color: theme.red, position: "middle" },
        });
      }
    }

    inst.setOption({
      tooltip: { formatter: (p: any) => p.data?.name || "" },
      legend: { data: ["线程", "锁"], bottom: 0, textStyle: { fontSize: 10, color: theme.textTer } },
      series: [{
        type: "graph", layout: "force", roam: true, draggable: true,
        force: { repulsion: 200, edgeLength: [80, 200], gravity: 0.1 },
        categories: [{ name: "线程" }, { name: "锁" }],
        data: nodes, links,
        emphasis: { focus: "adjacency", lineStyle: { width: 4 } },
      }],
    }, true);

    const onResize = () => inst.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [graph, deadlock, theme]);

  useEffect(() => {
    return () => { chartInst.current?.dispose(); chartInst.current = null; };
  }, []);

  const statusLabels: Record<string, { cls: string; text: string }> = {
    idle: { cls: "text-[var(--kt-text-tertiary)]", text: "未启动" },
    observing: { cls: "text-[var(--kt-green)]", text: "🟢 观测中" },
    deadlock: { cls: "text-[var(--kt-red)] font-bold", text: "🔴 死锁" },
    safe: { cls: "text-[var(--kt-green)] font-bold", text: "✅ 安全" },
    disconnected: { cls: "text-[var(--kt-text-tertiary)]", text: "离线" },
  };

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-[var(--kt-bg-surface)]">
      <PanelHeader
        icon={Network}
        title="eBPF 锁依赖图"
        subtitle="Wait-for Graph"
        badge={
          deadlock?.detected
            ? { label: "DEADLOCK", variant: "pulse", tone: "error" }
            : status === "observing"
            ? { label: "RUN", variant: "pulse", tone: "success" }
            : status === "safe"
            ? { label: "OK", variant: "solid", tone: "success" }
            : { label: statusLabels[status]?.text || status, variant: "solid", tone: "neutral" }
        }
      />

      <AnimatePresence>
        {deadlock?.detected && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", boxShadow: ["0 0 0px rgba(255,0,0,0)", "0 0 20px rgba(255,0,0,0.3)", "0 0 0px rgba(255,0,0,0)"] }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4, boxShadow: { repeat: Infinity, duration: 1.5 } }}
            className="p-3 bg-[var(--kt-red-dim)] border-b border-[var(--kt-red)]/20 shrink-0"
          >
            <span className="font-bold text-[var(--kt-red)] text-xs">🔴 死锁检测!</span>
            <span className="text-xs text-[var(--kt-red)]/70 ml-2">{buildCyclePath(graph, deadlock.cycle)}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={chartRef} className="flex-1 min-h-0" />

      {/* ── Loading Skeleton ── */}
      {status === 'observing' && graph.threads.length === 0 && (
        <div className="flex-1 p-4">
          <SkeletonCard variant="chart" />
        </div>
      )}

      {/* ── Idle / No PID ── */}
      {pid == null && status === 'idle' && (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            variant="no-data"
            title="eBPF 观测未启动"
            description="选择一个进程 ID 后点击开始观测，即可查看实时锁依赖图与死锁检测。"
          />
        </div>
      )}

      {/* ── Disconnected ── */}
      {status === 'disconnected' && (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            variant="error"
            title="SSE 连接断开"
            description="与 eBPF 观测代理的实时连接已断开，请检查进程是否仍在运行。"
          />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 px-4 py-2 text-[10px] text-[var(--kt-text-tertiary)] border-t border-[var(--kt-border)] shrink-0">
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-full bg-[var(--kt-cyan)]" /> 线程</div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded bg-[var(--kt-amber)]" /> 锁</div>
        <div className="flex items-center gap-1.5"><div className="w-6 h-0 border-t-2 border-[var(--kt-red)] border-dashed" /> 等待</div>
        <div className="flex items-center gap-1.5"><div className="w-6 h-0 border-t-2 border-[var(--kt-green)]" /> 持有</div>
        <div className="flex items-center gap-1.5"><div className="size-3 rounded-full bg-[var(--kt-red)]" /> 死锁环</div>
      </div>
    </div>
  );
}
