"""班级统计 — 平均分、高频错误分布、班级排名 (Phase 6)"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class ClassStatsService:
    """班级级统计与分布分析."""

    async def get_class_stats(self, experiment_id: str) -> dict[str, Any]:
        """获取某个实验的班级统计 (平均分、分布、高频错误)."""
        try:
            from app.db.connection import get_pool
            pool = get_pool()

            # 1. 平均分 + 标准差
            stats_row = await pool.fetchrow(
                "SELECT COUNT(*) as count, "
                "AVG(total_score) as avg_score, "
                "STDDEV(total_score) as stddev_score, "
                "MIN(total_score) as min_score, "
                "MAX(total_score) as max_score, "
                "AVG(correctness_score) as avg_correctness, "
                "AVG(completeness_score) as avg_completeness, "
                "AVG(concept_score) as avg_concept, "
                "AVG(code_quality_score) as avg_code_quality, "
                "AVG(runtime_behavior_score) as avg_runtime, "
                "AVG(performance_score) as avg_performance "
                "FROM diagnosis_reports WHERE experiment_id = $1 AND status = 'completed'",
                experiment_id,
            )

            if not stats_row or stats_row["count"] == 0:
                return {"experiment_id": experiment_id, "submission_count": 0}

            count = int(stats_row["count"])

            # 2. 分数段分布
            dist_rows = await pool.fetch(
                "SELECT "
                "CASE "
                "  WHEN total_score >= 90 THEN 'A(90-100)' "
                "  WHEN total_score >= 80 THEN 'B(80-89)' "
                "  WHEN total_score >= 70 THEN 'C(70-79)' "
                "  WHEN total_score >= 60 THEN 'D(60-69)' "
                "  ELSE 'F(<60)' END as grade, "
                "COUNT(*) as cnt "
                "FROM diagnosis_reports WHERE experiment_id = $1 AND status = 'completed' "
                "GROUP BY grade ORDER BY grade",
                experiment_id,
            )
            grade_distribution = {r["grade"]: int(r["cnt"]) for r in dist_rows}

            # 3. 高频错误模式
            cat_row = await pool.fetchrow(
                "SELECT category FROM experiments WHERE id = $1",
                experiment_id,
            )
            category = cat_row["category"] if cat_row else "unknown"

            error_rows = await pool.fetch(
                "SELECT pattern_name, description, occurrence_count, confirmed "
                "FROM error_patterns WHERE category = $1 "
                "ORDER BY occurrence_count DESC LIMIT 10",
                category,
            )
            frequent_errors = [dict(r) for r in error_rows]

            # 4. 低置信度(需复审)的比例
            review_row = await pool.fetchrow(
                "SELECT COUNT(*) as cnt FROM diagnosis_reports "
                "WHERE experiment_id = $1 AND requires_review = TRUE",
                experiment_id,
            )
            review_count = int(review_row["cnt"]) if review_row else 0
            review_rate = review_count / count if count else 0

            # 5. 六维平均雷达
            avg_radar = {
                "correctness": float(stats_row["avg_correctness"] or 0),
                "completeness": float(stats_row["avg_completeness"] or 0),
                "concept": float(stats_row["avg_concept"] or 0),
                "code_quality": float(stats_row["avg_code_quality"] or 0),
                "runtime_behavior": float(stats_row["avg_runtime"] or 0),
                "performance": float(stats_row["avg_performance"] or 0),
            }

            return {
                "experiment_id": experiment_id,
                "experiment_category": category,
                "submission_count": count,
                "avg_score": round(float(stats_row["avg_score"] or 0), 2),
                "stddev_score": round(float(stats_row["stddev_score"] or 0), 2),
                "min_score": float(stats_row["min_score"] or 0),
                "max_score": float(stats_row["max_score"] or 0),
                "grade_distribution": grade_distribution,
                "avg_radar": avg_radar,
                "frequent_errors": frequent_errors,
                "review_rate": round(review_rate, 3),
                "review_count": review_count,
            }

        except Exception as e:
            logger.error("Class stats failed: %s", e)
            return {"error": str(e), "experiment_id": experiment_id}

    async def get_student_ranking(self, experiment_id: str, limit: int = 50) -> list[dict]:
        """获取学生排行榜 (按总分降序)."""
        try:
            from app.db.connection import get_pool
            pool = get_pool()

            rows = await pool.fetch(
                "SELECT student_id, total_score, confidence_score, "
                "correctness_score, concept_score, created_at, "
                "RANK() OVER (ORDER BY total_score DESC) as rank "
                "FROM diagnosis_reports WHERE experiment_id = $1 AND status = 'completed' "
                "ORDER BY total_score DESC LIMIT $2",
                experiment_id, limit,
            )
            return [dict(r) for r in rows]
        except Exception as e:
            logger.error("Student ranking failed: %s", e)
            return []
