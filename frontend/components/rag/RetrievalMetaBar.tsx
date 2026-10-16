"use client";

import type { RetrievalMeta } from "@/lib/knowledge-types";
import { Layers, Gauge, Timer, Filter } from "lucide-react";

interface RetrievalMetaBarProps {
  meta: RetrievalMeta | null;
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      {icon}
      <span className="text-[11px] text-[var(--text-tertiary)]">{label}</span>
      <span className="text-[11px] font-semibold tabular-nums text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

export default function RetrievalMetaBar({ meta }: RetrievalMetaBarProps) {
  if (!meta) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2">
        <p className="text-[11px] text-[var(--text-tertiary)]">提交问题后展示本次检索的召回与重排信息</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2">
      <Stat icon={<Layers className="size-3.5 text-[var(--accent)]" />} label="召回" value={String(meta.recalled)} />
      <Stat icon={<Gauge className="size-3.5 text-[var(--accent-purple)]" />} label="重排" value={String(meta.reranked)} />
      <Stat icon={<Filter className="size-3.5 text-[var(--success)]" />} label="通过" value={String(meta.passed_threshold)} />
      <Stat icon={<Timer className="size-3.5 text-[var(--text-tertiary)]" />} label="耗时" value={`${meta.elapsed_ms}ms`} />
      <span className="ml-auto rounded-md bg-[var(--secondary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
        阈值 {meta.threshold.toFixed(2)}
      </span>
    </div>
  );
}