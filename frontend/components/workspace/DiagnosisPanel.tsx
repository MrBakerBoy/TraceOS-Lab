'use client';

import React, { useEffect, useState, useCallback } from "react";
import { useWorkspaceStore } from "@/stores/workspace";
import type { DiagnosisResult } from "@/types/workspace";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import HarnessReportPanel from "@/components/workspace/HarnessReportPanel";
import type { HarnessDiagnosisReport } from "@/types/harness";
import { PanelHeader } from "@/components/ui/panel-header";
import { SkeletonText } from "@/components/ui/skeleton-card";
import {
  Stethoscope, Sparkles, ChevronDown, ChevronUp, AlertTriangle,
  Lightbulb, Wrench, BookOpen, Code, Cpu, ShieldCheck, Target,
  Zap, TrendingUp, Activity, CheckCircle2, XCircle, ArrowRight,
  ExternalLink, Flame, GitBranch, Box
} from "lucide-react";

interface DiagnosisPanelProps {
  submissionId: string | null;
  score?: number;
  totalScore?: number;
}

interface ProgressEvent {
  diagnosis_id: string;
  status: string;
  stage: string;
  progress: number;
  message: string;
}

const STAGE_ICONS: Record<string, string> = {
  fetching: "\ud83d\udce5",
  analyzing: "\ud83d\udd0d",
  saving: "\ud83d\udcbe",
};

const STAGE_LABELS: Record<string, string> = {
  fetching: "\u83b7\u53d6\u63d0\u4ea4\u6570\u636e...",
  analyzing: "AI \u6b63\u5728\u5206\u6790\u4ee3\u7801...",
  saving: "\u4fdd\u5b58\u8bca\u65ad\u7ed3\u679c...",
};

const LEVEL_STYLES = [
  { label: "\u57fa\u7840\u63d0\u793a", icon: Lightbulb, color: "#0A84FF", bg: "rgba(10,132,255,0.06)", border: "rgba(10,132,255,0.15)" },
  { label: "\u8bed\u6cd5\u63d0\u793a", icon: Code, color: "#BF5AF2", bg: "rgba(191,90,242,0.06)", border: "rgba(191,90,242,0.15)" },
  { label: "\u903b\u8f91\u5206\u6790", icon: Activity, color: "#FF9F0A", bg: "rgba(255,159,10,0.06)", border: "rgba(255,159,10,0.15)" },
  { label: "\u4fee\u590d\u65b9\u5411", icon: Wrench, color: "#FF375F", bg: "rgba(255,55,95,0.06)", border: "rgba(255,55,95,0.15)" },
];


// ── Evidence Links Section ──────────────────────────────────────────────

const PANEL_ICONS: Record<string, React.ReactNode> = {
  trace: <GitBranch className="size-3.5" />,
  flamegraph: <Flame className="size-3.5" />,
  memory3d: <Box className="size-3.5" />,
  ebpf: <Activity className="size-3.5" />,
};

const PANEL_LABELS: Record<string, string> = {
  trace: "Trace 时间轴",
  flamegraph: "火焰图",
  memory3d: "内存3D",
  ebpf: "eBPF 追踪",
};

const SEVERITY_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: "#FF375F", bg: "rgba(255,55,95,0.06)", border: "rgba(255,55,95,0.2)" },
  warning: { color: "#FF9F0A", bg: "rgba(255,159,10,0.06)", border: "rgba(255,159,10,0.2)" },
  info: { color: "#0A84FF", bg: "rgba(10,132,255,0.06)", border: "rgba(10,132,255,0.2)" },
};

function EvidenceLinksSection({ links }: { links: any[] }) {
  const navigateToEvidence = useWorkspaceStore((s) => s.navigateToEvidence);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ExternalLink className="size-3.5" style={{ color: "#30D158" }} />
        <span className="text-[10px] uppercase tracking-wider text-[var(--kt-text-tertiary)] font-medium">
          观测证据
        </span>
        <span className="text-[9px] text-[var(--kt-text-tertiary)]">{links.length} 项</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {links.map((link, i) => {
          const sev = SEVERITY_COLORS[link.severity] || SEVERITY_COLORS.info;
          return (
            <motion.button
              key={link.id || i}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              onClick={() => navigateToEvidence(link)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] transition-all duration-200 hover:scale-105 cursor-pointer"
              style={{
                color: sev.color,
                background: sev.bg,
                borderColor: sev.border,
              }}
              title={link.description}
            >
              <span className="shrink-0">
                {PANEL_ICONS[link.panel] || <ExternalLink className="size-3.5" />}
              </span>
              <span className="text-[10px] text-[var(--kt-text-tertiary)] shrink-0">
                {PANEL_LABELS[link.panel] || link.panel}
              </span>
              <span className="truncate max-w-[200px]">{link.label}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}


export default function DiagnosisPanel({ submissionId, score, totalScore }: DiagnosisPanelProps) {
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [harnessReport, setHarnessReport] = useState<HarnessDiagnosisReport | null>(null);

  useEffect(() => {
    if (diagnosis && !animated) setTimeout(() => setAnimated(true), 100);
  }, [diagnosis]);

  const fetchDiagnosis = useCallback(async () => {
    if (!submissionId) return;
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
      const resp = await fetch(`${apiUrl}/api/ai/diagnose?submission_id=${submissionId}`);
      if (resp.ok) {
        let data = await resp.json();
        if (Array.isArray(data) && data.length > 0) data = data[0];
        if (data.diagnosis_id) {
          setDiagnosis(data);
          return;
        }
        if (data.status === "in_progress") setLoading(true);
      }
    } catch {}
    if (!loading) setLoading(true);
  }, [submissionId]);

  const subscribeSSE = useCallback(async (diagnosisId: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const es = new EventSource(`${apiUrl}/api/ai/diagnose/${diagnosisId}/stream`);
    es.onmessage = (e) => {
      try {
        const d: ProgressEvent = JSON.parse(e.data);
        setProgress(d);
        if (d.stage === "completed" || d.stage === "failed") {
          es.close(); setLoading(false); fetchDiagnosis();
        }
      } catch {}
    };
    es.onerror = () => { es.close(); setLoading(false); };
    return () => es.close();
  }, [fetchDiagnosis]);

  useEffect(() => { if (submissionId) fetchDiagnosis(); }, [submissionId, fetchDiagnosis]);


  // Fetch harness report when available
  useEffect(() => {
    if (!submissionId || !diagnosis?.diagnosis_harness_id) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    fetch(`${apiUrl}/api/ai/diagnose/reports/${diagnosis.diagnosis_harness_id}`)
      .then(r => r.json())
      .then(data => {
        if (data.observations !== undefined || data.is_qualified !== undefined) setHarnessReport(data);
      }).catch(() => {});
  }, [diagnosis?.diagnosis_harness_id, submissionId]);
  useEffect(() => {
    if (submissionId && !diagnosis && !loading && score !== undefined) {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
      fetch(`${apiUrl}/api/ai/diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: submissionId }),
      }).then(r => r.json()).then(data => {
        if (data.diagnosis_id) { setLoading(true); subscribeSSE(data.diagnosis_id); }
      }).catch(() => setLoading(false));
    }
  }, [submissionId, diagnosis, loading, score, subscribeSSE]);

  if (!submissionId) return null;
  if (!loading && !diagnosis) return null;

  const pct = totalScore && totalScore > 0 ? Math.round((score || 0) / totalScore * 100) : 0;
  const isPassed = pct >= 60;
  const accentColor = isPassed ? "#30D158" : "#FF375F";
  const accentBg = isPassed ? "rgba(48,209,88,0.08)" : "rgba(255,55,95,0.08)";

  const feedbackLevels = diagnosis?.feedback
    ? [
      diagnosis.feedback.level_1,
      diagnosis.feedback.level_2,
      diagnosis.feedback.level_3,
      diagnosis.feedback.level_4,
    ].filter(Boolean)
    : [];

  return (
    <div className="border-t border-[var(--kt-border)] bg-[var(--kt-bg-elevated)] overflow-hidden">
      {/* Header bar */}
      <div
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-2.5 px-4 py-2.5 cursor-pointer transition-colors hover:bg-[var(--kt-border)]/30 select-none"
      >
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, rgba(10,132,255,0.15), rgba(191,90,242,0.15))" }}>
          <Stethoscope className="size-3.5" style={{ color: "#0A84FF" }} />
        </div>
        <span className="text-xs font-semibold text-[var(--kt-text)]">AI \u8bca\u65ad</span>

        {loading && (
          <div className="flex items-center gap-1.5 ml-1">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#0A84FF" }} />
            <span className="text-[10px] text-[var(--kt-text-tertiary)]">
              {progress?.message || "\u5206\u6790\u4e2d..."}
            </span>
          </div>
        )}

        {diagnosis && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium ml-1"
            style={{ color: accentColor, background: accentBg, border: "1px solid " + accentColor + "30" }}>
            {isPassed ? "\u4eae\u70b9\u5206\u6790" : "\u95ee\u9898\u8bca\u65ad"}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-[var(--kt-text-tertiary)]">
          {diagnosis?.confidence_score != null && (
            <span className="tabular-nums">{Math.round(diagnosis.confidence_score * 100)}% \u7f6e\u4fe1\u5ea6</span>
          )}
          {showDetails ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </div>
      </div>

      {/* Progress bar (loading) */}
      {loading && (
        <div className="px-4 pb-3 space-y-3">
          {progress && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-[var(--kt-text-tertiary)]">{progress.progress}%</span>
              </div>
              <div className="h-1.5 bg-[var(--kt-bg-surface)] rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "linear-gradient(90deg, #0A84FF, #BF5AF2)", boxShadow: "0 0 10px rgba(10,132,255,0.3)" }}
                  initial={{ width: "0%" }}
                  animate={{ width: `${progress.progress}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
              <p className="text-[10px] text-[var(--kt-text-tertiary)] mt-1.5">
                {STAGE_LABELS[progress.stage] || progress.message}
              </p>
            </div>
          )}
          <SkeletonText lines={4} />
        </div>
      )}

      {/* Content */}
      {showDetails && diagnosis && (
        <div className={cn(
          "px-4 pb-4 space-y-4 transition-all duration-500",
          animated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
        )}>
          {/* Score card */}
          {(score !== undefined) && (
            <div className="p-3 rounded-xl border border-[var(--kt-border)]"
              style={{ background: "var(--kt-bg-surface)" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Target className="size-3.5" style={{ color: accentColor }} />
                  <span className="text-[11px] font-medium text-[var(--kt-text-secondary)]">
                    {isPassed ? "\u5f97\u5206\u8bc4\u4f30" : "\u5f97\u5206\u8bc4\u4f30"}
                  </span>
                </div>
                <span className="text-lg font-bold tabular-nums" style={{ color: accentColor }}>
                  {score}<span className="text-xs text-[var(--kt-text-tertiary)] font-normal">/{totalScore}</span>
                </span>
              </div>
              <div className="h-2 bg-[var(--kt-bg-elevated)] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{ width: pct + "%", background: "linear-gradient(90deg, " + accentColor + ", " + accentColor + "88)" }} />
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-[var(--kt-text-tertiary)]">
                <span className="flex items-center gap-1"><CheckCircle2 className="size-3 text-[var(--kt-success)]" /> {diagnosis.passed_test_cases || 0} \u901a\u8fc7</span>
                <span className="flex items-center gap-1"><XCircle className="size-3 text-[var(--kt-red)]" /> {(diagnosis.total_test_cases || 0) - (diagnosis.passed_test_cases || 0)} \u5931\u8d25</span>
              </div>
            </div>
          )}

          {/* Root cause */}
          {diagnosis.root_cause && (
            <div className="p-3 rounded-xl border"
              style={{ background: "var(--kt-bg-surface)", borderColor: accentColor + "20" }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: accentBg }}>
                  <AlertTriangle className="size-3" style={{ color: accentColor }} />
                </div>
                <span className="text-[11px] font-semibold text-[var(--kt-text)]">
                  {isPassed ? "\u4ee3\u7801\u5206\u6790" : "\u95ee\u9898\u6839\u56e0"}
                </span>
              </div>
              <p className="text-[12px] text-[var(--kt-text-secondary)] leading-relaxed pl-8">
                {diagnosis.root_cause}
              </p>
            </div>
          )}

          {/* Leveled feedback */}
          {feedbackLevels.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="size-3.5" style={{ color: "#BF5AF2" }} />
                <span className="text-[10px] uppercase tracking-wider text-[var(--kt-text-tertiary)] font-medium">
                  {isPassed ? "\u4eae\u70b9\u5206\u6790" : "\u5206\u5c42\u63d0\u793a"}
                </span>
              </div>
              {feedbackLevels.map((text, i) => {
                const style = LEVEL_STYLES[i] || LEVEL_STYLES[3];
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.1 }}
                    className="p-3 rounded-xl border transition-all duration-300 hover:scale-[1.01]"
                    style={{ background: style.bg, borderColor: style.border }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <style.icon className="size-3.5" style={{ color: style.color }} />
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: style.color }}>
                        {isPassed && i === 0 ? "\u6574\u4f53\u8bc4\u4ef7" :
                         isPassed && i === 1 ? "\u4ee3\u7801\u4f18\u52bf" :
                         isPassed && i === 2 ? "\u6df1\u5ea6\u89e3\u8bfb" :
                         isPassed && i === 3 ? "\u62d3\u5c55\u5efa\u8bae" :
                         style.label}
                      </span>
                      <span className="text-[9px] px-1 py-0.5 rounded font-mono" style={{ color: style.color, background: style.color + "15" }}>
                        L{i + 1}
                      </span>
                    </div>
                    <p className="text-[12px] text-[var(--kt-text-secondary)] leading-relaxed pl-5.5">{text}</p>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Related concepts + syscalls side by side */}
          <div className="grid grid-cols-2 gap-3">
            {diagnosis.related_concepts && diagnosis.related_concepts.length > 0 && (
              <div className="p-3 rounded-xl border border-[var(--kt-border)]" style={{ background: "var(--kt-bg-surface)" }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <BookOpen className="size-3" style={{ color: "#30D158" }} />
                  <span className="text-[10px] font-medium text-[var(--kt-text-tertiary)] uppercase tracking-wider">相关知识</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {diagnosis.related_concepts.map((c: any, i: number) => (
                    <span key={i} className="text-[10px] px-2 py-1 rounded-lg border transition-all duration-200 hover:scale-105"
                      style={{
                        color: "#30D158", background: "rgba(48,209,88,0.06)", borderColor: "rgba(48,209,88,0.2)",
                      }} title={c.description}>
                      {c.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {diagnosis.related_syscalls && diagnosis.related_syscalls.length > 0 && (
              <div className="p-3 rounded-xl border border-[var(--kt-border)]" style={{ background: "var(--kt-bg-surface)" }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Cpu className="size-3" style={{ color: "#0A84FF" }} />
                  <span className="text-[10px] font-medium text-[var(--kt-text-tertiary)] uppercase tracking-wider">系统调用</span>
                </div>
                <div className="space-y-1.5">
                  {diagnosis.related_syscalls.map((s: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-[11px]">
                      <code className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold shrink-0"
                        style={{ color: "#0A84FF", background: "rgba(10,132,255,0.08)" }}>{s.name}</code>
                      <span className="text-[var(--kt-text-tertiary)] leading-snug">{s.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Evidence links — clickable diagnosis → visualization navigation */}
          {diagnosis.evidence_links && diagnosis.evidence_links.length > 0 && (
            <EvidenceLinksSection links={diagnosis.evidence_links} />
          )}

          {/* Suggested fixes */}
          {diagnosis.suggested_fixes && diagnosis.suggested_fixes.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Wrench className="size-3.5" style={{ color: "#FF9F0A" }} />
                <span className="text-[10px] uppercase tracking-wider text-[var(--kt-text-tertiary)] font-medium">修改建议</span>
                <span className="text-[9px] text-[var(--kt-text-tertiary)]">{diagnosis.suggested_fixes.length} 项</span>
              </div>
              {diagnosis.suggested_fixes.map((fix: any, i: number) => (
                <div key={i} className="p-3 rounded-xl border border-[var(--kt-border)] transition-all duration-300 hover:border-[var(--kt-border-strong)]"
                  style={{ background: "var(--kt-bg-surface)" }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold"
                      style={{ background: "rgba(255,159,10,0.12)", color: "#FF9F0A" }}>{i + 1}</span>
                    <span className="text-[12px] font-semibold text-[var(--kt-text)]">{fix.title}</span>
                  </div>
                  <p className="text-[11px] text-[var(--kt-text-secondary)] leading-relaxed pl-7">{fix.description}</p>
                  {fix.code_snippet && (
                    <div className="mt-2 pl-7">
                      <pre className="text-[11px] p-2.5 rounded-lg overflow-x-auto font-mono leading-relaxed"
                        style={{
                          background: "var(--kt-bg-deep)",
                          border: "1px solid var(--kt-border)",
                          color: "var(--kt-text-secondary)",
                        }}>
                        <code>{fix.code_snippet}</code>
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}


          {/* Harness Multi-Agent Report */}
          {harnessReport && (
            <HarnessReportPanel report={harnessReport} />
          )}
          {/* Confidence gauge */}
          {diagnosis.confidence_score != null && (
            <div className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--kt-border)]"
              style={{ background: "var(--kt-bg-surface)" }}>
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-3.5" style={{ color: "#0A84FF" }} />
                <span className="text-[10px] text-[var(--kt-text-tertiary)]">AI \u7f6e\u4fe1\u5ea6</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-[var(--kt-bg-elevated)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-1000"
                    style={{
                      width: (diagnosis.confidence_score * 100) + "%",
                      background: "linear-gradient(90deg, #0A84FF, #BF5AF2)",
                    }} />
                </div>
                <span className="text-xs font-mono font-bold tabular-nums"
                  style={{
                    background: "linear-gradient(135deg, #0A84FF, #BF5AF2)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}>
                  {Math.round(diagnosis.confidence_score * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
