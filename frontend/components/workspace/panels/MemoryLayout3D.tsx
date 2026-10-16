'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Box, AlertTriangle, Flame, TrendingUp, GitCompare, X, MapPin, Cpu } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { useSpring, animated } from '@react-spring/three';
import { api } from '@/lib/api';
import type { MemoryLayoutSnapshot, MmapRegion } from '@/lib/api';
import { useWorkspaceStore } from '@/stores/workspace';
import type { LeakReport } from '@/types/workspace';
import { PanelHeader } from '@/components/ui/panel-header';
import ViewHelpButton from "@/components/ui/ViewHelpButton";
import { MEMORY3D_HELP } from "@/lib/view-help-content";
import { ThreeErrorBoundary } from '@/components/ui/three-error-boundary';
import { SkeletonCard } from '@/components/ui/skeleton-card';
import { EmptyState } from '@/components/ui/empty-state';
import MemorySnapshotDiff from './MemorySnapshotDiff';
import LeakReportContent from './LeakReportContent';
import AllocFlamegraphContent from './AllocFlamegraphContent';
import MemoryTrendContent from './MemoryTrendContent';

interface Props {
  submissionId: string;
  replayTimestamp?: number | null;
  highlightSegment?: string;
}

// ── Color mapping ────────────────────────────────────────────
const COLORS = {
  text: '#22c55e',
  data: '#3b82f6',
  bss: '#93c5fd',
  heap: '#f97316',
  stack: '#ef4444',
  mmap: '#a855f7',
} as const;

const SEGMENT_LABELS: { key: keyof typeof COLORS; label: string }[] = [
  { key: 'text', label: 'Text 代码段' },
  { key: 'data', label: 'Data 数据段' },
  { key: 'bss', label: 'BSS' },
  { key: 'heap', label: 'Heap 堆' },
  { key: 'mmap', label: 'mmap 映射区' },
  { key: 'stack', label: 'Stack 栈' },
];

const GAP = 0.18;
const BOX_W = 2.4;
const BOX_D = 2.4;
const MMAP_W = 1.7;
const MMAP_D = 1.7;

function sizeToHeight(size: number): number {
  if (size <= 0) return 0.5;
  return Math.max(0.5, Math.min(5.2, Math.log2(Math.max(size, 1)) * 0.27));
}

function humanSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function hexAddr(n: number): string {
  return '0x' + (n >>> 0).toString(16);
}

// ── Segment detail (for click-to-inspect) ────────────────────
interface SegmentDetail {
  type: keyof typeof COLORS;
  label: string;
  start: number;
  size: number;
  mmapPath?: string;
  isLeaking?: boolean;
}

// ── 3D sub-components ────────────────────────────────────────

function StaticSegment({ label, color, start, size, yBase, opacity = 1, width = BOX_W, depth = BOX_D, onClick, isHighlighted }: {
  label: string; color: string; start: number; size: number; yBase: number;
  opacity?: number; width?: number; depth?: number;
  onClick?: () => void;
  isHighlighted?: boolean;
}) {
  const h = sizeToHeight(size);
  const y = yBase + h / 2;
  return (
    <group>
      <mesh position={[0, y, 0]} castShadow receiveShadow onClick={(e: any) => { e.stopPropagation(); onClick?.(); }}>
        <boxGeometry args={[width, h, depth]} />
        <meshStandardMaterial color={isHighlighted ? "#FF375F" : color} transparent={opacity < 1} opacity={opacity}
          roughness={0.55} metalness={0.1} emissive={isHighlighted ? "#FF375F" : "#000000"} emissiveIntensity={isHighlighted ? 0.6 : 0} />
      </mesh>
      <Text position={[0, y, depth / 2 + 0.02]} fontSize={0.3} color="#ffffff"
        anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#000000">
        {`${label}\n${humanSize(size)}`}
      </Text>
    </group>
  );
}

function HeapSegment({ start, size, yBase, leaking = false, onClick, isHighlighted }: {
  start: number; size: number; yBase: number; leaking?: boolean; onClick?: () => void; isHighlighted?: boolean;
}) {
  const [flash, setFlash] = useState(false);
  const prevSize = useRef(size);

  useEffect(() => {
    if (size > prevSize.current) { setFlash(true); const t = setTimeout(() => setFlash(false), 380); prevSize.current = size; return () => clearTimeout(t); }
    prevSize.current = size;
  }, [size]);

  const h = sizeToHeight(size);
  const { scaleY, posY, emissive } = useSpring({
    scaleY: h, posY: yBase + h / 2,
    emissive: flash ? 0.9 : leaking ? 0.6 : 0,
    config: { tension: 130, friction: 16 },
  });

  return (
    <group>
      <animated.mesh position={[0, posY, 0]} scale={[1, scaleY, 1]} castShadow onClick={(e: any) => { e.stopPropagation(); onClick?.(); }}>
        <boxGeometry args={[BOX_W, 1, BOX_D]} />
        <animated.meshStandardMaterial color={isHighlighted ? "#FF375F" : COLORS.heap}
          emissive={leaking ? '#ef4444' : '#fff7ed'}
          emissiveIntensity={emissive} transparent opacity={0.92} roughness={0.5} />
      </animated.mesh>
      <Text position={[0, yBase + h / 2, BOX_D / 2 + 0.02]} fontSize={0.3} color="#ffffff"
        anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#000000">
        {`Heap 堆\n${humanSize(size)}`}
      </Text>
    </group>
  );
}

function MmapSegment({ region, yBase, present, onClick, isHighlighted }: {
  region: MmapRegion; yBase: number; present: boolean; onClick?: () => void;
}) {
  const h = sizeToHeight(region.size);
  const { scale } = useSpring({ scale: present ? 1 : 0, config: { tension: 150, friction: 18 } });
  const label = region.path || hexAddr(region.start);
  return (
    <group>
      <animated.mesh position={[0, yBase + h / 2, 0]} scale={scale} onClick={(e: any) => { e.stopPropagation(); onClick?.(); }}>
        <boxGeometry args={[MMAP_W, h, MMAP_D]} />
        <meshStandardMaterial color={isHighlighted ? "#FF375F" : COLORS.mmap} transparent opacity={0.42} roughness={0.6} />
      </animated.mesh>
      <Text position={[0, yBase + h / 2, MMAP_D / 2 + 0.02]} fontSize={0.22} color="#f3e8ff"
        anchorX="center" anchorY="middle" outlineWidth={0.01} outlineColor="#000000" maxWidth={MMAP_W * 1.4}>
        {`mmap\n${label}\n${humanSize(region.size)}`}
      </Text>
    </group>
  );
}

// ── Detail panel overlay ─────────────────────────────────────
function DetailPanel({ detail, onClose, leakReports }: {
  detail: SegmentDetail; onClose: () => void;
  leakReports: LeakReport[];
}) {
  const relevantLeaks = leakReports.filter(r =>
    (detail.type === 'heap' && (r.source_file?.includes('heap') || r.severity === 'definitely')) ||
    (detail.type === 'mmap' && detail.mmapPath && r.source_file?.includes(detail.mmapPath))
  );
  const isLeaking = detail.isLeaking || relevantLeaks.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      className="absolute top-3 right-3 z-20 w-64 rounded-lg border border-kt-border bg-kt-bg-card/95 p-4 shadow-xl backdrop-blur"
    >
      <button onClick={onClose} className="absolute top-2 right-2 text-kt-text-tertiary hover:text-kt-text-primary">
        <X className="size-3.5" />
      </button>
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS[detail.type], opacity: detail.type === 'mmap' ? 0.5 : 1 }} />
        <span className="text-sm font-semibold text-kt-text-primary">{detail.label}</span>
      </div>
      <div className="space-y-1.5 text-xs text-kt-text-secondary">
        <div><span className="text-kt-text-tertiary">起始地址:</span> <code className="text-[11px]">{hexAddr(detail.start)}</code></div>
        <div><span className="text-kt-text-tertiary">大小:</span> <code className="text-[11px]">{humanSize(detail.size)}</code></div>
        {detail.mmapPath && (
          <div><span className="text-kt-text-tertiary">映射文件:</span> <code className="text-[11px]">{detail.mmapPath}</code></div>
        )}
        {isLeaking && (
          <div className="mt-2 pt-2 border-t border-red-500/20">
            <div className="flex items-center gap-1.5 text-red-400 font-semibold">
              <AlertTriangle className="size-3" />
              内存泄漏警告
            </div>
            {relevantLeaks.slice(0, 2).map((lk, i) => (
              <div key={i} className="mt-1 text-[10px] text-red-300/80">
                {lk.description?.slice(0, 80)}...
              </div>
            ))}
            <p className="mt-1 text-[10px] text-yellow-400/80">
              💡 {relevantLeaks[0]?.fix_suggestion || '检查是否有对应的 free() 调用'}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Leak Overlay (top-left badge) ────────────────────────────
function LeakOverlay({ leakReports, onSelectHotspot }: {
  leakReports: LeakReport[];
  onSelectHotspot?: (addr: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (leakReports.length === 0) return null;

  const definitelyLost = leakReports.filter(r => r.severity === "definitely");
  const totalLeaked = leakReports.reduce((s, r) => s + r.size, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="absolute top-3 left-3 z-10 rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-[11px] shadow-lg backdrop-blur max-w-[280px]"
      style={{
        boxShadow: definitelyLost.length > 0
          ? '0 0 20px rgba(239,68,68,0.3), 0 0 40px rgba(239,68,68,0.15), inset 0 0 20px rgba(239,68,68,0.05)'
          : undefined,
        animation: definitelyLost.length > 0 ? 'leak-glow 2s ease-in-out infinite' : undefined,
      }}
    >
      <style>{`
        @keyframes leak-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(239,68,68,0.3), 0 0 40px rgba(239,68,68,0.15); }
          50% { box-shadow: 0 0 30px rgba(239,68,68,0.5), 0 0 60px rgba(239,68,68,0.25); }
        }
      `}</style>
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 w-full text-left">
        <span className="text-red-400 text-lg">🔴</span>
        <div>
          <div className="font-semibold text-red-400">
            {definitelyLost.length > 0 ? `${definitelyLost.length} 处确认泄漏` : "疑似内存泄漏"}
          </div>
          <div className="text-red-300/70 text-[10px]">
            总计泄漏: {totalLeaked < 1024 ? totalLeaked + " B" : totalLeaked < 1024 * 1024 ? (totalLeaked / 1024).toFixed(1) + " KB" : (totalLeaked / 1024 / 1024).toFixed(1) + " MB"}
          </div>
        </div>
        <span className="ml-auto text-red-400 text-[10px]">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-red-500/20 space-y-1.5 max-h-[200px] overflow-y-auto">
          {leakReports.slice(0, 5).map((r, i) => (
            <button key={i} className="text-[10px] w-full text-left hover:bg-red-950/20 rounded px-1 py-0.5"
              onClick={() => onSelectHotspot?.(r.address)}>
              <span className={r.severity === "definitely" ? "text-red-400" : "text-yellow-400"}>
                {r.severity === "definitely" ? "确认泄漏" : r.severity === "possibly" ? "疑似泄漏" : r.severity}
              </span>
              <span className="text-kt-text-tertiary ml-1">
                {r.source_file ? `${r.source_file}:${r.source_line}` : ""} · {r.size < 1024 ? r.size + "B" : (r.size / 1024).toFixed(0) + "KB"}
              </span>
              {r.fix_suggestion && <p className="text-yellow-300/70 mt-0.5">💡 {r.fix_suggestion.slice(0, 60)}</p>}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Allocation hotspot markers ───────────────────────────────
function HotspotMarkers({ leakReports, onSelect }: {
  leakReports: LeakReport[];
  onSelect: (addr: number) => void;
}) {
  if (leakReports.length === 0) return null;
  return (
    <div className="absolute bottom-12 left-3 z-10 flex flex-col gap-1 max-w-[200px]">
      {leakReports.filter(r => r.severity === 'definitely').slice(0, 3).map((r, i) => (
        <button key={i} onClick={() => onSelect(r.address)}
          className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-950/40 border border-red-500/30 text-[10px] text-red-400 hover:bg-red-950/60 transition-colors">
          <MapPin className="size-3 shrink-0 animate-pulse" />
          <span className="truncate">{r.source_file}:{r.source_line}</span>
          <span className="text-red-300/60 shrink-0">{r.size < 1024 ? r.size + "B" : (r.size / 1024).toFixed(0) + "KB"}</span>
        </button>
      ))}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────
function Legend() {
  return (
    <div className="absolute top-3 right-3 z-10 rounded-lg border border-kt-border bg-kt-bg-card/95 p-3 text-[11px] shadow-lg backdrop-blur">
      <div className="mb-1.5 font-semibold text-kt-text-secondary">内存段图例</div>
      <ul className="space-y-1">
        {SEGMENT_LABELS.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: COLORS[s.key], opacity: s.key === 'mmap' ? 0.5 : 1 }} />
            <span className="text-kt-text-secondary">{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Replay controls ──────────────────────────────────────────
function ReplayControls({ count, index, onIndex, timestamp }: {
  count: number; index: number; onIndex: (i: number) => void; timestamp?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const raf = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!playing) return;
    if (index >= count - 1) { setPlaying(false); return; }
    raf.current = setTimeout(() => onIndex(index + 1), 650);
    return () => { if (raf.current) clearTimeout(raf.current); };
  }, [playing, index, count, onIndex]);

  return (
    <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-kt-border bg-kt-bg-card/95 px-4 py-2 text-[11px] shadow-lg backdrop-blur">
      <button onClick={() => setPlaying((p) => !p)} className="rounded px-2 py-0.5 text-kt-accent hover:bg-kt-bg-hover" aria-label="play">
        {playing ? '⏸' : '▶'}
      </button>
      <span className="text-kt-text-tertiary">回放</span>
      <input type="range" min={0} max={Math.max(0, count - 1)} value={index}
        onChange={(e) => { setPlaying(false); onIndex(Number(e.target.value)); }}
        className="w-48 accent-kt-accent" />
      <span className="tabular-nums text-kt-text-secondary">{index + 1}/{count}</span>
      {timestamp && <span className="text-kt-text-tertiary">{new Date(timestamp).toLocaleTimeString('zh-CN')}</span>}
    </div>
  );
}

// ── 3D Scene ─────────────────────────────────────────────────
function MemoryScene({ snapshot, allSnapshots, currentIndex, leakReports, onSegmentClick, highlightedSeg }: {
  snapshot: MemoryLayoutSnapshot;
  allSnapshots: MemoryLayoutSnapshot[];
  currentIndex: number;
  leakReports: LeakReport[];
  onSegmentClick: (detail: SegmentDetail) => void;
  highlightedSeg: string | null;
}) {

  const hasDefinitelyLost = leakReports.some(r => r.severity === 'definitely');

  const unionMmap = useMemo(() => {
    const map = new Map<number, MmapRegion>();
    for (let i = 0; i <= currentIndex && i < allSnapshots.length; i++) {
      for (const r of allSnapshots[i].mmap_regions || []) map.set(r.start, r);
    }
    return Array.from(map.values());
  }, [allSnapshots, currentIndex]);

  const presentStarts = useMemo(
    () => new Set((snapshot.mmap_regions || []).map((r) => r.start)),
    [snapshot],
  );

  const layoutRef = useRef(new Map<number, { yBase: number; h: number }>());

  const { boxes, stackYBase } = useMemo(() => {
    let y = 0;
    const items: React.ReactNode[] = [];

    items.push(<StaticSegment key="text" label="Text 代码段" color={COLORS.text} isHighlighted={highlightedSeg === "text"}
      start={snapshot.text_start} size={snapshot.text_size} yBase={y}
      onClick={() => onSegmentClick({ type: 'text', label: 'Text 代码段', start: snapshot.text_start, size: snapshot.text_size })} />);
    y += sizeToHeight(snapshot.text_size) + GAP;

    items.push(<StaticSegment key="data" label="Data 数据段" color={COLORS.data} isHighlighted={highlightedSeg === "data"}
      start={snapshot.data_start} size={snapshot.data_size} yBase={y}
      onClick={() => onSegmentClick({ type: 'data', label: 'Data 数据段', start: snapshot.data_start, size: snapshot.data_size })} />);
    y += sizeToHeight(snapshot.data_size) + GAP;

    items.push(<StaticSegment key="bss" label="BSS" color={COLORS.bss} isHighlighted={highlightedSeg === "bss"}
      start={snapshot.bss_start} size={snapshot.bss_size} yBase={y}
      onClick={() => onSegmentClick({ type: 'bss', label: 'BSS', start: snapshot.bss_start, size: snapshot.bss_size })} />);
    y += sizeToHeight(snapshot.bss_size) + GAP;

    const heapBase = y;
    items.push(<HeapSegment key="heap" start={snapshot.heap_start} size={snapshot.heap_size} isHighlighted={highlightedSeg === "heap"}
      yBase={heapBase} leaking={hasDefinitelyLost}
      onClick={() => onSegmentClick({ type: 'heap', label: 'Heap 堆', start: snapshot.heap_start, size: snapshot.heap_size, isLeaking: hasDefinitelyLost })} />);
    y += sizeToHeight(snapshot.heap_size) + GAP;

    const newLayout = new Map<number, { yBase: number; h: number }>();
    let my = y;
    for (const r of snapshot.mmap_regions || []) {
      const h = sizeToHeight(r.size);
      newLayout.set(r.start, { yBase: my, h });
      my += h + GAP;
    }
    layoutRef.current.forEach((entry, start) => { if (!newLayout.has(start)) newLayout.set(start, entry); });
    layoutRef.current = newLayout;

    let mi = 0;
    for (const r of unionMmap) {
      const entry = newLayout.get(r.start) ?? { yBase: y, h: sizeToHeight(r.size) };
      items.push(<MmapSegment key={`mmap-${r.start}-${mi++}`} region={r} isHighlighted={highlightedSeg === "mmap"}
        yBase={entry.yBase} present={presentStarts.has(r.start)}
        onClick={() => onSegmentClick({ type: 'mmap', label: `mmap: ${r.path || hexAddr(r.start)}`, start: r.start, size: r.size, mmapPath: r.path })} />);
    }

    const stackBase = my;
    return { boxes: items, stackYBase: stackBase };
  }, [snapshot, unionMmap, presentStarts, hasDefinitelyLost, onSegmentClick, highlightedSeg]);

  const totalH = stackYBase + sizeToHeight(snapshot.stack_size) + 1;

  return (
    <>
      <ambientLight intensity={0.55} />
      <pointLight position={[10, 12, 10]} intensity={1.1} castShadow />
      <pointLight position={[-8, -4, -8]} intensity={0.35} />
      {boxes}
      <StaticSegment label="Stack 栈" color={COLORS.stack} start={snapshot.stack_start} isHighlighted={highlightedSeg === "stack"}
        size={snapshot.stack_size} yBase={stackYBase}
        onClick={() => onSegmentClick({ type: 'stack', label: 'Stack 栈', start: snapshot.stack_start, size: snapshot.stack_size })} />
      <OrbitControls enablePan enableZoom enableRotate target={[0, totalH / 2, 0]} minDistance={4} maxDistance={40} />
    </>
  );
}

// ── Main component ───────────────────────────────────────────
const EMPTY_LEAK_REPORTS: LeakReport[] = [];

export default function MemoryLayout3D({ submissionId, replayTimestamp, highlightSegment }: Props) {
  type MemTab = "3d" | "leak" | "alloc" | "trend" | "diff";
  const TABS: { id: MemTab; label: string; icon: typeof Box }[] = [
    { id: "3d", label: "3D 布局", icon: Box },
    { id: "leak", label: "泄漏报告", icon: AlertTriangle },
    { id: "alloc", label: "分配火焰图", icon: Flame },
    { id: "trend", label: "内存趋势", icon: TrendingUp },
    { id: "diff", label: "快照对比", icon: GitCompare },
  ];
  const [activeTab, setActiveTab] = useState<MemTab>("3d");
  const [selectedDetail, setSelectedDetail] = useState<SegmentDetail | null>(null);
  const [selectedHotspotAddr, setSelectedHotspotAddr] = useState<number | null>(null);

  const [highlightedSeg, setHighlightedSeg] = useState<string | null>(null);

  useEffect(() => {
    if (highlightSegment) {
      setHighlightedSeg(highlightSegment);
      const timer = setTimeout(() => setHighlightedSeg(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [highlightSegment]);

  const storeReplayTimestamp = useWorkspaceStore((st: any) => (st as any)?.replayTimestamp ?? null);
  const effectiveReplay = replayTimestamp !== undefined ? replayTimestamp : storeReplayTimestamp;

  const leakReports = (useWorkspaceStore((s: any) => s?.leakReports) ?? EMPTY_LEAK_REPORTS) as LeakReport[];
  const allocFlamegraph = useWorkspaceStore((s: any) => s?.allocFlamegraph ?? null);

  const experimentCache = useWorkspaceStore((s: any) => s.experimentCache);

  const [snapshots, setSnapshots] = useState<MemoryLayoutSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [cacheChecked, setCacheChecked] = useState(false);
  // -- Leak / Alloc / Trend data state --
  const [leakData, setLeakData] = useState<any>(null);
  const [leakLoading, setLeakLoading] = useState(false);
  const [leakError, setLeakError] = useState<string | null>(null);
  const [allocData, setAllocData] = useState<any>(null);
  const [allocLoading, setAllocLoading] = useState(false);
  const [allocError, setAllocError] = useState<string | null>(null);
  const [trendData, setTrendData] = useState<any>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);


  // ── Cache-first load ──
  useEffect(() => {
    if (cacheChecked) return;
    const memCache = experimentCache?.memory3d;
    if (memCache?.data && memCache.submission_id === submissionId) {
      try {
        const cached = memCache.data;
        if (cached.snapshots && cached.snapshots.length > 0) {
          setSnapshots(cached.snapshots);
          setIndex(0);
          setLoading(false);
          setCacheChecked(true);
          return;
        }
      } catch { /* fall through */ }
    }
    setCacheChecked(true);
  }, [experimentCache, submissionId, cacheChecked]);

  useEffect(() => {
    if (!cacheChecked) return;
    if (snapshots.length > 0) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api.getMemoryLayout(submissionId)
      .then((res) => {
        if (!alive) return;
        setSnapshots(res.snapshots || []);
        setIndex(0);
        setLoading(false);
        const experimentId = (res as any).experiment_id;
        if (experimentId) {
          api.saveExperimentCache(experimentId, { cache_type: "memory3d", submission_id: submissionId, data: res }).catch(() => {});
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : '加载内存布局失败';
        setError(msg.includes('404') ? '内存布局分析服务未就绪，请稍后重试' : msg);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [submissionId, cacheChecked]);

  // External replay clock → derive snapshot index
  useEffect(() => {
    if (effectiveReplay == null || snapshots.length === 0) return;
    let i = 0;
    for (let k = 0; k < snapshots.length; k++) {
      if (new Date(snapshots[k].timestamp).getTime() <= effectiveReplay) i = k; else break;
    }
    setIndex(i);
  }, [effectiveReplay, snapshots]);

  // -- Fetch leak / alloc / trend data when tabs are active --
  useEffect(() => {
    if (activeTab !== "leak" || !submissionId) return;
    let alive = true;
    setLeakLoading(true); setLeakError(null);
    api.getLeakReport(submissionId)
      .then((res: any) => { if (alive) { setLeakData(res); setLeakLoading(false); } })
      .catch((err: unknown) => { if (alive) { const msg = err instanceof Error ? err.message : "Failed"; setLeakError(msg); setLeakLoading(false); } });
    return () => { alive = false; };
  }, [activeTab, submissionId]);

  useEffect(() => {
    if (activeTab !== "alloc" || !submissionId) return;
    let alive = true;
    setAllocLoading(true); setAllocError(null);
    api.getAllocFlamegraph(submissionId)
      .then((res: any) => { if (alive) { setAllocData(res); setAllocLoading(false); } })
      .catch((err: unknown) => { if (alive) { const msg = err instanceof Error ? err.message : "Failed"; setAllocError(msg); setAllocLoading(false); } });
    return () => { alive = false; };
  }, [activeTab, submissionId]);

  useEffect(() => {
    if (activeTab !== "trend" || !submissionId) return;
    let alive = true;
    setTrendLoading(true); setTrendError(null);
    api.getMemoryTrend(submissionId)
      .then((res: any) => { if (alive) { setTrendData(res); setTrendLoading(false); } })
      .catch((err: unknown) => { if (alive) { const msg = err instanceof Error ? err.message : "Failed"; setTrendError(msg); setTrendLoading(false); } });
    return () => { alive = false; };
  }, [activeTab, submissionId]);

  const handleSegmentClick = useCallback((detail: SegmentDetail) => {
    setSelectedDetail(detail);
  }, []);

  const current = snapshots[index] || snapshots[0] || null;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <SkeletonCard variant="chart" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <EmptyState variant="error" title="加载失败" description={error} />
      </div>
    );
  }
  if (!current || snapshots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <EmptyState variant="no-data" title="无快照数据" description="该提交无内存布局快照" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* PanelHeader with tab switching */}
      <PanelHeader
        icon={TABS.find(t => t.id === activeTab)?.icon || Box}
        title={`内存分析 · ${TABS.find(t => t.id === activeTab)?.label || "3D 布局"}`}
        subtitle={activeTab === "3d" ? `${snapshots.length} 个快照 · 当前 #${index + 1}` : undefined}
        actions={
          <div className="flex items-center gap-1">
            <ViewHelpButton content={MEMORY3D_HELP} />
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                  activeTab === tab.id ? "bg-[var(--kt-cyan)] text-black" : "text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-border)]"}`}>
                <tab.icon className="size-3" />
                {tab.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Content */}
      <div className="flex-1 relative">
        {activeTab === "3d" && (
          <div className="relative h-full w-full bg-gradient-to-b from-slate-900 to-slate-950">
            <ThreeErrorBoundary>
            <Canvas shadows camera={{ position: [7, 5, 9], fov: 50 }} data-testid="memory-canvas">
              <MemoryScene snapshot={current} allSnapshots={snapshots} currentIndex={index} highlightedSeg={highlightedSeg}
                leakReports={leakReports} onSegmentClick={handleSegmentClick} />
            </Canvas>
            </ThreeErrorBoundary>
            <LeakOverlay leakReports={leakReports} onSelectHotspot={setSelectedHotspotAddr} />
            <HotspotMarkers leakReports={leakReports} onSelect={setSelectedHotspotAddr} />
            <Legend />
            <AnimatePresence>
              {selectedDetail && (
                <DetailPanel detail={selectedDetail} onClose={() => setSelectedDetail(null)} leakReports={leakReports} />
              )}
            </AnimatePresence>
            {snapshots.length > 1 && (
              <ReplayControls count={snapshots.length} index={index} onIndex={setIndex} timestamp={current.timestamp} />
            )}
          </div>
        )}

        {activeTab === "leak" && (
          <LeakReportContent leakData={leakData} leakLoading={leakLoading} leakError={leakError} />
        )}

        {activeTab === "alloc" && (
          <AllocFlamegraphContent allocData={allocData} allocLoading={allocLoading} allocError={allocError} />
        )}

        {activeTab === "trend" && (
          <MemoryTrendContent trendData={trendData} trendLoading={trendLoading} trendError={trendError} />
        )}

        {activeTab === "diff" && (
          <MemorySnapshotDiff />
        )}
      </div>
    </div>
  );
}
