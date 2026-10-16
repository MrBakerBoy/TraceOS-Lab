export type TabType =
  | "topic"
  | "requirements"
  | "answer"
  | "records"
  | `submission-${string}`
  | "comments"
  | "ai-analysis"
  | `flamegraph-${string}`
  | `memorymap-${string}`
  | "traces"
  | "report";

export interface CodeTemplate {
  id: string;
  experiment_id: string;
  language: string;
  starter_code?: string;
  reference_solution?: string;
  is_published: boolean;
}

export interface Experiment {
  id: string;
  title: string;
  category: string;
  description?: string;
  instructions?: string;
  starter_code?: string;
  reference_solution?: string;
  answer_explanation?: string;
  difficulty: string;
  templates?: CodeTemplate[];
}

export interface TestCase {
  id: string;
  name: string;
  type: "core" | "edge" | "performance" | "security";
  is_public: boolean;
}

export type AssertionCategory =
  | "exit_code"
  | "output"
  | "syscall"
  | "behavior"
  | "numeric";

export interface AssertionDetail {
  category: AssertionCategory;
  passed: boolean;
  detail: string;
}

export interface TestPoint {
  id: string;
  name: string;
  type: "core" | "edge";
  passed: boolean;
  weight: number;
  fail_reason?: string;
  exec_time_ms: number;
  runtime_error?: string;
  actual_output?: string;
  expected_output?: string;
  assertions?: AssertionDetail[];
  details?: Record<string, unknown>;
}

export interface ChecklistItem {
  key: string;
  label: string;
  status: "passed" | "failed" | "unknown";
  detail?: string;
}

export interface Submission {
  id: string;
  submission_number: number;
  status: string;
  score?: number;
  total_score?: number;
  core_score?: number;
  edge_score?: number;
  is_qualified?: boolean;
  competition_mode?: string;
  checklist?: ChecklistItem[];
  test_points?: TestPoint[];
  passed_test_cases: number;
  total_test_cases: number;
  compile_error?: string;
  runtime_error?: string;
  execution_time?: number;
  created_at: string;
  code?: string;
  language?: string;
  student_name?: string;
  student_username?: string;
}

export interface Comment {
  id: string;
  experiment_id: string;
  user_id: string;
  parent_id?: string | null;
  content: string;
  is_pinned: boolean;
  is_ai: boolean;
  created_at: string;
  updated_at?: string;
  user?: {
    id: string;
    username: string;
    full_name?: string;
    role: string;
  };
  replies?: Comment[];
}

export interface DiagnosisResult {
  diagnosis_id: string;
  submission_id: string;
  student_id: string;
  status: string;
  error_type?: string;
  severity?: string;
  root_cause?: string;
  feedback: {
    level_1: string;
    level_2: string;
    level_3: string;
    level_4: string;
  };
  related_concepts: Array<{
    name: string;
    description: string;
    type: string;
  }>;
  related_syscalls: Array<{
    name: string;
    description: string;
    error_code?: string;
  }>;
  suggested_fixes: Array<{
    title: string;
    description: string;
    code_snippet?: string;
    explanation?: string;
  }>;
  confidence_score: number;
  diagnosis_harness_id?: string;
  has_harness_report?: boolean;
  evidence_links?: Array<{
    id: string;
    label: string;
    panel: string;
    timestamp_ms: number;
    highlight_key: string;
    description: string;
    severity: string;
    source_file?: string;
    source_line?: number;
  }>;
}

export interface EvalResult {
  status: string;
  score?: number;
  total_score?: number;
  core_score?: number;
  edge_score?: number;
  is_qualified?: boolean;
  competition_mode?: string;
  checklist?: ChecklistItem[];
  test_points?: TestPoint[];
  passed_test_cases: number;
  total_test_cases: number;
  pass_rate?: number;
  compile_error?: string;
  runtime_error?: string;
  execution_time?: number;
  memory_usage?: number;
}

export interface HarnessData {
  intent?: string;
  intent_confidence?: number;
  watermark?: "normal" | "micro" | "slide" | "summary" | "emergency";
  utilization_pct?: number;
  eval_score?: number | null;
  guards_passed?: boolean;
  guards_blocked_reason?: string;
  diagnosis?: { error_type?: string; root_cause?: string; related_concepts?: string[]; severity?: string };
  tutoring?: { l1_direction?: string; l2_strategy?: string; l3_insight?: string; follow_up_question?: string };
  related_concepts?: string[];
}

export interface AIMessage {
  role: "user" | "ai";
  content: string;
  harness?: HarnessData;
}

// ── Concurrency & Scheduling Types ──

export interface RaceReport {
  id: string;
  address: string;
  thread1: number;
  thread2: number;
  epoch1: number;
  epoch2: number;
  sourceLine1: number;
  sourceLine2: number;
  timestamp: string;
  description: string;
}

export interface SchedEvent {
  timestamp: string;
  cpu: number;
  prevThread: number;
  nextThread: number;
  reason: "timeslice" | "blocked" | "preempt";
  durationMs: number;
  label?: string;
}
