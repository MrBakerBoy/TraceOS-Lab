"use client";

import { useState } from "react";
import ConversationSidebar from "./ConversationSidebar";
import ChatPanel from "./ChatPanel";
import MonitoringPanel from "./MonitoringPanel";
import { PanelLeft, PanelRight, ChevronRight } from "lucide-react";
import { useChatTheme } from "@/hooks/useChatTheme";

interface AIAssistantLayoutProps {
  experimentId: string;
  courseId?: string;
  /** When true, renders without the top title bar (for embedding in SlideUpPanel) */
  embedded?: boolean;
}

export default function AIAssistantLayout({
  experimentId,
  courseId,
  embedded = false,
}: AIAssistantLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [monitorOpen, setMonitorOpen] = useState(true);
  const theme = useChatTheme();

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Controls bar (only in embedded mode, simpler than standalone top bar) */}
      {embedded && (
        <div className="h-9 flex items-center justify-between px-3 border-b border-border/30 shrink-0">
          <span className="text-[11px] font-medium" style={{ color: theme.textPrimary }}>
            AI 智能助手 · ETCLOVG Agent
          </span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="size-6 rounded-md flex items-center justify-center hover:bg-muted/50 transition-colors"
              style={{ color: theme.textTertiary }}
              title="切换会话面板"
            >
              <PanelLeft className="size-3.5" />
            </button>
            <button
              onClick={() => setMonitorOpen(!monitorOpen)}
              className="size-6 rounded-md flex items-center justify-center hover:bg-muted/50 transition-colors"
              style={{ color: theme.textTertiary }}
              title="切换监控面板"
            >
              <PanelRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Three-panel layout */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Conversation Sidebar */}
        <div
          className={
            sidebarOpen
              ? "relative"
              : "absolute left-0 top-0 bottom-0 z-10"
          }
        >
          <ConversationSidebar
            experimentId={experimentId}
            courseId={courseId}
            isOpen={sidebarOpen}
            onToggle={() => setSidebarOpen(!sidebarOpen)}
          />
        </div>

        {/* Chat Panel */}
        <div className="flex-1 min-w-0">
          <ChatPanel />
        </div>

        {/* Monitoring Panel */}
        <div
          className={
            monitorOpen
              ? "w-72 shrink-0"
              : "absolute right-0 top-0 bottom-0 z-10"
          }
        >
          {monitorOpen ? (
            <MonitoringPanel experimentId={experimentId} />
          ) : (
            <button
              onClick={() => setMonitorOpen(true)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 w-6 h-16 bg-card border border-border/50 rounded-l-xl flex items-center justify-center hover:bg-accent/10 transition-colors shadow-sm"
              title="打开监控面板"
            >
              <ChevronRight className="size-3.5" style={{ color: theme.textTertiary }} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}