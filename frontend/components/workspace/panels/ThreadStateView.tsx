"use client";

import React, { useMemo } from "react";
import { PanelHeader } from "@/components/ui/panel-header";
import ViewHelpButton from "@/components/ui/ViewHelpButton";
import { THREADSTATE_HELP } from "@/lib/view-help-content";
import { Activity } from "lucide-react";

interface SyscallTrace {
  time: string;
  submission_id: string;
  pid: number;
  tid?: number;
  args?: Record<string, unknown>;
  syscall_name: string;
  return_value: number;
  error_name: string;
  duration_ns: number;
}

type ThreadState = "running" | "blocked" | "waiting" | "sleeping" | "zombie";

const STATE_COLORS: Record<ThreadState, string> = {
  running: "var(--kt-green)",
  blocked: "var(--kt-red)",
  waiting: "var(--kt-amber)",
  sleeping: "var(--kt-purple)",
  zombie: "var(--kt-text-tertiary)",
};

const STATE_LABELS: Record<ThreadState, string> = {
  running: "运行",
  blocked: "阻塞",
  waiting: "等待",
  sleeping: "睡眠",
  zombie: "退出",
};

// Blocking syscalls
const BLOCKING_SYSCALLS = new Set([
  "read", "write", "open", "close", "fsync", "fdatasync",
  "poll", "select", "epoll_wait", "wait4", "waitpid",
  "connect", "accept", "recv", "recvfrom", "send", "sendto",
  "flock", "fcntl", "ioctl",
]);

// Lock-related syscalls
const LOCKING_SYSCALLS = new Set([
  "futex", "pthread_mutex_lock", "pthread_mutex_trylock",
  "sem_wait", "sem_timedwait",
]);

// Sleep
const SLEEP_SYSCALLS = new Set(["nanosleep", "clock_nanosleep", "sleep", "usleep", "epoll_wait"]);

function inferState(syscall: string): ThreadState {
  if (SLEEP_SYSCALLS.has(syscall)) return "sleeping";
  if (LOCKING_SYSCALLS.has(syscall)) return "waiting";
  if (BLOCKING_SYSCALLS.has(syscall)) return "blocked";
  return "running";
}

function isExit(name: string): boolean {
  return name === "exit" || name === "exit_group";
}

interface ThreadStateData {
  tid: number;
  states: { state: ThreadState; label: string; startMs: number; durationMs: number }[];
  stats: Record<ThreadState, { count: number; totalMs: number; pct: number }>;
  totalMs: number;
}

function analyzeThreadStates(traces: SyscallTrace[]): ThreadStateData[] {
  // Group by TID
  const threadMap = new Map<number, SyscallTrace[]>();
  for (const t of traces) {
    const key = t.tid ?? t.pid;
    if (!threadMap.has(key)) threadMap.set(key, []);
    threadMap.get(key)!.push(t);
  }

  const results: ThreadStateData[] = [];

  for (const [tid, trs] of threadMap) {
    const sorted = [...trs].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    if (!sorted.length) continue;

    const minTime = new Date(sorted[0].time).getTime();
    const maxTime = new Date(sorted[sorted.length - 1].time).getTime() + (sorted[sorted.length - 1].duration_ns / 1e6);
    const totalMs = maxTime - minTime;

    const states: ThreadStateData["states"] = [];
    const stats: Record<ThreadState, { count: number; totalMs: number }> = {
      running: { count: 0, totalMs: 0 },
      blocked: { count: 0, totalMs: 0 },
      waiting: { count: 0, totalMs: 0 },
      sleeping: { count: 0, totalMs: 0 },
      zombie: { count: 0, totalMs: 0 },
    };

    for (const t of sorted) {
      const s = inferState(t.syscall_name);
      const startMs = new Date(t.time).getTime() - minTime;
      const durMs = t.duration_ns / 1e6;

      states.push({
        state: s,
        label: t.syscall_name,
        startMs,
        durationMs: durMs,
      });

      stats[s].count++;
      stats[s].totalMs += durMs;
    }

    // Add exit state if last call is exit
    const lastCall = sorted[sorted.length - 1];
    if (isExit(lastCall.syscall_name)) {
      stats.zombie.count++;
    }

    const statsWithPct: ThreadStateData["stats"] = {} as ThreadStateData["stats"];
    for (const [state, s] of Object.entries(stats)) {
      statsWithPct[state as ThreadState] = {
        count: s.count,
        totalMs: s.totalMs,
        pct: totalMs > 0 ? (s.totalMs / totalMs) * 100 : 0,
      };
    }

    results.push({ tid, states, stats: statsWithPct, totalMs });
  }

  return results;
}

export default function ThreadStateView({ traces }: { traces: SyscallTrace[] }) {
  const threadData = useMemo(() => analyzeThreadStates(traces), [traces]);

  if (!traces.length) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader icon={Activity} title="线程状态机" subtitle="run/wait/block/sleep" />
        <div className="flex-1 flex items-center justify-center text-[var(--kt-text-tertiary)] text-sm">暂无数据</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        icon={Activity}
        title="线程状态机"
        subtitle={`${threadData.length} 线程 · run/wait/block/sleep`}
        actions={<ViewHelpButton content={THREADSTATE_HELP} />}
      />

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {threadData.map((td) => (
          <div key={td.tid} className="bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)]/30 rounded-[var(--radius-sm)] p-3">
            {/* Thread header */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-mono font-semibold text-[var(--kt-text-primary)]">
                TID {td.tid}
              </span>
              <span className="text-[10px] text-[var(--kt-text-tertiary)]">
                {td.totalMs >= 1000 ? `${(td.totalMs / 1000).toFixed(1)}s` : `${td.totalMs.toFixed(1)}ms`}
              </span>
            </div>

            {/* State timeline bar */}
            <div className="h-5 rounded-full bg-[var(--kt-bg-tertiary)] overflow-hidden flex mb-2">
              {td.states.map((s, i) => (
                <div
                  key={i}
                  className="h-full"
                  style={{
                    width: `${td.totalMs > 0 ? (s.durationMs / td.totalMs) * 100 : 5}%`,
                    backgroundColor: STATE_COLORS[s.state],
                    minWidth: 2,
                  }}
                  title={`${s.label}: ${s.durationMs.toFixed(1)}ms [${STATE_LABELS[s.state]}]`}
                />
              ))}
            </div>

            {/* State breakdown */}
            <div className="grid grid-cols-5 gap-1.5">
              {(Object.keys(STATE_LABELS) as ThreadState[]).map((state) => {
                const s = td.stats[state];
                const active = s && s.count > 0;
                return (
                  <div
                    key={state}
                    className={`text-center rounded-md py-1.5 transition-colors ${
                      active ? "bg-[var(--kt-bg-tertiary)]" : "opacity-30"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ backgroundColor: STATE_COLORS[state] }}
                      />
                      <span className="text-[10px] font-medium text-[var(--kt-text-secondary)]">
                        {STATE_LABELS[state]}
                      </span>
                    </div>
                    <div className="text-xs font-mono font-bold text-[var(--kt-text-primary)]">
                      {active ? `${s.pct.toFixed(0)}%` : "—"}
                    </div>
                    <div className="text-[9px] text-[var(--kt-text-tertiary)]">
                      {active ? `${s.count}次` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
