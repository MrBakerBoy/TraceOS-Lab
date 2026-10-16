'use client';

import React from 'react';
import { useWorkspaceStore } from '@/stores/workspace';
import { Eye, Search, Bug, ChevronRight } from 'lucide-react';
import type { TierLevel } from '@/types/obs_context';

/**
 * TierNavBar — Three-tier navigation for the TraceOS observability system.
 *
 * Design reference: Grafana 3-tier dashboard navigation + Google SRE drill-down.
 *
 * Tier 1: Panoramic Overview (全景总览) — 4-6 panels, 5-second rule
 * Tier 2: Process Deep Analysis (进程深度分析) — 12-16 panels, RED+USE
 * Tier 3: Function-level Debug (函数级调试) — ≤20 panels, diff flamegraphs
 */
export default function TierNavBar() {
  const tierState = useWorkspaceStore((s) => s.tierState);
  const setTier = useWorkspaceStore((s) => s.setTier);
  const obsContext = useWorkspaceStore((s) => s.obsContext);

  const tiers: { level: TierLevel; icon: React.ReactNode; label: string; desc: string }[] = [
    {
      level: 1,
      icon: <Eye className="w-4 h-4" />,
      label: '全景总览',
      desc: '5秒判读',
    },
    {
      level: 2,
      icon: <Search className="w-4 h-4" />,
      label: '深度分析',
      desc: '进程/资源/锁',
    },
    {
      level: 3,
      icon: <Bug className="w-4 h-4" />,
      label: '函数调试',
      desc: '火焰图/源码/竞态',
    },
  ];

  const anomalyCount = obsContext?.anomaly_summary?.length || 0;

  return (
    <div className="tier-nav flex items-center gap-1 px-3 py-1.5 bg-muted/30 border-b">
      {tiers.map((tier, idx) => {
        const isActive = tierState.currentTier === tier.level;
        const isReachable = tier.level <= tierState.currentTier + 1;

        return (
          <React.Fragment key={tier.level}>
            {idx > 0 && (
              <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
            )}
            <button
              onClick={() => { console.log("[TierNavBar] clicked tier:", tier.level, "isReachable:", isReachable); if (isReachable) setTier(tier.level); }}
              disabled={!isReachable}
              className={`
                flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium
                transition-all duration-200
                ${isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : isReachable
                    ? 'hover:bg-muted text-foreground cursor-pointer'
                    : 'text-muted-foreground/40 cursor-not-allowed'
                }
              `}
            >
              <span className={isActive ? 'text-primary-foreground' : ''}>
                {tier.icon}
              </span>
              <span>T{tier.level}</span>
              <span className="hidden sm:inline">{tier.label}</span>
              {tier.level === 1 && (
                <span className={`
                  ml-0.5 px-1 py-0.5 rounded-full text-[10px] leading-none
                  ${isActive
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : anomalyCount > 0 ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'
                  }
                `}>
                  {anomalyCount}
                </span>
              )}
            </button>
          </React.Fragment>
        );
      })}

      {/* Tier description */}
      <span className="ml-auto text-[10px] text-muted-foreground hidden md:inline">
        {tiers[tierState.currentTier - 1]?.desc}
      </span>
    </div>
  );
}
