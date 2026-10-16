"use client";

import React, { Suspense } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  HeartPulse, Cpu, MemoryStick, Network, Activity,
} from "lucide-react";
import { useEbpfStore } from "@/stores/ebpfStore";
import { useEbpfHealth } from "@/hooks/useEbpfData";
import { TabHeader } from "@/components/ebpf/shared/TabHeader";
import { LoadingState } from "@/components/ebpf/shared/index";
import { EmptyState } from "@/components/ebpf/shared/index";
import type { EbpfTabId, EbpfTab } from "@/types/ebpf";

// ── Lazy-loaded tab components ──
const HealthOverviewTab = dynamic(() => import("@/components/ebpf/tabs/HealthOverviewTab"), {
  loading: () => <LoadingState message="加载健康总览..." />,
});
const ResourceMonitorTab = dynamic(() => import("@/components/ebpf/tabs/ResourceMonitorTab"), {
  loading: () => <LoadingState message="加载资源监控..." />,
});
const MemoryAnalysisTab = dynamic(() => import("@/components/ebpf/tabs/MemoryAnalysisTab"), {
  loading: () => <LoadingState message="加载内存分析..." />,
});
const ConcurrencyAnalysisTab = dynamic(() => import("@/components/ebpf/tabs/ConcurrencyAnalysisTab"), {
  loading: () => <LoadingState message="加载并发分析..." />,
});
const SyscallAnalysisTab = dynamic(() => import("@/components/ebpf/tabs/SyscallAnalysisTab"), {
  loading: () => <LoadingState message="加载系统调用..." />,
});

// ── Tab definitions ──
const TABS: EbpfTab[] = [
  { id: "health",       label: "健康总览", icon: HeartPulse, description: "一站式健康评分与关键告警" },
  { id: "resources",    label: "资源监控", icon: Cpu,        description: "CPU、内存、IO、FD 消耗详情" },
  { id: "memory",       label: "内存分析", icon: MemoryStick,description: "泄漏检测、堆趋势、分配火焰图" },
  { id: "concurrency",  label: "并发分析", icon: Network,    description: "竞态检测、死锁演化、Coffman 条件" },
  { id: "syscalls",     label: "系统调用", icon: Activity,   description: "完整调用轨迹、时序、分类统计" },
];

interface Props {
  submissionId: string;
  experimentId: string;
}

export default function EBPFTracePanel({ submissionId, experimentId }: Props) {
  const activeTab = useEbpfStore((s) => s.activeTab);
  const setActiveTab = useEbpfStore((s) => s.setActiveTab);
  const realtimeMode = useEbpfStore((s) => s.realtimeMode);
  const setRealtimeMode = useEbpfStore((s) => s.setRealtimeMode);
  const { healthScore, loading: healthLoading, error: healthError } = useEbpfHealth(submissionId);

  // Sync health score to store
  React.useEffect(() => {
    useEbpfStore.getState().setHealthScore(healthScore);
    useEbpfStore.getState().setHealthLoading(healthLoading);
    useEbpfStore.getState().setHealthError(healthError);
  }, [healthScore, healthLoading, healthError]);

  // Reset store on unmount
  React.useEffect(() => {
    return () => { useEbpfStore.getState().reset(); };
  }, []);

  const renderTab = (tabId: EbpfTabId) => {
    const props = { submissionId, experimentId };
    switch (tabId) {
      case "health":       return <HealthOverviewTab {...props} />;
      case "resources":    return <ResourceMonitorTab {...props} />;
      case "memory":       return <MemoryAnalysisTab {...props} />;
      case "concurrency":  return <ConcurrencyAnalysisTab {...props} />;
      case "syscalls":     return <SyscallAnalysisTab {...props} />;
      default:             return <HealthOverviewTab {...props} />;
    }
  };

  if (!submissionId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState type="no-data" description="请先提交代码运行，即可查看 eBPF 追踪结果" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab header with realtime toggle */}
      <TabHeader
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        rightContent={
          <button
            type="button"
            onClick={() => setRealtimeMode(!realtimeMode)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all duration-200"
            style={{
              backgroundColor: realtimeMode ? "var(--kt-green-dim)" : "var(--kt-bg-elevated)",
              color: realtimeMode ? "var(--kt-green)" : "var(--kt-text-tertiary)",
              border: `0.5px solid ${realtimeMode ? "var(--kt-green)" : "var(--kt-border)"}`,
            }}
            aria-label={realtimeMode ? "关闭实时模式" : "开启实时模式"}
            title={realtimeMode ? "实时推送已开启" : "实时推送已关闭"}
          >
            <span
              className="size-1.5 rounded-full"
              style={{
                backgroundColor: realtimeMode ? "var(--kt-green)" : "var(--kt-text-tertiary)",
                boxShadow: realtimeMode ? "0 0 4px var(--kt-green)" : "none",
              }}
            />
            {realtimeMode ? "实时" : "离线"}
          </button>
        }
      />

      {/* Tab content with animated transitions */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="h-full overflow-y-auto kt-scroll"
            id={`ebpf-tabpanel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`ebpf-tab-${activeTab}`}
          >
            <Suspense fallback={<LoadingState message="加载中..." />}>
              {renderTab(activeTab)}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}