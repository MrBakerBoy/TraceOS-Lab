"""错误模式知识库 — 自动发现 + 人工确认 (Phase 6, Ratchet 积累)

每次 Agent 发现新错误模式 → 候选入库 → 教师确认 → 永久规则。
"""

from __future__ import annotations

import logging
from typing import Any

from app.diagnosis.agents.base import AgentResult, AgentStatus
from app.diagnosis.agents.report_generator import DiagnosisReport

logger = logging.getLogger(__name__)


class ErrorPatternKB:
    """错误模式自动入库管理器."""

    # 最小出现次数才自动入库候选
    AUTO_CANDIDATE_THRESHOLD = 1  # 首次发现即候选 (Phase 6 激进模式)

    async def extract_and_ingest(
        self,
        report: DiagnosisReport,
        agent_results: list[AgentResult],
    ) -> list[str]:
        """从诊断结果中提取新错误模式并入库候选.

        Returns:
            list[str]: 新创建的 pattern_id 列表
        """
        new_ids = []
        category = report.experiment_category or "unknown"

        try:
            from app.db.diagnosis_harness_repo import upsert_error_pattern

            seen_patterns: set[str] = set()

            for ar in agent_results:
                if ar.status != AgentStatus.COMPLETED.value:
                    continue

                for finding in ar.findings:
                    if not isinstance(finding, dict):
                        continue

                    # 提取模式名
                    pattern_name = self._make_pattern_name(finding, ar.agent_name)
                    if not pattern_name or pattern_name in seen_patterns:
                        continue
                    seen_patterns.add(pattern_name)

                    description = finding.get("description", "")

                    # 提取原因和修复策略
                    typical_causes = []
                    if finding.get("type"):
                        typical_causes.append(finding["type"])
                    if finding.get("category"):
                        typical_causes.append(finding["category"])

                    fix_strategies = []
                    if finding.get("title"):
                        fix_strategies.append(finding["title"])

                    related_concepts = finding.get("related_concepts", [])
                    if not isinstance(related_concepts, list):
                        related_concepts = [str(related_concepts)]

                    try:
                        pattern_id = await upsert_error_pattern(
                            category=category,
                            pattern_name=pattern_name,
                            description=description[:500],
                            source_agent=ar.agent_name,
                            source_diagnosis_id=report.submission_id,
                            typical_causes=typical_causes,
                            fix_strategies=fix_strategies,
                            related_concepts=related_concepts,
                        )
                        if pattern_id:
                            new_ids.append(pattern_id)
                            logger.info("Error pattern ingested: %s/%s (id=%s)",
                                        category, pattern_name, pattern_id[:8])
                    except Exception as e:
                        logger.debug("Error pattern upsert failed: %s", e)

        except Exception as e:
            logger.error("Error pattern extraction failed: %s", e)

        return new_ids

    def _make_pattern_name(self, finding: dict, agent_name: str) -> str:
        """从 finding 生成规范化 pattern_name."""
        ftype = finding.get("type") or finding.get("category") or "unknown"
        title = finding.get("title", "")
        if title:
            # 取前 80 字符作为 pattern name
            return f"{ftype}:{title[:80]}"
        desc = finding.get("description", "")
        if desc:
            return f"{ftype}:{desc[:60]}"
        return f"{agent_name}:{ftype}"

    async def suggest_ratchet_rules(self, category: str) -> list[dict]:
        """根据错误模式库为 Evaluator 建议新的 Ratchet 规则."""
        try:
            from app.db.connection import get_pool
            pool = get_pool()

            rows = await pool.fetch(
                "SELECT pattern_name, description, typical_causes, fix_strategies, "
                "occurrence_count, confirmed "
                "FROM error_patterns WHERE category = $1 AND occurrence_count >= $2 "
                "ORDER BY occurrence_count DESC LIMIT 10",
                category, 3,
            )

            suggestions = []
            for row in rows:
                suggestions.append({
                    "pattern_name": row["pattern_name"],
                    "description": row["description"],
                    "occurrence_count": row["occurrence_count"],
                    "confirmed": row["confirmed"],
                    "suggested_rule": (
                        f"检测到 '{row['pattern_name']}' 模式 ({row['description'][:100]}) "
                        f"→ 建议加入 hard_fail_rules"
                    ),
                })

            return suggestions
        except Exception as e:
            logger.error("Ratchet suggestion failed: %s", e)
            return []


# 单例
_error_kb: ErrorPatternKB | None = None


def get_error_kb() -> ErrorPatternKB:
    global _error_kb
    if _error_kb is None:
        _error_kb = ErrorPatternKB()
    return _error_kb
