import { create } from 'zustand';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import type { SyscallTrace, Language, Achievement } from '@/lib/api';
import type {
  TabType,
  Experiment,
  TestCase,
  Submission,
  Comment,
  EvalResult,
  DiagnosisResult,
  AIMessage,
} from '@/types/workspace';
import type { ThemeMode } from '@/lib/themes';
import { THEME_STORAGE_KEY } from '@/lib/themes';

// ── New types for Kernel Terminal redesign ──

export type LayoutPreset = "coding" | "debugging" | "analyzing";
export type LayoutType = "three-column" | "two-column-terminal" | "focus" | "compare"; // Legacy support
export type DockTool = "diagnosis" | "chat" | "audit" | "ebpf" | "flamegraph" | "trace" | "waterfall" | "memory3d" | "resources" | null;

// ── Cross-panel sync types ──
export interface ObsEvent {
  timestamp: number;
  type: string;       // "syscall" | "lock" | "mem" | "sched" | "perf"
  label: string;
  threadId?: number;
  severity?: "info" | "warning" | "critical";
  sourcePanel?: string;
}
export type PanelSplitMode = "vertical" | "horizontal" | "floating" | "fullscreen" | "window";

export interface CodeSnapshot {
  id: string;
  code: string;
  language: string;
  note: string;
  createdAt: number;
}

export interface RunHistoryEntry {
  id: string;
  submissionId: string;
  code: string;
  timestamp: number;
  duration: number;
  score: number;
  totalScore: number;
  coreScore?: number;
  edgeScore?: number;
  isQualified?: boolean;
  passedTests: number;
  totalTests: number;
  status: string;
  output: string;
  perfMetrics?: {
    threadCount?: number;
    totalOps?: number;
    avgLockWait?: number;
    avgCpuTime?: number;
  };
}

export interface CachedResult {
  data: any;
  submission_id: string;
  created_at: string;
  expires_at: string;
}

export interface ExperimentCache {
  flamegraph?: CachedResult;
  ebpf_trace?: CachedResult;
  code_audit?: CachedResult;
  waterfall?: CachedResult;
  memory3d?: CachedResult;
  live_perf?: CachedResult;
  ai_analysis?: CachedResult;
}

export interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
  duration?: number;
}

// ── Sandbox resource metrics shape (derived from ObsContext.resource_metrics) ──
export interface SandboxMetrics {
  cpu_percent: number;
  mem_percent: number;
  mem_working_set_bytes: number;
  mem_limit_bytes: number;
  io_read_bytes: number;
  io_write_bytes: number;
  io_wait_percent: number;
  fd_count: number;
  fd_soft_limit: number;
  thread_count: number;
  thread_running: number;
  thread_sleeping: number;
  page_faults_minor: number;
  page_faults_major: number;
  context_switches: number;
  cpu_cfs_throttled_ms: number;
  mem_oom_events: number;
  mem_oom_risk: number;
}

// ── RiskIndicators re-export for ResourceMonitorCard compatibility ──
import type { RiskIndicators, ObsContext, TierState, TierLevel, ActiveFilter } from "@/types/obs_context";

const LAYOUT_KEY = "traceos_layout_preference";
const PREF_KEY = "traceos_experiment_prefs";
const SNAPSHOT_KEY_PREFIX = "traceos_snapshots_";
const RUN_HISTORY_KEY_PREFIX = "traceos_runhistory_";

function loadLayoutPref() {
  if (typeof window === "undefined") return { layout: "three-column" as LayoutType, sizes: {} as Record<string,number> };
  try { const raw = localStorage.getItem(LAYOUT_KEY); if (raw) return JSON.parse(raw); } catch {}
  return { layout: "three-column" as LayoutType, sizes: {} as Record<string,number> };
}
function saveLayoutPref(pref: {layout: LayoutType; sizes: Record<string,number>}) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(pref));
}

// New preference persistence for Kernel Terminal
function loadPrefs(): {
  layoutPreset: LayoutPreset;
  isRightVisible: boolean;
  collapsedCards: string[];
  isDockVisible: boolean;
  parallelMode: boolean;
  dockPinnedTools: DockTool[];
  panelMode: PanelSplitMode;
  panelHeight: number;
  competitionMode: "high" | "low";
  isPanelOpen: boolean;
  themeMode: ThemeMode;
} {
  if (typeof window === "undefined") return {
    layoutPreset: "debugging", isRightVisible: true, collapsedCards: [],
    isDockVisible: true, parallelMode: false, dockPinnedTools: ["diagnosis","chat","audit","flamegraph","trace","resources"],
    panelMode: "vertical", panelHeight: 40, competitionMode: "high", isPanelOpen: false, themeMode: "light"
  };
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) return { ...loadPrefsDefaults(), ...JSON.parse(raw), isPanelOpen: false };
  } catch {}
  return loadPrefsDefaults();
}
function loadPrefsDefaults() {
  return {
    layoutPreset: "debugging" as LayoutPreset, isRightVisible: true, collapsedCards: [] as string[],
    isDockVisible: true, parallelMode: false, dockPinnedTools: ["diagnosis","chat","audit","flamegraph","trace","resources"] as DockTool[],
    panelMode: "vertical" as PanelSplitMode, panelHeight: 40, isPanelOpen: false, competitionMode: "high" as "high"|"low",
    themeMode: "light" as ThemeMode
  };
}
function savePrefs(prefs: object) {
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
}

function loadSnapshots(experimentId: string): CodeSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY_PREFIX + experimentId);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}
function saveSnapshots(experimentId: string, snapshots: CodeSnapshot[]) {
  localStorage.setItem(SNAPSHOT_KEY_PREFIX + experimentId, JSON.stringify(snapshots));
}

function loadRunHistory(experimentId: string): RunHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RUN_HISTORY_KEY_PREFIX + experimentId);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}
function saveRunHistory(experimentId: string, history: RunHistoryEntry[]) {
  localStorage.setItem(RUN_HISTORY_KEY_PREFIX + experimentId, JSON.stringify(history.slice(-20)));
}

interface WorkspaceState {
  activeTab: TabType;
  layout: LayoutType;
  panelSizes: Record<string, number>;

  // ── Kernel Terminal layout state ──
  layoutPreset: LayoutPreset;
  isRightVisible: boolean;
  collapsedCards: string[];
  isDockVisible: boolean;
  parallelMode: boolean;
  dockPinnedTools: DockTool[];
  activeDockTool: DockTool;
  secondaryDockTool: DockTool;
  panelMode: PanelSplitMode;
  panelHeight: number;
  isPanelOpen: boolean;
  isTierPanelOpen: boolean;
  competitionMode: "high" | "low";
  themeMode: ThemeMode;

  // ── Code snapshots ──
  codeSnapshots: CodeSnapshot[];

  // ── Run history ──
  runHistory: RunHistoryEntry[];
  compareRunIds: [string, string] | null;

  // ── Experiment params ──
  experimentParams: { threadCount: number; totalOps: number };

  // ── Toast notifications ──
  toasts: Toast[];

  // ── Experiment cache (memory feature) ──
  experimentCache: ExperimentCache | null;
  showAnswerModal: boolean;
  showCongratulation: boolean;
  showEvaluationResult: boolean;

  // Loading & error states
  experimentLoading: boolean;
  experimentError: string | null;
  submissionsLoading: boolean;
  commentsLoading: boolean;

  experiment: Experiment | null;
  testCases: TestCase[];
  canViewAnswer: boolean;
  submissions: Submission[];
  selectedSubmissionId: string | null;
  comments: Comment[];
  code: string;
  language: string;

  // AI Chat state
  showAIChat: boolean;
  aiMessages: AIMessage[];
  aiLoading: boolean;
  aiInput: string;

  // Submission state
  submitting: boolean;
 // running submission id; drives the live perf dashboard visibility.
 runningSubmissionId: string | null;
  // Live perf dashboard phase
  perfPhase: 'idle' | 'running' | 'final' | 'pinned';
// Execution replay state
replayActive: boolean;
 replayTimestamp: number | null;
 replayTraces: SyscallTrace[];
 replayIndex: number;
 replayPlaying: boolean;
 replaySpeed: number;

 // ── Cross-panel sync ──
 crossPanelSync: boolean;
 highlightedEvent: ObsEvent | null;
 syncedTimestamp: number | null;
 editorFontSize: number;
  editorTheme: string;
  evalResult: EvalResult | null;
  diagnosis: DiagnosisResult | null;
  diagnosisLoading: boolean;
  experimentId: string;

  // ── ObsContext & Resource Monitoring ──
  obsContext: ObsContext | null;
  sandboxMetrics: SandboxMetrics | null;
  riskIndicators: RiskIndicators | null;
  tierState: TierState;
  setObsContext: (ctx: ObsContext | null) => void;
  fetchAndSetObsContext: (submissionId: string) => Promise<void>;
  clearObsContext: () => void;
  setTier: (tier: TierLevel) => void;
  setSelectedPanel: (panel: string | null) => void;
  setReplayTimestamp: (ts: number) => void;
  setActiveFilters: (filters: ActiveFilter[]) => void;
  obsContextLoading: boolean;

  // ── Achievements ──
  achievements: Achievement[];
  unlockedCount: number;
  achievementsLoading: boolean;
  achievementToasts: { id: string; achievement: Achievement }[];
  loadAchievements: () => Promise<void>;
  dismissAchievementToast: (id: string) => void;

  // Actions
  setLayout: (layout: LayoutType) => void;
  updatePanelSize: (panelId: string, size: number) => void;
  // ── Cache ──
  loadCachedResults: (experimentId: string) => Promise<void>;
  setActiveTab: (tab: TabType) => void;
  setCode: (code: string) => void;
  setLanguage: (lang: string) => void;
  setEditorFontSize: (size: number) => void;
  setEditorTheme: (theme: string) => void;
  setExperimentId: (id: string) => void;
  loadExperiment: (id: string) => Promise<void>;
  // AI Chat
  setShowAIChat: (s: boolean) => void;
  setAIInput: (val: string) => void;
  sendAIMessage: () => Promise<void>;
  clearAIChat: () => void;
  // Data
  loadSubmissions: () => Promise<void>;
  loadComments: () => Promise<void>;
  // Submission
  submitCode: () => Promise<void>;
  resetCode: () => void;
  selectSubmission: (id: string) => void;
  // Execution replay actions
 startReplay: (traces: SyscallTrace[]) => void;
 seekToTimestamp: (ts: number) => void;
 seekToIndex: (idx: number) => void;
 togglePlay: () => void;
stopReplay: () => void;
 setReplaySpeed: (speed: number) => void;
  setPerfPhase: (phase: 'idle' | 'running' | 'final' | 'pinned') => void;
 setCrossPanelSync: (v: boolean) => void;
 setHighlightedEvent: (event: ObsEvent | null) => void;
 setSyncedTimestamp: (ts: number | null) => void;

 setShowAnswerModal: (v: boolean) => void;
  setShowCongratulation: (v: boolean) => void;
  setShowEvaluationResult: (v: boolean) => void;

  clearEvalResult: () => void;
  loadSubmissionDiagnosis: (id: string) => Promise<void>;

 // ── Kernel Terminal actions ──
  setLayoutPreset: (preset: LayoutPreset) => void;
  setIsRightVisible: (v: boolean) => void;
  toggleCardCollapse: (cardId: string) => void;
  setIsDockVisible: (v: boolean) => void;
  setParallelMode: (v: boolean) => void;
  setActiveDockTool: (tool: DockTool) => void;
  setSecondaryDockTool: (tool: DockTool) => void;
  setDockPinnedTools: (tools: DockTool[]) => void;
  setPanelMode: (mode: PanelSplitMode) => void;
  setPanelHeight: (height: number) => void;
  setIsPanelOpen: (v: boolean) => void;
  setIsTierPanelOpen: (v: boolean) => void;
  setCompetitionMode: (mode: "high" | "low") => void;
  setThemeMode: (mode: ThemeMode) => void;
  // Snapshots
  addSnapshot: (note: string) => void;
  restoreSnapshot: (id: string) => void;
  deleteSnapshot: (id: string) => void;
  // Run history
  addRunHistory: (entry: Omit<RunHistoryEntry, "id" | "timestamp">) => void;
  clearRunHistory: () => void;
  setCompareRunIds: (ids: [string, string] | null) => void;
  // Experiment params
  setExperimentParams: (params: Partial<{ threadCount: number; totalOps: number }>) => void;
  // Safe reset
  resetCodeWithOptions: (keepFramework: boolean) => void;
  // Toast
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;

  // ── Conversation state ──
  conversations: import("@/lib/api").Conversation[];
  activeConversationId: string | null;
  conversationMessages: import("@/lib/api").ConversationMessage[];
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  loadConversations: (experimentId?: string) => Promise<void>;
  createConversation: (title: string, experimentId?: string, agentMode?: string) => Promise<import("@/lib/api").Conversation | null>;
  deleteConversation: (id: string) => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;

  // ── ObsContext composite/link state ──
  compositeTrigger: unknown | null;
  crossModuleLinks: unknown[];

  // ── Draft autosave ──
  _draftSaveTimer: ReturnType<typeof setTimeout> | null;
  autoSaveDraft: (experimentId: string, code: string, language?: string) => void;
  loadDraft: (experimentId: string) => Promise<unknown>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const prefs = loadPrefs();
  const initialExperimentId = '';
  return {
  layout: loadLayoutPref().layout,
  panelSizes: loadLayoutPref().sizes,
  // ── Kernel Terminal defaults ──
  layoutPreset: prefs.layoutPreset ?? "debugging",
  isRightVisible: prefs.isRightVisible ?? true,
  collapsedCards: prefs.collapsedCards,
  isDockVisible: prefs.isDockVisible,
  parallelMode: prefs.parallelMode,
  dockPinnedTools: prefs.dockPinnedTools,
  activeDockTool: null,
  secondaryDockTool: null,
  panelMode: prefs.panelMode,
  panelHeight: prefs.panelHeight,
  isPanelOpen: prefs.isPanelOpen ?? false,
  isTierPanelOpen: false,
  competitionMode: prefs.competitionMode,
  themeMode: prefs.themeMode || "light",
  codeSnapshots: [],
  runHistory: [],
  compareRunIds: null,
  experimentParams: { threadCount: 4, totalOps: 1000000 },

  // ── Experiment cache ──
  experimentCache: null,
  showAnswerModal: false,
  showCongratulation: false,
  showEvaluationResult: false,
  toasts: [],
  // ── Existing defaults ──
  activeTab: 'topic',
  experimentLoading: false,
  experimentError: null,
  submissionsLoading: false,
  commentsLoading: false,
  experiment: null,
  testCases: [],
  canViewAnswer: false,
  submissions: [],
  selectedSubmissionId: null,
  comments: [],
  code: '',
  language: 'c',
  showAIChat: false,
  aiMessages: [
    { role: 'ai', content: '你好！我是 AI 教学助手，我可以看到你当前编写的代码和实验要求，有任何疑问随时问我哦。' },
  ],
  aiLoading: false,
  aiInput: '',
 submitting: false,
 runningSubmissionId: null,
  perfPhase: 'idle',
 replayActive: false,
 replayTimestamp: null,
 replayTraces: [],
 replayIndex: 0,
 replayPlaying: false,
 replaySpeed: 1,
 // ── Cross-panel sync defaults ──
 crossPanelSync: true,
 highlightedEvent: null,
 syncedTimestamp: null,
  editorFontSize: 14,
  editorTheme: "vs-dark",
  evalResult: null,
  diagnosis: null,
  diagnosisLoading: false,
  experimentId: '',
  obsContext: null,
  sandboxMetrics: null,
  riskIndicators: null,
  compositeTrigger: null,
  crossModuleLinks: [],
  obsContextLoading: false,
  achievements: [],
  unlockedCount: 0,
  achievementsLoading: false,
  achievementToasts: [],
  tierState: { currentTier: 1 as TierLevel, selectedPanel: null as string | null, replayTimestamp: 0, activeFilters: [] as ActiveFilter[] },

  setActiveTab: (tab) => set({ activeTab: tab }),
  setCode: (code) => set({ code }),
  setLanguage: (language) => {
    const { experiment, code } = get();
    const templates = experiment?.templates || [];
    // Determine current language's starter to check if user hasn't written anything yet
    const oldLang = get().language || 'c';
    const oldTpl = templates.find((t) => t.language === oldLang);
    const oldStarter = oldTpl?.starter_code || experiment?.starter_code || '';
    // If current code is empty or unchanged from old starter, auto-load new language starter
    const newTpl = templates.find((t) => t.language === language);
    const cTpl = templates.find((t) => t.language === 'c');
    const newStarter = newTpl?.starter_code || cTpl?.starter_code || experiment?.starter_code || '';
    if (code.trim() === '' || code === oldStarter) {
      set({ language, code: newStarter });
    } else {
      set({ language });
    }
  },
  setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
  setEditorTheme: (editorTheme) => set({ editorTheme }),
  setExperimentId: (id) => set({ experimentId: id }),
  setLayout: (layout) => {
    const sizes = get().panelSizes;
    saveLayoutPref({ layout, sizes });
    set({ layout });
  },

  // ── Cache loading ──
  loadCachedResults: async (experimentId: string) => {
    try {
      const res = await api.getExperimentCache(experimentId);
      if (res.caches) {
        set({ experimentCache: res.caches as ExperimentCache });
      }
    } catch {
      // Cache load failure is non-fatal
    }
  },
  updatePanelSize: (panelId, size) => {
    const clampedSize = panelId === "description" ? Math.max(size, 32) : size;
    const newSizes = { ...get().panelSizes, [panelId]: clampedSize };
    saveLayoutPref({ layout: get().layout, sizes: newSizes });
    set({ panelSizes: newSizes });
  },
  setShowAIChat: (showAIChat) => set({ showAIChat }),
  setAIInput: (aiInput) => set({ aiInput }),
  clearAIChat: () => set({ aiMessages: [], aiInput: '' }),

  loadExperiment: async (id: string) => {
    set({
      experimentLoading: true,
      experimentError: null,
      submissions: [],
      comments: [],
      aiMessages: [
        { role: 'ai', content: '你好！我是 AI 教学助手，我可以看到你当前编写的代码和实验要求，有任何疑问随时问我哦。' },
      ],
      evalResult: null,
      diagnosis: null,
      diagnosisLoading: false,
      selectedSubmissionId: null,
      activeTab: 'topic',
      experimentId: id,
      // Load persisted snapshots & run history for this experiment
      codeSnapshots: loadSnapshots(id),
      runHistory: loadRunHistory(id),
      compareRunIds: null,
      showCongratulation: false,
      showEvaluationResult: false,
    });
    try {
      const res = await api.getExperiment(id);
      const exp = res.experiment;
      const templates = exp?.templates || [];
      // Find starter code for current language, fall back to C, then to experiment starter
      const curLang = get().language || 'c';
      const tpl = templates.find((t) => t.language === curLang);
      const cTpl = templates.find((t) => t.language === 'c');
      const starterCode = tpl?.starter_code || cTpl?.starter_code || exp?.starter_code || '';
      set({
        experiment: exp as unknown as Experiment,
        testCases: res.test_cases || [],
        canViewAnswer: res.can_view_answer ?? false,
        experimentLoading: false,
      });
      // Restore previously saved draft code (load AFTER setting experiment)
      let restoredCode = starterCode;
      let restoredLanguage = exp?.language_template || "c";
      if (id) {
        try {
          get().loadCachedResults(id);
          const draft = await api.getDraft(id);
          if (draft.has_draft && draft.code) {
            restoredCode = draft.code;
            restoredLanguage = draft.language || restoredLanguage;
          }
          // Load AI chat history
          try {
            const token = localStorage.getItem("token");
            const chatResp = await fetch((process.env.NEXT_PUBLIC_API_URL || "") + "/api/v1/experiments/" + id + "/ai-chat-history", {
              headers: { Authorization: "Bearer " + (token || "") }
            });
            if (chatResp.ok) {
              const chatData = await chatResp.json();
              const msgs = typeof chatData.messages === "string" ? JSON.parse(chatData.messages) : chatData.messages;
              if (Array.isArray(msgs) && msgs.length > 0) {
                set({ aiMessages: msgs });
              }
            }
          } catch {}
          // Load diagnosis if there's a selected submission
          const { selectedSubmissionId } = get();
          if (selectedSubmissionId) {
            try {
              const token = localStorage.getItem("token");
              const diagResp = await fetch((process.env.NEXT_PUBLIC_API_URL || "") + "/api/v1/submissions/" + selectedSubmissionId + "/diagnosis", {
                headers: { Authorization: "Bearer " + (token || "") }
              });
              if (diagResp.ok) {
                const diagData = await diagResp.json();
                if (diagData.diagnosis) {
                  const d = typeof diagData.diagnosis === "string" ? JSON.parse(diagData.diagnosis) : diagData.diagnosis;
                  set({ diagnosis: d, diagnosisLoading: false });
                }
              }
            } catch {}
          }
        } catch {}
      }
      set({ code: restoredCode, language: restoredLanguage });
    } catch (err) {

      console.error('Failed to load experiment:', err);
      set({
        experimentLoading: false,
        experimentError: err instanceof Error ? err.message : '加载实验失败',
      });
    }
  },

  sendAIMessage: async () => {
    const { aiInput, aiLoading, experimentId, code, language, aiMessages } = get();
    if (!aiInput.trim() || aiLoading) return;
    const question = aiInput.trim();
    set({ aiInput: '', aiLoading: true });
    set((s) => ({ aiMessages: [...s.aiMessages, { role: 'user', content: question }] }));

    try {
      const history = aiMessages
        .slice(-10)
        .map((m) => ({
          role: m.role === 'ai' ? 'assistant' : 'user',
          content: m.content,
        }));

      const res = await api.aiChat(experimentId, question, code, language, history);
      set((s) => ({ aiMessages: [...s.aiMessages, { role: 'ai', content: res.reply }] }));
    } catch (err: unknown) {
      set((s) => ({
        aiMessages: [...s.aiMessages, {
          role: 'ai',
          content: '抱歉，AI 服务暂时不可用：' + (err instanceof Error ? err.message : '未知错误'),
        }],
      }));
    } finally {
      set({ aiLoading: false });
    }
  },

  loadSubmissions: async () => {
    const { experimentId } = get();
    if (!experimentId) return;
    set({ submissionsLoading: true });
    try {
      const res = await api.getSubmissions(experimentId);
      set({ submissions: res.data || [], submissionsLoading: false });
    } catch (err) {
      console.error('Failed to load submissions:', err);
      set({ submissionsLoading: false });
    }
  },

  loadComments: async () => {
    const { experimentId } = get();
    if (!experimentId) return;
    set({ commentsLoading: true });
    try {
      const res = await api.getComments(experimentId);
      set({ comments: res.data as unknown as Comment[] || [], commentsLoading: false });
    } catch (err) {
      console.error('Failed to load comments:', err);
      set({ commentsLoading: false });
    }
  },

  submitCode: async () => {
    const { experimentId, code, language, submitting, competitionMode } = get();
    if (!experimentId || submitting) return; // Prevent duplicate submissions

   set({ submitting: true, evalResult: null, diagnosis: null, diagnosisLoading: false, runningSubmissionId: null });
   try {
     const user = getUser();
     const submission = await api.submitCode(experimentId, code, language as Language, competitionMode);
     const submissionId = submission.submission_id ?? submission.id;
      set({ runningSubmissionId: submissionId, perfPhase: 'running' });

     // Poll for evaluation result with adaptive backoff (max 60 seconds)
      let result: EvalResult | null = await pollUntil(
        () => api.getSubmission(submissionId),
        (res) => res.status === 'completed' || res.status === 'failed' ||
            res.status === 'compile_error',
        { timeoutMs: 60000 },
      );

     // Evaluation finished: clear the running id so the live perf dashboard hides.
      // Keep dashboard visible in 'final' phase for a graceful fade-out.
      set({ runningSubmissionId: null, perfPhase: 'final' });
      if (result) {
        set({ evalResult: result, showEvaluationResult: true });
        // Save to run history
        const historyEntry = {
          submissionId: submissionId,
          code: code,
          duration: 0, // Will be filled by backend if available
          score: result.score ?? 0,
          totalScore: result.total_score ?? 100,
          coreScore: result.core_score,
          edgeScore: result.edge_score,
          isQualified: result.is_qualified,
          passedTests: result.passed_test_cases ?? 0,
          totalTests: result.total_test_cases ?? 0,
          status: result.status,
          output: result.compile_error || result.runtime_error || '',
        };
        get().addRunHistory(historyEntry);
      }

      // Load observability context for resource monitor / sandbox panels
      if (submissionId) {
        void get().fetchAndSetObsContext(submissionId);
      }

      // Request AI diagnosis
      if (user && submissionId) {
        set({ diagnosisLoading: true });
        try {
          const diagResp = await api.requestDiagnosis(
            submissionId,
            experimentId,
            user.id,
          );
          const diagId = diagResp.diagnosis_id;

          // Poll for diagnosis with adaptive backoff (max 120s)
          const diagResult = await pollUntil(
            () => api.getDiagnosis(diagId),
            (d) => d.status === 'completed' || d.status === 'failed',
            { timeoutMs: 120000 },
          );

          if (diagResult) {
            set({ diagnosis: diagResult as unknown as DiagnosisResult, diagnosisLoading: false });
            // Persist diagnosis
            try {
              const token = localStorage.getItem("token");
              fetch((process.env.NEXT_PUBLIC_API_URL || "") + "/api/v1/submissions/" + diagId + "/diagnosis", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + (token || "") },
                body: JSON.stringify({ diagnosis_data: JSON.stringify(diagResult) }),
              }).catch(() => {});
            } catch {}
          }

          // If polling exhausted, try fetching any completed diagnosis
          if (get().diagnosisLoading) {
            const existing = await fetchCompletedDiagnosis(submissionId);
            if (existing) {
              set({ diagnosis: existing });
            }
            set({ diagnosisLoading: false });
          }
        } catch (diagErr) {
          console.error('Diagnosis request failed:', diagErr);
          // Try to get diagnosis that may have been created by NATS
          const existing = await fetchCompletedDiagnosis(submissionId);
          if (existing) {
            set({ diagnosis: existing });
          }
          set({ diagnosisLoading: false });
        }
      }

      // Reload submissions to show the new one
      get().loadSubmissions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '提交失败';
      console.error('Submit failed:', msg);
     // Use window.alert as fallback; in production this would use a toast system
   } finally {
      set({ submitting: false });
   }
 },

 resetCode: () => {
    const { experiment } = get();
    set({ code: experiment?.starter_code || '' });
  },

  selectSubmission: (id: string) => {
    const { submissions, selectedSubmissionId } = get();
    // Avoid re-fetching the same submission
    if (selectedSubmissionId === id) return;
    const sub = submissions.find((s) => s.id === id);
    if (sub?.code) {
      set({ code: sub.code, selectedSubmissionId: id });
    }
    set({ activeTab: `submission-${id}` as TabType, evalResult: sub, diagnosis: null, diagnosisLoading: false });

    // Load observability context for resource monitor / sandbox panels
    if (sub?.id) {
      void get().fetchAndSetObsContext(sub.id);
      loadDiagnosisForSubmission(sub.id);
    }
  },
  startReplay: (traces) => {
    if (!traces.length) return;
    set({
      replayActive: true,
      replayTimestamp: new Date(traces[0].time).getTime(),
      replayTraces: traces,
      replayIndex: 0,
      replayPlaying: false,
      replaySpeed: 1,
    });
  },
  seekToTimestamp: (ts) => {
    const traces = get().replayTraces;
    if (!traces.length) return;
    const first = new Date(traces[0].time).getTime();
    const last = new Date(traces[traces.length - 1].time).getTime();
    set({ replayTimestamp: Math.max(first, Math.min(ts, last)) });
  },
  seekToIndex: (idx) => {
    const traces = get().replayTraces;
    if (!traces.length) return;
    const clamped = Math.max(0, Math.min(idx, traces.length - 1));
    set({ replayIndex: clamped, replayTimestamp: new Date(traces[clamped].time).getTime() });
  },
  togglePlay: () => set((s) => ({ replayPlaying: !s.replayPlaying })),
  stopReplay: () => set({
    replayActive: false,
    replayTimestamp: null,
    replayTraces: [],
    replayIndex: 0,
    replayPlaying: false,
  }),
 setReplaySpeed: (speed) => set({ replaySpeed: speed }),
  setPerfPhase: (phase) => set({ perfPhase: phase }),
  // ── Cross-panel sync ──
  setCrossPanelSync: (crossPanelSync) => set({ crossPanelSync }),
  setHighlightedEvent: (highlightedEvent) => set({ highlightedEvent }),
  setSyncedTimestamp: (syncedTimestamp) => set({ syncedTimestamp }),

  // ── Kernel Terminal Actions ──
  setLayoutPreset: (layoutPreset) => {
    savePrefs({ ...loadPrefs(), layoutPreset });
    // Apply layout changes based on preset
    if (layoutPreset === 'coding') {
      set({ layoutPreset, isRightVisible: false, isDockVisible: false, isPanelOpen: false });
      // Also collapse left via legacy layout
      set((s) => ({ ...s, layout: 'focus' as LayoutType }));
    } else if (layoutPreset === 'debugging') {
      set({ layoutPreset, isRightVisible: true, isDockVisible: true });
      set((s) => ({ ...s, layout: 'three-column' as LayoutType }));
    } else if (layoutPreset === 'analyzing') {
      set({ layoutPreset, isRightVisible: true, isDockVisible: true, panelMode: 'horizontal' });
      set((s) => ({ ...s, layout: 'two-column-terminal' as LayoutType }));
    }
  },
  setIsRightVisible: (isRightVisible) => {
    savePrefs({ ...loadPrefs(), isRightVisible });
    set({ isRightVisible });
  },
  toggleCardCollapse: (cardId) => {
    set((s) => {
      const collapsedCards = s.collapsedCards.includes(cardId)
        ? s.collapsedCards.filter((c) => c !== cardId)
        : [...s.collapsedCards, cardId];
      savePrefs({ ...loadPrefs(), collapsedCards });
      return { collapsedCards };
    });
  },
  setIsDockVisible: (isDockVisible) => {
    savePrefs({ ...loadPrefs(), isDockVisible });
    set({ isDockVisible });
  },
  setParallelMode: (parallelMode) => {
    savePrefs({ ...loadPrefs(), parallelMode });
    set({ parallelMode, secondaryDockTool: parallelMode ? get().secondaryDockTool : null });
  },
  setActiveDockTool: (tool) => {
    const { activeDockTool, isPanelOpen, parallelMode } = get();
    if (tool === null) {
      // Clearing the tool always closes the panel (never re-open an empty panel)
      set({ activeDockTool: null, isPanelOpen: false, secondaryDockTool: null });
    } else if (parallelMode && activeDockTool && tool !== activeDockTool) {
      // In parallel mode, set as secondary tool
      set({ secondaryDockTool: tool, isPanelOpen: true });
    } else if (activeDockTool === tool && isPanelOpen) {
      set({ isPanelOpen: false });
    } else if (activeDockTool === tool) {
      set({ isPanelOpen: true });
    } else {
      set({ activeDockTool: tool, isPanelOpen: true, secondaryDockTool: null });
    }
  },
  setSecondaryDockTool: (secondaryDockTool) => set({ secondaryDockTool }),
  setDockPinnedTools: (dockPinnedTools) => {
    savePrefs({ ...loadPrefs(), dockPinnedTools });
    set({ dockPinnedTools });
  },
  setPanelMode: (panelMode) => {
    savePrefs({ ...loadPrefs(), panelMode });
    set({ panelMode });
  },
  setPanelHeight: (panelHeight) => {
    savePrefs({ ...loadPrefs(), panelHeight });
    set({ panelHeight });
  },
  setIsPanelOpen: (isPanelOpen) => set({ isPanelOpen }),

  // Tier navigation
  setTier: (tier) => {
    set((s) => ({
      tierState: { ...s.tierState, currentTier: tier },
      activeDockTool: null,
      isPanelOpen: false,
      isTierPanelOpen: true,
    }));
  },
  setSelectedPanel: (panel) => set((s) => ({ tierState: { ...s.tierState, selectedPanel: panel } })),
  setReplayTimestamp: (ts) => set((s) => ({ tierState: { ...s.tierState, replayTimestamp: ts } })),
  setActiveFilters: (filters) => set((s) => ({ tierState: { ...s.tierState, activeFilters: filters } })),
  setCompetitionMode: (competitionMode) => {
    savePrefs({ ...loadPrefs(), competitionMode });
    set({ competitionMode });
  },
  setThemeMode: (themeMode) => {
    savePrefs({ ...loadPrefs(), themeMode });
    if (typeof window !== "undefined") {
      localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    }
    set({ themeMode });
  },

  // Snapshots
  addSnapshot: (note) => {
    const { code, language, experimentId, codeSnapshots } = get();
    const snapshot: CodeSnapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      code, language, note,
      createdAt: Date.now(),
    };
    const updated = [snapshot, ...codeSnapshots].slice(0, 30);
    saveSnapshots(experimentId, updated);
    set({ codeSnapshots: updated });
  },
  restoreSnapshot: (id) => {
    const snapshot = get().codeSnapshots.find((s) => s.id === id);
    if (snapshot) {
      set({ code: snapshot.code, language: snapshot.language });
    }
  },
  deleteSnapshot: (id) => {
    const { experimentId, codeSnapshots } = get();
    const updated = codeSnapshots.filter((s) => s.id !== id);
    saveSnapshots(experimentId, updated);
    set({ codeSnapshots: updated });
  },

  // Run history
  addRunHistory: (entry) => {
    const { experimentId, runHistory } = get();
    const newEntry: RunHistoryEntry = {
      ...entry,
      id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };
    const updated = [newEntry, ...runHistory].slice(0, 30);
    saveRunHistory(experimentId, updated);
    set({ runHistory: updated });
  },
  clearRunHistory: () => {
    const { experimentId } = get();
    saveRunHistory(experimentId, []);
    set({ runHistory: [] });
  },
  setCompareRunIds: (compareRunIds) => set({ compareRunIds }),

  // Experiment params
  setExperimentParams: (params) => {
    set((s) => ({ experimentParams: { ...s.experimentParams, ...params } }));
  },

  // Safe reset with confirmation support
  resetCodeWithOptions: (keepFramework) => {
    const { experiment, language } = get();
    const templates = experiment?.templates || [];
    const tpl = templates.find((t) => t.language === language);
    const cTpl = templates.find((t) => t.language === 'c');
    const fullStarter = tpl?.starter_code || cTpl?.starter_code || experiment?.starter_code || '';

    if (keepFramework) {
      // Keep framework code (includes, function signatures, etc.), clear only implementation
      // Heuristic: keep lines before main function, reset the rest
      const lines = fullStarter.split('\n');
      const mainIdx = lines.findIndex((l: string) => /^(int|void)\s+main\s*\(/.test(l.trim()));
      if (mainIdx > 0) {
        const framework = lines.slice(0, mainIdx + 1).join('\n') + '\n';
        const rest = lines.slice(mainIdx + 1).join('\n');
        // Keep framework + empty main body
        const currentLines = (get().code || '').split('\n');
        const currentMainIdx = currentLines.findIndex((l: string) => /^(int|void)\s+main\s*\(/.test(l.trim()));
        if (currentMainIdx >= 0) {
          const currentFramework = currentLines.slice(0, currentMainIdx + 1).join('\n') + '\n';
          set({ code: currentFramework + '    // TODO: 在此编写你的实现\n}\n' });
        } else {
          set({ code: framework + '    // TODO: 在此编写你的实现\n}\n' });
        }
      } else {
        set({ code: fullStarter });
      }
    } else {
      set({ code: fullStarter });
    }
  },

  // Toast
  addToast: (toast) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    const duration = toast.duration || 4000;
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, duration);
  },
  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  // ── Conversation State ────────────────────────────────
  conversations: [] as import("@/lib/api").Conversation[],
  activeConversationId: null as string | null,
  conversationMessages: [] as import("@/lib/api").ConversationMessage[],
  isLoadingConversations: false,
  isLoadingMessages: false,

  // ── Conversation Actions ──────────────────────────────
  loadConversations: async (experimentId?: string) => {
    set({ isLoadingConversations: true });
    try {
      const res = await api.listConversations(experimentId);
      set({ conversations: res.conversations || [], isLoadingConversations: false });
    } catch { set({ isLoadingConversations: false }); }
  },

  createConversation: async (title: string, experimentId?: string, agentMode?: string) => {
    try {
      const conv = await api.createConversation({ title, experiment_id: experimentId, agent_mode: agentMode });
      set((s) => ({ conversations: [conv, ...s.conversations], activeConversationId: conv.id }));
      return conv;
    } catch { return null; }
  },

  deleteConversation: async (id: string) => {
    try {
      await api.deleteConversation(id);
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
      }));
    } catch {}
  },

  loadMessages: async (conversationId: string) => {
    set({ isLoadingMessages: true });
    try {
      const res = await api.getMessages(conversationId);
      set({ conversationMessages: res.messages || [], isLoadingMessages: false });
    } catch { set({ isLoadingMessages: false }); }
  },

  // ── Auto-save Draft ───────────────────────────────────
  _draftSaveTimer: null as ReturnType<typeof setTimeout> | null,
  autoSaveDraft: (experimentId: string, code: string, language?: string) => {
    const state = get() as any;
    if (state._draftSaveTimer) clearTimeout(state._draftSaveTimer);
    const newTimer = setTimeout(async () => {
      try {
        await api.saveDraft(experimentId, { code, language: language || "c" });
      } catch {}
    }, 2000);
    set({ _draftSaveTimer: newTimer } as any);
  },

  loadDraft: async (experimentId: string) => {
    try {
      const draft = await api.getDraft(experimentId);
      if (draft.has_draft && draft.code) {
        set({ code: draft.code, language: draft.language || "c" });
        return draft;
      }
    } catch {}
    return null;
  },

  clearEvalResult: () => set({ evalResult: null }),
  setShowAnswerModal: (showAnswerModal) => set({ showAnswerModal }),
  setShowCongratulation: (showCongratulation) => set({ showCongratulation }),
  setShowEvaluationResult: (showEvaluationResult) => set({ showEvaluationResult }),
  loadSubmissionDiagnosis: async (id: string) => {
    const { submissions } = get();
    const sub = submissions.find((s: any) => s.id === id);
    if (!sub) return;
    set({ evalResult: sub, diagnosis: null, diagnosisLoading: true });
    try {
      const response = await fetch("/api/ai/diagnose?submission_id=" + encodeURIComponent(id));
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          const completed = data.find((d: any) => d.status === "completed");
          if (completed) {
            set({ diagnosis: completed, diagnosisLoading: false });
            return;
          }
        }
      }
    } catch {}
    set({ diagnosisLoading: false });
  },
  setIsTierPanelOpen: (isTierPanelOpen) => set({ isTierPanelOpen }),
  setObsContext: (ctx: ObsContext | null) => set({ obsContext: ctx }),
  fetchAndSetObsContext: async (submissionId: string) => {
    if (!submissionId) return;
    try {
      set({ obsContextLoading: true });
      const res = await api.getObsContext(submissionId);
      if (!res || !res.obs_context) {
        set({ obsContextLoading: false });
        return;
      }
      const ctx = res.obs_context;
      const rms = ctx.resource_metrics || [];
      const latest = rms.length > 0 ? rms[rms.length - 1] : null;
      const risk = ctx.risk_indicators;
      const health = ctx.health_score;

      const sm: SandboxMetrics | null = latest ? {
        cpu_percent: latest.cpu_percent ?? 0,
        mem_percent: risk?.mem_saturation_pct ?? 0,
        mem_working_set_bytes: latest.mem_rss ?? 0,
        mem_limit_bytes: latest.mem_virtual ?? 0,
        io_read_bytes: latest.io_read_bytes ?? 0,
        io_write_bytes: latest.io_write_bytes ?? 0,
        io_wait_percent: 0,
        fd_count: latest.fd_count ?? 0,
        fd_soft_limit: 1024,
        thread_count: latest.thread_count ?? 0,
        thread_running: 0,
        thread_sleeping: 0,
        page_faults_minor: latest.page_fault_min ?? 0,
        page_faults_major: latest.page_fault_maj ?? 0,
        context_switches: latest.context_switches ?? 0,
        cpu_cfs_throttled_ms: (latest.cfs_throttled_us ?? 0) / 1000,
        mem_oom_events: 0,
        mem_oom_risk: risk?.oom_risk_rate ?? 0,
      } : null;

      const ri: RiskIndicators | null = risk ? {
        ...risk,
        health_score: health?.score ?? risk.health_score ?? 0,
      } : null;

      set({ obsContext: ctx, sandboxMetrics: sm, riskIndicators: ri, compositeTrigger: res.composite_trigger, crossModuleLinks: res.cross_module_links, obsContextLoading: false });
    } catch (err) {
      console.error("[ObsContext] fetch failed:", err);
      set({ obsContextLoading: false });
    }
  },
  clearObsContext: () => set({ obsContext: null, sandboxMetrics: null, riskIndicators: null, compositeTrigger: null, crossModuleLinks: [], obsContextLoading: false }),

  // ── Achievements ──
  loadAchievements: async () => {
    set({ achievementsLoading: true });
    try {
      const res = await api.listAchievements();
      set({
        achievements: res.achievements || [],
        unlockedCount: res.unlocked_count ?? 0,
        achievementsLoading: false,
      });
    } catch {
      set({ achievementsLoading: false });
    }
  },
  dismissAchievementToast: (id) =>
    set((s) => ({ achievementToasts: s.achievementToasts.filter((t) => t.id !== id) })),

};})

// ── Helper functions ──────────────────────────────────────────────────────

// Poll with adaptive backoff: start fast, then back off to a max interval.
// Avoids the fixed 2s idle wait for fast evaluations while still bounding
// request rate for long-running ones.
async function pollUntil<T>(
  fetchFn: () => Promise<T>,
  isDone: (value: T) => boolean,
  opts: { timeoutMs?: number; initialDelayMs?: number; maxDelayMs?: number } = {},
): Promise<T | null> {
  const { timeoutMs = 60000, initialDelayMs = 300, maxDelayMs = 2000 } = opts;
  const deadline = Date.now() + timeoutMs;
  let delay = initialDelayMs;
  let last: T | null = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      last = await fetchFn();
      if (isDone(last)) return last;
    } catch {
      // Result not ready yet, keep polling
    }
    delay = Math.min(Math.round(delay * 1.6), maxDelayMs);
  }
  return last;
}

async function fetchCompletedDiagnosis(submissionId: string): Promise<DiagnosisResult | null> {
  try {
    const response = await fetch(`/api/ai/diagnose?submission_id=${encodeURIComponent(submissionId)}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const completed = data.find((d: any) => d.status === 'completed');
      if (completed) return completed;
    }
    return null;
  } catch {
    return null;
  }
}

async function loadDiagnosisForSubmission(submissionId: string) {
  const diag = await fetchCompletedDiagnosis(submissionId);
  if (diag) {
    useWorkspaceStore.setState({ diagnosis: diag, diagnosisLoading: false });
  }
}
