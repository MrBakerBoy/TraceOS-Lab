'use client';

import { useEffect, useRef, useState } from 'react';

interface DeadlockData {
  detected: boolean;
  cycle?: number[];
  details?: string[];
  fix?: string;
}

interface GraphNode {
  threads: { tid: number; x: number; y: number }[];
  locks: { uaddr: string; x: number; y: number; holder: number | null; waiters: number[] }[];
}

/** Read a KT theme CSS variable from a DOM element at draw time. */
function ktColor(el: HTMLElement, name: string, fallback: string): string {
  if (typeof getComputedStyle === 'undefined') return fallback;
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

export default function DeadlockPanel({ pid }: { pid: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [deadlock, setDeadlock] = useState<DeadlockData | null>(null);
  const [status, setStatus] = useState<string>('connecting');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [graph, setGraph] = useState<GraphNode>({ threads: [], locks: [] });
  const [syscallCounts, setSyscallCounts] = useState<Record<string, number>>({});
  const [totalSyscalls, setTotalSyscalls] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const [resizeVersion, setResizeVersion] = useState(0);

  // SSE connection — auth via Cookie (not URL query param)
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token && typeof document !== 'undefined') {
      document.cookie = `token=${encodeURIComponent(token)}; path=/; SameSite=Lax`;
    }
    const url = `/api/v1/ebpf/stream/${pid}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setStatus('observing');
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStatus('disconnected');
      }
    };

    es.onmessage = (msg) => {
      try {
        const { type, payload } = JSON.parse(msg.data);

        if (type === 'graph') {
          const threads = (payload.threads || []).map((t: { tid: number }) => ({
            tid: t.tid, x: 0, y: 0,
          }));
          const locks = (payload.locks || []).map((l: { uaddr: string; holder: number; waiters: number[] }) => ({
            uaddr: l.uaddr, x: 0, y: 0, holder: l.holder || null, waiters: l.waiters || [],
          }));
          setGraph({ threads, locks });
        } else if (type === 'deadlock') {
          setDeadlock(payload);
          setStatus('deadlock');
        } else if (type === 'safe') {
          setStatus('safe');
          setLogLines(prev => [...prev.slice(-8), '✅ ' + (payload?.msg || 'No deadlock detected')]);
        } else if (type === 'log') {
          setLogLines(prev => [...prev.slice(-8), payload?.text || '']);
        } else if (type === 'syscall') {
          const name = payload?.syscall || 'unknown';
          const cnt = payload?.count || 1;
          setSyscallCounts(prev => ({ ...prev, [name]: (prev[name] || 0) + cnt }));
          setTotalSyscalls(p => p + cnt);
        } else if (type === 'info') {
          setLogLines(prev => [...prev.slice(-8), 'ℹ️ ' + (payload?.msg || '')]);
        } else if (type === 'done') {
          setStatus(prev => prev === 'deadlock' || prev === 'safe' ? prev : 'done');
        }
      } catch (e) {
        console.error('[DeadlockPanel] Parse error:', e);
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [pid]);

  // Canvas draw — colors read from KT theme at paint time
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = canvas.width = rect.width * dpr;
    const h = canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, rect.width, rect.height);

    // Read KT theme tokens from canvas element
    const cyan   = ktColor(canvas, '--kt-cyan', '#3b82f6');
    const green  = ktColor(canvas, '--kt-green', '#10b981');
    const amber  = ktColor(canvas, '--kt-amber', '#f59e0b');
    const red    = ktColor(canvas, '--kt-red', '#ef4444');
    const textSec = ktColor(canvas, '--kt-text-secondary', '#C9D2E0');
    const textTer = ktColor(canvas, '--kt-text-tertiary', '#9BA6B8');

    if (graph.threads.length === 0) {
      const entries = Object.entries(syscallCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
      if (entries.length > 0) {
        const barW = 40;
        const gap = 20;
        const maxVal = Math.max(...entries.map(e => e[1]), 1);
        const chartH = rect.height - 60;
        const startX = (rect.width - (entries.length * (barW + gap))) / 2 + 30;
        entries.forEach(([name, cnt], i) => {
          const barH = (cnt / maxVal) * chartH;
          const x = startX + i * (barW + gap);
          const y = rect.height - 40 - barH;
          ctx.fillStyle = cyan;
          ctx.fillRect(x, y, barW, barH);
          ctx.fillStyle = textSec;
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(name, x + barW / 2, rect.height - 20);
          ctx.fillText(String(cnt), x + barW / 2, y - 8);
        });
        ctx.fillStyle = textTer;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`System Call Distribution (${totalSyscalls} total)`, rect.width / 2, 20);
        return;
      }
      ctx.fillStyle = textSec;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for trace events...', rect.width / 2, rect.height / 2);
      return;
    }

    // Layout
    const threads = graph.threads.map((t, i) => ({
      ...t,
      x: rect.width * 0.2,
      y: (rect.height * (i + 1)) / (graph.threads.length + 1),
    }));
    const locks = graph.locks.map((l, i) => ({
      ...l,
      x: rect.width * 0.75,
      y: (rect.height * (i + 1)) / (graph.locks.length + 1),
    }));

    const isDeadlock = deadlock !== null;

    // Hold lines (green)
    ctx.lineWidth = 2;
    locks.forEach(l => {
      if (!l.holder) return;
      const t = threads.find(t => t.tid === l.holder);
      if (!t) return;
      ctx.strokeStyle = green;
      ctx.beginPath();
      ctx.moveTo(t.x + 20, t.y);
      ctx.lineTo(l.x - 16, l.y);
      ctx.stroke();
    });

    // Wait lines (red if deadlock, amber otherwise)
    locks.forEach(l => {
      l.waiters.forEach(wid => {
        const t = threads.find(t => t.tid === wid);
        if (!t) return;
        ctx.strokeStyle = isDeadlock ? red : amber;
        ctx.lineWidth = isDeadlock ? 3 : 2;
        ctx.setLineDash(isDeadlock ? [] : [5, 3]);
        ctx.beginPath();
        ctx.moveTo(t.x + 20, t.y);
        ctx.quadraticCurveTo((t.x + l.x) / 2, t.y - 30, l.x - 16, l.y);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    });

    // Thread nodes
    threads.forEach(t => {
      const inCycle = deadlock?.cycle?.includes(t.tid);
      ctx.fillStyle = inCycle ? red : cyan;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = inCycle ? red : cyan;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`T${t.tid}`, t.x, t.y);
    });

    // Lock nodes
    locks.forEach(l => {
      ctx.fillStyle = isDeadlock ? amber : green;
      ctx.fillRect(l.x - 14, l.y - 14, 28, 28);
      ctx.strokeStyle = isDeadlock ? amber : green;
      ctx.lineWidth = 2;
      ctx.strokeRect(l.x - 14, l.y - 14, 28, 28);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒', l.x, l.y);
    });

    // Safe overlay
    if (status === 'safe' && !deadlock) {
      ctx.fillStyle = green + '1F'; // ~12% opacity
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = green;
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✅ No deadlock detected', rect.width / 2, rect.height - 30);
    }

  }, [graph, deadlock, status, syscallCounts, totalSyscalls, resizeVersion]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      setResizeVersion(v => v + 1);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const statusLabels: Record<string, { style: string; text: string }> = {
    connecting:    { style: 'text-[var(--kt-amber)]', text: 'Connecting' },
    observing:     { style: 'text-[var(--kt-green)]', text: '🟢 Live' },
    deadlock:      { style: 'text-[var(--kt-red)] font-bold', text: '🔴 Deadlock' },
    safe:          { style: 'text-[var(--kt-green)] font-bold', text: '✅ Safe' },
    disconnected:  { style: 'text-[var(--kt-text-tertiary)]', text: 'Offline' },
    done:          { style: 'text-[var(--kt-cyan)]', text: 'Done' },
  };

  return (
    <div className="flex flex-col h-full bg-[var(--kt-bg-surface)]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--kt-border)] shrink-0">
        <h3 className="font-semibold text-sm text-[var(--kt-text)]">🔬 eBPF 锁观测</h3>
        <span className={`text-xs ${statusLabels[status]?.style || ''}`}>
          {statusLabels[status]?.text || status}
        </span>
      </div>
      <div className="flex-1 bg-[var(--kt-bg-deep)] relative min-h-0">
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>
      {deadlock && (
        <div className="p-3 bg-[var(--kt-red-dim)] border-t border-[var(--kt-red)]/20 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🔴</span>
            <span className="font-bold text-[var(--kt-red)]">检测到死锁！</span>
            <span className="text-xs text-[var(--kt-red)]/70">{deadlock.cycle?.join(' ↔ ')}</span>
          </div>
          {deadlock.details?.map((d, i) => (
            <div key={i} className="text-xs text-[var(--kt-red)]/70 ml-7">{d}</div>
          ))}
          {deadlock.fix && (
            <div className="mt-2 p-2 bg-[var(--kt-amber-dim)] rounded text-xs text-[var(--kt-amber)]">
              💡 Fix: {deadlock.fix}
            </div>
          )}
        </div>
      )}
      {status === 'safe' && !deadlock && (
        <div className="p-3 bg-[var(--kt-green-dim)] border-t border-[var(--kt-green)]/20 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">✅</span>
            <span className="font-bold text-[var(--kt-green)]">无死锁</span>
          </div>
          <div className="text-xs text-[var(--kt-green)]/70 mt-1">所有线程正常完成，未检测到循环等待。</div>
        </div>
      )}
      <div className="px-4 py-2 max-h-24 overflow-y-auto bg-[var(--kt-bg-elevated)] border-t border-[var(--kt-border)] text-xs font-mono text-[var(--kt-text-tertiary)] shrink-0">
        {logLines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
