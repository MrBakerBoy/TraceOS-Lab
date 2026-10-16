"use client";

import { useEffect, useState, useMemo } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Search, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Submission {
  id: string; experiment_id: string; student_id?: string; student_name?: string;
  student_username?: string; status: string; score?: number; total_score?: number;
  passed_test_cases: number; total_test_cases: number; execution_time?: number; created_at: string;
}

export default function SubmissionsPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [experiments, setExperiments] = useState<any>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => { loadSubmissions(); }, []);

  const loadSubmissions = async () => {
    try {
      const exps = await api.getExperiments({});
      const expMap: any = {};
      (exps.data || []).forEach((e: any) => { expMap[e.id] = e; });
      setExperiments(expMap);
      const subs = await api.getAllSubmissions({ page_size: 100 });
      setSubmissions(subs.data || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    let r = submissions;
    if (statusFilter) r = r.filter(s => s.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(s => {
        const en = (experiments[s.experiment_id]?.title || '').toLowerCase();
        const sn = (s.student_name || s.student_username || '').toLowerCase();
        return en.includes(q) || sn.includes(q) || s.id.toLowerCase().includes(q);
      });
    }
    return r;
  }, [submissions, statusFilter, search, experiments]);

  const isTeacher = getUser()?.role !== 'student';

  const statusConfig = (s: string) => {
    switch (s) {
      case 'completed': return { label: '已完成', variant: 'default' as const, icon: CheckCircle2, color: 'var(--success)' };
      case 'running': return { label: '运行中', variant: 'secondary' as const, icon: Loader2, color: 'var(--warning)' };
      case 'pending': return { label: '等待中', variant: 'secondary' as const, icon: Clock, color: 'var(--warning)' };
      case 'failed': return { label: '失败', variant: 'destructive' as const, icon: XCircle, color: 'var(--error)' };
      default: return { label: s, variant: 'outline' as const, icon: Clock, color: 'var(--muted-foreground)' };
    }
  };

  const pct = (sub: Submission) => Math.min(Math.round(((sub.score ?? 0) / (sub.total_score || 100)) * 100), 100);

  return (
    <div className="p-8 animate-fade-in">
      <div className="absolute top-0 left-0 right-0 h-[2px] kernel-scan opacity-40" />

      <div className="flex items-center gap-3 mb-6">
        <div className="relative">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0A84FF] via-[#BF5AF2] to-[#30D158] flex items-center justify-center shadow-lg shadow-primary/25">
            <FileText className="size-5 text-white" strokeWidth={1.8} />
          </div>
        </div>
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]">提交历史</h1>
          <p className="text-sm text-muted-foreground">查看所有代码提交与评测记录</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-[360px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="搜索实验或提交者..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-10 h-11 rounded-xl bg-muted/50 border-border/50 focus:bg-card transition-all" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3.5 py-2 text-[13px] rounded-xl border border-border/50 bg-card text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer transition-all h-11">
          <option value="">全部状态</option>
          <option value="completed">已完成</option>
          <option value="running">运行中</option>
          <option value="pending">等待中</option>
          <option value="failed">失败</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/50 bg-card p-5">
              <div className="flex justify-between"><div className="space-y-2 flex-1"><Skeleton className="h-5 w-48 rounded-lg" /><Skeleton className="h-3.5 w-32 rounded-lg" /></div><Skeleton className="h-6 w-16 rounded-full" /></div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">暂无提交记录</div>
      ) : (
        <div className="space-y-3 stagger-children">
          {filtered.map((sub) => {
            const st = statusConfig(sub.status);
            const Icon = st.icon;
            const percent = pct(sub);
            return (
              <div key={sub.id} className="group rounded-xl border border-border/50 bg-card p-5 transition-all duration-300 hover:border-primary/20 hover:shadow-lg hover:-translate-y-0.5 card-inner-glow">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="text-[15px] font-semibold truncate">{experiments[sub.experiment_id]?.title || sub.experiment_id.slice(0, 8)}</h3>
                      <Badge variant={st.variant} className="text-[11px] gap-1">
                        <Icon className={cn("size-3", sub.status === 'running' && "animate-spin")} />{st.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                      {isTeacher && (sub.student_name || sub.student_username) && <span>{sub.student_name || sub.student_username}</span>}
                      <span>{new Date(sub.created_at).toLocaleString('zh-CN')}</span>
                      <span className="font-mono text-[11px]">#{sub.id.slice(0, 8)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-bold" style={{ color: percent >= 80 ? 'var(--success)' : percent >= 50 ? 'var(--warning)' : 'var(--error)' }}>
                      {sub.score ?? '-'}/{sub.total_score || 100}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{sub.passed_test_cases}/{sub.total_test_cases} 通过{sub.execution_time != null && ` · ${sub.execution_time}ms`}</div>
                  </div>
                </div>
                <div className="w-full h-1.5 bg-muted rounded-full mt-3 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{
                    width: `${percent}%`,
                    background: percent >= 80 ? 'linear-gradient(90deg, #0A84FF, #BF5AF2)' : percent >= 50 ? 'linear-gradient(90deg, #FF9F0A, #0A84FF)' : 'linear-gradient(90deg, #FF453A, #FF9F0A)'
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
