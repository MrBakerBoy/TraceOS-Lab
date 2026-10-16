"""
TraceOS Lab AI Service — Knowledge Repository.

Single data layer for knowledge_entries / knowledge_chunks /
knowledge_entry_versions / rag_settings. Retrieval is NOT here — it lives in
services/rag/hybrid_retriever.py (single retrieval implementation).
"""
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.db.connection import get_pool

logger = logging.getLogger(__name__)

DEFAULT_KNOWLEDGE_TYPE = "course_notes"


class KnowledgeRepo:
    @staticmethod
    def _row_to_dict(row: Any) -> Optional[dict]:
        if row is None:
            return None
        return {
            k: str(v) if isinstance(v, uuid.UUID) else v
            for k, v in dict(row).items()
        }

    # ------------------------------------------------------------------
    # Entries — CRUD
    # ------------------------------------------------------------------
    async def create_entry(
        self,
        course_id: str,
        title: str,
        source_type: str,
        submitted_by: str,
        content_raw: str,
        status: str = "pending_review",
        knowledge_type: str = DEFAULT_KNOWLEDGE_TYPE,
        tags: Optional[list[str]] = None,
        experiment_id: Optional[str] = None,
        source_url: Optional[str] = None,
        file_path: Optional[str] = None,
        change_note: Optional[str] = None,
        chunk_count: int = 0,
    ) -> str:
        entry_id = str(uuid.uuid4())
        pool = get_pool()
        now = datetime.now(timezone.utc)
        version_id = str(uuid.uuid4())

        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    """INSERT INTO knowledge_entries
                       (id, course_id, title, source_type, source_url, file_path,
                        content_raw, status, submitted_by, knowledge_type, tags,
                        experiment_id, version, current_version_id, created_at, updated_at)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13, $14, $14)""",
                    entry_id, course_id, title, source_type, source_url, file_path,
                    content_raw, status, submitted_by, knowledge_type,
                    tags or [], experiment_id, version_id, now,
                )
                await conn.execute(
                    """INSERT INTO knowledge_entry_versions
                       (id, entry_id, version_no, content_raw, chunk_count, change_note, created_by)
                       VALUES ($1, $2, 1, $3, $4, $5, $6)""",
                    version_id, entry_id, content_raw, chunk_count, change_note, submitted_by,
                )
        return entry_id

    async def insert_chunks(self, entry_id: str, chunks: list[dict]) -> None:
        pool = get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                for ch in chunks:
                    emb = ch.get("embedding")
                    emb_str = None
                    if emb:
                        if isinstance(emb, str):
                            emb_str = emb
                        elif isinstance(emb, list):
                            emb_str = "[" + ",".join(str(float(x)) for x in emb) + "]"
                    await conn.execute(
                        """INSERT INTO knowledge_chunks
                           (entry_id, chunk_index, content, embedding, metadata,
                            start_offset, end_offset)
                           VALUES ($1, $2, $3, $4::vector, $5::jsonb, $6, $7)""",
                        entry_id, ch["index"], ch["content"], emb_str,
                        json.dumps(ch.get("metadata", {})),
                        ch.get("start_offset"), ch.get("end_offset"),
                    )

    async def replace_chunks(self, entry_id: str, chunks: list[dict]) -> None:
        """Delete existing chunks and insert new ones (re-chunk / version switch)."""
        pool = get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "DELETE FROM knowledge_chunks WHERE entry_id = $1", entry_id,
                )
                for ch in chunks:
                    emb = ch.get("embedding")
                    emb_str = None
                    if emb:
                        if isinstance(emb, str):
                            emb_str = emb
                        elif isinstance(emb, list):
                            emb_str = "[" + ",".join(str(float(x)) for x in emb) + "]"
                    await conn.execute(
                        """INSERT INTO knowledge_chunks
                           (entry_id, chunk_index, content, embedding, metadata,
                            start_offset, end_offset)
                           VALUES ($1, $2, $3, $4::vector, $5::jsonb, $6, $7)""",
                        entry_id, ch["index"], ch["content"], emb_str,
                        json.dumps(ch.get("metadata", {})),
                        ch.get("start_offset"), ch.get("end_offset"),
                    )

    async def get_entry(self, entry_id: str) -> Optional[dict]:
        pool = get_pool()
        row = await pool.fetchrow(
            """SELECT id, course_id, title, source_type, source_url, file_path,
                      submitted_by, content_raw, status, review_comment,
                      knowledge_type, tags, experiment_id, version,
                      current_version_id, created_at, updated_at
               FROM knowledge_entries
               WHERE id = $1 AND deleted_at IS NULL""",
            entry_id,
        )
        return self._row_to_dict(row)

    async def list_entries(
        self,
        course_id: str,
        user_id: str,
        role: str,
        status: Optional[str] = None,
        source_type: Optional[str] = None,
        knowledge_type: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[dict]:
        pool = get_pool()
        query = (
            "SELECT id, course_id, title, source_type, submitted_by, status, "
            "review_comment, knowledge_type, tags, experiment_id, version, "
            "created_at, updated_at "
            "FROM knowledge_entries WHERE course_id = $1 AND deleted_at IS NULL"
        )
        params: list[Any] = [course_id]
        idx = 2
        if status:
            query += f" AND status = ${idx}"; params.append(status); idx += 1
        if source_type:
            query += f" AND source_type = ${idx}"; params.append(source_type); idx += 1
        if knowledge_type:
            query += f" AND knowledge_type = ${idx}"; params.append(knowledge_type); idx += 1
        if role not in ("teacher", "admin"):
            if user_id and user_id != "anonymous":
                query += f" AND (status = 'approved' OR submitted_by = ${idx})"
                params.append(user_id); idx += 1
            else:
                query += f" AND status = 'approved'"
        query += f" ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx + 1}"
        params.extend([limit, offset])
        rows = await pool.fetch(query, *params)
        return [self._row_to_dict(r) for r in rows]

    async def soft_delete_entry(self, entry_id: str) -> bool:
        pool = get_pool()
        result = await pool.execute(
            "UPDATE knowledge_entries SET deleted_at = $1, updated_at = $1 "
            "WHERE id = $2 AND deleted_at IS NULL",
            datetime.now(timezone.utc), entry_id,
        )
        return "UPDATE 1" in result

    async def update_entry_meta(
        self,
        entry_id: str,
        *,
        content_raw: Optional[str] = None,
        status: Optional[str] = None,
        knowledge_type: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> bool:
        """Partially update entry metadata fields (content/status/type/tags)."""
        sets = ["updated_at = $1"]
        params: list[Any] = [datetime.now(timezone.utc)]
        if content_raw is not None:
            params.append(content_raw)
            sets.append(f"content_raw = ${len(params)}")
        if status is not None:
            params.append(status)
            sets.append(f"status = ${len(params)}")
        if knowledge_type is not None:
            params.append(knowledge_type)
            sets.append(f"knowledge_type = ${len(params)}")
        if tags is not None:
            params.append(tags)
            sets.append(f"tags = ${len(params)}")
        params.append(entry_id)
        result = await pool.execute(
            f"UPDATE knowledge_entries SET {', '.join(sets)} "
            f"WHERE id = ${len(params)} AND deleted_at IS NULL",
            *params,
        )
        return "UPDATE 1" in result

    # ------------------------------------------------------------------
    # Review
    # ------------------------------------------------------------------
    async def list_pending_reviews(self, course_id: str) -> list[dict]:
        pool = get_pool()
        rows = await pool.fetch(
            """SELECT id, course_id, title, source_type, submitted_by, status,
                      knowledge_type, tags, created_at, updated_at
               FROM knowledge_entries
               WHERE course_id = $1 AND status = 'pending_review' AND deleted_at IS NULL
               ORDER BY created_at ASC""",
            course_id,
        )
        return [self._row_to_dict(r) for r in rows]

    async def list_approved_entries(self, course_id: str) -> list[dict]:
        pool = get_pool()
        rows = await pool.fetch(
            """SELECT id, course_id, title, source_type, submitted_by, status,
                      knowledge_type, tags, created_at, updated_at
               FROM knowledge_entries
               WHERE course_id = $1 AND status = 'approved' AND deleted_at IS NULL
               ORDER BY created_at DESC""",
            course_id,
        )
        return [self._row_to_dict(r) for r in rows]

    async def approve_entry(self, entry_id: str, reviewer_id: Optional[str] = None) -> bool:
        pool = get_pool()
        result = await pool.execute(
            "UPDATE knowledge_entries SET status = 'approved', reviewed_by = $1, "
            "updated_at = $2 WHERE id = $3 AND status = 'pending_review' AND deleted_at IS NULL",
            reviewer_id, datetime.now(timezone.utc), entry_id,
        )
        return "UPDATE 1" in result

    async def reject_entry(
        self, entry_id: str, reviewer_id: Optional[str] = None, reason: str = "",
    ) -> bool:
        pool = get_pool()
        result = await pool.execute(
            "UPDATE knowledge_entries SET status = 'rejected', reviewed_by = $1, "
            "review_comment = $2, updated_at = $3 "
            "WHERE id = $4 AND status = 'pending_review' AND deleted_at IS NULL",
            reviewer_id, reason, datetime.now(timezone.utc), entry_id,
        )
        return "UPDATE 1" in result

    async def unpublish_entry(self, entry_id: str) -> bool:
        pool = get_pool()
        result = await pool.execute(
            "UPDATE knowledge_entries SET status = 'unpublished', updated_at = $1 "
            "WHERE id = $2 AND status = 'approved' AND deleted_at IS NULL",
            datetime.now(timezone.utc), entry_id,
        )
        return "UPDATE 1" in result

    async def republish_entry(self, entry_id: str) -> bool:
        pool = get_pool()
        result = await pool.execute(
            "UPDATE knowledge_entries SET status = 'approved', updated_at = $1 "
            "WHERE id = $2 AND status = 'unpublished' AND deleted_at IS NULL",
            datetime.now(timezone.utc), entry_id,
        )
        return "UPDATE 1" in result

    async def batch_review(
        self, entry_ids: list[str], action: str, reviewer_id: Optional[str] = None,
        reason: str = "",
    ) -> dict[str, int]:
        """Batch approve/reject. Returns {succeeded, failed}."""
        succeeded = 0
        failed = 0
        for eid in entry_ids:
            try:
                if action == "approve":
                    ok = await self.approve_entry(eid, reviewer_id)
                elif action == "reject":
                    ok = await self.reject_entry(eid, reviewer_id, reason)
                else:
                    ok = False
                if ok:
                    succeeded += 1
                else:
                    failed += 1
            except Exception as e:
                logger.warning("batch_review failed for %s: %s", eid, e)
                failed += 1
        return {"succeeded": succeeded, "failed": failed}

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------
    async def get_stats(self, course_id: str) -> dict[str, Any]:
        pool = get_pool()

        doc_row = await pool.fetchrow(
            "SELECT COUNT(*) AS total FROM knowledge_entries "
            "WHERE course_id = $1 AND deleted_at IS NULL",
            course_id,
        )
        chunk_row = await pool.fetchrow(
            """SELECT COUNT(kc.id) AS total
               FROM knowledge_chunks kc
               JOIN knowledge_entries ke ON kc.entry_id = ke.id
               WHERE ke.course_id = $1 AND ke.deleted_at IS NULL""",
            course_id,
        )

        by_type = await pool.fetch(
            """SELECT knowledge_type, COUNT(*) AS cnt
               FROM knowledge_entries
               WHERE course_id = $1 AND deleted_at IS NULL
               GROUP BY knowledge_type ORDER BY cnt DESC""",
            course_id,
        )
        by_status = await pool.fetch(
            """SELECT status, COUNT(*) AS cnt
               FROM knowledge_entries
               WHERE course_id = $1 AND deleted_at IS NULL
               GROUP BY status ORDER BY cnt DESC""",
            course_id,
        )
        tag_rows = await pool.fetch(
            """SELECT unnest(tags) AS tag, COUNT(*) AS cnt
               FROM knowledge_entries
               WHERE course_id = $1 AND deleted_at IS NULL AND tags IS NOT NULL
               GROUP BY tag ORDER BY cnt DESC LIMIT 30""",
            course_id,
        )

        return {
            "total_documents": doc_row["total"] if doc_row else 0,
            "total_chunks": chunk_row["total"] if chunk_row else 0,
            "by_knowledge_type": [
                {"type": r["knowledge_type"], "count": r["cnt"]} for r in by_type
            ],
            "by_status": [
                {"status": r["status"], "count": r["cnt"]} for r in by_status
            ],
            "top_tags": [
                {"tag": r["tag"], "count": r["cnt"]} for r in tag_rows
            ],
        }

    # ------------------------------------------------------------------
    # Chunks — read / edit
    # ------------------------------------------------------------------
    async def get_chunks_for_entry(self, entry_id: str) -> list[dict]:
        pool = get_pool()
        rows = await pool.fetch(
            """SELECT id, chunk_index, content, metadata, start_offset, end_offset
               FROM knowledge_chunks WHERE entry_id = $1 ORDER BY chunk_index""",
            entry_id,
        )
        return [self._row_to_dict(r) for r in rows]

    async def get_chunk_count(self, entry_id: str) -> int:
        pool = get_pool()
        row = await pool.fetchrow(
            "SELECT COUNT(*) FROM knowledge_chunks WHERE entry_id = $1", entry_id,
        )
        return row[0] if row else 0

    async def update_chunk(
        self, chunk_id: str, content: str, embedding: Optional[list[float]],
    ) -> bool:
        """Edit a chunk's text and re-vectorize it."""
        emb_str = None
        if embedding:
            emb_str = "[" + ",".join(str(float(x)) for x in embedding) + "]"
        pool = get_pool()
        result = await pool.execute(
            "UPDATE knowledge_chunks SET content = $1, embedding = $2::vector "
            "WHERE id = $3",
            content, emb_str, chunk_id,
        )
        return "UPDATE 1" in result

    # ------------------------------------------------------------------
    # Versions
    # ------------------------------------------------------------------
    async def list_versions(self, entry_id: str) -> list[dict]:
        pool = get_pool()
        rows = await pool.fetch(
            """SELECT id, entry_id, version_no, chunk_count, change_note,
                      created_by, created_at
               FROM knowledge_entry_versions
               WHERE entry_id = $1 ORDER BY version_no DESC""",
            entry_id,
        )
        return [self._row_to_dict(r) for r in rows]

    async def create_version(
        self,
        entry_id: str,
        content_raw: str,
        chunk_count: int,
        change_note: str = "",
        created_by: Optional[str] = None,
    ) -> int:
        """Append a new version record and bump the entry's version pointer."""
        pool = get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    "SELECT COALESCE(MAX(version_no), 0) + 1 AS next_no "
                    "FROM knowledge_entry_versions WHERE entry_id = $1",
                    entry_id,
                )
                version_no = row["next_no"] if row else 1
                version_id = str(uuid.uuid4())
                await conn.execute(
                    """INSERT INTO knowledge_entry_versions
                       (id, entry_id, version_no, content_raw, chunk_count, change_note, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                    version_id, entry_id, version_no, content_raw, chunk_count,
                    change_note, created_by,
                )
                await conn.execute(
                    "UPDATE knowledge_entries SET version = $1, current_version_id = $2, "
                    "updated_at = $3 WHERE id = $4",
                    version_no, version_id, datetime.now(timezone.utc), entry_id,
                )
        return version_no

    async def get_version_content(self, entry_id: str, version_no: int) -> Optional[str]:
        pool = get_pool()
        row = await pool.fetchrow(
            "SELECT content_raw FROM knowledge_entry_versions "
            "WHERE entry_id = $1 AND version_no = $2",
            entry_id, version_no,
        )
        return row["content_raw"] if row else None

    async def get_version_record(self, entry_id: str, version_no: int) -> Optional[dict]:
        pool = get_pool()
        row = await pool.fetchrow(
            "SELECT id, entry_id, version_no, content_raw, chunk_count, change_note, created_at "
            "FROM knowledge_entry_versions WHERE entry_id = $1 AND version_no = $2",
            entry_id, version_no,
        )
        return self._row_to_dict(row)

    async def set_current_version(
        self, entry_id: str, version_id: str, version_no: int, content_raw: str,
    ) -> bool:
        pool = get_pool()
        result = await pool.execute(
            "UPDATE knowledge_entries SET version = $1, current_version_id = $2, "
            "content_raw = $3, updated_at = $4 WHERE id = $5 AND deleted_at IS NULL",
            version_no, version_id, content_raw, datetime.now(timezone.utc), entry_id,
        )
        return "UPDATE 1" in result

    async def find_entry_by_title(
        self, course_id: str, title: str, knowledge_type: str,
    ) -> Optional[dict]:
        """Find an existing non-deleted entry with the same title + type (for versioning)."""
        pool = get_pool()
        row = await pool.fetchrow(
            "SELECT id, title, version, current_version_id FROM knowledge_entries "
            "WHERE course_id = $1 AND title = $2 AND knowledge_type = $3 "
            "AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
            course_id, title, knowledge_type,
        )
        return self._row_to_dict(row)

    # ------------------------------------------------------------------
    # RAG settings
    # ------------------------------------------------------------------
    async def get_rag_settings(self, course_id: str) -> Optional[dict]:
        pool = get_pool()
        row = await pool.fetchrow(
            "SELECT * FROM rag_settings WHERE course_id = $1", course_id,
        )
        return self._row_to_dict(row)

    async def upsert_rag_settings(self, course_id: str, settings: dict) -> dict:
        pool = get_pool()
        allowed = {
            "top_k", "similarity_threshold", "hybrid_weight_vector",
            "hybrid_weight_bm25", "rerank_enabled", "rerank_top_k",
            "chunk_size", "chunk_overlap", "chunking_template",
        }
        fields = {k: v for k, v in settings.items() if k in allowed}
        if not fields:
            return {}

        columns = ", ".join(fields.keys())
        placeholders = ", ".join(f"${i + 2}" for i in range(len(fields)))
        updates = ", ".join(
            f"{k} = EXCLUDED.{k}" for k in fields.keys()
        )
        values = [course_id] + list(fields.values())
        await pool.execute(
            f"""INSERT INTO rag_settings (course_id, {columns}, updated_at)
                VALUES ($1, {placeholders}, NOW())
                ON CONFLICT (course_id) DO UPDATE SET {updates}, updated_at = NOW()""",
            *values,
        )
        return await self.get_rag_settings(course_id) or {}


knowledge_repo = KnowledgeRepo()