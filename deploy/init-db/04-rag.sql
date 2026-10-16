-- TraceOS Lab 向量表 (RAG - pgvector)
-- 部署顺序：先执行 01-extensions.sql

-- ==================== RAG Knowledge Base ====================

CREATE TABLE IF NOT EXISTS rag_knowledge (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('textbook', 'manual', 'common_error', 'example_code', 'os_concept')),
    source_ref VARCHAR(200),
    title VARCHAR(200),
    content TEXT NOT NULL,
    chunk_index INT,
    embedding vector(1536), -- OpenAI embedding 维度
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 向量相似度索引（ivfflat）
CREATE INDEX IF NOT EXISTS idx_rag_embedding ON rag_knowledge USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- 全文搜索索引
CREATE INDEX IF NOT EXISTS idx_rag_search ON rag_knowledge USING gin(
    to_tsvector('english', COALESCE(title, '') || ' ' || content)
);

CREATE INDEX IF NOT EXISTS idx_rag_source ON rag_knowledge(source_type);
CREATE INDEX IF NOT EXISTS idx_rag_source_ref ON rag_knowledge(source_ref);

-- 触发器
CREATE TRIGGER update_rag_knowledge_updated_at BEFORE UPDATE ON rag_knowledge
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================== Code Embeddings ====================

CREATE TABLE IF NOT EXISTS code_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    code_hash VARCHAR(64) NOT NULL, -- SHA256
    code_snippet TEXT,
    embedding vector(1024),
    is_plagiarism BOOLEAN DEFAULT false,
    plagiarism_score FLOAT CHECK (plagiarism_score >= 0 AND plagiarism_score <= 1),
    similarity_threshold FLOAT DEFAULT 0.85 CHECK (similarity_threshold >= 0 AND similarity_threshold <= 1),
    similar_submissions UUID[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(submission_id)
);

CREATE INDEX IF NOT EXISTS idx_code_embedding ON code_embeddings USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_code_hash ON code_embeddings(code_hash);
CREATE INDEX IF NOT EXISTS idx_code_plagiarism ON code_embeddings(is_plagiarism) WHERE is_plagiarism = true;