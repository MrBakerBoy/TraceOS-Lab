"""
Hybrid Retriever — dense vector + optional BM25 with RRF fusion.

Score semantics (the core fix for F3):
  * Every candidate's final `similarity` is a [0, 1] score.
  * RRF is used ONLY for candidate ordering, never as a similarity.
  * The threshold filter runs on the final 0-1 `similarity`, after rerank.

Gracefully degrades when optional packages are unavailable.
"""
import logging
import re
import time
from collections import OrderedDict
from typing import List, Dict, Any, Optional, Tuple

from app.db.connection import get_pool
from app.services.rag.config import rag_config

logger = logging.getLogger(__name__)
NL = chr(10)

# ── lazy imports ──────────────────────────────────────────────────────
_BM25Okapi = None
_BM25_CHECKED = False


def _try_bm25():
    global _BM25Okapi, _BM25_CHECKED
    if _BM25_CHECKED:
        return _BM25Okapi
    _BM25_CHECKED = True
    try:
        from rank_bm25 import BM25Okapi
        _BM25Okapi = BM25Okapi
        return BM25Okapi
    except ImportError:
        logger.info("rank_bm25 not installed — vector-only search mode")
        return None


def _get_embedding_service():
    from app.services.rag.embedding_service import embedding_service
    return embedding_service


def _get_reranker():
    try:
        from app.services.rag.reranker import reranker
        return reranker
    except Exception:
        return None


def _cosine_to_similarity(distance: Optional[float]) -> float:
    """Convert pgvector cosine distance (``<=>``, range [0, 2]) to [0, 1]."""
    if distance is None:
        return 0.0
    sim = 1.0 - float(distance)
    return max(0.0, min(1.0, sim))


def _minmax_normalize(scores: Dict[Any, float]) -> Dict[Any, float]:
    """Min-max normalize a score map to [0, 1]. Empty/single maps stay 0."""
    if not scores:
        return {}
    values = list(scores.values())
    lo, hi = min(values), max(values)
    if hi - lo < 1e-9:
        # All equal — give every present key a neutral 0.5 so ordering is stable.
        return {k: 0.5 for k in scores}
    return {k: (v - lo) / (hi - lo) for k, v in scores.items()}


class HybridRetriever:
    def __init__(self):
        self._bm25_cache: OrderedDict[str, Tuple[Any, List[dict]]] = OrderedDict()
        self._bm25_cache_max = 32

    def _invalidate_bm25_cache(self, course_id: str | None = None):
        """Invalidate BM25 cache when knowledge base changes."""
        if course_id:
            self._bm25_cache.pop(course_id, None)
            logger.info("BM25 cache invalidated for course %s", course_id)
        else:
            self._bm25_cache.clear()
            logger.info("BM25 cache fully invalidated")

    async def _get_settings(self, course_id: str) -> dict:
        """Per-course retrieval settings merged over module defaults.

        Reads ``rag_settings`` (single-row per course); falls back to
        ``rag_config`` defaults when the row is absent or the table is not yet
        migrated, so retrieval keeps working before the metadata migration runs.
        """
        defaults = {
            "top_k": rag_config.top_k,
            "similarity_threshold": rag_config.similarity_threshold,
            "hybrid_weight_vector": rag_config.hybrid_weight_vector,
            "hybrid_weight_bm25": rag_config.hybrid_weight_bm25,
            "rerank_enabled": True,
            "rerank_top_k": rag_config.rerank_top_k,
        }
        try:
            pool = get_pool()
            row = await pool.fetchrow(
                "SELECT top_k, similarity_threshold, hybrid_weight_vector, "
                "hybrid_weight_bm25, rerank_enabled, rerank_top_k "
                "FROM rag_settings WHERE course_id = $1",
                course_id,
            )
        except Exception as e:
            logger.debug("rag_settings lookup failed: %s", e)
            return defaults
        if row is None:
            return defaults
        d = dict(row)
        return {
            "top_k": int(d.get("top_k") or defaults["top_k"]),
            "similarity_threshold": float(d.get("similarity_threshold") if d.get("similarity_threshold") is not None else defaults["similarity_threshold"]),
            "hybrid_weight_vector": float(d.get("hybrid_weight_vector") if d.get("hybrid_weight_vector") is not None else defaults["hybrid_weight_vector"]),
            "hybrid_weight_bm25": float(d.get("hybrid_weight_bm25") if d.get("hybrid_weight_bm25") is not None else defaults["hybrid_weight_bm25"]),
            "rerank_enabled": bool(d.get("rerank_enabled", True)),
            "rerank_top_k": int(d.get("rerank_top_k") or defaults["rerank_top_k"]),
        }

    def _touch_bm25_cache(self, course_id: str, value: Tuple[Any, List[dict]]):
        """Bounded LRU insert: evict oldest when over capacity."""
        self._bm25_cache[course_id] = value
        self._bm25_cache.move_to_end(course_id)
        while len(self._bm25_cache) > self._bm25_cache_max:
            evicted, _ = self._bm25_cache.popitem(last=False)
            logger.debug("BM25 cache evicted course %s", evicted)

    def _tokenize(self, text: str) -> List[str]:
        tokens = []
        has_chinese = bool(re.search(r'[一-鿿]', text))
        if has_chinese:
            text_clean = re.sub(r'[^一-鿿\w]', ' ', text)
            parts = text_clean.split()
            for part in parts:
                if re.search(r'[一-鿿]', part):
                    tokens.extend(part[i:i+2] for i in range(len(part)-1))
                    tokens.extend(part)
                else:
                    tokens.append(part.lower())
        else:
            tokens = re.findall(r'\w+', text.lower())
        return tokens or [text]

    async def _get_bm25(self, course_id: str):
        BM25Okapi = _try_bm25()
        if BM25Okapi is None:
            return None, []

        if course_id in self._bm25_cache:
            value = self._bm25_cache[course_id]
            self._bm25_cache.move_to_end(course_id)
            return value

        pool = get_pool()
        rows = await pool.fetch(
            "SELECT kc.id, kc.content, ke.title, ke.source_type, "
            "ke.id AS entry_id, kc.chunk_index, ke.knowledge_type, ke.tags, "
            "kc.start_offset, kc.end_offset "
            "FROM knowledge_chunks kc "
            "JOIN knowledge_entries ke ON kc.entry_id = ke.id "
            "WHERE ke.course_id = $1 AND ke.status = 'approved' AND ke.deleted_at IS NULL",
            course_id,
        )
        if not rows:
            self._touch_bm25_cache(course_id, (None, []))
            return None, []
        docs = [dict(r) for r in rows]
        corpus = [self._tokenize(d['content']) for d in docs]
        if not corpus or all(len(c) == 0 for c in corpus):
            self._touch_bm25_cache(course_id, (None, docs))
            return None, docs
        bm25 = BM25Okapi(corpus)
        value = (bm25, docs)
        self._touch_bm25_cache(course_id, value)
        return value

    async def search(
        self, course_id: str, query: str,
        top_k: int | None = None,
        source_types: List[str] | None = None,
        use_rerank: bool = True,
    ) -> List[Dict[str, Any]]:
        results, _meta = await self.search_with_meta(
            course_id, query, top_k=top_k, source_types=source_types,
            use_rerank=use_rerank,
        )
        return results

    async def search_with_meta(
        self, course_id: str, query: str,
        top_k: int | None = None,
        source_types: List[str] | None = None,
        use_rerank: bool = True,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """Hybrid retrieval returning (results, retrieval_meta).

        `retrieval_meta` carries the diagnostic numbers the frontend renders in
        the reference panel (recalled / reranked / passed_threshold / threshold).
        """
        started = time.perf_counter()
        settings = await self._get_settings(course_id)
        top_k = top_k or settings["top_k"]
        k_retrieve = max(top_k * 3, 20)
        threshold = settings["similarity_threshold"]

        # ── BM25 recall (optional) ────────────────────────────────────
        bm25, bm25_docs = await self._get_bm25(course_id)
        bm25_raw: Dict[Any, float] = {}
        if bm25 is not None and bm25_docs:
            tokenized = self._tokenize(query)
            scores = bm25.get_scores(tokenized)
            for i, score in enumerate(scores):
                if score > 0:
                    bm25_raw[bm25_docs[i]['id']] = float(score)

        # ── Dense vector recall ───────────────────────────────────────
        emb_service = _get_embedding_service()
        query_emb = (await emb_service.embed([query]))[0]
        emb_str = "[" + ",".join(str(x) for x in query_emb) + "]"
        pool = get_pool()

        type_filter = ""
        type_params: List[str] = []
        if source_types:
            ph = ", ".join(f"${i+4}" for i in range(len(source_types)))
            type_filter = " AND ke.source_type IN (" + ph + ")"
            type_params = list(source_types)

        sql = (
            "SELECT kc.id, kc.content, kc.embedding <=> $1::vector AS distance, "
            "ke.title, ke.source_type, ke.id AS entry_id, kc.chunk_index, "
            "ke.knowledge_type, ke.tags, kc.start_offset, kc.end_offset "
            "FROM knowledge_chunks kc "
            "JOIN knowledge_entries ke ON kc.entry_id = ke.id "
            "WHERE ke.course_id = $2 AND ke.status = 'approved' "
            "AND ke.deleted_at IS NULL" + type_filter + " ORDER BY distance LIMIT $3"
        )
        params: List[Any] = [emb_str, course_id, k_retrieve] + type_params
        rows = await pool.fetch(sql, *params)

        # Merge both recall sources into a single id -> doc map.
        id_to_row: Dict[Any, dict] = {}
        vector_sim: Dict[Any, float] = {}
        for row in rows:
            r = dict(row)
            did = r['id']
            id_to_row[did] = r
            vector_sim[did] = _cosine_to_similarity(r.get('distance'))
        for doc in bm25_docs:
            did = doc['id']
            if did not in id_to_row:
                id_to_row[did] = dict(doc)
                id_to_row[did]['distance'] = 1.0  # not in vector recall
                vector_sim[did] = 0.0

        # ── RRF fusion (ranking only, NOT similarity) ─────────────────
        bm25_norm = _minmax_normalize(bm25_raw)
        k_rrf = 60
        rrf_scores: Dict[Any, float] = {}
        for rank, (doc_id, _) in enumerate(
            sorted(bm25_norm.items(), key=lambda x: x[1], reverse=True)
        ):
            rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + 1 / (k_rrf + rank + 1)
        for rank, row in enumerate(rows):
            rrf_scores[row['id']] = rrf_scores.get(row['id'], 0) + 1 / (k_rrf + rank + 1)

        ranked = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
        recalled = len(ranked)

        # ── Build candidates with a 0-1 similarity ────────────────────
        # A doc counts as "vector-recalled" only when the vector query returned
        # it. BM25-only docs get their normalized BM25 score as similarity; the
        # previous unconditional blend (w_v*0 + w_b*sim_b) capped every
        # BM25-only hit at hybrid_weight_bm25 = 0.3, below the 0.5 threshold,
        # so hybrid recall could never surface them.
        vector_ids = {row['id'] for row in rows}
        w_v = settings["hybrid_weight_vector"]
        w_b = settings["hybrid_weight_bm25"]
        candidates: List[Dict[str, Any]] = []
        for doc_id, _rrf in ranked[:k_retrieve]:
            row = id_to_row[doc_id]
            has_v = doc_id in vector_ids
            has_b = doc_id in bm25_norm
            sim_v = vector_sim.get(doc_id, 0.0)
            sim_b = bm25_norm.get(doc_id, 0.0)
            if has_v and has_b:
                similarity = w_v * sim_v + w_b * sim_b
            elif has_v:
                similarity = sim_v
            else:
                similarity = sim_b
            row = dict(row)
            row['vector_similarity'] = round(sim_v, 4)
            row['bm25_similarity'] = round(sim_b, 4)
            row['similarity'] = round(similarity, 4)
            row['method'] = 'hybrid' if (bm25 is not None and bm25_raw) else 'vector'
            candidates.append(row)

        # ── Rerank (optional) — final similarity is the sigmoid score ──
        rerank_pool = candidates[:max(settings["rerank_top_k"], top_k)]
        reranked_count = len(rerank_pool)
        reranker = _get_reranker() if (use_rerank and settings["rerank_enabled"]) else None
        if reranker is not None and rerank_pool:
            try:
                candidates = await reranker.rerank(query, rerank_pool, top_k=top_k)
            except Exception as e:
                logger.debug("Rerank skipped: %s", e)
                candidates = rerank_pool[:top_k]
        else:
            candidates = rerank_pool[:top_k]

        # ── Threshold filter on final 0-1 similarity (F3 fix) ─────────
        passed = [c for c in candidates if c.get('similarity', 0) >= threshold]
        passed_count = len(passed)
        mode = "hybrid" if (bm25 is not None and bm25_raw) else "vector"

        # Never return an empty result set while the corpus has candidates:
        # low-confidence recall is more useful than a hard empty page. Text
        # fallback covers the case where both vector and BM25 recall nothing.
        if not passed and candidates:
            passed = candidates[:top_k]
            mode = f"{mode}_low_similarity"
        elif not passed:
            text_rows = await self._text_fallback(course_id, query, top_k or 3)
            if text_rows:
                return text_rows, {
                    "mode": "text_fallback",
                    "recalled": len(text_rows),
                    "reranked": 0,
                    "passed_threshold": len(text_rows),
                    "threshold": threshold,
                    "elapsed_ms": int((time.perf_counter() - started) * 1000),
                }

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        meta = {
            "mode": mode,
            "recalled": recalled,
            "reranked": reranked_count,
            "passed_threshold": passed_count,
            "threshold": threshold,
            "elapsed_ms": elapsed_ms,
        }
        return passed[:top_k], meta

    async def build_context(self, course_id: str, query: str,
                            top_k: int | None = None) -> str:
        results = await self.search(course_id, query, top_k, use_rerank=False)
        if not results:
            # Fallback: ILIKE text search when vector search returns nothing.
            results = await self._text_fallback(course_id, query, top_k or 3)

        if not results:
            return ""

        parts = []
        total_chars = 0
        max_chars = rag_config.max_context_tokens * 3
        for r in results:
            title = r.get('title', 'Unknown')
            content = r.get('content', '')
            chunk = f"[Source: {title}]{NL}{content}"
            if total_chars + len(chunk) > max_chars:
                break
            parts.append(chunk)
            total_chars += len(chunk)

        if parts:
            sep = NL + NL + "---" + NL + NL
            return "## Knowledge Base Context" + NL + NL + sep.join(parts)
        return ""

    async def _text_fallback(self, course_id: str, query: str, limit: int) -> List[Dict[str, Any]]:
        """ILIKE fallback when vector search returns no results."""
        try:
            pool = get_pool()
            pattern = "%" + "%".join(query.split()) + "%"
            rows = await pool.fetch(
                "SELECT kc.id, kc.content, ke.title, ke.source_type, ke.id AS entry_id, "
                "kc.chunk_index, ke.knowledge_type, ke.tags, kc.start_offset, kc.end_offset, "
                "0.5::float8 AS similarity "
                "FROM knowledge_chunks kc "
                "JOIN knowledge_entries ke ON kc.entry_id = ke.id "
                "WHERE ke.course_id = $1 AND ke.status = 'approved' AND ke.deleted_at IS NULL "
                "AND (kc.content ILIKE $2 OR ke.title ILIKE $2) "
                "LIMIT $3",
                course_id, pattern, limit,
            )
            return [dict(r) for r in rows]
        except Exception as e:
            logger.debug("Text fallback failed: %s", e)
            return []


hybrid_retriever = HybridRetriever()