"""
Embedding Service — multi-backend with graceful fallback.

Backend priority:
1. external_api (OpenAI-compatible embeddings endpoint — production default)
2. sentence-transformers (best local quality, GPU-capable)
3. ONNX Runtime (CPU-optimized, smaller footprint, no PyTorch needed)
4. TF-IDF weighted n-gram hash (semantic-aware fallback — better than pure hash)
5. Pure hash (last resort — zero semantic meaning)

The key insight: a pure SHA256 hash is RANDOM with respect to semantics.
Two similar sentences produce completely different hashes, making vector search
equivalent to random guessing. We MUST have at least a TF-IDF-level fallback.
"""
import asyncio
import hashlib
import logging
import os
import re
from typing import List, Optional

import httpx

from app.services.rag.config import rag_config

logger = logging.getLogger(__name__)

_DEFAULT_EMBEDDING_DIM = 1536  # text-embedding-3-small

# ── Lazy imports ──────────────────────────────────────────────────────
_SentenceTransformer = None
_ST_CHECKED = False
_ORT_CHECKED = False
_ORT_SESSION = None


def _try_sentence_transformers():
    global _SentenceTransformer, _ST_CHECKED
    if _ST_CHECKED:
        return _SentenceTransformer
    _ST_CHECKED = True
    try:
        from sentence_transformers import SentenceTransformer
        _SentenceTransformer = SentenceTransformer
        logger.info("sentence-transformers available")
        return _SentenceTransformer
    except ImportError:
        logger.info("sentence-transformers not installed")
        return None


def _try_onnx():
    """Try to load a lightweight ONNX embedding model."""
    global _ORT_CHECKED, _ORT_SESSION
    if _ORT_CHECKED:
        return _ORT_SESSION
    _ORT_CHECKED = True
    try:
        import numpy as np
        # Check for onnxruntime
        try:
            import onnxruntime as ort
        except ImportError:
            logger.info("onnxruntime not installed, will use TF-IDF fallback")
            return None

        # Try to load a small ONNX model if available
        model_path = os.environ.get("RAG_ONNX_MODEL_PATH", "")
        if model_path and os.path.exists(model_path):
            _ORT_SESSION = ort.InferenceSession(model_path)
            logger.info("ONNX embedding model loaded from %s", model_path)
        else:
            logger.info("No ONNX model path configured, will use TF-IDF fallback")
        return _ORT_SESSION
    except Exception as e:
        logger.warning("ONNX setup failed: %s", e)
        return None


# ── TF-IDF weighted char n-gram embeddings ───────────────────────────
# This produces SEMANTICALLY MEANINGFUL vectors by using character n-gram
# overlaps. Two texts about "fork() system call" will have similar n-gram
# distributions and thus similar vectors, unlike pure hash.

def _tfidf_ngram_embed(texts: List[str], dim: int = 512) -> List[List[float]]:
    """TF-IDF weighted character n-gram embedding.

    Uses character trigrams + bigrams to capture morpho-semantic patterns.
    This is vastly better than pure hash because texts with similar words
    produce similar n-gram distributions.
    """
    import math
    from collections import Counter

    # Build vocabulary from all texts
    all_ngrams: Counter = Counter()
    doc_ngrams_list = []
    for text in texts:
        text_lower = text.lower()
        # Character trigrams
        trigrams = [text_lower[i:i+3] for i in range(max(0, len(text_lower)-2))]
        # Word bigrams for semantic units
        words = re.findall(r'\w+', text_lower)
        word_bigrams = ['_'.join(words[i:i+2]) for i in range(max(0, len(words)-1))]
        # Combine
        ngrams = trigrams + word_bigrams
        doc_ngrams_list.append(Counter(ngrams))
        all_ngrams.update(ngrams)

    if not all_ngrams:
        return [[0.0] * dim for _ in texts]

    # TF-IDF scoring
    num_docs = len(texts)
    idf = {}
    for ngram, count in all_ngrams.items():
        doc_freq = sum(1 for dc in doc_ngrams_list if ngram in dc)
        idf[ngram] = math.log((num_docs + 1) / (doc_freq + 1)) + 1

    # Build vectors using hashing trick (feature hashing to fixed dim)
    results = []
    for doc_ngrams in doc_ngrams_list:
        vec = [0.0] * dim
        total_weight = 0.0
        for ngram, tf in doc_ngrams.items():
            weight = (1 + math.log(tf)) * idf.get(ngram, 1.0)
            # Feature hashing to dimension
            h = int(hashlib.md5(ngram.encode()).hexdigest(), 16) % dim
            # Use signed hashing to reduce collisions
            sign = 1 if int(hashlib.sha256(ngram.encode()).hexdigest()[-1], 16) % 2 == 0 else -1
            vec[h] += sign * weight
            total_weight += weight
        # L2 normalize
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        results.append(vec)

    return results


class EmbeddingService:
    """Multi-backend embedding service with semantic-aware fallback."""

    def __init__(self):
        self._model = None
        self._backend = None  # "external_api" | "sentence_transformers" | "onnx" | "tfidf" | "hash"
        self._initialized = False
        self._model_name = None

    def _resolve_external_api(self) -> Optional[tuple[str, str, str]]:
        """Resolve the external embedding API endpoint.

        Returns (base_url, api_key, model) or None when not configured.
        Falls back to the LLM base_url/key when the embedding-specific
        overrides are empty, so a single API credential can power both.
        """
        from app.config import settings

        base_url = settings.rag_embedding_api_base_url or settings.llm_api_base_url
        api_key = settings.rag_embedding_api_key or settings.llm_api_key
        model = settings.rag_embedding_model

        if not base_url:
            logger.debug("No external embedding API configured (base_url empty)")
            return None
        if not api_key:
            logger.warning(
                "External embedding API base_url set but no API key; "
                "falling back to local backends"
            )
            return None
        return base_url.rstrip("/"), api_key, model

    async def _initialize(self):
        """Initialize the best available backend."""
        if self._initialized:
            return

        # 0. Try external OpenAI-compatible embeddings API (production default)
        external = self._resolve_external_api()
        if external is not None:
            base_url, api_key, model = external
            self._model = None  # external API has no in-memory model
            self._backend = "external_api"
            self._model_name = model
            self._external_base_url = base_url
            self._external_api_key = api_key
            # Verify dimension against configured value; trust config for the
            # vector column. text-embedding-3-small -> 1536, bge-m3 -> 1024.
            actual_dim = rag_config.embedding_dim
            logger.info(
                "✅ Embedding backend: external_api / %s (dim=%d) @ %s",
                model, actual_dim, base_url,
            )
            self._initialized = True
            return

        # 1. Try sentence-transformers (best local quality)
        ST = _try_sentence_transformers()
        if ST is not None:
            try:
                model_name = rag_config.embedding_model
                loop = asyncio.get_event_loop()
                self._model = await loop.run_in_executor(
                    None, lambda: ST(model_name, trust_remote_code=True)
                )
                self._backend = "sentence_transformers"
                self._model_name = model_name
                # Try new API first, fall back to deprecated one
                try:
                    actual_dim = self._model.get_sentence_embedding_dimension()
                except AttributeError:
                    actual_dim = self._model.get_embedding_dimension()
                logger.info("✅ Embedding backend: sentence-transformers / %s (dim=%d)",
                           model_name, actual_dim)
                self._initialized = True
                return
            except Exception as e:
                logger.warning("sentence-transformers load failed: %s", e)

        # 2. Try ONNX runtime
        ort_session = _try_onnx()
        if ort_session is not None:
            self._model = ort_session
            self._backend = "onnx"
            self._model_name = "onnx-model"
            logger.info("✅ Embedding backend: ONNX Runtime (dim=%d)", rag_config.embedding_dim)
            self._initialized = True
            return

        # 3. Use TF-IDF n-gram (semantic-aware, no external deps)
        self._backend = "tfidf"
        self._model_name = "tfidf-ngram"
        logger.info("⚠️  Embedding backend: TF-IDF n-gram (dim=%d) — semantic-aware fallback", rag_config.embedding_dim)
        self._initialized = True

    async def embed(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a list of texts."""
        if not texts:
            return []

        await self._initialize()

        if self._backend == "external_api":
            return await self._external_api_embed(texts)
        elif self._backend == "sentence_transformers":
            return await self._st_embed(texts)
        elif self._backend == "onnx":
            return await self._onnx_embed(texts)
        elif self._backend == "tfidf":
            return self._tfidf_embed(texts)
        else:
            return self._hash_embed(texts)

    async def embed_query(self, query: str) -> List[float]:
        """Generate embedding for a single query string."""
        results = await self.embed([query])
        return results[0] if results else [0.0] * rag_config.embedding_dim

    async def _external_api_embed(self, texts: List[str]) -> List[List[float]]:
        """Embed via an OpenAI-compatible `/embeddings` endpoint.

        Batches requests to respect `embedding_batch_size` and validates the
        returned dimension against `rag_config.embedding_dim`, falling back to
        TF-IDF on any failure so ingestion/search never hard-crashes.
        """
        import json

        base_url = getattr(self, "_external_base_url", "")
        api_key = getattr(self, "_external_api_key", "")
        model = self._model_name or "text-embedding-3-small"
        batch_size = max(1, rag_config.embedding_batch_size)
        url = f"{base_url}/embeddings"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        all_embeddings: List[List[float]] = []
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                for start in range(0, len(texts), batch_size):
                    batch = texts[start:start + batch_size]
                    resp = await client.post(
                        url,
                        headers=headers,
                        json={"model": model, "input": batch},
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    data_list = data.get("data", [])
                    # OpenAI returns embeddings in input order; keep it stable.
                    data_list = sorted(data_list, key=lambda x: x.get("index", 0))
                    for item in data_list:
                        vec = item.get("embedding")
                        if vec is None:
                            raise ValueError("embedding API returned null vector")
                        all_embeddings.append([float(x) for x in vec])
        except Exception as e:
            logger.warning(
                "external_api embedding failed: %s; falling back to TF-IDF", e
            )
            self._backend = "tfidf"
            self._model = None
            return self._tfidf_embed(texts)

        if len(all_embeddings) != len(texts):
            logger.warning(
                "external_api returned %d embeddings for %d texts; falling back",
                len(all_embeddings), len(texts),
            )
            self._backend = "tfidf"
            return self._tfidf_embed(texts)

        # Validate dimension once against the vector column size.
        actual_dim = len(all_embeddings[0]) if all_embeddings else 0
        if actual_dim != rag_config.embedding_dim:
            logger.warning(
                "embedding dimension mismatch: API returned %d but config says %d; "
                "update RAG_EMBEDDING_DIMENSION and re-migrate the vector column",
                actual_dim, rag_config.embedding_dim,
            )
        return all_embeddings

    async def _st_embed(self, texts: List[str]) -> List[List[float]]:
        """Sentence-transformers embedding."""
        try:
            loop = asyncio.get_event_loop()
            embeddings = await loop.run_in_executor(
                None,
                lambda: self._model.encode(
                    texts,
                    normalize_embeddings=True,
                    show_progress_bar=False,
                ).tolist()
            )
            return embeddings
        except Exception as e:
            logger.warning("ST encode failed: %s, falling back to TF-IDF", e)
            self._backend = "tfidf"
            self._model = None
            return self._tfidf_embed(texts)

    async def _onnx_embed(self, texts: List[str]) -> List[List[float]]:
        """ONNX runtime embedding."""
        try:
            import numpy as np
            loop = asyncio.get_event_loop()
            # Tokenization would need a separate tokenizer model
            # For now, fall back to TF-IDF
            return self._tfidf_embed(texts)
        except Exception as e:
            logger.warning("ONNX encode failed: %s, falling back to TF-IDF", e)
            return self._tfidf_embed(texts)

    def _tfidf_embed(self, texts: List[str]) -> List[List[float]]:
        """TF-IDF n-gram embedding (semantic-aware, no external deps)."""
        return _tfidf_ngram_embed(texts, rag_config.embedding_dim)

    def _hash_embed(self, texts: List[str]) -> List[List[float]]:
        """Pure hash embedding — LAST RESORT, zero semantic meaning."""
        logger.warning("Using PURE HASH embeddings — vector search will be RANDOM!")
        dim = rag_config.embedding_dim
        result = []
        for t in texts:
            h = hashlib.sha256(t.encode()).digest()
            vec = [((h[i % len(h)] / 255.0) * 2 - 1) for i in range(dim)]
            # Normalize
            norm = sum(v * v for v in vec) ** 0.5
            if norm > 0:
                vec = [v / norm for v in vec]
            result.append(vec)
        return result

    def embed_sync(self, texts: List[str]) -> List[List[float]]:
        """Synchronous embedding.

        Prefers the external API (via a fresh event loop) when configured so
        ingestion never silently degrades to TF-IDF while retrieval uses the
        external API. Falls back to TF-IDF if no loop can be run or the async
        path fails.
        """
        if not texts:
            return []
        external = self._resolve_external_api()
        if external is not None:
            try:
                return asyncio.run(self._external_api_embed(texts))
            except RuntimeError as e:
                # Already inside a running event loop — cannot nest asyncio.run.
                logger.debug("embed_sync in running loop, using TF-IDF: %s", e)
            except Exception as e:
                logger.warning("embed_sync external API failed: %s", e)
        return self._tfidf_embed(texts)

    @property
    def backend_name(self) -> str:
        return self._backend or "uninitialized"

    @property
    def model_name(self) -> str:
        return self._model_name or "none"


embedding_service = EmbeddingService()
