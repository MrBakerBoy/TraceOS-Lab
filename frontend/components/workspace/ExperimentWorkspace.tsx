"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useWorkspaceStore } from "@/stores/workspace";
import { KernelNavbar } from "./KernelNavbar";
import { FloatingDock } from "./FloatingDock";
import ConversationSidebar from "./ConversationSidebar";
import { SlideUpPanel } from "./SlideUpPanel";
import { RightStatusCards } from "./RightStatusCards";
import { AchievementToasts } from "./AchievementToasts";
import { CommandPalette } from "./CommandPalette";
import { useExperimentShortcuts } from "./useExperimentShortcuts";
import CodeEditorPanel from "./CodeEditorPanel";
import { TerminalPanel } from "./panels/TerminalPanel";
import { AIPanel } from "./panels/AIPanel";
import AIAssistantLayout from "../ai-assistant/AIAssistantLayout";
import { StatusBar } from "./StatusBar";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import FlameGraphPanel from "./panels/FlameGraphPanel";
import MemoryLayout3D from "./panels/MemoryLayout3D";
import EBPFTracePanel from "./panels/EBPFTracePanel";
import TraceViewer from "./panels/TraceViewer";
import ResourceMonitorCard from "./panels/ResourceMonitorCard";

import ExecutionReplayBar from "./ExecutionReplayBar";
import CommentPanel from "./CommentPanel";
import CodeAuditPanel from "./CodeAuditPanel";
import AdaptivePanel from "./AdaptivePanel";
import { CodeSnapshotPanel } from "./CodeSnapshot";
import { RunHistoryPanel } from "./RunHistoryPanel";
import { getUser } from "@/lib/auth";
import { api } from "@/lib/api";
import { getTheme } from "@/lib/themes";
import AnswerPanel from "./AnswerPanel";
import EvaluationResultModal from "./evaluation/EvaluationResultModal";
import SafeHtml from "@/components/ui/SafeHtml";
import TierNavBar from "@/components/panels/TierNavBar";
import FilterBar from "@/components/panels/FilterBar";
import type { LayoutType, DockTool } from "@/stores/workspace";

interface Props {
  experimentId: string;
}

export default function ExperimentWorkspace({ experimentId }: Props) {
  const {
    loadExperiment,
    loadSubmissions,
    loadComments,
    submitCode,
    layout,
    setLayout,
    panelSizes,
    updatePanelSize,
    submitting,
    canViewAnswer,
    experiment,
    submissions,
    code,
    language,
    evalResult,
    // Kernel Terminal state
    layoutPreset,
    isDockVisible,
    activeDockTool,
    secondaryDockTool,
    isPanelOpen,
    setIsPanelOpen,
    isTierPanelOpen,
    setIsTierPanelOpen,
    parallelMode,
    showAnswerModal,
    setShowAnswerModal,
    showEvaluationResult,
    setShowEvaluationResult,
    setActiveDockTool,
    toasts,
    removeToast,
    themeMode,
    isRightVisible,
    setIsRightVisible,
    loadSubmissionDiagnosis,
    fetchAndSetObsContext,
    clearObsContext,
    loadAchievements,
  } = useWorkspaceStore();

  // Tier & ObsContext selectors
  const obsContext = useWorkspaceStore((s: any) => s.obsContext);
  const currentTier = useWorkspaceStore((s: any) => s.tierState.currentTier);
  const tierState = useWorkspaceStore((s: any) => s.tierState);
  const setTier = useWorkspaceStore((s: any) => s.setTier);

  const [descCollapsed, setDescCollapsed] = useState(false);
  const [adaptiveCollapsed, setAdaptiveCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Shortcuts ──
  useExperimentShortcuts(
    () => setPaletteOpen(true),
    () => setPaletteOpen(false)
  );

  // Listen for toggle-left-panel custom event (from shortcuts)
  useEffect(() => {
    const handler = () => setDescCollapsed((v) => !v);
    window.addEventListener("toggle-left-panel", handler);
    return () => window.removeEventListener("toggle-left-panel", handler);
  }, []);

  // Listen for switch-left-tab custom event (from congratulation modal)
  useEffect(() => {
    const handler = (e: Event) => setLeftTab((e as CustomEvent).detail);
    window.addEventListener("switch-left-tab", handler);
    return () => window.removeEventListener("switch-left-tab", handler);
  }, []);

  // ── Data Loading ──
  useEffect(() => {
    loadExperiment(experimentId);
    loadSubmissions();
    loadComments();
    loadAchievements();
  }, [experimentId]);

  // ── Layout helpers ──
  const showDescription = layoutPreset !== "coding" && !descCollapsed;
  const showTerminal = layout === "two-column-terminal";
  const isFocus = layout === "focus";
  const isCompare = layout === "compare";

  const handleResize = (panel: string) => (panelSize: { asPercentage: number }) => {
    updatePanelSize(panel, panelSize.asPercentage);
  };

  const [leftTab, setLeftTab] = useState<"desc" | "records" | "comments">("desc");
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const analyzeSubmissionId = selectedSubId || submissions[submissions.length - 1]?.id || "";
  const analyzeSubmission = selectedSubId
    ? submissions.find((s: any) => s.id === selectedSubId)
    : submissions[submissions.length - 1];

  // ── ObsContext Fetching ──
  useEffect(() => {
    if (analyzeSubmissionId) {
      clearObsContext();
      fetchAndSetObsContext(analyzeSubmissionId);
    } else {
      clearObsContext();
    }
  }, [analyzeSubmissionId, clearObsContext, fetchAndSetObsContext]);


  const user = getUser();
  const isTeacherOrAdmin = user?.role === "teacher" || user?.role === "admin";

  const currentReferenceSolution = (() => {
    const templates = experiment?.templates;
    if (templates && templates.length > 0) {
      const tpl = templates.find((t) => t.language === language);
      if (tpl?.reference_solution) return tpl.reference_solution;
      const cTpl = templates.find((t) => t.language === 'c');
      if (cTpl?.reference_solution) return cTpl.reference_solution;
    }
    return experiment?.reference_solution;
  })();

  const [copySuccess, setCopySuccess] = useState(false);

  // Auto-save draft on code change
  useEffect(() => {
    if (experimentId && code) {
      const timer = setTimeout(() => {
        api.saveDraft(experimentId, { code, language: "c" }).catch(() => {});
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [code, experimentId]);

  // Save draft on unmount / page leave (beforeunload)
  useEffect(() => {
    const saveNow = () => {
      const state = useWorkspaceStore.getState();
      if (state.experimentId && state.code) {
        const lang = state.language || "c";
        api.saveDraft(state.experimentId, { code: state.code, language: lang }).catch(() => {});
      }
    };
    window.addEventListener("beforeunload", saveNow);
    return () => {
      saveNow();
      window.removeEventListener("beforeunload", saveNow);
    };
  }, []);

  const handleCopyReference = () => {
    if (currentReferenceSolution) {
      navigator.clipboard.writeText(currentReferenceSolution).then(() => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      }).catch(() => {
        const textArea = document.createElement("textarea");
        textArea.value = currentReferenceSolution || "";
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      });
    }
  };

  const statusColor = (status: string) => {
    if (status === "completed") return "bg-green-100 text-green-800";
    if (status === "failed") return "bg-red-100 text-red-800";
    return "bg-yellow-100 text-yellow-800";
  };

  const leftTabClass = (tab: string) =>
    "h-full px-3 text-[11px] font-medium border-b-2 transition-colors " +
    (leftTab === tab
      ? "border-[var(--kt-cyan)] text-[var(--kt-cyan)]"
      : "border-transparent text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text)]");

  // ── Submission selector shared by trace/memory3d/flamegraph panels ──
  const SubmissionSelectBar = ({ submissions, selectedSubId, analyzeSubmissionId, onSelect }: {
    submissions: any[];
    selectedSubId: string | null;
    analyzeSubmissionId: string;
    onSelect: (id: string) => void;
  }) => {
    const currentSub = submissions.find((s: any) => s.id === analyzeSubmissionId);
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, []);

    const statusLabel = (s: string) => {
      const map: Record<string, string> = { completed: "完成", failed: "失败", timeout: "超时", running: "运行中", pending: "等待中", compile_error: "编译错误", memory_exceeded: "内存超限" };
      return map[s] || s;
    };
    const statusBadge = (s: string) => {
      if (s === "completed") return "bg-[var(--kt-green)]/15 text-[var(--kt-green)]";
      if (s === "failed") return "bg-[var(--kt-red)]/15 text-[var(--kt-red)]";
      return "bg-[var(--kt-yellow)]/15 text-[var(--kt-yellow)]";
    };

    return (
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--kt-border)] bg-[var(--kt-bg-surface)] flex-shrink-0" ref={ref}>
        <span className="text-[11px] text-[var(--kt-text-tertiary)] flex-shrink-0">提交记录</span>
        <div className="relative flex-1">
          <button
            onClick={() => setOpen(!open)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded text-[12px] bg-[var(--kt-bg-input)] border border-[var(--kt-border)] hover:border-[var(--kt-cyan)] transition-colors text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              {currentSub ? (
                <>
                  <span className="font-mono text-[var(--kt-cyan)] flex-shrink-0">#{currentSub.submission_number}</span>
                  <span className={"px-1.5 py-0.5 text-[10px] font-medium rounded-full flex-shrink-0 " + statusBadge(currentSub.status)}>
                    {statusLabel(currentSub.status)}
                  </span>
                  <span className="text-[var(--kt-text-tertiary)] truncate">
                    {currentSub.score ?? "-"}分 · {new Date(currentSub.created_at).toLocaleString("zh-CN")}
                  </span>
                </>
              ) : (
                <span className="text-[var(--kt-text-tertiary)]">选择提交记录...</span>
              )}
            </span>
            <svg className="w-3 h-3 text-[var(--kt-text-tertiary)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {open && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--kt-bg-surface)] border border-[var(--kt-border)] rounded shadow-lg z-50 max-h-56 overflow-y-auto">
              {submissions.map((sub: any) => (
                <div
                  key={sub.id}
                  onClick={() => { onSelect(sub.id); setOpen(false); }}
                  className={"flex items-center justify-between px-3 py-2 text-[12px] cursor-pointer hover:bg-[var(--kt-bg-elevated)] transition-colors " + (sub.id === analyzeSubmissionId ? "bg-[var(--kt-cyan)]/10" : "")}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[var(--kt-cyan)] flex-shrink-0">#{sub.submission_number}</span>
                    <span className={"px-1.5 py-0.5 text-[10px] font-medium rounded-full flex-shrink-0 " + statusBadge(sub.status)}>
                      {statusLabel(sub.status)}
                    </span>
                    <span className="text-[var(--kt-text-tertiary)] truncate text-[11px]">
                      {sub.score ?? "-"}分 · {new Date(sub.created_at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  {sub.id === analyzeSubmissionId && (
                    <svg className="w-3.5 h-3.5 text-[var(--kt-cyan)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };


  // ── Panel content based on active Dock tool ──

  const panelContent = (tool: DockTool) => {
    if (!tool) return null;
    switch (tool) {
      case "diagnosis":
        return (
          <div className="h-full flex flex-col">
            <SubmissionSelectBar submissions={submissions} selectedSubId={selectedSubId} analyzeSubmissionId={analyzeSubmissionId} onSelect={(id: string) => {
              setSelectedSubId(id);
              loadSubmissionDiagnosis(id);
            }} />
            <div className="flex-1 min-h-0">
              <AIPanel mode="diagnosis" collapsed={false} onToggleCollapse={() => setIsPanelOpen(false)} />
            </div>
          </div>
        );
      case "chat":
        return (
          <AIAssistantLayout
            experimentId={experimentId}
            courseId={experiment?.course_id}
            embedded
          />
        );
      case "audit":
        return (
          <div className="h-full flex flex-col">
            <SubmissionSelectBar submissions={submissions} selectedSubId={selectedSubId} analyzeSubmissionId={analyzeSubmissionId} onSelect={setSelectedSubId} />
            <div className="flex-1 min-h-0">
              <CodeAuditPanel
                code={code}
                language={language}
                experimentId={experimentId}
                submissionId={analyzeSubmissionId}
                submissions={submissions}
                selectedSubId={selectedSubId}
                onSubmissionSelect={setSelectedSubId}
                onIssueClick={(line: number) => {}}
              />
            </div>
          </div>
        );
      case "flamegraph":
        return submissions.length > 0 ? (
          <div className="h-full flex flex-col">
            <SubmissionSelectBar submissions={submissions} selectedSubId={selectedSubId} analyzeSubmissionId={analyzeSubmissionId} onSelect={setSelectedSubId} />
            <div className="flex-1 min-h-0">
              <FlameGraphPanel
                submissionId={analyzeSubmissionId}
                experimentId={experiment?.id || ""}
                studentName={analyzeSubmission?.student_name}
                submissions={submissions}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--kt-text-tertiary)] text-sm">
            暂无提交记录，无法显示火焰图
          </div>
        );
      case "trace":
        return submissions.length > 0 ? (
          <div className="h-full flex flex-col">
            <SubmissionSelectBar submissions={submissions} selectedSubId={selectedSubId} analyzeSubmissionId={analyzeSubmissionId} onSelect={setSelectedSubId} />
            <ExecutionReplayBar />
            <div className="flex-1">
              <TraceViewer submissionId={analyzeSubmissionId} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--kt-text-tertiary)] text-sm">
            暂无提交记录，无法显示 Trace
          </div>
        );


      case "memory3d":
        return submissions.length > 0 ? (
          <div className="h-full flex flex-col">
            <SubmissionSelectBar submissions={submissions} selectedSubId={selectedSubId} analyzeSubmissionId={analyzeSubmissionId} onSelect={setSelectedSubId} />
            <ExecutionReplayBar />
            <div className="flex-1">
              <MemoryLayout3D submissionId={analyzeSubmissionId} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--kt-text-tertiary)] text-sm">
            暂无提交记录，无法显示内存布局
          </div>
        );

      case "ebpf":
        return submissions.length > 0 ? (
          <div className="h-full flex flex-col">
            <SubmissionSelectBar submissions={submissions} selectedSubId={selectedSubId} analyzeSubmissionId={analyzeSubmissionId} onSelect={setSelectedSubId} />
            <div className="flex-1 min-h-0">
              <EBPFTracePanel
                submissionId={analyzeSubmissionId}
                experimentId={experiment?.id || ""}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--kt-text-tertiary)] text-sm">
            暂无提交记录，无法显示 eBPF 追踪
          </div>
        );
      case "resources":
        return (
          <div className="h-full p-2">
            <ResourceMonitorCard experimentId={experiment?.id} />
          </div>
        );
      default:
        return (
          <div className="flex items-center justify-center h-full text-[var(--kt-text-tertiary)] text-sm">
            选择工具开始使用
          </div>
        );
    }
  };

  const theme = getTheme(themeMode);

  return (
    <div
      className="flex flex-col h-full"
      style={{
        backgroundColor: theme.bgClass,
        ...theme.cssVars,
      } as React.CSSProperties}
    >
      {/* ── Top Navbar ── */}
      <KernelNavbar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />

      {/* Tier Navigation */}
      <TierNavBar />
      {obsContext && tierState.activeFilters.length > 0 && <FilterBar />}

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="flex-1 flex flex-row overflow-hidden">
          <Group orientation="horizontal" className="flex-1 min-w-0" key={`main-${layout}`}>
          {/* Left Panel: Description / Records / Comments */}
          {showDescription && (
            <>
              <Panel
                defaultSize={Math.max(panelSizes.description || 32, 32)}
                minSize={32}
                onResize={handleResize("description")}
              >
                <div className="w-full h-full bg-[var(--kt-bg-surface)] flex flex-col overflow-hidden">
                  <div className="h-8 flex items-center border-b border-[var(--kt-border)] flex-shrink-0">
                    <button
                      onClick={() => { setLeftTab("desc"); setSelectedSubId(null); }}
                      className={leftTabClass("desc")}
                    >
                      实验说明
                    </button>
                    <button
                      onClick={() => { setLeftTab("records"); setSelectedSubId(null); }}
                      className={leftTabClass("records")}
                    >
                      记录
                    </button>
                    <button
                      onClick={() => { setLeftTab("comments"); }}
                      className={leftTabClass("comments")}
                    >
                      评论
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={() => setDescCollapsed(true)}
                      className="text-[var(--kt-text-tertiary)] hover:text-[var(--kt-cyan)] text-xs px-2 transition-colors"
                    >
                      ◀
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto kt-scroll">
                    {leftTab === "desc" && (
                      <div className="p-3 text-[13px] leading-relaxed text-[var(--kt-text-secondary)]">
                        {user && (
                          <div className="mb-3 border border-[var(--kt-border)] rounded-lg overflow-hidden">
                            <button
                              onClick={() => setAdaptiveCollapsed(!adaptiveCollapsed)}
                              className="w-full flex items-center justify-between px-3 py-2 bg-[var(--kt-bg-elevated)] hover:bg-[var(--kt-border)] text-xs font-medium text-[var(--kt-text-secondary)] transition-colors"
                            >
                              <span>📊 学习画像</span>
                              <span className="text-[var(--kt-text-tertiary)]">{adaptiveCollapsed ? "▶" : "▼"}</span>
                            </button>
                            {!adaptiveCollapsed && (
                              <div className="p-0">
                                <AdaptivePanel />
                              </div>
                            )}
                          </div>
                        )}
                        {experiment ? (
                          <>
                            <h3 className="text-[15px] font-semibold mb-1 text-[var(--kt-text)]">{experiment.title}</h3>
                            <div className="flex gap-2 mb-3">
                              <span className="text-[11px] text-[var(--kt-text-tertiary)]">
                                难度: <span className="font-medium text-[var(--kt-amber)]">{experiment.difficulty || "中等"}</span>
                              </span>
                              <span className="text-[11px] text-[var(--kt-text-tertiary)]">
                                类别: <span className="font-medium text-[var(--kt-text)]">{experiment.category || "-"}</span>
                              </span>
                            </div>
                            {experiment.description && (
                              <>
                                <h4 className="text-[12px] font-semibold uppercase text-[var(--kt-text-tertiary)] tracking-wider mt-4 mb-2">题目描述</h4>
                                <SafeHtml html={experiment.description} className="text-[var(--kt-text-secondary)] experiment-content" />
                              </>
                            )}
                            {experiment.instructions && (
                              <>
                                <h4 className="text-[12px] font-semibold uppercase text-[var(--kt-text-tertiary)] tracking-wider mt-4 mb-2">实验要求</h4>
                                <SafeHtml html={experiment.instructions} className="text-[var(--kt-text-secondary)] experiment-content" />
                              </>
                            )}
                          </>
                        ) : (
                          <p className="text-[var(--kt-text-tertiary)]">加载中...</p>
                        )}
                      </div>
                    )}

                    {leftTab === "records" && (
                      <div className="p-3">
                        {selectedSubId ? (
                          (() => {
                            const sub = submissions.find((s: any) => s.id === selectedSubId);
                            if (!sub) return <p className="text-[var(--kt-text-tertiary)] text-[13px]">提交记录未找到</p>;
                            return (
                              <div className="space-y-3">
                                <button
                                  onClick={() => setSelectedSubId(null)}
                                  className="text-[11px] text-[var(--kt-cyan)] hover:underline"
                                >
                                  ← 返回列表
                                </button>
                                <div className="text-[10px] text-[var(--kt-text-tertiary)] bg-[var(--kt-bg-elevated)] rounded px-2 py-1 border border-[var(--kt-border)]">
                                  📊 底部 Trace / 内存3D / 火焰图面板正在分析此提交
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="font-medium text-[14px] text-[var(--kt-text)]">#{sub.submission_number}</span>
                                  <span className={"px-1.5 py-0.5 text-[10px] font-medium rounded-full " + statusColor(sub.status)}>
                                    {sub.status}
                                  </span>
                                </div>
                                <div className="text-[12px] text-[var(--kt-text-secondary)]">
                                  得分: {sub.score ?? "-"} / {sub.total_score ?? "-"} · 通过: {sub.passed_test_cases}/{sub.total_test_cases}
                                  {"is_qualified" in sub && sub.is_qualified !== undefined && (
                                    <span className={sub.is_qualified
                                      ? "ml-1.5 text-[var(--kt-green)]"
                                      : "ml-1.5 text-[var(--kt-red)]"}>
                                      {sub.is_qualified ? "合格" : "未达标"}
                                    </span>
                                  )}
                                  {(sub.core_score !== undefined || sub.edge_score !== undefined) && (
                                    <span className="ml-1 text-[var(--kt-text-tertiary)]">
                                      核心{sub.core_score ?? 0}/边界{sub.edge_score ?? 0}
                                    </span>
                                  )}
                                </div>
                                {sub.code && (
                                  <pre className="p-2 bg-[var(--kt-bg-elevated)] rounded text-[11px] font-mono overflow-x-auto whitespace-pre-wrap text-[var(--kt-text)]">{sub.code}</pre>
                                )}
                                {sub.compile_error && (
                                  <div className="p-2 bg-[var(--kt-red-dim)] rounded border border-[var(--kt-red)]/20">
                                    <div className="font-medium text-[var(--kt-red)] text-[11px]">编译错误</div>
                                    <pre className="mt-1 text-[var(--kt-text)] text-[11px] whitespace-pre-wrap">{sub.compile_error}</pre>
                                  </div>
                                )}
                                {sub.runtime_error && (
                                  <div className="p-2 bg-[var(--kt-red-dim)] rounded border border-[var(--kt-red)]/20">
                                    <div className="font-medium text-[var(--kt-red)] text-[11px]">运行时错误</div>
                                    <pre className="mt-1 text-[var(--kt-text)] text-[11px] whitespace-pre-wrap">{sub.runtime_error}</pre>
                                  </div>
                                )}
                              </div>
                            );
                          })()
                        ) : (submissions || []).length === 0 ? (
                          <p className="text-[var(--kt-text-tertiary)] text-[13px]">暂无提交记录</p>
                        ) : (
                          <div className="space-y-2">
                            {(submissions || []).map((sub: any) => (
                              <div
                                key={sub.id}
                                onClick={() => setSelectedSubId(sub.id)}
                                className="p-3 bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)] rounded cursor-pointer hover:border-[var(--kt-cyan)] transition-colors"
                              >
                                <div className="flex justify-between items-center mb-1">
                                  <span className="font-medium text-[13px] text-[var(--kt-text)]">#{sub.submission_number}</span>
                                  <span className={"px-1.5 py-0.5 text-[10px] font-medium rounded-full " + statusColor(sub.status)}>
                                    {sub.status}
                                  </span>
                                </div>
                                <div className="text-[11px] text-[var(--kt-text-tertiary)]">
                                  {sub.score ?? "-"}分 · {new Date(sub.created_at).toLocaleString("zh-CN")}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {leftTab === "comments" && <CommentPanel />}
                  </div>
                </div>
              </Panel>
              <Separator className="w-3 flex items-center justify-center group cursor-col-resize hover:bg-[var(--kt-cyan)]/20 transition-colors" style={{ cursor: "col-resize" }}><div className="w-px h-full bg-[var(--kt-border)] group-hover:bg-[var(--kt-cyan)] transition-colors" /></Separator>
            </>
          )}

          {/* Collapsed left toggle */}
          {descCollapsed && showDescription === false && layoutPreset !== "coding" && (
            <>
              <div className="w-8 flex flex-col items-center pt-2 bg-[var(--kt-bg-surface)] border-r border-[var(--kt-border)] flex-shrink-0">
                <button
                  onClick={() => setDescCollapsed(false)}
                  className="text-[var(--kt-text-tertiary)] hover:text-[var(--kt-cyan)] text-xs p-1 transition-colors"
                  title="展开实验说明"
                >
                  ▶
                </button>
              </div>
              <Separator className="w-3 flex items-center justify-center cursor-col-resize hover:bg-[var(--kt-cyan)]/20 transition-colors" style={{ cursor: "col-resize" }}><div className="w-px h-full bg-[var(--kt-border)]" /></Separator>
            </>
          )}

          {/* Center: Editor */}
          <Panel
            defaultSize={
              isFocus ? 100 : isCompare ? panelSizes.editor || 50 : panelSizes.editor || 48
            }
            minSize={32}
            onResize={handleResize("editor")}
          >
            <div className="h-full flex flex-col relative" style={{ background: "var(--kt-bg-deep)" }}>
              {isCompare ? (
                <div className="flex h-full">
                  <div className="flex-1 flex flex-col">
                    <div className="h-7 flex items-center justify-between px-3 bg-[var(--kt-bg-surface)] border-b border-[var(--kt-border)] text-[11px] text-[var(--kt-text-tertiary)] uppercase tracking-wider">
                      <span>参考实现 · {isTeacherOrAdmin ? "可复制" : "只读"}</span>
                      {isTeacherOrAdmin && canViewAnswer && currentReferenceSolution && (
                        <button
                          onClick={handleCopyReference}
                          className="text-[10px] px-2 py-0.5 bg-[var(--kt-cyan)] text-black rounded hover:opacity-80 transition"
                          title="复制参考代码"
                        >
                          {copySuccess ? "✓ 已复制" : "📋 复制代码"}
                        </button>
                      )}
                    </div>
                    <div className={`flex-1 bg-[var(--editor-bg)] overflow-auto p-4 font-mono text-[12px] ${isTeacherOrAdmin ? "select-text" : "select-none"}`}>
                      {canViewAnswer && currentReferenceSolution ? (
                        <pre className="text-[#6a9955] whitespace-pre-wrap break-all">{currentReferenceSolution}</pre>
                      ) : (
                        <span className="text-[#6a9955] opacity-60">{"// 参考实现在通过实验后解锁"}</span>
                      )}
                    </div>
                  </div>
                  <div className="w-[4px] bg-[var(--kt-border)] hover:bg-[var(--kt-cyan)] cursor-col-resize flex-shrink-0" />
                  <div className="flex-1 flex flex-col">
                    <div className="h-7 flex items-center px-3 bg-[var(--kt-bg-surface)] border-b border-[var(--kt-border)] text-[11px] text-[var(--kt-cyan)] uppercase tracking-wider">
                      你的代码 · 可编辑
                    </div>
                    <CodeEditorPanel />
                  </div>
                </div>
              ) : (
                <CodeEditorPanel />
              )}
            </div>
          </Panel>

          </Group>

          {/* Right Sidebar: Status Cards - outside Group for reliable sizing */}
          {isRightVisible && (
            <div className="border-l border-[var(--kt-border)] bg-[var(--kt-bg-surface)] flex flex-col overflow-hidden flex-shrink-0"
                 style={{ width: "320px", maxWidth: "40vw" }}>
              <RightStatusCards />
            </div>
          )}

          {/* Expand button when hidden */}
          {!isRightVisible && (
            <button
              onClick={() => setIsRightVisible(true)}
              className="absolute right-2 top-2 z-20 flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-[var(--kt-text-tertiary)] bg-[var(--kt-bg-surface)] border border-[var(--kt-border)] rounded hover:text-[var(--kt-cyan)] hover:border-[var(--kt-cyan)] transition-colors shadow-sm"
              title="展开实验面板"
            >
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
              <span>实验面板</span>
            </button>
          )}
        </div>

        {/* Terminal */}
        {showTerminal && <TerminalPanel visible={true} />}
      </div>

      {/* ── Slide Up Panel Layer ── */}
      <SlideUpPanel>
        {activeDockTool ? (
          parallelMode && secondaryDockTool ? (
            // Parallel mode: split view with two panels
            <div className="flex h-full">
              <div className="flex-1 border-r border-[var(--kt-border)] overflow-hidden">
                {panelContent(activeDockTool)}
              </div>
              <div className="flex-1 overflow-hidden">
                {panelContent(secondaryDockTool)}
              </div>
            </div>
          ) : (
            panelContent(activeDockTool)
          )
        ) : (
          <div className="h-full overflow-y-auto kt-scroll p-3 bg-[var(--kt-bg-surface)]">
          </div>
        )}
      </SlideUpPanel>

      {/* ── Floating Dock ── */}
      <FloatingDock />

      {/* ── Command Palette ── */}
      <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* ── Achievement Unlock Toasts ── */}
      <AchievementToasts />

      {/* ── Toast Notifications ── */}
      <div className="fixed top-14 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="kt-toast pointer-events-auto cursor-pointer"
            style={{
              borderColor:
                toast.type === "success" ? "var(--kt-green)" :
                toast.type === "error" ? "var(--kt-red)" :
                toast.type === "warning" ? "var(--kt-amber)" :
                "var(--kt-cyan)",
            }}
            onClick={() => removeToast(toast.id)}
          >
            <div className="flex items-center gap-2">
              <span>
                {toast.type === "success" ? "✅" :
                 toast.type === "error" ? "❌" :
                 toast.type === "warning" ? "⚠️" : "ℹ️"}
              </span>
              <span>{toast.message}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Status Bar ── */}
      <StatusBar />

      {/* ── Evaluation Result Modal ── */}
      {showEvaluationResult && evalResult && (
        <EvaluationResultModal
          open={showEvaluationResult}
          onOpenChange={(open) => {
            if (!open) setShowEvaluationResult(false);
          }}
          evalResult={evalResult}
          experimentTitle={experiment?.title || ""}
          experimentId={experimentId}
          courseId={experiment?.course_id || undefined}
          onViewDetails={() => {
            setShowEvaluationResult(false);
            window.dispatchEvent(new CustomEvent("switch-left-tab", { detail: "records" }));
          }}
          onAIDiagnosis={() => {
            setShowEvaluationResult(false);
            setActiveDockTool("diagnosis");
          }}
        />
      )}

      {/* ── Reference Answer Modal ── */}
      {showAnswerModal && (
        <AnswerPanel
          experiment={experiment}
          canViewAnswer={canViewAnswer}
          isTeacherOrAdmin={isTeacherOrAdmin}
          onClose={() => setShowAnswerModal(false)}
        />
      )}

    </div>
  );
}
