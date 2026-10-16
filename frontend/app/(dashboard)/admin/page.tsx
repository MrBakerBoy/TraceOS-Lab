"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Shield, Gauge, Layers, Settings, Hammer, Users, ScrollText } from "lucide-react";
import { getUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import AdminOverviewPanel from "@/components/admin/AdminOverviewPanel";
import SubmissionQueuePanel from "@/components/admin/SubmissionQueuePanel";
import ExperimentConfigPanel from "@/components/admin/ExperimentConfigPanel";
import TestCasePanel from "@/components/admin/TestCasePanel";
import UsersPanel from "@/components/admin/UsersPanel";

type TabKey = "overview" | "queue" | "configs" | "testcases" | "users";

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "overview", label: "系统概览", icon: Gauge },
  { key: "queue", label: "提交队列", icon: Layers },
  { key: "configs", label: "实验配置", icon: Settings },
  { key: "testcases", label: "测试用例", icon: Hammer },
  { key: "users", label: "用户管理", icon: Users },
];

export default function AdminDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== "admin") {
      router.replace("/experiments");
      return;
    }
    setUser(u);
  }, [router]);

  if (!user) return null;

  return (
    <div className="px-4 py-6 md:px-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/50 bg-card shadow-sm">
          <Shield className="size-6 text-muted-foreground" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">系统管理中心</h1>
          <p className="text-sm text-muted-foreground">全平台管控与数据面板</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/admin/logs")}
            className="gap-1.5"
          >
            <ScrollText className="size-3.5" /> 审计日志
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border/50">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content with direction-aware transition */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {activeTab === "overview" && <AdminOverviewPanel />}
          {activeTab === "queue" && <SubmissionQueuePanel />}
          {activeTab === "configs" && <ExperimentConfigPanel />}
          {activeTab === "testcases" && <TestCasePanel />}
          {activeTab === "users" && <UsersPanel />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}