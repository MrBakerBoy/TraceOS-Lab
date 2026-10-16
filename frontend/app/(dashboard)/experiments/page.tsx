"use client";

import { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { BookOpen, Search, ArrowRight, Flame, Zap, Brain, Cpu, HardDrive, Timer, Lock, Sparkles, ChevronRight } from 'lucide-react';

interface Experiment { id: string; name: string; title: string; category: string; difficulty: string; description?: string; }

const CATEGORIES = [
  { value: '', label: '全部', icon: Sparkles, gradient: 'from-slate-400 to-slate-500' },
  { value: 'process', label: '进程管理', icon: Cpu, gradient: 'from-blue-500 to-cyan-400' },
  { value: 'thread', label: '线程并发', icon: Zap, gradient: 'from-purple-500 to-pink-400' },
  { value: 'memory', label: '内存管理', icon: Brain, gradient: 'from-teal-500 to-emerald-400' },
  { value: 'fs', label: '文件系统', icon: HardDrive, gradient: 'from-amber-500 to-orange-400' },
  { value: 'scheduler', label: '进程调度', icon: Timer, gradient: 'from-red-500 to-rose-400' },
  { value: 'deadlock', label: '死锁检测', icon: Lock, gradient: 'from-pink-500 to-fuchsia-400' },
];

const DIFFICULTY_MAP: Record<string, { label: string; icon: typeof Flame; color: string; bg: string }> = {
  easy: { label: '入门', icon: Flame, color: '#30D158', bg: 'rgba(48,209,88,0.1)' },
  medium: { label: '进阶', icon: Zap, color: '#FF9F0A', bg: 'rgba(255,159,10,0.1)' },
  hard: { label: '挑战', icon: Flame, color: '#FF453A', bg: 'rgba(255,69,58,0.1)' },
};

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadExperiments(); }, [category, difficulty]);

  const loadExperiments = async () => {
    setLoading(true);
    try {
      const res = await api.getExperiments({ category: category || undefined, difficulty: difficulty || undefined });
      setExperiments(res.data || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return experiments;
    const q = search.toLowerCase();
    return experiments.filter(e => (e.title || e.name).toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q));
  }, [experiments, search]);

  const stats = useMemo(() => ({
    total: experiments.length,
    easy: experiments.filter(e => e.difficulty === 'easy').length,
    medium: experiments.filter(e => e.difficulty === 'medium').length,
    hard: experiments.filter(e => e.difficulty === 'hard').length,
  }), [experiments]);

  const catInfo = (c: string) => CATEGORIES.find(x => x.value === c) || CATEGORIES[0];

  return (
    <div className="p-8 animate-fade-in relative">
      {/* Kernel Scan Line at top */}
      <div className="absolute top-0 left-0 right-0 h-[2px] kernel-scan opacity-50" />

      {/* Hero Section */}
      <div className="mb-10">
        <div className="flex items-start justify-between flex-wrap gap-6">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="relative">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0A84FF] via-[#BF5AF2] to-[#30D158] flex items-center justify-center shadow-xl shadow-[#0A84FF]/25">
                  <BookOpen className="size-5 text-white" strokeWidth={1.8} />
                </div>
                <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-br from-[#0A84FF] to-[#BF5AF2] opacity-20 blur-sm -z-10" />
              </div>
              <div>
                <h1 className="text-[30px] font-bold tracking-[-0.02em]">实验列表</h1>
                <p className="text-sm text-muted-foreground mt-0.5">选择一个操作系统实验，开始你的内核探索之旅</p>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="flex gap-3 mt-5 flex-wrap">
              {[
                { label: '全部实验', value: stats.total, color: '#0A84FF', icon: Sparkles },
                { label: '入门', value: stats.easy, color: '#30D158', icon: Flame },
                { label: '进阶', value: stats.medium, color: '#FF9F0A', icon: Zap },
                { label: '挑战', value: stats.hard, color: '#FF453A', icon: Flame },
              ].map(s => (
                <div key={s.label}
                  className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm hover:border-primary/20 hover:shadow-md transition-all duration-300 group cursor-default">
                  <s.icon className="size-3.5 group-hover:scale-110 transition-transform" style={{ color: s.color }} />
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                  <span className="text-[16px] font-bold tabular-nums">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-8">
        <div className="relative flex-1 min-w-[240px] max-w-[400px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="搜索实验名称、描述..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10 h-11 rounded-xl bg-muted/50 border-border/50 focus:bg-card transition-all"
          />
        </div>

        {/* Category Pills */}
        <div className="flex gap-1.5 flex-wrap">
          {CATEGORIES.map(cat => (
            <button key={cat.value} onClick={() => setCategory(cat.value)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl transition-all duration-200",
                category === cat.value
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25 scale-105'
                  : 'text-muted-foreground bg-card border border-border/50 hover:border-primary/30 hover:text-foreground hover:shadow-sm'
              )}
            >
              <cat.icon className="size-3.5" />
              {cat.label}
            </button>
          ))}
        </div>

        <select value={difficulty} onChange={e => setDifficulty(e.target.value)}
          className="px-3.5 py-2 text-xs font-medium rounded-xl border border-border/50 bg-card text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer transition-all h-9">
          <option value="">全部难度</option>
          <option value="easy">入门</option>
          <option value="medium">进阶</option>
          <option value="hard">挑战</option>
        </select>
      </div>

      {/* Results Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/50 bg-card p-6">
              <Skeleton className="h-5 w-24 mb-3 rounded-lg" />
              <Skeleton className="h-6 w-3/4 mb-2 rounded-lg" />
              <Skeleton className="h-4 w-full mb-1.5 rounded-lg" />
              <Skeleton className="h-4 w-2/3 mb-5 rounded-lg" />
              <div className="flex justify-between items-center pt-4 border-t border-border/50">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-4 w-14 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-muted to-card border border-border/50 flex items-center justify-center mb-5 shadow-inner">
            <BookOpen className="size-8 text-muted-foreground/50" />
          </div>
          <p className="text-muted-foreground text-[15px] font-medium">未找到匹配的实验</p>
          <p className="text-muted-foreground/60 text-[13px] mt-1.5">试试其他关键词或筛选条件</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 stagger-children">
          {filtered.map((exp) => {
            const cat = catInfo(exp.category);
            const diff = DIFFICULTY_MAP[exp.difficulty] || DIFFICULTY_MAP.easy;
            const DiffIcon = diff.icon;
            const CatIcon = cat.icon;
            return (
              <Link key={exp.id} href={`/experiments/${exp.id}`} prefetch={false} className="group block">
                <div className="relative h-full rounded-xl border border-border/50 bg-card p-6 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary/5 hover:border-primary/20 overflow-hidden card-inner-glow">
                  {/* Kernel scan on hover */}
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-primary via-purple-500 via-teal-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 kernel-scan" />

                  {/* Category badge */}
                  <div className="flex items-center gap-2 mb-4">
                    <div className={cn("w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center shadow-md group-hover:scale-110 transition-transform duration-300", cat.gradient)}>
                      <CatIcon className="size-4 text-white" />
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">{cat.label}</span>
                  </div>

                  {/* Title */}
                  <h3 className="text-[16px] font-semibold mb-2 group-hover:text-primary transition-colors duration-200 line-clamp-1">
                    {exp.title || exp.name}
                  </h3>

                  {/* Description */}
                  {exp.description ? (
                    <p className="text-[13px] text-muted-foreground line-clamp-2 leading-relaxed mb-4">{exp.description}</p>
                  ) : <div className="mb-4" />}

                  {/* Progress bar placeholder */}
                  <div className="w-full h-1 bg-muted rounded-full mb-4 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-transparent via-primary/30 to-transparent w-0 group-hover:w-full transition-all duration-1000" />
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-4 border-t border-border/50">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
                      style={{ backgroundColor: diff.bg, color: diff.color }}>
                      <DiffIcon className="size-3" />
                      {diff.label}
                    </span>
                    <span className="text-xs text-primary font-medium opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0 inline-flex items-center gap-1">
                      进入实验 <ChevronRight className="size-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
