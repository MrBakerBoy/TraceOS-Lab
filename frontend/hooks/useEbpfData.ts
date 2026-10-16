"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import type {
  SandboxMetrics, LeakReport, AllocFlamegraphData, MemoryTrend,
  RaceReport, DeadlockEvolution, TraceData, TraceSummary, SyscallTrace,
} from "@/types/ebpf";

// ── Generic Fetcher ──────────────────────────────────────────────────

interface FetcherState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useFetcher<T>(
  submissionId: string | null,
  fetcher: (id: string) => Promise<T>,
  enabled: boolean = true,
) {
  const [state, setState] = useState<FetcherState<T>>({ data: null, loading: enabled, error: null });
  const mountedRef = useRef(true);
  const fetchIdRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const fetch = useCallback(async () => {
    if (!submissionId || !enabled) return;
    const fetchId = ++fetchIdRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await fetcherRef.current(submissionId);
      if (mountedRef.current && fetchId === fetchIdRef.current) {
        setState({ data: result, loading: false, error: null });
      }
    } catch (err: unknown) {
      if (mountedRef.current && fetchId === fetchIdRef.current) {
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : "请求失败" });
      }
    }
  }, [submissionId, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    fetch();
    return () => { mountedRef.current = false; };
  }, [fetch]);

  return { ...state, refetch: fetch };
}

// ── Individual Hooks ─────────────────────────────────────────────────

export function useSandboxMetrics(submissionId: string | null) {
  return useFetcher<SandboxMetrics>(
    submissionId,
    (id) => api.getSandboxMetrics(id),
    !!submissionId,
  );
}

export function useLeakReport(submissionId: string | null) {
  return useFetcher<LeakReport>(
    submissionId,
    (id) => api.getLeakReport(id),
    !!submissionId,
  );
}

export function useAllocFlamegraph(submissionId: string | null) {
  return useFetcher<AllocFlamegraphData>(
    submissionId,
    (id) => api.getAllocFlamegraph(id),
    !!submissionId,
  );
}

export function useMemoryTrend(submissionId: string | null) {
  return useFetcher<MemoryTrend>(
    submissionId,
    (id) => api.getMemoryTrend(id),
    !!submissionId,
  );
}

export function useRaceReport(submissionId: string | null) {
  return useFetcher<RaceReport>(
    submissionId,
    (id) => api.getRaceReport(id),
    !!submissionId,
  );
}

export function useDeadlockEvolution(submissionId: string | null) {
  return useFetcher<DeadlockEvolution>(
    submissionId,
    (id) => api.getDeadlockEvolution(id),
    !!submissionId,
  );
}

export function useTraces(submissionId: string | null) {
  return useFetcher<TraceData>(
    submissionId,
    async (id) => {
      const result = await api.getSyscallTraces(id);
      return {
        summary: result.summary as TraceSummary,
        traces: (result.traces || []) as SyscallTrace[],
      };
    },
    !!submissionId,
  );
}

// ── Health aggregation hook ──────────────────────────────────────────

import type { HealthScore, HealthStatus, HealthDimension } from "@/types/ebpf";

export function useEbpfHealth(submissionId: string | null) {
  const sandbox = useSandboxMetrics(submissionId);
  const leak = useLeakReport(submissionId);
  const race = useRaceReport(submissionId);
  const deadlock = useDeadlockEvolution(submissionId);
  const traces = useTraces(submissionId);

  const loading = sandbox.loading || leak.loading || race.loading || deadlock.loading || traces.loading;
  const error = sandbox.error || leak.error || race.error || deadlock.error || traces.error;

  const healthScore: HealthScore | null = !loading && !error && sandbox.data ? computeHealth(sandbox.data, leak.data, race.data, deadlock.data, traces.data) : null;

  return { healthScore, loading, error };
}

function computeHealth(
  sandbox: SandboxMetrics | null,
  leak: LeakReport | null,
  race: RaceReport | null,
  deadlock: DeadlockEvolution | null,
  traces: TraceData | null,
): HealthScore {
  const dimensions: HealthDimension[] = [
    computeCompileScore(traces),
    computeResourceScore(sandbox),
    computeMemoryScore(leak),
    computeConcurrencyScore(race, deadlock),
    computeExecutionScore(traces, sandbox),
  ];

  const total = dimensions.reduce((sum, d) => sum + d.score, 0);
  const status: HealthStatus = total >= 90 ? "healthy" : total >= 70 ? "warning" : "critical";

  const statusText = status === "healthy" ? "程序运行正常" : status === "warning" ? "检测到潜在问题" : "检测到严重问题";
  const criticalDims = dimensions.filter((d) => d.status === "critical");
  const summary = criticalDims.length > 0
    ? `${statusText}：${criticalDims.map((d) => d.label).join("、")}`
    : statusText;

  return { total, status, dimensions, summary, generatedAt: new Date().toISOString() };
}

function computeCompileScore(traces: TraceData | null): HealthDimension {
  if (!traces) return { label: "编译", score: 0, maxScore: 20, status: "critical", tabId: "syscalls" };
  return { label: "编译", score: 20, maxScore: 20, status: "healthy", tabId: "syscalls" };
}

function computeResourceScore(sandbox: SandboxMetrics | null): HealthDimension {
  if (!sandbox) return { label: "资源", score: 0, maxScore: 20, status: "unknown", tabId: "resources" };
  let score = 20;
  if (sandbox.cpu_percent > 90) score -= 5;
  if (sandbox.mem_percent > 80) score -= 5;
  if (sandbox.mem_oom_risk > 0.8) score -= 5;
  if (sandbox.fd_count > sandbox.fd_soft_limit * 0.8) score -= 5;
  if (sandbox.cfs_throttled_ms > 0) score -= 5;
  score = Math.max(0, score);
  const status: HealthStatus = score >= 15 ? "healthy" : score >= 10 ? "warning" : "critical";
  return { label: "资源", score, maxScore: 20, status, tabId: "resources" };
}

function computeMemoryScore(leak: LeakReport | null): HealthDimension {
  if (!leak) return { label: "内存", score: 20, maxScore: 20, status: "unknown", tabId: "memory" };
  let score = 20;
  if (leak.leak_summary.definitely_lost > 0) score -= 10;
  if (leak.leak_summary.indirectly_lost > 0) score -= 5;
  if (leak.leak_summary.possibly_lost > 0) score -= 3;
  if (leak.heaptrack_summary.leak_probability > 0.5) score -= 5;
  if (leak.heaptrack_summary.net_growth_mbps > 1) score -= 5;
  score = Math.max(0, score);
  const status: HealthStatus = score >= 18 ? "healthy" : score >= 10 ? "warning" : "critical";
  return { label: "内存", score, maxScore: 20, status, tabId: "memory" };
}

function computeConcurrencyScore(
  race: RaceReport | null, deadlock: DeadlockEvolution | null,
): HealthDimension {
  let score = 20;
  if (race && race.has_races) score -= 8;
  if (deadlock && deadlock.detected) score -= 12;
  score = Math.max(0, score);
  const status: HealthStatus = score === 20 ? "healthy" : score >= 12 ? "warning" : "critical";
  return { label: "并发", score, maxScore: 20, status, tabId: "concurrency" };
}

function computeExecutionScore(
  traces: TraceData | null, sandbox: SandboxMetrics | null,
): HealthDimension {
  let score = 20;
  if (traces && traces.summary.error_count > 0) score -= 5;
  if (traces && traces.summary.error_count / Math.max(traces.summary.total_count, 1) > 0.1) score -= 5;
  if (sandbox && sandbox.alerts.some((a) => a.severity === "critical")) score -= 5;
  score = Math.max(0, score);
  const status: HealthStatus = score >= 18 ? "healthy" : score >= 12 ? "warning" : "critical";
  return { label: "执行", score, maxScore: 20, status, tabId: "syscalls" };
}