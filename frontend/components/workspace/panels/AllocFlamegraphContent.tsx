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

interface AllocFlamegraphContentProps {
  allocData: any;
  allocLoading: boolean;
  allocError: string | null;
}

export default function AllocFlamegraphContent({ allocData, allocLoading, allocError }: AllocFlamegraphContentProps) {
  if (allocLoading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <SkeletonCard variant="chart" />
      </div>
    );
  }
  if (allocError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <EmptyState variant="error" title="加载失败" description={allocError} />
      </div>
    );
  }
  if (!allocData) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <EmptyState variant="no-data" title="无分配数据" description="该提交暂无内存分配分析数据" />
      </div>
    );
  }

  const colors = ['#FF453A', '#FF9F0A', '#FFD60A', '#30D158', '#64D2FF', '#0A84FF', '#BF5AF2', '#FF375F'];

  return (
    <div className="absolute inset-0 overflow-auto p-4 space-y-4">
      {allocData.summary && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '总分配量', value: humanSize(allocData.summary.total_allocated) },
            { label: '仍占用', value: humanSize(allocData.summary.still_allocated) },
            { label: '峰值堆', value: humanSize(allocData.summary.peak_heap) },
            { label: '分配次数', value: allocData.summary.alloc_count?.toLocaleString() || '0' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-border/50 bg-card p-4 text-center">
              <div className="text-xl font-bold tabular-nums">{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {allocData.top_allocators && allocData.top_allocators.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <h3 className="text-xs font-semibold mb-4">分配热点 Top {allocData.top_allocators.length}</h3>
          <div className="space-y-2">
            {allocData.top_allocators.map((alloc: any, i: number) => {
              const maxPct = allocData.top_allocators[0]?.percent || 100;
              const barW = Math.max((alloc.percent / maxPct) * 100, 1);
              return (
                <div key={i} className="group">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono text-muted-foreground w-4">{i + 1}</span>
                    <code className="text-[11px] flex-1 truncate">{alloc.function}</code>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{alloc.percent.toFixed(1)}%</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums w-16 text-right">{humanSize(alloc.total_bytes)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: barW + '%', backgroundColor: colors[i % colors.length] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>Trace 事件: {allocData.trace_count}</span>
        <span>内存事件: {allocData.mem_event_count}</span>
        {allocData.generated_at && <span>生成时间: {new Date(allocData.generated_at).toLocaleTimeString('zh-CN')}</span>}
      </div>
    </div>
  );
}
