"""Ingestion pipeline — orchestrates parsing, chunking, embedding, and DB storage.

Single ingestion entry point (the ``services/rag/pipeline.py`` duplicate was
removed). Handles metadata, offset-tracked chunking, versioning on re-upload,
and role-based approval (teachers/admins auto-approve, students go to review).
"""

import logging
from dataclasses import dataclass
from typing import Optional

from app.config import settings
from app.services.ingestion.parser import document_parser, ParsedDocument
from app.services.ingestion.chunker import TextChunker
from app.services.ingestion.embedder import embedder
from app.db.knowledge_repo import knowledge_repo, DEFAULT_KNOWLEDGE_TYPE

logger = logging.getLogger(__name__)


def _invalidate_cache(course_id: str):
    """Invalidate hybrid retriever BM25 cache after ingestion."""
    try:
        from app.services.rag.hybrid_retriever import hybrid_retriever
        hybrid_retriever._invalidate_bm25_cache(course_id)
    except Exception:
        pass


def _make_chunker(template: str, chunk_size: Optional[int], chunk_overlap: Optional[int]) -> TextChunker:
    """Build a chunker honoring the requested template and size overrides."""
    if template == "code":
        size = chunk_size or settings.rag_code_chunk_size
        return TextChunker(
            chunk_size=size, chunk_overlap=0,
            code_chunk_size=size,
        )
    size = chunk_size or settings.rag_chunk_size
    return TextChunker(
        chunk_size=size,
        chunk_overlap=chunk_overlap if chunk_overlap is not None else settings.rag_chunk_overlap,
    )


@dataclass
class IngestionResult:
    entry_id: str
    chunk_count: int
    success: bool
    error: str | None = None
    version_no: int | None = None


class IngestionPipeline:
    async def ingest(
        self,
        content: bytes,
        filename: str,
        source_type: str,
        course_id: str,
        user_id: str,
        user_role: str,
        title: Optional[str] = None,
        knowledge_type: str = DEFAULT_KNOWLEDGE_TYPE,
        tags: Optional[list[str]] = None,
        experiment_id: Optional[str] = None,
        chunking_template: str = "general",
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
        change_note: Optional[str] = None,
    ) -> IngestionResult:
        try:
            doc = document_parser.parse(content, filename, source_type)
            final_title = (title or doc.title or filename).strip()[:500]

            chunker = _make_chunker(chunking_template, chunk_size, chunk_overlap)
            chunks = chunker.chunk(doc)
            texts = [c.content for c in chunks]
            embeddings = embedder.embed(texts)
            status = "approved" if user_role in ("teacher", "admin") else "pending_review"

            chunk_records = [
                {
                    "index": c.index,
                    "content": c.content,
                    "embedding": embeddings[i] if i < len(embeddings) else None,
                    "metadata": c.metadata,
                    "start_offset": c.start_offset,
                    "end_offset": c.end_offset,
                }
                for i, c in enumerate(chunks)
            ]

            existing = await knowledge_repo.find_entry_by_title(
                course_id, final_title, knowledge_type,
            )
            version_no: Optional[int] = None
            if existing and existing.get("id"):
                entry_id = existing["id"]
                version_no = await knowledge_repo.create_version(
                    entry_id, doc.content_raw, len(chunks),
                    change_note or "重新上传", user_id,
                )
                await knowledge_repo.update_entry_meta(
                    entry_id, content_raw=doc.content_raw, status=status,
                )
                await knowledge_repo.replace_chunks(entry_id, chunk_records)
            else:
                entry_id = await knowledge_repo.create_entry(
                    course_id=course_id,
                    title=final_title,
                    source_type=source_type,
                    submitted_by=user_id,
                    content_raw=doc.content_raw,
                    status=status,
                    knowledge_type=knowledge_type,
                    tags=tags,
                    experiment_id=experiment_id,
                    change_note=change_note,
                    chunk_count=len(chunks),
                )
                await knowledge_repo.insert_chunks(entry_id, chunk_records)

            _invalidate_cache(course_id)
            logger.info(
                "Ingested %s: %d chunks, entry=%s, version=%s",
                filename, len(chunks), entry_id, version_no or 1,
            )
            return IngestionResult(
                entry_id=entry_id, chunk_count=len(chunks), success=True,
                version_no=version_no,
            )
        except Exception as e:
            logger.exception("Ingestion failed for %s: %s", filename, e)
            return IngestionResult(entry_id="", chunk_count=0, success=False, error=str(e))

    async def ingest_text(
        self,
        text: str,
        title: str,
        course_id: str,
        user_id: str,
        user_role: str,
        **meta,
    ) -> IngestionResult:
        """Thin wrapper for paste ingestion, sharing the same pipeline."""
        return await self.ingest(
            content=text.encode("utf-8"),
            filename="paste.txt",
            source_type="paste",
            course_id=course_id,
            user_id=user_id,
            user_role=user_role,
            title=title,
            **meta,
        )

    async def preview(
        self,
        content: bytes,
        filename: str,
        source_type: str,
        chunking_template: str = "general",
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
    ) -> list[dict]:
        """Parse + chunk a document WITHOUT persisting or embedding.

        Powers the two-stage upload flow: the client previews editable chunks
        before committing them to the knowledge base.
        """
        doc = document_parser.parse(content, filename, source_type)
        chunker = _make_chunker(chunking_template, chunk_size, chunk_overlap)
        chunks = chunker.chunk(doc)
        return [
            {
                "chunk_index": c.index,
                "content": c.content,
                "char_count": len(c.content),
                "start_offset": c.start_offset,
                "end_offset": c.end_offset,
                "metadata": c.metadata,
            }
            for c in chunks
        ]

    async def rechunk_entry(
        self,
        entry_id: str,
        chunking_template: str = "general",
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
    ) -> IngestionResult:
        """Re-split an entry's raw content with new chunking parameters."""
        entry = await knowledge_repo.get_entry(entry_id)
        if not entry:
            return IngestionResult(entry_id="", chunk_count=0, success=False, error="Entry not found")

        doc = ParsedDocument(
            title=entry.get("title") or "rechunk",
            content_raw=entry.get("content_raw") or "",
            source_type=entry.get("source_type") or "file",
        )
        try:
            chunker = _make_chunker(chunking_template, chunk_size, chunk_overlap)
            chunks = chunker.chunk(doc)
            texts = [c.content for c in chunks]
            embeddings = embedder.embed(texts)
            records = [
                {
                    "index": c.index,
                    "content": c.content,
                    "embedding": embeddings[i] if i < len(embeddings) else None,
                    "metadata": c.metadata,
                    "start_offset": c.start_offset,
                    "end_offset": c.end_offset,
                }
                for i, c in enumerate(chunks)
            ]
            await knowledge_repo.replace_chunks(entry_id, records)
            _invalidate_cache(entry.get("course_id"))
            logger.info("Re-chunked entry %s: %d chunks", entry_id, len(chunks))
            return IngestionResult(entry_id=entry_id, chunk_count=len(chunks), success=True)
        except Exception as e:
            logger.exception("Re-chunk failed for %s: %s", entry_id, e)
            return IngestionResult(entry_id="", chunk_count=0, success=False, error=str(e))

    async def rollback_entry(self, entry_id: str, version_no: int) -> IngestionResult:
        """Restore a historical version and re-render its chunks."""
        entry = await knowledge_repo.get_entry(entry_id)
        if not entry:
            return IngestionResult(entry_id="", chunk_count=0, success=False, error="Entry not found")

        version = await knowledge_repo.get_version_record(entry_id, version_no)
        if not version:
            return IngestionResult(entry_id="", chunk_count=0, success=False, error="Version not found")

        try:
            content_raw = version.get("content_raw") or ""
            doc = ParsedDocument(
                title=entry.get("title") or "rollback",
                content_raw=content_raw,
                source_type=entry.get("source_type") or "file",
            )
            chunker = _make_chunker("general", None, None)
            chunks = chunker.chunk(doc)
            texts = [c.content for c in chunks]
            embeddings = embedder.embed(texts)
            records = [
                {
                    "index": c.index,
                    "content": c.content,
                    "embedding": embeddings[i] if i < len(embeddings) else None,
                    "metadata": c.metadata,
                    "start_offset": c.start_offset,
                    "end_offset": c.end_offset,
                }
                for i, c in enumerate(chunks)
            ]
            await knowledge_repo.replace_chunks(entry_id, records)
            await knowledge_repo.set_current_version(
                entry_id, version["id"], version_no, content_raw,
            )
            _invalidate_cache(entry.get("course_id"))
            logger.info("Rolled back entry %s to version %d", entry_id, version_no)
            return IngestionResult(entry_id=entry_id, chunk_count=len(chunks), success=True, version_no=version_no)
        except Exception as e:
            logger.exception("Rollback failed for %s: %s", entry_id, e)
            return IngestionResult(entry_id="", chunk_count=0, success=False, error=str(e))


pipeline = IngestionPipeline()