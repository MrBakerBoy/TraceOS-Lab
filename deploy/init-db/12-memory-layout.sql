-- =============================================================================
-- TraceOS Lab — 内存布局采集 (Memory Layout Collection)
-- 部署顺序：先执行 02-schema.sql（submissions 表）
-- =============================================================================

CREATE TABLE IF NOT EXISTS memory_layouts (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    timestamp     TIMESTAMPTZ NOT NULL,
    text_start    BIGINT,
    text_size     BIGINT,
    data_start    BIGINT,
    data_size     BIGINT,
    bss_start     BIGINT,
    bss_size      BIGINT,
    heap_start    BIGINT,
    heap_size     BIGINT,
    stack_start   BIGINT,
    stack_size    BIGINT,
    mmap_regions  JSONB DEFAULT '[]',
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 转换为 TimescaleDB Hypertable（按时间分区）
SELECT create_hypertable('memory_layouts', 'timestamp', if_not_exists => TRUE);

-- 查询索引：按提交 ID + 时间排序（采集序列按时间递增）
CREATE INDEX IF NOT EXISTS idx_memory_layouts_submission
    ON memory_layouts(submission_id, timestamp);

-- 数据保留策略：90 天后自动删除
SELECT add_retention_policy('memory_layouts', INTERVAL '90 days', if_not_exists => TRUE);
