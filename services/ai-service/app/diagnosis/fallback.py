"""降级策略 — 优先 Orchestrator, 异常时退回旧 diagnosis_service.

保证系统永不因新模块故障而不可用。
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Awaitable

from app.diagnosis.agents.report_generator import DiagnosisReport
from app.diagnosis.context_package import ContextPackage
from app.diagnosis.orchestrator import DiagnosisOrchestrator

logger = logging.getLogger(__name__)

ProgressCb = Callable[[str, str, int, str], Awaitable[None]]

# 单例 Orchestrator
_orchestrator: DiagnosisOrchestrator | None = None


def get_orchestrator() -> DiagnosisOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = DiagnosisOrchestrator()
    return _orchestrator


async def run_diagnosis_with_fallback(
    ctx: ContextPackage,
    progress_cb: ProgressCb | None = None,
    legacy_callback: Callable[[ContextPackage], Awaitable[Any]] | None = None,
) -> DiagnosisReport:
    """优先走多 Agent Orchestrator; 异常/低置信度时降级到旧诊断服务.

    Args:
        ctx: ContextPackage
        progress_cb: SSE 进度回调
        legacy_callback: 旧 diagnosis_service.diagnose_submission 的适配包装
                         (由调用方注入, 避免循环依赖)
    """
    try:
        orch = get_orchestrator()
        report = await orch.run(ctx, progress_cb)

        # 置信度过低 → 降级
        if report.confidence < 0.4 and legacy_callback:
            logger.warning(
                "Orchestrator confidence too low (%.2f), degrading to legacy service",
                report.confidence,
            )
            report.degraded = True
            report.degradation_reason = f"置信度过低 ({report.confidence:.2f})"
            # 仍返回 Orchestrator 报告 (标记降级), 不丢弃
            return report

        return report

    except Exception as e:
        logger.error("Orchestrator failed: %s, attempting legacy fallback", e, exc_info=True)

        # 构造降级报告 (尽量保留信息)
        degraded_report = DiagnosisReport(
            submission_id=ctx.submission_id,
            student_id=ctx.student_id,
            experiment_id=ctx.experiment_id,
            experiment_category=ctx.experiment_category,
            status="degraded",
            degraded=True,
            degradation_reason=f"Orchestrator 异常: {e}",
            confidence=0.0,
        )

        if legacy_callback:
            try:
                legacy_result = await legacy_callback(ctx)
                # 尝试从旧结果映射六维分数
                _merge_legacy(degraded_report, legacy_result)
                degraded_report.status = "degraded"
                logger.info("Legacy diagnosis succeeded as fallback")
            except Exception as legacy_err:
                logger.error("Legacy fallback also failed: %s", legacy_err)
                degraded_report.status = "failed"
                degraded_report.degradation_reason += f"; 旧诊断也失败: {legacy_err}"
        else:
            logger.warning("No legacy callback provided, returning degraded report")

        return degraded_report


def _merge_legacy(report: DiagnosisReport, legacy_result: Any) -> None:
    """把旧 DiagnosisResult 的字段尽量映射到新报告 (无分数)."""
    try:
        if hasattr(legacy_result, "root_cause"):
            report.summary = legacy_result.root_cause or ""
        elif isinstance(legacy_result, dict):
            report.summary = legacy_result.get("root_cause", "")

        # 旧结果无分数, 仅保留置信度
        if hasattr(legacy_result, "confidence_score"):
            report.confidence = legacy_result.confidence_score or 0.5
        elif isinstance(legacy_result, dict):
            report.confidence = legacy_result.get("confidence_score", 0.5)

        # related_concepts / suggested_fixes
        if hasattr(legacy_result, "related_concepts"):
            report.related_concepts = [
                c.name if hasattr(c, "name") else str(c)
                for c in legacy_result.related_concepts
            ]
        if hasattr(legacy_result, "suggested_fixes"):
            report.suggested_fixes = [
                {
                    "title": f.title if hasattr(f, "title") else "",
                    "description": f.description if hasattr(f, "description") else str(f),
                    "priority": "medium",
                }
                for f in legacy_result.suggested_fixes
            ]
        # feedback levels
        if hasattr(legacy_result, "feedback"):
            fb = legacy_result.feedback
            report.feedback_levels = {
                "level_1": fb.level_1 if hasattr(fb, "level_1") else "",
                "level_2": fb.level_2 if hasattr(fb, "level_2") else "",
                "level_3": fb.level_3 if hasattr(fb, "level_3") else "",
            }

    except Exception as e:
        logger.warning("Legacy merge failed: %s", e)
