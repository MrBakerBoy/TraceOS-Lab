"""Proxy router: map /api/v1/courses/{cid}/rag|knowledge -> AI internal handlers."""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List

from app.middleware.auth import get_current_user, get_optional_user, require_role, UserContext
from app.config import settings

router = APIRouter(prefix="/api/v1/courses/{course_id}", tags=["v1-proxy"])


def _validate_course_id(course_id: str) -> str:
    """Reject malformed UUIDs before they hit asyncpg and become 500s."""
    try:
        uuid.UUID(course_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid course_id")
    return course_id


# ============================================================================
# Request models
# ============================================================================
class AskRequest(BaseModel):
    question: str
    top_k: Optional[int] = None
    history: Optional[List[dict]] = None
    source_types: Optional[List[str]] = None


class RejectRequest(BaseModel):
    reason: str = ""


class BatchReviewRequest(BaseModel):
    entry_ids: List[str]
    action: str  # "approve" | "reject"
    reason: str = ""


class ChunkUpdateRequest(BaseModel):
    content: str


class RechunkRequest(BaseModel):
    chunking_template: str = "general"
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None


class RollbackRequest(BaseModel):
    version_no: int


class RagSettingsUpdate(BaseModel):
    top_k: Optional[int] = None
    similarity_threshold: Optional[float] = None
    hybrid_weight_vector: Optional[float] = None
    hybrid_weight_bm25: Optional[float] = None
    rerank_enabled: Optional[bool] = None
    rerank_top_k: Optional[int] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    chunking_template: Optional[str] = None


class ExportRequest(BaseModel):
    messages: List[dict]


class PreviewTextRequest(BaseModel):
    content: str
    chunking_template: str = "general"
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None


def _parse_tags(raw) -> Optional[List[str]]:
    """Normalize tags from either a JSON array or a comma-separated string."""
    if not raw:
        return None
    if isinstance(raw, list):
        return [str(t).strip() for t in raw if str(t).strip()]
    parts = [t.strip() for t in str(raw).replace("，", ",").split(",")]
    return [t for t in parts if t]


# ============================================================================
# RAG endpoints
# ============================================================================
@router.post("/rag/ask")
async def v1_rag_ask(course_id: str, body: AskRequest, user=Depends(get_optional_user)):
    """RAG 提问 — 走 rag_chain 知识问答编排（返回 answer + references）。"""
    course_id = _validate_course_id(course_id)
    if not settings.rag_enabled:
        raise HTTPException(status_code=503, detail="RAG module disabled")

    try:
        from app.services.rag.rag_chain import rag_chain
        result = await rag_chain.answer(
            course_id=course_id,
            question=body.question,
            history=body.history,
            top_k=body.top_k,
            source_types=body.source_types,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG chain error: {str(e)}")


@router.post("/rag/ask/stream")
async def v1_rag_ask_stream(course_id: str, body: AskRequest, user=Depends(get_optional_user)):
    """RAG 提问（SSE 流式）— 复用 stream-chat.ts 协议。"""
    course_id = _validate_course_id(course_id)
    if not settings.rag_enabled:
        raise HTTPException(status_code=503, detail="RAG module disabled")

    from fastapi.responses import StreamingResponse
    from app.services.rag.rag_chain import rag_chain

    return StreamingResponse(
        rag_chain.answer_stream(
            course_id=course_id,
            question=body.question,
            history=body.history,
            top_k=body.top_k,
            source_types=body.source_types,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/rag/search")
async def v1_rag_search(course_id: str, q: str = Query(...), top_k: int = Query(default=5),
                        user=Depends(get_optional_user)):
    course_id = _validate_course_id(course_id)
    if not settings.rag_enabled:
        raise HTTPException(status_code=503, detail="RAG module disabled")
    from app.services.rag.rag_chain import rag_chain
    return await rag_chain.search_only(course_id=course_id, query=q, top_k=top_k)


@router.get("/rag/settings")
async def v1_rag_get_settings(course_id: str, user=Depends(get_optional_user)):
    from app.db.knowledge_repo import knowledge_repo
    row = await knowledge_repo.get_rag_settings(course_id)
    if row:
        return row
    return {
        "course_id": course_id,
        "top_k": settings.rag_top_k,
        "similarity_threshold": settings.rag_similarity_threshold,
        "hybrid_weight_vector": 0.7,
        "hybrid_weight_bm25": 0.3,
        "rerank_enabled": True,
        "rerank_top_k": 5,
        "chunk_size": settings.rag_chunk_size,
        "chunk_overlap": settings.rag_chunk_overlap,
        "chunking_template": "general",
    }


@router.put("/rag/settings")
async def v1_rag_update_settings(course_id: str, body: RagSettingsUpdate,
                                 user=Depends(get_current_user)):
    from app.db.knowledge_repo import knowledge_repo
    payload = body.model_dump(exclude_none=True)
    updated = await knowledge_repo.upsert_rag_settings(course_id, payload)
    return updated


@router.post("/rag/export")
async def v1_rag_export(course_id: str, body: ExportRequest, user=Depends(get_optional_user)):
    from app.services.rag.rag_chain import rag_chain
    markdown = await rag_chain.export(body.messages)
    return {"markdown": markdown}


# ============================================================================
# Knowledge endpoints — list / stats / review
# ============================================================================
@router.get("/knowledge")
async def v1_knowledge_list(course_id: str, user=Depends(get_optional_user)):
    from app.db.knowledge_repo import knowledge_repo
    entries = await knowledge_repo.list_approved_entries(course_id)
    return entries


@router.get("/knowledge/stats")
async def v1_knowledge_stats(course_id: str, user=Depends(get_optional_user)):
    from app.db.knowledge_repo import knowledge_repo
    return await knowledge_repo.get_stats(course_id)


@router.get("/knowledge/review/list")
async def v1_knowledge_review_list(course_id: str, user=Depends(get_optional_user)):
    from app.db.knowledge_repo import knowledge_repo
    entries = await knowledge_repo.list_pending_reviews(course_id)
    return entries


@router.get("/knowledge/review/approved")
async def v1_knowledge_approved(course_id: str, user=Depends(get_optional_user)):
    from app.db.knowledge_repo import knowledge_repo
    entries = await knowledge_repo.list_approved_entries(course_id)
    return entries


@router.get("/knowledge/review/all")
async def v1_knowledge_review_all(
    course_id: str,
    status: Optional[str] = Query(default=None),
    source_type: Optional[str] = Query(default=None),
    knowledge_type: Optional[str] = Query(default=None),
    user=Depends(get_optional_user),
):
    from app.db.knowledge_repo import knowledge_repo
    uid = user.user_id if user else "anonymous"
    role = user.role if user else "student"
    entries = await knowledge_repo.list_entries(
        course_id=course_id, user_id=uid, role=role,
        status=status, source_type=source_type, knowledge_type=knowledge_type,
        limit=500,
    )
    return entries


# ============================================================================
# Knowledge endpoints — upload / import
# ============================================================================
@router.post("/knowledge/upload/batch")
async def v1_knowledge_upload_batch(
    course_id: str,
    files: List[UploadFile] = File(...),
    knowledge_type: str = Form("course_notes"),
    tags: str = Form(""),
    chunking_template: str = Form("general"),
    user=Depends(get_current_user),
):
    course_id = _validate_course_id(course_id)
    from app.services.ingestion.pipeline import pipeline
    results = []
    uid = user.user_id
    role = user.role
    tag_list = _parse_tags(tags)
    for file in files:
        try:
            content = await file.read()
            result = await pipeline.ingest(
                content=content, filename=file.filename or "upload",
                source_type="file", course_id=course_id, user_id=uid, user_role=role,
                knowledge_type=knowledge_type, tags=tag_list,
                chunking_template=chunking_template,
            )
            results.append({
                "entry_id": result.entry_id, "chunk_count": result.chunk_count,
                "success": result.success, "filename": file.filename,
                "error": result.error,
            })
        except Exception as e:
            results.append({"filename": file.filename, "success": False, "error": str(e)})
    return {"results": results, "total": len(results)}


@router.post("/knowledge/upload")
async def v1_knowledge_upload_single(
    course_id: str,
    file: UploadFile = File(...),
    title: str = Form(""),
    knowledge_type: str = Form("course_notes"),
    tags: str = Form(""),
    experiment_id: str = Form(""),
    chunking_template: str = Form("general"),
    chunk_size: Optional[int] = Form(None),
    chunk_overlap: Optional[int] = Form(None),
    user=Depends(get_current_user),
):
    course_id = _validate_course_id(course_id)
    from app.services.ingestion.pipeline import pipeline
    content = await file.read()
    uid = user.user_id
    role = user.role
    result = await pipeline.ingest(
        content=content, filename=file.filename or "upload",
        source_type="file", course_id=course_id, user_id=uid, user_role=role,
        title=title or None, knowledge_type=knowledge_type, tags=_parse_tags(tags),
        experiment_id=experiment_id or None, chunking_template=chunking_template,
        chunk_size=chunk_size, chunk_overlap=chunk_overlap,
    )
    return {
        "entry_id": result.entry_id, "chunk_count": result.chunk_count,
        "success": result.success, "error": result.error, "version_no": result.version_no,
    }


@router.post("/knowledge/paste")
async def v1_knowledge_paste(course_id: str, request: Request, user=Depends(get_current_user)):
    course_id = _validate_course_id(course_id)
    from app.services.ingestion.pipeline import pipeline
    body = await request.json()
    title = body.get("title", "Pasted Knowledge")
    content_text = body.get("content", "")
    if not content_text.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    uid = user.user_id
    role = user.role
    result = await pipeline.ingest(
        content=content_text.encode(), filename="paste.txt",
        source_type="paste", course_id=course_id, user_id=uid, user_role=role,
        title=title, knowledge_type=body.get("knowledge_type", "course_notes"),
        tags=_parse_tags(body.get("tags")), experiment_id=body.get("experiment_id"),
        chunking_template=body.get("chunking_template", "general"),
        chunk_size=body.get("chunk_size"), chunk_overlap=body.get("chunk_overlap"),
    )
    return {
        "entry_id": result.entry_id, "chunk_count": result.chunk_count,
        "success": result.success, "error": result.error, "version_no": result.version_no,
    }


@router.post("/knowledge/import/url")
async def v1_knowledge_import_url(course_id: str, request: Request, user=Depends(get_current_user)):
    from app.services.ingestion.pipeline import pipeline
    import httpx
    body = await request.json()
    url = body.get("url")
    title = body.get("title", "URL Import")
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to fetch URL: {resp.status_code}")
        content = resp.content
    uid = user.user_id
    role = user.role
    result = await pipeline.ingest(
        content=content, filename=title + ".html",
        source_type="url", course_id=course_id, user_id=uid, user_role=role,
        title=title, knowledge_type=body.get("knowledge_type", "course_notes"),
        tags=_parse_tags(body.get("tags")), experiment_id=body.get("experiment_id"),
        chunking_template=body.get("chunking_template", "general"),
    )
    return {
        "entry_id": result.entry_id, "chunk_count": result.chunk_count,
        "success": result.success, "error": result.error, "version_no": result.version_no,
    }


# ============================================================================
# Knowledge endpoints — parse preview (two-stage upload)
# ============================================================================
@router.post("/knowledge/parse-preview")
async def v1_knowledge_parse_preview(
    course_id: str,
    file: UploadFile = File(...),
    chunking_template: str = Form("general"),
    chunk_size: Optional[int] = Form(None),
    chunk_overlap: Optional[int] = Form(None),
    user=Depends(get_optional_user),
):
    from app.services.ingestion.pipeline import pipeline
    content = await file.read()
    try:
        chunks = await pipeline.preview(
            content=content, filename=file.filename or "preview",
            source_type="file", chunking_template=chunking_template,
            chunk_size=chunk_size, chunk_overlap=chunk_overlap,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"解析失败: {str(e)}")
    return {"chunks": chunks, "total": len(chunks)}


@router.post("/knowledge/parse-preview/text")
async def v1_knowledge_parse_preview_text(
    course_id: str, body: PreviewTextRequest, user=Depends(get_optional_user),
):
    from app.services.ingestion.pipeline import pipeline
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    try:
        chunks = await pipeline.preview(
            content=body.content.encode("utf-8"), filename="paste.txt",
            source_type="paste", chunking_template=body.chunking_template,
            chunk_size=body.chunk_size, chunk_overlap=body.chunk_overlap,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"解析失败: {str(e)}")
    return {"chunks": chunks, "total": len(chunks)}


# ============================================================================
# Knowledge endpoints — detail / chunks / versions
# ============================================================================
@router.get("/knowledge/{entry_id}")
async def v1_knowledge_get(course_id: str, entry_id: str, user=Depends(get_optional_user)):
    from app.db.knowledge_repo import knowledge_repo
    entry = await knowledge_repo.get_entry(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@router.get("/knowledge/{entry_id}/chunks")
async def v1_knowledge_chunks(course_id: str, entry_id: str, user=Depends(get_optional_user)):
    from app.db.knowledge_repo import knowledge_repo
    chunks = await knowledge_repo.get_chunks_for_entry(entry_id)
    entry = await knowledge_repo.get_entry(entry_id)
    return {"entry_id": entry_id, "title": entry.get("title", "") if entry else "", "chunks": chunks}


@router.put("/knowledge/{entry_id}/chunks/{chunk_id}")
async def v1_knowledge_update_chunk(course_id: str, entry_id: str, chunk_id: str,
                                    body: ChunkUpdateRequest, user=Depends(get_current_user)):
    from app.db.knowledge_repo import knowledge_repo
    from app.services.ingestion.embedder import embedder
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    embedding = embedder.embed_query(content)
    ok = await knowledge_repo.update_chunk(chunk_id, content, embedding)
    if not ok:
        raise HTTPException(status_code=404, detail="Chunk not found")
    return {"ok": True, "embedding_dim": len(embedding)}


@router.get("/knowledge/{entry_id}/versions")
async def v1_knowledge_versions(course_id: str, entry_id: str, user=Depends(get_optional_user)):
    from app.db.knowledge_repo import knowledge_repo
    versions = await knowledge_repo.list_versions(entry_id)
    return versions


@router.post("/knowledge/{entry_id}/rechunk")
async def v1_knowledge_rechunk(course_id: str, entry_id: str, body: RechunkRequest,
                               user=Depends(get_current_user)):
    from app.services.ingestion.pipeline import pipeline
    result = await pipeline.rechunk_entry(
        entry_id, chunking_template=body.chunking_template,
        chunk_size=body.chunk_size, chunk_overlap=body.chunk_overlap,
    )
    if not result.success:
        raise HTTPException(status_code=500, detail=result.error)
    return {"ok": True, "chunk_count": result.chunk_count}


@router.post("/knowledge/{entry_id}/rollback")
async def v1_knowledge_rollback(course_id: str, entry_id: str, body: RollbackRequest,
                                user=Depends(get_current_user)):
    from app.services.ingestion.pipeline import pipeline
    result = await pipeline.rollback_entry(entry_id, body.version_no)
    if not result.success:
        raise HTTPException(status_code=404 if "not found" in (result.error or "").lower() else 500,
                            detail=result.error)
    return {"ok": True, "chunk_count": result.chunk_count, "version_no": result.version_no}


# ============================================================================
# Knowledge endpoints — review actions
# ============================================================================
@router.post("/knowledge/{entry_id}/approve")
async def v1_knowledge_approve(course_id: str, entry_id: str, user=Depends(require_role("teacher", "admin"))):
    from app.db.knowledge_repo import knowledge_repo
    reviewer = user.user_id
    ok = await knowledge_repo.approve_entry(entry_id, reviewer)
    return {"ok": ok}


@router.post("/knowledge/{entry_id}/reject")
async def v1_knowledge_reject(course_id: str, entry_id: str, body: Optional[RejectRequest] = None,
                              user=Depends(require_role("teacher", "admin"))):
    from app.db.knowledge_repo import knowledge_repo
    reviewer = user.user_id
    reason = body.reason if body else ""
    ok = await knowledge_repo.reject_entry(entry_id, reviewer, reason)
    return {"ok": ok}


@router.post("/knowledge/{entry_id}/unpublish")
async def v1_knowledge_unpublish(course_id: str, entry_id: str, user=Depends(require_role("teacher", "admin"))):
    from app.db.knowledge_repo import knowledge_repo
    ok = await knowledge_repo.unpublish_entry(entry_id)
    return {"ok": ok}


@router.post("/knowledge/{entry_id}/republish")
async def v1_knowledge_republish(course_id: str, entry_id: str, user=Depends(require_role("teacher", "admin"))):
    from app.db.knowledge_repo import knowledge_repo
    ok = await knowledge_repo.republish_entry(entry_id)
    return {"ok": ok}


@router.post("/knowledge/batch-review")
async def v1_knowledge_batch_review(course_id: str, body: BatchReviewRequest,
                                    user=Depends(require_role("teacher", "admin"))):
    from app.db.knowledge_repo import knowledge_repo
    if body.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be approve or reject")
    reviewer = user.user_id
    result = await knowledge_repo.batch_review(body.entry_ids, body.action, reviewer, body.reason)
    return result


@router.delete("/knowledge/{entry_id}")
async def v1_knowledge_delete(course_id: str, entry_id: str, user=Depends(require_role("teacher", "admin"))):
    from app.db.knowledge_repo import knowledge_repo
    ok = await knowledge_repo.soft_delete_entry(entry_id)
    return {"ok": ok}


@router.post("/knowledge/batch-delete")
async def v1_knowledge_batch_delete(course_id: str, request: Request, user=Depends(require_role("teacher", "admin"))):
    from app.db.knowledge_repo import knowledge_repo
    body = await request.json()
    entry_ids = body.get("entry_ids", [])
    if not entry_ids:
        raise HTTPException(status_code=400, detail="No entry_ids provided")
    deleted = []
    failed = []
    for eid in entry_ids:
        try:
            ok = await knowledge_repo.soft_delete_entry(eid)
            if ok:
                deleted.append(eid)
            else:
                failed.append(eid)
        except Exception as e:
            failed.append({"id": eid, "error": str(e)})
    return {"deleted": len(deleted), "failed": len(failed), "deleted_ids": deleted, "failed_details": failed}


# ============================================================================
# Legacy pass-through (kept for compatibility)
# ============================================================================
@router.post("/ask")
async def v1_ask(course_id: str, request: Request, user=Depends(get_optional_user)):
    from app.routers.ask_router import ask, AskRequest as AskReq
    body_data = await request.json()
    body = AskReq(**body_data)
    if not body.course_id:
        body.course_id = course_id
    return await ask(body, user)


@router.post("/chat")
async def v1_chat(course_id: str, request: Request, user=Depends(get_optional_user)):
    from app.routers.chat import chat, ChatRequest
    body_data = await request.json()
    body = ChatRequest(**body_data)
    if not body.course_id:
        body.course_id = course_id
    return await chat(body, user)