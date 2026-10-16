"""AI 评论回复路由 — 学生提问 AI 自动回复"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.llm_client import llm_provider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/comment-reply", tags=["comment-reply"])


class CommentReplyRequest(BaseModel):
    question: str
    experiment_id: str
    experiment_title: str = ""
    category: str = ""


class CommentReplyResponse(BaseModel):
    reply: str
    created_at: datetime


SYSTEM_PROMPT = """你是 TraceOS Lab 的 AI 教学助手，专门回答学生在实验评论区提出的问题。

你的回复原则：
1. 引导思考，而非直接给出完整答案
2. 如果学生问的是代码错误，先分析错误原因，再给出修复方向
3. 使用简洁清晰的中文
4. 如果问题与当前实验无关，礼貌地引导回实验主题
5. 回复长度控制在 200 字以内
6. 使用 Markdown 格式让回复更清晰"""


@router.post("", response_model=CommentReplyResponse)
async def reply_to_comment(req: CommentReplyRequest) -> CommentReplyResponse:
    """AI 回复学生在评论区的提问"""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    context_parts = []
    if req.experiment_title:
        context_parts.append(f"实验标题: {req.experiment_title}")
    if req.category:
        context_parts.append(f"实验分类: {req.category}")

    context_str = "\n".join(context_parts) if context_parts else "无实验上下文"

    user_prompt = f"""实验上下文:
{context_str}

学生问题:
{req.question}

请根据实验上下文，用教学引导的方式回答学生的问题。"""

    try:
        reply_resp = await llm_provider.chat_completion(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.5,
            max_tokens=1024,
        )

        reply = reply_resp.content if hasattr(reply_resp, "content") else str(reply_resp)

        if not reply or not reply.strip():
            reply = "抱歉，我暂时无法回答这个问题。请尝试换一种方式描述你的疑问，或者等待教师回复。"

        return CommentReplyResponse(
            reply=reply.strip(),
            created_at=datetime.now(timezone.utc),
        )

    except Exception as e:
        logger.error("AI comment reply failed: %s", e, exc_info=True)
        raise HTTPException(status_code=503, detail=f"AI service error: {e}")
