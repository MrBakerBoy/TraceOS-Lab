"""RAG Module Configuration"""
from dataclasses import dataclass, field
from typing import List

from app.config import settings


@dataclass
class RAGConfig:
    embedding_model: str = settings.rag_embedding_model
    embedding_dim: int = settings.rag_embedding_dimension
    embedding_batch_size: int = settings.rag_embedding_batch_size
    chunk_size: int = settings.rag_chunk_size
    chunk_overlap: int = settings.rag_chunk_overlap
    code_chunk_size: int = settings.rag_code_chunk_size
    top_k: int = settings.rag_top_k
    similarity_threshold: float = settings.rag_similarity_threshold
    max_context_tokens: int = settings.rag_max_context_tokens
    max_file_size_mb: int = settings.rag_max_file_size_mb
    max_git_repo_size_mb: int = settings.rag_max_git_repo_size_mb
    hybrid_weight_vector: float = 0.7
    hybrid_weight_bm25: float = 0.3
    reranker_model: str = "BAAI/bge-reranker-base"
    rerank_top_k: int = 5
    cache_enabled: bool = True
    cache_ttl: int = 3600
    supported_extensions: List[str] = field(default_factory=lambda: [
        ".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
        ".csv", ".tsv", ".md", ".txt", ".html", ".htm", ".json", ".xml",
        ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".rst",
        ".py", ".js", ".ts", ".tsx", ".jsx", ".c", ".cpp", ".h", ".hpp",
        ".java", ".go", ".rs", ".rb", ".sh", ".bash", ".sql", ".ipynb",
    ])

rag_config = RAGConfig()
