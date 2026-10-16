-- =============================================================================
-- TraceOS Lab — RAG 知识库模块 数据库迁移
-- 版本：v1.0
-- 日期：2026-06-22
-- Vector 维度：512（BGE-small-zh-v1.5）
-- =============================================================================

-- 1. knowledge_entries — 知识条目表
CREATE TABLE IF NOT EXISTS knowledge_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id   UUID NOT NULL,
    title       VARCHAR(500) NOT NULL,
    source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('file', 'paste', 'url', 'git')),
    source_url  TEXT,
    file_path   TEXT,
    content_raw TEXT,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN ('pending_review', 'approved', 'rejected')),
    submitted_by UUID NOT NULL,
    reviewed_by  UUID,
    review_comment TEXT,
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. knowledge_chunks — 知识块表（含向量）
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id    UUID NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content     TEXT NOT NULL,
    embedding   VECTOR(512),
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 索引
CREATE INDEX IF NOT EXISTS idx_ke_course_status ON knowledge_entries(course_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ke_submitted ON knowledge_entries(submitted_by);
CREATE INDEX IF NOT EXISTS idx_kc_entry ON knowledge_chunks(entry_id);
CREATE INDEX IF NOT EXISTS idx_kc_embedding ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_kc_search ON knowledge_chunks USING gin(search_vector);

-- 4. 注释
COMMENT ON TABLE knowledge_entries IS 'RAG 知识库条目，按课程隔离，支持审核流程';
COMMENT ON TABLE knowledge_chunks IS 'RAG 知识库向量化片段，512 维 BGE embedding';
