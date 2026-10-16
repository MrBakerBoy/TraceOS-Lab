"""TraceOS Lab - RAG Module v2.0"""
# Lazy imports to avoid requiring all deps at startup

def _get_document_loader():
    from app.services.rag.document_loader import DocumentLoader, document_loader
    return DocumentLoader, document_loader


def _get_embedding_service():
    from app.services.rag.embedding_service import EmbeddingService, embedding_service
    return EmbeddingService, embedding_service


def _get_hybrid_retriever():
    from app.services.rag.hybrid_retriever import HybridRetriever, hybrid_retriever
    return HybridRetriever, hybrid_retriever


def _get_reranker():
    from app.services.rag.reranker import Reranker, reranker
    return Reranker, reranker


def _get_rag_chain():
    from app.services.rag.rag_chain import RAGChain, rag_chain
    return RAGChain, rag_chain