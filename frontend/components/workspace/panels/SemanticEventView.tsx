"use client";

import React, { useMemo } from "react";
import {
  MessageSquare, AlertTriangle, CheckCircle2, Info,
  Bot,
} from "lucide-react";
import { useEbpfTheme } from "@/hooks/useEbpfTheme";
import type { SyscallTrace } from "@/types/ebpf";

// ── In-browser semantic engine (mirrors backend semantic_engine.go) ──

interface SemanticRule {
  name: string;
  sequence: string[];
  label: string;
  category: string;
  icon: string;
  severity: "info" | "warning" | "critical";
  teachingNote: string;
}

const SEMANTIC_RULES: SemanticRule[] = [
  { name: "fork_exec", sequence: ["clone", "execve"], label: "进程创建与程序加载", category: "process", icon: "🟢", severity: "info", teachingNote: "fork 复制进程，exec 替换程序映像" },
  { name: "fork_wait", sequence: ["clone", "wait4"], label: "创建子进程并等待", category: "process", icon: "🟢", severity: "info", teachingNote: "正确调用 wait() 避免僵尸进程" },
  { name: "fork_no_wait", sequence: ["clone"], label: "创建子进程（缺少 wait）", category: "process", icon: "🟡", severity: "warning", teachingNote: "fork 后未跟随 wait — 可能产生僵尸进程" },
  { name: "pipe_ipc", sequence: ["pipe2", "clone"], label: "管道通信准备", category: "ipc", icon: "🔗", severity: "info", teachingNote: "pipe2 创建管道后 fork，子进程继承 fd" },
  { name: "malloc", sequence: ["brk", "mmap"], label: "动态内存分配", category: "memory", icon: "💾", severity: "info", teachingNote: "brk(小分配) + mmap(大分配) = malloc 底层策略" },
  { name: "leak", sequence: ["brk", "brk", "brk"], label: "堆持续增长（可能泄漏）", category: "memory", icon: "🟡", severity: "warning", teachingNote: "连续 brk 扩展未发现 munmap — 检查 free()" },
  { name: "mem_growth", sequence: ["mmap", "mmap", "mmap"], label: "内存快速增长", category: "memory", icon: "🔴", severity: "critical", teachingNote: "连续大块 mmap 分配 — 检查是否有未释放内存" },
  { name: "deadlock", sequence: ["futex", "futex"], label: "潜在死锁", category: "lock", icon: "🔴", severity: "critical", teachingNote: "连续 futex 等待 — 检查 Coffman 条件" },
  { name: "deadlock3", sequence: ["futex", "futex", "futex"], label: "死锁环", category: "lock", icon: "🔴", severity: "critical", teachingNote: "三个 futex 等待 — 高概率死锁环" },
  { name: "fd_leak", sequence: ["openat", "openat", "openat"], label: "FD 泄漏风险", category: "io", icon: "🟡", severity: "warning", teachingNote: "连续 open 未伴随 close — fd 可能耗尽" },
  { name: "open_close", sequence: ["openat", "close"], label: "文件打开后关闭", category: "io", icon: "📁", severity: "info", teachingNote: "正确的 fd 生命周期管理" },
  { name: "small_io", sequence: ["write", "write", "write"], label: "频繁小 I/O", category: "io", icon: "🟡", severity: "warning", teachingNote: "多次 write 调用 — 考虑缓冲批量写入" },
  { name: "early_close", sequence: ["close", "read"], label: "关闭 fd 后读取", category: "io", icon: "🔴", severity: "warning", teachingNote: "close 后 read 将返回 EBADF" },
  { name: "socket", sequence: ["socket", "bind"], label: "创建并绑定 socket", category: "ipc", icon: "🔗", severity: "info", teachingNote: "网络编程基础：socket→bind→listen→accept" },
  { name: "munmap_ok", sequence: ["mmap", "munmap"], label: "申请后释放", category: "memory", icon: "💾", severity: "info", teachingNote: "mmap 分配后正确 munmap 释放" },
];

interface SemanticEvent {
  startIndex: number;
  endIndex: number;
  label: string;
  category: string;
  icon: string;
  severity: string;
  teachingNote: string;
}

interface Props {
  traces: SyscallTrace[];
}

export default function SemanticEventView({ traces }: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const theme = useEbpfTheme(containerRef);

  const events = useMemo(() => analyzeSemantics(traces), [traces]);

  const catColor = (cat: string) => {
    switch (cat) {
      case "process": return theme.cyan;
      case "memory": return theme.purple;
      case "lock": return theme.red;
      case "io": return theme.amber;
      case "ipc": return theme.green;
      default: return theme.textTer;
    }
  };

  const sevIcon = (sev: string) => {
    switch (sev) {
      case "critical": return <AlertTriangle className="size-3 text-[var(--kt-red)]" />;
      case "warning": return <AlertTriangle className="size-3 text-[var(--kt-amber)]" />;
      default: return <CheckCircle2 className="size-3 text-[var(--kt-green)]" />;
    }
  };

  const stats = useMemo(() => {
    const crit = events.filter(e => e.severity === "critical").length;
    const warn = events.filter(e => e.severity === "warning").length;
    const info = events.filter(e => e.severity === "info").length;
    return { crit, warn, info, total: events.length };
  }, [events]);

  if (traces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-[var(--kt-text-tertiary)] text-xs space-y-2">
        <MessageSquare className="size-8 opacity-30" />
        <p>暂无追踪数据用于语义分析</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        <div className="border border-[var(--kt-border)] rounded-lg bg-[var(--kt-bg-card)] p-3 flex items-center gap-2">
          <Bot className="size-4 text-[var(--kt-cyan)]" />
          <div><div className="text-lg font-bold text-[var(--kt-text)]">{stats.total}</div>
            <div className="text-[10px] text-[var(--kt-text-tertiary)]">识别事件</div></div>
        </div>
        <div className="border border-[var(--kt-border)] rounded-lg bg-[var(--kt-bg-card)] p-3 flex items-center gap-2">
          <AlertTriangle className="size-4 text-[var(--kt-red)]" />
          <div><div className="text-lg font-bold text-[var(--kt-red)]">{stats.crit}</div>
            <div className="text-[10px] text-[var(--kt-text-tertiary)]">严重</div></div>
        </div>
        <div className="border border-[var(--kt-border)] rounded-lg bg-[var(--kt-bg-card)] p-3 flex items-center gap-2">
          <AlertTriangle className="size-4 text-[var(--kt-amber)]" />
          <div><div className="text-lg font-bold text-[var(--kt-amber)]">{stats.warn}</div>
            <div className="text-[10px] text-[var(--kt-text-tertiary)]">警告</div></div>
        </div>
        <div className="border border-[var(--kt-border)] rounded-lg bg-[var(--kt-bg-card)] p-3 flex items-center gap-2">
          <Info className="size-4 text-[var(--kt-green)]" />
          <div><div className="text-lg font-bold text-[var(--kt-green)]">{stats.info}</div>
            <div className="text-[10px] text-[var(--kt-text-tertiary)]">正常</div></div>
        </div>
      </div>

      {/* Event stream */}
      <div className="border border-[var(--kt-border)] rounded-lg bg-[var(--kt-bg-card)] overflow-hidden">
        <h4 className="text-[11px] font-semibold text-[var(--kt-text)] px-3 py-2 border-b border-[var(--kt-border)] flex items-center gap-1.5">
          <MessageSquare className="size-3 text-[var(--kt-cyan)]" />
          语义化事件流
          <span className="text-[var(--kt-text-tertiary)] font-normal text-[10px]">
            · syscall 序列 → 教学语言
          </span>
        </h4>
        <div className="max-h-[500px] overflow-y-auto">
          {events.length === 0 ? (
            <div className="p-6 text-center text-[11px] text-[var(--kt-text-tertiary)]">
              未识别到已知的 OS 语义模式
            </div>
          ) : (
            events.map((evt, i) => (
              <div key={i}
                className="flex gap-3 px-4 py-3 border-b border-[var(--kt-border)]/30 hover:bg-[var(--kt-bg-hover)] transition-colors">
                <div className="mt-0.5 shrink-0">{sevIcon(evt.severity)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] font-medium text-[var(--kt-text)]">
                      {evt.icon} {evt.label}
                    </span>
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded"
                      style={{ background: catColor(evt.category) + "20", color: catColor(evt.category) }}
                    >{evt.category}</span>
                  </div>
                  <p className="text-[10px] text-[var(--kt-text-secondary)] leading-relaxed">
                    {evt.teachingNote}
                  </p>
                  <p className="text-[9px] text-[var(--kt-text-tertiary)] mt-1 font-mono">
                    事件 #{evt.startIndex + 1} – #{evt.endIndex + 1}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function analyzeSemantics(traces: SyscallTrace[]): SemanticEvent[] {
  const events: SemanticEvent[] = [];
  const names = traces.map(t => t.syscall_name || "");

  const used = new Set<number>();

  for (const rule of SEMANTIC_RULES) {
    const seq = rule.sequence;
    if (seq.length === 0 || names.length < seq.length) continue;

    for (let i = 0; i <= names.length - seq.length; i++) {
      let anyUsed = false;
      for (let j = 0; j < seq.length; j++) {
        if (used.has(i + j)) { anyUsed = true; break; }
      }
      if (anyUsed) continue;

      let matched = true;
      for (let j = 0; j < seq.length; j++) {
        if (!names[i + j].startsWith(seq[j])) { matched = false; break; }
      }
      if (matched) {
        for (let j = 0; j < seq.length; j++) used.add(i + j);
        events.push({
          startIndex: i, endIndex: i + seq.length - 1,
          label: rule.label, category: rule.category, icon: rule.icon,
          severity: rule.severity, teachingNote: rule.teachingNote,
        });
        i += seq.length - 1;
      }
    }
  }

  return events;
}
