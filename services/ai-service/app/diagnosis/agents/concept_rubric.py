"""ConceptRubricAgent — 确定性概念映射 (无 LLM).

把实验 category 映射到 OS 概念库, 并基于 Core 合格判定 (is_qualified) 产出粗粒度
概念达成度 radar。不再调用 LLM, 不产出细粒度分数。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.diagnosis.agents.base import AgentResult
from app.diagnosis.deterministic import map_concepts

logger = logging.getLogger(__name__)


class ConceptRubricAgent:
    """确定性概念映射 (降级后的 rubric, 无 LLM)."""

    name = "concept_rubric"

    async def analyze(self, ctx_slice: dict[str, Any]) -> AgentResult:
        category, is_qualified = self._extract_signals(ctx_slice)
        related_concepts, concept_radar = map_concepts(category, is_qualified)

        if not related_concepts:
            return AgentResult.skipped(self.name, "无法确定实验 category")

        return AgentResult.success(
            self.name,
            findings=[{
                "type": "concept",
                "concept_scores": [{"concept": c} for c in related_concepts],
            }],
            evidence=[{"concept_radar": concept_radar, "category": category}],
            confidence=1.0,
        )

    @staticmethod
    def _extract_signals(ctx_slice: dict[str, Any]) -> tuple[str, bool]:
        category = ""
        meta = ctx_slice.get("experiment_meta", "{}")
        try:
            m = json.loads(meta) if isinstance(meta, str) else (meta or {})
            category = m.get("category", "")
        except (json.JSONDecodeError, TypeError):
            category = ""

        is_qualified = False
        sb = ctx_slice.get("score_breakdown", "{}")
        try:
            s = json.loads(sb) if isinstance(sb, str) else (sb or {})
            is_qualified = bool(s.get("is_qualified", False))
        except (json.JSONDecodeError, TypeError):
            is_qualified = False

        return category, is_qualified