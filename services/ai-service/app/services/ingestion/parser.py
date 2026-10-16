"""Document parser - extracts text from PDF, Markdown, text, code files."""

import io
from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)


@dataclass
class ParsedDocument:
    title: str
    content_raw: str
    source_type: str
    metadata: dict = field(default_factory=dict)


class DocumentParser:
    SUPPORTED_EXTENSIONS = {".pdf", ".md", ".txt", ".c", ".h", ".py", ".cpp", ".hpp",
                            ".java", ".go", ".rs", ".docx", ".doc", ".pptx", ".ppt",
                            ".xlsx", ".xls", ".csv", ".tsv", ".html", ".htm", ".json",
                            ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
                            ".rst", ".js", ".ts", ".tsx", ".jsx", ".rb", ".sh", ".bash",
                            ".sql", ".ipynb"}

    def parse(self, content: bytes, filename: str, source_type: str) -> ParsedDocument:
        """Parse a document. For formats not natively handled (docx, pptx, xlsx,
        csv, html, json, xml, ipynb, etc.), delegates to the more capable
        DocumentLoader from app.services.rag.document_loader."""
        ext = self._get_extension(filename)
        title = filename.rsplit(".", 1)[0] if "." in filename else filename

        if ext == ".pdf":
            return self._parse_pdf(content, title)
        elif ext in (".md", ".txt", ".yaml", ".yml", ".toml", ".ini", ".cfg",
                     ".conf", ".rst"):
            return self._parse_text(content, title, source_type, ext)
        elif ext in (".c", ".h", ".py", ".cpp", ".hpp", ".java", ".go", ".rs",
                     ".js", ".ts", ".tsx", ".jsx", ".rb", ".sh", ".bash", ".sql"):
            return self._parse_code(content, title, ext)
        else:
            return self._parse_with_document_loader(content, filename, title, source_type)

    def _parse_with_document_loader(self, content: bytes, filename: str,
                                     title: str, source_type: str) -> ParsedDocument:
        """Delegate to the full-featured DocumentLoader for rich formats."""
        try:
            from app.services.rag.document_loader import document_loader as dl
            doc = dl.load(content, filename, source_type)
            return ParsedDocument(
                title=doc.title,
                content_raw=doc.content_raw,
                source_type=doc.source_type or source_type,
                metadata=doc.metadata,
            )
        except Exception as e:
            logger.warning(
                "DocumentLoader fallback failed for %s: %s, using raw text",
                filename, e,
            )
            return self._parse_text(content, title, source_type, self._get_extension(filename))

    def parse_text_direct(self, text: str, title: str, source_type: str) -> ParsedDocument:
        return ParsedDocument(title=title, content_raw=text, source_type=source_type)

    def _get_extension(self, filename: str) -> str:
        dot = filename.rfind(".")
        return filename[dot:].lower() if dot >= 0 else ""

    def _parse_pdf(self, content: bytes, title: str) -> ParsedDocument:
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            texts = []
            for page in reader.pages:
                t = page.extract_text()
                if t:
                    texts.append(t)
            return ParsedDocument(title=title, content_raw="\n".join(texts), source_type="pdf")
        except Exception as e:
            logger.warning("PyPDF2 failed for %s: %s, falling back to raw", title, e)
            return ParsedDocument(title=title, content_raw=content.decode("utf-8", errors="replace"), source_type="pdf")

    def _parse_text(self, content: bytes, title: str, source_type: str, ext: str) -> ParsedDocument:
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            text = content.decode("utf-8", errors="replace")
        return ParsedDocument(title=title, content_raw=text, source_type=source_type)

    def _parse_code(self, content: bytes, title: str, ext: str) -> ParsedDocument:
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            text = content.decode("utf-8", errors="replace")
        return ParsedDocument(
            title=title, content_raw=text, source_type="code",
            metadata={"language": ext.lstrip("."), "filename": title + ext},
        )


document_parser = DocumentParser()
