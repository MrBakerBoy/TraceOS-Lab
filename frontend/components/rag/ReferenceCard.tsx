"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { knowledgeTypeMeta, similarityTone } from "@/lib/knowledge-constants";
import type { Reference } from "@/lib/knowledge-types";
import { FileText, Quote, CornerDownRight } from "lucide-react";

interface ReferenceCardProps {
  reference: Reference;
  index: number;
  active: boolean;
  onCite: (index: number) => void;
  onView: (ref: Reference) => void;
  onCiteToInput: (ref: Reference) => void;
}

const TONE_COLOR: Record<string, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--error)",
};

export default function ReferenceCard({ reference, index, active, onCite, onView, onCiteToInput }: ReferenceCardProps) {
  const type = knowledgeTypeMeta(reference.knowledge_type);
  const tone = similarityTone(reference.similarity);
  const pct = Math.round(Math.min(Math.max(reference.similarity, 0), 1) * 100);

  return (
    <article
      id={`reference-${index}`}
      className={cn(
        "rounded-xl border bg-[var(--bg-card)] p-3 transition-all",
        active
          ? "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]"
          : "border-[var(--border-default)] hover:border-[var(--border-strong)]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold",
            active ? "bg-[var(--accent)] text-white" : "bg-[var(--secondary)] text-[var(--text-secondary)]",
          )}
        >
          {index}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h4 className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{reference.title}</h4>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge
              variant="secondary"
              className="gap-1 px-1.5 py-0 text-[10px] font-medium"
              style={{ color: type.color }}
            >
              <span className="size-1.5 rounded-full" style={{ backgroundColor: type.color }} />
              {type.label}
            </Badge>
            {reference.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-[var(--text-tertiary)]">
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        <span className="shrink-0 text-xs font-semibold tabular-nums" style={{ color: TONE_COLOR[tone] }}>
          {pct}%
        </span>
      </div>

      {/* similarity bar */}
      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-[var(--secondary)]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: TONE_COLOR[tone] }}
        />
      </div>

      <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-[var(--text-secondary)]">{reference.content}</p>

      <div className="mt-2.5 flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-[var(--text-secondary)]" onClick={() => onCiteToInput(reference)}>
          <Quote className="size-3" />
          引用到回答
        </Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-[var(--text-secondary)]" onClick={() => onView(reference)}>
          <FileText className="size-3" />
          查看原文
        </Button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onCite(index)}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
        >
          <CornerDownRight className="size-3" />
          定位
        </button>
      </div>
    </article>
  );
}