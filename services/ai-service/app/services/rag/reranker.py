"""
Cross-encoder Reranker for improving retrieval precision.

Uses BGE-Reranker (or similar cross-encoder) to re-score retrieved documents.
Falls back gracefully if model is unavailable.
"""
import asyncio
import logging
import math
from typing import List, Dict, Any

from app.services.rag.config import rag_config

logger = logging.getLogger(__name__)


def _sigmoid(x: float) -> float:
    """Squash a cross-encoder logit into a [0, 1] similarity score.

    Cross-encoders output unbounded logits (typically [-10, 10]); treating the
    raw logit as a similarity breaks every downstream threshold comparison.
    """
    try:
        return 1.0 / (1.0 + math.exp(-x))
    except OverflowError:
        return 1.0 if x > 0 else 0.0


class Reranker:
    def __init__(self):
        self._model = None
        self._available = True

    async def _get_model(self):
        if self._model is None and self._available:
            try:
                import torch
                if not torch.cuda.is_available():
                    logger.info(
                        "No GPU available — cross-encoder rerank disabled "
                        "(CPU inference too slow), falling back to vector+BM25 scores"
                    )
                    self._available = False
                    return None
                from sentence_transformers import CrossEncoder
                loop = asyncio.get_event_loop()
                self._model = await loop.run_in_executor(
                    None,
                    lambda: CrossEncoder(rag_config.reranker_model, max_length=512)
                )
                logger.info(f"Loaded reranker model: {rag_config.reranker_model}")
            except Exception as e:
                logger.warning(f"Reranker unavailable: {e}, using vector scores only")
                self._available = False
        return self._model

    async def rerank(self, query: str, documents: List[Dict[str, Any]],
                     top_k: int | None = None) -> List[Dict[str, Any]]:
        """Rerank documents using cross-encoder."""
        if not documents:
            return []

        model = await self._get_model()
        if model is None:
            return documents[:top_k or rag_config.top_k]

        try:
            contents = [doc.get('content', '')[:500] for doc in documents]
            pairs = [[query, content] for content in contents]

            loop = asyncio.get_event_loop()
            scores = await loop.run_in_executor(
                None, lambda: model.predict(pairs).tolist()
            )

            for doc, score in zip(documents, scores):
                doc['rerank_score'] = _sigmoid(float(score))
                # `similarity` is the canonical downstream score field.
                doc['similarity'] = doc['rerank_score']
                doc['score'] = doc['rerank_score']
                doc['method'] = 'reranked'

            documents.sort(key=lambda x: x.get('similarity', 0), reverse=True)
            return documents[:top_k or rag_config.top_k]

        except Exception as e:
            logger.warning(f"Rerank failed: {e}, falling back to vector order")
            return documents[:top_k or rag_config.top_k]


reranker = Reranker()

