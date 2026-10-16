"""Embedding service - delegates to unified embedding_service for consistency."""

import asyncio
import logging
from app.config import settings

logger = logging.getLogger(__name__)


class Embedder:
    """Thin wrapper around the unified embedding_service.

    This ensures that ingestion and retrieval use the SAME embedding backend,
    avoiding dimension/quality mismatches between the two code paths.
    """

    def __init__(self):
        self._dimension = settings.rag_embedding_dimension

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Synchronous embed - delegates to unified service."""
        if not texts:
            return []
        try:
            from app.services.rag.embedding_service import embedding_service
            # Try running async in sync context
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # We're in an async context, use sync fallback
                    return embedding_service.embed_sync(texts)
                return loop.run_until_complete(embedding_service.embed(texts))
            except RuntimeError:
                return embedding_service.embed_sync(texts)
        except Exception as e:
            logger.warning("Unified embedding failed: %s, using TF-IDF fallback", e)
            from app.services.rag.embedding_service import _tfidf_ngram_embed
            return _tfidf_ngram_embed(texts, self._dimension)

    def embed_query(self, query: str) -> list[float]:
        """Synchronous single-query embed."""
        return self.embed([query])[0]

    @property
    def dimension(self) -> int:
        return self._dimension


embedder = Embedder()
