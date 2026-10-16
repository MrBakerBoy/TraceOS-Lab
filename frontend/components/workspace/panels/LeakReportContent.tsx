'use client';

import React from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonCard } from '@/components/ui/skeleton-card';

function humanSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v >= 100 ? v.toFixed(0) + ' ' + units[i] : v.toFixed(1) + ' ' + units[i];
}

interface LeakReportContentProps {
  leakData: any;
  leakLoading: boolean;
  leakError: string | null;
}

export default function LeakReportContent({ leakData, leakLoading, leakError }: LeakReportContentProps) {
  if (leakLoading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <SkeletonCard variant="chart" />
      </div>
    );
  }

  if (leakError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <EmptyState variant="error" title="加载失败" description={leakError} />
      </div>
    );
  }

  if (!leakData) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <EmptyState variant="no-data" title="无泄漏数据" description="该提交暂无内存泄漏分析数据" />
      </div>
    );
  }

  const severityStyle = (s: string) => {
    switch(s) {
      case 'definitely': return { bg: 'rgba(255,69,58,0.15)', color: '#FF453A', label: '确认泄漏' };
      case 'indirectly': return { bg: 'rgba(255,159,10,0.15)', color: '#FF9F0A', label: '间接泄漏' };
      case 'possibly': return { bg: 'rgba(255,214,10,0.15)', color: '#FFD60A', label: '疑似泄漏' };
      default: return { bg: 'rgba(100,210,255,0.15)', color: '#64D2FF', label: '可达' };
    }
  };

  const hasLeaks = leakData.leaks && leakData.leaks.filter((l: any) => l.address).length > 0;

  return (
    <div className="absolute inset-0 overflow-auto p-4 space-y-4">
      {/* Leak Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '确认泄漏', value: leakData.leak_summary?.definitely_lost ?? 0, color: '#FF453A' },
          { label: '间接泄漏', value: leakData.leak_summary?.indirectly_lost ?? 0, color: '#FF9F0A' },
          { label: '疑似泄漏', value: leakData.leak_summary?.possibly_lost ?? 0, color: '#FFD60A' },
          { label: '可达未释放', value: leakData.leak_summary?.still_reachable ?? 0, color: '#64D2FF' },
        ].map(card => (
          <div key={card.label} className="rounded-xl border border-border/50 bg-card p-4 text-center">
            <div className="text-2xl font-bold tabular-nums" style={{ color: card.color }}>{card.value}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Heaptrack Stats */}
      {leakData.heaptrack_summary && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: '总分配', value: humanSize(leakData.heaptrack_summary.total_allocated) },
            { label: '总释放', value: humanSize(leakData.heaptrack_summary.total_freed) },
            { label: '仍占用', value: humanSize(leakData.heaptrack_summary.still_allocated) },
            { label: '峰值堆', value: humanSize(leakData.heaptrack_summary.peak_heap) },
            { label: '泄漏概率', value: ((leakData.heaptrack_summary.leak_probability ?? 0) * 100).toFixed(0) + '%' },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-border/50 bg-card/60 p-3 text-center">
              <div className="text-sm font-semibold tabular-nums">{s.value}</div>
              <div className="text-[10px] text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Leak List */}
      {hasLeaks ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold">泄漏详情</h3>
          {leakData.leaks.filter((l: any) => l.address).map((leak: any, i: number) => {
            const s = severityStyle(leak.severity);
            return (
              <div key={i} className="rounded-lg border border-border/50 bg-card p-3 hover:border-red-500/30 transition-colors">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: s.bg, color: s.color }}>{s.label}</span>
                  <code className="text-[11px]">{leak.source_file}:{leak.source_line}</code>
                  <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">{humanSize(leak.size)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{leak.description}</p>
                {leak.fix_suggestion && (
                  <p className="text-[10px] text-yellow-400/80 mt-1">{leak.fix_suggestion}</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center py-8">
          <EmptyState variant="no-data" title="未检测到泄漏" description="该提交未发现内存泄漏问题" />
        </div>
      )}

      {/* Heap History Mini Chart */}
      {leakData.heap_history && leakData.heap_history.length > 1 && (
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <h3 className="text-xs font-semibold mb-3">堆内存变化</h3>
          <div className="h-32 flex items-end gap-0.5">
            {leakData.heap_history.slice(-60).map((h: any, i: number) => {
              const maxH = Math.max(...leakData.heap_history.slice(-60).map((x: any) => x.heap_size as number), 1);
              const pct = (h.heap_size / maxH) * 100;
              const isNearPeak = h.heap_size > (leakData.heaptrack_summary?.peak_heap || 0) * 0.9;
              return (
                <div key={i} className="flex-1 relative" style={{ height: '100%' }}>
                  <div className="absolute bottom-0 left-0 right-0 rounded-t-sm" style={{
                    height: pct + '%', backgroundColor: isNearPeak ? '#FF453A' : '#30D158', opacity: 0.7,
                  }} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
