"""
Multi-format Document Loader - 30+ formats via LangChain-compatible interface.
"""
import io, logging, os, json as json_mod
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)
NL = chr(10)

@dataclass
class LoadedDocument:
    title: str
    content_raw: str
    source_type: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    pages: Optional[int] = None

class DocumentLoader:
    EXT_MAP = {
        ".pdf":"pypdf", ".docx":"docx", ".doc":"docx", ".pptx":"pptx", ".ppt":"pptx",
        ".xlsx":"xlsx", ".xls":"xlsx", ".csv":"csv", ".tsv":"csv", ".md":"text",
        ".txt":"text", ".html":"html", ".htm":"html", ".json":"json", ".xml":"xml",
        ".yaml":"text", ".yml":"text", ".toml":"text", ".ini":"text", ".cfg":"text",
        ".conf":"text", ".rst":"text", ".py":"code", ".js":"code", ".ts":"code",
        ".tsx":"code", ".jsx":"code", ".c":"code", ".cpp":"code", ".h":"code",
        ".hpp":"code", ".java":"code", ".go":"code", ".rs":"code", ".rb":"code",
        ".sh":"code", ".bash":"code", ".sql":"code", ".ipynb":"notebook",
    }

    def load(self, content: bytes, filename: str, source_type: str = "") -> LoadedDocument:
        ext = os.path.splitext(filename)[1].lower()
        title = os.path.splitext(os.path.basename(filename))[0]
        loader_type = self.EXT_MAP.get(ext, "text")
        logger.info(f"Loading {filename} as {loader_type}")

        loaders = {
            "pypdf": self._load_pdf, "docx": self._load_docx,
            "pptx": self._load_pptx, "xlsx": self._load_xlsx,
            "csv": self._load_csv, "html": self._load_html,
            "json": self._load_json, "xml": self._load_xml,
            "code": lambda c,t: self._load_code(c,t,ext),
            "notebook": self._load_notebook,
        }
        try:
            return loaders.get(loader_type, lambda c,t: self._load_text(c,t,ext))(content, title)
        except Exception as e:
            logger.warning(f"Loader {loader_type} failed for {filename}: {e}")
            return self._load_text(content, title, ext)

    def load_text_direct(self, text: str, title: str, source_type: str = "paste") -> LoadedDocument:
        return LoadedDocument(title=title, content_raw=text, source_type=source_type)

    def _load_pdf(self, c: bytes, t: str) -> LoadedDocument:
        texts, pages = [], 0
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(c)) as pdf:
                pages = len(pdf.pages)
                for p in pdf.pages:
                    txt = p.extract_text()
                    if txt: texts.append(txt)
                    for tb in p.extract_tables() or []:
                        if tb: texts.append(self._table_str(tb))
        except: pass
        if not texts:
            from pypdf import PdfReader
            r = PdfReader(io.BytesIO(c))
            pages = len(r.pages)
            texts = [p.extract_text() or "" for p in r.pages]
        text = NL.join(texts) or c.decode("utf-8", errors="replace")
        return LoadedDocument(title=t, content_raw=text, source_type="pdf", metadata={"pages": pages})

    def _table_str(self, t): return NL.join(" | ".join(str(x or "") for x in r) for r in t)

    def _load_docx(self, c: bytes, t: str) -> LoadedDocument:
        import docx; d = docx.Document(io.BytesIO(c))
        lines = [p.text for p in d.paragraphs if p.text.strip()]
        for tb in d.tables:
            for r in tb.rows: lines.append(" | ".join(cell.text for cell in r.cells))
        return LoadedDocument(title=t, content_raw=NL.join(lines), source_type="docx")

    def _load_pptx(self, c: bytes, t: str) -> LoadedDocument:
        from pptx import Presentation; prs = Presentation(io.BytesIO(c))
        slides = []
        for i, s in enumerate(prs.slides):
            lines = [f"Slide {i+1}"]
            for sh in s.shapes:
                if sh.has_text_frame: lines.append(sh.text_frame.text)
                if sh.has_table:
                    for r in sh.table.rows:
                        lines.append(" | ".join(cell.text for cell in r.cells))
            slides.append(NL.join(lines))
        return LoadedDocument(title=t, content_raw=(NL + NL).join(slides), source_type="pptx")

    def _load_xlsx(self, c: bytes, t: str) -> LoadedDocument:
        import openpyxl; wb = openpyxl.load_workbook(io.BytesIO(c), data_only=True)
        out = []
        for nm in wb.sheetnames:
            ws = wb[nm]; out.append(f"Sheet: {nm}")
            for r in ws.iter_rows(values_only=True):
                cells = [str(x) if x is not None else "" for x in r]
                if any(cells): out.append(" | ".join(cells))
        return LoadedDocument(title=t, content_raw=NL.join(out), source_type="xlsx")

    def _load_csv(self, c: bytes, t: str) -> LoadedDocument:
        return LoadedDocument(title=t, content_raw=c.decode("utf-8", errors="replace"), source_type="csv")

    def _load_html(self, c: bytes, t: str) -> LoadedDocument:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(c, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]): tag.decompose()
        return LoadedDocument(title=t, content_raw=soup.get_text(NL, strip=True), source_type="html")

    def _load_json(self, c: bytes, t: str) -> LoadedDocument:
        d = json_mod.loads(c.decode("utf-8"))
        return LoadedDocument(title=t, content_raw=json_mod.dumps(d, indent=2, ensure_ascii=False), source_type="json")

    def _load_xml(self, c: bytes, t: str) -> LoadedDocument:
        from bs4 import BeautifulSoup
        return LoadedDocument(title=t, content_raw=BeautifulSoup(c, "xml").get_text(NL, strip=True), source_type="xml")

    def _load_text(self, c: bytes, t: str, ext: str) -> LoadedDocument:
        try: text = c.decode("utf-8")
        except: text = c.decode("utf-8", errors="replace")
        return LoadedDocument(title=t, content_raw=text, source_type=ext.lstrip("."))

    def _load_code(self, c: bytes, t: str, ext: str) -> LoadedDocument:
        try: code = c.decode("utf-8")
        except: code = c.decode("utf-8", errors="replace")
        lang = ext.lstrip(".")
        return LoadedDocument(title=t, content_raw="`" + lang + NL + code + NL + "`", source_type=lang)

    def _load_notebook(self, c: bytes, t: str) -> LoadedDocument:
        nb = json_mod.loads(c.decode("utf-8", errors="replace"))
        cells = []
        for cell in nb.get("cells", []):
            src = "".join(cell.get("source", []))
            cells.append("`python" + NL + src + NL + "`" if cell.get("cell_type") == "code" else src)
        return LoadedDocument(title=t, content_raw=(NL + NL).join(cells), source_type="ipynb")

document_loader = DocumentLoader()
