"""Text chunker — splits documents into overlapping, offset-tracked chunks.

Each chunk records ``start_offset``/``end_offset`` (character offsets into the
original document) so the citation panel can highlight the exact source span.
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from app.config import settings


@dataclass
class Chunk:
    index: int
    content: str
    metadata: dict = field(default_factory=dict)
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None


class TextChunker:
    def __init__(self, chunk_size: int = 512, chunk_overlap: int = 64, code_chunk_size: int = 256):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.code_chunk_size = code_chunk_size

    def chunk(self, doc) -> list[Chunk]:
        if getattr(doc, "source_type", "") == "code":
            return self._chunk_code(doc)
        return self._chunk_text(doc)

    # ------------------------------------------------------------------
    # Text chunking (paragraph-aligned, offset-tracked)
    # ------------------------------------------------------------------
    def _chunk_text(self, doc) -> list[Chunk]:
        text = doc.content_raw or ""
        if not text.strip():
            return [Chunk(index=0, content="", metadata={"type": "text"})]

        spans = self._paragraph_spans(text)
        merged = self._merge_spans(spans, self.chunk_size)
        chunks = []
        for start, end in merged:
            content = text[start:end].strip()
            if content:
                chunks.append(Chunk(
                    index=len(chunks),
                    content=content,
                    start_offset=start,
                    end_offset=end,
                    metadata={"type": "text", **doc.metadata},
                ))
        if not chunks:
            end = min(len(text), self.chunk_size)
            chunks.append(Chunk(
                index=0, content=text[:end], start_offset=0, end_offset=end,
                metadata={"type": "text", **doc.metadata},
            ))
        return chunks

    def _paragraph_spans(self, text: str) -> list[tuple[int, int]]:
        """Split text into paragraph spans with character offsets.

        Oversized paragraphs are further split at a sentence / whitespace
        boundary so no single span exceeds ``chunk_size``.
        """
        spans: list[tuple[int, int]] = []
        search_from = 0
        for para in re.split(r"\n\s*\n", text):
            if not para:
                continue
            idx = text.find(para, search_from)
            if idx < 0:
                idx = search_from
            start, end = idx, idx + len(para)
            search_from = end

            while end - start > self.chunk_size:
                cut = start + self.chunk_size
                window = text[start:cut]
                boundary = max(
                    window.rfind("。"), window.rfind("；"),
                    window.rfind("！"), window.rfind("？"),
                    window.rfind("."), window.rfind("\n"),
                    window.rfind(" "),
                )
                if boundary > self.chunk_size * 0.5:
                    cut = start + boundary + 1
                spans.append((start, cut))
                start = cut
            spans.append((start, end))
        return spans

    def _merge_spans(self, spans: list[tuple[int, int]], size: int) -> list[tuple[int, int]]:
        merged: list[tuple[int, int]] = []
        buf_start: Optional[int] = None
        buf_end: Optional[int] = None
        for start, end in spans:
            if buf_start is None:
                buf_start, buf_end = start, end
                continue
            if end - buf_start <= size:
                buf_end = end
            else:
                merged.append((buf_start, buf_end))
                buf_start, buf_end = start, end
        if buf_start is not None:
            merged.append((buf_start, buf_end))
        return merged

    # ------------------------------------------------------------------
    # Code chunking (line-aligned, offset-tracked)
    # ------------------------------------------------------------------
    def _chunk_code(self, doc) -> list[Chunk]:
        text = doc.content_raw or ""
        if not text.strip():
            return [Chunk(index=0, content="", metadata={"type": "code", **doc.metadata})]

        spans: list[tuple[int, int, str]] = []
        search_from = 0
        for line in text.split("\n"):
            idx = text.find(line, search_from) if line else search_from
            start = idx
            end = idx + len(line)
            spans.append((start, end, line))
            search_from = end + 1

        chunks: list[Chunk] = []
        buf_start: Optional[int] = None
        buf_end: Optional[int] = None
        buf_lines: list[str] = []
        for start, end, line in spans:
            if buf_start is None:
                buf_start, buf_end = start, end
                buf_lines = [line]
                continue
            if end - buf_start <= self.code_chunk_size:
                buf_end = end
                buf_lines.append(line)
            else:
                content = "\n".join(buf_lines).strip()
                if content:
                    chunks.append(Chunk(
                        index=len(chunks), content=content,
                        start_offset=buf_start, end_offset=buf_end,
                        metadata={"type": "code", **doc.metadata},
                    ))
                buf_start, buf_end = start, end
                buf_lines = [line]
        if buf_start is not None:
            content = "\n".join(buf_lines).strip()
            if content:
                chunks.append(Chunk(
                    index=len(chunks), content=content,
                    start_offset=buf_start, end_offset=buf_end,
                    metadata={"type": "code", **doc.metadata},
                ))
        if not chunks:
            end = min(len(text), self.code_chunk_size)
            chunks.append(Chunk(
                index=0, content=text[:end], start_offset=0, end_offset=end,
                metadata={"type": "code", **doc.metadata},
            ))
        return chunks


chunker = TextChunker(
    chunk_size=settings.rag_chunk_size,
    chunk_overlap=settings.rag_chunk_overlap,
    code_chunk_size=settings.rag_code_chunk_size,
)