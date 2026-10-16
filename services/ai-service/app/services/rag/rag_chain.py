"""
RAG Chain — high-level orchestration for knowledge-base Q&A with citations.

Layering (single retrieval, single ingestion):
  search_only   -> hybrid_retriever only, returns references + meta
  answer        -> guard + retrieve + rerank + LLM (with [n] citations) + references
  answer_stream -> same as answer, but SSE-streamed for the typing effect
  export        -> markdown export of a conversation with its references

This module is the ONLY entry point for the /rag endpoints. It does NOT reuse
the experiment diagnosis tutor (DiagnosisTutorAgent); that agent is bound to
experiment context. RAG Q&A here is general knowledge Q&A bound to course_id.
"""
import asyncio
import json
import logging
import re
import time
from typing import Any, AsyncIterator, Optional

from app.services.rag.config import rag_config

logger = logging.getLogger(__name__)

NL = chr(10)

# Citation marker: matches the [n] superscripts the LLM is asked to emit.
_CITE_RE = re.compile(r"\[(\d{1,2})\]")


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _get_retriever():
    from app.services.rag.hybrid_retriever import hybrid_retriever
    return hybrid_retriever


def _get_llm():
    from app.services.llm_client import get_llm_provider
    return get_llm_provider()


def _get_input_guard():
    from app.agents.guardrails import get_input_guard
    return get_input_guard()


def _extract_keywords(query: str, content: str, limit: int = 6) -> list[str]:
    """Cheap keyword overlap for the reference panel (matched_keywords)."""
    q_tokens = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}|[\u4e00-\u9fff]{2,}", query.lower()))
    matched = []
    for tok in q_tokens:
        if tok in content.lower() and tok not in matched:
            matched.append(tok)
        if len(matched) >= limit:
            break
    return matched


def _to_reference(row: dict, index: int, query: str = "") -> dict[str, Any]:
    """Normalize a retriever row into the frontend reference contract."""
    tags = row.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    return {
        "id": str(row.get("id") or row.get("chunk_id") or ""),
        "entry_id": str(row.get("entry_id") or ""),
        "title": row.get("title") or "未命名文档",
        "knowledge_type": row.get("knowledge_type") or "course_notes",
        "tags": tags,
        "chunk_index": int(row.get("chunk_index") or 0),
        "content": row.get("content") or "",
        "similarity": round(float(row.get("similarity") or 0.0), 4),
        "start_offset": row.get("start_offset"),
        "end_offset": row.get("end_offset"),
        "matched_keywords": _extract_keywords(query, row.get("content") or ""),
        "index": index + 1,
    }


class RAGChain:
    """Course-level knowledge Q&A with citation-aware references."""

    async def search_only(
        self,
        course_id: str,
        query: str,
        top_k: int | None = None,
        source_types: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Pure semantic search — returns references (no answer)."""
        retriever = _get_retriever()
        results, meta = await retriever.search_with_meta(
            course_id, query,
            top_k=top_k or rag_config.top_k,
            source_types=source_types,
            use_rerank=True,
        )
        references = [_to_reference(r, i, query) for i, r in enumerate(results)]
        return {"results": references, "retrieval_meta": meta}

    async def _retrieve(
        self,
        course_id: str,
        query: str,
        top_k: int | None = None,
        source_types: Optional[list[str]] = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        retriever = _get_retriever()
        results, meta = await retriever.search_with_meta(
            course_id, query,
            top_k=top_k or rag_config.top_k,
            source_types=source_types,
            use_rerank=True,
        )
        return results, meta

    def _build_context(self, results: list[dict[str, Any]]) -> str:
        """Build a citation-annotated context block for the LLM prompt."""
        if not results:
            return ""
        parts = ["## 知识库检索结果", ""]
        total = 0
        max_chars = rag_config.max_context_tokens * 3
        for i, r in enumerate(results):
            title = r.get("title") or "未命名文档"
            content = (r.get("content") or "").strip()
            block = f"[{i + 1}] 来源《{title}》：\n{content}"
            if total + len(block) > max_chars:
                break
            parts.append(block)
            parts.append("")
            total += len(block)
        return NL.join(parts).strip()

    def _system_prompt(self) -> str:
        return (
            "你是一名操作系统实验课程的智能知识库助教。请基于下方提供的知识库检索结果回答用户问题。\n\n"
            "要求：\n"
            "1. 优先依据检索结果回答，检索结果不足时可结合你的通用知识补充，但要明确指出。\n"
            "2. 当你引用某条检索结果时，必须在对应句末加上引用上角标 [n]，n 为该结果的编号。\n"
            "3. 支持 Markdown 表格与代码块，结构清晰、重点突出。\n"
            "4. 不要编造检索结果中不存在的具体数据或出处。\n"
            "5. 用中文回答（代码、术语除外）。"
        )

    async def _generate(self, question: str, history: list[dict], context: str) -> str:
        llm = _get_llm()
        user_parts = []
        if context:
            user_parts.append(context)
            user_parts.append("")
        user_parts.append("用户问题：")
        user_parts.append(question)
        user_prompt = NL.join(user_parts)

        messages: list[dict[str, str]] = [
            {"role": "system", "content": self._system_prompt()},
        ]
        for h in (history or [])[-6:]:
            role = h.get("role")
            content = h.get("content")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": str(content)[:2000]})
        messages.append({"role": "user", "content": user_prompt})

        resp = await llm.chat_completion_with_messages(
            messages, temperature=0.4, max_tokens=8192,
        )
        return resp.content

    async def answer(
        self,
        course_id: str,
        question: str,
        history: Optional[list[dict]] = None,
        top_k: int | None = None,
        source_types: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Non-streaming RAG answer with references."""
        started = time.perf_counter()

        # 1. Input guard
        guard = _get_input_guard()
        checks = await guard.check(question)
        if not guard.is_allowed():
            return {
                "answer": "抱歉，你的消息包含不允许的内容，请调整后重试。",
                "references": [],
                "retrieval_meta": {
                    "mode": "blocked",
                    "recalled": 0,
                    "reranked": 0,
                    "passed_threshold": 0,
                    "threshold": rag_config.similarity_threshold,
                    "elapsed_ms": int((time.perf_counter() - started) * 1000),
                },
                "blocked": True,
                "blocked_reason": guard.blocked_reason(),
            }

        # 2. Retrieve + rerank
        results, meta = await self._retrieve(course_id, question, top_k, source_types)

        # 3. Build context + generate
        context = self._build_context(results)
        answer_text = await self._generate(question, history or [], context)

        # 4. Build references (ordered by retrieval rank = citation number)
        references = [_to_reference(r, i, question) for i, r in enumerate(results)]
        meta["elapsed_ms"] = int((time.perf_counter() - started) * 1000)

        return {
            "answer": answer_text,
            "references": references,
            "retrieval_meta": meta,
            "context_used": bool(results),
        }

    async def answer_stream(
        self,
        course_id: str,
        question: str,
        history: Optional[list[dict]] = None,
        top_k: int | None = None,
        source_types: Optional[list[str]] = None,
    ) -> AsyncIterator[str]:
        """SSE stream for the RAG Q&A typing effect.

        Emits stage events, then token deltas, then a harness event carrying
        retrieval_meta + references, then [DONE]. Compatible with the frontend
        stream-chat.ts parser.
        """
        from app.services.llm_client import get_llm_provider

        def sse(data: Any) -> str:
            return f"data: {json.dumps(data, ensure_ascii=False)}{NL}{NL}"

        stages = [
            {"name": "guard", "label": "输入守卫", "status": "running"},
            {"name": "retrieve", "label": "知识检索", "status": "pending"},
            {"name": "rerank", "label": "结果重排", "status": "pending"},
            {"name": "generate", "label": "生成回答", "status": "pending"},
            {"name": "cite", "label": "构造溯源", "status": "pending"},
        ]
        yield sse({"type": "stage", "data": stages})

        # guard
        guard = _get_input_guard()
        checks = await guard.check(question)
        if not guard.is_allowed():
            for s in stages:
                s["status"] = "error"
            yield sse({"type": "stage", "data": stages})
            yield sse({
                "choices": [{"index": 0, "delta": {"content": "抱歉，你的消息包含不允许的内容，请调整后重试。"}, "finish_reason": "stop"}],
            })
            yield sse({"type": "harness", "data": {
                "retrieval_meta": {"mode": "blocked", "recalled": 0, "reranked": 0, "passed_threshold": 0, "threshold": rag_config.similarity_threshold, "elapsed_ms": 0},
                "references": [],
            }})
            yield f"data: [DONE]{NL}{NL}"
            return

        stages[0]["status"] = "done"
        stages[1]["status"] = "running"
        yield sse({"type": "stage", "data": stages})

        # retrieve + rerank
        try:
            results, meta = await self._retrieve(course_id, question, top_k, source_types)
        except Exception as e:
            logger.warning("RAG retrieval failed: %s", e)
            results, meta = [], {
                "mode": "error",
                "recalled": 0,
                "reranked": 0,
                "passed_threshold": 0,
                "threshold": rag_config.similarity_threshold,
                "elapsed_ms": 0,
                "error": str(e),
            }
        stages[1]["status"] = "done"
        stages[2]["status"] = "done"
        stages[3]["status"] = "running"
        yield sse({"type": "stage", "data": stages})

        # generate (token stream)
        context = self._build_context(results)
        llm = get_llm_provider()
        user_parts = []
        if context:
            user_parts.append(context)
            user_parts.append("")
        user_parts.append("用户问题：")
        user_parts.append(question)
        user_prompt = NL.join(user_parts)

        messages: list[dict[str, str]] = [
            {"role": "system", "content": self._system_prompt()},
        ]
        for h in (history or [])[-6:]:
            role = h.get("role")
            content = h.get("content")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": str(content)[:2000]})
        messages.append({"role": "user", "content": user_prompt})

        try:
            async for token in llm.stream_completion_with_messages(messages, temperature=0.4, max_tokens=8192):
                if token:
                    yield sse({
                        "choices": [{"index": 0, "delta": {"content": token}, "finish_reason": None}],
                    })
        except Exception as e:
            logger.warning("RAG LLM stream interrupted: %s", e)
            # 流式中断时自动补全：改为非流式请求，并用 replace 事件让前端
            # 用完整回答替换已显示的部分内容，避免“输出一半就断”。
            stages[3]["status"] = "running"
            yield sse({"type": "stage", "data": stages})
            try:
                fallback = await llm.chat_completion_with_messages(
                    messages, temperature=0.4, max_tokens=8192,
                )
                full_content = fallback.content or ""
                if full_content:
                    yield sse({"type": "replace", "data": {"content": full_content}})
                else:
                    raise RuntimeError("empty fallback response")
            except Exception as fallback_error:
                logger.warning("RAG LLM fallback failed: %s", fallback_error)
                yield sse({
                    "choices": [{"index": 0, "delta": {"content": "\n\n[回答生成中断，请重试]"}, "finish_reason": "stop"}],
                })

        stages[3]["status"] = "done"
        stages[4]["status"] = "running"
        yield sse({"type": "stage", "data": stages})

        references = [_to_reference(r, i, question) for i, r in enumerate(results)]
        stages[4]["status"] = "done"
        yield sse({"type": "stage", "data": stages})

        yield sse({
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        })
        yield sse({"type": "harness", "data": {
            "retrieval_meta": meta,
            "references": references,
        }})
        yield f"data: [DONE]{NL}{NL}"

    async def export(self, messages: list[dict[str, Any]]) -> str:
        """Export a conversation (with references) as markdown."""
        parts = ["# RAG 问答导出", "", f"导出时间：{_now_iso()}", ""]
        for m in messages:
            role = m.get("role")
            if role == "user":
                parts.append(f"## 用户\n\n{m.get('content', '')}\n")
            elif role == "assistant":
                parts.append(f"## AI 助教\n\n{m.get('content', '')}\n")
                refs = m.get("references") or []
                if refs:
                    parts.append("### 引用来源\n")
                    for r in refs:
                        parts.append(
                            f"- [{r.get('index', '?')}] {r.get('title', '未命名文档')} "
                            f"（相似度 {r.get('similarity', 0):.1%}）"
                        )
                    parts.append("")
        return NL.join(parts)


rag_chain = RAGChain()