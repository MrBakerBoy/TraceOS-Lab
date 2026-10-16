"""Chat Router — 提问侧单 Agent 入口。

Handles: POST /api/ai/chat
Proxied by Go core-service: POST /api/v1/experiments/{id}/ai-chat → this endpoint.

所有 LLM 交互走 run_agent_pipeline()（单 Agent）：
  - 输入守卫（PII/注入/范围）
  - 确定性意图判断
  - RAG 检索
  - DiagnosisTutorAgent 单次调用
  - 输出守卫（诊断场景防答案泄露）
"""

import logging, time, traceback
from typing import Optional, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.middleware.auth import get_optional_user, UserContext
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: Optional[List[ChatMessage]] = None
    experiment_id: Optional[str] = None
    use_rag: bool = True
    course_id: Optional[str] = None
    question: Optional[str] = None
    experiment_title: Optional[str] = None
    experiment_description: Optional[str] = None
    experiment_instructions: Optional[str] = None
    student_code: Optional[str] = None
    language: Optional[str] = "c"
    category: Optional[str] = None
    history: Optional[List[ChatMessage]] = None
    compile_error: Optional[str] = None
    runtime_error: Optional[str] = None
    # Phase 2: Detection data injection
    test_results: Optional[list] = None
    strace_summary: Optional[dict] = None
    deadlock: Optional[dict] = None
    last_diagnosis: Optional[dict] = None
    student_profile: Optional[dict] = None
    conversation_summary: Optional[str] = None
    key_facts: Optional[list] = None
    long_term_memories: Optional[list] = None


class ChatResponse(BaseModel):
    reply: str
    sources: list = []
    harness: Optional[dict] = None


@router.post("", response_model=ChatResponse)
async def chat(body: ChatRequest, user=Depends(get_optional_user)):
    """处理单 Agent 提问请求。"""
    t0 = time.time()

    # Extract the user message
    user_message = ""
    if body.question:
        user_message = body.question
    elif body.messages:
        for m in reversed(body.messages):
            if m.role == "user":
                user_message = m.content
                break

    if not user_message:
        return ChatResponse(reply="Please provide a question or message.", sources=[])

    # Build context dict for the agent pipeline
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
        "use_rag": body.use_rag,
        # Phase 2: Detection data
        "test_results": body.test_results or [],
        "strace_summary": body.strace_summary,
        "deadlock": body.deadlock,
        "last_diagnosis": body.last_diagnosis,
        "student_profile": body.student_profile,
        "conversation_summary": body.conversation_summary,
        "key_facts": body.key_facts or [],
    }

    # Use conversation history from request
    if body.history:
        context["history"] = [{"role": h.role, "content": h.content} for h in body.history]

    try:
        from app.agents.teaching_assistant import run_agent_pipeline
        state = await run_agent_pipeline(user_message, context)
        from app.agents.harness_adapter import to_chat_reply
        result = to_chat_reply(state)

        logger.info("Chat: intent=%s conf=%.2f tokens=%.0f%% time=%.0fms",
                    result.get("harness", {}).get("intent", "?"),
                    result.get("harness", {}).get("intent_confidence", 0),
                    result.get("harness", {}).get("utilization_pct", 0),
                    (time.time() - t0) * 1000)

        return ChatResponse(
            reply=result["reply"],
            sources=result.get("sources", []),
            harness=result.get("harness"),
        )

    except Exception as e:
        logger.error("Agent pipeline failed: %s\n%s", e, traceback.format_exc())
        return ChatResponse(
            reply="抱歉，AI 服务处理请求时出现问题。请稍后重试。",
            sources=[],
            harness=None,
        )
