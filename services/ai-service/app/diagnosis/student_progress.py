"""学生进步追踪 — 多次提交六维雷达对比 (Phase 6)"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class StudentProgressTracker:
    """追踪学生多次提交的六维评分变化趋势."""

    async def get_progress_history(
        self,
        student_id: str,
        experiment_id: str | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        """获取学生历次诊断报告 + 进步趋势分析."""
        try:
            from app.db.connection import get_pool
            pool = get_pool()

            if experiment_id:
                rows = await pool.fetch(
                    "SELECT id, experiment_id, total_score, "
                    "correctness_score, completeness_score, concept_score, "
                    "code_quality_score, runtime_behavior_score, performance_score, "
                    "confidence_score, created_at "
                    "FROM diagnosis_reports WHERE student_id = $1 AND experiment_id = $2 "
                    "ORDER BY created_at ASC LIMIT $3",
                    student_id, experiment_id, limit,
                )
            else:
                rows = await pool.fetch(
                    "SELECT id, experiment_id, total_score, "
                    "correctness_score, completeness_score, concept_score, "
                    "code_quality_score, runtime_behavior_score, performance_score, "
                    "confidence_score, created_at "
                    "FROM diagnosis_reports WHERE student_id = $1 "
                    "ORDER BY created_at ASC LIMIT $2",
                    student_id, limit,
                )

            if not rows:
                return {"submissions": [], "trend": "no_data", "improvement": 0}

            submissions = [dict(r) for r in rows]

            # 构建各维度时间序列
            dimensions = ["correctness", "completeness", "concept",
                          "code_quality", "runtime_behavior", "performance"]
            score_columns = {
                "correctness": "correctness_score",
                "completeness": "completeness_score",
                "concept": "concept_score",
                "code_quality": "code_quality_score",
                "runtime_behavior": "runtime_behavior_score",
                "performance": "performance_score",
            }

            radar_series = {}
            for dim, col in score_columns.items():
                radar_series[dim] = [float(r[col]) for r in submissions]

            # 趋势分析
            total_curve = [float(r["total_score"]) for r in submissions]
            improvement = 0
            if len(total_curve) >= 2:
                improvement = total_curve[-1] - total_curve[0]

            trend = "improving" if improvement > 5 else (
                "declining" if improvement < -5 else "stable"
            )

            # 逐维度改善最大/最差
            dim_improvements = {}
            for dim in dimensions:
                series = radar_series[dim]
                if len(series) >= 2:
                    dim_improvements[dim] = series[-1] - series[0]

            best_dim = max(dim_improvements, key=dim_improvements.get) if dim_improvements else None
            worst_dim = min(dim_improvements, key=dim_improvements.get) if dim_improvements else None

            return {
                "submissions": submissions,
                "total_curve": total_curve,
                "radar_series": radar_series,
                "trend": trend,
                "improvement": round(improvement, 2),
                "submission_count": len(submissions),
                "best_improving_dimension": best_dim,
                "worst_declining_dimension": worst_dim,
                "dimension_improvements": dim_improvements,
            }

        except Exception as e:
            logger.error("Student progress tracking failed: %s", e)
            return {"error": str(e), "submissions": []}
