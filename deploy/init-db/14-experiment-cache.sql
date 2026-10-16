-- =============================================================================
-- TraceOS Lab - 实验缓存表 (记忆功能)
-- =============================================================================
-- 持久化火焰图、eBPF 追踪、代码审计等生成结果，避免重复生成
-- TTL: 默认 3 天，可通过 experiment_cache_ttl_days 环境变量调整
-- =============================================================================

CREATE TABLE IF NOT EXISTS experiment_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cache_type VARCHAR(50) NOT NULL CHECK (cache_type IN (
        'flamegraph',
        'ebpf_trace',
        'code_audit',
        'waterfall',
        'memory3d',
        'live_perf',
        'ai_analysis'
    )),
    data JSONB NOT NULL DEFAULT '{}',
    data_size_bytes INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '3 days'),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(experiment_id, submission_id, cache_type, user_id)
);

-- 索引: 按实验+用户查询缓存 (进入实验时加载)
CREATE INDEX IF NOT EXISTS idx_experiment_cache_lookup
    ON experiment_cache(experiment_id, user_id, cache_type);

-- 索引: 按过期时间清理
CREATE INDEX IF NOT EXISTS idx_experiment_cache_expires
    ON experiment_cache(expires_at);

-- 索引: 按提交查询缓存 (提交新代码后失效旧缓存)
CREATE INDEX IF NOT EXISTS idx_experiment_cache_submission
    ON experiment_cache(submission_id, cache_type);

-- 自动清理过期缓存 (每天凌晨 3 点)
-- 使用 pg_cron 如果可用，否则由 Go 服务定时清理
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'cleanup-experiment-cache',
            '0 3 * * *',
            'DELETE FROM experiment_cache WHERE expires_at < NOW()'
        );
    END IF;
END $$;
