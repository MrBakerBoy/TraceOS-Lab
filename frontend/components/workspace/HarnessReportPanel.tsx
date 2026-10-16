"use client";

import React, { useState } from "react";
import type { HarnessDiagnosisReport, AgentResultInfo } from "@/types/harness";
import { motion } from "framer-motion";
import {
  Layers, BarChart3, AlertTriangle,
  CheckCircle2, XCircle, Clock, BrainCircuit,
  ChevronDown, Activity, FileWarning, MemoryStick, GitBranch, Gauge,
} from "lucide-react";

const AGENT_LABELS: Record<string, string> = {
  code_analyzer: "代码分析",
  test_evaluator: "测试结果",
  syscall_analyzer: "系统调用",
  resource_analyzer: "内核资源",
  concept_rubric: "概念映射",
  report_generator: "报告聚合",
};

function ConceptBars({ concepts }: { concepts: Record<string, number> }) {
  const entries = Object.entries(concepts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      {entries.map(([name, score]) => (
        <div key={name} className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--kt-text-secondary)] w-28 truncate" title={name}>{name}</span>
          <div className="flex-1 h-1.5 rounded-full bg-[var(--kt-bg-surface)] overflow-hidden">
            <motion.div className="h-full rounded-full" initial={{ width: 0 }}
              animate={{ width: (score / 2) * 100 + "%" }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              style={{ background: score >= 2 ? "linear-gradient(90deg, #22c55e, #3b82f6)" : "linear-gradient(90deg, #f97316, #eab308)" }} />
          </div>
          <span className="text-[10px] font-mono text-[var(--kt-text-tertiary)] w-6 text-right">
            {score >= 2 ? "达标" : "待加强"}
          </span>
        </div>
      ))}
    </div>
  );
}

function AgentTab({ agent }: { agent: AgentResultInfo }) {
  const [open, setOpen] = useState(false);
  const label = AGENT_LABELS[agent.agent_name] || agent.agent_name;
  return (
    <div className="border-b border-[var(--kt-border)] last:border-0">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--kt-border)]/20 transition-colors text-left">
        {agent.status === "completed" ? <CheckCircle2 className="size-3 text-green-400" />
          : agent.status === "failed" ? <XCircle className="size-3 text-red-400" />
          : <Clock className="size-3 text-yellow-400" />}
        <span className="text-[11px] font-medium text-[var(--kt-text)]">{label}</span>
        <span className="text-[10px] text-[var(--kt-text-tertiary)] ml-auto">{agent.tokens_used} tok</span>
        <div className="flex items-center gap-1">
          <div className="w-10 h-1 rounded-full bg-[var(--kt-bg-surface)] overflow-hidden">
            <div className="h-full rounded-full bg-blue-500" style={{ width: Math.round(agent.confidence * 100) + "%" }} />
          </div>
          <span className="text-[9px] text-[var(--kt-text-tertiary)]">{Math.round(agent.confidence * 100)}%</span>
        </div>
        <ChevronDown className={"size-3 text-[var(--kt-text-tertiary)] transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && agent.findings_summary.length > 0 && (
        <div className="px-3 pb-2 pl-8">
          {agent.findings_summary.map((f, i) => (
            <div key={i} className="text-[10px] text-[var(--kt-text-secondary)] py-0.5 flex items-start gap-1">
              <span className="text-blue-400 mt-0.5">&bull;</span><span>{f}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KernelFinding({ icon, title, detail, severity }: {
  icon: React.ReactNode; title: string; detail: string; severity: "critical" | "warning";
}) {
  const isCritical = severity === "critical";
  return (
    <div className="flex items-start gap-2.5 p-2.5 rounded-lg border"
      style={{
        background: isCritical ? "rgba(255,55,95,0.06)" : "rgba(255,159,10,0.06)",
        borderColor: isCritical ? "rgba(255,55,95,0.25)" : "rgba(255,159,10,0.25)",
      }}>
      <span className="shrink-0 mt-0.5" style={{ color: isCritical ? "#FF375F" : "#FF9F0A" }}>{icon}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold" style={{ color: isCritical ? "#FF375F" : "#FF9F0A" }}>{title}</span>
          <span className="text-[8px] px-1 py-0.5 rounded font-medium uppercase tracking-wider"
            style={{ color: "#0A84FF", background: "rgba(10,132,255,0.1)", border: "1px solid rgba(10,132,255,0.2)" }}>
            内核级观测发现
          </span>
        </div>
        <p className="text-[10px] text-[var(--kt-text-secondary)] mt-1 leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}

interface HarnessReportPanelProps { report: HarnessDiagnosisReport; }

export default function HarnessReportPanel({ report }: HarnessReportPanelProps) {
  const [tab, setTab] = useState<"observations" | "agents" | "concepts">("observations");

  const obs = report.observations || {};
  const qualified = report.is_qualified ?? Boolean(obs.is_qualified);
  const coreScore = report.core_score ?? Number(obs.core_score ?? 0);
  const edgeScore = report.edge_score ?? Number(obs.edge_score ?? 0);
  const passed = Number(obs.passed_cases ?? 0);
  const total = Number(obs.total_cases ?? 0);

  const fdLeak = Number(obs.fd_leak ?? 0);
  const memDiff = Number(obs.mmap_munmap_diff ?? 0);
  const forkDiff = Number(obs.fork_wait_diff ?? 0);
  const deadlock = Boolean(obs.deadlock ?? false);

  const kernelFindings: Array<{ icon: React.ReactNode; title: string; detail: string; severity: "critical" | "warning" }> = [];
  if (deadlock) kernelFindings.push({ icon: <AlertTriangle className="size-4" />, title: "检测到死锁", detail: "内核观测到锁等待环，请检查加锁顺序与互斥锁配对。", severity: "critical" });
  if (forkDiff > 0) kernelFindings.push({ icon: <GitBranch className="size-4" />, title: `子进程未回收（${forkDiff}）`, detail: "fork 与 wait 计数不匹配，子进程退出后可能成为僵尸进程。请为每个 fork 的进程添加 wait/waitpid 回收。", severity: "critical" });
  if (fdLeak > 0) kernelFindings.push({ icon: <FileWarning className="size-4" />, title: `文件描述符泄漏（${fdLeak}）`, detail: "open 与 close 计数不匹配，存在未关闭的文件描述符。请检查每个 open/openat/socket 是否有配对的 close。", severity: "warning" });
  if (memDiff > 0) kernelFindings.push({ icon: <MemoryStick className="size-4" />, title: `内存分配未释放（${memDiff}）`, detail: "内存分配与释放计数不匹配。请检查 malloc/mmap 是否有配对的 free/munmap。", severity: "warning" });

  const accentColor = qualified ? "#22c55e" : "#ef4444";

  return (
    <div className="space-y-3">
      {/* Header: Core 真值 + 置信度 */}
      <div className="flex items-center justify-between p-3 rounded-xl"
        style={{ background: "var(--kt-bg-surface)", border: "1px solid var(--kt-border)" }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(168,85,247,0.2))" }}>
            <BrainCircuit className="size-4" style={{ color: "#3b82f6" }} />
          </div>
          <div>
            <span className="text-[10px] text-[var(--kt-text-tertiary)] uppercase tracking-wider">Multi-Agent Diagnosis</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm font-bold tabular-nums" style={{ color: accentColor }}>
                {qualified ? "已达标" : "未达标"}
              </span>
              <span className="text-[10px] text-[var(--kt-text-tertiary)]">
                Core {coreScore.toFixed(0)}<span className="opacity-60">/100</span>
                {edgeScore > 0 && <span className="ml-1">· 边界 {edgeScore.toFixed(0)}</span>}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-[var(--kt-text-tertiary)]">
            conf {(report.confidence * 100).toFixed(0)}% · agree {(report.agent_agreement * 100).toFixed(0)}%
          </div>
          {report.requires_review && (
            <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded mt-1"
              style={{ color: "#f97316", background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.3)" }}>
              <AlertTriangle className="size-2.5" /> Review
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 p-0.5 rounded-lg bg-[var(--kt-bg-surface)]">
        {[
          ["observations", Activity, "观测"],
          ["agents", Layers, "Agents(" + report.agent_results.length + ")"],
          ["concepts", BarChart3, "概念"],
        ].map(([key, Icon, label]) => (
          <button key={key as string} onClick={() => setTab(key as any)}
            className={"flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-medium transition-all "
              + (tab === key ? "bg-blue-500/15 text-blue-400" : "text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text-secondary)]")}>
            <Icon className="size-3" />{label}
          </button>
        ))}
      </div>

      {/* Observations tab: Core 真值 + 内核级观测发现 */}
      {tab === "observations" && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="space-y-2">
          <div className="p-3 rounded-xl" style={{ background: "var(--kt-bg-surface)", border: "1px solid var(--kt-border)" }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Gauge className="size-3.5" style={{ color: "#0A84FF" }} />
              <span className="text-[10px] uppercase tracking-wider text-[var(--kt-text-tertiary)] font-medium">评测结果</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--kt-text-secondary)]">
              <span>测试通过 <strong className="tabular-nums">{passed}/{total}</strong></span>
              {total > 0 && <span>通过率 <strong className="tabular-nums">{Math.round((passed / total) * 100)}%</strong></span>}
            </div>
          </div>

          <div className="p-3 rounded-xl space-y-2" style={{ background: "var(--kt-bg-surface)", border: "1px solid var(--kt-border)" }}>
            <div className="flex items-center gap-1.5">
              <Activity className="size-3.5" style={{ color: "#BF5AF2" }} />
              <span className="text-[10px] uppercase tracking-wider text-[var(--kt-text-tertiary)] font-medium">内核级观测</span>
            </div>
            {kernelFindings.length > 0 ? (
              kernelFindings.map((f, i) => <KernelFinding key={i} {...f} />)
            ) : (
              <p className="text-[11px] text-[var(--kt-text-tertiary)]">未发现文件描述符泄漏、内存不平衡、僵尸进程或死锁。</p>
            )}
          </div>
        </motion.div>
      )}

      {/* Agents tab: 四维诊断 Agent 结果 */}
      {tab === "agents" && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-xl overflow-hidden" style={{ background: "var(--kt-bg-surface)", border: "1px solid var(--kt-border)" }}>
          {report.agent_results.length === 0
            ? <p className="text-[11px] text-[var(--kt-text-tertiary)] text-center py-4">暂无 Agent 结果。</p>
            : report.agent_results.map((agent, i) => <AgentTab key={i} agent={agent} />)}
        </motion.div>
      )}

      {/* Concepts tab: 概念达成度 */}
      {tab === "concepts" && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl" style={{ background: "var(--kt-bg-surface)", border: "1px solid var(--kt-border)" }}>
          {Object.keys(report.concept_radar).length > 0
            ? <ConceptBars concepts={report.concept_radar} />
            : <p className="text-[11px] text-[var(--kt-text-tertiary)] text-center py-4">暂无概念数据。</p>}
        </motion.div>
      )}

      {/* Key issues */}
      {report.weakness_points.length > 0 && (
        <div className="p-3 rounded-xl space-y-1.5"
          style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.15)" }}>
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="size-3 text-red-400" />
            <span className="text-[10px] font-medium text-red-400 uppercase tracking-wider">关键问题</span>
          </div>
          {report.weakness_points.slice(0, 5).map((w, i) => (
            <div key={i} className="text-[10px] text-[var(--kt-text-secondary)] flex items-start gap-1.5">
              <span className="text-red-400 mt-0.5 shrink-0">&bull;</span><span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}