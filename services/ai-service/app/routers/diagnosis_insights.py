"""诊断洞察 API — 学生进步追踪 + 班级统计 + 校准监控 + 错误模式库 (Phase 6)"""

import logging

from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/diagnose/insights", tags=["diagnosis-insights"])


@router.get("/student/{student_id}/progress")
async def get_student_progress(
    student_id: str,
    experiment_id: str = Query("", description="可选: 限定实验"),
    limit: int = Query(20, le=100),
):
    """学生进步追踪: 多次提交六维雷达对比 + 趋势分析."""
    from app.diagnosis.student_progress import StudentProgressTracker
    tracker = StudentProgressTracker()
    return await tracker.get_progress_history(student_id, experiment_id or None, limit)


@router.get("/class/{experiment_id}/stats")
async def get_class_stats(experiment_id: str):
    """班级统计: 平均分、分数段分布、高频错误模式、六维平均雷达."""
    from app.diagnosis.class_stats import ClassStatsService
    svc = ClassStatsService()
    stats = await svc.get_class_stats(experiment_id)
    if "error" in stats:
        raise HTTPException(status_code=500, detail=stats["error"])
    return stats


@router.get("/class/{experiment_id}/ranking")
async def get_student_ranking(
    experiment_id: str,
    limit: int = Query(50, le=200),
):
    """学生排行榜 (按总分降序)."""
    from app.diagnosis.class_stats import ClassStatsService
    svc = ClassStatsService()
    return await svc.get_student_ranking(experiment_id, limit)


@router.get("/calibration/{experiment_id}")
async def check_calibration_drift(
    experiment_id: str,
    current_kappa: float = Query(..., description="当前测量的 κ 值"),
):
    """校准漂移监控: 比较当前 κ 与历史 κ."""
    from app.diagnosis.evaluation_guard import CalibrationMonitor
    monitor = CalibrationMonitor()
    return await monitor.check_drift(experiment_id, current_kappa)


@router.get("/error-patterns")
async def list_error_patterns(
    category: str = Query("", description="按分类筛选"),
    confirmed_only: bool = Query(False),
):
    """错误模式知识库: 列出已积累的错误模式."""
    from app.db.connection import get_pool
    pool = get_pool()
    if category:
        if confirmed_only:
            rows = await pool.fetch(
                "SELECT * FROM error_patterns WHERE category = $1 AND confirmed = TRUE "
                "ORDER BY occurrence_count DESC",
                category,
            )
        else:
            rows = await pool.fetch(
                "SELECT * FROM error_patterns WHERE category = $1 "
                "ORDER BY occurrence_count DESC",
                category,
            )
    else:
        rows = await pool.fetch(
            "SELECT * FROM error_patterns ORDER BY occurrence_count DESC LIMIT 50"
        )
    return [dict(r) for r in rows]


@router.post("/error-patterns/{pattern_id}/confirm")
async def confirm_error_pattern(pattern_id: str):
    """教师确认错误模式 (Ratchet: 候选 → 永久规则)."""
    from app.db.connection import get_pool
    pool = get_pool()
    result = await pool.execute(
        "UPDATE error_patterns SET confirmed = TRUE WHERE id = $1",
        pattern_id,
    )
    if result.endswith("0"):
        raise HTTPException(status_code=404, detail="Error pattern not found")
    return {"status": "confirmed", "pattern_id": pattern_id}


@router.get("/tracing/spans")
async def get_recent_tracing_spans(limit: int = Query(20, le=100)):
    """获取最近的 OTel tracing spans (用于调试)."""
    from app.services.tracing import get_tracing_service
    return get_tracing_service().get_recent_spans(limit)
