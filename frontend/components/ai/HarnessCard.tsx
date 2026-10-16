"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, AlertTriangle, Activity, Brain, BarChart3,
} from "lucide-react";

export interface HarnessData {
  intent?: string;
  intent_confidence?: number;
  watermark?: string;
  utilization_pct?: number;
  eval_score?: number | null;
  guards_passed?: boolean;
  guards_blocked_reason?: string;
  diagnosis?: Record<string, unknown> | null;
  tutoring?: Record<string, unknown> | null;
  related_concepts?: string[];
  firewall_reports?: Record<string, unknown>;
}

const INTENT_LABELS: Record<string, { label: string; color: string }> = {
  diagnosis: { label: "诊断分析", color: "var(--error)" },
  knowledge_qa: { label: "知识问答", color: "var(--accent)" },
  code_review: { label: "代码审查", color: "var(--warning)" },
  general_chat: { label: "通用对话", color: "var(--success)" },
};

export default function HarnessCard({ harness, compact }: { harness: HarnessData; compact?: boolean }) {
  const intent = harness.intent || "unknown";
  const intentInfo = INTENT_LABELS[intent] || { label: intent, color: "var(--text-tertiary)" };
  const confPct = Math.round((harness.intent_confidence || 0) * 100);

  if (compact) {
    return (
      <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--text-tertiary)]">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1" style={{ borderColor: intentInfo.color, color: intentInfo.color }}>
          <Brain className="size-3" />
          {intentInfo.label}
        </Badge>
        <span>{confPct}% 置信度</span>
        {harness.guards_passed === false && (
          <span className="text-[var(--warning)] flex items-center gap-1">
            <AlertTriangle className="size-3" />
            已过滤
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] overflow-hidden">
      <div className="px-4 py-2 bg-[var(--secondary)]/50 flex items-center gap-2 border-b border-[var(--border-default)]">
        <ShieldCheck className="size-3.5 text-[var(--text-tertiary)]" />
        <span className="text-[11px] font-semibold text-[var(--text-secondary)]">Agent 监视器</span>
      </div>
      <div className="p-4 space-y-3">
        {/* Intent row */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1.5">
            <Brain className="size-3" /> 意图
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[11px]" style={{ borderColor: intentInfo.color, color: intentInfo.color }}>
              {intentInfo.label}
            </Badge>
            <span className="text-[11px] font-mono text-[var(--text-secondary)]">{confPct}%</span>
          </div>
        </div>

        {/* Confidence bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-[var(--secondary)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(confPct, 100)}%`,
                backgroundColor: confPct >= 80 ? "var(--success)" : confPct >= 60 ? "var(--warning)" : "var(--error)",
              }}
            />
          </div>
        </div>

        {/* Guards */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1.5">
            <ShieldCheck className="size-3" /> 输入守卫
          </span>
          <span className={cn(
            "text-[11px] font-medium",
            harness.guards_passed ? "text-[var(--success)]" : "text-[var(--error)]",
          )}>
            {harness.guards_passed ? "通过" : "拦截"}
          </span>
        </div>

        {/* Firewall */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1.5">
            <Activity className="size-3" /> Token 利用率
          </span>
          <span className="text-[11px] font-mono text-[var(--text-secondary)]">
            {(harness.utilization_pct || 0).toFixed(1)}%
          </span>
        </div>

        {/* Eval */}
        {harness.eval_score != null && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1.5">
              <BarChart3 className="size-3" /> LLM 评测
            </span>
            <span
              className="text-[11px] font-mono font-bold"
              style={{
                color:
                  (harness.eval_score as number) >= 4 ? "var(--success)" :
                  (harness.eval_score as number) >= 3 ? "var(--warning)" : "var(--error)",
              }}
            >
              {(harness.eval_score as number).toFixed(1)}/5.0
            </span>
          </div>
        )}

        {/* Related concepts */}
        {harness.related_concepts && harness.related_concepts.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {harness.related_concepts.slice(0, 6).map((c, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">{c}</Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}