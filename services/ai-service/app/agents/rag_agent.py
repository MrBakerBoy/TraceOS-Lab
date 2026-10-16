"""
RAG Agent — knowledge base retrieval via the single hybrid_retriever.

Returns structured references (not a flat string) so callers can surface
citations. The teaching assistant uses this for experiment diagnosis context.
"""
import logging
from typing import Any

logger = logging.getLogger(__name__)


class RAGAgent:
    """Retrieves knowledge base chunks for a given course and query.

    Delegates to hybrid_retriever — the single retrieval implementation —
    instead of the legacy PGKBService (removed in the convergence pass).
    """

    async def retrieve(
        self, course_id: str, query: str, top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Return structured reference dicts, or [] on failure."""
        try:
            from app.services.rag.hybrid_retriever import hybrid_retriever
            results = await hybrid_retriever.search(
                course_id, query, top_k=top_k, use_rerank=True,
            )
            return results
        except Exception as e:
            logger.warning("RAG retrieve failed: %s", e)
            return []

    def to_context(self, results: list[dict[str, Any]], max_chunks: int = 5) -> str:
        """Flatten structured references into a context string for the LLM."""
        if not results:
            return ""
        chunks: list[str] = []
        for r in results[:max_chunks]:
            content = (r.get("content") or r.get("text") or "").strip()
            if content:
                chunks.append(content[:2000])
        return "\n\n---\n\n".join(chunks)