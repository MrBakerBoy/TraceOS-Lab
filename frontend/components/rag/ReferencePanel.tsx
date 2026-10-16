"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Reference, RetrievalMeta } from "@/lib/knowledge-types";
import { Database } from "lucide-react";
import ReferenceCard from "./ReferenceCard";
import RetrievalMetaBar from "./RetrievalMetaBar";

interface ReferencePanelProps {
  references: Reference[];
  meta: RetrievalMeta | null;
  activeCite: number | null;
  loading: boolean;
  onCite: (index: number) => void;
  onView: (ref: Reference) => void;
  onCiteToInput: (ref: Reference) => void;
}

export default function ReferencePanel({
  references,
  meta,
  activeCite,
  loading,
  onCite,
  onView,
  onCiteToInput,
}: ReferencePanelProps) {
  const isEmpty = !loading && references.length === 0;

  return (
    <div className="flex h-full flex-col gap-3">
      <RetrievalMetaBar meta={meta} />

      <ScrollArea className="flex-1">
        {loading && (
          <div className="space-y-2 pr-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
            ))}
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--secondary)]">
              <Database className="size-5 text-[var(--text-tertiary)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-secondary)]">未召回知识库内容</p>
              <p className="mt-1 max-w-[220px] text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                本次回答可能来自大模型通用知识，未命中知识库片段
              </p>
            </div>
          </div>
        )}

        {!loading && references.length > 0 && (
          <div className="space-y-2 pr-1">
            {references.map((ref, i) => (
              <ReferenceCard
                key={ref.id || `${ref.entry_id}-${ref.chunk_index}`}
                reference={ref}
                index={i + 1}
                active={activeCite === i + 1}
                onCite={onCite}
                onView={onView}
                onCiteToInput={onCiteToInput}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}