"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AIAssistantLayout from "@/components/ai-assistant/AIAssistantLayout";
import { useAIAssistantStore } from "@/stores/ai-assistant";
import { api } from "@/lib/api";
import { Bot, Sparkles, Home } from "lucide-react";

export default function AIAssistantPage() {
  const params = useParams();
  const experimentId = params.id as string;
  const { stopPolling } = useAIAssistantStore();
  const [experiment, setExperiment] = useState<any>(null);

  useEffect(() => {
    api.getExperiment(experimentId).then((res: any) => {
      setExperiment(res.experiment || res);
    }).catch(() => {});

    return () => stopPolling();
  }, [experimentId]);

  return (
    <div className="flex flex-col h-screen bg-app-bg">
      {/* Top Bar */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-border/30 bg-card/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href={`/experiments/${experimentId}`}
            className="size-7 rounded-lg flex items-center justify-center hover:bg-muted/50 transition-colors text-muted-foreground"
          >
            <Home className="size-4" />
          </Link>
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-indigo-500 to-violet-500">
              <Bot className="size-3.5 text-white" />
            </div>
            <div>
              <h1 className="text-[13px] font-semibold">
                {experiment?.title || "AI 智能助手"}
              </h1>
              <p className="text-[10px] text-muted-foreground">
                实验 AI 辅导 · ETCLOVG Agent 管道
              </p>
            </div>
          </div>
        </div>

        <span className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-indigo-500/10 text-[10px] font-medium text-indigo-600">
          <Sparkles className="size-3" />
          ETCLOVG Agent
        </span>
      </div>

      {/* AI Assistant Layout */}
      <div className="flex-1 min-h-0">
        <AIAssistantLayout
          experimentId={experimentId}
          courseId={experiment?.course_id}
        />
      </div>
    </div>
  );
}