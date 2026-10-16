"""AI 诊断路由 — LLM 调用 + DB 持久化 + SSE 流式"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core_client import core_client
from app.db import save_diagnosis, get_diagnosis_from_db, get_diagnoses_by_submission
from app.models import (
    Concept,
    DiagnosisResult,
    DiagnosisProgress,
    DiagnosisStatus,
    Feedback,
    RequestDiagnosisRequest,
    RequestDiagnosisResponse,
    Severity,
    SuggestedFix,
    SyscallInfo,
)
from app.services.diagnosis_service import diagnosis_service
from app.diagnosis.context_package import DataCollector, ContextPackage
from app.diagnosis.fallback import run_diagnosis_with_fallback
from app.diagnosis.orchestrator import DiagnosisOrchestrator
from app.db import (
    save_full_report_with_agents,
    save_agent_result,
    list_diagnosis_reports as list_harness_reports,
    get_diagnosis_report as get_harness_report,
)
from app.models import (
    DiagnosisReportModel,
    DiagnosisReportSummary,
    AgentResultInfo,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/diagnose", tags=["diagnosis"])

# Timeout for stale in_progress diagnoses (seconds)
STALE_TIMEOUT_SECONDS = 300  # 5 minutes

# In-memory store for diagnosis progress (used by SSE endpoint)
_diagnosis_progress: dict[str, list[dict]] = {}


def _push_progress(diagnosis_id: str, stage: str, progress: int, message: str) -> None:
    if diagnosis_id not in _diagnosis_progress:
        _diagnosis_progress[diagnosis_id] = []
    _diagnosis_progress[diagnosis_id].append({
        "diagnosis_id": diagnosis_id,
        "status": "in_progress",
        "stage": stage,
        "agent_name": "AI",
        "progress": progress,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


def _row_to_diagnosis_result(row: dict) -> DiagnosisResult:
    feedback = Feedback(
        level_1=row.get("feedback_l1") or "",
        level_2=row.get("feedback_l2") or "",
        level_3=row.get("feedback_l3") or "",
        level_4=row.get("feedback_l4") or "",
    )
    def _parse(val):
        if val is None:
            return []
        if isinstance(val, str):
            try:
                return json.loads(val)
            except json.JSONDecodeError:
                return []
        return val
    related_concepts = _parse(row.get("related_concepts"))
    related_syscalls = _parse(row.get("related_syscalls"))
    suggested_fixes = _parse(row.get("suggested_fixes"))
    return DiagnosisResult(
        diagnosis_id=str(row["id"]),
        submission_id=str(row["submission_id"]),
        student_id=str(row["student_id"]),
        status=row.get("status", "completed"),
        error_type=row.get("error_type"),
        severity=row.get("severity"),
        root_cause=row.get("root_cause"),
        feedback=feedback,
        related_concepts=[Concept(**c) for c in related_concepts] if related_concepts else [],
        related_syscalls=[SyscallInfo(**s) for s in related_syscalls] if related_syscalls else [],
        suggested_fixes=[SuggestedFix(**f) for f in suggested_fixes] if suggested_fixes else [],
        confidence_score=float(row.get("confidence_score") or 0),
        llm_model=row.get("mimo_model") or row.get("llm_model"),
        llm_tokens_used=row.get("mimo_tokens_used") or row.get("llm_tokens_used"),
        created_at=row.get("created_at", datetime.now(timezone.utc)),
        completed_at=row.get("completed_at"),
    )


@router.post("", response_model=RequestDiagnosisResponse)
async def request_diagnosis(
    req: RequestDiagnosisRequest, background_tasks: BackgroundTasks
) -> RequestDiagnosisResponse:
    diagnosis_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # Check for existing diagnosis (dedup with stale handling)
    try:
        existing_rows = await get_diagnoses_by_submission(req.submission_id)
        for row in existing_rows:
            status = row.get("status", "")
            created = row.get("created_at")
            
            if status == "completed":
                logger.info("Reusing existing completed diagnosis %s for submission %s",
                            row["id"], req.submission_id)
                return RequestDiagnosisResponse(
                    diagnosis_id=str(row["id"]),
                    status=DiagnosisStatus.completed,
                    estimated_time_seconds=1,
                    created_at=created or now,
                )
            
            if status == "in_progress":
                # Check if stale (>5 min old)
                if created:
                    # Handle both timezone-aware and naive datetimes
                    if hasattr(created, 'tzinfo') and created.tzinfo is not None:
                        age = (datetime.now(timezone.utc) - created).total_seconds()
                    else:
                        age = (datetime.now(timezone.utc) - created.replace(tzinfo=timezone.utc)).total_seconds()
                    
                    if age < STALE_TIMEOUT_SECONDS:
                        logger.info("Reusing recent in_progress diagnosis %s (age=%ds) for submission %s",
                                    row["id"], int(age), req.submission_id)
                        return RequestDiagnosisResponse(
                            diagnosis_id=str(row["id"]),
                            status=DiagnosisStatus.in_progress,
                            estimated_time_seconds=60 - int(age),
                            created_at=created,
                        )
                    else:
                        # Stale - mark as failed, will create new one
                        logger.info("Stale in_progress diagnosis %s (age=%ds) for submission %s, marking as failed",
                                    row["id"], int(age), req.submission_id)
                        try:
                            await save_diagnosis(
                                diagnosis_id=str(row["id"]),
                                submission_id=req.submission_id,
                                student_id=str(row.get("student_id", "")),
                                status="failed",
                            )
                        except Exception:
                            pass
                else:
                    # No created_at - stale, skip
                    logger.info("Skipping in_progress diagnosis %s with no created_at",
                                row["id"])
    except Exception as e:
        logger.warning("Failed to check existing diagnoses: %s", e)

    await save_diagnosis(
        diagnosis_id=diagnosis_id,
        submission_id=req.submission_id,
        student_id=req.student_id,
        status="in_progress",
    )

    _diagnosis_progress[diagnosis_id] = []

    background_tasks.add_task(
        _run_diagnosis, diagnosis_id, req.submission_id, req.experiment_id, req.student_id
    )

    return RequestDiagnosisResponse(
        diagnosis_id=diagnosis_id,
        status=DiagnosisStatus.in_progress,
        estimated_time_seconds=60,
        created_at=now,
    )


@router.get("", response_model=list[DiagnosisResult])
async def list_diagnoses(submission_id: str = "") -> list[DiagnosisResult]:
    if not submission_id:
        return []
    try:
        rows = await get_diagnoses_by_submission(submission_id)
    except Exception as e:
        logger.warning("Failed to query diagnoses: %s", e)
        return []
    results = []
    for row in rows:
        try:
            result = _row_to_diagnosis_result(row)
            results.append(result)
        except Exception as e:
            logger.warning("Failed to parse row: %s", e)
    # Inject harness report id
    try:
        from app.db.diagnosis_harness_repo import list_diagnosis_reports as list_hr
        hr_rows = await list_hr(submission_id)
        if hr_rows:
            hr_id = str(hr_rows[0].get("id", ""))
            for r in results:
                r.diagnosis_harness_id = hr_id
                r.has_harness_report = True
    except Exception as e:
        logger.debug("No harness report: %s", e)
    # Fallback: if no results from old table, build from harness reports
    if not results:
        try:
            from app.db.diagnosis_harness_repo import list_diagnosis_reports as list_hr
            from app.models import Feedback, Concept, SyscallInfo, SuggestedFix
            hr_rows = await list_hr(submission_id)
            for hr in hr_rows:
                result = DiagnosisResult(
                    diagnosis_id=str(hr.get("id", "")),
                    submission_id=submission_id,
                    student_id=str(hr.get("student_id", "")),
                    status="completed",
                    root_cause=hr.get("summary") or "",
                    confidence_score=float(hr.get("confidence_score", 0)),
                    diagnosis_harness_id=str(hr.get("id", "")),
                    has_harness_report=True,
                    created_at=hr.get("created_at", datetime.now(timezone.utc)),
                    completed_at=hr.get("completed_at"),
                )
                results.append(result)
        except Exception as e:
            logger.warning("Harness fallback failed: %s", e)
    return results

@router.get("/reports/{report_id}", response_model=DiagnosisReportModel)
async def get_harness_diagnosis_report(report_id: str) -> DiagnosisReportModel:
    """获取多 Agent Harness 诊断报告 (含 agent_details)."""
    row = await get_harness_report(report_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")

    # Core 真值 + 观测事实 (从 radar_data 列反序列化)
    radar = row.get("radar_data") or {}
    if isinstance(radar, str):
        try:
            radar = json.loads(radar)
        except json.JSONDecodeError:
            radar = {}

    agent_results = []
    for ar in row.get("agent_results", []):
        agent_results.append(AgentResultInfo(
            agent_name=ar.get("agent_name", ""),
            status=ar.get("status", ""),
            confidence=float(ar.get("confidence_score", 0)),
            tokens_used=int(ar.get("tokens_used", 0)),
            execution_ms=int(ar.get("execution_ms", 0)),
            findings_summary=[
                f.get("title") or f.get("description", "")[:60]
                for f in (ar.get("findings") or []) if isinstance(f, dict)
            ][:5],
        ))

    return DiagnosisReportModel(
        report_id=str(row["id"]),
        submission_id=str(row.get("submission_id", "")),
        student_id=str(row.get("student_id", "")),
        experiment_id=str(row.get("experiment_id", "")),
        experiment_category="",
        status=row.get("status", "completed"),
        is_qualified=bool(radar.get("is_qualified", False)),
        core_score=float(radar.get("core_score", 0)),
        edge_score=float(radar.get("edge_score", 0)),
        severity=str(radar.get("severity", "medium")),
        observations=radar.get("observations", {}),
        summary=row.get("summary", ""),
        strength_points=row.get("strength_points", []),
        weakness_points=row.get("weakness_points", []),
        related_concepts=row.get("related_concepts", []),
        related_syscalls=row.get("related_syscalls", []),
        suggested_fixes=row.get("suggested_fixes", []),
        feedback_levels=row.get("feedback_levels", {}),
        concept_radar=row.get("concept_radar", {}),
        confidence=float(row.get("confidence_score", 0)),
        agent_agreement=float(row.get("agent_agreement_score", 0)),
        requires_review=bool(row.get("requires_review", False)),
        review_reason=row.get("review_reason", ""),
        llm_model=row.get("llm_model"),
        llm_tokens_used=int(row.get("llm_tokens_used", 0)),
        agent_results=agent_results,
        degraded=bool(row.get("degraded", False)),
        degradation_reason=row.get("degradation_reason", ""),
        created_at=row.get("created_at"),
        completed_at=row.get("completed_at"),
    )


@router.get("/reports", response_model=list[DiagnosisReportSummary])
async def list_diagnosis_reports_api(submission_id: str = "") -> list[DiagnosisReportSummary]:
    """列出多 Agent Harness 诊断报告."""
    rows = await list_harness_reports(submission_id)
    return [
        DiagnosisReportSummary(
            report_id=str(r["id"]),
            submission_id=str(r.get("submission_id", "")),
            experiment_id=str(r.get("experiment_id", "")),
            confidence=float(r.get("confidence_score", 0)),
            status=r.get("status", "completed"),
            requires_review=bool(r.get("requires_review", False)),
            created_at=r.get("created_at"),
        )
        for r in rows
    ]


@router.get("/{diagnosis_id}", response_model=DiagnosisResult)
async def get_diagnosis(diagnosis_id: str) -> DiagnosisResult:
    return await _get_diagnosis_by_id(diagnosis_id)


async def _get_diagnosis_by_id(diagnosis_id: str) -> DiagnosisResult:
    row = await get_diagnosis_from_db(diagnosis_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Diagnosis not found")
    return _row_to_diagnosis_result(row)




def _build_positive_highlights(category: str, title: str, code_preview: str) -> dict:
    """Generate encouraging, category-specific positive analysis for perfect submissions."""

    cat_knowledge = {
        "scheduler": {
            "name": "\u8c03\u5ea6\u5668",
            "rules": ["MLFQ\u4e09\u7ea7\u961f\u5217", "\u4f18\u5148\u7ea7\u62a2\u5360", "\u65f6\u95f4\u7247\u8f6e\u8f6c", "\u5b9a\u671f\u4f18\u5148\u7ea7\u63d0\u5347"],
            "concepts": [
                {"name": "\u591a\u7ea7\u53cd\u9988\u961f\u5217(MLFQ)", "description": "\u901a\u8fc7\u591a\u7ea7\u961f\u5217\u5e73\u8861\u54cd\u5e94\u65f6\u95f4\u548c\u541e\u5410\u91cf\u7684\u7ecf\u5178\u8c03\u5ea6\u7b97\u6cd5", "type": "concept", "difficulty": "medium"},
                {"name": "\u8f6e\u8f6c\u8c03\u5ea6(RR)", "description": "\u540c\u4f18\u5148\u7ea7\u8fdb\u7a0b\u516c\u5e73\u5206\u4eabCPU\u65f6\u95f4", "type": "concept", "difficulty": "easy"},
                {"name": "\u4f18\u5148\u7ea7\u63d0\u5347(Priority Boost)", "description": "\u5b9a\u671f\u5c06\u6240\u6709\u8fdb\u7a0b\u63d0\u5347\u81f3\u6700\u9ad8\u4f18\u5148\u7ea7\uff0c\u9632\u6b62\u9965\u997f", "type": "concept", "difficulty": "medium"},
                {"name": "\u65f6\u95f4\u7247(Time Slice)", "description": "\u5404\u7ea7\u961f\u5217\u5206\u914d\u4e0d\u540c\u957f\u5ea6\u65f6\u95f4\u7247\u4ee5\u4f18\u5316\u54cd\u5e94\u548c\u541e\u5410", "type": "concept", "difficulty": "easy"},
            ],
        },
        "process": {
            "name": "\u8fdb\u7a0b\u7ba1\u7406",
            "rules": ["fork/exec\u521b\u5efa", "wait/waitpid\u56de\u6536", "\u50f5\u5c38\u8fdb\u7a0b\u907f\u514d", "\u5b64\u513f\u8fdb\u7a0b\u5904\u7406", "\u4fe1\u53f7\u54cd\u5e94"],
            "concepts": [
                {"name": "\u8fdb\u7a0b\u521b\u5efa(fork/exec)", "description": "\u901a\u8fc7\u7cfb\u7edf\u8c03\u7528\u521b\u5efa\u5b50\u8fdb\u7a0b\u5e76\u52a0\u8f7d\u65b0\u7a0b\u5e8f", "type": "concept", "difficulty": "easy"},
                {"name": "\u8fdb\u7a0b\u56de\u6536(wait/waitpid)", "description": "\u7236\u8fdb\u7a0b\u7b49\u5f85\u5b50\u8fdb\u7a0b\u7ed3\u675f\u5e76\u56de\u6536\u8d44\u6e90", "type": "concept", "difficulty": "easy"},
                {"name": "\u50f5\u5c38\u8fdb\u7a0b", "description": "\u5b50\u8fdb\u7a0b\u5df2\u9000\u51fa\u4f46\u7236\u8fdb\u7a0b\u672a\u56de\u6536\u7684\u8fdb\u7a0b\u72b6\u6001", "type": "concept", "difficulty": "medium"},
                {"name": "\u8fdb\u7a0b\u95f4\u901a\u4fe1(IPC)", "description": "\u7ba1\u9053\u3001\u5171\u4eab\u5185\u5b58\u3001\u6d88\u606f\u961f\u5217\u7b49\u8fdb\u7a0b\u95f4\u6570\u636e\u4ea4\u6362\u673a\u5236", "type": "concept", "difficulty": "hard"},
            ],
        },
        "thread": {
            "name": "\u7ebf\u7a0b\u4e0e\u5e76\u53d1",
            "rules": ["\u7ebf\u7a0b\u521b\u5efa/join", "\u4e92\u65a5\u9501\u4fdd\u62a4\u4e34\u754c\u533a", "\u6761\u4ef6\u53d8\u91cf\u540c\u6b65", "\u6b7b\u9501\u907f\u514d"],
            "concepts": [
                {"name": "\u7ebf\u7a0b\u540c\u6b65", "description": "\u4f7f\u7528\u4e92\u65a5\u9501\u548c\u6761\u4ef6\u53d8\u91cf\u534f\u8c03\u591a\u7ebf\u7a0b\u6267\u884c\u987a\u5e8f", "type": "concept", "difficulty": "medium"},
                {"name": "\u4e92\u65a5\u9501(Mutex)", "description": "\u4fdd\u62a4\u5171\u4eab\u8d44\u6e90\u7684\u6392\u4ed6\u8bbf\u95ee\u673a\u5236", "type": "concept", "difficulty": "easy"},
                {"name": "\u6b7b\u9501\u9884\u9632", "description": "\u901a\u8fc7\u8d44\u6e90\u5206\u914d\u7b56\u7565\u907f\u514d\u5faa\u73af\u7b49\u5f85\u6761\u4ef6", "type": "concept", "difficulty": "hard"},
                {"name": "\u7ade\u6001\u6761\u4ef6", "description": "\u591a\u7ebf\u7a0b\u5e76\u53d1\u8bbf\u95ee\u5171\u4eab\u6570\u636e\u5bfc\u81f4\u7684\u4e0d\u786e\u5b9a\u7ed3\u679c", "type": "concept", "difficulty": "medium"},
            ],
        },
        "memory": {
            "name": "\u5185\u5b58\u7ba1\u7406",
            "rules": ["malloc/free\u914d\u5bf9", "\u5185\u5b58\u6cc4\u6f0f\u68c0\u6d4b", "\u6307\u9488\u5b89\u5168", "\u7f13\u51b2\u533a\u7ba1\u7406"],
            "concepts": [
                {"name": "\u52a8\u6001\u5185\u5b58\u5206\u914d", "description": "\u8fd0\u884c\u65f6\u901a\u8fc7malloc\u7b49\u51fd\u6570\u4ece\u5806\u4e2d\u5206\u914d\u5185\u5b58", "type": "concept", "difficulty": "easy"},
                {"name": "\u5185\u5b58\u6cc4\u6f0f", "description": "\u5206\u914d\u7684\u5185\u5b58\u672a\u91ca\u653e\u5bfc\u81f4\u53ef\u7528\u5185\u5b58\u6301\u7eed\u51cf\u5c11", "type": "concept", "difficulty": "medium"},
                {"name": "\u865a\u62df\u5185\u5b58", "description": "\u64cd\u4f5c\u7cfb\u7edf\u63d0\u4f9b\u7684\u5730\u5740\u7a7a\u95f4\u62bd\u8c61\u673a\u5236", "type": "concept", "difficulty": "hard"},
            ],
        },
        "fs": {
            "name": "\u6587\u4ef6\u7cfb\u7edf",
            "rules": ["\u6587\u4ef6\u63cf\u8ff0\u7b26\u7ba1\u7406", "\u8bfb\u5199\u64cd\u4f5c\u6b63\u786e\u6027", "\u9519\u8bef\u5904\u7406", "\u8d44\u6e90\u5173\u95ed"],
            "concepts": [
                {"name": "\u6587\u4ef6\u63cf\u8ff0\u7b26", "description": "\u64cd\u4f5c\u7cfb\u7edf\u4e3a\u6253\u5f00\u6587\u4ef6\u5206\u914d\u7684\u6574\u6570\u6807\u8bc6", "type": "concept", "difficulty": "easy"},
                {"name": "\u7cfb\u7edf\u8c03\u7528(read/write/open/close)", "description": "\u6587\u4ef6I/O\u7684\u57fa\u672c\u64cd\u4f5c\u63a5\u53e3", "type": "concept", "difficulty": "easy"},
            ],
        },
        "deadlock": {
            "name": "\u6b7b\u9501",
            "rules": ["\u6b7b\u9501\u56db\u6761\u4ef6", "\u94f6\u884c\u5bb6\u7b97\u6cd5", "\u8d44\u6e90\u5206\u914d\u56fe", "\u6b7b\u9501\u68c0\u6d4b\u4e0e\u907f\u514d"],
            "concepts": [
                {"name": "\u6b7b\u9501\u56db\u6761\u4ef6", "description": "\u4e92\u65a5\u3001\u6301\u6709\u5e76\u7b49\u5f85\u3001\u4e0d\u53ef\u62a2\u5360\u3001\u5faa\u73af\u7b49\u5f85", "type": "concept", "difficulty": "medium"},
                {"name": "\u94f6\u884c\u5bb6\u7b97\u6cd5", "description": "\u901a\u8fc7\u9884\u5206\u914d\u68c0\u67e5\u907f\u514d\u7cfb\u7edf\u8fdb\u5165\u4e0d\u5b89\u5168\u72b6\u6001", "type": "concept", "difficulty": "hard"},
            ],
        },
    }

    k = cat_knowledge.get(category, {
        "name": "\u4ee3\u7801\u5b9e\u73b0",
        "rules": ["\u903b\u8f91\u6b63\u786e\u6027", "\u8fb9\u754c\u6761\u4ef6\u5904\u7406", "\u9519\u8bef\u5904\u7406", "\u4ee3\u7801\u89c4\u8303"],
        "concepts": [
            {"name": "\u4ee3\u7801\u6b63\u786e\u6027", "description": "\u7a0b\u5e8f\u903b\u8f91\u4e0e\u9884\u671f\u884c\u4e3a\u5b8c\u5168\u4e00\u81f4", "type": "concept", "difficulty": "easy"},
        ],
    })

    rules_text = "\u3001".join(k["rules"])
    cat_name = k["name"]

    level_1 = (
        f"\U0001f389 \u592a\u68d2\u4e86\uff01\u4f60\u7684{cat_name}\u5b9e\u9a8c\u4ee3\u7801\u901a\u8fc7\u4e86\u5168\u90e8\u6d4b\u8bd5\u7528\u4f8b\u3002\n\n"
        f"\u672c\u6b21\u5b9e\u9a8c\u7684\u6838\u5fc3\u8981\u7d20\u2014\u2014{rules_text}\u2014\u2014\u4f60\u7684\u4ee3\u7801\u90fd\u5b9e\u73b0\u5f97\u975e\u5e38\u5230\u4f4d\u3002"
    )

    rule0_name = k['rules'][0] if k['rules'] else '操作系统核心'
    level_2 = (
        f"\U0001f4cb \u4ee3\u7801\u4eae\u70b9\u5206\u6790\uff1a\n\n"
        f"\u2705 **\u903b\u8f91\u5b8c\u6574\u6027**\uff1a\u7a0b\u5e8f\u51c6\u786e\u5b9e\u73b0\u4e86{cat_name}\u7684\u6838\u5fc3\u7b97\u6cd5\u6d41\u7a0b\uff0c\u4e0e\u5b9e\u9a8c\u8981\u6c42\u5b8c\u5168\u543b\u5408\u3002\n"
        f"\u2705 **\u8fb9\u754c\u5904\u7406**\uff1a\u5bf9\u5404\u79cd\u8fb9\u754c\u6761\u4ef6\u548c\u5f02\u5e38\u60c5\u51b5\u90fd\u6709\u59a5\u5584\u5904\u7406\uff0c\u4ee3\u7801\u5065\u58ee\u6027\u51fa\u8272\u3002\n"
        f"\u2705 **\u64cd\u4f5c\u7cfb\u7edf\u6982\u5ff5\u6620\u5c04**\uff1a\u4f60\u7684\u5b9e\u73b0\u7cbe\u51c6\u4f53\u73b0\u4e86{rule0_name}\u7b49\u5173\u952e\u6982\u5ff5\uff0c\u8bf4\u660e\u4f60\u5bf9\u8bfe\u672c\u77e5\u8bc6\u7406\u89e3\u624e\u5b9e\u3002\n"
        f"\u2705 **\u4ee3\u7801\u7ed3\u6784**\uff1a\u4ee3\u7801\u7ec4\u7ec7\u6e05\u6670\u3001\u53d8\u91cf\u547d\u540d\u5408\u7406\uff0c\u5177\u6709\u826f\u597d\u7684\u53ef\u8bfb\u6027\u548c\u53ef\u7ef4\u62a4\u6027\u3002\n\n"
        f"\u8fd9\u4efd\u4ee3\u7801\u4e0d\u4ec5\u662f\u2018\u80fd\u8dd1\u2019\uff0c\u66f4\u662f\u2018\u5199\u5f97\u597d\u2019\u2014\u2014\u6d4b\u8bd5\u7ed3\u679c\u6ee1\u5206\u5c31\u662f\u6700\u597d\u7684\u8bc1\u660e\u3002"
    )

    rules_len = len(k["rules"])
    level_3 = (
        f"\U0001f3c6 \u6df1\u5ea6\u89e3\u8bfb\u2014\u2014\u4e3a\u4ec0\u4e48\u4f60\u7684{cat_name}\u5b9e\u73b0\u582a\u79f0\u4f18\u79c0\uff1a\n\n"
        f"1. **\u7b97\u6cd5\u5b9e\u73b0\u4e25\u8c28**\n"
        f"   {cat_name}\u662f\u64cd\u4f5c\u7cfb\u7edf\u8bfe\u7a0b\u7684\u6838\u5fc3\u96be\u70b9\uff0c\u4f60\u4e0d\u4ec5\u6b63\u786e\u5b9e\u73b0\u4e86\u57fa\u672c\u903b\u8f91\uff0c\u8fd8\u5b8c\u6574\u8986\u76d6\u4e86\u6240\u6709\u5173\u952e\u89c4\u5219\u3002\u6bcf\u4e00\u6b65\u7684\u51b3\u7b56\u90fd\u7ecf\u5f97\u8d77\u63a8\u6572\u3002\n\n"
        f"2. **\u64cd\u4f5c\u7cfb\u7edf\u601d\u7ef4**\n"
        f"   \u4ece\u4ee3\u7801\u4e2d\u53ef\u4ee5\u770b\u51fa\uff0c\u4f60\u7406\u89e3\u4e86\u2018{rule0_name}\u2019\u80cc\u540e\u7684\u8bbe\u8ba1\u54f2\u5b66\uff0c\u800c\u4e0d\u4ec5\u4ec5\u662f\u673a\u68b0\u5730\u5b8c\u6210\u9898\u76ee\u3002\u8fd9\u79cd\u2018\u77e5\u5176\u6240\u4ee5\u7136\u2019\u7684\u5b66\u4e60\u65b9\u5f0f\u975e\u5e38\u53ef\u8d35\u3002\n\n"
        f"3. **\u5de5\u7a0b\u5b9e\u8df5\u610f\u8bc6**\n"
        f"   \u4ee3\u7801\u4e2d\u7684\u9519\u8bef\u5904\u7406\u3001\u8d44\u6e90\u7ba1\u7406\u3001\u6ce8\u91ca\u8bf4\u660e\u90fd\u4f53\u73b0\u4e86\u826f\u597d\u7684\u5de5\u7a0b\u7d20\u517b\u3002\u8fd9\u4e9b\u4e60\u60ef\u5728\u5b9e\u9645\u7cfb\u7edf\u7f16\u7a0b\u4e2d\u81f3\u5173\u91cd\u8981\u3002\n\n"
        f"4. **\u6d4b\u8bd5\u9a71\u52a8\u9a8c\u8bc1**\n"
        f"   \u5168\u90e8{len(k['rules'])}\u4e2a\u6838\u5fc3\u89c4\u5219\u70b9\u5747\u901a\u8fc7\u6d4b\u8bd5\u7528\u4f8b\u9a8c\u8bc1\uff0c\u4eff\u771f\u7ed3\u679c\u4e0e\u6807\u51c6\u7b54\u6848\u5b8c\u5168\u5339\u914d\uff0c\u8bc1\u660e\u4ee3\u7801\u5b8c\u6210\u5ea6\u6781\u9ad8\u3002\n\n"
        f"\U0001f4a1 \u62d3\u5c55\u601d\u8003\uff1a\u65e2\u7136\u57fa\u7840\u5b9e\u73b0\u5df2\u5982\u6b64\u51fa\u8272\uff0c\u4e0d\u59a8\u601d\u8003\u2014\u2014\u5982\u679c\u8981\u5728\u771f\u5b9e\u64cd\u4f5c\u7cfb\u7edf\u5185\u6838\u4e2d\u5b9e\u73b0{cat_name}\uff0c\u8fd8\u9700\u8981\u8003\u8651\u54ea\u4e9b\u989d\u5916\u7684\u590d\u6742\u56e0\u7d20\uff1f"
    )

    summary = (
        f"\u2705 {cat_name}\u5b9e\u9a8c\u4ee3\u7801\u5b8c\u5168\u6b63\u786e\uff0c\u901a\u8fc7\u4e86\u6240\u6709\u6d4b\u8bd5\u7528\u4f8b\u3002"
        f"{rules_text}\u7b49\u6838\u5fc3\u89c4\u5219\u5747\u5b8c\u6574\u5b9e\u73b0\uff0c\u4ee3\u7801\u7ed3\u6784\u6e05\u6670\u3001\u903b\u8f91\u4e25\u8c28\uff0c"
        f"\u4f53\u73b0\u4e86\u624e\u5b9e\u7684\u64cd\u4f5c\u7cfb\u7edf\u7406\u8bba\u57fa\u7840\u548c\u826f\u597d\u7684\u7f16\u7a0b\u7d20\u517b\u3002"
    )

    return {
        "level_1": level_1,
        "level_2": level_2,
        "level_3": level_3,
        "summary": summary,
        "concepts": [Concept(**c) for c in k["concepts"]],
    }


async def _run_diagnosis(
    diagnosis_id: str, submission_id: str, experiment_id: str, student_id: str
) -> None:
    try:
        _push_progress(diagnosis_id, "fetching", 10, "正在获取提交数据...")
        # Parallelize independent API calls
        submission, experiment_full, individual_results = await asyncio.gather(
            core_client.get_submission(submission_id),
            core_client.get_experiment_full(experiment_id),
            core_client.get_submission_test_results(submission_id),
        )
        if submission is None:
            submission = {"id": submission_id, "student_id": student_id, "code": "", "language": "c"}

        experiment = None
        test_cases = None
        if experiment_full:
            experiment = experiment_full.get("experiment") or experiment_full
            test_cases = experiment_full.get("test_cases")
        if experiment is None:
            experiment = {"id": experiment_id, "title": "实验", "description": "", "category": "", "instructions": ""}

        # Build test_results context from submission + test case definitions
        # so the AI can reason about which tests passed/failed
        test_results = None
        if test_cases and isinstance(test_cases, list):
            # Use individual results from parallel gather
            if individual_results:
                test_results = individual_results
                logger.info("Got %d individual test results for submission %s", len(test_results), submission_id)
            else:
                # Fallback: build from test case definitions with inferred status
                test_results = []
                passed_count = submission.get("passed_test_cases", 0)
                for i, tc in enumerate(test_cases):
                    if isinstance(tc, dict):
                        tr = {
                            "name": tc.get("name", f"测试用例{i+1}"),
                            "test_case_id": tc.get("id", ""),
                            "expected_output": tc.get("expected_output", ""),
                            "is_public": tc.get("is_public", True),
                            "passed": None,  # unknown at individual level
                        }
                        if len(test_cases) == 1:
                            tr["passed"] = passed_count >= 1
                        test_results.append(tr)
                logger.info("Built test context with %d test cases for submission %s (fallback, individual results unavailable)", len(test_results), submission_id)

        # Check if all tests passed - skip LLM for perfect submissions
        all_passed = False
        if test_results:
            passed = sum(1 for t in test_results if t.get("passed") is True)
            failed = sum(1 for t in test_results if t.get("passed") is False)
            unknown = len(test_results) - passed - failed
            if (passed > 0 and failed == 0 and unknown == 0) or (failed == 0 and submission.get("passed_test_cases", 0) >= submission.get("total_test_cases", 0) > 0):
                all_passed = True
                logger.info("All tests passed for submission %s, skipping LLM diagnosis (passed=%d, total=%d)", submission_id, submission.get("passed_test_cases", 0), submission.get("total_test_cases", 0))

        if all_passed:
            exp_title = experiment.get("title", "")
            exp_cat = experiment.get("category", "")
            exp_desc = experiment.get("description", "")
            student_code = submission.get("code", "")
            sub_lang = submission.get("language", "c")

            # Try LLM-based positive feedback first
            llm_success = False
            try:
                from app.services.llm_client import llm_provider
                from app.services.prompt_builder import build_positive_feedback_prompt

                sys_prompt, user_prompt = build_positive_feedback_prompt(
                    code=student_code,
                    experiment_title=exp_title,
                    experiment_category=exp_cat,
                    experiment_description=exp_desc or "",
                    language=sub_lang,
                )
                llm_resp = await llm_provider.chat_completion(
                    system_prompt=sys_prompt,
                    user_prompt=user_prompt,
                    temperature=0.5,
                    max_tokens=2048,
                    response_format={"type": "json_object"},
                )
                if llm_resp and llm_resp.content:
                    parsed = json.loads(llm_resp.content) if isinstance(llm_resp.content, str) else llm_resp.content
                    cat_highlights = {
                        "summary": parsed.get("summary", f"完美通过 {exp_title}"),
                        "level_1": parsed.get("level_1", ""),
                        "level_2": parsed.get("level_2", ""),
                        "level_3": parsed.get("level_3", ""),
                        "concepts": [Concept(**c) for c in parsed.get("concepts", [])],
                    }
                    llm_success = True
                    logger.info("LLM positive feedback generated for %s (tokens=%s)", submission_id, llm_resp.total_tokens)
            except Exception as llm_err:
                logger.warning("LLM positive feedback failed for %s: %s, using fallback", submission_id, llm_err)

            if not llm_success:
                cat_highlights = _build_positive_highlights(exp_cat, exp_title, "")

            result = DiagnosisResult(
                diagnosis_id=diagnosis_id,
                submission_id=submission_id,
                student_id=student_id,
                status=DiagnosisStatus.completed,
                error_type="",
                severity=Severity.low,
                root_cause=cat_highlights["summary"],
                feedback=Feedback(
                    level_1=cat_highlights["level_1"],
                    level_2=cat_highlights["level_2"],
                    level_3=cat_highlights["level_3"],
                ),
                related_concepts=cat_highlights["concepts"],
                related_syscalls=[],
                suggested_fixes=[],
                confidence_score=1.0,
                llm_model=llm_resp.model if llm_success else "system",
                llm_tokens_used=llm_resp.total_tokens if llm_success else 0,
            )
            _push_progress(diagnosis_id, "analyzing", 50, "所有测试通过，生成代码亮点分析")
        else:
            _push_progress(diagnosis_id, "analyzing", 30, "正在启动多 Agent 诊断引擎...")
            result = await _run_harness_diagnosis(
                diagnosis_id, submission, experiment, test_results, student_id,
            )

        _push_progress(diagnosis_id, "saving", 80, "正在保存诊断结果...")
        try:
            await save_diagnosis(
                diagnosis_id=diagnosis_id, submission_id=submission_id, student_id=student_id,
                status="completed", error_type=result.error_type, severity=result.severity,
                root_cause=result.root_cause,
                feedback_l1=result.feedback.level_1, feedback_l2=result.feedback.level_2,
                feedback_l3=result.feedback.level_3,
                related_concepts=json.dumps([c.model_dump() for c in result.related_concepts], ensure_ascii=False),
                related_syscalls=json.dumps([s.model_dump() for s in result.related_syscalls], ensure_ascii=False),
                suggested_fixes=json.dumps([f.model_dump() for f in result.suggested_fixes], ensure_ascii=False),
                confidence_score=result.confidence_score,
                llm_model=result.llm_model, llm_tokens_used=result.llm_tokens_used,
            )
        except Exception as save_err:
            logger.warning("save_diagnosis failed (FK/duplicate): %s", save_err)
        _push_progress(diagnosis_id, "completed", 100, "诊断完成")
        logger.info("Diagnosis %s completed (tokens=%s)", diagnosis_id, result.llm_tokens_used)
    except Exception as e:
        logger.error("Diagnosis %s failed: %s", diagnosis_id, e, exc_info=True)
        _push_progress(diagnosis_id, "completed", 100, "诊断完成 (部分数据保存失败)")
        try:
            await save_diagnosis(diagnosis_id=diagnosis_id, submission_id=submission_id,
                                student_id=student_id, status="failed")
        except Exception:
            pass



async def _run_harness_diagnosis(
    diagnosis_id: str,
    submission: dict,
    experiment: dict,
    test_results: list | None,
    student_id: str,
) -> DiagnosisResult:
    """通过多 Agent Harness 诊断, 失败时降级到旧 diagnosis_service."""
    # 组装 ContextPackage
    event_data = {
        "submission_id": submission.get("id", ""),
        "experiment_id": experiment.get("id", ""),
        "student_id": student_id,
        "strace_summary": submission.get("strace_summary") if isinstance(submission, dict) else None,
        "test_results": test_results,
        "compile_error": submission.get("compile_error"),
        "runtime_error": submission.get("runtime_error"),
        "output_score": submission.get("output_score", 0),
        "structure_score": submission.get("structure_score", 0),
        "behavior_score": submission.get("behavior_score", 0),
        "score": submission.get("score", 0),
        "total_score": submission.get("total_score", 100),
        "passed_cases": submission.get("passed_test_cases", 0),
        "total_cases": submission.get("total_test_cases", 0),
        "status": submission.get("status", ""),
        "execution_time": submission.get("execution_time"),
        "deductions": submission.get("deductions", []),
    }

    ctx = DataCollector.collect(event_data, submission, experiment)

    # 进度回调 (接入 SSE)
    async def progress_cb(stage, agent_name, percent, message):
        stage_label = f"{stage}:{agent_name}"
        _push_progress(diagnosis_id, stage_label, percent, message)

    # 旧诊断回调 (降级用)
    async def legacy_cb(ctx: ContextPackage):
        return await diagnosis_service.diagnose_submission(
            submission=submission,
            experiment=experiment,
            test_results=test_results,
        )

    # 执行多 Agent 诊断 (含降级)
    _push_progress(diagnosis_id, "diagnosis", 30, "多 Agent 并行诊断启动...")
    report = await run_diagnosis_with_fallback(ctx, progress_cb, legacy_callback=legacy_cb)

    # 持久化到新表
    try:
        agent_data_list = [ar.to_db_dict() for ar in report.agent_results]
        report_id = await save_full_report_with_agents(
            report.to_db_dict(), agent_data_list,
        )
        logger.info("Harness report saved: report_id=%s, qualified=%s, core=%.1f",
                     report_id, report.is_qualified, report.core_score)
    except Exception as e:
        logger.error("Failed to save harness report: %s", e)
        report_id = diagnosis_id

    # 映射回旧 DiagnosisResult (兼容旧表 + 前端)
    result = _harness_report_to_legacy(report, diagnosis_id, submission, student_id, harness_report_id=report_id)
    return result


def _harness_report_to_legacy(
    report, diagnosis_id: str, submission: dict, student_id: str,
    harness_report_id: str = "",
) -> DiagnosisResult:
    """将 DiagnosisReport 映射为旧 DiagnosisResult (向后兼容, 无分数)."""
    # severity 来自 Core is_qualified (report.severity)
    sev = report.severity or "medium"
    if sev not in ("low", "medium", "high", "critical"):
        sev = "medium"

    # related_concepts / syscalls → Pydantic models
    concepts = [Concept(name=c, description=c, type="concept") for c in (report.related_concepts or [])]
    syscalls = [SyscallInfo(name=s, description=s) for s in (report.related_syscalls or [])]
    fixes = [
        SuggestedFix(
            title=f.get("title", ""),
            description=f.get("description", ""),
            explanation=f.get("evidence", ""),
            source=f.get("source", ""),
            source_label=f.get("source_label", ""),
            source_kind=f.get("source_kind", ""),
        )
        for f in (report.suggested_fixes or [])
    ]

    feedback = Feedback(
        level_1=report.feedback_levels.get("level_1", ""),
        level_2=report.feedback_levels.get("level_2", ""),
        level_3=report.feedback_levels.get("level_3", ""),
        level_4=report.feedback_levels.get("level_4", ""),
    )

    llm_model = report.llm_model or "multi-agent"

    return DiagnosisResult(
        diagnosis_id=diagnosis_id,
        submission_id=submission.get("id", ""),
        student_id=student_id,
        status=DiagnosisStatus.completed,
        error_type="",
        severity=sev,
        root_cause=report.summary,
        feedback=feedback,
        related_concepts=concepts,
        related_syscalls=syscalls,
        suggested_fixes=fixes,
        confidence_score=report.confidence,
        llm_model=llm_model,
        llm_tokens_used=report.llm_tokens_used,
        diagnosis_harness_id=harness_report_id,
        has_harness_report=True,
        created_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
    )


# ============================================================================
@router.get("/{diagnosis_id}/stream")
async def stream_diagnosis(diagnosis_id: str, request: Request):
    async def event_generator():
        last_index = 0
        timeout_seconds = 120
        start_time = datetime.now(timezone.utc)
        while True:
            if await request.is_disconnected():
                break
            elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
            if elapsed > timeout_seconds:
                yield f"data: {json.dumps({'status': 'timeout', 'message': '诊断超时'})}\n\n"
                break
            progress_list = _diagnosis_progress.get(diagnosis_id, [])
            while last_index < len(progress_list):
                item = progress_list[last_index]
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
                last_index += 1
                if item.get("stage") in ("completed", "failed"):
                    return
            await asyncio.sleep(0.5)
    return StreamingResponse(
        event_generator(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
