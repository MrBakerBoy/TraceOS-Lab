"""TraceOS Lab AI Service - FastAPI Entry Point"""

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import init_db, close_db, save_diagnosis, get_diagnoses_by_submission, get_pool
from app.models import HealthResponse, DiagnosisResult, DiagnosisStatus, Feedback, Severity
from app.routers import diagnosis, hints, comment_reply, class_analysis, chat
from app.routers import import_router, v1_proxy, ask_router
from app.routers import adaptive, code_audit, report_eval
from app.routers import flamegraph_analysis, ebpf_analysis, trace_analysis, deadlock_analysis
from app.routers import diagnosis_insights, experiment_chat_stream, memory
from app.core_client import core_client
from app.services.diagnosis_service import diagnosis_service
from app.diagnosis.context_package import DataCollector, ContextPackage
from app.diagnosis.fallback import run_diagnosis_with_fallback
from app.db import save_full_report_with_agents
from app.routers.diagnosis import _build_positive_highlights

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

START_TIME = time.time()

# NATS subscriber (lazy start)
_nats_task: asyncio.Task | None = None


async def _nats_subscriber() -> None:
    """订阅 NATS evaluation.completed 事件，自动触发 AI 诊断"""
    try:
        import nats
    except ImportError:
        logger.warning("nats-py not installed, skipping NATS subscriber")
        return

    nc = None
    while True:
        try:
            nc = await nats.connect(settings.nats_url)
            logger.info("NATS connected: %s", settings.nats_url)

            # ── Fix: mark all stale in_progress diagnoses as failed on startup ──
            try:
                pool = get_pool()
                result = await pool.execute(
                    "UPDATE diagnoses SET status = 'failed' "
                    "WHERE status = 'in_progress' "
                    "AND created_at < NOW() - INTERVAL '5 minutes'"
                )
                count_str = result.split()[-1] if result else "0"
                count = int(count_str) if count_str.isdigit() else 0
                if count > 0:
                    logger.info("NATS: marked %d stale in_progress diagnoses as failed on startup", count)
            except Exception as cleanup_err:
                logger.warning("NATS: failed to clean up stale diagnoses: %s", cleanup_err)

            js = nc.jetstream()

            async def on_evaluation_completed(msg):
                """处理 evaluation.completed 事件"""
                # Variables for failure recovery
                submission_id = ""
                experiment_id = ""
                student_id = ""
                diagnosis_id = ""
                try:
                    data = json.loads(msg.data.decode())
                    submission_id = data.get("submission_id", "")
                    experiment_id = data.get("experiment_id", "")
                    student_id = data.get("student_id", "")

                    if not submission_id:
                        logger.warning("NATS event missing submission_id")
                        await msg.ack()
                        return

                    # 去重：检查是否已有进行中或已完成的诊断
                    existing_rows = await get_diagnoses_by_submission(submission_id)
                    for row in existing_rows:
                        status = row.get("status", "")
                        if status == "completed":
                            logger.info(
                                "NATS: skipping diagnosis for %s — existing completed %s",
                                submission_id, row["id"],
                            )
                            await msg.ack()
                            return
                        if status == "in_progress":
                            # Check if it's stale (>5 min old)
                            created = row.get("created_at")
                            if created:
                                age = (datetime.now(timezone.utc) - created.replace(tzinfo=timezone.utc)).total_seconds()
                                if age < 300:
                                    logger.info(
                                        "NATS: skipping diagnosis for %s — recent in_progress %s (age=%ds)",
                                        submission_id, row["id"], int(age),
                                    )
                                    await msg.ack()
                                    return
                                else:
                                    # Stale - mark as failed and create new
                                    logger.info(
                                        "NATS: stale in_progress %s for %s (age=%ds), creating new",
                                        row["id"], submission_id, int(age),
                                    )
                            else:
                                await msg.ack()
                                return

                    logger.info("NATS: evaluation.completed -> triggering AI diagnosis for %s", submission_id)

                    # 获取提交和实验数据
                    submission = await core_client.get_submission(submission_id)
                    experiment = await core_client.get_experiment(experiment_id) if experiment_id else None

                    if submission is None:
                        submission = {"id": submission_id, "student_id": student_id, "code": "", "language": "c"}
                    if experiment is None:
                        experiment = {"id": experiment_id, "title": "实验", "description": "", "category": "", "instructions": ""}

                    # 从 NATS 事件中提取 strace 分析和测试结果
                    strace_summary_data = data.get("strace_summary")
                    test_results_data = data.get("test_results", [])

                    # 如果事件中没有 strace 数据，尝试从 Core Service 获取
                    strace_summary_text = ""
                    if strace_summary_data and isinstance(strace_summary_data, dict):
                        # Use the pre-built human_readable summary from Go analysis
                        strace_summary_text = strace_summary_data.get("human_readable", "")
                        # Also enrich with pattern details
                        patterns = strace_summary_data.get("patterns", [])
                        if patterns and not strace_summary_text:
                            strace_summary_text = "系统调用轨迹分析:\n"
                            for p in patterns:
                                strace_summary_text += f"  [{p.get('severity','')}] {p.get('pattern','')}: {p.get('description','')}\n"
                    elif strace_summary_data is None:
                        # Fallback: try fetching from Core Service
                        try:
                            trace_data = await core_client.get_submission_traces(submission_id, limit=200, errors_only=False)
                            if trace_data and trace_data.get("traces"):
                                traces = trace_data["traces"]
                                error_traces = [t for t in traces if t.get("error_name")]
                                syscall_names = set(t.get("syscall_name", "") for t in traces)
                                strace_summary_text = f"系统调用轨迹摘要: 总计{len(traces)}次调用, {len(error_traces)}次出错, {len(syscall_names)}种不同调用。\n"
                                if error_traces:
                                    strace_summary_text += "错误调用:\n"
                                    for et in error_traces[:10]:
                                        strace_summary_text += f"  {et.get('syscall_name')} → {et.get('error_name')} (PID={et.get('pid')})\n"
                        except Exception as trace_err:
                            logger.debug("Failed to fetch traces as fallback: %s", trace_err)

                    import uuid as _uuid
                    diagnosis_id = str(_uuid.uuid4())

                    await save_diagnosis(
                        diagnosis_id=diagnosis_id,
                        submission_id=submission_id,
                        student_id=student_id,
                        status="in_progress",
                    )

                    # Check if all tests passed - skip LLM for perfect submissions
                    passed_count = submission.get("passed_test_cases", -1)
                    total_count = submission.get("total_test_cases", -1)
                    if passed_count >= 0 and total_count > 0 and passed_count >= total_count:
                        logger.info("NATS: All %d/%d tests passed for %s, skipping LLM", passed_count, total_count, submission_id)
                        exp_title = experiment.get("title", "")
                        exp_cat = experiment.get("category", "")
                        highlights = _build_positive_highlights(exp_cat, exp_title, "")
                        result = DiagnosisResult(
                            diagnosis_id=diagnosis_id, submission_id=submission_id, student_id=student_id,
                            status=DiagnosisStatus.completed, error_type="", severity=Severity.low,
                            root_cause=highlights["summary"],
                            feedback=Feedback(
                                level_1=highlights["level_1"],
                                level_2=highlights["level_2"],
                                level_3=highlights["level_3"],
                            ),
                            related_concepts=highlights["concepts"], related_syscalls=[], suggested_fixes=[],
                            confidence_score=1.0, llm_model="system", llm_tokens_used=0,
                            created_at=datetime.now(timezone.utc), completed_at=datetime.now(timezone.utc),
                        )
                    else:
                        # 多 Agent Harness 诊断 (含降级)
                        try:
                            harness_event = {
                                "submission_id": submission_id,
                                "experiment_id": experiment_id,
                                "student_id": student_id,
                                "strace_summary": strace_summary_data,
                                "test_results": test_results_data or [],
                                "compile_error": submission.get("compile_error"),
                                "runtime_error": submission.get("runtime_error"),
                                "output_score": data.get("output_score", 0),
                                "structure_score": data.get("structure_score", 0),
                                "behavior_score": data.get("behavior_score", 0),
                                "score": data.get("score", 0),
                                "total_score": data.get("total_score", 100),
                                "passed_cases": data.get("passed_cases", 0),
                                "total_cases": data.get("total_cases", 0),
                                "status": data.get("status", ""),
                                "execution_time": data.get("execution_time"),
                                "deductions": data.get("deductions", []),
                                # v2 评分字段
                                "is_qualified": data.get("is_qualified", False),
                                "core_score": data.get("core_score", 0),
                                "edge_score": data.get("edge_score", 0),
                                "test_points": data.get("test_points", []),
                                "ebpf_metrics": data.get("ebpf_metrics"),
                            }

                            ctx = DataCollector.collect(harness_event, submission, experiment)

                            async def _legacy_cb(ctx_pkg):
                                return await diagnosis_service.diagnose_submission(
                                    submission=submission, experiment=experiment,
                                    test_results=test_results_data if test_results_data else None,
                                    strace_summary=strace_summary_text if strace_summary_text else None,
                                )

                            harness_report = await run_diagnosis_with_fallback(
                                ctx, progress_cb=None, legacy_callback=_legacy_cb,
                            )

                            # 持久化到新表
                            try:
                                agent_data = [ar.to_db_dict() for ar in harness_report.agent_results]
                                await save_full_report_with_agents(
                                    harness_report.to_db_dict(), agent_data,
                                )
                                logger.info("NATS: Harness report saved qualified=%s, core=%.1f", harness_report.is_qualified, harness_report.core_score)
                            except Exception as save_err:
                                logger.error("NATS: Failed to save harness report: %s", save_err)

                            # 映射回旧 DiagnosisResult
                            from app.models import Concept, SyscallInfo, SuggestedFix
                            concepts = [Concept(name=c, description=c, type="concept") for c in (harness_report.related_concepts or [])]
                            syscalls = [SyscallInfo(name=s, description=s) for s in (harness_report.related_syscalls or [])]
                            fixes = [SuggestedFix(title=f.get("title",""), description=f.get("description","")) for f in (harness_report.suggested_fixes or [])]
                            # severity 来自 Core is_qualified (非 AI 分数)
                            sev = harness_report.severity or "medium"
                            if sev not in ("low", "medium", "high", "critical"):
                                sev = "medium"
                            result = DiagnosisResult(
                                diagnosis_id=diagnosis_id, submission_id=submission_id, student_id=student_id,
                                status=DiagnosisStatus.completed,
                                error_type="", severity=sev,
                                root_cause=harness_report.summary,
                                feedback=Feedback(
                                    level_1=harness_report.feedback_levels.get("level_1", ""),
                                    level_2=harness_report.feedback_levels.get("level_2", ""),
                                    level_3=harness_report.feedback_levels.get("level_3", ""),
                                ),
                                related_concepts=concepts,
                                related_syscalls=syscalls,
                                suggested_fixes=fixes,
                                confidence_score=harness_report.confidence,
                                llm_model="multi-agent-harness" if not harness_report.degraded else "legacy-fallback",
                                llm_tokens_used=harness_report.llm_tokens_used,
                                created_at=datetime.now(timezone.utc),
                                completed_at=datetime.now(timezone.utc),
                            )
                        except Exception as harness_err:
                            logger.error("NATS: Harness diagnosis failed, falling back to legacy: %s", harness_err)
                            result = await diagnosis_service.diagnose_submission(
                                submission=submission, experiment=experiment,
                                test_results=test_results_data if test_results_data else None,
                                strace_summary=strace_summary_text if strace_summary_text else None,
                            )

                    await save_diagnosis(
                        diagnosis_id=diagnosis_id,
                        submission_id=submission_id,
                        student_id=student_id,
                        status="completed",
                        error_type=result.error_type,
                        severity=result.severity,
                        root_cause=result.root_cause,
                        feedback_l1=result.feedback.level_1,
                        feedback_l2=result.feedback.level_2,
                        feedback_l3=result.feedback.level_3,
                        related_concepts=json.dumps([c.model_dump() for c in result.related_concepts], ensure_ascii=False),
                        related_syscalls=json.dumps([s.model_dump() for s in result.related_syscalls], ensure_ascii=False),
                        suggested_fixes=json.dumps([f.model_dump() for f in result.suggested_fixes], ensure_ascii=False),
                        confidence_score=result.confidence_score,
                        llm_model=result.llm_model,
                        llm_tokens_used=result.llm_tokens_used,
                    )

                    logger.info("NATS: AI diagnosis %s completed for submission %s (tokens=%s)", diagnosis_id, submission_id, result.llm_tokens_used)

                    await msg.ack()

                except Exception as e:
                    logger.error("NATS handler error for %s: %s", submission_id, e, exc_info=True)
                    # ── Fix: update diagnosis status to 'failed' on error ──
                    if diagnosis_id:
                        try:
                            await save_diagnosis(
                                diagnosis_id=diagnosis_id,
                                submission_id=submission_id,
                                student_id=student_id,
                                status="failed",
                            )
                            logger.info("NATS: marked diagnosis %s as failed after error", diagnosis_id)
                        except Exception as save_err:
                            logger.error("NATS: failed to save diagnosis failure status: %s", save_err)
                    await msg.nak()

            # Subscribe to evaluation.completed (durable, WorkQueue 单 consumer)。
            # uvicorn --reload 进程重叠时会出现短暂的 "already bound" 竞态，
            # 由外层重试循环自愈（旧进程退出后即可绑定），属可接受的瞬态。
            await js.subscribe("evaluation.completed", cb=on_evaluation_completed, durable="ai-service")
            logger.info("NATS: subscribed to evaluation.completed")

            # Keep running
            while True:
                await asyncio.sleep(1)

        except Exception as e:
            logger.warning("NATS connection failed, retrying in 5s: %s", e)
            await asyncio.sleep(5)
        finally:
            if nc:
                await nc.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _nats_task

    # Startup
    logger.info("AI Service starting on :%s", settings.port)

    # Validate LLM config
    llm_warnings = settings.validate_llm_config()
    for warning in llm_warnings:
        logger.warning("⚠️  [LLM CONFIG] %s", warning)
    if not llm_warnings:
        logger.info("LLM config validated: provider=%s model=%s", settings.llm_provider, settings.llm_model or "default")

    # Initialize DB pool
    try:
        await init_db()
        logger.info("PostgreSQL pool initialized")
    except Exception as e:
        logger.error("PostgreSQL init failed: %s", e)

    # Start NATS subscriber in background
    _nats_task = asyncio.create_task(_nats_subscriber())

    yield

    # Shutdown
    _nats_task.cancel()
    await close_db()
    logger.info("AI Service shutting down")


app = FastAPI(
    title="TraceOS AI Service",
    description="AI 诊断服务 - LLM 驱动",
    version="2.2.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(diagnosis.router, prefix="/api/ai")
app.include_router(hints.router, prefix="/api/ai")
app.include_router(comment_reply.router, prefix="/api/ai")
app.include_router(class_analysis.router, prefix="/api/ai")
app.include_router(chat.router, prefix="/api/ai")
# app.include_router(knowledge.router)  # TODO: module not found
# app.include_router(rag.router)  # TODO: module not found
app.include_router(v1_proxy.router)
app.include_router(ask_router.router, prefix="/api/ai")
app.include_router(import_router.router)
app.include_router(adaptive.router)
app.include_router(code_audit.router)
app.include_router(report_eval.router, prefix="/api/ai/report")
app.include_router(flamegraph_analysis.router, prefix="/api/ai")
app.include_router(ebpf_analysis.router, prefix="/api/ai")
app.include_router(trace_analysis.router, prefix="/api/ai")
app.include_router(deadlock_analysis.router, prefix="/api/ai")
app.include_router(diagnosis_insights.router, prefix="/api/ai")
app.include_router(experiment_chat_stream.router, prefix="/api/ai")
app.include_router(memory.router, prefix="/api/ai")


@app.get("/healthz", response_model=HealthResponse)
async def healthz():
    return HealthResponse(
        status="healthy",
        service=settings.service_name,
        mode="live",
        uptime_seconds=round(time.time() - START_TIME, 1),
        timestamp=datetime.now(timezone.utc),
    )


@app.get("/")
async def root():
    return {
        "service": settings.service_name,
        "mode": "live (LLM)",
        "docs": "/docs",
        "endpoints": {
            "healthz": "/healthz",
            "diagnose": "/api/ai/diagnose",
            "diagnose_stream": "/api/ai/diagnose/{id}/stream",
            "hints": "/api/ai/hints/{diagnosis_id}/{level}",
            "comment-reply": "/api/ai/comment-reply",
        },
    }
