"""Memory Router — L1/L3 memory compression and extraction endpoints.

Endpoints:
  POST /api/ai/memory/compress — Compress conversation turns into structured summary
  POST /api/ai/memory/extract-ltm — Extract long-term memories from conversation summary
"""

import json
import logging
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.llm_client import get_llm_provider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/memory", tags=["memory"])


class CompressRequest(BaseModel):
    """Request to compress a batch of conversation messages."""
    messages: list[dict]  # [{role, content, turn_index, importance}, ...]
    existing_summary: Optional[str] = None
    existing_key_facts: Optional[list] = None


class CompressResponse(BaseModel):
    """Compression result."""
    incremental_summary: str
    full_summary: str
    key_facts: list[dict]
    compressed_turn_count: int


class ExtractLTMRequest(BaseModel):
    """Request to extract long-term memories from a conversation."""
    user_id: str
    experiment_id: Optional[str] = None
    full_summary: str
    key_facts: list
    student_profile: Optional[dict] = None


class ExtractLTMResponse(BaseModel):
    """Extracted long-term memories."""
    memories: list[dict]


@router.post("/compress", response_model=CompressResponse)
async def compress_conversation(body: CompressRequest):
    """Compress a batch of conversation messages into structured summary.

    Called by Go core service when compression threshold is reached
    (uncompressed turns >= 12 and non-key turns >= 8, or tokens > 2000).
    """
    llm = get_llm_provider()

    # Build conversation text from messages needing compression
    conv_parts = []
    for msg in body.messages:
        role_label = {"user": "[学生]", "assistant": "[小T]", "tool": "[工具]"}.get(msg.get("role", ""), f"[{msg.get('role', '')}]")
        content = msg.get("content", "")[:500]  # truncate for compression prompt
        importance = msg.get("importance", 0.5)
        conv_parts.append(f"{role_label} (importance={importance:.1f}): {content}")

    conv_text = "\n---\n".join(conv_parts)

    existing_context = ""
    if body.existing_summary:
        existing_context = f"\n已有对话摘要:\n{body.existing_summary[:1000]}"

    prompt = f"""将以下操作系统实验教学对话压缩成结构化 JSON 摘要。

保留: 用户的核心疑问、AI的诊断结论、关键OS概念、当前学习状态。
丢弃: 闲聊、重复尝试、已解决的中间步骤。
{existing_context}

对话:
{conv_text[:6000]}

输出 JSON:
{{
  "user_goal": "学生当前的核心目标 (1句话)",
  "key_concepts": ["涉及的OS概念"],
  "diagnosis_conclusions": ["AI给出的诊断结论"],
  "code_issues_found": ["发现的代码问题"],
  "hints_given": ["给过的提示"],
  "current_status": "学生的当前状态 (困惑/理解中/接近解决)",
  "pending_questions": ["学生还没解决的问题"],
  "key_facts": [
    {{"fact": "一句关键事实", "importance": 0.8}}
  ]
}}

只输出 JSON，不要其他内容。"""

    try:
        resp = await llm.chat_completion_with_messages(
            [{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=512,
        )
        result = json.loads(resp.content)

        # Merge with existing summary
        new_summary = f"学生目标: {result.get('user_goal', '')}\n"
        new_summary += f"涉及概念: {', '.join(result.get('key_concepts', []))}\n"
        new_summary += f"诊断结论: {'; '.join(result.get('diagnosis_conclusions', []))}\n"
        new_summary += f"当前状态: {result.get('current_status', '')}"

        full_summary = ""
        if body.existing_summary:
            full_summary = body.existing_summary + "\n---\n" + new_summary
        else:
            full_summary = new_summary

        # Merge key_facts (deduplicate and keep top 10)
        existing_facts = body.existing_key_facts or []
        new_facts = result.get("key_facts", [])
        all_facts = existing_facts + new_facts
        seen = set()
        unique_facts = []
        for f in sorted(all_facts, key=lambda x: x.get("importance", 0.5), reverse=True):
            fact_text = f.get("fact", "")
            if fact_text and fact_text not in seen:
                seen.add(fact_text)
                unique_facts.append(f)
        unique_facts = unique_facts[:10]

        return CompressResponse(
            incremental_summary=new_summary,
            full_summary=full_summary[:2000],
            key_facts=unique_facts,
            compressed_turn_count=len(body.messages),
        )
    except json.JSONDecodeError:
        logger.warning("Compression LLM returned invalid JSON, using rule-based fallback")
        # Rule-based fallback: keep high-importance messages as key_facts
        key_msgs = [m for m in body.messages if m.get("importance", 0) >= 0.7]
        key_facts = [{"fact": m["content"][:200], "importance": m.get("importance", 0.7)} for m in key_msgs[:5]]
        return CompressResponse(
            incremental_summary=f"压缩了 {len(body.messages)} 条消息 (规则回退)",
            full_summary=(body.existing_summary or ""),
            key_facts=key_facts,
            compressed_turn_count=len(body.messages),
        )
    except Exception as e:
        logger.error("Compression failed: %s", e)
        return CompressResponse(
            incremental_summary=f"压缩失败: {e}",
            full_summary=(body.existing_summary or ""),
            key_facts=[],
            compressed_turn_count=0,
        )


@router.post("/extract-ltm", response_model=ExtractLTMResponse)
async def extract_long_term_memories(body: ExtractLTMRequest):
    """Extract long-term memories from a completed/archived conversation.

    Called by Go core service when a conversation is closed or archived.
    """
    llm = get_llm_provider()

    profile_text = ""
    if body.student_profile:
        profile_text = json.dumps(body.student_profile, ensure_ascii=False)[:500]

    facts_text = json.dumps(body.key_facts[:10], ensure_ascii=False)[:1000]

    prompt = f"""从以下 OS 教学对话中提取长期记忆。

学生画像: {profile_text}

对话摘要: {body.full_summary[:2000]}

关键事实: {facts_text}

提取以下类型的长期记忆:
- concept_mastered: 学生已掌握的OS概念
- common_mistake: 学生反复犯的错误
- effective_strategy: 对该学生有效的教学策略
- user_preference: 学生的偏好 (如: 更喜欢比喻、需要更具体的提示)

输出 JSON:
{{
  "memories": [
    {{"type": "common_mistake", "content": "...", "importance": 0.8}}
  ]
}}

只输出 JSON，不要其他内容。最多提取 5 条。"""

    try:
        resp = await llm.chat_completion_with_messages(
            [{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=512,
        )
        result = json.loads(resp.content)
        return ExtractLTMResponse(memories=result.get("memories", [])[:5])
    except Exception as e:
        logger.error("LTM extraction failed: %s", e)
        return ExtractLTMResponse(memories=[])