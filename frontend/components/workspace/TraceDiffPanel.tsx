'use client';

import { useEffect, useState, useCallback } from 'react';
import ViewHelpButton from "@/components/ui/ViewHelpButton";
import { TRACEDIFF_HELP } from "@/lib/view-help-content";

interface TraceSyscallEvent {
  index: number;
  name: string;
}

interface TraceAlignedPair {
  index: number;
  type: 'match' | 'mismatch' | 'missing' | 'extra';
  reference?: TraceSyscallEvent;
  student?: TraceSyscallEvent;
  diff_note?: string;
}

interface TraceDiffStats {
  total_reference: number;
  total_student: number;
  matches: number;
  mismatches: number;
  missing: number;
  extra: number;
}

interface TraceDiffResult {
  aligned_pairs: TraceAlignedPair[];
  score: number;
  stats: TraceDiffStats;
  similarity: number;
}

interface TraceDiffPanelProps {
  submissionId: string | null;
  className?: string;
}

export default function TraceDiffPanel({ submissionId, className }: TraceDiffPanelProps) {
  const [result, setResult] = useState<TraceDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showOnlyDiffs, setShowOnlyDiffs] = useState(false);

  const loadDiff = useCallback(async () => {
    if (!submissionId) return;
    setLoading(true);
    setError('');
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const token = localStorage.getItem('token');
      const res = await fetch(`${apiUrl}/api/v1/submissions/${submissionId}`, {
        headers: { Authorization: `Bearer ${token || ''}` },
      });
      if (!res.ok) throw new Error('Failed to load submission');
      const sub = await res.json();
      if (sub.trace_diff) {
        const diff: TraceDiffResult = typeof sub.trace_diff === 'string'
          ? JSON.parse(sub.trace_diff)
          : sub.trace_diff;
        setResult(diff);
      } else {
        setResult(null);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    loadDiff();
  }, [loadDiff]);

  const pairColor = (type: string) => {
    switch (type) {
      case 'match': return 'bg-[rgba(48,209,88,0.08)] border-l-2 border-green-400';
      case 'mismatch': return 'bg-[rgba(255,159,10,0.08)] border-l-2 border-yellow-400';
      case 'missing': return 'bg-[rgba(255,69,58,0.08)] border-l-2 border-red-400';
      case 'extra': return 'bg-[rgba(255,149,0,0.08)] border-l-2 border-orange-400';
      default: return '';
    }
  };

  const pairIcon = (type: string) => {
    switch (type) {
      case 'match': return '✅';
      case 'mismatch': return '⚠️';
      case 'missing': return '❌';
      case 'extra': return '➕';
      default: return '';
    }
  };

  const displayedPairs = result && showOnlyDiffs
    ? result.aligned_pairs.filter(p => p.type !== 'match')
    : result?.aligned_pairs;

  if (!submissionId) return null;

  return (
    <div className={`border-t border-[var(--border-default)] bg-[var(--bg-card)] ${className || ''}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)]">
        <span className="text-[13px] font-medium">📊 系统调用对比</span>
        {loading && (
          <span className="text-[11px] text-[var(--text-tertiary)]">加载中...</span>
        )}
        {!loading && !result && !error && (
          <span className="text-[11px] text-[var(--text-tertiary)]">暂无对比数据</span>
        )}
        {error && (
          <span className="text-[11px] text-[var(--error)]">{error}</span>
        )}
        <button
          onClick={loadDiff}
          className="ml-auto text-[10px] px-2 py-0.5 bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] rounded text-[var(--text-secondary)]"
        >
          刷新
        </button>
      </div>

      {result && (
        <div className="p-3 space-y-3">
          {/* Stats bar */}
          <div className="grid grid-cols-5 gap-2">
            <div className="text-center p-1.5 bg-[rgba(48,209,88,0.06)] rounded">
              <div className="text-[13px] font-bold text-green-500">{result.stats.matches}</div>
              <div className="text-[10px] text-green-400">匹配</div>
            </div>
            <div className="text-center p-1.5 bg-[rgba(255,159,10,0.06)] rounded">
              <div className="text-[13px] font-bold text-yellow-500">{result.stats.mismatches}</div>
              <div className="text-[10px] text-yellow-400">差异</div>
            </div>
            <div className="text-center p-1.5 bg-[rgba(255,69,58,0.06)] rounded">
              <div className="text-[13px] font-bold text-red-500">{result.stats.missing}</div>
              <div className="text-[10px] text-red-400">缺失</div>
            </div>
            <div className="text-center p-1.5 bg-[rgba(255,149,0,0.06)] rounded">
              <div className="text-[13px] font-bold text-orange-500">{result.stats.extra}</div>
              <div className="text-[10px] text-orange-400">多余</div>
            </div>
            <div className="text-center p-1.5 bg-[rgba(0,113,227,0.06)] rounded">
              <div className="text-[13px] font-bold text-[var(--accent)]">
                {(result.similarity * 100).toFixed(0)}%
              </div>
              <div className="text-[10px] text-[var(--accent)]">相似度</div>
            </div>
          </div>

          {/* Toggle filter */}
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyDiffs}
              onChange={e => setShowOnlyDiffs(e.target.checked)}
              className="w-3 h-3 rounded accent-[var(--accent)]"
            />
            仅显示差异
          </label>

          {/* Diff list */}
          <div className="max-h-80 overflow-y-auto border border-[var(--border-default)] rounded">
            {displayedPairs && displayedPairs.length > 0 ? (
              displayedPairs.map((pair, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 px-2.5 py-1.5 border-b border-[var(--border-default)] last:border-0 text-xs font-mono ${pairColor(pair.type)}`}
                >
                  <span className="text-[11px] min-w-[18px] shrink-0">{pairIcon(pair.type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[var(--text-tertiary)] min-w-[22px]">#{pair.index + 1}</span>
                      {pair.reference && (
                        <code className="truncate text-[var(--text-primary)]">
                          {pair.reference.name}()
                        </code>
                      )}
                      {pair.student && pair.type === 'extra' && (
                        <code className="truncate text-orange-500">
                          {pair.student.name}()
                        </code>
                      )}
                    </div>
                    {pair.type !== 'match' && pair.student && pair.reference && (
                      <div className="ml-[44px] truncate">
                        <code className="text-red-400">{pair.reference.name}()</code>
                        <span className="text-[var(--text-tertiary)] mx-1">→</span>
                        <code className="text-orange-400">{pair.student.name}()</code>
                      </div>
                    )}
                    {pair.diff_note && (
                      <div className="ml-[44px] text-[10px] text-[var(--text-tertiary)] italic mt-0.5">
                        💡 {pair.diff_note}
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-[11px] text-[var(--text-tertiary)]">
                {showOnlyDiffs ? '🎉 所有系统调用完全匹配！' : '无对比数据'}
              </div>
            )}
          </div>

          <div className="text-[10px] text-[var(--text-tertiary)] text-right">
            参考: {result.stats.total_reference} 次调用 · 学生: {result.stats.total_student} 次调用
          </div>
        </div>
      )}
    </div>
  );
}
