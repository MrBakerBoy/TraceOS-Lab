"use client";

import { useState, useEffect } from "react";
import { api, AdaptiveProfile } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Brain, Target, Zap, TrendingUp, AlertCircle, Award, Clock, Activity,
  ChevronDown, ChevronUp, Sparkles
} from "lucide-react";

interface AdaptivePanelProps {
  className?: string;
}

// Category display names + colors
const CATEGORY_META: Record<string, { label: string; color: string; glow: string }> = {
  "\u8fdb\u7a0b\u7ba1\u7406": { label: "\u8fdb\u7a0b", color: "#0A84FF", glow: "rgba(10,132,255,0.3)" },
  "\u7ebf\u7a0b\u540c\u6b65": { label: "\u7ebf\u7a0b", color: "#BF5AF2", glow: "rgba(191,90,242,0.3)" },
  "\u5185\u5b58\u7ba1\u7406": { label: "\u5185\u5b58", color: "#30D158", glow: "rgba(48,209,88,0.3)" },
  "\u6587\u4ef6\u7cfb\u7edf": { label: "\u6587\u4ef6", color: "#FF9F0A", glow: "rgba(255,159,10,0.3)" },
  "\u5904\u7406\u673a\u8c03\u5ea6": { label: "\u8c03\u5ea6", color: "#FF375F", glow: "rgba(255,55,95,0.3)" },
  "\u6b7b\u9501": { label: "\u6b7b\u9501", color: "#FF6482", glow: "rgba(255,100,130,0.3)" },
};

const MAX_ELO = 2400;
const LEVELS = 5;

export default function AdaptivePanel({ className }: AdaptivePanelProps) {
  const [profile, setProfile] = useState<AdaptiveProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [error, setError] = useState("");
  const [animated, setAnimated] = useState(false);

  useEffect(() => { loadProfile(); }, []);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const data = await api.getAdaptiveProfile();
      setProfile(data);
      setTimeout(() => setAnimated(true), 300);
    } catch (e: any) {
      setError(e.message || "Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={cn("p-4", className)}>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-[var(--kt-border)] rounded w-2/3" />
          <div className="h-48 bg-[var(--kt-bg-surface)] rounded-xl" />
          <div className="grid grid-cols-3 gap-2">
            {[1,2,3].map(i => <div key={i} className="h-14 bg-[var(--kt-bg-surface)] rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("p-4 text-center", className)}>
        <AlertCircle className="size-6 text-[var(--kt-red)] mx-auto mb-2" />
        <p className="text-xs text-[var(--kt-text-secondary)]">{error}</p>
        <button onClick={loadProfile} className="text-xs text-[var(--kt-cyan)] mt-2 hover:underline">
          重试
        </button>
      </div>
    );
  }

  if (!profile) return null;

  const radarData = profile.radar;
  const categories = Object.keys(radarData);
  const values = Object.values(radarData) as number[];

  // SVG Radar Chart
  const SIZE = 300;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const RADIUS = 100;

  const getAngle = (index: number) => (2 * Math.PI * index) / categories.length - Math.PI / 2;
  const getCoord = (index: number, value: number, r: number) => {
    const angle = getAngle(index);
    const ratio = Math.max(0.05, value / MAX_ELO);
    return { x: CX + r * ratio * Math.cos(angle), y: CY + r * ratio * Math.sin(angle) };
  };

  // Data polygon
  const dataPoints = categories.map((_, i) => getCoord(i, values[i], RADIUS));
  const dataPath = dataPoints.map((p, i) => (i === 0 ? "M" : "L") + ` ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") + " Z";

  // Grid
  const gridPolygons = Array.from({ length: LEVELS }, (_, level) => {
    const r = (RADIUS * (level + 1)) / LEVELS;
    const pts = categories.map((_, i) => getCoord(i, MAX_ELO, r));
    return pts.map((p, i) => (i === 0 ? "M" : "L") + ` ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") + " Z";
  });

  // Axes
  const axes = categories.map((_, i) => {
    const end = getCoord(i, MAX_ELO, RADIUS + 8);
    return { x1: CX, y1: CY, x2: end.x, y2: end.y };
  });

  // Labels - placed further out with alternating offset to avoid overlap
  const labels = categories.map((cat, i) => {
    const angle = getAngle(i);
    const labelR = RADIUS + 32;
    const x = CX + labelR * Math.cos(angle);
    const y = CY + labelR * Math.sin(angle);
    const meta = CATEGORY_META[cat] || { label: cat, color: "#0A84FF", glow: "rgba(10,132,255,0.3)" };
    // Adjust textAnchor based on position
    const absAngle = ((angle + Math.PI * 2) % (Math.PI * 2));
    let anchor: "start" | "middle" | "end" = "middle";
    if (absAngle < 0.3 || absAngle > 5.9) anchor = "start";
    else if (absAngle > 2.8 && absAngle < 3.4) anchor = "end";
    const dy = Math.abs(Math.sin(angle)) > 0.8 ? (Math.sin(angle) > 0 ? "0.3em" : "-0.3em") : "0.35em";
    return (
      <text key={i} x={x} y={y} textAnchor={anchor} dominantBaseline="middle"
        dy={dy} fontSize="11" fontWeight="600" fill={meta.color}
        style={{ textShadow: "0 0 8px " + meta.glow }}>
        {meta.label}
      </text>
    );
  });

  // Score dots
  const scoreDots = dataPoints.map((p, i) => {
    const meta = CATEGORY_META[categories[i]] || { color: "#0A84FF", glow: "rgba(10,132,255,0.3)" };
    return (
      <g key={i}>
        <circle cx={p.x} cy={p.y} r="6" fill={meta.color} opacity="0.2"
          className={cn("transition-all duration-1000", animated && "opacity-100")}
          style={{ filter: "blur(3px)" }} />
        <circle cx={p.x} cy={p.y} r="3.5" fill={meta.color} stroke="#0d0d12" strokeWidth="1.5" />
        <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="9" fontWeight="700"
          fill={meta.color} opacity="0.8">{values[i]}</text>
      </g>
    );
  });

  // Stats
  const statItems = [
    {
      label: "总提交", value: profile.total_submissions,
      icon: Activity, color: "#0A84FF", bg: "rgba(10,132,255,0.08)",
    },
    {
      label: "学习速度", value: profile.profile.learning_pace === "fast" ? "快" : profile.profile.learning_pace === "slow" ? "慢" : "中",
      icon: profile.profile.learning_pace === "fast" ? Zap : Clock,
      color: profile.profile.learning_pace === "fast" ? "#30D158" : profile.profile.learning_pace === "slow" ? "#FF9F0A" : "#0A84FF",
      bg: profile.profile.learning_pace === "fast" ? "rgba(48,209,88,0.08)" : "rgba(255,159,10,0.08)",
    },
    {
      label: "偏好难度", value: profile.profile.preferred_difficulty === "easy" ? "简单" : profile.profile.preferred_difficulty === "hard" ? "困难" : "中",
      icon: Target,
      color: profile.profile.preferred_difficulty === "hard" ? "#BF5AF2" : "#FF9F0A",
      bg: "rgba(191,90,242,0.08)",
    },
  ];

  return (
    <div className={cn("flex flex-col gap-4 p-4", className)}>
      {/* Header - clickable to toggle */}
      <div className="flex items-center gap-2 cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, rgba(10,132,255,0.2), rgba(191,90,242,0.2))" }}>
          <Brain className="size-3.5" style={{ color: "#BF5AF2" }} />
        </div>
        <div>
          <h3 className="text-xs font-semibold text-[var(--kt-text)]">学习能力画像</h3>
          <p className="text-[10px] text-[var(--kt-text-tertiary)]">操作系统知识点雷达</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {collapsed && <Sparkles className="size-3 text-[var(--kt-text-tertiary)]" />}
          {collapsed
            ? <ChevronDown className="size-3.5 text-[var(--kt-text-tertiary)]" />
            : <ChevronUp className="size-3.5 text-[var(--kt-text-tertiary)]" />}
        </div>
      </div>

      {collapsed ? null : (<>
      {/* Content wrapper */}

      {/* Radar Chart */}
      <div className="flex justify-center relative">
        <div className="absolute inset-0 rounded-full opacity-[0.03]"
          style={{
            background: "radial-gradient(circle, #BF5AF2 0%, #0A84FF 40%, transparent 70%)",
            filter: "blur(40px)",
            width: SIZE, height: SIZE,
          }} />
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {/* Grid */}
          {gridPolygons.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--kt-border)" strokeWidth="1"
              strokeDasharray={i === LEVELS - 1 ? "none" : "3 2"} opacity={i === LEVELS - 1 ? 0.6 : 0.3} />
          ))}
          {/* Axes */}
          {axes.map((a, i) => (
            <line key={i} {...a} stroke="var(--kt-border)" strokeWidth="0.5" opacity="0.4" />
          ))}
          {/* Data area with gradient */}
          <defs>
            <radialGradient id="radarGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#BF5AF2" stopOpacity="0.25" />
              <stop offset="50%" stopColor="#0A84FF" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#0A84FF" stopOpacity="0.03" />
            </radialGradient>
            <filter id="radarGlow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <path d={dataPath} fill="url(#radarGrad)" stroke="url(#radarGrad)"
            strokeWidth="1.5" filter="url(#radarGlow)"
            className={cn("transition-all duration-1000 ease-out", animated ? "opacity-100" : "opacity-0")}
            style={{ transformOrigin: "center", transform: animated ? "scale(1)" : "scale(0.8)" }} />
          {/* Score dots */}
          <g className={cn("transition-all duration-700", animated ? "opacity-100" : "opacity-0")}>
            {scoreDots}
          </g>
          {/* Labels */}
          {labels}
        </svg>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-2">
        {statItems.map((item, i) => (
          <div key={i} className="p-2.5 rounded-xl border border-[var(--kt-border)] text-center transition-all duration-300 hover:border-[var(--kt-border-strong)]"
            style={{ background: "var(--kt-bg-surface)" }}>
            <item.icon className="size-3 mx-auto mb-1" style={{ color: item.color }} />
            <p className="text-sm font-bold text-[var(--kt-text)]">{item.value}</p>
            <p className="text-[9px] text-[var(--kt-text-tertiary)] uppercase tracking-wider">{item.label}</p>
          </div>
        ))}
      </div>

      {/* 薄弱概念 */}
      {(profile.profile.weak_concepts || []).length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <AlertCircle className="size-3 text-[var(--kt-orange)]" />
            <p className="text-[10px] text-[var(--kt-text-tertiary)] uppercase tracking-wider">薄弱概念</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {profile.profile.weak_concepts.map((c, i) => {
              const meta = CATEGORY_META[c] || { color: "#FF9F0A" };
              return (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-all duration-300 hover:scale-105"
                  style={{
                    color: meta.color,
                    background: meta.color + "12",
                    borderColor: meta.color + "25",
                  }}>
                  <span className="w-1 h-1 rounded-full" style={{ background: meta.color }} />
                  {c}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* 最近得分 */}
      {(profile.recent_scores || []).length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="size-3 text-[var(--kt-cyan)]" />
            <p className="text-[10px] text-[var(--kt-text-tertiary)] uppercase tracking-wider">最近得分</p>
          </div>
          <div className="flex items-end gap-1 h-14">
            {profile.recent_scores.slice(-12).map((s, i) => {
              const color = s >= 80 ? "#30D158" : s >= 50 ? "#FF9F0A" : "#FF375F";
              return (
                <div key={i} className="flex-1 relative group cursor-pointer">
                  <div className="absolute bottom-0 w-full rounded-t-sm transition-all duration-500 hover:brightness-125"
                    style={{
                      height: Math.max(s, 8) + "%",
                      background: "linear-gradient(to top, " + color + ", " + color + "88)",
                      boxShadow: "0 0 6px " + color + "44",
                    }} />
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-mono text-[var(--kt-text)] opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--kt-bg-elevated)] px-1.5 py-0.5 rounded border border-[var(--kt-border)] whitespace-nowrap z-10">
                    {s}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ELO Score summary */}
      <div className="flex items-center justify-between p-3 rounded-xl border border-[var(--kt-border)]"
        style={{ background: "linear-gradient(135deg, rgba(10,132,255,0.04), rgba(191,90,242,0.04))" }}>
        <div className="flex items-center gap-2">
          <Award className="size-4" style={{ color: "#FF9F0A" }} />
          <span className="text-[10px] text-[var(--kt-text-tertiary)]">平均 ELO</span>
        </div>
        <span className="text-sm font-bold" style={{
          background: "linear-gradient(135deg, #0A84FF, #BF5AF2)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}>
          {Math.round(values.reduce((a, b) => a + b, 0) / values.length)}
        </span>
      </div>
      </>)}
    </div>
  );
}
