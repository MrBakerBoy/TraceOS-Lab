"use client";

import React, { useMemo } from "react";
import { Link2, AlertTriangle, ArrowUpRight, Bug, Lightbulb } from "lucide-react";
import { useEChart } from "@/hooks/useEChart";
import { useEbpfTheme } from "@/hooks/useEbpfTheme";
import type { SyscallTrace } from "@/types/ebpf";

// ── Causal chain detection patterns ──

interface CausalChain {
  id: string;
  rootCause: string;
  rootIndex: number;
  chain: CausalStep[];
  severity: "critical" | "warning" | "info";
  summary: string;
  teachingNote: string;
}

interface CausalStep {
  index: number;
  syscall: string;
  role: string; // "root_cause" | "effect" | "consequence"
  description: string;
  evidence: string;
}

interface Props {
  traces: SyscallTrace[];
}

export default function CausalChainView({ traces }: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const theme = useEbpfTheme(containerRef);

  const chains = useMemo(() => detectCausalChains(traces), [traces]);

  const chartRef = useEChart(() => {
    if (chains.length === 0) {
      return {
        title: { text: "未检测到因果链", left: "center", top: "center",
          textStyle: { color: theme.textTer, fontSize: 13 } },
      };
    }

    const sankeyNodes: any[] = [];
    const sankeyLinks: any[] = [];
    const nodeMap = new Map<string, number>();

    const addNode = (name: string) => {
      if (!nodeMap.has(name)) {
        nodeMap.set(name, sankeyNodes.length);
        sankeyNodes.push({ name });
      }
      return nodeMap.get(name)!;
    };

    for (const chain of chains.slice(0, 5)) {
      const severityColor = chain.severity === "critical" ? theme.red :
                            chain.severity === "warning" ? theme.amber : theme.textTer;
      for (let i = 0; i < chain.chain.length - 1; i++) {
        const src = addNode(chain.chain[i].role === "root_cause"
          ? `🔴 ${chain.chain[i].syscall}`
          : chain.chain[i].syscall);
        const dst = addNode(chain.chain[i + 1].syscall);
        sankeyLinks.push({ source: src, target: dst, value: 1,
          lineStyle: { color: severityColor, opacity: 0.6 } });
      }
    }

    return {
      tooltip: { trigger: "item" },
      series: [{
        type: "sankey",
        layout: "none",
        emphasis: { focus: "adjacency" },
        nodeAlign: "left",
        data: sankeyNodes,
        links: sankeyLinks,
        label: { fontSize: 9, color: theme.text },
        lineStyle: { color: "gradient", curveness: 0.5 },
      }],
    };
  }, [chains, theme]);

  if (traces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-[var(--kt-text-tertiary)] text-xs space-y-2">
        <Link2 className="size-8 opacity-30" />
        <p>暂无追踪数据用于因果链分析</p>
        <p className="text-[10px]">因果链分析需要 syscall 追踪数据，提交代码并运行后可自动检测</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {chains.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-[var(--kt-text-tertiary)] text-xs space-y-2">
          <Link2 className="size-10 opacity-20" />
          <p className="text-sm">未检测到因果链</p>
          <p className="text-[10px] max-w-xs text-center">
            系统未发现明显的因果关系模式（如 fd 提前关闭、遗漏 wait 等）。
            这通常是好事 — 表示程序行为正常。
          </p>
        </div>
      ) : (
        <>
          {/* Sankey diagram */}
          <div className="border border-[var(--kt-border)] rounded-lg bg-[var(--kt-bg-card)] p-3">
            <h4 className="text-[11px] font-semibold text-[var(--kt-text)] mb-2 flex items-center gap-1.5">
              <Link2 className="size-3 text-[var(--kt-cyan)]" />
              因果链 Sankey 图
              <span className="text-[var(--kt-text-tertiary)] font-normal text-[10px]">
                · 根因 → 影响 → 后果
              </span>
            </h4>
            <div ref={chartRef} className="h-[300px]" />
          </div>

          {/* Chain details */}
          <div className="space-y-3">
            {chains.map((chain) => (
              <div key={chain.id}
                className={`border rounded-lg overflow-hidden ${
                  chain.severity === "critical"
                    ? "border-red-400/30 bg-red-500/5"
                    : chain.severity === "warning"
                    ? "border-amber-400/20 bg-amber-500/5"
                    : "border-[var(--kt-border)] bg-[var(--kt-bg-card)]"
                }`}>
                {/* Chain header */}
                <div className="px-4 py-3 flex items-center gap-2 border-b border-inherit">
                  {chain.severity === "critical" ? (
                    <Bug className="size-4 text-[var(--kt-red)]" />
                  ) : chain.severity === "warning" ? (
                    <AlertTriangle className="size-4 text-[var(--kt-amber)]" />
                  ) : (
                    <Lightbulb className="size-4 text-[var(--kt-cyan)]" />
                  )}
                  <span className="text-[11px] font-semibold text-[var(--kt-text)]">
                    {chain.summary}
                  </span>
                </div>

                {/* Chain steps */}
                <div className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {chain.chain.map((step, si) => (
                      <React.Fragment key={si}>
                        {si > 0 && (
                          <ArrowUpRight className="size-3 text-[var(--kt-text-tertiary)] mx-0.5 shrink-0" />
                        )}
                        <div
                          className={`px-3 py-2 rounded-lg text-[11px] border ${
                            step.role === "root_cause"
                              ? "border-red-400/30 bg-red-500/10 text-[var(--kt-red)]"
                              : step.role === "effect"
                              ? "border-amber-400/20 bg-amber-500/10 text-[var(--kt-amber)]"
                              : "border-[var(--kt-border)] bg-[var(--kt-bg-elevated)] text-[var(--kt-text-secondary)]"
                          }`}>
                          <div className="font-mono font-semibold">{step.syscall}</div>
                          <div className="text-[9px] opacity-70 mt-0.5">{step.description}</div>
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                  <p className="text-[10px] text-[var(--kt-text-secondary)] mt-3 italic">
                    💡 {chain.teachingNote}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Causal chain detector ──

function detectCausalChains(traces: SyscallTrace[]): CausalChain[] {
  const chains: CausalChain[] = [];
  const names = traces.map(t => t.syscall_name || "");
  let chainId = 0;

  // Pattern 1: early close → read EBADF
  for (let i = 0; i < names.length - 1; i++) {
    if (names[i] === "close" && (names[i + 1] === "read" || names[i + 1] === "write")) {
      chains.push({
        id: `chain_${chainId++}`,
        rootCause: "close() 过早关闭文件描述符",
        rootIndex: i,
        severity: "warning",
        summary: `close → ${names[i+1]}: FD 提前关闭导致后续 I/O 失败`,
        chain: [
          { index: i, syscall: "close()", role: "root_cause", description: "过早关闭 fd",
            evidence: "在 I/O 操作之前调用" },
          { index: i + 1, syscall: `${names[i+1]}()`, role: "effect", description: `尝试使用已关闭的 fd`,
            evidence: "返回 EBADF (Bad file descriptor)" },
        ],
        teachingNote: "文件描述符关闭后无法恢复。检查 close() 的位置是否太早，或确认 fd 编号是否正确。",
      });
    }
  }

  // Pattern 2: fork without wait → zombie
  let hasClone = false;
  let cloneIdx = -1;
  let hasWait = false;

  for (let i = 0; i < names.length; i++) {
    if (names[i] === "clone") { hasClone = true; cloneIdx = i; }
    if (names[i] === "wait4") { hasWait = true; }
  }

  if (hasClone && !hasWait) {
    chains.push({
      id: `chain_${chainId++}`,
      rootCause: "clone() 后缺少 wait()",
      rootIndex: cloneIdx,
      severity: "warning",
      summary: "clone → 缺 wait: 可能产生僵尸进程",
      chain: [
        { index: cloneIdx, syscall: "clone()", role: "root_cause", description: "创建子进程",
          evidence: "PID 出现在 traces 中" },
        { index: -1, syscall: "缺 wait4()", role: "effect", description: "父进程未等待子进程退出",
          evidence: "trace 中未发现 wait4/waitpid 调用" },
        { index: -1, syscall: "僵尸进程", role: "consequence", description: "子进程退出后停留为僵尸",
          evidence: "进程表条目被占用" },
      ],
      teachingNote: "fork()/clone() 后应调用 wait() 或 waitpid() 回收子进程。也可使用 signal(SIGCHLD, SIG_IGN) 自动回收。",
    });
  }

  // Pattern 3: consecutive open without close → fd leak
  let openCount = 0;
  let closeCount = 0;
  let openStart = -1;

  for (let i = 0; i < names.length; i++) {
    if (names[i].startsWith("open")) { openCount++; if (openStart < 0) openStart = i; }
    if (names[i] === "close") closeCount++;
  }

  if (openCount >= 3 && closeCount < openCount) {
    chains.push({
      id: `chain_${chainId++}`,
      rootCause: "重复 open 未匹配 close",
      rootIndex: openStart,
      severity: "warning",
      summary: `${openCount}次 open → ${closeCount}次 close: fd 泄漏风险`,
      chain: [
        { index: openStart, syscall: `openat() x${openCount}`, role: "root_cause", description: `打开了 ${openCount} 个文件`,
          evidence: `trace 中发现 ${openCount} 次 openat` },
        { index: -1, syscall: `close() x${closeCount}`, role: "effect", description: `仅关闭了 ${closeCount} 个`,
          evidence: `缺少 ${openCount - closeCount} 次 close` },
        { index: -1, syscall: "FD 泄漏", role: "consequence", description: `${openCount - closeCount} 个 fd 泄漏`,
          evidence: "fd 数量持续增长不回收" },
      ],
      teachingNote: "每次 open 必须有对应的 close。在循环中 open 文件时，确保在每次迭代中 close，或者使用 RAII 风格(如 Go 的 defer)。",
    });
  }

  // Pattern 4: consecutive small writes → poor perf
  let writeCount = 0;
  let writeStart = -1;

  for (let i = 0; i < names.length; i++) {
    if (names[i] === "write") { writeCount++; if (writeStart < 0) writeStart = i; }
  }

  if (writeCount >= 5) {
    chains.push({
      id: `chain_${chainId++}`,
      rootCause: "频繁小 write 调用",
      rootIndex: writeStart,
      severity: "info",
      summary: `${writeCount}次 write: 建议缓冲批量写入`,
      chain: [
        { index: writeStart, syscall: `write() x${writeCount}`, role: "root_cause", description: `${writeCount} 次独立 write`,
          evidence: "每次 write 都有上下文切换开销" },
        { index: -1, syscall: "性能降低", role: "consequence", description: "系统调用开销累积",
          evidence: "用户态↔内核态频繁切换" },
      ],
      teachingNote: "多次小 write 会产生不必要的系统调用开销。使用缓冲区批量写入(如 setvbuf 或 sprintf + 单次 write)可显著提升性能。",
    });
  }

  return chains;
}
