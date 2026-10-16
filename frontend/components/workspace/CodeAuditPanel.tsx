'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useWorkspaceStore } from '@/stores/workspace';
import {
  AlertTriangle, AlertCircle, Info, Sparkles, ChevronRight,
  BarChart3, Loader2, CheckCircle2, XCircle, Lightbulb,
  Brain, Bug, ShieldCheck, Activity, ScanLine, Search,
  RefreshCw, Zap, BookOpen, TrendingUp, Bot, ChevronDown,
} from 'lucide-react';
import { api, CodeAuditResult, CodeIssue } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface SubmissionInfo {
  id: string;
  submission_number: number;
  status: string;
  score?: number;
  code?: string;
  student_name?: string;
}

// The code_audit experiment cache may have been written by the Go backend in
// an older flat shape ({ issues, summary, ai_pending }) instead of the nested
// CodeAuditResult shape ({ audit: { issues, summary, annotations }, ... }).
// Normalize both so the panel never renders an empty overview / issue list
// after hydrating from cache.
function normalizeAuditResult(raw: unknown): CodeAuditResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;

  // Already the nested shape returned by POST /api/v1/code-audit.
  if (r.audit && typeof r.audit === "object") {
    return raw as CodeAuditResult;
  }

  // Flat shape written by the Go backend's experiment cache.
  if (Array.isArray(r.issues) || r.summary) {
    return {
      audit: {
        issues: Array.isArray(r.issues) ? r.issues : [],
        summary: r.summary ?? {
          total_issues: 0,
          critical_count: 0,
          warning_count: 0,
          info_count: 0,
          categories: {},
          overall_quality: "excellent",
        },
        annotations: Array.isArray(r.annotations) ? r.annotations : [],
      },
      code_length: typeof r.code_length === "number" ? r.code_length : 0,
      analyzer: r.analyzer ?? "pattern-detector",
      ai_pending: Boolean(r.ai_pending),
      status: r.status,
      ai_result: r.ai_result,
    };
  }

  return raw as CodeAuditResult;
}

interface CodeAuditPanelProps {
  code: string;
  language: string;
  experimentId: string;
  submissionId: string;
  submissions?: SubmissionInfo[];
  selectedSubId?: string | null;
  onSubmissionSelect?: (id: string) => void;
  onIssueClick?: (line: number) => void;
  className?: string;
}

export default function CodeAuditPanel({
  code, language, experimentId, submissionId,
  submissions = [], selectedSubId, onSubmissionSelect,
  onIssueClick, className,
}: CodeAuditPanelProps) {
  // ── effectiveCode: prefer selected submission code, fall back to editor code ──
  const effectiveCode = useMemo(() => {
    if (selectedSubId && submissions.length > 0) {
      const sub = submissions.find(s => s.id === selectedSubId);
      if (sub?.code) return sub.code;
    }
    return code;
  }, [code, selectedSubId, submissions]);

  // ── Memory feature: check cache on mount ──
  const experimentCache = useWorkspaceStore((s) => s.experimentCache);
  const [cacheChecked, setCacheChecked] = useState(false);
  const manuallyAuditedRef = useRef(false);

  useEffect(() => {
    // Don't overwrite a freshly run manual audit with stale cache.
    if (cacheChecked || manuallyAuditedRef.current) return;
    const auditCache = experimentCache?.code_audit;
    // Cache hasn't been fetched yet; keep waiting for the next update.
    if (!auditCache?.data) return;
    if (auditCache.submission_id === submissionId) {
      try {
        const normalized = normalizeAuditResult(auditCache.data);
        if (normalized) setAuditResult(normalized);
      } catch {}
    }
    setCacheChecked(true);
  }, [experimentCache, submissionId, cacheChecked]);

  const [auditResult, setAuditResult] = useState<CodeAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'issues' | 'summary' | 'ai'>('issues');
  const [aiPolling, setAiPolling] = useState(false);
  const [aiError, setAiError] = useState('');
  const [hintLevel, setHintLevel] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const auditResultRef = useRef<CodeAuditResult | null>(null);
  auditResultRef.current = auditResult;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setAiPolling(false);
  }, []);

  useEffect(() => {
    if (!auditResult || !auditResult.ai_pending || !submissionId) {
      stopPolling();
      return;
    }

    let attempts = 0;
    const maxAttempts = 40;

    setAiPolling(true);
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const result = await api.getCodeAudit(submissionId);
        if (!result.ai_pending && result.ai_result) {
          setAuditResult(result);
          setAiPolling(false);
          setActiveTab('ai');
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        } else if (result.status === 'failed') {
          setAuditResult(result);
          setAiPolling(false);
          setAiError('AI深度分析失败，已显示规则分析结果');
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        } else if (attempts >= maxAttempts) {
          setAiPolling(false);
          setAiError('AI深度分析超时，已显示规则分析结果');
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      } catch {
        if (attempts >= maxAttempts) {
          stopPolling();
          setAiError('AI深度分析轮询失败');
        }
      }
    }, 3000);

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [auditResult?.ai_pending, submissionId, stopPolling]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // Reset result when effectiveCode changes (new submission selected / code edited).
  // Guard with the latest auditResult via ref so this does not clear a result
  // that was just hydrated from cache on mount (where effectiveCode is stable).
  useEffect(() => {
    if (!auditResultRef.current) return;
    setAuditResult(null);
    setError('');
    setAiError('');
    setHintLevel(0);
    setActiveTab('issues');
  }, [effectiveCode]);

  const runAudit = async () => {
    try {
      setLoading(true);
      setError('');
      setAiError('');
      setHintLevel(0);
      console.log('[CodeAudit] Sending code for audit:', { codeLength: effectiveCode.length, codePreview: effectiveCode.slice(0, 200), language, experimentId, submissionId });
      const result = await api.auditCode({
        code: effectiveCode, language, experiment_id: experimentId, submission_id: submissionId,
      });
      setAuditResult(result);
      manuallyAuditedRef.current = true;
      if (result.ai_pending) setAiPolling(true);
      api.saveExperimentCache(experimentId, {
        cache_type: "code_audit",
        submission_id: submissionId,
        data: result,
      }).catch(() => {});
    } catch (e: any) {
      setError(e.message || 'Audit failed');
    } finally {
      setLoading(false);
    }
  };

  const severityVariant = (s: string): "error" | "warning" | "info" => {
    if (s === 'error' || s === 'high') return 'error';
    if (s === 'warning' || s === 'medium') return 'warning';
    return 'info';
  };

  const severityConfig: Record<string, { icon: typeof AlertTriangle; bg: string; border: string; text: string; label: string }> = {
    high:    { icon: AlertTriangle, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', label: '严重' },
    medium:  { icon: AlertTriangle, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', label: '警告' },
    low:     { icon: TrendingUp, bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', label: '提示' },
    info:    { icon: BookOpen, bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', label: '信息' },
  };

  const overallQualityLabel = (q: string) => {
    const map: Record<string, string> = {
      excellent: '优秀',
      good: '良好',
      fair: '一般',
      poor: '较差',
    };
    return map[q] || '未知';
  };

  const qualityDescription = (q: string) => {
    const map: Record<string, string> = {
      excellent: '代码结构清晰，规则扫描未发现明显问题，建议结合 AI 深度分析进一步确认',
      good: '整体质量良好，存在少量可优化点，建议逐条查看提示',
      fair: '存在若干需要修复的问题，建议优先处理严重项',
      poor: '存在较多严重问题，建议优先修复高优先级问题后重新审计',
    };
    return map[q] || '已完成代码分析，详见下方统计';
  };

  const qualityConfig: Record<string, { color: string; bg: string }> = {
    excellent: { color: '#30D158', bg: 'rgba(48,209,88,0.08)' },
    good:      { color: '#0A84FF', bg: 'rgba(10,132,255,0.08)' },
    fair:      { color: '#FF9F0A', bg: 'rgba(255,159,10,0.08)' },
    poor:      { color: '#FF375F', bg: 'rgba(255,69,58,0.08)' },
  };

  // ── Render issue card ──
  const renderIssue = (issue: CodeIssue, index: number, isAI: boolean) => {
    const cfg = severityConfig[issue.severity] || severityConfig.info;
    const Icon = cfg.icon;
    return (
      <div
        key={index}
        onClick={() => onIssueClick?.(issue.line)}
        className={`rounded-xl border p-3.5 mb-2 last:mb-0 cursor-pointer transition-all duration-200 hover:shadow-sm bg-[var(--bg-card)] ${cfg.border} hover:border-[var(--border-strong)]`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cfg.text} ${cfg.border}`}>
            {cfg.label}
          </span>
          <span className="text-[10px] font-mono text-[var(--text-tertiary)] bg-[var(--bg-card-hover)] px-1.5 py-0.5 rounded">L{issue.line}</span>
          <span className="text-[12px] font-semibold text-[var(--text-primary)]">{issue.title}</span>
          {isAI && <Badge variant="info" size="sm" className="ml-auto">AI</Badge>}
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-1 ml-7">{issue.description}</p>
        {issue.suggestion && (
          <div className="flex items-start gap-1.5 mt-2 ml-7">
            <TrendingUp className="size-3 text-green-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-green-600">{issue.suggestion}</p>
          </div>
        )}
        {issue.tags && issue.tags.length > 0 && (
          <div className="flex gap-1 mt-2 ml-7">
            {issue.tags.map((tag, j) => (
              <span key={j} className="px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-card-hover)] rounded">{tag}</span>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Loading State ──
  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <Header
          submissions={submissions} selectedSubId={selectedSubId} onSubmissionSelect={onSubmissionSelect}
          onRunAudit={runAudit} loading={loading}
        />
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="relative mb-4">
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-[var(--accent)]/20 border-t-[var(--accent)]" />
            <ScanLine className="absolute inset-0 m-auto size-5 text-[var(--accent)]/60" />
          </div>
          <p className="text-[var(--text-secondary)] text-sm font-medium">正在分析代码...</p>
          <p className="text-[var(--text-tertiary)] text-xs mt-1">规则扫描 + AI 深度分析进行中</p>
        </div>
      </div>
    );
  }

  // ── Error State ──
  if (error && !auditResult) {
    return (
      <div className="flex flex-col h-full">
        <Header
          submissions={submissions} selectedSubId={selectedSubId} onSubmissionSelect={onSubmissionSelect}
          onRunAudit={runAudit} loading={loading}
        />
        <div className="flex-1 p-6">
          <div className="border border-red-200 rounded-xl p-5 bg-red-50/50">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="size-8 rounded-lg bg-red-100 flex items-center justify-center">
                <XCircle className="size-4 text-red-500" />
              </div>
              <span className="font-semibold text-red-800 text-sm">审计失败</span>
            </div>
            <p className="text-red-700 text-xs leading-relaxed">{error}</p>
            <button
              onClick={runAudit}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 transition-colors"
            >
              <RefreshCw className="size-3" />
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className || ''}`}>
      {/* ── Header ── */}
      <Header
        submissions={submissions} selectedSubId={selectedSubId} onSubmissionSelect={onSubmissionSelect}
        onRunAudit={runAudit} loading={loading}
      />

      {/* AI polling indicator */}
      {aiPolling && !loading && (
        <div className="flex items-center gap-2 px-6 py-2 text-[11px] text-[var(--accent)] border-b border-[var(--border-default)] bg-[var(--accent-light)]/30">
          <span className="inline-block w-2 h-2 bg-[var(--accent)] rounded-full animate-pulse" />
          AI 深度分析进行中，请稍候...
        </div>
      )}

      {/* AI error/timeout banner */}
      {aiError && !loading && (
        <div className="px-6 py-2 text-[11px] text-[var(--warning)] bg-[rgba(255,159,10,0.08)] border-b border-[var(--border-default)]">
          {aiError}
        </div>
      )}

      {/* ── Results ── */}
      {auditResult && !loading && (
        <>
          {/* ── Tabs ── */}
          <div className="flex border-b bg-[var(--bg-card)] px-6 gap-0">
            <button
              onClick={() => setActiveTab('issues')}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'issues'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <Bug className="size-3.5" />
              问题列表 ({auditResult.audit?.summary?.total_issues ?? 0})
            </button>
            <button
              onClick={() => setActiveTab('summary')}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'summary'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <BarChart3 className="size-3.5" />
              总览
            </button>
            {auditResult.ai_result && (
              <button
                onClick={() => setActiveTab('ai')}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'ai'
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
              >
                <Bot className="size-3.5" />
                AI 深度分析
              </button>
            )}
          </div>

          {/* ── Tab content ── */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Issues tab */}
            {activeTab === 'issues' && (
              <div>
                {!auditResult.audit?.issues || auditResult.audit.issues.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 text-center">
                    <div className="size-20 rounded-2xl bg-emerald-50 flex items-center justify-center mb-5">
                      {aiPolling ? (
                        <Loader2 className="size-10 text-emerald-400 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-10 text-emerald-400" />
                      )}
                    </div>
                    <p className="text-sm font-medium text-[var(--text-secondary)] mb-1">
                      {aiPolling ? '规则扫描完成，未发现明显问题' : '未发现明显问题'}
                    </p>
                    <p className="text-xs text-[var(--text-tertiary)] max-w-sm leading-relaxed mb-6">
                      {aiPolling
                        ? 'AI 深度分析进行中，完成后会自动切换到「AI 深度分析」标签页'
                        : '规则扫描未发现明显问题。可点击重新审计，或等待 AI 深度分析结果'}
                    </p>
                    <div className="flex items-center gap-2 mb-6">
                      <span className="text-[10px] font-mono text-[var(--text-tertiary)] bg-[var(--bg-card-hover)] px-2 py-1 rounded">
                        {auditResult.code_length ?? effectiveCode.length} 字符
                      </span>
                      <span className="text-[10px] font-mono text-[var(--text-tertiary)] bg-[var(--bg-card-hover)] px-2 py-1 rounded">
                        {auditResult.analyzer ?? 'pattern-detector'}
                      </span>
                    </div>
                    <button
                      onClick={runAudit}
                      disabled={loading}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className="size-3.5" />
                      重新审计
                    </button>
                  </div>
                ) : (
                  auditResult.audit.issues.map((issue, i) => renderIssue(issue, i, false))
                )}
              </div>
            )}

            {/* Summary tab */}
            {activeTab === 'summary' && (
              <div className="space-y-5">
                {/* Overall quality */}
                {auditResult.audit?.summary && (
                  <div className="relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">总体质量</span>
                      {(() => {
                        const q = auditResult.audit.summary.overall_quality;
                        const cfg = qualityConfig[q] || qualityConfig.fair;
                        return (
                          <span
                            className="text-[12px] font-semibold px-2.5 py-1 rounded-full"
                            style={{ background: cfg.bg, color: cfg.color, border: '1px solid ' + cfg.color + '30' }}
                          >
                            {overallQualityLabel(q)}
                          </span>
                        );
                      })()}
                    </div>

                    <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mb-4">
                      {qualityDescription(auditResult.audit.summary.overall_quality)}
                    </p>

                    {/* Severity distribution */}
                    <div className="space-y-2">
                      {[
                        { label: '严重', value: auditResult.audit.summary.critical_count ?? 0, color: '#FF375F' },
                        { label: '警告', value: auditResult.audit.summary.warning_count ?? 0, color: '#FF9F0A' },
                        { label: '提示', value: auditResult.audit.summary.info_count ?? 0, color: '#0A84FF' },
                      ].map((row) => {
                        const total = auditResult.audit?.summary?.total_issues ?? 0;
                        const pct = total > 0 ? Math.round((row.value / total) * 100) : 0;
                        return (
                          <div key={row.label} className="flex items-center gap-2">
                            <span className="w-8 text-[10px] text-[var(--text-tertiary)] shrink-0">{row.label}</span>
                            <div className="flex-1 h-1.5 bg-[var(--bg-card-hover)] rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: pct + '%', background: row.color }} />
                            </div>
                            <span className="w-6 text-right text-[10px] font-mono text-[var(--text-tertiary)]">{row.value}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Stats grid */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{auditResult.audit?.summary?.critical_count ?? 0}</div>
                    <div className="text-[10px] text-red-500/80 mt-0.5 flex items-center justify-center gap-1">
                      <AlertTriangle className="size-3" /> 严重
                    </div>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-center">
                    <div className="text-2xl font-bold text-amber-600">{auditResult.audit?.summary?.warning_count ?? 0}</div>
                    <div className="text-[10px] text-amber-500/80 mt-0.5 flex items-center justify-center gap-1">
                      <AlertTriangle className="size-3" /> 警告
                    </div>
                  </div>
                  <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">{auditResult.audit?.summary?.info_count ?? 0}</div>
                    <div className="text-[10px] text-blue-500/80 mt-0.5 flex items-center justify-center gap-1">
                      <Info className="size-3" /> 提示
                    </div>
                  </div>
                </div>

                {/* Categories */}
                {auditResult.audit?.summary?.categories && Object.keys(auditResult.audit.summary.categories).length > 0 && (
                  <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-4">
                    <h4 className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">问题分类</h4>
                    <div className="space-y-2">
                      {Object.entries(auditResult.audit.summary.categories).map(([cat, count]) => (
                        <div key={cat} className="flex items-center justify-between">
                          <span className="text-[12px] text-[var(--text-secondary)]">{cat}</span>
                          <span className="text-[11px] font-mono text-[var(--text-tertiary)] bg-[var(--bg-card-hover)] px-2 py-0.5 rounded">{count as number}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Meta info */}
                <div className="text-[10px] text-[var(--text-tertiary)] pt-1 flex items-center gap-3">
                  <span className="flex items-center gap-1"><BarChart3 className="size-3" /> {auditResult.analyzer ?? 'pattern-detector'}</span>
                  <span>{auditResult.code_length ?? effectiveCode.length} 字符</span>
                  <span>共 {auditResult.audit?.summary?.total_issues ?? 0} 个问题</span>
                </div>
              </div>
            )}

            {/* AI deep analysis tab */}
            {activeTab === 'ai' && auditResult.ai_result && (
              <div className="space-y-5">
                {/* AI issues */}
                {auditResult.ai_result.ai_issues && auditResult.ai_result.ai_issues.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <Brain className="size-4 text-purple-500" />
                      <h3 className="text-xs font-semibold text-[var(--text-primary)]">AI 发现的问题</h3>
                    </div>
                    {auditResult.ai_result.ai_issues.map((issue, i) => renderIssue(issue, i, true))}
                  </section>
                )}

                {/* Explanation */}
                {auditResult.ai_result.explanation && (
                  <div className="relative overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 p-5">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-emerald-200/30 to-transparent rounded-bl-full" />
                    <div className="relative flex items-start gap-3">
                      <div className="size-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                        <Bot className="size-5 text-emerald-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-emerald-800 text-xs mb-1.5">整体评价</h3>
                        <p className="text-sm text-emerald-800/80 leading-relaxed">{auditResult.ai_result.explanation}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Confidence score bar */}
                {auditResult.ai_result.confidence != null && (
                  <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <ShieldCheck className="size-4 text-[var(--accent)]" />
                      <h3 className="text-xs font-semibold text-[var(--text-primary)]">置信度</h3>
                      <span className="ml-auto text-[11px] font-mono text-[var(--accent)]">
                        {Math.round(auditResult.ai_result.confidence * 100)}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-[var(--bg-card-hover)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: Math.round((auditResult.ai_result.confidence || 0) * 100) + '%',
                          background: 'linear-gradient(90deg, #0A84FF, #BF5AF2)',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Teaching hints */}
                {auditResult.ai_result.teaching_hints &&
                  (auditResult.ai_result.teaching_hints.L1 ||
                   auditResult.ai_result.teaching_hints.L2 ||
                   auditResult.ai_result.teaching_hints.L3) && (
                  <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-4">
                    <h4 className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">启发式提示</h4>
                    <div className="space-y-2">
                      {/* L1 */}
                      <div
                        className={`rounded-xl p-3.5 border transition-all duration-200 cursor-pointer ${
                          hintLevel >= 1
                            ? 'bg-[rgba(48,209,88,0.06)] border-emerald-200'
                            : 'bg-[var(--bg-card-hover)] border-[var(--border-default)] hover:border-[var(--accent)]/40'
                        }`}
                        onClick={() => setHintLevel(Math.max(hintLevel, 1))}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="size-6 rounded-md bg-emerald-100 flex items-center justify-center shrink-0">
                            <Lightbulb className="size-3.5 text-emerald-600" />
                          </div>
                          <span className="text-[12px] font-semibold text-[var(--text-primary)]">L1 · 基础提示</span>
                          {hintLevel < 1 && <ChevronRight className="size-3.5 text-[var(--text-tertiary)] ml-auto" />}
                          {hintLevel >= 1 && <ChevronDown className="size-3.5 text-emerald-500 ml-auto" />}
                        </div>
                        {hintLevel >= 1 && (
                          <p className="text-[11px] text-[var(--text-secondary)] ml-8 leading-relaxed">
                            {auditResult.ai_result.teaching_hints.L1}
                          </p>
                        )}
                      </div>
                      {/* L2 */}
                      {hintLevel >= 1 && auditResult.ai_result.teaching_hints.L2 && (
                        <div
                          className={`rounded-xl p-3.5 border transition-all duration-200 cursor-pointer ${
                            hintLevel >= 2
                              ? 'bg-[rgba(255,159,10,0.06)] border-amber-200'
                              : 'bg-[var(--bg-card-hover)] border-[var(--border-default)] hover:border-[var(--accent)]/40'
                          }`}
                          onClick={() => setHintLevel(Math.max(hintLevel, 2))}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="size-6 rounded-md bg-amber-100 flex items-center justify-center shrink-0">
                              <Lightbulb className="size-3.5 text-amber-600" />
                            </div>
                            <span className="text-[12px] font-semibold text-[var(--text-primary)]">L2 · 进阶建议</span>
                            {hintLevel < 2 && <ChevronRight className="size-3.5 text-[var(--text-tertiary)] ml-auto" />}
                            {hintLevel >= 2 && <ChevronDown className="size-3.5 text-amber-500 ml-auto" />}
                          </div>
                          {hintLevel >= 2 && (
                            <p className="text-[11px] text-[var(--text-secondary)] ml-8 leading-relaxed">
                              {auditResult.ai_result.teaching_hints.L2}
                            </p>
                          )}
                        </div>
                      )}
                      {/* L3 */}
                      {hintLevel >= 2 && auditResult.ai_result.teaching_hints.L3 && (
                        <div
                          className={`rounded-xl p-3.5 border transition-all duration-200 cursor-pointer ${
                            hintLevel >= 3
                              ? 'bg-[rgba(255,69,58,0.06)] border-red-200'
                              : 'bg-[var(--bg-card-hover)] border-[var(--border-default)] hover:border-[var(--accent)]/40'
                          }`}
                          onClick={() => setHintLevel(3)}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="size-6 rounded-md bg-red-100 flex items-center justify-center shrink-0">
                              <Lightbulb className="size-3.5 text-red-600" />
                            </div>
                            <span className="text-[12px] font-semibold text-[var(--text-primary)]">L3 · 详细方案</span>
                            {hintLevel < 3 && <ChevronRight className="size-3.5 text-[var(--text-tertiary)] ml-auto" />}
                            {hintLevel >= 3 && <ChevronDown className="size-3.5 text-red-500 ml-auto" />}
                          </div>
                          {hintLevel >= 3 && (
                            <p className="text-[11px] text-[var(--text-secondary)] ml-8 leading-relaxed">
                              {auditResult.ai_result.teaching_hints.L3}
                            </p>
                          )}
                        </div>
                      )}
                      {/* Next hint button */}
                      {hintLevel < 3 && auditResult.ai_result.teaching_hints.L2 && (
                        <button
                          onClick={() => setHintLevel(hintLevel + 1)}
                          className="text-[10px] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors mt-1"
                        >
                          点击查看下一层提示 →
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Pattern matches */}
                {auditResult.ai_result.pattern_matches && auditResult.ai_result.pattern_matches.length > 0 && (
                  <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-4">
                    <h4 className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">模式匹配结果</h4>
                    <div className="space-y-2">
                      {auditResult.ai_result.pattern_matches.map((p: any, i: number) => (
                        <div key={i} className="flex items-center gap-2">
                          <Badge variant={severityVariant(p.severity)} size="sm">{p.severity}</Badge>
                          <span className="text-[11px] text-[var(--text-secondary)]">{p.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* LLM raw analysis */}
                {auditResult.ai_result.llm_analysis && auditResult.ai_result.llm_analysis !== 'LLM不可用，使用规则引擎分析' && (
                  <details className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-xl p-4 group">
                    <summary className="flex items-center gap-2 text-xs font-semibold text-[var(--text-tertiary)] cursor-pointer hover:text-[var(--text-primary)]">
                      <Brain className="size-3.5" />
                      查看 LLM 原始分析
                      <ChevronDown className="size-3 ml-auto transition-transform group-open:rotate-180" />
                    </summary>
                    <pre className="mt-3 p-3 bg-[var(--bg-card-hover)] rounded-lg text-[10px] text-[var(--text-tertiary)] whitespace-pre-wrap break-all overflow-x-auto leading-relaxed">
                      {auditResult.ai_result.llm_analysis.slice(0, 500)}
                    </pre>
                  </details>
                )}

                {/* Error */}
                {auditResult.ai_result.error && (
                  <div className="border border-red-200 rounded-xl p-4 bg-red-50/50">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="size-4 text-red-500" />
                      <span className="text-xs font-medium text-red-700">AI 分析错误</span>
                    </div>
                    <p className="text-xs text-red-600">{auditResult.ai_result.error}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Empty State ── */}
      {!auditResult && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="relative mb-5">
            <div className="size-20 rounded-2xl flex items-center justify-center bg-gradient-to-br from-blue-100 to-purple-100">
              <ScanLine className="size-10 text-blue-400" />
            </div>
            <div className="absolute -bottom-1 -right-1 size-7 rounded-full bg-[var(--bg-card)] border-2 border-[var(--border-default)] flex items-center justify-center">
              <Search className="size-3.5 text-[var(--accent)]" />
            </div>
          </div>
          <p className="text-sm font-medium text-[var(--text-secondary)] mb-1.5">代码审计</p>
          <p className="text-xs text-[var(--text-tertiary)] text-center max-w-sm leading-relaxed">
            点击「开始审计」扫描代码，检测潜在问题并获取 AI 洞察分析
          </p>
          <div className="mt-6 grid grid-cols-4 gap-3 text-center max-w-md">
            {[
              { icon: ScanLine, label: '规则扫描' },
              { icon: Brain, label: 'AI 分析' },
              { icon: Lightbulb, label: '启发提示' },
              { icon: Search, label: '模式匹配' },
            ].map((item, i) => (
              <div key={i} className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-lg p-3">
                <item.icon className="size-5 mx-auto mb-1 text-[var(--text-tertiary)]" />
                <div className="text-[10px] text-[var(--text-tertiary)]">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Header sub-component
   ============================================================ */
function Header({
  submissions, selectedSubId, onSubmissionSelect,
  onRunAudit, loading,
}: {
  submissions: SubmissionInfo[];
  selectedSubId?: string | null;
  onSubmissionSelect?: (id: string) => void;
  onRunAudit: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b bg-[var(--bg-card)]">
      {/* Left: Icon + Title */}
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-blue-100 to-purple-100">
          <ScanLine className="size-5 text-blue-500" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">代码审计</h2>
          <p className="text-[11px] text-[var(--text-tertiary)]">规则 + AI 深度分析</p>
        </div>
      </div>

      {/* Right: Submission selector + Action button */}
      <div className="flex items-center gap-3">
        {submissions.length > 0 && onSubmissionSelect && (
          <div className="flex items-center gap-1.5">
            <label className="text-[11px] text-[var(--text-tertiary)]">提交记录</label>
            <select
              value={selectedSubId || ''}
              onChange={(e) => onSubmissionSelect(e.target.value)}
              className="text-[11px] border border-[var(--border-default)] rounded-md px-2 py-1.5 bg-[var(--bg-card)] text-[var(--text-primary)] max-w-[260px]"
            >
              <option value="">当前代码 (编辑器)</option>
              {submissions.map((sub) => (
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
        <button
          onClick={onRunAudit}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--accent)] text-white text-xs font-medium rounded-lg hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
        >
          <Zap className="size-3.5" />
          {loading ? '分析中...' : '开始审计'}
        </button>
      </div>
    </div>
  );
}
