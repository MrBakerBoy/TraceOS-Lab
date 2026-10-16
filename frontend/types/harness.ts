// Harness Report Types — TraceOS Multi-Agent Diagnosis
// 对齐后端 DiagnosisReportModel：AI 诊断只产出结论+建议+置信度，不产出分数。
// 分数真值（is_qualified / core_score / edge_score）由 Core NewScore 唯一产出并透传。

export interface AgentResultInfo {
  agent_name: string;
  status: string;
  confidence: number;
  tokens_used: number;
  execution_ms: number;
  findings_summary: string[];
}

export interface SuggestedFixV2 {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  evidence: string;
  source?: string;
  source_label?: string;
  source_kind?: string;
}

export interface HarnessDiagnosisReport {
  report_id: string;
  submission_id: string;
  student_id: string;
  experiment_id: string;
  experiment_category: string;
  status: string;
  trace_id?: string;

  // Core 唯一真值 (透传, 非 AI 产出)
  is_qualified: boolean;
  core_score: number;
  edge_score: number;
  severity: string;

  // 确定性观测事实 (AI 诊断输入证据)
  observations: Record<string, unknown>;

  // 诊断内容
  summary: string;
  strength_points: string[];
  weakness_points: string[];
  related_concepts: string[];
  related_syscalls: string[];
  suggested_fixes: SuggestedFixV2[];
  feedback_levels: Record<string, string>;

  // 可视化 (仅概念达成度, 非分数)
  concept_radar: Record<string, number>;

  // 校验元数据
  confidence: number;
  agent_agreement: number;
  requires_review: boolean;
  review_reason: string;

  // 成本
  llm_model?: string;
  llm_tokens_used: number;

  // Agent 摘要
  agent_results: AgentResultInfo[];

  // 降级
  degraded: boolean;
  degradation_reason: string;

  // 时间戳
  created_at: string;
  completed_at?: string;
}

export interface HarnessReportSummary {
  report_id: string;
  submission_id: string;
  experiment_id: string;
  is_qualified: boolean;
  confidence: number;
  status: string;
  requires_review: boolean;
  created_at: string;
}