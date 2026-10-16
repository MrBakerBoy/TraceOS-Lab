-- TraceOS Lab 时序数据表 (TimescaleDB Hypertables)
-- 部署顺序：先执行 01-extensions.sql, 02-schema.sql

-- ==================== Syscall Traces ====================

CREATE TABLE IF NOT EXISTS syscall_traces (
    time TIMESTAMPTZ NOT NULL,
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    pid INT NOT NULL,
    tid INT,
    syscall_name VARCHAR(100) NOT NULL,
    syscall_number INT,
    args JSONB,
    return_value BIGINT,
    return_value_hex VARCHAR(20),
    error_code INT,
    error_name VARCHAR(50),
    duration_ns BIGINT,
    cpu_id INT,
    call_stack JSONB
);

-- 转换为 TimescaleDB Hypertable（自动按时间分区）
SELECT create_hypertable('syscall_traces', 'time', if_not_exists => TRUE);

-- 索引
CREATE INDEX IF NOT EXISTS idx_syscall_traces_submission ON syscall_traces(submission_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_syscall_traces_pid ON syscall_traces(submission_id, pid, time);
CREATE INDEX IF NOT EXISTS idx_syscall_traces_syscall ON syscall_traces(submission_id, syscall_name, time);
CREATE INDEX IF NOT EXISTS idx_syscall_traces_error ON syscall_traces(submission_id, error_code) WHERE error_code != 0;

-- 连续聚合：按 syscall 类型统计（1 小时粒度）
CREATE MATERIALIZED VIEW IF NOT EXISTS syscall_stats_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    submission_id,
    syscall_name,
    COUNT(*) AS call_count,
    AVG(duration_ns) AS avg_duration_ns,
    SUM(duration_ns) AS total_duration_ns,
    MIN(duration_ns) AS min_duration_ns,
    MAX(duration_ns) AS max_duration_ns,
    COUNT(CASE WHEN error_code != 0 THEN 1 END) AS error_count
FROM syscall_traces
GROUP BY bucket, submission_id, syscall_name;

-- 自动刷新连续聚合视图（每小时）
SELECT add_continuous_aggregate_policy('syscall_stats_1h',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE);

-- 数据保留策略：90 天后自动删除
SELECT add_retention_policy('syscall_traces', INTERVAL '90 days', if_not_exists => TRUE);

-- ==================== Perf Events ====================

CREATE TABLE IF NOT EXISTS perf_events (
    time TIMESTAMPTZ NOT NULL,
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    pid INT NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    event_name VARCHAR(100),
    data JSONB NOT NULL,
    cpu_id INT,
    duration_ns BIGINT
);

SELECT create_hypertable('perf_events', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_perf_events_submission ON perf_events(submission_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_perf_events_type ON perf_events(submission_id, event_type, time);
CREATE INDEX IF NOT EXISTS idx_perf_events_pid ON perf_events(submission_id, pid, time);

-- 调度延迟统计（1 分钟粒度）
CREATE MATERIALIZED VIEW IF NOT EXISTS sched_latency_stats_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time) AS bucket,
    submission_id,
    pid,
    AVG((data->>'latency_ns')::BIGINT) AS avg_latency_ns,
    MAX((data->>'latency_ns')::BIGINT) AS max_latency_ns,
    MIN((data->>'latency_ns')::BIGINT) AS min_latency_ns,
    COUNT(*) AS context_switches
FROM perf_events
WHERE event_type = 'sched_switch'
GROUP BY bucket, submission_id, pid;

SELECT add_continuous_aggregate_policy('sched_latency_stats_1m',
    start_offset => INTERVAL '1 day',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => TRUE);

SELECT add_retention_policy('perf_events', INTERVAL '30 days', if_not_exists => TRUE);

-- ==================== Resource Usage ====================

CREATE TABLE IF NOT EXISTS resource_usage (
    time TIMESTAMPTZ NOT NULL,
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    pid INT NOT NULL,
    cpu_percent FLOAT CHECK (cpu_percent >= 0 AND cpu_percent <= 100),
    memory_bytes BIGINT CHECK (memory_bytes >= 0),
    memory_percent FLOAT CHECK (memory_percent >= 0 AND memory_percent <= 100),
    disk_read_bytes BIGINT DEFAULT 0,
    disk_write_bytes BIGINT DEFAULT 0,
    network_rx_bytes BIGINT DEFAULT 0,
    network_tx_bytes BIGINT DEFAULT 0
);

SELECT create_hypertable('resource_usage', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_resource_usage_submission ON resource_usage(submission_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_resource_usage_pid ON resource_usage(submission_id, pid, time);

SELECT add_retention_policy('resource_usage', INTERVAL '30 days', if_not_exists => TRUE);