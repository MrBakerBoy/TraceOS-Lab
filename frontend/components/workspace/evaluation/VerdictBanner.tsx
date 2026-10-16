"use client";

import { CheckCircle2, AlertTriangle, XCircle, FileCode2 } from "lucide-react";

export type VerdictTone = "success" | "warning" | "error";

export interface Verdict {
  tone: VerdictTone;
  title: string;
  subtitle: string;
}

export function resolveVerdict(
  status: string,
  isQualified: boolean | undefined,
  score: number,
  totalScore: number,
): Verdict {
  if (status === "compile_error") {
    return {
      tone: "error",
      title: "编译错误",
      subtitle: "代码未能通过编译，请检查语法后重试",
    };
  }
  if (status === "running") {
    return {
      tone: "warning",
      title: "评测中",
      subtitle: "正在运行测试点，请稍候",
    };
  }
  if (isQualified === true || (totalScore > 0 && score >= totalScore)) {
    return {
      tone: "success",
      title: "通过",
      subtitle: "核心测试点全部通过",
    };
  }
  if (score <= 0) {
    return {
      tone: "error",
      title: "未通过",
      subtitle: "全部测试点未通过，请查看失败明细",
    };
  }
  return {
    tone: "warning",
    title: "部分通过",
    subtitle: "部分测试点通过，仍有提升空间",
  };
}

const TONE_TEXT: Record<VerdictTone, string> = {
  success: "text-app-success",
  warning: "text-app-warning",
  error: "text-app-error",
};

const TONE_BG: Record<VerdictTone, string> = {
  success: "bg-[var(--success-bg)]",
  warning: "bg-[var(--warning-bg)]",
  error: "bg-[var(--error-bg)]",
};

const TONE_BAR: Record<VerdictTone, string> = {
  success: "bg-app-success",
  warning: "bg-app-warning",
  error: "bg-app-error",
};

interface VerdictBannerProps {
  status: string;
  isQualified?: boolean;
  score: number;
  totalScore: number;
}

export default function VerdictBanner({
  status,
  isQualified,
  score,
  totalScore,
}: VerdictBannerProps) {
  const verdict = resolveVerdict(status, isQualified, score, totalScore);
  const Icon =
    status === "compile_error"
      ? FileCode2
      : verdict.tone === "success"
        ? CheckCircle2
        : verdict.tone === "warning"
          ? AlertTriangle
          : XCircle;

  return (
    <div
      className={`relative flex items-center gap-4 overflow-hidden rounded-xl px-5 py-4 ${TONE_BG[verdict.tone]}`}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${TONE_BAR[verdict.tone]}`}
      />
      <Icon
        aria-hidden="true"
        className={`size-8 shrink-0 ${TONE_TEXT[verdict.tone]}`}
        strokeWidth={2.2}
      />
      <div className="min-w-0">
        <h2 className={`text-xl font-bold leading-tight ${TONE_TEXT[verdict.tone]}`}>
          {verdict.title}
        </h2>
        <p className="text-sm text-app-text-2">{verdict.subtitle}</p>
      </div>
    </div>
  );
}