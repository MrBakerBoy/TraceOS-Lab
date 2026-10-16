"""Context Package — 分层采集 + Context Firewall + Token 预算管理

设计原则 (plan 第四章):
  - 渐进式披露: 按 Agent 阶段逐步展开数据
  - Context Firewall: 每个 Agent 仅接收其领域数据 (最小权限)
  - 40% 窗口利用率硬约束 (Anthropic Context Anxiety 阈值)
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# 128K context window * 40% = 51200 tokens (保守; 4 char/token)
DEFAULT_WINDOW_TOKENS = 128_000
BUDGET_RATIO = 0.40
TARGET_MAX_TOKENS = int(DEFAULT_WINDOW_TOKENS * BUDGET_RATIO)  # 51200
CHARS_PER_TOKEN = 4

# 每个 Agent 的 Context Firewall 切片定义
AGENT_CONTEXT_MAP: dict[str, list[str]] = {
    "code_analyzer": [
        "code", "experiment_meta", "compile_error", "language",
    ],
    "test_evaluator": [
        "code", "experiment_meta", "compile_error", "runtime_error",
        "test_results", "score_breakdown",
    ],
    "syscall_analyzer": [
        "strace_summary", "patterns", "fd_balance", "memory_balance",
        "process_balance", "code",
    ],
    "concept_rubric": [
        "experiment_meta", "score_breakdown",
    ],
    "resource_analyzer": [
        "ebpf_metrics", "code", "experiment_meta",
    ],
    "report_generator": [],  # 不直接用 context slice; 用 Agent 输出
}

# 字段截断上限 (approx chars; 超出则截断为头+尾)
FIELD_LIMITS: dict[str, int] = {
    "code": 12_000,          # ~3K tokens
    "strace_summary": 8_000,
    "patterns": 4_000,
    "test_results": 6_000,
    "compile_error": 2_000,
    "runtime_error": 2_000,
    "experiment_meta": 3_000,
    "score_breakdown": 2_000,
    "fd_balance": 1_500,
    "memory_balance": 1_500,
    "process_balance": 1_500,
    "deductions": 2_000,
    "ebpf_metrics": 8_000,   # 内核观测事实 (resource/syscall/process_thread)
}


def estimate_tokens(text: str | None) -> int:
    """粗略估算 token 数 (≈4 char/token)."""
    if not text:
        return 0
    return max(1, len(text) // CHARS_PER_TOKEN)


def _truncate(text: str, limit: int) -> str:
    """截长字段为 头 + ... + 尾, 保留关键信息."""
    if limit <= 0 or not text:
        return ""
    if len(text) <= limit:
        return text
    head = limit * 3 // 4
    tail = limit - head - 20
    return text[:head] + "\n... [截断] ...\n" + text[-tail:]


@dataclass
class ContextPackage:
    """8 种数据源 + Phase 4 占位字段."""

    submission_id: str = ""
    experiment_id: str = ""
    student_id: str = ""
    experiment_category: str = ""
    experiment_meta: dict[str, Any] = field(default_factory=dict)
    code: str = ""
    language: str = "c"
    compile_error: str = ""
    runtime_error: str = ""
    test_results: list[dict[str, Any]] = field(default_factory=list)
    strace_summary: str = ""
    patterns: list[dict[str, Any]] = field(default_factory=list)
    fd_balance: dict[str, Any] = field(default_factory=dict)
    memory_balance: dict[str, Any] = field(default_factory=dict)
    process_balance: dict[str, Any] = field(default_factory=dict)
    score_breakdown: dict[str, Any] = field(default_factory=dict)
    deductions: list[dict[str, Any]] = field(default_factory=list)
    # 内核观测事实 (由 Core 确定性抽取, 非 AI 产出)
    ebpf_metrics: dict[str, Any] = field(default_factory=dict)

    # --- Context Firewall ------------------------------------------------
    def slice_for(self, agent_name: str) -> dict[str, Any]:
        """按 Agent 角色返回所需的 context slice (最小权限).

        Returns:
            dict: {field: truncated_value, ..., "_budget_exceeded": bool}
        """
        keys = AGENT_CONTEXT_MAP.get(agent_name, [])
        if not keys:
            return {}

        result: dict[str, Any] = {}
        budget_used = 0
        budget_exceeded = False

        for key in keys:
            raw = self._get_raw(key)
            limit = FIELD_LIMITS.get(key, 8_000)

            # list/dict → JSON string
            if isinstance(raw, (list, dict)):
                raw_str = json.dumps(raw, ensure_ascii=False)
            else:
                raw_str = str(raw) if raw else ""

            truncated = _truncate(raw_str, limit) if raw_str else ""
            result[key] = truncated

            budget_used += estimate_tokens(truncated)
            if budget_used > TARGET_MAX_TOKENS and not budget_exceeded:
                budget_exceeded = True
                logger.warning(
                    "Context budget exceeded for agent=%s (used %d > %d tokens)",
                    agent_name, budget_used, TARGET_MAX_TOKENS,
                )
                # 立即截断后续字段
                result[key] = _truncate(result[key] or truncated, limit // 2)

        result["_budget_exceeded"] = budget_exceeded
        result["_agent_name"] = agent_name
        return result

    def _get_raw(self, key: str) -> Any:
        return getattr(self, key, "")


class DataCollector:
    """从 NATS 事件 + core_client 数据组装 ContextPackage."""

    @staticmethod
    def collect(
        event_data: dict[str, Any],
        submission: dict[str, Any],
        experiment: dict[str, Any],
    ) -> ContextPackage:
        """从 EvaluationCompletedEvent + 提交/实验数据组装."""
        strace_raw = event_data.get("strace_summary") or {}

        ctx = ContextPackage(
            submission_id=event_data.get("submission_id", submission.get("id", "")),
            experiment_id=event_data.get("experiment_id", experiment.get("id", "")),
            student_id=event_data.get("student_id", submission.get("student_id", "")),
            experiment_category=experiment.get("category", ""),
            experiment_meta={
                "title": experiment.get("title", ""),
                "description": experiment.get("description", "")[:500],
                "instructions": (experiment.get("instructions") or "")[:2000],
                "category": experiment.get("category", ""),
            },
            code=submission.get("code", ""),
            language=submission.get("language", "c"),
            compile_error=event_data.get("compile_error") or "",
            runtime_error=event_data.get("runtime_error") or "",
            test_results=event_data.get("test_results", []),
            strace_summary=str(strace_raw.get("human_readable", "")),
            patterns=strace_raw.get("patterns", []),
            fd_balance=strace_raw.get("fd_balance") or {},
            memory_balance=strace_raw.get("memory_balance") or {},
            process_balance=strace_raw.get("process_balance") or {},
            score_breakdown={
                "output_score": event_data.get("output_score", 0),
                "structure_score": event_data.get("structure_score", 0),
                "behavior_score": event_data.get("behavior_score", 0),
                "total_score": event_data.get("score", 0),
                "total_max": event_data.get("total_score", 100),
                "passed_cases": event_data.get("passed_cases", 0),
                "total_cases": event_data.get("total_cases", 0),
                "status": event_data.get("status", ""),
                "execution_time": event_data.get("execution_time"),
                # v2 字段
                "is_qualified": event_data.get("is_qualified", False),
                "core_score": event_data.get("core_score", 0),
                "edge_score": event_data.get("edge_score", 0),
                "test_points": event_data.get("test_points", []),
            },
            deductions=event_data.get("deductions", []),
            ebpf_metrics=event_data.get("ebpf_metrics") or {},
        )
        logger.info(
            "ContextPackage collected: submission=%s, category=%s, "
            "test_cases=%d, strace_len=%d",
            ctx.submission_id, ctx.experiment_category,
            len(ctx.test_results), len(ctx.strace_summary),
        )
        return ctx
