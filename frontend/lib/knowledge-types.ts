/**
 * Knowledge base shared types — data contracts mirrored from the AI service
 * reference/retrieval response shapes.
 */

export interface Reference {
  id: string;
  entry_id: string;
  title: string;
  knowledge_type: string;
  tags: string[];
  chunk_index: number;
  content: string;
  similarity: number;
  start_offset?: number | null;
  end_offset?: number | null;
  matched_keywords?: string[];
  /** 1-based citation number assigned by the backend / frontend ordering. */
  index?: number;
}

export interface RetrievalMeta {
  mode: "hybrid" | "vector" | "blocked";
  recalled: number;
  reranked: number;
  passed_threshold: number;
  threshold: number;
  elapsed_ms: number;
}

export interface RagSettings {
  course_id?: string;
  top_k: number;
  similarity_threshold: number;
  hybrid_weight_vector: number;
  hybrid_weight_bm25: number;
  rerank_enabled: boolean;
  rerank_top_k: number;
  chunk_size: number;
  chunk_overlap: number;
  chunking_template: string;
}

export interface KnowledgeChunk {
  id: string;
  chunk_index: number;
  content: string;
  metadata?: Record<string, unknown>;
  start_offset?: number | null;
  end_offset?: number | null;
}

export interface KnowledgeEntry {
  id: string;
  entry_id?: string;
  course_id?: string;
  title: string;
  source_type: string;
  status: string;
  knowledge_type: string;
  tags: string[];
  experiment_id?: string | null;
  submitted_by?: string;
  review_comment?: string;
  version?: number;
  current_version_id?: string;
  chunk_count?: number;
  content_raw?: string;
  created_at?: string;
  updated_at?: string;
}

export interface KnowledgeVersion {
  id: string;
  entry_id: string;
  version_no: number;
  chunk_count: number;
  change_note?: string;
  created_by?: string;
  created_at?: string;
}

export interface KnowledgeStats {
  total_documents: number;
  total_chunks: number;
  by_knowledge_type: Array<{ type: string; count: number }>;
  by_status: Array<{ status: string; count: number }>;
  top_tags: Array<{ tag: string; count: number }>;
}

export interface SearchResult {
  results: Reference[];
  retrieval_meta: RetrievalMeta;
}

export interface RagAnswer {
  answer: string;
  references: Reference[];
  retrieval_meta: RetrievalMeta;
  context_used?: boolean;
  blocked?: boolean;
  blocked_reason?: string;
}

export interface RagChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  references?: Reference[];
  retrieval_meta?: RetrievalMeta;
  blocked?: boolean;
  createdAt: number;
}

export interface StageInfo {
  name: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
}

export interface UploadResult {
  filename?: string;
  entry_id: string;
  chunk_count: number;
  success: boolean;
  error?: string;
  version_no?: number;
}