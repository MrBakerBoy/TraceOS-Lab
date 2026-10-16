'use client';

import { useState, useEffect, useRef } from 'react';
import { useWorkspaceStore } from '@/stores/workspace';
import { api } from '@/lib/api';
import {
  Flame,
  Eye,
  Cpu,
  Bot,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  Zap,
  BookOpen,
  RefreshCw,
  ChevronDown,
  Sparkles,
  BarChart3,
  Layers,
} from 'lucide-react';
import { PanelHeader } from '@/components/ui/panel-header';
import ViewHelpButton from "@/components/ui/ViewHelpButton";
import { FLAMEGRAPH_HELP } from "@/lib/view-help-content";
import { SkeletonCard } from '@/components/ui/skeleton-card';
import { EmptyState } from '@/components/ui/empty-state';

interface FlameGraphData {
  submission_id: string;
  user_svg?: string;
  kernel_svg?: string;
  has_user: boolean;
  has_kernel: boolean;
  elapsed_sec: number;
  summary?: string;
  status?: string;
  hint?: string;
  hot_functions?: Array<{ name: string; percent: number; module: string }>;
  user_percent?: number;
  kernel_percent?: number;
}

interface AIAnalysis {
  plain_summary: string;
  top_hotspots: Array<{ function: string; what_it_means: string; optimization_tip: string }>;
  issues: Array<{ severity: string; title: string; explanation: string; suggestion: string }>;
  kernel_insight: string;
  raw_error?: string;
}

interface SubmissionInfo {
  id: string;
  submission_number: number;
  status: string;
  score?: number;
  student_name?: string;
}

interface Props {
  submissionId: string;
  experimentId: string;
  studentName?: string;
  submissions?: SubmissionInfo[];
  highlightFunction?: string;
}

export default function FlameGraphPanel({ submissionId, experimentId, studentName, submissions = [], highlightFunction }: Props) {
  const [data, setData] = useState<FlameGraphData | null>(null);
  const [selectedId, setSelectedId] = useState(submissionId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState<'user' | 'kernel' | 'summary'>('user');
  const [duration, setDuration] = useState(10);
  const svgContainerRef = useRef<HTMLDivElement>(null);

  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const [prevSubmissionId, setPrevSubmissionId] = useState(submissionId);
  if (submissionId !== prevSubmissionId) {
    setPrevSubmissionId(submissionId);
    setSelectedId(submissionId);
  }

  // ── Memory feature: check cache on mount ──
  const experimentCache = useWorkspaceStore((s) => s.experimentCache);
  const [cacheChecked, setCacheChecked] = useState(false);

  useEffect(() => {
    if (cacheChecked) return;
    // Try loading from experimentCache (batch-loaded on experiment entry)
    const fgCache = experimentCache?.flamegraph;
    if (fgCache?.data && fgCache.submission_id === submissionId) {
      try {
        const cached = fgCache.data;
        if (cached.has_user || cached.has_kernel) {
          setData(cached);
          if (cached.has_user) setActiveView('user');
          else if (cached.has_kernel) setActiveView('kernel');
          else setActiveView('summary');
          setCacheChecked(true);
          return;
        }
      } catch {}
    }
    // Fallback: try GET flamegraph endpoint (backend cache)
    api.getFlameGraph(submissionId).then((res) => {
      if (res.user_svg || res.kernel_svg) {
        setData(res);
        if (res.has_user) setActiveView('user');
        else if (res.has_kernel) setActiveView('kernel');
        else setActiveView('summary');
      }
    }).catch(() => {});
    setCacheChecked(true);
  }, [experimentCache, submissionId, cacheChecked]);

  const handleSubmissionChange = (newId: string) => {
    setSelectedId(newId);
    setData(null);
    setAiAnalysis(null);
    setAiError('');
    setError('');
  };

  const triggerAIAnalysis = async (fgData: FlameGraphData, code?: string) => {
    if (!fgData.hot_functions || fgData.hot_functions.length === 0) {
      setAiAnalysis({
        plain_summary: '采样数据不足，无法进行 AI 智能分析。请重新提交代码以触发生成包含热点数据的火焰图。如问题持续，可尝试增加采样时长。',
        top_hotspots: [],
        issues: [],
        kernel_insight: '',
      });
      return;
    }

    setAiLoading(true);
    setAiError('');
    try {
      const result = await api.analyzeFlameGraph({
        submission_id: fgData.submission_id,
        code: code || '',
        language: 'c',
        hot_functions: fgData.hot_functions,
        user_percent: fgData.user_percent ?? 0,
        kernel_percent: fgData.kernel_percent ?? 0,
        elapsed_sec: fgData.elapsed_sec,
      });
      setAiAnalysis(result);
    } catch (err: any) {
      setAiError(err.message || 'AI 分析失败');
    } finally {
      setAiLoading(false);
    }
  };

  const generateFlameGraph = async () => {
    setLoading(true);
    setError('');
    setAiAnalysis(null);
    setAiError('');
    try {
      const result = await api.generateFlameGraph(selectedId, duration);
      setData(result);
      if (result.has_user) setActiveView('user');
      else if (result.has_kernel) setActiveView('kernel');
      else setActiveView('summary');
      triggerAIAnalysis(result);
      // Save to backend cache for memory feature
      api.saveExperimentCache(experimentId, {
        cache_type: 'flamegraph',
        submission_id: selectedId,
        data: result,
      }).catch(() => {});
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('service_unavailable') || msg.includes('flame_graph') || msg.includes('8765') || msg.includes('Failed to fetch')) {
        setError('火焰图服务未就绪。请在服务器上启动火焰图服务: python3 ebpf/scripts/flamegraph_server.py --port 8765');
      } else {
        setError(msg || '生成火焰图失败');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const container = svgContainerRef.current;
    if (!container || !data) return;
    const svgContent = activeView === 'user' ? data.user_svg : data.kernel_svg;
    if (!svgContent) return;
    container.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.background = 'white';
    iframe.srcdoc = svgContent;
    container.appendChild(iframe);
  }, [data, activeView]);

  // ── Highlight function in flamegraph when navigating from evidence link ──
  useEffect(() => {
    if (!highlightFunction) return;
    const container = svgContainerRef.current;
    if (!container) return;
    const iframe = container.querySelector('iframe');
    if (!iframe || !iframe.contentDocument) return;

    // Wait for iframe to fully render
    const timer = setTimeout(() => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        // Flamegraph SVGs use <title> elements for function names
        const titles = doc.querySelectorAll('title');
        for (const title of titles) {
          if (title.textContent && title.textContent.includes(highlightFunction)) {
            // Find the parent <g> element (the function block)
            let el: Element | null = title.parentElement;
            while (el && el.tagName !== 'g') el = el.parentElement;
            if (el) {
              // Scroll to the element
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Add highlight
              el.setAttribute('data-highlighted', 'true');
              const origFill = (el as SVGElement).getAttribute('fill');
              (el as SVGElement).setAttribute('fill', '#FF375F');
              (el as SVGElement).style.transition = 'fill 0.5s ease';
              setTimeout(() => {
                if (origFill) (el as SVGElement).setAttribute('fill', origFill);
                el?.setAttribute('data-highlighted', 'false');
              }, 3000);
              break;
            }
          }
        }
      } catch {
        // Cross-origin or other error — silently ignore
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [highlightFunction]);

  const severityConfig: Record<string, { bg: string; text: string; border: string; label: string; icon: typeof AlertTriangle }> = {
    high:   { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: '严重', icon: AlertTriangle },
    medium: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: '注意', icon: AlertTriangle },
    low:    { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: '建议', icon: TrendingUp },
    info:   { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', label: '提示', icon: BookOpen },
  };

  // ── Loading State ──
  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader icon={Flame} title="性能火焰图分析" subtitle="perf 采样 · CPU 热点可视化" />
        <div className="flex-1 p-6">
          <SkeletonCard variant="chart" />
          <SkeletonCard variant="kpi-card" className="mt-4" />
        </div>
      </div>
    );
  }

  // ── Error State ──
  if (error) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader icon={Flame} title="性能火焰图分析" subtitle="perf 采样 · CPU 热点可视化" />
        <div className="flex-1 flex items-center justify-center p-6">
          <EmptyState
            variant="error"
            title="生成失败"
            description={error}
            action={{ label: "重试", onClick: generateFlameGraph }}
          />
        </div>
      </div>
    );
  }

  // ── Empty State ──
  if (!data) {
    return (
      <div className="flex flex-col h-full">
        {/* Header always visible */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-[var(--bg-card)]">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-orange-100 to-red-100">
              <Flame className="size-5 text-orange-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">性能火焰图分析</h2>
              <p className="text-[11px] text-[var(--text-tertiary)]">perf 采样 · CPU 热点可视化</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {submissions.length > 0 && (
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] text-[var(--text-tertiary)]">提交记录</label>
                <select
                  value={selectedId}
                  onChange={(e) => handleSubmissionChange(e.target.value)}
                  className="text-[11px] border border-[var(--border-default)] rounded-md px-2 py-1.5 bg-[var(--bg-card)] text-[var(--text-primary)] max-w-[260px]"
                >
                  {submissions.map((sub: any) => (
                    <option key={sub.id} value={sub.id}>
                      #{sub.submission_number}
                      {sub.student_name ? ' · ' + sub.student_name : ''}
                      {sub.status ? ' · ' + sub.status : ''}
                      {sub.score != null ? ' (' + sub.score + '分)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-[var(--text-tertiary)]">采样时长</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="text-[11px] border border-[var(--border-default)] rounded-md px-2 py-1.5 bg-[var(--bg-card)]"
              >
                <option value={5}>5 秒</option>
                <option value={10}>10 秒</option>
                <option value={15}>15 秒</option>
                <option value={20}>20 秒</option>
                <option value={30}>30 秒</option>
              </select>
            </div>
            <button
              onClick={generateFlameGraph}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--accent)] text-white text-xs font-medium rounded-lg hover:bg-[var(--accent-hover)] transition-colors"
            >
              <Zap className="size-3.5" />
              生成火焰图
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="size-20 rounded-2xl bg-orange-50 flex items-center justify-center mb-5">
            <Flame className="size-10 text-orange-300" />
          </div>
          <p className="text-sm font-medium text-[var(--text-secondary)] mb-1.5">尚未生成火焰图</p>
          <p className="text-xs text-[var(--text-tertiary)] text-center max-w-sm leading-relaxed">
            点击「生成火焰图」按钮，系统将自动编译学生代码并进行 perf 性能采样，
            生成交互式火焰图与 AI 智能解读。
          </p>
          <div className="mt-6 grid grid-cols-4 gap-3 text-center max-w-md">
            {[
              { icon: Zap, label: '自动编译' },
              { icon: BarChart3, label: '性能采样' },
              { icon: Bot, label: 'AI 解读' },
              { icon: TrendingUp, label: '智能分析' },
            ].map((item, i) => (
              <div key={i} className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-lg p-3">
                <item.icon className="size-5 mx-auto mb-1 text-[var(--text-tertiary)]" />
                <div className="text-[10px] text-[var(--text-tertiary)]">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        icon={Flame}
        title="性能火焰图分析"
        subtitle="perf 采样 · CPU 热点可视化"
        actions={
          <div className="flex items-center gap-3">
            <ViewHelpButton content={FLAMEGRAPH_HELP} />
          {submissions.length > 0 && (
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-[var(--text-tertiary)]">提交记录</label>
              <select
                value={selectedId}
                onChange={(e) => handleSubmissionChange(e.target.value)}
                className="text-[11px] border border-[var(--border-default)] rounded-md px-2 py-1.5 bg-[var(--bg-card)] text-[var(--text-primary)] max-w-[260px]"
              >
                {submissions.map((sub: any) => (
                  <option key={sub.id} value={sub.id}>
                    #{sub.submission_number}
                    {sub.student_name ? ' · ' + sub.student_name : ''}
                    {sub.status ? ' · ' + sub.status : ''}
                    {sub.score != null ? ' (' + sub.score + '分)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <label className="text-[11px] text-[var(--text-tertiary)]">采样时长</label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="text-[11px] border border-[var(--border-default)] rounded-md px-2 py-1.5 bg-[var(--bg-card)]"
            >
              <option value={5}>5 秒</option>
              <option value={10}>10 秒</option>
              <option value={15}>15 秒</option>
              <option value={20}>20 秒</option>
              <option value={30}>30 秒</option>
            </select>
          </div>
          <button
            onClick={generateFlameGraph}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--accent)] text-white text-xs font-medium rounded-lg hover:bg-[var(--accent-hover)] transition-colors"
          >
            <RefreshCw className="size-3.5" />
            重新生成
          </button>
          </div>
        }
      />

      {/* ── View Tabs ── */}
      <div className="flex border-b bg-[var(--bg-card)] px-6 gap-0">
        {data.has_user && (
          <button
            onClick={() => setActiveView('user')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeView === 'user'
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Eye className="size-3.5" />
            用户态
          </button>
        )}
        {data.has_kernel && (
          <button
            onClick={() => setActiveView('kernel')}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeView === 'kernel'
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Cpu className="size-3.5" />
            内核态
          </button>
        )}
        <button
          onClick={() => setActiveView('summary')}
          className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            activeView === 'summary'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
          }`}
        >
          <Bot className="size-3.5" />
          AI 智能解读
          {aiLoading && (
            <span className="ml-1.5 size-1.5 rounded-full bg-[var(--accent)] animate-pulse inline-block" />
          )}
          {aiAnalysis && !aiLoading && (
            <span className="ml-1.5 size-1.5 rounded-full bg-emerald-400 inline-block" />
          )}
        </button>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden">
        {(activeView === 'user' || activeView === 'kernel') && (
          <div ref={svgContainerRef} className="w-full h-full min-h-[400px]" />
        )}

        {activeView === 'summary' && (
          <div className="p-6 overflow-y-auto h-full space-y-5">
            {/* AI Loading */}
            {aiLoading && (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="relative mb-4">
                  <div className="animate-spin rounded-full h-10 w-10 border-2 border-[var(--accent)]/20 border-t-[var(--accent)]" />
                  <Bot className="absolute inset-0 m-auto size-4 text-[var(--accent)]/60" />
                </div>
                <p className="text-sm text-[var(--text-secondary)] font-medium">AI 正在分析火焰图数据</p>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">识别性能热点，生成白话解读...</p>
              </div>
            )}

            {/* AI Error */}
            {aiError && !aiAnalysis && (
              <div className="border border-red-200 rounded-xl p-4 bg-red-50/50">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="size-4 text-red-500" />
                  <span className="text-xs font-medium text-red-700">AI 分析遇到问题</span>
                </div>
                <p className="text-xs text-red-600">{aiError}</p>
              </div>
            )}

            {/* AI Results */}
            {aiAnalysis && !aiLoading && (
              <>
                {/* Plain Summary Banner */}
                <div className="relative overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 p-5">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-emerald-200/30 to-transparent rounded-bl-full" />
                  <div className="relative flex items-start gap-3">
                    <div className="size-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                      <Bot className="size-5 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-emerald-800 text-xs mb-1.5">AI 白话解读</h3>
                      <p className="text-sm text-emerald-800/80 leading-relaxed">
                        {aiAnalysis.plain_summary}
                      </p>
                    </div>
                  </div>
                  {aiAnalysis.raw_error && (
                    <p className="relative text-[10px] text-emerald-500/70 mt-2 ml-12">部分分析结果由本地规则生成</p>
                  )}
                </div>

                {/* Top Hotspots */}
                {aiAnalysis.top_hotspots.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <Flame className="size-4 text-orange-500" />
                      <h3 className="text-xs font-semibold text-[var(--text-primary)]">热点函数解读</h3>
                    </div>
                    <div className="space-y-2">
                      {aiAnalysis.top_hotspots.map((hs, i) => (
                        <div key={i} className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-lg p-3.5 hover:border-[var(--border-strong)] hover:scale-[1.015] transition-all duration-200">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[10px] font-mono text-[var(--text-tertiary)] bg-[var(--bg-card-hover)] px-1.5 py-0.5 rounded">
                              #{i + 1}
                            </span>
                            <code className="text-xs font-mono font-semibold text-[var(--accent)] bg-[var(--accent-light)] px-1.5 py-0.5 rounded">
                              {hs.function}
                            </code>
                          </div>
                          <p className="text-xs text-[var(--text-secondary)] leading-relaxed ml-7">
                            {hs.what_it_means}
                          </p>
                          {hs.optimization_tip && (
                            <div className="flex items-start gap-1.5 mt-2 ml-7">
                              <TrendingUp className="size-3 text-green-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-green-600">{hs.optimization_tip}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Kernel Insight */}
                {aiAnalysis.kernel_insight && (
                  <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Cpu className="size-4 text-purple-500" />
                      <h3 className="text-xs font-semibold text-purple-800">内核态分析</h3>
                    </div>
                    <p className="text-xs text-purple-700/80 leading-relaxed">
                      {aiAnalysis.kernel_insight}
                    </p>
                  </div>
                )}

                {/* Issues */}
                {aiAnalysis.issues.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="size-4 text-amber-500" />
                      <h3 className="text-xs font-semibold text-[var(--text-primary)]">发现的问题</h3>
                    </div>
                    <div className="space-y-2">
                      {aiAnalysis.issues.map((issue, i) => {
                        const cfg = severityConfig[issue.severity] || severityConfig.info;
                        const Icon = cfg.icon;
                        return (
                          <div key={i} className={`border rounded-lg p-3.5 ${cfg.bg} ${cfg.border}`}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cfg.text} ${cfg.border}`}>
                                {cfg.label}
                              </span>
                              <span className="text-xs font-semibold text-[var(--text-primary)]">{issue.title}</span>
                            </div>
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{issue.explanation}</p>
                            {issue.suggestion && (
                              <div className="flex items-start gap-1.5 mt-2">
                                <TrendingUp className="size-3 text-green-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-green-600">{issue.suggestion}</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Fallback static summary */}
                {!aiAnalysis.plain_summary && data.summary && (
                  <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="size-4 text-[var(--text-tertiary)]" />
                      <h3 className="text-xs font-semibold text-[var(--text-primary)]">基础分析结果</h3>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                      {data.summary}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Quick Stats */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-lg p-3.5 text-center">
                <div className="text-xl font-bold text-[var(--accent)] tabular-nums">{data.elapsed_sec?.toFixed(1) || '-'}s</div>
                <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5 flex items-center justify-center gap-1">
                  <Clock className="size-3" /> 采样时长
                </div>
              </div>
              <div className={`rounded-lg p-3.5 text-center border ${data.has_user ? 'bg-blue-50 border-blue-200' : 'bg-[var(--bg-card)] border-[var(--border-default)]'}`}>
                <div className="text-xl font-bold text-blue-600">{data.has_user ? '✓' : '—'}</div>
                <div className="text-[10px] text-blue-500/80 mt-0.5 flex items-center justify-center gap-1">
                  <Eye className="size-3" /> 用户态
                </div>
              </div>
              <div className={`rounded-lg p-3.5 text-center border ${data.has_kernel ? 'bg-purple-50 border-purple-200' : 'bg-[var(--bg-card)] border-[var(--border-default)]'}`}>
                <div className="text-xl font-bold text-purple-600">{data.has_kernel ? '✓' : '—'}</div>
                <div className="text-[10px] text-purple-500/80 mt-0.5 flex items-center justify-center gap-1">
                  <Cpu className="size-3" /> 内核态
                </div>
              </div>
              <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-lg p-3.5 text-center">
                <div className="text-xl font-bold text-[var(--text-primary)] tabular-nums">
                  {data.hot_functions?.length || 0}
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5 flex items-center justify-center gap-1">
                  <Layers className="size-3" /> 热点函数
                </div>
              </div>
            </div>

            {/* CPU Distribution Bar */}
            {data.user_percent != null && data.kernel_percent != null && (
              <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-lg p-4">
                <h3 className="text-[11px] font-semibold text-[var(--text-primary)] mb-3">CPU 时间分布</h3>
                <div className="flex h-6 rounded-full overflow-hidden bg-[var(--bg-card-hover)]">
                  <div
                    className="bg-blue-500 flex items-center justify-center text-[10px] text-white font-semibold transition-all duration-500"
                    style={{ width: `${data.user_percent}%`, minWidth: data.user_percent > 8 ? '40px' : '0' }}
                  >
                    {data.user_percent > 8 ? `用户 ${data.user_percent}%` : ''}
                  </div>
                  <div
                    className="bg-purple-500 flex items-center justify-center text-[10px] text-white font-semibold transition-all duration-500"
                    style={{ width: `${data.kernel_percent}%`, minWidth: data.kernel_percent > 8 ? '40px' : '0' }}
                  >
                    {data.kernel_percent > 8 ? `内核 ${data.kernel_percent}%` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-2 text-[10px] text-[var(--text-tertiary)]">
                  <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-blue-500" /> 用户态 {data.user_percent}%</span>
                  <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-purple-500" /> 内核态 {data.kernel_percent}%</span>
                </div>
              </div>
            )}

            {/* Top Functions Quick View */}
            {data.hot_functions && data.hot_functions.length > 0 && (
              <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-lg p-4">
                <h3 className="text-[11px] font-semibold text-[var(--text-primary)] mb-3">CPU 热点函数 Top 5</h3>
                <div className="space-y-2">
                  {data.hot_functions.slice(0, 5).map((hf, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <span className="text-[10px] font-mono text-[var(--text-tertiary)] w-4 text-right">{i + 1}</span>
                      <code className="text-[11px] text-[var(--text-secondary)] flex-1 truncate font-mono">{hf.name}</code>
                      <div className="w-24 bg-[var(--bg-card-hover)] rounded-full h-2.5 overflow-hidden">
                        <div
                          className="h-full bg-[var(--accent)] rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(hf.percent, 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-[var(--text-tertiary)] w-10 text-right tabular-nums">{hf.percent}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reading Guide */}
            <details className="bg-amber-50/50 border border-amber-200 rounded-lg p-4 group">
              <summary className="flex items-center gap-2 text-xs font-semibold text-amber-800 cursor-pointer">
                <BookOpen className="size-3.5" />
                火焰图阅读指南
                <ChevronDown className="size-3 ml-auto transition-transform group-open:rotate-180" />
              </summary>
              <ul className="text-[11px] text-amber-700 space-y-1.5 mt-3 ml-5">
                <li>宽度越大的色块，表示这个函数消耗了越多的 CPU 时间</li>
                <li>从上到下代表函数调用链：顶部是最终执行的函数，底部是调用者</li>
                <li>不同颜色区分不同函数，点击任意色块可以放大查看子调用</li>
                <li>红色/橙色区域是需要关注的可能有性能问题的热点</li>
              </ul>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
