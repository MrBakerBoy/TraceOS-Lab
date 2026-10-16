"use client";

import { useMemo } from "react";
import { Cpu, ArrowRightLeft, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { useWorkspaceStore } from "@/stores/workspace";
import type { SchedEvent } from "@/types/obs_context";
import { PanelHeader } from "@/components/ui/panel-header";
import ViewHelpButton from "@/components/ui/ViewHelpButton";
import { SCHED_HELP } from "@/lib/view-help-content";
import { EmptyState } from "@/components/ui/empty-state";

const CPU_COLORS = [
  "var(--kt-cyan)",
  "var(--kt-purple)",
  "var(--kt-green)",
  "var(--kt-amber)",
  "var(--kt-blue)",
  "var(--kt-red)",
  "var(--kt-pink)",
  "var(--kt-orange)",
];

/** Stable empty array reference — avoids Zustand infinite re-render when obsContext is null */
const EMPTY_SCHED: SchedEvent[] = [];

function reasonLabel(state: string): string {
  if (state === "R" || state === "running") return "时间片";
  if (state === "S" || state === "D" || state === "sleeping") return "阻塞";
  return "抢占";
}

function reasonColor(state: string): string {
  if (state === "R" || state === "running") return "var(--kt-amber)";
  if (state === "S" || state === "D" || state === "sleeping") return "var(--kt-cyan)";
  return "var(--kt-red)";
}

export default function SchedVisualizer() {
  const obsContext = useWorkspaceStore((s) => s.obsContext);
  const schedEvents = obsContext?.sched_events ?? EMPTY_SCHED;

  const { cpus, stats, timeRange, threadColors, schedTable } = useMemo(() => {
    if (!schedEvents || schedEvents.length === 0) {
      return { cpus: [] as number[], stats: null, timeRange: [0, 1] as [number, number], threadColors: {} as Record<number, string>, schedTable: [] };
    }

    const cpuSet = new Set<number>();
    const threadSet = new Set<number>();
    let voluntary = 0, involuntary = 0, migrations = 0;
    const lastCpu: Record<number, number> = {};

    schedEvents.forEach((e) => {
      cpuSet.add(e.cpu);
      threadSet.add(e.prev_tid);
      threadSet.add(e.next_tid);
      if (e.prev_state === "S" || e.prev_state === "D") voluntary++;
      else involuntary++;
      if (lastCpu[e.prev_tid] !== undefined && lastCpu[e.prev_tid] !== e.cpu) migrations++;
      lastCpu[e.next_tid] = e.cpu;
    });

    const sorted = [...cpuSet].sort((a, b) => a - b);
    const times = schedEvents.map((e) => new Date(e.timestamp).getTime());
    const timeRangeVal: [number, number] = [Math.min(...times), Math.max(...times) + 1];

    const tColors: Record<number, string> = {};
    [...threadSet].forEach((t, i) => {
      tColors[t] = CPU_COLORS[i % CPU_COLORS.length];
    });

    const table = schedEvents.slice(0, 30).map((e, i) => ({
      id: i,
      timestamp: new Date(e.timestamp).toLocaleTimeString(),
      cpu: e.cpu,
      prev: e.prev_tid,
      next: e.next_tid,
      reason: reasonLabel(e.prev_state),
      isMigration: e.is_migration ?? false,
      reasonColor: reasonColor(e.prev_state),
    }));

    return {
      cpus: sorted,
      stats: { voluntary, involuntary, migrations, total: schedEvents.length },
      timeRange: timeRangeVal,
      threadColors: tColors,
      schedTable: table,
    };
  }, [schedEvents]);

  const span = timeRange[1] - timeRange[0] || 1;
  const avgSwitchRate = span > 0 ? (stats?.total || 0) / (span / 1000) : 0;

  return (
    <div className="h-full flex flex-col">
      <PanelHeader icon={Cpu} title="CPU 调度" subtitle="上下文切换 & 运行队列" actions={<ViewHelpButton content={SCHED_HELP} />} />

      <div className="flex-1 overflow-y-auto">
        {!schedEvents || schedEvents.length === 0 ? (
          <EmptyState variant="no-data" title="无调度事件" description="运行多线程程序以查看 CPU 调度时间线。" />
        ) : (
          <div className="p-3 space-y-4">
            {stats && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-5 gap-2"
              >
                <div className="text-center bg-[var(--kt-bg-elevated)] rounded-[var(--radius-sm)] py-2">
                  <div className="text-sm font-bold font-mono text-[var(--kt-text-primary)]">{stats.total}</div>
                  <div className="text-[9px] text-[var(--kt-text-tertiary)]">总切换</div>
                </div>
                <div className="text-center bg-[var(--kt-bg-elevated)] rounded-[var(--radius-sm)] py-2">
                  <div className="text-sm font-bold font-mono text-[var(--kt-amber)]">{stats.involuntary}</div>
                  <div className="text-[9px] text-[var(--kt-text-tertiary)]">非自愿</div>
                </div>
                <div className="text-center bg-[var(--kt-bg-elevated)] rounded-[var(--radius-sm)] py-2">
                  <div className="text-sm font-bold font-mono text-[var(--kt-cyan)]">{stats.voluntary}</div>
                  <div className="text-[9px] text-[var(--kt-text-tertiary)]">自愿</div>
                </div>
                <div className="text-center bg-[var(--kt-bg-elevated)] rounded-[var(--radius-sm)] py-2">
                  <div className="text-sm font-bold font-mono text-[var(--kt-purple)]">{stats.migrations}</div>
                  <div className="text-[9px] text-[var(--kt-text-tertiary)]">迁移</div>
                </div>
                <div className="text-center bg-[var(--kt-bg-elevated)] rounded-[var(--radius-sm)] py-2">
                  <div className="text-sm font-bold font-mono text-[var(--kt-text-primary)]">{avgSwitchRate.toFixed(0)}</div>
                  <div className="text-[9px] text-[var(--kt-text-tertiary)]">切换/s</div>
                </div>
              </motion.div>
            )}

            {cpus.map((cpu) => {
              const cpuEvents = schedEvents.filter((e) => e.cpu === cpu);
              return (
                <div key={cpu} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Cpu size={12} className="text-[var(--kt-cyan)]" />
                    <span className="text-[11px] font-mono font-semibold text-[var(--kt-text-primary)]">CPU {cpu}</span>
                    <span className="text-[9px] text-[var(--kt-text-tertiary)]">{cpuEvents.length} 次切换</span>
                  </div>

                  <div className="relative h-8 rounded-[var(--radius-sm)] bg-[var(--kt-bg-tertiary)]/40 overflow-hidden">
                    {cpuEvents.map((e, i) => {
                      const t = new Date(e.timestamp).getTime();
                      const left = ((t - timeRange[0]) / span) * 100;
                      const nextEvent = cpuEvents[i + 1];
                      const durationMs = nextEvent ? new Date(nextEvent.timestamp).getTime() - t : 1;
                      const width = Math.max((Math.max(durationMs, 1) / span) * 100, 0.5);
                      return (
                        <div
                          key={i}
                          className="absolute top-1 bottom-1 rounded-sm border border-white/10"
                          style={{
                            left: left + "%",
                            width: width + "%",
                            backgroundColor: threadColors[e.next_tid] || CPU_COLORS[e.next_tid % CPU_COLORS.length],
                            opacity: 0.9,
                          }}
                          title={`T${e.prev_tid} → T${e.next_tid} (${reasonLabel(e.prev_state)})`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="border-t border-[var(--kt-border)]/30 pt-3"
            >
              <div className="flex items-center gap-2 mb-2">
                <ArrowRightLeft size={12} className="text-[var(--kt-cyan)]" />
                <span className="text-xs font-medium text-[var(--kt-text-primary)]">上下文切换详情</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-left text-[var(--kt-text-tertiary)] border-b border-[var(--kt-border)]/20">
                      <th className="py-1 pr-3">时间</th>
                      <th className="py-1 pr-2">CPU</th>
                      <th className="py-1 pr-2">From</th>
                      <th className="py-1 pr-2">→</th>
                      <th className="py-1 pr-2">To</th>
                      <th className="py-1 pr-2">原因</th>
                      <th className="py-1">迁移</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedTable.map((row) => (
                      <tr key={row.id} className="border-b border-[var(--kt-border)]/10 font-mono">
                        <td className="py-1 pr-3 text-[var(--kt-text-tertiary)]">{row.timestamp}</td>
                        <td className="py-1 pr-2">{row.cpu}</td>
                        <td className="py-1 pr-2 text-[var(--kt-amber)]">T{row.prev}</td>
                        <td className="py-1 pr-2 text-[var(--kt-text-tertiary)]">→</td>
                        <td className="py-1 pr-2 text-[var(--kt-green)]">T{row.next}</td>
                        <td className="py-1 pr-2">
                          <span style={{ color: row.reasonColor }}>
                            {row.reason}
                          </span>
                        </td>
                        <td className="py-1">
                          {row.isMigration ? (
                            <span className="text-[var(--kt-purple)]">⚠️</span>
                          ) : (
                            <span className="text-[var(--kt-text-tertiary)]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>

            <div className="bg-[var(--kt-bg-elevated)] border border-[var(--kt-cyan-dim)] rounded-[var(--radius-sm)] p-2.5 flex items-start gap-2">
              <AlertTriangle size={14} className="text-[var(--kt-cyan)] shrink-0 mt-0.5" />
              <div className="text-[10px] text-[var(--kt-text-secondary)] leading-relaxed">
                <strong>教学提示:</strong> 频繁的上下文切换会降低性能。当前切换率 {avgSwitchRate.toFixed(0)}/s。
                非自愿切换占比 {stats ? ((stats.involuntary / stats.total) * 100).toFixed(0) : 0}%，
                {stats && stats.involuntary > stats.voluntary ? "主要来自时间片到期，属于正常调度行为。" : "自愿切换较多，说明程序频繁阻塞等待 I/O 或锁。"}
                {stats && stats.migrations > 0 ? ` ${stats.migrations} 次 CPU 迁移可能影响缓存局部性。` : ""}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
