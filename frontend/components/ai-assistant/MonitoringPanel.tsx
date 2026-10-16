"use client";

import { useState, useEffect } from "react";
import { useAIAssistantStore } from "@/stores/ai-assistant";
import { cn } from "@/lib/utils";
import { useChatTheme } from "@/hooks/useChatTheme";
import type { ChatThemeColors } from "@/lib/chat-theme";
import {
  Activity, Brain, Shield, History, Layers,
  Cpu, Wrench, BookOpen, Eye, Gauge, Sparkles,
  ChevronRight, AlertTriangle, CheckCircle2, Loader2,
} from "lucide-react";

type TabKey = "pipeline" | "memory" | "context" | "rag";

const TABS: { key: TabKey; label: string; icon: React.ReactNode; color: string }[] = [
  { key: "pipeline", label: "Agent 管道", icon: <Activity className="size-3.5" />, color: "#6366F1" },
  { key: "memory", label: "记忆系统", icon: <Brain className="size-3.5" />, color: "#8B5CF6" },
  { key: "context", label: "上下文", icon: <Shield className="size-3.5" />, color: "#F59E0B" },
  { key: "rag", label: "RAG", icon: <History className="size-3.5" />, color: "#10B981" },
];

const PIPELINE_STAGES = [
  { key: "E", label: "执行层", desc: "nsjail 工具沙箱", color: "#10B981", icon: "⬡" },
  { key: "T", label: "工具层", desc: "MCP 工具注册", color: "#06B6D4", icon: "⬡" },
  { key: "C", label: "上下文层", desc: "Token 防火墙", color: "#F59E0B", icon: "⬡" },
  { key: "L", label: "生命周期", desc: "混合编排", color: "#3B82F6", icon: "⬡" },
  { key: "O", label: "可观测层", desc: "Trace 追踪", color: "#8B5CF6", icon: "⬡" },
  { key: "V", label: "校验层", desc: "LLM-as-Judge", color: "#F43F5E", icon: "⬡" },
  { key: "G", label: "治理层", desc: "输入/输出护栏", color: "#F97316", icon: "⬡" },
];

export default function MonitoringPanel({ experimentId }: { experimentId: string }) {
  const { monitoring, startPolling, stopPolling, ragHistory } = useAIAssistantStore();
  const theme = useChatTheme();
  const [activeTab, setActiveTab] = useState<TabKey>("pipeline");

  useEffect(() => {
    startPolling(experimentId);
    return () => stopPolling();
  }, [experimentId]);

  return (
    <div className="w-full h-full bg-card/50 backdrop-blur-sm border-l border-border/50 flex flex-col">
      {/* Header */}
      <div className="h-12 flex items-center px-3 border-b border-border/30 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-indigo-500" />
          <span className="text-[13px] font-semibold" style={{ color: theme.textPrimary }}>实时监控</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/20 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-all relative",
              activeTab === tab.key
                ? "text-foreground"
                : ""
            )}
            style={{ color: activeTab === tab.key ? undefined : theme.textTertiary }}
          >
            <span style={{ color: activeTab === tab.key ? tab.color : undefined }}>{tab.icon}</span>
            {tab.label}
            {activeTab === tab.key && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background: tab.color }} />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "pipeline" && <PipelineTab stages={monitoring.agentPipeline} theme={theme} />}
        {activeTab === "memory" && <MemoryTab memory={monitoring.memory} theme={theme} />}
        {activeTab === "context" && <ContextTab budget={monitoring.tokenBudget} theme={theme} />}
        {activeTab === "rag" && <RAGTab queries={ragHistory} theme={theme} />}
      </div>
    </div>
  );
}

/* ── Pipeline Tab ── */
function PipelineTab({ stages, theme }: { stages: any[]; theme: ChatThemeColors }) {
  return (
    <div className="p-3 space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider px-1 mb-1" style={{ color: theme.textSecondary }}>
        ETCLOVG 7层管道
      </p>
      {PIPELINE_STAGES.map((stage, i) => {
        const live = stages[i];
        const statusColor =
          live?.status === "done" ? "#10B981" :
          live?.status === "running" ? stage.color :
          live?.status === "error" ? "#F43F5E" : "#6B7280";
        const statusBg =
          live?.status === "done" ? "rgba(16,185,129,0.08)" :
          live?.status === "running" ? stage.color + "14" :
          live?.status === "error" ? "rgba(244,63,94,0.08)" : "rgba(107,114,128,0.05)";

        return (
          <div
            key={stage.key}
            className="flex items-center gap-3 p-3 rounded-xl border transition-all duration-300 hover:scale-[1.01]"
            style={{ borderColor: live?.status === "running" ? stage.color + "30" : "var(--border-default)", background: statusBg }}
          >
            {/* Stage indicator */}
            <div
              className="size-9 rounded-lg flex items-center justify-center shrink-0 font-bold text-[14px] transition-all"
              style={{
                background: live?.status === "running" ? `linear-gradient(135deg, ${stage.color}, ${stage.color}cc)` : stage.color + "14",
                color: live?.status === "running" ? "#fff" : stage.color,
                border: `1px solid ${stage.color}30`,
              }}
            >
              {stage.key}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold">{stage.label}</span>
                <StatusBadge status={live?.status} />
              </div>
              <p className="text-[10px] text-muted-foreground truncate">{stage.desc}</p>
            </div>

            {/* Metrics */}
            <div className="text-right shrink-0">
              {live?.latencyMs && (
                <p className="text-[11px] font-mono font-medium" style={{ color: stage.color }}>
                  {live.latencyMs}ms
                </p>
              )}
              {(live?.tokensUsed ?? 0) > 0 && (
                <p className="text-[10px] text-muted-foreground">{live.tokensUsed} tokens</p>
              )}
            </div>

            {/* Connector */}
            {i < PIPELINE_STAGES.length - 1 && (
              <ChevronRight className="size-3 text-muted-foreground/30 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status || status === "idle") return <span className="text-[9px] px-1.5 py-0.5 rounded text-muted-foreground bg-muted/50">待命</span>;
  if (status === "running") return <span className="text-[9px] px-1.5 py-0.5 rounded text-amber-600 bg-amber-500/10 flex items-center gap-1"><Loader2 className="size-2.5 animate-spin" />运行中</span>;
  if (status === "done") return <span className="text-[9px] px-1.5 py-0.5 rounded text-emerald-600 bg-emerald-500/10 flex items-center gap-1"><CheckCircle2 className="size-2.5" />完成</span>;
  if (status === "error") return <span className="text-[9px] px-1.5 py-0.5 rounded text-red-600 bg-red-500/10 flex items-center gap-1"><AlertTriangle className="size-2.5" />错误</span>;
  return null;
}

/* ── Memory Tab ── */
function MemoryTab({ memory, theme }: { memory: any; theme: ChatThemeColors }) {
  const tiers = [
    { ...memory.L0, color: "#6366F1", icon: <Layers className="size-4" /> },
    { ...memory.L1, color: "#8B5CF6", icon: <Brain className="size-4" /> },
    { ...memory.L2, color: "#A78BFA", icon: <BookOpen className="size-4" /> },
    { ...memory.L3, color: "#C4B5FD", icon: <Eye className="size-4" /> },
  ];

  return (
    <div className="p-3 space-y-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider px-1" style={{ color: theme.textSecondary }}>
        4层记忆架构
      </p>
      {tiers.map((tier, i) => (
        <div
          key={i}
          className="p-3 rounded-xl border border-border/30 transition-all hover:scale-[1.02]"
          style={{ background: `linear-gradient(135deg, ${tier.color}08, ${tier.color}03)` }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: tier.color + "14", color: tier.color }}>
              {tier.icon}
            </div>
            <div>
              <p className="text-[12px] font-semibold" style={{ color: tier.color }}>
                L{i} · {tier.label}
              </p>
              <p className="text-[10px] text-muted-foreground">{tier.description}</p>
            </div>
          </div>

          {i === 0 && (
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                <span>Token 用量</span>
                <span>{tier.tokens} / {tier.maxTokens}</span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, (tier.tokens / tier.maxTokens) * 100)}%`,
                    background: `linear-gradient(90deg, ${tier.color}, ${tier.color}cc)`,
                  }}
                />
              </div>
            </div>
          )}

          {i === 1 && (
            <div className="flex gap-3 text-[11px]">
              <span className="px-2 py-1 rounded-lg bg-muted/50" style={{ color: tier.color }}>
                {tier.turns} 轮对话
              </span>
              <span className="px-2 py-1 rounded-lg bg-muted/50" style={{ color: tier.color }}>
                {tier.messageCount} 条消息
              </span>
            </div>
          )}

          {i === 2 && (
            <div className="space-y-1.5">
              {tier.weakTopics?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <span className="text-[10px] text-red-500 font-medium">薄弱:</span>
                  {tier.weakTopics.map((t: string, j: number) => (
                    <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-600">{t}</span>
                  ))}
                </div>
              )}
              {tier.strongTopics?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <span className="text-[10px] text-emerald-500 font-medium">掌握:</span>
                  {tier.strongTopics.map((t: string, j: number) => (
                    <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {i === 3 && (
            <div className="space-y-1">
              {Object.entries(tier.errorPatterns || {}).slice(0, 5).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground truncate flex-1">{k}</span>
                  <span className="text-[10px] font-mono font-medium" style={{ color: tier.color }}>{v as number}次</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Context Firewall Tab ── */
function ContextTab({ budget, theme }: { budget: any; theme: ChatThemeColors }) {
  const pct = budget.total > 0 ? Math.round((budget.used / budget.total) * 100) : 0;
  const gaugeColor = pct > 80 ? "#F43F5E" : pct > 60 ? "#F59E0B" : "#10B981";
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="p-3 space-y-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider px-1" style={{ color: theme.textSecondary }}>
        Token 预算管理
      </p>

      {/* Gauge */}
      <div className="flex flex-col items-center">
        <div className="relative size-28">
          <svg className="size-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="var(--bg-muted)" strokeWidth="8" />
            <circle
              cx="50" cy="50" r="40" fill="none"
              stroke={gaugeColor} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 0.8s ease, stroke 0.8s ease" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold font-mono" style={{ color: gaugeColor }}>{pct}%</span>
            <span className="text-[10px] text-muted-foreground">已使用</span>
          </div>
        </div>

        <div className="flex gap-3 mt-3 text-[10px]">
          <span className="px-2 py-0.5 rounded bg-muted/50">总量 {budget.total.toLocaleString()}</span>
          <span className="px-2 py-0.5 rounded bg-muted/50">已用 {budget.used.toLocaleString()}</span>
        </div>
      </div>

      {/* Watermarks */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium text-muted-foreground">水位线</p>
        {[
          { pct: 60, label: "裁剪预警", active: budget.watermark60, color: "#F59E0B" },
          { pct: 80, label: "紧急裁剪", active: budget.watermark80, color: "#F97316" },
          { pct: 95, label: "强制压缩", active: budget.watermark95, color: "#F43F5E" },
        ].map((wm) => (
          <div key={wm.pct} className="flex items-center gap-2">
            <div className={cn("size-2 rounded-full", wm.active ? "animate-pulse" : "opacity-30")} style={{ background: wm.color }} />
            <span className="text-[11px] text-muted-foreground">{wm.pct}% - {wm.label}</span>
            {wm.active && <span className="text-[9px] text-red-500 font-medium">触发</span>}
          </div>
        ))}
      </div>

      {/* Recent prunings */}
      {budget.recentPrunings?.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground mb-1.5">最近裁剪记录</p>
          {budget.recentPrunings.map((p: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[10px] text-muted-foreground py-0.5">
              <AlertTriangle className="size-3 text-amber-500" />
              <span className="flex-1">{p.reason}</span>
              <span>{p.turnsRemoved}轮</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── RAG Tab ── */
function RAGTab({ queries, theme }: { queries: any[]; theme: ChatThemeColors }) {
  return (
    <div className="p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: theme.textSecondary }}>
          RAG 检索记录
        </p>
        <span className="text-[10px] text-muted-foreground">{queries.length} 条</span>
      </div>

      {queries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <History className="size-8 text-muted-foreground/30 mb-2" />
          <p className="text-[11px] text-muted-foreground">暂无检索记录</p>
        </div>
      ) : (
        queries.slice(0, 15).map((q, i) => (
          <div
            key={q.id || i}
            className="p-2.5 rounded-xl border border-border/30 bg-card-hover hover:border-emerald-500/20 transition-all"
          >
            <p className="text-[11px] font-medium line-clamp-2 mb-1.5">
              {q.query || q.question}
            </p>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              {q.mode && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-medium">
                  {q.mode}
                </span>
              )}
              {q.sources && (
                <span>{q.sources.length} 个来源</span>
              )}
              {q.created_at && (
                <span>{new Date(q.created_at).toLocaleDateString()}</span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}