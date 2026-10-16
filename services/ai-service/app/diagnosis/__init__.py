"""TraceOS 诊断侧 — 多 Agent 诊断 (无评分).

职责: 消费 evaluation.completed 事件, 用确定性 Planner + 并行诊断 Agent
把 Core 评测的观测事实翻译成学生可理解的教学建议。

红线: AI 不碰评分。Core 是分数唯一真值 (is_qualified / core_score / edge_score)。
诊断只产出诊断结论 + 教学建议 + 置信度, 不产出 total_score / six_dim_scores。
"""

from app.diagnosis.context_package import ContextPackage, DataCollector
from app.diagnosis.deterministic import (
    Observations,
    extract_observations,
    derive_severity,
)
from app.diagnosis.governance import (
    InputGuardResult, OutputGuardResult, DegradationDecision, DegradationLevel,
    check_code_injection, check_answer_leak, check_hallucination,
    decide_degradation, apply_template,
    register_ratchet_rule, get_active_ratchet_rules,
)
from app.diagnosis.observability import (
    trace_agent_call, trace_llm_call, trace_tool_call, trace_diagnosis,
    CostTracker, CostTracker as TokenTracker,
)
from app.diagnosis.evaluation_guard import (
    GuardResult, EvaluationGuard, SafetyFilter,
    CalibrationMonitor, FallbackChain,
)
from app.diagnosis.orchestrator import DiagnosisOrchestrator
from app.diagnosis.fallback import run_diagnosis_with_fallback, get_orchestrator
from app.diagnosis.agents.report_generator import DiagnosisReport, ReportGeneratorAgent

__all__ = [
    # Context
    "ContextPackage", "DataCollector",
    # 观测事实 (非分数)
    "Observations", "extract_observations", "derive_severity",
    # Governance
    "InputGuardResult", "OutputGuardResult", "DegradationDecision", "DegradationLevel",
    "check_code_injection", "check_answer_leak", "check_hallucination",
    "decide_degradation", "apply_template",
    "register_ratchet_rule", "get_active_ratchet_rules",
    # Observability
    "trace_agent_call", "trace_llm_call", "trace_tool_call", "trace_diagnosis",
    "CostTracker", "TokenTracker",
    # Verification
    "GuardResult", "EvaluationGuard", "SafetyFilter",
    "CalibrationMonitor", "FallbackChain",
    # Lifecycle
    "DiagnosisOrchestrator", "run_diagnosis_with_fallback", "get_orchestrator",
    "DiagnosisReport", "ReportGeneratorAgent",
]