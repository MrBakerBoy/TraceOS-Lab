"""Ask Router — 提问侧单 Agent 入口。

Handles: POST /api/ai/ask
Proxied by v1_proxy: POST /api/v1/courses/{id}/ask → this endpoint.
"""

import logging, time
from typing import Optional, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.middleware.auth import get_optional_user, UserContext
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ask", tags=["ask"])


class AskMessage(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    question: str
    experiment_id: Optional[str] = None
    experiment_title: Optional[str] = None
    experiment_description: Optional[str] = None
    experiment_instructions: Optional[str] = None
    student_code: Optional[str] = None
    language: Optional[str] = "c"
    category: Optional[str] = None
    history: Optional[List[AskMessage]] = None
    use_rag: bool = True
    course_id: Optional[str] = None
    compile_error: Optional[str] = None
    runtime_error: Optional[str] = None
    test_results: Optional[List[dict]] = None
    strace_summary: Optional[str] = None


class AskResponse(BaseModel):
    reply: str
    sources: List[dict] = []
    harness: Optional[dict] = None


@router.post("", response_model=AskResponse)
async def ask(body: AskRequest, user=Depends(get_optional_user)):
    """处理单 Agent 提问请求。"""
    t0 = time.time()

    context = {
        "user_id": user.user_id if user else "anonymous",
        "course_id": body.course_id or "",
        "experiment_id": body.experiment_id or "",
        "experiment_title": body.experiment_title or "",
        "experiment_description": body.experiment_description or "",
        "experiment_instructions": body.experiment_instructions or "",
        "experiment_category": body.category or "",
        "code": body.student_code or "",
        "language": body.language or "c",
        "compile_error": body.compile_error or "",
        "runtime_error": body.runtime_error or "",
        "test_results": body.test_results,
        "strace_summary": body.strace_summary or "",
        "use_rag": body.use_rag,
    }

    if body.history:
        context["history"] = [{"role": h.role, "content": h.content} for h in body.history]

    try:
        from app.agents.teaching_assistant import run_agent_pipeline
        state = await run_agent_pipeline(body.question, context)

        from app.agents.harness_adapter import to_ask_reply
        result = to_ask_reply(state)

        logger.info("Ask: intent=%s conf=%.2f time=%.0fms",
                    state.intent, state.intent_confidence,
                    (time.time() - t0) * 1000)

        return AskResponse(
            reply=result["reply"],
            sources=result.get("sources", []),
            harness=result.get("harness"),
        )

    except Exception as e:
        logger.error("Agent pipeline failed: %s", e)
        return AskResponse(
            reply="抱歉，AI 服务处理请求时出现问题。请稍后重试。",
            sources=[],
            harness=None,
        )
