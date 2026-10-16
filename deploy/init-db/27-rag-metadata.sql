-- =============================================================================
-- 27-rag-metadata.sql
-- RAG 知识库改造: 元数据 + 版本管理 + 检索参数 + 约束修正 + 向量维度对齐
--
-- 变更:
--   1. knowledge_entries 增加 knowledge_type / tags / experiment_id / version /
--      current_version_id（实验上下文 RAG 字段预留）
--   2. status 约束纳入 'unpublished'（修 S5）
--   3. source_type 约束收窄为上传方式（file/paste/url/git，修 S3/S4）
--   4. knowledge_chunks 增加 start_offset / end_offset（引用定位原文，修 E6）
--   5. 新增 knowledge_entry_versions 表（版本管理）
--   6. 新增 rag_settings 表（检索参数可配置）
--   7. embedding 向量维度对齐到外部 API（text-embedding-3-small = 1536，修 F2）
--
-- 幂等: 使用 information_schema / pg_constraint 检查，可重复执行
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. knowledge_entries 元数据列
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'knowledge_entries' AND column_name = 'knowledge_type'
    ) THEN
        ALTER TABLE knowledge_entries
            ADD COLUMN knowledge_type VARCHAR(30) NOT NULL DEFAULT 'course_notes';
        COMMENT ON COLUMN knowledge_entries.knowledge_type IS
            '知识类型: course_notes/experiment_docs/kernel_papers/error_cases/contest_materials';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'knowledge_entries' AND column_name = 'tags'
    ) THEN
        ALTER TABLE knowledge_entries
            ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
        COMMENT ON COLUMN knowledge_entries.tags IS '标签数组（死锁/进程管理/eBPF 等）';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'knowledge_entries' AND column_name = 'experiment_id'
    ) THEN
        ALTER TABLE knowledge_entries
            ADD COLUMN experiment_id UUID REFERENCES experiments(id) ON DELETE SET NULL;
        COMMENT ON COLUMN knowledge_entries.experiment_id IS
            '关联实验（实验上下文 RAG 预留，本轮暂不触发）';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'knowledge_entries' AND column_name = 'version'
    ) THEN
        ALTER TABLE knowledge_entries
            ADD COLUMN version INT NOT NULL DEFAULT 1;
        COMMENT ON COLUMN knowledge_entries.version IS '当前版本号';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'knowledge_entries' AND column_name = 'current_version_id'
    ) THEN
        ALTER TABLE knowledge_entries
            ADD COLUMN current_version_id UUID;
        COMMENT ON COLUMN knowledge_entries.current_version_id IS
            '指向 knowledge_entry_versions.id 的最新版本';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. status 约束修正（纳入 unpublished，修 S5）
-- ---------------------------------------------------------------------------
ALTER TABLE knowledge_entries DROP CONSTRAINT IF EXISTS knowledge_entries_status_check;
ALTER TABLE knowledge_entries ADD CONSTRAINT knowledge_entries_status_check
    CHECK (status IN ('pending_review', 'approved', 'rejected', 'unpublished'));

-- ---------------------------------------------------------------------------
-- 3. source_type 约束收窄为「上传方式」（修 S3/S4）
-- ---------------------------------------------------------------------------
ALTER TABLE knowledge_entries DROP CONSTRAINT IF EXISTS knowledge_entries_source_type_check;
ALTER TABLE knowledge_entries ADD CONSTRAINT knowledge_entries_source_type_check
    CHECK (source_type IN ('file', 'paste', 'url', 'git'));

-- ---------------------------------------------------------------------------
-- 4. knowledge_chunks 偏移列（引用定位原文，修 E6）
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'knowledge_chunks' AND column_name = 'start_offset'
    ) THEN
        ALTER TABLE knowledge_chunks ADD COLUMN start_offset INT;
        COMMENT ON COLUMN knowledge_chunks.start_offset IS '原文起始偏移（字符）';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'knowledge_chunks' AND column_name = 'end_offset'
    ) THEN
        ALTER TABLE knowledge_chunks ADD COLUMN end_offset INT;
        COMMENT ON COLUMN knowledge_chunks.end_offset IS '原文结束偏移（字符）';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. 版本管理表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_entry_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
    version_no INT NOT NULL,
    content_raw TEXT NOT NULL,
    chunk_count INT NOT NULL DEFAULT 0,
    change_note TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entry_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_kev_entry ON knowledge_entry_versions(entry_id, version_no DESC);

-- ---------------------------------------------------------------------------
-- 6. 检索参数可配置表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rag_settings (
    course_id UUID PRIMARY KEY,
    top_k INT NOT NULL DEFAULT 8,
    similarity_threshold REAL NOT NULL DEFAULT 0.5,
    hybrid_weight_vector REAL NOT NULL DEFAULT 0.7,
    hybrid_weight_bm25 REAL NOT NULL DEFAULT 0.3,
    rerank_enabled BOOLEAN NOT NULL DEFAULT true,
    rerank_top_k INT NOT NULL DEFAULT 5,
    chunk_size INT NOT NULL DEFAULT 512,
    chunk_overlap INT NOT NULL DEFAULT 64,
    chunking_template VARCHAR(30) NOT NULL DEFAULT 'general',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 7. 向量维度对齐到外部 API（1536 维，修 F2）
--    text-embedding-3-small = 1536。旧数据可能是 512（bge-small）或 1024（bge-m3）。
--    维度变更不可原地转换，先置 NULL，后续重摄入。
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    current_dim INTEGER;
BEGIN
    -- pgvector 把维度直接存进 typmod（无 varchar 的 +4 偏移）
    SELECT pg_attribute.atttypmod
      INTO current_dim
      FROM pg_attribute
      JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
     WHERE pg_class.relname = 'knowledge_chunks'
       AND pg_attribute.attname = 'embedding'
       AND pg_namespace.nspname = current_schema()
       AND pg_attribute.attnum > 0
       AND NOT pg_attribute.attisdropped;

    IF current_dim IS DISTINCT FROM 1536 THEN
        RAISE NOTICE 'migrating knowledge_chunks.embedding from dim=% to 1536 (existing vectors cleared, re-ingest required)', current_dim;
        -- ivfflat 索引依赖向量维度，变更维度前必须先删除
        DROP INDEX IF EXISTS idx_kc_embedding;
        UPDATE knowledge_chunks SET embedding = NULL;
        ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector(1536);
        CREATE INDEX IF NOT EXISTS idx_kc_embedding ON knowledge_chunks
            USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    END IF;
END $$;

-- 元数据索引
CREATE INDEX IF NOT EXISTS idx_ke_experiment ON knowledge_entries(experiment_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ke_tags ON knowledge_entries USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_ke_type ON knowledge_entries(knowledge_type) WHERE deleted_at IS NULL;

COMMIT;