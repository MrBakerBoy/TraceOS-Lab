'use client';

import React, { useState } from 'react';
import { Lightbulb, ChevronDown, ChevronRight, GraduationCap, ArrowRight } from 'lucide-react';

/**
 * TeachingHintPanel — Progressive three-level teaching hint system.
 *
 * Design reference: TraceOS Suprative Method (L1→L2→L3 Socratic progression)
 *
 * L1 (引导): Guide student to observe the observation panel themselves
 * L2 (提示): Give directional hint without revealing answer
 * L3 (解释): Full explanation after multiple attempts
 */

export interface HintLevel {
  level: number;
  hints: string[];
  os_concept?: string;
  experiment_link?: string;
  further_reading?: string;
}

interface TeachingHintPanelProps {
  issueType: string;
  issueTitle: string;
  severity: 'critical' | 'warning' | 'info';
  hints: HintLevel[];
  fixSuggestion?: string;
  onViewPanel?: (panel: string) => void;
  relatedPanel?: string;
}

export default function TeachingHintPanel({
  issueType,
  issueTitle,
  severity,
  hints,
  fixSuggestion,
  onViewPanel,
  relatedPanel,
}: TeachingHintPanelProps) {
  const [revealedLevel, setRevealedLevel] = useState(0);

  const severityColors = {
    critical: 'border-red-500/30 bg-red-500/5',
    warning: 'border-amber-500/30 bg-amber-500/5',
    info: 'border-blue-500/30 bg-blue-500/5',
  };

  const severityBadge = {
    critical: 'bg-red-500/10 text-red-600 border-red-500/20',
    warning: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    info: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  };

  const revealNext = () => {
    setRevealedLevel((prev) => Math.min(prev + 1, hints.length));
  };

  return (
    <div className={`rounded-lg border ${severityColors[severity]} overflow-hidden`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-inherit flex items-center gap-3">
        <Lightbulb className="w-5 h-5 text-amber-500" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{issueTitle}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityBadge[severity]}`}>
              {severity === 'critical' ? '严重' : severity === 'warning' ? '注意' : '提示'}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">{issueType}</div>
        </div>
        {relatedPanel && onViewPanel && (
          <button
            onClick={() => onViewPanel(relatedPanel)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            查看面板 <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Progressive hints */}
      <div className="divide-y divide-inherit">
        {hints.map((hint, idx) => {
          const isRevealed = idx < revealedLevel;
          const levelLabel = idx === 0 ? 'L1 引导' : idx === 1 ? 'L2 提示' : 'L3 解释';

          return (
            <div key={idx} className="px-4 py-2.5">
              <button
                onClick={() => {
                  if (!isRevealed && idx === revealedLevel) {
                    revealNext();
                  }
                }}
                className="w-full text-left flex items-start gap-2"
              >
                {isRevealed ? (
                  <ChevronDown className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                )}
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    {levelLabel}{isRevealed ? '' : ' (点击展开)'}
                  </div>
                  {isRevealed ? (
                    <ul className="space-y-1">
                      {hint.hints.map((h, i) => (
                        <li key={i} className="text-sm flex items-start gap-2">
                          <span className="text-primary mt-1.5 w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                          {h}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-muted-foreground/60 italic">
                      思考一下，再点开看看...
                    </div>
                  )}
                </div>
              </button>

              {/* OS concept and further reading for L3 */}
              {isRevealed && hint.os_concept && (
                <div className="mt-2 ml-6 flex items-center gap-2 text-xs text-muted-foreground">
                  <GraduationCap className="w-3.5 h-3.5" />
                  <span>OS概念: {hint.os_concept}</span>
                  {hint.further_reading && (
                    <span className="text-primary/70">· {hint.further_reading}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Fix suggestion (always visible at bottom) */}
      {fixSuggestion && revealedLevel >= hints.length && (
        <div className="px-4 py-3 bg-emerald-500/5 border-t border-emerald-500/20">
          <div className="text-xs font-medium text-emerald-600 mb-1">🔧 修复建议</div>
          <div className="text-sm text-emerald-700">{fixSuggestion}</div>
        </div>
      )}

      {/* Reveal hint button */}
      {revealedLevel < hints.length && (
        <div className="px-4 py-2 bg-muted/30 border-t border-inherit">
          <button
            onClick={revealNext}
            className="w-full text-center text-xs text-primary hover:underline"
          >
            需要更多提示？点此展开下一级
          </button>
        </div>
      )}
    </div>
  );
}
