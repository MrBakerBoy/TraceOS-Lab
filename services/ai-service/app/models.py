"""TraceOS Lab AI Service - Pydantic Models"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class DiagnosisStatus(str, Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    failed = "failed"


class Severity(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class RequestDiagnosisRequest(BaseModel):
    submission_id: str
    experiment_id: str
    student_id: str
    enable_code_review: bool = True
    enable_trace_analysis: bool = True
    enable_knowledge_graph: bool = False


class RequestDiagnosisResponse(BaseModel):
    diagnosis_id: str
    status: str = "pending"
    estimated_time_seconds: int = 10
    created_at: datetime


class Feedback(BaseModel):
    level_1: str = ""
    level_2: str = ""
    level_3: str = ""
    level_4: str = ""


class Concept(BaseModel):
    name: str
    description: str
    type: str = "concept"
    difficulty: Optional[str] = None


class SyscallInfo(BaseModel):
    name: str
    description: str
    error_code: Optional[str] = None
    syscall_number: Optional[int] = None


class SuggestedFix(BaseModel):
    title: str
    description: str
    code_snippet: str = ""
    explanation: Optional[str] = None
    source: str = ""
    source_label: str = ""
    source_kind: str = ""


class DiagnosisResult(BaseModel):
    diagnosis_id: str
    submission_id: str
    student_id: str
    status: str
    error_type: Optional[str] = None
    severity: Optional[str] = None
    root_cause: Optional[str] = None
    feedback: Feedback = Field(default_factory=Feedback)
    related_concepts: list[Concept] = Field(default_factory=list)
    related_syscalls: list[SyscallInfo] = Field(default_factory=list)
    suggested_fixes: list[SuggestedFix] = Field(default_factory=list)
    confidence_score: float = 0.0
    llm_model: Optional[str] = None
    llm_tokens_used: Optional[int] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    # === Harness report bridge ===
    diagnosis_harness_id: Optional[str] = None
    has_harness_report: bool = False

class DiagnosisProgress(BaseModel):
    """SSE 诊断进度推送"""
    diagnosis_id: str
    status: str
    stage: str
    agent_name: str
    progress: int  # 0-100
    message: str
    timestamp: datetime


class AgentConfig(BaseModel):
    name: str
    description: str
    default_model: str = "mock"
    max_tokens: int = 2048
    temperature: float = 0.7
    system_prompt: dict[str, str] = Field(default_factory=dict)
    tools: list[dict] = Field(default_factory=list)


class HintResponse(BaseModel):
    hint: str
    explanation: str
    related_concepts: list[Concept] = Field(default_factory=list)
    code_locations: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str = "healthy"
    service: str = "ai-service"
    mode: str = "mock"
    uptime_seconds: float
    timestamp: datetime


# ============================================================================
# 多 Agent 诊断 Harness 模型 (Phase 1+2)
# ============================================================================

class AgentResultInfo(BaseModel):
    """单个 Agent 的结果摘要 (API 响应用)."""
    agent_name: str
    status: str
    confidence: float = 0.0
    tokens_used: int = 0
    execution_ms: int = 0
    findings_summary: list[str] = Field(default_factory=list)


class SuggestedFixV2(BaseModel):
    """修复建议 (Enhanced)."""
    title: str
    description: str
    priority: str = "medium"   # high | medium | low
    evidence: str = ""
    source: str = ""
    source_label: str = ""
    source_kind: str = ""


class DiagnosisReportModel(BaseModel):
    """诊断报告 API 响应模型 (无分数)."""
    report_id: str = ""
    submission_id: str
    student_id: str
    experiment_id: str
    experiment_category: str = ""
    status: str = "completed"
    trace_id: str | None = None

    # Core 唯一真值 (透传)
    is_qualified: bool = False
    core_score: float = 0.0
    edge_score: float = 0.0
    severity: str = "medium"

    # 确定性观测事实
    observations: dict = Field(default_factory=dict)

    # 诊断内容
    summary: str = ""
    strength_points: list[str] = Field(default_factory=list)
    weakness_points: list[str] = Field(default_factory=list)
    related_concepts: list[str] = Field(default_factory=list)
    related_syscalls: list[str] = Field(default_factory=list)
    suggested_fixes: list[SuggestedFixV2] = Field(default_factory=list)
    feedback_levels: dict[str, str] = Field(default_factory=dict)

    # 可视化 (仅概念达成度)
    concept_radar: dict[str, float] = Field(default_factory=dict)

    # 校验元数据
    confidence: float = 0.0
    agent_agreement: float = 0.0
    requires_review: bool = False
    review_reason: str = ""

    # 成本
    llm_model: str | None = None
    llm_tokens_used: int = 0

    # Agent 摘要
    agent_results: list[AgentResultInfo] = Field(default_factory=list)

    # 降级
    degraded: bool = False
    degradation_reason: str = ""

    # 时间戳
    created_at: datetime | None = None
    completed_at: datetime | None = None


class DiagnosisReportSummary(BaseModel):
    """诊断报告列表中的摘要项 (无分数)."""
    report_id: str
    submission_id: str
    experiment_id: str
    is_qualified: bool = False
    confidence: float
    status: str
    requires_review: bool = False
    created_at: datetime | None = None
