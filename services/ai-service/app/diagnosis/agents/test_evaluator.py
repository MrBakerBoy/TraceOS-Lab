"""TestEvaluatorAgent — 测试结果分析 (完整性维度 + 编译失败短路)."""

from __future__ import annotations

import logging
from typing import Any

from app.diagnosis.agents.base import AgentConfig, AgentResult, BaseSpecialistAgent
from app.diagnosis.prompts import TEST_EVALUATOR_SYSTEM

logger = logging.getLogger(__name__)


class TestEvaluatorAgent(BaseSpecialistAgent):
    name = "test_evaluator"
    required_context = ["code", "experiment_meta", "compile_error", "runtime_error",
                         "test_results", "score_breakdown"]

    def __init__(self) -> None:
        super().__init__(AgentConfig(name=self.name, temperature=0.1, max_tokens=4096))

    def _build_prompt(self, ctx_slice: dict[str, Any]) -> tuple[str, str]:
        user = self._format_context_block(ctx_slice)
        return TEST_EVALUATOR_SYSTEM, user

    def _parse_result(self, raw: str, ctx_slice: dict[str, Any]) -> AgentResult:
        compile_error = ctx_slice.get("compile_error", "")
        test_results = ctx_slice.get("test_results", "[]")
        score = ctx_slice.get("score_breakdown", "{}")

        # 编译失败短路
        if compile_error and isinstance(compile_error, str) and len(compile_error) > 10:
            return AgentResult.success(
                self.name,
                findings=[{
                    "category": "compile",
                    "title": "编译失败",
                    "description": f"编译错误阻止代码运行: {compile_error[:500]}",
                    "affected_tests": [],
                    "evidence": compile_error[:300],
                }],
                confidence=0.95,
            )

        # 无测试数据且无编译错误 → 不评估
        if test_results in ("", "[]", "null"):
            return AgentResult.skipped(self.name, "无测试数据")

        data = self._parse_json(raw)

        return AgentResult.success(
            self.name,
            findings=data.get("findings", []),
            evidence=[{"source": "test_results", "correctness_analysis": data.get("correctness_analysis", "")}],
            confidence=float(data.get("confidence", 0.7)),
        )
