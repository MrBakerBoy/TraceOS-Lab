"use client";

import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  BarChart3, Trophy, Target, TrendingUp, Activity,
  Users, BookOpen, CheckCircle2, ChevronRight, ChevronDown,
  Award, Zap, Star, Clock, Sparkles, Brain, FileCode
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────

interface ExperimentStat {
  experiment_id: string; title: string; category: string;
  total_submissions: number; passed_submissions: number;
  pass_rate: number; avg_score: number;
}

interface DashboardOverview {
  total_students: number; total_submissions: number;
  total_experiments: number; avg_pass_rate: number;
}

interface DashboardData {
  experiment_stats: ExperimentStat[];
  score_distribution: { range: string; count: number }[];
  daily_submissions: { date: string; count: number }[];
  difficult_experiments: ExperimentStat[];
  overview: DashboardOverview;
}

interface ProgressItem {
  experiment_id: string; best_score: number;
  total_submissions: number; last_submission_at?: string;
}

// ── Helpers ────────────────────────────────────────────────

const sc = (s: number) =>
  s >= 80 ? "#30D158" : s >= 50 ? "#FF9F0A" : "#FF453A";

const categoryColor: Record<string, string> = {
  process: "#0A84FF", thread: "#BF5AF2", memory: "#30D158",
  scheduler: "#FF9F0A", fs: "#FF375F", ipc: "#64D2FF",
};

const categoryIcon: Record<string, string> = {
  process: "⚙️", thread: "🧵", memory: "🧠",
  scheduler: "📋", fs: "📁", ipc: "🔗",
};

// ── Animated Counter ───────────────────────────────────────

function AnimatedNumber({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const duration = 1000;
    const steps = 30;
    const increment = value / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= value) { setDisplay(value); clearInterval(timer); }
      else { setDisplay(current); }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value]);
  return <>{decimals > 0 ? display.toFixed(decimals) : Math.floor(display)}{suffix}</>;
}

// ── Main Component ─────────────────────────────────────────

export default function ProgressPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [personalProgress, setPersonalProgress] = useState<ProgressItem[]>([]);
  const [experiments, setExperiments] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [expandedStudents, setExpandedStudents] = useState<Set<string>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [ur, pr, er] = await Promise.all([
        api.getMe(), api.getMyProgress(), api.getExperiments({})
      ]);
      const u = (ur as any)?.user || ur;
      setUser(u);
      const role = u?.role || "student";

      const expMap: Record<string, any> = {};
      (er.data || er || []).forEach((e: any) => { expMap[e.id] = e; });
      setExperiments(expMap);

      // Teacher/admin: fetch dashboard
      if (role === "teacher" || role === "admin") {
        try {
          const dash = await api.getTeacherDashboard() as DashboardData;
          setDashboard(dash);
        } catch (e) { console.log("Dashboard fetch failed:", e); }
      }

      // Personal progress
      const pd = (pr as any)?.data || pr;
      if (Array.isArray(pd) && pd.length > 0) {
        setPersonalProgress(pd);
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const role = user?.role || "student";
  const isTeacher = role === "teacher" || role === "admin";

  // Compute derived stats
  const totalPassed = dashboard?.experiment_stats?.reduce((s, e) => s + e.passed_submissions, 0) || 0;
  const totalSubs = dashboard?.overview?.total_submissions || 0;
  const passRate = totalSubs > 0 ? ((totalPassed / totalSubs) * 100) : 0;

  // Filter experiments by category
  const filteredStats = useMemo(() => {
    if (!dashboard?.experiment_stats) return [];
    if (selectedCategory === "all") return dashboard.experiment_stats;
    return dashboard.experiment_stats.filter(e => e.category === selectedCategory);
  }, [dashboard, selectedCategory]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    dashboard?.experiment_stats?.forEach(e => cats.add(e.category));
    return Array.from(cats);
  }, [dashboard]);

  // ── Loading ──────────────────────────────────────────────

  if (loading) return (
    <div className="p-8 animate-fade-in">
      <Skeleton className="h-8 w-48 mb-4" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {[1,2,3,4].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}
      </div>
    </div>
  );

  // ── Teacher/Admin View ───────────────────────────────────

  if (isTeacher) return (
    <div className="p-6 lg:p-8 animate-fade-in max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#0A84FF] via-[#BF5AF2] to-[#30D158] flex items-center justify-center shadow-lg shadow-primary/25">
            <BarChart3 className="size-6 text-white" />
          </div>
          <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#30D158] border-2 border-background animate-pulse" />
        </div>
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">学习进度看板</h1>
          <p className="text-sm text-muted-foreground">全班级学习数据总览与实验分析</p>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: "学生总数", value: dashboard?.overview?.total_students || 0, icon: Users, color: "#0A84FF", bg: "rgba(10,132,255,0.1)" },
          { label: "提交总数", value: totalSubs, icon: FileCode, color: "#BF5AF2", bg: "rgba(191,90,242,0.1)" },
          { label: "实验数量", value: dashboard?.overview?.total_experiments || 0, icon: BookOpen, color: "#FF9F0A", bg: "rgba(255,159,10,0.1)" },
          { label: "通过率", value: dashboard?.overview?.avg_pass_rate || 0, suffix: "%", icon: CheckCircle2, color: "#30D158", bg: "rgba(48,209,88,0.1)", decimals: 2 },
        ].map((item, i) => (
          <div key={i}
            className="group rounded-2xl border border-border/50 bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:border-primary/20 card-inner-glow relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--stat-color)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{ "--stat-color": item.color } as any} />
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{item.label}</span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: item.bg }}>
                <item.icon className="size-4" style={{ color: item.color }} />
              </div>
            </div>
            <span className="text-[32px] font-bold tracking-tight" style={{ color: item.color }}>
              <AnimatedNumber value={item.value} decimals={(item as any).decimals || 0} suffix={item.suffix || ""} />
            </span>
          </div>
        ))}
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setSelectedCategory("all")}
          className={cn(
            "px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border",
            selectedCategory === "all"
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border/50 text-muted-foreground hover:border-primary/20 hover:text-foreground"
          )}
        >全部</button>
        {categories.map(cat => (
          <button key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={cn(
              "px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border flex items-center gap-1.5",
              selectedCategory === cat
                ? "border-current text-white"
                : "border-border/50 text-muted-foreground hover:border-primary/20 hover:text-foreground"
            )}
            style={selectedCategory === cat ? { backgroundColor: categoryColor[cat] || "#0A84FF", borderColor: categoryColor[cat] || "#0A84FF" } : {}}
          >
            <span>{categoryIcon[cat] || "📦"}</span>
            {cat === "process" ? "进程" : cat === "thread" ? "线程" : cat === "memory" ? "内存" : cat === "scheduler" ? "调度" : cat === "fs" ? "文件系统" : cat === "ipc" ? "IPC" : cat}
          </button>
        ))}
      </div>

      {/* Experiment Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
        {filteredStats.map((exp) => {
          const passColor = exp.pass_rate >= 60 ? "#30D158" : exp.pass_rate >= 30 ? "#FF9F0A" : "#FF453A";
          return (
            <div key={exp.experiment_id}
              className="group rounded-xl border border-border/50 bg-card p-5 hover:border-primary/20 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 card-inner-glow relative overflow-hidden">
              {/* Kernel scan line */}
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 kernel-scan" />
              
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{categoryIcon[exp.category] || "📦"}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: (categoryColor[exp.category] || "#0A84FF") + "20", color: categoryColor[exp.category] || "#0A84FF" }}>
                      {exp.category === "process" ? "进程" : exp.category === "thread" ? "线程" : exp.category === "memory" ? "内存" : exp.category === "scheduler" ? "调度" : exp.category === "fs" ? "文件系统" : exp.category || "通用"}
                    </span>
                  </div>
                  <h3 className="text-[15px] font-semibold truncate" title={exp.title}>{exp.title}</h3>
                </div>
                <div className="text-right ml-3">
                  <div className="text-[24px] font-bold" style={{ color: passColor }}>
                    {exp.pass_rate.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">通过率</div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mb-3">
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                  <span>通过 {exp.passed_submissions}/{exp.total_submissions}</span>
                  <span>均分 {exp.avg_score.toFixed(2)}</span>
                </div>
                <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                  <div className="absolute inset-0 rounded-full transition-all duration-700"
                    style={{
                      width: `${exp.pass_rate}%`,
                      background: `linear-gradient(90deg, ${passColor}, ${passColor}88)`,
                    }} />
                  <div className="absolute inset-0 rounded-full shimmer" />
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><FileCode className="size-3" />{exp.total_submissions} 提交</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="size-3" />{exp.passed_submissions} 通过</span>
              </div>
            </div>
          );
        })}
      </div>

      {filteredStats.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart3 className="size-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">该分类暂无实验数据</p>
        </div>
      )}

      {/* Score Distribution Section */}
      {dashboard?.score_distribution && dashboard.score_distribution.some(d => d.count > 0) && (
        <div className="mt-8 rounded-2xl border border-border/50 bg-card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 rounded-lg bg-[#FF9F0A]/10 flex items-center justify-center">
              <Award className="size-4 text-[#FF9F0A]" />
            </div>
            <h2 className="text-lg font-bold">分数分布</h2>
          </div>
          <div className="grid grid-cols-5 md:grid-cols-10 gap-3">
            {dashboard.score_distribution.map((bucket, i) => {
              const maxCount = Math.max(...dashboard.score_distribution.map(d => d.count), 1);
              const height = Math.max(4, (bucket.count / maxCount) * 120);
              const colors = [
                "#FF453A", "#FF453A", "#FF9F0A", "#FF9F0A", "#FF9F0A",
                "#FFD60A", "#FFD60A", "#30D158", "#30D158", "#0A84FF"
              ];
              return (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <span className="text-[11px] font-bold text-muted-foreground">{bucket.count}</span>
                  <div className="w-full rounded-t-lg transition-all duration-500 hover:opacity-80"
                    style={{
                      height: `${height}px`,
                      backgroundColor: colors[i] || "#0A84FF",
                      minHeight: "4px",
                    }} />
                  <span className="text-[10px] text-muted-foreground">{bucket.range}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Daily Submissions Trend */}
      {dashboard?.daily_submissions && dashboard.daily_submissions.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border/50 bg-card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 rounded-lg bg-[#0A84FF]/10 flex items-center justify-center">
              <TrendingUp className="size-4 text-[#0A84FF]" />
            </div>
            <h2 className="text-lg font-bold">每日提交趋势</h2>
          </div>
          <div className="flex items-end gap-2 h-32">
            {dashboard.daily_submissions.map((day, i) => {
              const maxCount = Math.max(...dashboard.daily_submissions.map(d => d.count), 1);
              const height = Math.max(8, (day.count / maxCount) * 100);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group">
                  <span className="text-[10px] font-bold text-muted-foreground group-hover:text-foreground transition-colors">
                    {day.count}
                  </span>
                  <div className="w-full rounded-t-md bg-gradient-to-t from-[#0A84FF] to-[#BF5AF2] transition-all duration-300 group-hover:opacity-80"
                    style={{ height: `${height}%`, minHeight: "4px" }} />
                  <span className="text-[9px] text-muted-foreground">
                    {day.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // ── Student View ─────────────────────────────────────────

  const totalAvg = personalProgress.length > 0
    ? Math.round(personalProgress.reduce((s, p) => s + p.best_score, 0) / personalProgress.length)
    : 0;

  return (
    <div className="p-6 lg:p-8 animate-fade-in max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#0A84FF] via-[#BF5AF2] to-[#30D158] flex items-center justify-center shadow-lg shadow-primary/25">
            <Trophy className="size-6 text-white" />
          </div>
          <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#FFD60A] border-2 border-background animate-pulse" />
        </div>
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">我的学习进度</h1>
          <p className="text-sm text-muted-foreground">跟踪你的学习成果与实验完成情况</p>
        </div>
      </div>

      {personalProgress.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-4">
            <Sparkles className="size-8 opacity-30" />
          </div>
          <p className="text-lg font-medium mb-2">还没有提交记录</p>
          <p className="text-sm max-w-md text-center">
            前往「实验列表」选择感兴趣的实验，提交代码后将在此显示你的学习进度
          </p>
        </div>
      ) : (
        <>
          {/* Summary Card */}
          <div className="mb-8 p-6 rounded-2xl border border-border/50 bg-card hover:border-primary/20 transition-all duration-300 card-inner-glow">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Trophy className="size-4 text-[#FFD60A]" />
                  <span className="text-[13px] text-muted-foreground uppercase tracking-wide font-semibold">综合平均分</span>
                </div>
                <p className="text-[42px] font-bold tracking-tight" style={{ color: sc(totalAvg) }}>
                  <AnimatedNumber value={totalAvg} suffix="%" />
                </p>
              </div>
              <div className="flex items-center gap-6">
                {[
                  { icon: BookOpen, label: "实验", value: personalProgress.length },
                  { icon: FileCode, label: "提交", value: personalProgress.reduce((s, p) => s + p.total_submissions, 0) },
                  { icon: Target, label: "均分", value: totalAvg, suffix: "%" },
                  { icon: CheckCircle2, label: "完成率", value: Math.round(personalProgress.filter(p => p.best_score >= 60).length / personalProgress.length * 100), suffix: "%" },
                ].map((item, i) => (
                  <div key={i} className="text-center">
                    <item.icon className="size-4 text-muted-foreground mx-auto mb-1" />
                    <span className="text-xl font-bold block"><AnimatedNumber value={item.value} suffix={item.suffix || ""} /></span>
                    <p className="text-[10px] text-muted-foreground">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Experiment Progress Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 stagger-children">
            {personalProgress.map((p) => {
              const exp = experiments[p.experiment_id];
              const cat = exp?.category || "other";
              return (
                <div key={p.experiment_id}
                  className="group rounded-xl border border-border/50 bg-card p-6 hover:border-primary/20 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 card-inner-glow relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 kernel-scan" />
                  
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: (categoryColor[cat] || "#0A84FF") + "20", color: categoryColor[cat] || "#0A84FF" }}>
                          {categoryIcon[cat] || "📦"} {cat === "process" ? "进程" : cat === "thread" ? "线程" : cat === "memory" ? "内存" : cat === "scheduler" ? "调度" : cat === "fs" ? "文件系统" : cat}
                        </span>
                      </div>
                      <h3 className="text-[16px] font-semibold truncate">{exp?.title || p.experiment_id.slice(0, 8)}</h3>
                      <p className="text-xs text-muted-foreground mt-1">共提交 {p.total_submissions} 次</p>
                    </div>
                    <div className="text-right ml-4">
                      <div className="text-[30px] font-bold" style={{ color: sc(p.best_score) }}>{p.best_score}%</div>
                    </div>
                  </div>
                  
                  <div className="relative h-2.5 bg-muted rounded-full overflow-hidden mb-3">
                    <div className="absolute inset-0 rounded-full transition-all duration-700"
                      style={{
                        width: `${p.best_score}%`,
                        background: `linear-gradient(90deg, ${sc(p.best_score)}, ${sc(p.best_score)}88)`,
                      }} />
                    <div className="absolute inset-0 rounded-full shimmer" />
                  </div>

                  {p.last_submission_at && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      {new Date(p.last_submission_at).toLocaleString("zh-CN")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
