"""Agent 基类 — AgentResult + BaseSpecialistAgent

封装 LLM 调用 / JSON 解析 / 异常兜底 / token & 耗时统计。
降级原则: 单个 Agent 失败返回 status=failed, 不崩溃上层 Orchestrator。
"""

from __future__ import annotations

import json
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app.services.tracing import get_tracing_service

logger = logging.getLogger(__name__)


class AgentStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class AgentResult:
    """单个 Agent 的诊断产出."""
    agent_name: str
    status: str = AgentStatus.PENDING.value
    findings: list[dict[str, Any]] = field(default_factory=list)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0
    tokens_used: int = 0
    execution_ms: int = 0
    assembled_prompt: str = ""        # 审计用 (保存完整 prompt)
    error: str | None = None

    @staticmethod
    def success(
        agent_name: str,
        findings: list = None,
        evidence: list = None,
        confidence: float = 0.7,
        tokens_used: int = 0,
        execution_ms: int = 0,
        prompt: str = "",
    ) -> "AgentResult":
        return AgentResult(
            agent_name=agent_name,
            status=AgentStatus.COMPLETED.value,
            findings=findings or [],
            evidence=evidence or [],
            confidence=confidence,
            tokens_used=tokens_used,
            execution_ms=execution_ms,
            assembled_prompt=prompt,
        )

    @staticmethod
    def failed(agent_name: str, error: str, execution_ms: int = 0) -> "AgentResult":
        return AgentResult(
            agent_name=agent_name,
            status=AgentStatus.FAILED.value,
            error=error,
            execution_ms=execution_ms,
            confidence=0.0,
        )

    @staticmethod
    def skipped(agent_name: str, reason: str = "") -> "AgentResult":
        return AgentResult(
            agent_name=agent_name,
            status=AgentStatus.SKIPPED.value,
            error=reason,
        )

    def to_db_dict(self) -> dict:
        return {
            "agent_name": self.agent_name,
            "status": self.status,
            "findings": self.findings,
            "evidence": self.evidence,
            "assembled_prompt": self.assembled_prompt,
            "confidence_score": self.confidence,
            "tokens_used": self.tokens_used,
            "execution_ms": self.execution_ms,
        }


@dataclass
class AgentConfig:
    """每 Agent 可覆盖的配置参数."""
    name: str
    temperature: float = 0.3
    max_tokens: int = 4096
    model_override: str = ""       # 空 = 继承全局 provider
    order: int = 0


class BaseSpecialistAgent(ABC):
    """Specialist Agent 基类.

    子类须实现:
      - `name` (str)
      - `required_context` (list[str])
      - `_build_prompt(ctx_slice) -> (system, user)` (可为 async)
      - `_parse_result(raw_json, ctx_slice) -> AgentResult`
    """

    name: str = "base"
    required_context: list[str] = []

    def __init__(self, config: AgentConfig | None = None):
        self.config = config or AgentConfig(name=self.name)

    async def analyze(self, ctx_slice: dict[str, Any]) -> AgentResult:
        """标准执行流程: 构建 prompt → LLM 调用 → 解析 → 兜底 (含 OTel span)."""
        t0 = time.monotonic()
        tracing = get_tracing_service()
        parent_span = ctx_slice.get("_trace_span")
        span = tracing.gen_ai_agent_span(self.name, parent_span)
        span.set_attribute("traceos.agent.temperature", self.config.temperature)

        try:
            # _build_prompt 可为 sync 或 async
            build = self._build_prompt(ctx_slice)
            if hasattr(build, "__await__"):
                system_prompt, user_prompt = await build
            else:
                system_prompt, user_prompt = build

            assembled = f"[SYSTEM]\n{system_prompt}\n\n[USER]\n{user_prompt}"

            llm = self._get_llm()
            client_span = tracing.gen_ai_client_span(
                self.config.model_override or "default", span
            )
            try:
                resp = await llm.chat_completion(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    temperature=self.config.temperature,
                    max_tokens=self.config.max_tokens,
                    response_format={"type": "json_object"},
                )
            finally:
                tracing.end_span(client_span,
                    **{"gen_ai.usage.total_tokens": resp.total_tokens} if resp else {})

            elapsed = int((time.monotonic() - t0) * 1000)
            result = self._parse_result(resp.content, ctx_slice)
            # 填充执行元数据
            result.tokens_used = resp.total_tokens or 0
            result.execution_ms = elapsed
            result.assembled_prompt = assembled

            tracing.end_span(span,
                **{"gen_ai.agent.tokens": result.tokens_used,
                   "gen_ai.agent.confidence": result.confidence,
                   "gen_ai.agent.status": result.status})
            logger.info(
                "Agent %s completed: tokens=%d, %dms, confidence=%.2f",
                self.name, result.tokens_used, elapsed, result.confidence,
            )
            return result

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            logger.error("Agent %s failed: %s", self.name, e, exc_info=True)
            span.set_error(str(e))
            tracing.end_span(span)
            return AgentResult.failed(self.name, str(e), elapsed)

    def _get_llm(self):
        from app.services.llm_client import get_llm_provider
        return get_llm_provider()

    def _build_prompt(self, ctx_slice: dict[str, Any]) -> tuple[str, str]:
        ...

    def _parse_result(self, raw: str, ctx_slice: dict[str, Any]) -> AgentResult:
        ...

    @staticmethod
    def _parse_json(raw: str | None) -> dict[str, Any]:
        """从 LLM 原始文本中解析 JSON, 兼容 ```json 包裹和纯文本."""
        if not raw:
            return {}
        text = str(raw).strip()
        if text.startswith("```"):
            lines = text.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            text = "\n".join(lines)
        return json.loads(text)

    def _format_context_block(self, ctx_slice: dict) -> str:
        """把 ctx_slice 中非元数据键格式化为 block."""
        lines = []
        for key, val in ctx_slice.items():
            if key.startswith("_") and key not in ("_rubric", "_category"):
                continue
            if val:
                lines.append(f"### {key}\n{val}")
        return "\n\n".join(lines)

    def _empty_result(self, message: str = "") -> AgentResult:
        """当无数据可供分析时,返回 skipped."""
        return AgentResult.skipped(self.name, message)
