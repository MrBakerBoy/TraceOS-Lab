"""诊断业务服务 - 编排诊断全流程（含 RAG 注入）"""

import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Any

from app.models import (
    Concept,
    DiagnosisResult,
    DiagnosisStatus,
    Feedback,
    Severity,
    SuggestedFix,
    SyscallInfo,
)
from app.services.llm_client import llm_provider, LLMResponse
from app.services.prompt_builder import build_diagnosis_prompt, build_hints_prompt, inject_rag_context
from app.services.result_parser import parse_diagnosis_response
import hashlib
import time
import asyncio
from app.config import settings

logger = logging.getLogger(__name__)

# In-memory diagnosis result cache (TTL-based)
_diagnosis_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = asyncio.Lock()
CACHE_TTL_SECONDS = 3600  # 1 hour


class DiagnosisService:
    """AI 诊断业务服务"""

    async def diagnose_submission(
        self,
        submission: dict[str, Any],
        experiment: dict[str, Any],
        test_results: list[dict[str, Any]] | None = None,
        strace_summary: str | None = None,
        course_id: str | None = None,
    ) -> DiagnosisResult:
        """对提交进行 AI 诊断（可选 RAG 增强）"""
        experiment_instructions = (
            experiment.get("instructions") or
            experiment.get("description") or
            ""
        )

        # 0. Check in-memory cache first
        # Cache key now includes test results and strace summary to prevent
        # incorrect cache hits when the same code produces different runtime behavior
        cache_parts = [
            submission.get("code", ""),
            experiment.get("id", ""),
            submission.get("language", "c"),
            json.dumps(test_results or [], sort_keys=True),
            strace_summary or "",
        ]
        cache_key = hashlib.sha256(
            "|".join(cache_parts).encode()
        ).hexdigest()
        async with _cache_lock:
            if cache_key in _diagnosis_cache:
                cached_time, cached_data = _diagnosis_cache[cache_key]
                if time.time() - cached_time < CACHE_TTL_SECONDS:
                    logger.info("Diagnosis cache HIT for key=%s", cache_key[:16])
                    cached_data["diagnosis_id"] = str(uuid.uuid4())
                    return DiagnosisResult(**cached_data)

        # 1. Construct prompt
        system_prompt, user_prompt = build_diagnosis_prompt(
            code=submission.get("code", ""),
            experiment_title=experiment.get("title", ""),
            experiment_description=experiment.get("description", ""),
            language=submission.get("language", "c"),
            compile_error=submission.get("compile_error"),
            runtime_error=submission.get("runtime_error"),
            test_results=test_results,
            strace_summary=strace_summary,
            experiment_category=experiment.get("category", ""),
            experiment_instructions=experiment_instructions,
        )

        # 2. RAG injection
        if course_id and settings.rag_enabled and settings.rag_diagnosis_enabled:
            try:
                from app.services.rag_injector import rag_injector
                rag_ctx = await rag_injector.inject_diagnosis_context(
                    course_id=course_id,
                    code=submission.get("code", ""),
                    experiment_title=experiment.get("title", ""),
                    experiment_category=experiment.get("category", ""),
                )
                if rag_ctx:
                    system_prompt, user_prompt = inject_rag_context(system_prompt, user_prompt, rag_ctx)
                    logger.info("RAG context injected for diagnosis, course=%s", course_id)
            except ImportError:
                logger.debug("RAG injector not available, skipping")
            except Exception as e:
                logger.warning("RAG injection failed for diagnosis, falling back to LLM-only: %s", e)

        # 3. Call LLM
        llm_resp: LLMResponse = await llm_provider.chat_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.3,
            max_tokens=4096,
            response_format={"type": "json_object"},
        )

        # 4. Parse result
        result = self._parse_response(llm_resp.content, submission)

        # 5. Record LLM usage
        result.llm_model = llm_resp.model
        result.llm_tokens_used = llm_resp.total_tokens

        # 6. Cache result (in-memory, TTL)
        async with _cache_lock:
            _diagnosis_cache[cache_key] = (time.time(), {
                "submission_id": submission.get("id", ""),
                "student_id": submission.get("student_id", ""),
                "status": "completed",
                "error_type": result.error_type,
                "severity": result.severity,
                "root_cause": result.root_cause,
                "feedback": result.feedback.model_dump(),
                "related_concepts": [c.model_dump() for c in result.related_concepts],
                "related_syscalls": [s.model_dump() for s in result.related_syscalls],
                "suggested_fixes": [f.model_dump() for f in result.suggested_fixes],
                "confidence_score": result.confidence_score,
                "llm_model": result.llm_model,
                "llm_tokens_used": result.llm_tokens_used,
                "created_at": result.created_at.isoformat() if result.created_at else None,
                "completed_at": result.completed_at.isoformat() if result.completed_at else None,
            })

        return result

    async def generate_hints(
        self,
        diagnosis: dict[str, Any],
        code: str,
        language: str,
        level: int,
        course_id: str | None = None,
    ) -> dict[str, Any]:
        """生成渐进式提示（可选 RAG 增强）"""
        system_prompt, user_prompt = build_hints_prompt(diagnosis, level, code, language)

        # RAG injection (Phase 2)
        if course_id and settings.rag_enabled and settings.rag_hints_enabled:
            try:
                from app.services.rag_injector import rag_injector
                rag_ctx = await rag_injector.inject_hints_context(
                    course_id=course_id,
                    diagnosis_result=diagnosis,
                    code=code,
                )
                if rag_ctx:
                    system_prompt, user_prompt = inject_rag_context(system_prompt, user_prompt, rag_ctx)
            except Exception as e:
                logger.warning("RAG injection failed for hints: %s", e)

        llm_resp = await llm_provider.chat_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.5,
            max_tokens=4096,
        )

        return {
            "level": level,
            "hint": llm_resp.content,
            "explanation": diagnosis.get("root_cause", ""),
        }

    def _parse_response(
        self, raw: str, submission: dict[str, Any]
    ) -> DiagnosisResult:
        """Parse LLM response"""
        data = parse_diagnosis_response(raw)

        now = datetime.now(timezone.utc)
        return DiagnosisResult(
            diagnosis_id=str(uuid.uuid4()),
            submission_id=submission.get("id", ""),
            student_id=submission.get("student_id", ""),
            status=DiagnosisStatus.completed,
            error_type=data.get("error_type"),
            severity=data.get("severity", Severity.medium),
            root_cause=data.get("root_cause"),
            feedback=Feedback(**data.get("feedback", {})),
            related_concepts=[Concept(**c) for c in data.get("related_concepts", [])],
            related_syscalls=[SyscallInfo(**s) for s in data.get("related_syscalls", [])],
            suggested_fixes=[SuggestedFix(**f) for f in data.get("suggested_fixes", [])],
            confidence_score=float(data.get("confidence_score", 0.7)),
            created_at=now,
            completed_at=now,
        )


# Module-level singleton
diagnosis_service = DiagnosisService()
