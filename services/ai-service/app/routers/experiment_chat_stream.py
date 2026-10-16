"""Streaming chat endpoint — SSE streaming via the single teaching agent.

POST /api/ai/experiments/{experiment_id}/chat/stream

Returns text/event-stream with OpenAI-compatible delta chunks.
The teaching agent runs synchronously; reply text is streamed paragraph-by-paragraph
for a visual typing effect.
"""

import asyncio, json, logging, time, traceback, uuid
from typing import Optional, List, AsyncGenerator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.middleware.auth import get_optional_user, UserContext

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/experiments", tags=["experiment-chat-stream"])


class StreamMessage(BaseModel):
    role: str
    content: str


class ChatStreamRequest(BaseModel):
    messages: List[StreamMessage]
    experiment_id: Optional[str] = None
    course_id: Optional[str] = None
    experiment_title: Optional[str] = None
    experiment_description: Optional[str] = None
    experiment_instructions: Optional[str] = None
    experiment_category: Optional[str] = None
    code: Optional[str] = None
    language: Optional[str] = "c"
    conversation_id: Optional[str] = None
    use_rag: bool = True
    # Detection data fields (injected by Go proxy)
    compile_error: Optional[str] = None
    runtime_error: Optional[str] = None
    test_results: Optional[list] = None
    strace_summary: Optional[dict] = None
    deadlock: Optional[dict] = None
    last_diagnosis: Optional[dict] = None
    student_profile: Optional[dict] = None
    conversation_summary: Optional[str] = None
    key_facts: Optional[list] = None
    long_term_memories: Optional[list] = None
    history: Optional[list] = None


def _sse(data: dict | str) -> str:
    if isinstance(data, str):
        return f"data: {data}\n\n"
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _chunk_id() -> str:
    return f"chatcmpl-{uuid.uuid4().hex[:12]}"


async def _generate_stream(
    body: ChatStreamRequest,
    user: Optional[UserContext],
    experiment_id: str,
) -> AsyncGenerator[str, None]:
    t0 = time.time()
    chunk_id = _chunk_id()

    user_message = ""
    for m in reversed(body.messages):
        if m.role == "user":
            user_message = m.content
            break
    if not user_message:
        yield _sse({"error": "No user message found"})
        yield _sse("[DONE]")
        return

    context = {
        "user_id": user.user_id if user else "anonymous",
        "course_id": body.course_id or "",
        "experiment_id": experiment_id or body.experiment_id or "",
        "experiment_title": body.experiment_title or "",
        "experiment_description": body.experiment_description or "",
        "experiment_instructions": body.experiment_instructions or "",
        "experiment_category": body.experiment_category or "",
        "code": body.code or "",
        "language": body.language or "c",
        "use_rag": body.use_rag,
        "conversation_id": body.conversation_id or f"conv_{uuid.uuid4().hex[:8]}",
        # Detection data (from Go proxy)
        "compile_error": body.compile_error or "",
        "runtime_error": body.runtime_error or "",
        "test_results": body.test_results or [],
        "strace_summary": body.strace_summary or {},
        "deadlock": body.deadlock or {},
        "last_diagnosis": body.last_diagnosis or {},
        "student_profile": body.student_profile or {},
        "conversation_summary": body.conversation_summary or "",
        "key_facts": body.key_facts or [],
        "long_term_memories": body.long_term_memories or [],
    }

    history_msgs = [{"role": m.role, "content": m.content} for m in body.messages[:-1] if m.role in ("user", "assistant")]
    if history_msgs:
        context["history"] = history_msgs
    # If Go proxy provided richer history, prefer it
    if body.history:
        context["history"] = body.history

    try:
        # Emit pipeline start event
        stages = [
            {"name": "guard", "label": "输入守卫", "status": "running"},
            {"name": "intent", "label": "意图判断", "status": "pending"},
            {"name": "rag", "label": "RAG 检索", "status": "pending"},
            {"name": "agent", "label": "单 Agent 推理", "status": "pending"},
            {"name": "outguard", "label": "输出守卫", "status": "pending"},
        ]
        yield _sse({"type": "stage", "data": stages})
        await asyncio.sleep(0.02)

        from app.agents.teaching_assistant import run_agent_pipeline
        from app.agents.harness_adapter import to_chat_reply

        state = await run_agent_pipeline(user_message, context)
        result = to_chat_reply(state)

        # Mark all stages as done
        for s in stages:
            s["status"] = "done"
        yield _sse({"type": "stage", "data": stages})
        await asyncio.sleep(0.02)

        reply = result.get("reply", "")
        harness = result.get("harness")
    except Exception as e:
        logger.error("Agent pipeline failed: %s\n%s", e, traceback.format_exc())
        yield _sse({
            "id": chunk_id, "object": "chat.completion.chunk",
            "choices": [{"index": 0, "delta": {"content": "抱歉，AI 服务处理请求时出现问题。请稍后重试。"}, "finish_reason": "error"}],
        })
        yield _sse("[DONE]")
        return

    import re
    paragraphs = re.split(r"(\n\n+)", reply)

    for segment in paragraphs:
        if not segment:
            continue
        yield _sse({
            "id": chunk_id, "object": "chat.completion.chunk",
            "created": int(time.time()), "model": "traceos-agent",
            "choices": [{"index": 0, "delta": {"content": segment}, "finish_reason": None}],
        })
        await asyncio.sleep(0.03)

    yield _sse({
        "id": chunk_id, "object": "chat.completion.chunk",
        "created": int(time.time()), "model": "traceos-agent",
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
    })

    if harness:
        yield _sse({"type": "harness", "data": harness})

    yield _sse("[DONE]")
    logger.info("Stream chat: experiment=%s time=%.0fms", experiment_id, (time.time() - t0) * 1000)


@router.post("/{experiment_id}/chat/stream")
async def chat_stream(
    experiment_id: str,
    body: ChatStreamRequest,
    request: Request,
    user=Depends(get_optional_user),
):
    return StreamingResponse(
        _generate_stream(body, user, experiment_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )