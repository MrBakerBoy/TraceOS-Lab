/**
 * TraceOS Lab - Unified API Client
 *
 * Features:
 * - Typed request/response interfaces
 * - Automatic retry on network errors
 * - Request deduplication
 * - Token refresh handling
 * - Request timeout
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

// ─── Types ──────────────────────────────────────────────────────────────────


// ── Adaptive Types ──────────────────────────────────────────────────────────

export interface StudentProfile {
  id: string;
  student_id: string;
  process_elo: number;
  thread_elo: number;
  memory_elo: number;
  fs_elo: number;
  scheduler_elo: number;
  deadlock_elo: number;
  avg_submissions_per_exp: number;
  preferred_difficulty: string;
  weak_concepts: string[];
  mastered_concepts: string[];
  learning_pace: string;
}

export interface AdaptiveProfile {
  profile: StudentProfile;
  radar: Record<string, number>;
  total_submissions: number;
  recent_scores: number[];
}

export interface ExperimentVariant {
  id: string;
  experiment_id: string;
  variant_name: string;
  difficulty_level: string;
  difficulty_score: number;
  parameters: Record<string, unknown>;
  test_case_ids: string[];
  hint_strategy: string;
}

export interface VariantAssignment {
  variant: ExperimentVariant;
  student_elo: number;
  decision_type: string;
  reason: string;
}

// ── Code Audit Types ────────────────────────────────────────────────────────

export interface CodeIssue {
  line: number;
  column?: number;
  severity: "error" | "warning" | "info";
  category: string;
  title: string;
  description: string;
  suggestion: string;
  tags: string[];
}

export interface AuditSummary {
  total_issues: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
  categories: Record<string, number>;
  overall_quality: string;
}

export interface CodeAuditResult {
  audit: {
    issues: CodeIssue[];
    summary: AuditSummary;
    annotations: Array<{ line: number; tag: string; detail: string }>;
  };
  code_length: number;
  analyzer: string;
  ai_pending: boolean;
  status?: string;
  ai_result?: {
    ai_issues: CodeIssue[];
    explanation: string;
    teaching_hints: { L1: string; L2: string; L3: string };
    llm_analysis: string;
    pattern_matches: Array<{ type: string; severity: string; message: string }>;
    resource_analysis: Record<string, unknown>;
    error: string | null;
  };
}

export interface ApiError {
  error: string;
  message?: string;
  detail?: string;
  code?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface User {
  id: string;
  username: string;
  email: string;
  full_name?: string;
  role: "student" | "teacher" | "admin";
  is_active: boolean;
  last_login_at?: string;
  student_no?: string;
  class_name?: string;
  teaching_classes?: string[];
}

export interface AdminUserItem extends User {
  is_online: boolean;
  total_submissions: number;
  avg_score: number;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  description?: string;
  teacher_id?: string;
  is_published: boolean;
  created_at?: string;
}

export interface InviteCode {
  id: string;
  code: string;
  max_uses: number;
  current_uses: number;
  is_active: boolean;
  created_at: string;
}

export interface Experiment {
  id: string;
  course_id?: string;
  category: "process" | "thread" | "memory" | "fs" | "scheduler" | "deadlock";
  name: string;
  title: string;
  description?: string;
  instructions?: string;
  starter_code?: string;
  reference_solution?: string;
  difficulty: "easy" | "medium" | "hard";
  time_limit: number;
  memory_limit: number;
  sandbox_level: number;
  max_submissions: number;
  is_published: boolean;
  templates?: { id: string; experiment_id?: string; language: string; starter_code?: string; reference_solution?: string; is_published?: boolean }[];
  language_template?: string;
}

export interface TestCase {
  id: string;
  experiment_id: string;
  name: string;
  type: "core" | "edge" | "performance" | "security";
  input_data?: string;
  expected_output?: string;
  is_public: boolean;
  score_weight: number;
  compare_mode?: string;
  order_index?: number;
}

export interface ChecklistItem {
  key: string;
  label: string;
  status: "passed" | "failed" | "unknown";
  detail?: string;
}

export interface Submission {
  id: string;
  submission_id?: string;
  experiment_id: string;
  student_id: string;
  code: string;
  language: Language;
  submission_number: number;
  status: SubmissionStatus;
  score?: number;
  total_score?: number;
  core_score?: number;
  edge_score?: number;
  is_qualified?: boolean;
  competition_mode?: string;
  checklist?: ChecklistItem[];
  passed_test_cases: number;
  total_test_cases: number;
  compile_error?: string;
  runtime_error?: string;
  execution_time?: number;
  memory_usage?: number;
  created_at: string;
  completed_at?: string;
}

export interface SubmissionWithStudent extends Submission {
  student_name: string;
  student_username: string;
}

export type Language = "c" | "cpp" | "python" | "rust" | "go";
export type SubmissionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "memory_exceeded"
  | "compile_error";

export interface DiagnosisResult {
  diagnosis_id: string;
  submission_id: string;
  student_id?: string;
  status?: string;
  error_type: string;
  severity: "low" | "medium" | "high" | "critical";
  root_cause: string;
  feedback: FeedbackLevels;
  related_concepts: Concept[];
  related_syscalls: SyscallInfo[];
  suggested_fixes: SuggestedFix[];
  confidence_score: number;
  llm_model?: string;
  llm_tokens_used?: number;
  diagnosis_harness_id?: string;
  has_harness_report?: boolean;
  created_at: string;
  completed_at?: string;
}

export interface FeedbackLevels {
  level_1: string;
  level_2: string;
  level_3: string;
  level_4: string;
}

export interface Concept {
  name: string;
  description: string;
  type: string;
  difficulty: "easy" | "medium" | "hard";
}

export interface SyscallInfo {
  name: string;
  description: string;
  error_code?: string;
  syscall_number: number;
}

export interface SuggestedFix {
  title: string;
  description: string;
  code_snippet?: string;
  explanation: string;
}

export interface Comment {
  id: string;
  experiment_id: string;
  user_id: string;
  parent_id?: string;
  content: string;
  is_pinned: boolean;
  is_ai?: boolean;
  created_at: string;
  updated_at: string;
  user: {
    username: string;
    full_name?: string;
    role: string;
  };
  replies?: Comment[];
}

export interface SyscallTrace {
  time: string;
  submission_id: string;
  pid: number;
  tid?: number
  args?: Record<string, unknown>
  source_line?: number
  syscall_name: string;
  return_value: number;
  error_name: string;
  duration_ns: number;
}

export interface TeacherOverview {
  total_students: number;
  total_experiments: number;
  total_submissions: number;
  pass_rate: number;
  active_today: number;
  avg_score: number;
}


export interface ExperimentStat {
  experiment_id: string;
  title: string;
  category: string;
  total_submissions: number;
  passed_submissions: number;
  pass_rate: number;
  avg_score: number;
}

export interface ScoreBucket {
  range: string;
  count: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface TeacherDashboard {
  overview: {
    total_students: number;
    total_submissions: number;
    total_experiments: number;
    avg_pass_rate: number;
  };
  experiment_stats: ExperimentStat[];
  score_distribution: ScoreBucket[];
  daily_submissions: DailyCount[];
  difficult_experiments: ExperimentStat[];
}
export interface AdminOverview {
  users: {
    total: number;
    students: number;
    teachers: number;
    admins: number;
    active_today: number;
  };
  submissions: {
    total: number;
    today: number;
    this_week: number;
    status_breakdown: Record<string, number>;
  };
  experiments: {
    total: number;
    by_category: Record<string, number>;
  };
  diagnoses: {
    total: number;
    completed: number;
    failed: number;
    avg_confidence: number;
  };
  recent_errors: { error_type: string; count: number }[];
}

export interface FlameGraphHotFunction {
  name: string;
  percent: number;
  module: string;
}

export interface FlameGraphAnalysis {
  plain_summary: string;
  top_hotspots: Array<{ function: string; what_it_means: string; optimization_tip: string }>;
  issues: Array<{ severity: string; title: string; explanation: string; suggestion: string }>;
  kernel_insight: string;
  raw_error?: string;
}

export interface EBPFAnalysis {
  plain_summary: string;
  syscall_explanations: Array<{ name: string; plain_meaning: string; why_program_uses_it: string }>;
  error_explanations: Array<{ syscall: string; error: string; plain_reason: string; fix_hint: string }>;
  patterns: Array<{ type: string; explanation: string }>;
  raw_error?: string;
}

export interface FlameGraphResult {
  submission_id: string;
  user_svg?: string;
  kernel_svg?: string;
  svg_data?: string;
  report?: string;
  summary?: string;
  has_user?: boolean;
  has_kernel?: boolean;
  elapsed_sec?: number;
  hot_functions?: FlameGraphHotFunction[];
  user_percent?: number;
  kernel_percent?: number;
  status: "generated" | "pending" | "error";
  error?: string;
}

export interface EbpfObserveResult {
  pid: number;
  probes: string[];
  status: "running" | "done" | "stopped";
  deadlock?: {
    detected: boolean;
    cycle?: number[];
    details?: string[];
    fix?: string;
  };
}

export interface TraceAnalysisRequest {
  submission_id: string;
  code: string;
  language: string;
  total_calls: number;
  unique_syscalls: number;
  error_count: number;
  total_duration_ns: number;
  top_syscalls: Array<{ name: string; count: number; total_duration_ns: number; avg_duration_ns: number; percent: number }>;
  error_syscalls: Array<{ syscall: string; error: string; count: number; phase: string }>;
  phases: Array<{ phase: string; call_count: number; error_count: number; unique_syscalls: number; dominant_syscall: string }>;
}

export interface TraceAnalysisResponse {
  plain_summary: string;
  syscall_explanations: Array<{ name: string; plain_meaning: string; why_program_uses_it: string }>;
  error_explanations: Array<{ syscall: string; error: string; plain_reason: string; fix_hint: string }>;
  phase_analysis: Array<{ phase: string; phase_label: string; summary: string }>;
  patterns: Array<{ type: string; explanation: string }>;
  performance_insights: Array<{ severity: string; title: string; explanation: string; suggestion: string }>;
  raw_error?: string;
}



// ── Memory Layout (BE-M2) Types ─────────────────────────────────────────────

export interface MmapRegion {
  start: number;
  size: number;
  perms: string;
  path: string;
}

export interface MemoryLayoutSnapshot {
  timestamp: string;
  text_start: number;
  text_size: number;
  data_start: number;
  data_size: number;
  bss_start: number;
  bss_size: number;
  heap_start: number;
  heap_size: number;
  stack_start: number;
  stack_size: number;
  mmap_regions: MmapRegion[];
}

export interface MemoryLayoutResponse {
  submission_id: string;
  snapshots: MemoryLayoutSnapshot[];
}

// ─── Fetch wrapper with retry and timeout ───────────────────────────────────

interface RequestOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  /** Milliseconds. GET-only cache; 0 disables. Defaults to 30s for GET. */
  cacheTtl?: number;
}

// ─── In-flight dedup + short TTL cache for GET requests ─────────────────────
const GET_CACHE_TTL = 30_000;
const inflight = new Map<string, Promise<unknown>>();
const cache = new Map<string, { data: unknown; expiresAt: number }>();

function buildCacheKey(method: string, endpoint: string, token: string | null): string {
  return `${method} ${endpoint}${token ? `#${token}` : ""}`;
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const cacheTtl = options.cacheTtl ?? (method === "GET" ? GET_CACHE_TTL : 0);
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const key = buildCacheKey(method, endpoint, token);

  // Dedup concurrent identical GET requests.
  if (method === "GET") {
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }

  // Serve fresh cache hits without hitting the network.
  if (cacheTtl > 0) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return Promise.resolve(hit.data as T);
    }
  }

  const promise = doRequest<T>(endpoint, options, token).then((data) => {
    if (method === "GET") {
      if (cacheTtl > 0) cache.set(key, { data, expiresAt: Date.now() + cacheTtl });
    } else {
      // Any successful mutation invalidates the read cache.
      cache.clear();
    }
    return data;
  });

  if (method === "GET") {
    inflight.set(key, promise);
    promise.then(
      () => inflight.delete(key),
      () => inflight.delete(key),
    );
  }

  return promise;
}

async function doRequest<T>(
  endpoint: string,
  options: RequestOptions,
  token: string | null,
): Promise<T> {
  const timeout = options.timeout ?? 30000;
  const maxRetries = options.retries ?? 2;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (res.status === 401) {
        // Token expired — guard against redirect loops
        const redirected = typeof window !== "undefined" && sessionStorage.getItem("auth_redirected");
        if (redirected) {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          sessionStorage.removeItem("auth_redirected");
          throw new Error("Authentication required");
        }
        if (typeof window !== "undefined") {
          sessionStorage.setItem("auth_redirected", "1");
          setTimeout(() => { window.location.href = "/login"; }, 100);
        }
        throw new Error("Authentication required");
      }

      if (!res.ok) {
        const error: ApiError = await res
          .json()
          .catch(() => ({ error: `Request failed with status ${res.status}` }));
        throw new Error(error.error || error.message || `HTTP ${res.status}`);
      }

      // Handle empty responses (204 No Content, etc.)
      if (res.status === 204) {
        return {} as T;
      }

      return res.json();
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on auth errors or 4xx
      if (lastError.message === "Authentication required" || (err as TypeError)?.name === "AbortError") {
        break;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error("Request failed");
}

// ─── API Methods ────────────────────────────────────────────────────────────


// ── Conversation Types ────────────────────────────────────────────
export interface Conversation {
  id: string;
  experiment_id?: string;
  title: string;
  model: string;
  agent_mode: string;
  message_count: number;
  total_tokens: number;
  is_archived: boolean;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  tool_calls?: string;
  tool_name?: string;
  tool_results?: string;
  tokens_used: number;
  latency_ms: number;
  created_at: string;
}

// ── Achievement Types ──────────────────────────────────────────────
export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  unlocked: boolean;
  unlocked_at?: string;
}

export const api = {
  // ── Auth ───────────────────────────────────────────────────────────────
  login: (username: string, password: string) =>
    request<{ access_token: string; refresh_token: string; user: User }>(
      "/api/v1/auth/login",
      { method: "POST", body: JSON.stringify({ username, password }) },
    ),

  register: (username: string, email: string, password: string, role: string, fullName?: string) =>
    request<{ access_token: string; refresh_token: string; user: User }>(
      "/api/v1/auth/register",
      { method: "POST", body: JSON.stringify({ username, email, password, full_name: fullName, role }) },
    ),

  getMe: () => request<User>("/api/v1/auth/me"),

  // ── Experiments ────────────────────────────────────────────────────────
  getExperiments: (params?: { category?: string; difficulty?: string; page?: number; page_size?: number }) => {
    const query = new URLSearchParams();
    if (params?.category) query.set("category", params.category);
    if (params?.difficulty) query.set("difficulty", params.difficulty);
    if (params?.page) query.set("page", params.page.toString());
    if (params?.page_size) query.set("page_size", params.page_size.toString());
    return request<PaginatedResponse<Experiment>>(`/api/v1/experiments?${query.toString()}`);
  },

  getExperiment: (id: string) =>
    request<{ experiment: Experiment; test_cases: TestCase[]; can_view_answer: boolean }>(
      `/api/v1/experiments/${id}`,
    ),

  // ── Submissions ────────────────────────────────────────────────────────
  submitCode: (experimentId: string, code: string, language: Language, competitionMode?: "high" | "low") =>
    request<Submission>("/api/v1/submissions", {
      method: "POST",
      body: JSON.stringify({ experiment_id: experimentId, code, language, competition_mode: competitionMode ?? "high" }),
    }),

  getSubmission: (id: string) => request<Submission>(`/api/v1/submissions/${id}`),

  getSubmissions: (experimentId: string, params?: { page?: number; page_size?: number }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", params.page.toString());
    if (params?.page_size) query.set("page_size", params.page_size.toString());
    return request<PaginatedResponse<Submission>>(
      `/api/v1/experiments/${experimentId}/submissions?${query.toString()}`,
    );
  },

  getAllSubmissions: (params?: {
    course_id?: string; experiment_id?: string; student_id?: string;
    page?: number; page_size?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.course_id) query.set("course_id", params.course_id);
    if (params?.experiment_id) query.set("experiment_id", params.experiment_id);
    if (params?.student_id) query.set("student_id", params.student_id);
    if (params?.page) query.set("page", params.page.toString());
    if (params?.page_size) query.set("page_size", params.page_size.toString());
    return request<PaginatedResponse<SubmissionWithStudent>>(
      `/api/v1/submissions?${query.toString()}`,
    );
  },

  // ── Traces ─────────────────────────────────────────────────────────────
  getSubmissionTraces: (submissionId: string, params?: { limit?: number; errors_only?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.errors_only) query.set("errors_only", "true");
    return request<{ submission_id: string; traces: SyscallTrace[] }>(
      `/api/v1/submissions/${submissionId}/traces?${query.toString()}`,
    );
  },

  // ── AI Diagnosis ──────────────────────────────────────────────────────
  requestDiagnosis: (submissionId: string, experimentId: string, studentId: string) =>
    request<DiagnosisResult>("/api/ai/diagnose", {
      method: "POST",
      body: JSON.stringify({ submission_id: submissionId, experiment_id: experimentId, student_id: studentId }),
    }),

  getDiagnosis: (diagnosisId: string) => request<DiagnosisResult>(`/api/ai/diagnose/${diagnosisId}`),

  listDiagnoses: (submissionId: string) =>
    request<DiagnosisResult[]>(`/api/ai/diagnose?submission_id=${encodeURIComponent(submissionId)}`),


  // ── Harness Report ──────────────────────────────────────────────
  getHarnessReport: (reportId: string) =>
    fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/ai/diagnose/reports/${reportId}`)
      .then(r => r.json()),

  listHarnessReports: (submissionId: string) =>
    fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/ai/diagnose/reports?submission_id=${encodeURIComponent(submissionId)}`)
      .then(r => r.json()),
  getHint: (diagnosisId: string, level: number) =>
    request<{ level: number; hint: string; explanation: string }>(`/api/ai/hints/${diagnosisId}/${level}`),

  aiChat: (experimentId: string, question: string, code: string, language: string, history?: unknown[]) =>
    request<{ reply: string; created_at: string }>(`/api/v1/experiments/${experimentId}/ai-chat`, {
      method: "POST",
      body: JSON.stringify({ question, code, language, history }),
    }),

  // ── Comments ──────────────────────────────────────────────────────────
  getComments: (experimentId: string, page?: number) => {
    const query = new URLSearchParams();
    if (page) query.set("page", page.toString());
    return request<PaginatedResponse<Comment>>(
      `/api/v1/experiments/${experimentId}/comments?${query.toString()}`,
    );
  },

  createComment: (experimentId: string, content: string, parentId?: string) =>
    request<Comment>(`/api/v1/experiments/${experimentId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content, parent_id: parentId }),
    }),

  updateComment: (commentId: string, content: string) =>
    request<Comment>(`/api/v1/comments/${commentId}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  deleteComment: (commentId: string) =>
    request<void>(`/api/v1/comments/${commentId}`, { method: "DELETE" }),

  togglePinComment: (commentId: string) =>
    request<Comment>(`/api/v1/comments/${commentId}/pin`, { method: "PUT" }),

  aiAskComment: (experimentId: string, question: string, parentId?: string) =>
    request<{ user_comment: Comment; ai_comment?: Comment; ai_error?: string }>(
      `/api/v1/experiments/${experimentId}/comments/ai-ask`,
      { method: "POST", body: JSON.stringify({ question, parent_id: parentId }) },
    ),

  // ── Progress ──────────────────────────────────────────────────────────
  getProgress: (experimentId: string) => request<unknown>(`/api/v1/progress/${experimentId}`),
  getMyProgress: () => request<{ data: unknown[] }>("/api/v1/progress"),
  getCourseProgress: (courseId: string) => request<{ data: unknown[] }>(`/api/v1/progress/course/${courseId}`),

  // ── Teacher Dashboard ────────────────────────────────────────────────
  getTeacherOverview: () => request<TeacherOverview>("/api/v1/teacher/stats/overview"),
  getTeacherDashboard: () => request<TeacherDashboard>("/api/v1/teacher/dashboard"),
  getTeacherErrors: (days?: number, limit?: number) => {
    const query = new URLSearchParams();
    if (days) query.set("days", days.toString());
    if (limit) query.set("limit", limit.toString());
    return request<unknown>(`/api/v1/teacher/stats/errors?${query.toString()}`);
  },
  getTeacherHeatmap: () => request<unknown>("/api/v1/teacher/stats/heatmap"),
  getTeacherCommonIssues: () => request<unknown>("/api/v1/teacher/stats/common-issues"),
  getTeacherStudents: (page?: number, pageSize?: number) => {
    const query = new URLSearchParams();
    if (page) query.set("page", page.toString());
    if (pageSize) query.set("page_size", pageSize.toString());
    return request<PaginatedResponse<User & { total_submissions: number; avg_score: number }>>(
      `/api/v1/teacher/students?${query.toString()}`,
    );
  },
  getTeacherStudentDetail: (id: string) => request<unknown>(`/api/v1/teacher/students/${id}`),
  getTeacherAIAnalysis: () => request<unknown>("/api/v1/teacher/ai-analysis"),
  getTeacherExportUrl: () => `${API_BASE}/api/v1/teacher/export`,

  // ── Courses ───────────────────────────────────────────────────────────
  getMyCourses: () => request<PaginatedResponse<Course>>("/api/v1/courses"),
  createCourse: (name: string, description: string) =>
    request<Course>("/api/v1/courses", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  getCourseExperiments: (courseId: string) =>
    request<PaginatedResponse<Experiment>>(`/api/v1/courses/${courseId}/experiments`),
  getCourseStudents: (courseId: string) =>
    request<{ students: User[] }>(`/api/v1/courses/${courseId}/students`),
  joinByInviteCode: (code: string) =>
    request<{ course: Course }>("/api/v1/courses/join", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  createInviteCode: (courseId: string, maxUses?: number) =>
    request<unknown>(`/api/v1/courses/${courseId}/invite-codes`, {
      method: "POST",
      body: JSON.stringify({ course_id: courseId, max_uses: maxUses || 0 }),
    }),
  getInviteCodes: (courseId: string) =>
    request<{ invite_codes: InviteCode[] }>(`/api/v1/courses/${courseId}/invite-codes`),
  disableInviteCode: (codeId: string) =>
    request<unknown>(`/api/v1/courses/invite-codes/${codeId}/disable`, { method: "PUT" }),
  removeStudentFromCourse: (courseId: string, studentId: string) =>
    request<unknown>(`/api/v1/courses/${courseId}/students/${studentId}`, { method: "DELETE" }),

  // ── Admin ─────────────────────────────────────────────────────────────
  getAdminOverview: () => request<AdminOverview>("/api/v1/admin/db/overview"),
  getAdminSubmissionQueue: (params?: { stuck_minutes?: number; page?: number }) => {
    const query = new URLSearchParams();
    if (params?.stuck_minutes) query.set("stuck_minutes", params.stuck_minutes.toString());
    if (params?.page) query.set("page", params.page.toString());
    return request<unknown>(`/api/v1/admin/submissions/queue?${query.toString()}`);
  },
  batchResetSubmissions: (submissionIds: string[], targetStatus: string) =>
    request<unknown>("/api/v1/admin/submissions/reset", {
      method: "POST",
      body: JSON.stringify({ submission_ids: submissionIds, target_status: targetStatus }),
    }),
  getAdminExperimentConfigs: (params?: { category?: string }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    const q = qs.toString();
    return request<unknown>(`/api/v1/admin/experiments/config${q ? "?" + q : ""}`);
  },
  getAdminTestCases: (experimentId: string) =>
    request<unknown>(`/api/v1/admin/experiments/${experimentId}/test-cases`),
  getAdminLogs: (params?: {
    page?: number; page_size?: number; user_id?: string; action?: string;
    resource_type?: string; date_from?: string; date_to?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", params.page.toString());
    if (params?.page_size) query.set("page_size", params.page_size.toString());
    if (params?.user_id) query.set("user_id", params.user_id);
    if (params?.action) query.set("action", params.action);
    if (params?.resource_type) query.set("resource_type", params.resource_type);
    if (params?.date_from) query.set("date_from", params.date_from);
    if (params?.date_to) query.set("date_to", params.date_to);
    return request<PaginatedResponse<unknown>>(`/api/v1/admin/logs?${query.toString()}`);
  },
  // ── Admin User Management ─────────────────────────────────────────────
  listAdminUsers: (params?: { page?: number; page_size?: number; role?: string; class?: string; q?: string; is_active?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", params.page.toString());
    if (params?.page_size) query.set("page_size", params.page_size.toString());
    if (params?.role) query.set("role", params.role);
    if (params?.class) query.set("class", params.class);
    if (params?.q) query.set("q", params.q);
    if (params?.is_active !== undefined) query.set("is_active", String(params.is_active));
    const q = query.toString();
    return request<PaginatedResponse<AdminUserItem>>(`/api/v1/admin/users${q ? "?" + q : ""}`);
  },
  createAdminUser: (payload: {
    username: string; email: string; password?: string; full_name?: string;
    role: "student" | "teacher" | "admin"; student_no?: string; class_name?: string; teaching_classes?: string[];
  }) => request<{ user: AdminUserItem; initial_password: string; generated: boolean; message: string }>(
    "/api/v1/admin/users", { method: "POST", body: JSON.stringify(payload) },
  ),
  updateAdminUser: (id: string, payload: {
    email?: string; full_name?: string; role?: string; student_no?: string; class_name?: string; teaching_classes?: string[];
  }) => request<{ id: string; updated: boolean }>(`/api/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  resetAdminUserPassword: (id: string, password: string) =>
    request<{ id: string; reset: boolean }>(`/api/v1/admin/users/${id}/password`, { method: "PUT", body: JSON.stringify({ password }) }),
  setAdminUserStatus: (id: string, is_active: boolean) =>
    request<{ id: string; is_active: boolean }>(`/api/v1/admin/users/${id}/status`, { method: "PUT", body: JSON.stringify({ is_active }) }),
  deleteAdminUser: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/api/v1/admin/users/${id}`, { method: "DELETE" }),

  // ── Teacher Student Self-Service (scoped to own classes) ─────────────
  listMyStudents: (params?: { page?: number; page_size?: number; q?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", params.page.toString());
    if (params?.page_size) query.set("page_size", params.page_size.toString());
    if (params?.q) query.set("q", params.q);
    return request<PaginatedResponse<AdminUserItem>>(`/api/v1/teacher/students?${query.toString()}`);
  },
  resetMyStudentPassword: (id: string, password: string) =>
    request<{ id: string; reset: boolean }>(`/api/v1/teacher/students/${id}/password`, { method: "PUT", body: JSON.stringify({ password }) }),

  // ── Flame Graph ──────────────────────────────────────────────────────
  generateFlameGraph: (submissionId: string, duration?: number) => {
    const qs = duration ? `?duration=${duration}` : "";
    return request<FlameGraphResult>(`/api/v1/submissions/${submissionId}/flamegraph${qs}`, { method: "POST" });
  },
  getFlameGraph: (submissionId: string) =>
    request<FlameGraphResult>(`/api/v1/submissions/${submissionId}/flamegraph`),
  getFlameGraphDiff: (submissionId: string, baselineId: string) =>
    request<{
      submission_id: string;
      baseline_id: string;
      current_duration: number;
      baseline_duration: number;
      func_diffs: Array<{
        name: string;
        current_percent: number;
        baseline_percent: number;
        delta: number;
        improved: boolean;
      }>;
      user_percent_delta: number;
      kernel_percent_delta: number;
      current_user_percent: number;
      baseline_user_percent: number;
      current_kernel_percent: number;
      baseline_kernel_percent: number;
      current_elapsed_sec: number;
      baseline_elapsed_sec: number;
      status?: string;
      hint?: string;
    }>(`/api/v1/submissions/${submissionId}/flamegraph/diff?baseline=${baselineId}`),

  // ── AI Flame Graph Analysis ──────────────────────────────────────────
  analyzeFlameGraph: (data: {
    submission_id: string;
    code: string;
    language: string;
    hot_functions: Array<{ name: string; percent: number; module: string }>;
    user_percent: number;
    kernel_percent: number;
    elapsed_sec: number;
  }) => request<{
    plain_summary: string;
    top_hotspots: Array<{ function: string; what_it_means: string; optimization_tip: string }>;
    issues: Array<{ severity: string; title: string; explanation: string; suggestion: string }>;
    kernel_insight: string;
    raw_error?: string;
  }>("/api/ai/flamegraph/analyze", { method: "POST", body: JSON.stringify(data) }),

  // ── AI eBPF Analysis ─────────────────────────────────────────────────
  analyzeEBPF: (data: {
    submission_id: string;
    code: string;
    language: string;
    total_calls: number;
    unique_syscalls: number;
    error_count: number;
    top_syscalls: Array<{ name: string; count: number; percent: number }>;
    error_syscalls: Array<{ name: string; error: string; count: number }>;
    execution_time_ms: number;
  }) => request<{
    plain_summary: string;
    syscall_explanations: Array<{ name: string; plain_meaning: string; why_program_uses_it: string }>;
    error_explanations: Array<{ syscall: string; error: string; plain_reason: string; fix_hint: string }>;
    patterns: Array<{ type: string; explanation: string }>;
    raw_error?: string;
  }>("/api/ai/ebpf/analyze", { method: "POST", body: JSON.stringify(data) }),

  // ── AI Deadlock Analysis ─────────────────────────────────────────────
  analyzeDeadlock: (data: {
    submission_id: string;
    code: string;
    language: string;
    detected: boolean;
    cycle: number[];
    details: string[];
    fix: string;
    threads: number[];
    locks: Array<{ uaddr: string; holder: number | null; waiters: number[] }>;
    experiment_title?: string;
    experiment_category?: string;
  }) => request<{
    plain_summary: string;
    detected: boolean;
    coffman_conditions: Array<{ name: string; satisfied: boolean; evidence: string }>;
    root_cause: string;
    fix_suggestion: string;
    socratic_hint: string;
    severity: string;
    raw_error?: string;
  }>("/api/ai/deadlock/analyze", { method: "POST", body: JSON.stringify(data) }),

  // ── AI Trace Analysis ──────────────────────────────────────────────
  analyzeTrace: (data: TraceAnalysisRequest) =>
    request<TraceAnalysisResponse>("/api/ai/trace/analyze", { method: "POST", body: JSON.stringify(data) }),

  // ── Memory Layout ────────────────────────────────────────────────────
  getMemoryLayout: (submissionId: string) =>
    request<MemoryLayoutResponse>(`/api/obs/analysis/memory-layout/${submissionId}`),

  // eBPF / Observability APIs
  getSyscallTraces: (submissionId: string) =>
    request<{ submission_id: string; summary: any; traces: any[] }>(
      `/api/obs/traces/${submissionId}`
    ),
  getObsMetrics: (submissionId: string) =>
    request<{ submission_id: string; metrics: any; total: number }>(
      `/api/obs/metrics/${submissionId}`
    ),
  getObsResources: (submissionId: string) =>
    request<{ submission_id: string; resources: any }>(
      `/api/obs/resources/${submissionId}`
    ),

  // ── ObsContext (Go backend aggregation) ──────────────────────────
  getObsContext: (submissionId: string) =>
    request<{
      submission_id: string;
      experiment_id: string;
      student_id: string;
      obs_context: any;
      trace_count: number;
      composite_trigger: {
        should_trigger: boolean;
        active_signals: string[];
        signal_states: Record<string, { category: string; current_value: number; is_anomalous: boolean; last_updated: string }>;
        trigger_reason: string;
        confidence: number;
        evaluated_at: string;
      };
      cross_module_links: Array<{
        key: { timestamp: string; pid: number; tid: number; event_type: string };
        syscall_event?: any;
        lock_event?: any;
        memory_snapshot?: any;
        perf_event?: any;
        annotation?: any;
        flamegraph_highlight?: string;
        memory_3d_region?: { segment: string; start_addr: number; size: number; highlight: boolean; color?: string; label?: string };
        timeline_label?: string;
      }>;
      calibrated_timeline: {
        start: string;
        end: string;
        duration: number;
        num_events: number;
      };
    }>(`/api/v1/submissions/${submissionId}/obs-context`),

  // ── Semantic Analysis (Go backend) ────────────────────────────
  getSemanticAnalysis: (submissionId: string) =>
    request<{
      submission_id: string;
      experiment_id: string;
      student_id: string;
      trace_count: number;
      pattern_count: number;
      patterns: Array<{
        pattern_name: string;
        label: string;
        category: string;
        category_icon: string;
        os_concept: string;
        severity: string;
        teaching_note: string;
        start_index: number;
        end_index: number;
      }>;
      classifications: Array<{
        index: number;
        syscall: string;
        label: string;
        concept: string;
        severity: string;
        error: string;
        pid: number;
        ret: number;
      }>;
    }>(`/api/v1/submissions/${submissionId}/semantic/analyze`),

  classifySyscall: (submissionId: string, syscall: string) =>
    request<{
      syscall: string;
      label: string;
      concept: string;
      severity: string;
      teaching_note: string;
      has_match: boolean;
    }>(`/api/v1/submissions/${submissionId}/semantic/classify?syscall=${encodeURIComponent(syscall)}`),

  // ── Span Tree ──────────────────────────────────────────────────
  getSpanTree: (submissionId: string) =>
    request<{
      submission_id: string;
      experiment_id: string;
      trace_count: number;
      node_count: number;
      max_depth: number;
      span_tree: any;
    }>(`/api/v1/submissions/${submissionId}/span-tree`),

  // ── Risk Indicators ────────────────────────────────────────────
  getRiskIndicators: (submissionId: string) =>
    request<{
      submission_id: string;
      experiment_id: string;
      trace_count: number;
      risk_indicators: {
        health_score: number;
        saturation_index: number;
        dependency_risk: number;
        backlog_growth: number;
        oom_risk_rate: number;
        cpu_saturation_pct: number;
        mem_saturation_pct: number;
        fd_saturation_pct: number;
        health_level: string;
        trend_direction: string;
      };
      anomaly_alerts: Array<{
        rule: string;
        condition: string;
        probability: number;
        severity: string;
        message: string;
        teaching_hint: string;
      }>;
      derived_metrics: {
        cpu_pct: number;
        mem_pct: number;
        conn_pct: number;
        fd_pct: number;
        syscall_err_rate: number;
        io_latency_spike: number;
        backlog_growth: number;
      };
    }>(`/api/v1/submissions/${submissionId}/risk-indicators`),

  // ── Sandbox Metrics ─────────────────────────────────────────────
  getSandboxMetrics: (submissionId: string) =>
    request<{
      submission_id: string;
      experiment_id: string;
      cpu_percent: number;
      mem_percent: number;
      mem_rss_mb: number;
      mem_limit_mb: number;
      mem_oom_risk: number;
      mem_oom_events: number;
      io_read_bytes: number;
      io_write_bytes: number;
      fd_count: number;
      fd_soft_limit: number;
      thread_count: number;
      thread_running: number;
      thread_sleeping: number;
      page_faults_minor: number;
      page_faults_major: number;
      context_switches: number;
      cfs_throttled_ms: number;
      io_wait_percent: number;
      mem_working_set_bytes: number;
      mem_limit_bytes: number;
      duration_sec: number;
      trace_count: number;
      trend: string;
      alerts: Array<{
        type: string;
        severity: string;
        message: string;
        current_value: number;
        limit_value?: number;
      }>;
    }>(`/api/v1/submissions/${submissionId}/sandbox-metrics`),

  // ── Teaching Narratives (Supraptive Method) ───────────────────────
  generateTeachingNarrative: (submissionId: string, data: { issue_type: string; params?: Record<string, string> }) =>
    request<{
      submission_id: string;
      narrative: {
        issue_type: string;
        severity: string;
        story_title: string;
        story_html: string;
        progressive_hints: Array<{
          level: number;
          hints: string[];
          os_concept: string;
          experiment_link: string;
          further_reading?: string;
        }>;
        fix_suggestion: string;
        os_concept: string;
        related_panel: string;
      };
    }>(`/api/v1/submissions/${submissionId}/teaching-narrative`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getFollowupQuestions: (submissionId: string, data: { issue_type: string; os_concept?: string }) =>
    request<{
      submission_id: string;
      issue_type: string;
      os_concept: string;
      questions: string[];
    }>(`/api/v1/submissions/${submissionId}/followup-questions`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ── Leak Detection (Valgrind/Heaptrack-style) ────────────────────
  getLeakReport: (submissionId: string) =>
    request<{
      submission_id: string;
      experiment_id: string;
      trace_count: number;
      mem_event_count: number;
      leaks: Array<{
        severity: string;
        address: number;
        size: number;
        alloc_time: string;
        source_file: string;
        source_line: number;
        description: string;
        fix_suggestion: string;
        growth_rate?: number;
      }>;
      heaptrack_summary: {
        total_allocated: number;
        total_freed: number;
        still_allocated: number;
        peak_heap: number;
        peak_time: string;
        alloc_count: number;
        free_count: number;
        alloc_rate_mbps: number;
        free_rate_mbps: number;
        net_growth_mbps: number;
        leak_probability: number;
      };
      heap_history: Array<{
        timestamp: string;
        heap_size: number;
        alloc_count: number;
        free_count: number;
        peak_heap: number;
      }>;
      leak_summary: {
        definitely_lost: number;
        indirectly_lost: number;
        possibly_lost: number;
        still_reachable: number;
        total_leaks: number;
        has_critical: boolean;
      };
    }>(`/api/v1/submissions/${submissionId}/leak-report`),
  // -- Allocation Flame Graph (Heaptrack-style) --------------------
  getAllocFlamegraph: (submissionId: string) =>
    request<{
      submission_id: string;
      experiment_id: string;
      top_allocators: Array<{
        function: string;
        source_file: string;
        source_line: number;
        total_bytes: number;
        alloc_count: number;
        percent: number;
      }>;
      summary: {
        total_allocated: number;
        total_freed: number;
        still_allocated: number;
        peak_heap: number;
        peak_time: string;
        alloc_count: number;
        free_count: number;
        alloc_rate_mbps: number;
        free_rate_mbps: number;
        net_growth_mbps: number;
        leak_probability: number;
      };
      trace_count: number;
      mem_event_count: number;
      generated_at: string;
    }>(`/api/v1/submissions/${submissionId}/alloc-flamegraph`),

  // -- Memory Trend Analysis (Massif-style) ------------------------
  getMemoryTrend: (submissionId: string) =>
    request<{
      submission_id: string;
      experiment_id: string;
      heap_timeline: Array<{
        timestamp: string;
        heap_size: number;
        peak_heap: number;
        alloc_count: number;
        free_count: number;
        alloc_rate_mbps?: number;
        free_rate_mbps?: number;
      }>;
      summary: {
        trend_direction: string;
        growth_rate_mbps: number;
        peak_heap_bytes: number;
        peak_time: string;
        still_allocated: number;
      };
      trace_count: number;
      mem_event_count: number;
      generated_at: string;
    }>(`/api/v1/submissions/${submissionId}/memory-trend`),


  // ── Race Detection (TSan-style) ──────────────────────────────────
  getRaceReport: (submissionId: string) =>
    request<{
      submission_id: string;
      experiment_id: string;
      trace_count: number;
      access_events: number;
      has_races: boolean;
      thread_count: number;
      address_count: number;
      races: Array<{
        address: number;
        thread1: number;
        thread2: number;
        epoch1: number;
        epoch2: number;
        timestamp: string;
        source_line1: number;
        source_file1: string;
        source_line2: number;
        source_file2: string;
        description: string;
        has_hb: boolean;
        teaching_hint: string;
      }>;
      race_summary: {
        total_accesses: number;
        total_races: number;
        unique_addresses: number;
        threads_involved: number[];
        races_per_thread: Record<string, number>;
        unprotected_addrs: number[];
        confidence_score: number;
      };
    }>(`/api/v1/submissions/${submissionId}/race-report`),

  // ── Deadlock Evolution (Coffman conditions) ──────────────────────
  getDeadlockEvolution: (submissionId: string) =>
    request<{
      submission_id: string;
      experiment_id: string;
      trace_count: number;
      lock_step_count: number;
      detected: boolean;
      steps: Array<{
        order: number;
        timestamp: string;
        tid: number;
        action: string;
        lock_addr: number;
        holder_tid: number;
        description: string;
      }>;
      coffman_conditions: Record<string, boolean>;
      cycle_info: string;
      cycle_nodes: number[];
      teaching_narrative: string;
    }>(`/api/v1/submissions/${submissionId}/deadlock-evolution`),


  // ── eBPF ──────────────────────────────────────────────────────────────
  startEbpfObserve: (pid: number, probes: string[], code?: string) =>
    request<EbpfObserveResult>("/api/v1/ebpf/observe", {
      method: "POST",
      body: JSON.stringify({ pid, probes, code }),
    }),
  getEbpfObserve: (pid: number) =>
    request<EbpfObserveResult>(`/api/v1/ebpf/observe/${pid}`),
  getDeadlockReport: (submissionId: string) =>
    request<{
      submission_id: string; detected: boolean; cycle: number[];
      details: string[]; fix: string; lock_graph: any; syscall_counts: Record<string, number>;
      probes: string[]; status: string;
    }>(`/api/v1/ebpf/deadlock/${submissionId}`),
  stopEbpfObserve: (pid: number) =>
    request<void>(`/api/v1/ebpf/observe/${pid}`, { method: "DELETE" }),

  // ── Experiments CRUD ──────────────────────────────────────────────────
  createExperiment: (data: {
    course_id?: string; category: string; name: string; title: string;
    description?: string; instructions?: string; starter_code?: string;
    reference_solution?: string; difficulty?: string; time_limit?: number;
    memory_limit?: number; sandbox_level?: number; max_submissions?: number;
  }) => request<Experiment>("/api/v1/experiments", { method: "POST", body: JSON.stringify(data) }),

  updateExperiment: (id: string, data: Record<string, unknown>) =>
    request<Experiment>(`/api/v1/experiments/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  deleteExperiment: (id: string) =>
    request<{ deleted: boolean }>(`/api/v1/experiments/${id}`, { method: "DELETE" }),

  // ── Test Case CRUD ────────────────────────────────────────────────────
  createTestCase: (data: {
    experiment_id: string; name: string; type?: string; compare_mode?: string;
    input_data?: string; expected_output?: string; is_public?: boolean;
    score_weight?: number; order_index?: number;
  }) => request<TestCase>("/api/v1/test-cases", { method: "POST", body: JSON.stringify(data) }),

  updateTestCase: (id: string, data: Record<string, unknown>) =>
    request<TestCase>(`/api/v1/test-cases/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  deleteTestCase: (id: string) =>
    request<{ deleted: boolean }>(`/api/v1/test-cases/${id}`, { method: "DELETE" }),


  // ── Reports ───────────────────────────────────────────────────────────
  submitReport: (submissionId: string, data: { content: string; file_url?: string }) =>
    request<unknown>(`/api/v1/submissions/${submissionId}/report`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getReport: (submissionId: string) =>
    request<unknown>(`/api/v1/submissions/${submissionId}/report`),
  gradeReport: (reportId: string, data: { score: number; feedback: string }) =>
    request<unknown>(`/api/v1/reports/${reportId}/grade`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // ── Adaptive Difficulty ──────────────────────────────────────────────
  getAdaptiveProfile: () =>
    request<AdaptiveProfile>("/api/v1/adaptive/profile"),

  getExperimentVariant: (experimentId: string) =>
    request<VariantAssignment>(`/api/v1/experiments/${experimentId}/variant`),

  // ── Code Audit ───────────────────────────────────────────────────────
  auditCode: (data: { code: string; language: string; experiment_id: string; submission_id: string }) =>
    request<CodeAuditResult>("/api/v1/code-audit", { method: "POST", body: JSON.stringify(data) }),

  getCodeAudit: (submissionId: string) =>
    request<CodeAuditResult>(`/api/v1/code-audit/${submissionId}`),

  // ── Workspace Drafts ───────────────────────────────────────────────
  getDraft: (experimentId: string) =>
    request<{ code: string; language: string; has_draft: boolean; updated_at?: string }>(
      `/api/v1/experiments/${experimentId}/draft`
    ),
  saveDraft: (experimentId: string, data: { code: string; language: string; cursor_line?: number; cursor_col?: number; selected_tab?: string; pinned_tools?: string[] }) =>
    request<{ saved: boolean }>(`/api/v1/experiments/${experimentId}/draft`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteDraft: (experimentId: string) =>
    request<{ deleted: boolean }>(`/api/v1/experiments/${experimentId}/draft`, {
      method: "DELETE",
    }),

  // ── Conversations ──────────────────────────────────────────────────
  listConversations: (experimentId?: string) => {
    const qs = experimentId ? `?experiment_id=${experimentId}` : "";
    return request<{ conversations: Conversation[] }>(`/api/v1/conversations${qs}`);
  },
  createConversation: (data: { title: string; experiment_id?: string; agent_mode?: string }) =>
    request<Conversation>("/api/v1/conversations", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateConversation: (id: string, data: { title?: string; is_archived?: boolean; is_pinned?: boolean }) =>
    request<{ updated: boolean }>(`/api/v1/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteConversation: (id: string) =>
    request<{ deleted: boolean }>(`/api/v1/conversations/${id}`, { method: "DELETE" }),
  getMessages: (conversationId: string) =>
    request<{ messages: ConversationMessage[] }>(`/api/v1/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, data: { content: string; code?: string; language?: string; agent_mode?: string; use_rag?: boolean }) =>
    request<{ reply: string }>(`/api/v1/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ── Experiment Cache (memory feature) ──────────────────────────────
  getExperimentCache: (experimentId: string) =>
    request<{ caches: Record<string, { data: any; submission_id: string; created_at: string; expires_at: string }> }>(
      `/api/v1/experiments/${experimentId}/cache`
    ),

  saveExperimentCache: (experimentId: string, data: { cache_type: string; submission_id: string; data: unknown }) =>
    request<{ saved: boolean }>(`/api/v1/experiments/${experimentId}/cache`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteExperimentCache: (experimentId: string) =>
    request<{ deleted: boolean }>(`/api/v1/experiments/${experimentId}/cache`, {
      method: "DELETE",
    }),

  // ── Achievements ─────────────────────────────────────────────────
  listAchievements: () =>
    request<{ achievements: Achievement[]; unlocked_count: number; total: number }>(
      "/api/v1/achievements",
    ),

  evaluateAchievements: () =>
    request<{ newly_unlocked: Achievement[] }>("/api/v1/achievements/evaluate", {
      method: "POST",
    }),
};