"""TraceOS Lab AI Service - RAG Pydantic Models"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, HttpUrl


class PasteRequest(BaseModel):
    title: str
    content: Optional[str] = None
    url: Optional[str] = None


class URLImportRequest(BaseModel):
    url: HttpUrl
    title: Optional[str] = None


class AskRequest(BaseModel):
    question: str
    stream: bool = False


class KnowledgeEntryResponse(BaseModel):
    id: str
    course_id: str
    title: str
    source_type: str
    submitted_by: str
    status: str
    created_at: datetime
    updated_at: datetime


class KnowledgeDetailResponse(BaseModel):
    id: str
    course_id: str
    title: str
    source_type: str
    submitted_by: str
    content_raw: str
    status: str
    created_at: datetime
    updated_at: datetime


class ReviewActionRequest(BaseModel):
    reason: Optional[str] = None


class RagSearchResult(BaseModel):
    entry_id: str
    title: str
    chunk_index: int
    content: str
    similarity: float
    metadata: Optional[dict] = None

    class Config:
        from_attributes = True


class RagAskResponse(BaseModel):
    question: str
    answer: str
    sources: list[RagSearchResult] = Field(default_factory=list)
    model: str = "deepseek-v4-pro"


class IngestionResponse(BaseModel):
    entry_id: str
    chunk_count: int
    success: bool
    error: Optional[str] = None
