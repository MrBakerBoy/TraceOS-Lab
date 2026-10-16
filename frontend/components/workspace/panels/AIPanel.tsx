"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { PanelHeader } from "@/components/ui/panel-header";
import { useWorkspaceStore } from "@/stores/workspace";
import { cn } from "@/lib/utils";
import { useChat } from "ai/react";
import {
  Stethoscope, MessageSquare, Sparkles, ChevronRight,
  Lightbulb, Wrench, Code, Cpu, ShieldCheck,
  Zap, Activity, CheckCircle2, XCircle,
  ArrowRight, BookOpen, AlertTriangle,
  Brain, Send, Loader2,
  ChevronDown, ChevronUp, ExternalLink,
  Copy, Check, User, CornerDownLeft, Bot, Trash2,
} from "lucide-react";

/* ============================================================
   AIPanel v4 — Streaming chat + Diagnosis
   mode="diagnosis" | mode="chat"
   ============================================================ */

interface AIPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mode: "diagnosis" | "chat";
}

/* ── Level definitions ── */
const LEVELS = [
  { icon: Lightbulb, label: "基础引导", color: "#0A84FF", bg: "rgba(10,132,255,0.06)", bdr: "rgba(10,132,255,0.18)" },
  { icon: Code,      label: "语法线索", color: "#BF5AF2", bg: "rgba(191,90,242,0.06)", bdr: "rgba(191,90,242,0.18)" },
  { icon: Activity,  label: "逻辑分析", color: "#FF9F0A", bg: "rgba(255,159,10,0.06)", bdr: "rgba(255,159,10,0.18)" },
  { icon: Wrench,    label: "修复方向", color: "#FF375F", bg: "rgba(255,55,95,0.06)", bdr: "rgba(255,55,95,0.18)" },
];

function getFeedbackLevels(diagnosis: any) {
  if (!diagnosis?.feedback) return [];
  const f = diagnosis.feedback;
  return [f.level_1, f.level_2, f.level_3, f.level_4]
    .filter(Boolean)
    .map((content: string, i: number) => ({
      content,
      icon: LEVELS[i]?.icon ?? Lightbulb,
      label: LEVELS[i]?.label ?? "",
      color: LEVELS[i]?.color ?? "#0A84FF",
      bg: LEVELS[i]?.bg ?? "transparent",
      bdr: LEVELS[i]?.bdr ?? "transparent",
    }));
}

function isPerfectScore(diagnosis: any) {
  return diagnosis?.llm_model === "system" && diagnosis?.confidence_score === 1.0;
}

/* ============================================================
   ScoreDisplay
   ============================================================ */
function ScoreDisplay({ result, diagnosis }: { result: any; diagnosis: any }) {
  if (!result) return null;
  const score = result.score ?? 0;
  const total = result.total_score || 100;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const passed = result.passed_test_cases ?? 0;
  const failed = (result.total_test_cases || 0) - passed;
  const isPass = pct >= 60;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-end gap-2">
        <span className="text-4xl font-bold tabular-nums tracking-tight"
          style={{
            background: isPass
              ? "linear-gradient(135deg, #30D158, #14B8A6)"
              : "linear-gradient(135deg, #FF375F, #FF9F0A)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
          {score}
        </span>
        <span className="text-sm text-[var(--text-tertiary)] pb-1 font-medium">/ {total}</span>
        {diagnosis?.confidence_score != null && (
          <span className="ml-auto text-[11px] text-[var(--text-tertiary)] pb-1 flex items-center gap-1">
            <ShieldCheck className="size-3" />
            置信度 {Math.round(diagnosis.confidence_score * 100)}%
          </span>
        )}
      </div>
      <div className="relative">
        <div className="w-full h-2 bg-[var(--bg-input)] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: pct + "%", background: isPass ? "linear-gradient(90deg, #30D158, #14B8A6)" : "linear-gradient(90deg, #FF375F, #FF9F0A)" }} />
        </div>
        <div className="absolute top-1/2 -translate-y-1/2 transition-all duration-700"
          style={{ left: "calc(" + pct + "% - 4px)", width: 8, height: 8, borderRadius: "50%", background: isPass ? "#30D158" : "#FF375F", boxShadow: "0 0 8px " + (isPass ? "#30D158" : "#FF375F") }} />
      </div>
      <div className="flex gap-3">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium"
          style={{ background: "var(--success-bg)", color: "var(--success)" }}>
          <CheckCircle2 className="size-3" />通过 {passed}
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium"
          style={{ background: "var(--error-bg)", color: "var(--error)" }}>
          <XCircle className="size-3" />失败 {failed}
        </div>
      </div>
      {result.pass_rate != null && (
        <div className="text-[11px] text-[var(--text-secondary)]">
          通过率: {(result.pass_rate * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

/* ============================================================
   KnowledgeGraph
   ============================================================ */
function KnowledgeGraph({ diagnosis }: { diagnosis: any }) {
  const concepts = diagnosis?.related_concepts || [];
  const syscalls = diagnosis?.related_syscalls || [];
  const rootCause = diagnosis?.root_cause;
  const errorType = diagnosis?.error_type;
  const perfect = isPerfectScore(diagnosis);
  if (concepts.length === 0 && syscalls.length === 0 && !rootCause) return null;

  const allNodes: { name: string; type: string; color: string; desc?: string; icon: React.ReactNode }[] = [
    ...(rootCause ? [{ name: rootCause, type: perfect ? "excellent" : "root_cause", color: perfect ? "#30D158" : "#FF375F", icon: perfect ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" /> }] : []),
    ...(errorType ? [{ name: errorType, type: "error", color: "#FF9F0A", icon: <Zap className="size-3" /> }] : []),
    ...syscalls.map((s: any) => ({ name: s.name, type: "syscall", color: "#0A84FF", desc: s.description, icon: <Cpu className="size-3" /> })),
    ...concepts.map((c: any) => ({ name: c.name, type: "concept", color: "#30D158", desc: c.description, icon: <BookOpen className="size-3" /> })),
  ];

  return (
    <div className="p-4 border-t border-[var(--border-default)]">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="size-3.5" style={{ color: "var(--accent)" }} />
        <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          {perfect ? "知识图谱关联" : "根因推理链"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 bg-[var(--bg-card-hover)] border border-[var(--border-default)] rounded-xl p-3">
        {allNodes.map((node, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ArrowRight className="size-3 text-[var(--text-tertiary)] shrink-0" />}
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all hover:scale-105"
              style={{ background: node.color + "14", color: node.color, border: "1px solid " + node.color + "30" }}
              title={node.desc || node.name}>
              {node.icon}{node.name}
            </span>
          </React.Fragment>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--text-tertiary)]">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#0A84FF" }} />
          {"系统调用（观测证据）"}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#30D158" }} />
          {"OS 概念（模型/规则）"}
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   FixSuggestions
   ============================================================ */
function FixSuggestions({ diagnosis }: { diagnosis: any }) {
  const fixes = diagnosis?.suggested_fixes;
  if (!fixes || fixes.length === 0) return null;
  return (
    <div className="p-4 border-t border-[var(--border-default)] space-y-2.5">
      <div className="flex items-center gap-2">
        <Wrench className="size-3.5" style={{ color: "#FF9F0A" }} />
        <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">修复建议</span>
        <span className="text-[10px] text-[var(--text-tertiary)]">{fixes.length} 项</span>
      </div>
      {fixes.map((fix: any, i: number) => (
        <div key={i} className="p-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] hover:border-[var(--border-strong)] transition-all duration-300 group">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{ background: "rgba(255,159,10,0.12)", color: "#FF9F0A" }}>{i + 1}</span>
            <span className="text-[12px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{fix.title}</span>
            {fix.source_label && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md shrink-0"
                style={{ background: "var(--bg-input)", color: "var(--text-tertiary)" }}>
                来源：{fix.source_label}
              </span>
            )}
            <ExternalLink className="size-3 text-[var(--text-tertiary)] ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed pl-7">{fix.description}</p>
          {fix.code_snippet && (
            <div className="mt-2 pl-7">
              <pre className="text-[11px] p-2.5 rounded-lg overflow-x-auto font-mono leading-relaxed"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-default)", color: "var(--text-secondary)" }}>
                <code>{fix.code_snippet}</code>
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   DiagnosisModule — Full diagnosis view
   ============================================================ */
function DiagnosisModule() {
  const result = useWorkspaceStore((s) => s.evalResult) as any;
  const diagnosis = useWorkspaceStore((s) => s.diagnosis) as any;
  const diagnosisLoading = useWorkspaceStore((s) => s.diagnosisLoading);
  const feedbackLevels = getFeedbackLevels(diagnosis);
  const perfect = diagnosis ? isPerfectScore(diagnosis) : false;
  const [expandedLevel, setExpandedLevel] = useState<number | null>(null);
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    if (diagnosis && !animated) requestAnimationFrame(() => setAnimated(true));
  }, [diagnosis]);

  if (diagnosisLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse space-y-3">
          <div className="h-8 w-24 bg-[var(--bg-input)] rounded-lg" />
          <div className="h-2 w-full bg-[var(--bg-input)] rounded-full" />
          <div className="flex gap-3">
            <div className="h-5 w-16 bg-[var(--bg-input)] rounded-lg" />
            <div className="h-5 w-16 bg-[var(--bg-input)] rounded-lg" />
          </div>
        </div>
        <div className="flex items-center gap-4 pt-2">
          {["采集数据", "模型推理", "生成报告"].map((phase, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all duration-500"
                style={{ borderColor: i <= 1 ? "var(--accent)" : "var(--border-default)", background: i <= 1 ? "var(--accent-light)" : "transparent", color: i <= 1 ? "var(--accent)" : "var(--text-tertiary)" }}>
                {i <= 1 ? <Loader2 className="size-3 animate-spin" /> : <span className="text-[10px]">{i + 1}</span>}
              </div>
              <span className="text-[10px] font-medium" style={{ color: i <= 1 ? "var(--accent)" : "var(--text-tertiary)" }}>{phase}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" />
          AI 正在分析代码与运行轨迹...
        </p>
      </div>
    );
  }

  if (!diagnosis && !result) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "var(--accent-light)" }}>
          <Stethoscope className="size-8" style={{ color: "var(--accent)", opacity: 0.6 }} />
        </div>
        <p className="text-sm font-medium text-[var(--text-secondary)] mb-1">暂无诊断结果</p>
        <p className="text-[11px] text-[var(--text-tertiary)] max-w-[240px]">提交代码并运行后，AI 将自动分析运行轨迹并生成诊断报告</p>
      </div>
    );
  }

  return (
    <div className={cn("transition-all duration-500 ease-out", animated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3")}>
      <PanelHeader icon={Stethoscope} title="AI 诊断" subtitle="代码分析与运行轨迹诊断" />
      {result && <ScoreDisplay result={result} diagnosis={diagnosis} />}
      {diagnosis?.root_cause && (
        <div className="mx-4 p-3 rounded-xl border mb-2 flex items-start gap-2.5"
          style={{ background: perfect ? "linear-gradient(135deg, rgba(48,209,88,0.06), rgba(20,184,166,0.06))" : "linear-gradient(135deg, rgba(255,55,95,0.05), rgba(255,159,10,0.05))", borderColor: perfect ? "rgba(48,209,88,0.15)" : "rgba(255,55,95,0.15)" }}>
          <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: perfect ? "rgba(48,209,88,0.12)" : "rgba(255,55,95,0.12)", color: perfect ? "var(--success)" : "var(--error)" }}>
            {perfect ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: perfect ? "var(--success)" : "var(--error)" }}>
              {perfect ? "代码分析" : "根因定位"}
            </p>
            <p className="text-[12px] text-[var(--text-primary)] leading-relaxed">{diagnosis.root_cause}</p>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
              {"来源：多 Agent 综合报告（规则 + LLM 聚合）"}
            </p>
          </div>
        </div>
      )}
      {feedbackLevels.length > 0 && (
        <div className="p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="size-3.5" style={{ color: "var(--accent-purple)" }} />
            <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
              {perfect ? "代码亮点" : "分层诊断"}
            </span>
          </div>
          {feedbackLevels.map((level: any, i: number) => {
            const LevelIcon = level.icon;
            const isExpanded = expandedLevel === i;
            return (
              <div key={i} className="rounded-xl border transition-all duration-300 overflow-hidden cursor-pointer"
                style={{ background: level.bg, borderColor: level.bdr }}
                onClick={() => setExpandedLevel(isExpanded ? null : i)}>
                <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: level.color + "18" }}>
                    <LevelIcon className="size-3.5" style={{ color: level.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold" style={{ color: level.color }}>L{i + 1} · {level.label}</p>
                    <p className={cn("text-[11px] text-[var(--text-secondary)] leading-relaxed transition-all duration-300", isExpanded ? "mt-1 opacity-100 max-h-40" : "line-clamp-1 opacity-70")}>
                      {level.content}
                    </p>
                  </div>
                  {isExpanded ? <ChevronUp className="size-3.5 text-[var(--text-tertiary)] shrink-0" /> : <ChevronDown className="size-3.5 text-[var(--text-tertiary)] shrink-0" />}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <KnowledgeGraph diagnosis={diagnosis} />
      <FixSuggestions diagnosis={diagnosis} />
      {diagnosis?.confidence_score != null && (
        <div className="px-4 py-3 border-t border-[var(--border-default)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="size-3.5" style={{ color: "var(--accent-purple)" }} />
              <span className="text-[10px] text-[var(--text-tertiary)] font-medium">模型置信度</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 bg-[var(--bg-input)] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-1000"
                  style={{ width: Math.round(diagnosis.confidence_score * 100) + "%", background: "linear-gradient(90deg, #0A84FF, #BF5AF2)" }} />
              </div>
              <span className="text-xs font-mono font-bold"
                style={{ background: "linear-gradient(135deg, #0A84FF, #BF5AF2)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                {Math.round(diagnosis.confidence_score * 100)}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   ChatModule — Streaming conversational agent with useChat
   ============================================================ */
function ChatModule() {
  const experimentId = useWorkspaceStore((s) => s.experimentId);
  const experiment = useWorkspaceStore((s) => s.experiment);
  const code = useWorkspaceStore((s) => s.code);
  const language = useWorkspaceStore((s) => s.language);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const STORAGE_KEY = `traceos_chat_${experimentId}`;

  const initialMessages = useMemo(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  }, [STORAGE_KEY]);

  const contextBody = {
    experiment_id: experimentId,
    experiment_title: experiment?.title,
    experiment_description: experiment?.description,
    experiment_instructions: experiment?.instructions,
    experiment_category: experiment?.category,
    code,
    language,
    use_rag: true,
  };

  const { messages, input, handleInputChange, handleSubmit, isLoading, setInput } = useChat({
    api: `/api/ai/experiments/${experimentId}/chat/stream`,
    initialMessages,
    body: contextBody,
    onError: (err) => {
      console.error("Chat stream error:", err);
    },
  });

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, STORAGE_KEY]);

  const clearChat = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    window.location.reload();
  }, [STORAGE_KEY]);

  const handleSend = useCallback((e: React.FormEvent) => {
    handleSubmit(e, { body: contextBody });
  }, [handleSubmit, experimentId, experiment, code, language]);

  const handleQuickPrompt = (prompt: string) => {
    setInput(prompt);
  };

  const handleCopyMessage = async (content: string, idx: number) => {
    try { await navigator.clipboard.writeText(content); setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 2000); } catch {}
  };

  const QUICK_CHAT_PROMPTS = [
    { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>, label: "分析代码", prompt: "请分析我当前代码中可能存在的问题，给出改进建议。" },
    { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>, label: "解释原理", prompt: "请解释这个实验涉及的操作系统核心原理。" },
    { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4V2m0 2v2m0-2h2m-2 0h-2"/><path d="m21.5 7.5-2.8-2.8"/><path d="m3.5 20.5 6-6"/><path d="m2 22 4-4"/></svg>, label: "优化性能", prompt: "请帮我分析代码的性能瓶颈并给出优化建议。" },
    { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/></svg>, label: "解释错误", prompt: "请根据运行结果帮我分析可能的错误原因。" },
  ];

  return (
    <div className="flex flex-col h-full bg-[var(--bg-card)]">
      <PanelHeader
        icon={Bot}
        title="AI 助手"
        subtitle={`${messages.length} 条消息`}
        actions={
          messages.length > 0 ? (
            <button onClick={clearChat}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--error)] transition-colors rounded hover:bg-[var(--error-bg)]">
              <Trash2 className="size-3" />清空
            </button>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[240px] px-6 py-12 text-center">
            <div className="relative mb-5">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, rgba(10,132,255,0.08), rgba(191,90,242,0.08))", border: "1px solid rgba(10,132,255,0.12)" }}>
                <Bot className="size-7" style={{ color: "var(--accent-purple)", opacity: 0.7 }} />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
                style={{ background: "var(--bg-card)", border: "2px solid var(--border-default)" }}>
                <Sparkles className="size-3" style={{ color: "#FF9F0A" }} />
              </div>
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1.5">AI 教学助手</h3>
            <p className="text-[11px] text-[var(--text-tertiary)] max-w-[260px] mb-5 leading-relaxed">
              我是你的专属 AI 实验导师，结合代码和运行轨迹，提供启发式引导。
            </p>
            <div className="grid grid-cols-2 gap-2 w-full max-w-[300px]">
              {QUICK_CHAT_PROMPTS.map((qp, i) => (
                <button key={i} onClick={() => handleQuickPrompt(qp.prompt)}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card-hover)] hover:border-[var(--accent)]/30 hover:bg-[var(--accent-light)] transition-all duration-300 group">
                  <span className="text-[var(--text-tertiary)] group-hover:text-[var(--accent)] transition-colors">{qp.icon}</span>
                  <span className="text-[10px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors leading-tight text-center">{qp.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, mi) => {
          const isAI = msg.role === "assistant";
          return (
            <motion.div key={msg.id || mi} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: mi * 0.04 }} className="px-3 py-1.5">
              <div className={cn("flex gap-2", isAI ? "" : "flex-row-reverse")}>
                <div className="shrink-0" style={{ width: 26 }}>
                  <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center",
                    isAI ? "bg-[var(--accent-purple-light)]" : "bg-[var(--accent-light)]")}>
                    {isAI
                      ? <Bot className="size-3.5" style={{ color: "var(--accent-purple)" }} />
                      : <User className="size-3.5" style={{ color: "var(--accent)" }} />}
                  </div>
                </div>
                <div className="group/bubble relative max-w-[82%]">
                  <div className={cn("rounded-2xl px-3 py-2 text-[11px] leading-relaxed",
                    isAI ? "rounded-tl-md bg-[var(--bg-card-hover)] border border-[var(--border-default)] text-[var(--text-primary)]"
                         : "rounded-tr-md text-white")}
                    style={isAI ? {} : { background: "linear-gradient(135deg, #0A84FF, #409CFF)" }}>
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  </div>
                  {isAI && msg.content && (
                    <div className="flex items-center gap-1.5 mt-0.5 justify-start pl-0.5">
                      <button onClick={() => handleCopyMessage(msg.content, mi)}
                        className="text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors">
                        {copiedIdx === mi ? <Check className="size-2.5" style={{ color: "var(--success)" }} /> : <Copy className="size-2.5" />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}

        {isLoading && (
          <div className="px-3 py-2">
            <div className="flex gap-2">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 bg-[var(--accent-purple-light)]">
                <Bot className="size-3.5" style={{ color: "var(--accent-purple)" }} />
              </div>
              <div className="rounded-2xl rounded-tl-md px-3 py-2 bg-[var(--bg-card-hover)] border border-[var(--border-default)]">
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-purple)] animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-purple)] animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-purple)] animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} className="border-t border-[var(--border-default)] p-2.5 bg-[var(--bg-card)] flex-shrink-0">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={handleInputChange}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(e as any); } }}
              placeholder="向 AI 提问... (Enter 发送, Shift+Enter 换行)"
              rows={1}
              disabled={isLoading}
              className="w-full bg-[var(--bg-input)] border border-[var(--border-default)] rounded-2xl px-3.5 py-2 text-[12px] text-[var(--text-primary)] outline-none transition-all resize-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-glow)]/30 placeholder:text-[var(--text-tertiary)] disabled:opacity-50"
              style={{ minHeight: "36px", maxHeight: "120px" }} />
            {!input && (
              <span className="absolute right-3 bottom-2 text-[10px] text-[var(--text-tertiary)] pointer-events-none flex items-center gap-1">
                <CornerDownLeft className="size-3" />Enter
              </span>
            )}
          </div>
          <button type="submit" disabled={isLoading || !input.trim()}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: input.trim() ? "linear-gradient(135deg, #0A84FF, #BF5AF2)" : "var(--bg-input)", border: input.trim() ? "none" : "1px solid var(--border-default)" }}>
            {isLoading
              ? <Loader2 className="size-4 animate-spin" style={{ color: "white" }} />
              : <Send className="size-4" style={{ color: input.trim() ? "white" : "var(--text-tertiary)" }} />}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ============================================================
   AIPanel — Main export
   ============================================================ */
export function AIPanel({ collapsed, onToggleCollapse, mode }: AIPanelProps) {
  if (collapsed) {
    return (
      <div className="w-full h-full flex flex-col items-center pt-3 bg-[var(--bg-card)] border-l border-[var(--border-default)] gap-3">
        <button onClick={onToggleCollapse}
          className="text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors p-1 rounded-md hover:bg-[var(--accent-light)]"
          title="展开面板">
          <ChevronRight className="size-4" />
        </button>
        <div className="p-2 rounded-xl bg-[var(--accent-light)] text-[var(--accent)]">
          {mode === "diagnosis" ? <Stethoscope className="size-4" /> : <MessageSquare className="size-4" />}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[var(--bg-card)] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)] shrink-0">
        <span className="text-xs font-semibold text-[var(--text-secondary)] tracking-wide">
          {mode === "diagnosis" ? "诊断分析" : "AI 提问"}
        </span>
        <button onClick={onToggleCollapse}
          className="text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors p-1 rounded-md hover:bg-[var(--accent-light)]"
          title="关闭面板">
          <ChevronRight className="size-4 rotate-180" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {mode === "diagnosis" ? (
          <div className="h-full overflow-y-auto"><DiagnosisModule /></div>
        ) : (
          <div className="h-full overflow-hidden"><ChatModule /></div>
        )}
      </div>
    </div>
  );
}