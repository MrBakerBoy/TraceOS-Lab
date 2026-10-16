import { useCallback, useEffect, useRef } from "react";
import { useWebSocket } from "./useWebSocket";

export interface PerfMetrics {
  timestamp: number;
  cpu_percent: number;
  memory_percent: number;
  ctx_switches_per_sec: number;
  page_faults_per_sec: number;
  disk_iops: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
}

export function isPerfMetrics(data: unknown): data is PerfMetrics {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.timestamp === "number" &&
    typeof d.cpu_percent === "number" &&
    typeof d.memory_percent === "number"
  );
}

type PerfHandler = (metrics: PerfMetrics) => void;

export function usePerfMetrics(
  experimentId: string | undefined,
  onPerfMetrics: PerfHandler,
  enabled: boolean = true,
) {
  const handlerRef = useRef(onPerfMetrics);
  useEffect(() => {
    handlerRef.current = onPerfMetrics;
  }, [onPerfMetrics]);

  const handleMessage = useCallback(
    (msg: any) => {
      if (!enabled) return;
      if (msg?.type === "perf_metrics" && msg?.data) {
        console.log("[PerfMetrics] WS received", msg.data);
        if (isPerfMetrics(msg.data)) {
          handlerRef.current(msg.data);
        }
      }
    },
    [enabled],
  );

  useWebSocket(enabled ? experimentId : undefined, handleMessage);

  // Poll host metrics via Next.js API proxy → host_metrics_server.py:8766
  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    const poll = async () => {
      try {
        const res = await fetch("/api/host-metrics", {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok || !alive) return;
        const data = await res.json();
        if (data.error) return;
        const m: PerfMetrics = {
          timestamp: data.timestamp || Date.now(),
          cpu_percent: data.cpu_percent ?? 0,
          memory_percent: data.memory_percent ?? 0,
          ctx_switches_per_sec: data.ctx_switches_per_sec ?? 0,
          page_faults_per_sec: data.page_faults_per_sec ?? 0,
          disk_iops: data.disk_iops ?? 0,
          network_rx_bytes: data.network_rx_bytes ?? 0,
          network_tx_bytes: data.network_tx_bytes ?? 0,
        };
        handlerRef.current(m);
      } catch {
        // ignore polling errors
      }
      if (alive) setTimeout(poll, 3000);
    };

    const timer = setTimeout(poll, 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [enabled]);
}
