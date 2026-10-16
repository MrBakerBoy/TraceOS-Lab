'use client';

import React from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
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

interface MemoryTrendContentProps {
  trendData: any;
  trendLoading: boolean;
  trendError: string | null;
}

export default function MemoryTrendContent({ trendData, trendLoading, trendError }: MemoryTrendContentProps) {
  if (trendLoading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <SkeletonCard variant="chart" />
      </div>
    );
  }
  if (trendError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <EmptyState variant="error" title="加载失败" description={trendError} />
      </div>
    );
  }
  if (!trendData) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <EmptyState variant="no-data" title="无趋势数据" description="该提交暂无内存趋势分析数据" />
      </div>
    );
  }

  const dir = trendData.summary?.trend_direction || 'stable';
  const config: Record<string, { icon: typeof ArrowUp; color: string; bg: string; border: string; label: string }> = {
    growing: { icon: ArrowUp, color: '#FF453A', bg: 'rgba(255,69,58,0.08)', border: 'rgba(255,69,58,0.4)', label: '堆内存持续增长' },
    shrinking: { icon: ArrowDown, color: '#30D158', bg: 'rgba(48,209,88,0.08)', border: 'rgba(48,209,88,0.4)', label: '堆内存持续收缩' },
    stable: { icon: Minus, color: '#64D2FF', bg: 'rgba(100,210,255,0.08)', border: 'rgba(100,210,255,0.4)', label: '堆内存保持稳定' },
  };
  const dc = config[dir] || config.stable;
  const DirIcon = dc.icon;

  return (
    <div className="absolute inset-0 overflow-auto p-4 space-y-4">
      {/* Trend Direction Banner */}
      {trendData.summary && (
        <div className="rounded-xl border p-4" style={{ borderColor: dc.border, backgroundColor: dc.bg }}>
          <div className="flex items-center gap-3">
            <DirIcon className="size-5" style={{ color: dc.color }} />
            <div>
              <div className="text-sm font-semibold" style={{ color: dc.color }}>{dc.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                增长率: {trendData.summary.growth_rate_mbps > 0 ? '+' : ''}{trendData.summary.growth_rate_mbps?.toFixed(2) || '0'} MB/s
                {' · '}峰值: {humanSize(trendData.summary.peak_heap_bytes)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Heap Timeline Chart */}
      {trendData.heap_timeline && trendData.heap_timeline.length > 1 && (
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <h3 className="text-xs font-semibold mb-3">堆大小时间线</h3>
          <div className="h-32 flex items-end gap-0.5">
            {(() => {
              const timeline = trendData.heap_timeline.slice(-80);
              const maxH = Math.max(...timeline.map((p: any) => Math.max(p.heap_size || 0, p.peak_heap || 0)), 1);
              return timeline.map((p: any, i: number) => (
                <div key={i} className="flex-1 flex flex-col justify-end gap-px" style={{ height: '100%' }}>
                  <div className="w-full rounded-t-sm" style={{
                    height: Math.max(((p.heap_size || 0) / maxH) * 100, 0.5) + '%',
                    backgroundColor: '#30D158', opacity: 0.85,
                  }} />
                  {p.peak_heap > 0 && (
                    <div className="w-full" style={{ height: '2px', backgroundColor: '#FF9F0A', opacity: 0.5 }} />
                  )}
                </div>
              ));
            })()}
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground mt-2">
            <span>{trendData.heap_timeline[0]?.timestamp ? new Date(trendData.heap_timeline[0].timestamp).toLocaleTimeString('zh-CN') : ''}</span>
            <span>{trendData.heap_timeline[trendData.heap_timeline.length - 1]?.timestamp ? new Date(trendData.heap_timeline[trendData.heap_timeline.length - 1].timestamp).toLocaleTimeString('zh-CN') : ''}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#30D158]" /> Heap</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#FF9F0A]" /> Peak</span>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      {trendData.summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border/50 bg-card/60 p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{trendData.summary.growth_rate_mbps?.toFixed(2) || '0'} MB/s</div>
            <div className="text-[10px] text-muted-foreground">净增长率</div>
          </div>
          <div className="rounded-lg border border-border/50 bg-card/60 p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{humanSize(trendData.summary.still_allocated)}</div>
            <div className="text-[10px] text-muted-foreground">仍占用内存</div>
          </div>
          <div className="rounded-lg border border-border/50 bg-card/60 p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{trendData.mem_event_count}</div>
            <div className="text-[10px] text-muted-foreground">内存事件</div>
          </div>
        </div>
      )}
    </div>
  );
}
