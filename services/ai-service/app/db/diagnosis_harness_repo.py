"""Diagnosis Harness DB Repository — diagnosis_reports / agent_results / experiment_rubrics / error_patterns."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from app.db.connection import get_pool

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# diagnosis_reports
# ---------------------------------------------------------------------------
async def save_diagnosis_report(report_data: dict[str, Any]) -> str:
    """写入 diagnosis_reports 表, 返回生成的 report id."""
    pool = get_pool()
    report_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    await pool.execute(
        """
        INSERT INTO diagnosis_reports (
            id, submission_id, student_id, experiment_id, trace_id, status,
            correctness_score, completeness_score, concept_score,
            code_quality_score, runtime_behavior_score, performance_score,
            total_score,
            summary, strength_points, weakness_points,
            related_concepts, related_syscalls, suggested_fixes, feedback_levels,
            radar_data, concept_radar,
            confidence_score, agent_agreement_score,
            requires_review, review_reason,
            llm_model, llm_tokens_used,
            degraded, degradation_reason,
            generated_at, completed_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12, $13,
            $14, $15::jsonb, $16::jsonb,
            $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb,
            $21::jsonb, $22::jsonb,
            $23, $24,
            $25, $26,
            $27, $28,
            $29, $30,
            $31, $32
        )
        """,
        report_id,
        report_data.get("submission_id", ""),
        report_data.get("student_id", ""),
        report_data.get("experiment_id", ""),
        report_data.get("trace_id"),
        report_data.get("status", "completed"),
        float(report_data.get("correctness_score", 0)),
        float(report_data.get("completeness_score", 0)),
        float(report_data.get("concept_score", 0)),
        float(report_data.get("code_quality_score", 0)),
        float(report_data.get("runtime_behavior_score", 0)),
        float(report_data.get("performance_score", 0)),
        float(report_data.get("total_score", 0)),
        report_data.get("summary", ""),
        json.dumps(report_data.get("strength_points", []), ensure_ascii=False),
        json.dumps(report_data.get("weakness_points", []), ensure_ascii=False),
        json.dumps(report_data.get("related_concepts", []), ensure_ascii=False),
        json.dumps(report_data.get("related_syscalls", []), ensure_ascii=False),
        json.dumps(report_data.get("suggested_fixes", []), ensure_ascii=False),
        json.dumps(report_data.get("feedback_levels", {}), ensure_ascii=False),
        json.dumps(report_data.get("radar_data", {}), ensure_ascii=False),
        json.dumps(report_data.get("concept_radar", {}), ensure_ascii=False),
        float(report_data.get("confidence_score", 0)),
        float(report_data.get("agent_agreement_score", 0)),
        bool(report_data.get("requires_review", False)),
        report_data.get("review_reason"),
        report_data.get("llm_model"),
        int(report_data.get("llm_tokens_used", 0)),
        bool(report_data.get("degraded", False)),
        report_data.get("degradation_reason"),
        now,
        now,
    )
    logger.info("Saved diagnosis_report id=%s, total_score=%.2f", report_id, float(report_data.get("total_score", 0)))
    return report_id


async def save_agent_result(report_id: str, agent_data: dict[str, Any]) -> None:
    """写入 agent_results 表."""
    pool = get_pool()
    await pool.execute(
        """
        INSERT INTO agent_results (
            report_id, agent_name, status,
            findings, dimension_scores, evidence,
            assembled_prompt,
            confidence_score, tokens_used, execution_ms
        ) VALUES (
            $1, $2, $3,
            $4::jsonb, $5::jsonb, $6::jsonb,
            $7,
            $8, $9, $10
        )
        """,
        report_id,
        agent_data.get("agent_name", ""),
        agent_data.get("status", "pending"),
        json.dumps(agent_data.get("findings", []), ensure_ascii=False),
        json.dumps(agent_data.get("dimension_scores", {}), ensure_ascii=False),
        json.dumps(agent_data.get("evidence", []), ensure_ascii=False),
        agent_data.get("assembled_prompt", "")[:50000],  # 防止超长
        float(agent_data.get("confidence_score", 0)),
        int(agent_data.get("tokens_used", 0)),
        int(agent_data.get("execution_ms", 0)),
    )


async def save_full_report_with_agents(
    report_data: dict[str, Any],
    agent_results: list[dict[str, Any]],
) -> str:
    """保存报告 + 所有关联 agent_results, 返回 report_id."""
    report_id = await save_diagnosis_report(report_data)
    for ar in agent_results:
        await save_agent_result(report_id, ar)
    logger.info("Saved report %s with %d agent_results", report_id, len(agent_results))
    return report_id


# ---------------------------------------------------------------------------
# experiment_rubrics
# ---------------------------------------------------------------------------
async def get_active_rubric(experiment_id: str) -> dict[str, Any] | None:
    """获取实验的激活 Rubric."""
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM experiment_rubrics "
        "WHERE experiment_id = $1 AND is_active = TRUE "
        "ORDER BY created_at DESC LIMIT 1",
        experiment_id,
    )
    return dict(row) if row else None


async def get_rubric_by_category(category: str) -> dict[str, Any] | None:
    """按实验分类获取 Rubric (用于 exp_<category>_default 关联)."""
    if not category:
        return None
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM experiment_rubrics "
        "WHERE category = $1 AND is_active = TRUE "
        "ORDER BY created_at DESC LIMIT 1",
        category,
    )
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# diagnosis_reports 查询
# ---------------------------------------------------------------------------
async def list_diagnosis_reports(submission_id: str = "") -> list[dict[str, Any]]:
    """按 submission_id 列出报告."""
    pool = get_pool()
    if submission_id:
        rows = await pool.fetch(
            "SELECT * FROM diagnosis_reports WHERE submission_id = $1 ORDER BY created_at DESC",
            submission_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT * FROM diagnosis_reports ORDER BY created_at DESC LIMIT 50"
        )
    return [dict(r) for r in rows]


async def get_diagnosis_report(report_id: str) -> dict[str, Any] | None:
    """获取单个报告 + 其 agent_results."""
    pool = get_pool()
    report_row = await pool.fetchrow(
        "SELECT * FROM diagnosis_reports WHERE id = $1",
        report_id,
    )
    if not report_row:
        return None

    result = dict(report_row)
    agent_rows = await pool.fetch(
        "SELECT * FROM agent_results WHERE report_id = $1 ORDER BY created_at",
        report_id,
    )
    result["agent_results"] = [dict(r) for r in agent_rows]

    # 解析 JSONB 字段
    for key in ("strength_points", "weakness_points", "related_concepts",
                 "related_syscalls", "suggested_fixes", "feedback_levels",
                 "radar_data", "concept_radar"):
        val = result.get(key)
        if isinstance(val, str):
            try:
                result[key] = json.loads(val)
            except json.JSONDecodeError:
                pass

    return result


# ---------------------------------------------------------------------------
# error_patterns (Phase 6 占位)
# ---------------------------------------------------------------------------
async def upsert_error_pattern(
    category: str,
    pattern_name: str,
    description: str,
    source_agent: str = "",
    source_diagnosis_id: str | None = None,
    typical_causes: list = None,
    fix_strategies: list = None,
    related_concepts: list = None,
) -> str | None:
    """更新或插入错误模式 (Ratchet 积累). 返回 pattern id (新插入时)."""
    pool = get_pool()
    now = datetime.now(timezone.utc)

    existing = await pool.fetchrow(
        "SELECT id, occurrence_count FROM error_patterns WHERE category = $1 AND pattern_name = $2",
        category, pattern_name,
    )
    if existing:
        await pool.execute(
            "UPDATE error_patterns SET occurrence_count = $1, last_seen_at = $2 "
            "WHERE id = $3",
            existing["occurrence_count"] + 1,
            now,
            existing["id"],
        )
        return str(existing["id"])
    else:
        new_id = str(uuid.uuid4())
        await pool.execute(
            """
            INSERT INTO error_patterns (
                id, category, pattern_name, description,
                typical_causes, fix_strategies, related_concepts,
                occurrence_count, first_seen_at, last_seen_at,
                source_agent, source_diagnosis_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8, $9, $10)
            """,
            new_id, category, pattern_name, description,
            json.dumps(typical_causes or [], ensure_ascii=False),
            json.dumps(fix_strategies or [], ensure_ascii=False),
            json.dumps(related_concepts or [], ensure_ascii=False),
            now, now,
            source_agent,
            source_diagnosis_id,
        )
        return new_id
