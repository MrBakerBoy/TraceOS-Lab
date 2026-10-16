"use client";

import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export function SectionHeader({ icon, title, subtitle, children }: {
  icon: ReactNode; title: string; subtitle?: string; children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-4 mb-8">
      <div className="flex items-center gap-4">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#0A84FF] to-[#BF5AF2] blur-xl opacity-40 animate-pulse" />
          <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-[#0A84FF] via-[#6366F1] to-[#BF5AF2] flex items-center justify-center shadow-lg shadow-blue-500/25 border border-white/10">
            {icon}
          </div>
        </div>
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] bg-gradient-to-r from-white via-white to-white/70 bg-clip-text text-transparent">
            {title}
          </h1>
          {subtitle && <p className="text-sm text-white/40 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function StatPill({ label, value, color, icon, active, onClick }: {
  label: string; value: number; color: string; icon?: ReactNode;
  active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-3 px-5 py-3 rounded-2xl border transition-all duration-300 group",
        active
          ? "border-white/20 bg-white/[0.08] shadow-lg"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
      )}
    >
      <div
        className="w-3 h-3 rounded-full ring-2 ring-offset-2 ring-offset-[#0d0d12] transition-all duration-300 group-hover:scale-125"
        style={{ backgroundColor: color, boxShadow: `0 0 12px ${color}40` }}
      />
      <div className="text-left">
        <div className="text-[22px] font-bold tabular-nums tracking-tight" style={{ color }}>
          {value}
        </div>
        <div className="text-[11px] text-white/40">{label}</div>
      </div>
      {icon && <div className="ml-auto text-white/20 group-hover:text-white/40 transition-colors">{icon}</div>}
    </button>
  );
}
