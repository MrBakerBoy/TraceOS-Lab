-- =============================================================================
-- TraceOS Lab — 死锁检测报告持久化 (Deadlock Reports)
-- 部署顺序：先执行 02-schema.sql（submissions 表）
-- 存储 eBPF/bpftrace futex tracepoint + Wait-For Graph 检测出的死锁结果，
-- 与 submission_id 关联，供前端回看与 AI 离线分析。
-- =============================================================================

CREATE TABLE IF NOT EXISTS deadlock_reports (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
    pid           INT,
    detected      BOOLEAN NOT NULL DEFAULT false,
    cycle         JSONB,          -- 死锁环 TID 数组, e.g. [2711, 2712]
    details       JSONB,          -- 详情字符串数组
    fix           TEXT,           -- core 端初步修复建议
    lock_graph    JSONB,          -- 完整锁等待图 {threads:[], locks:[]}
    syscall_counts JSONB,         -- 采集期 syscall 聚合计数
    mem_snapshots  JSONB,         -- 内存探针快照
    probes        JSONB,          -- 本次启用的探针列表
    status        VARCHAR(20) DEFAULT 'done',
    start_at      TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deadlock_reports_submission
    ON deadlock_reports(submission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deadlock_reports_detected
    ON deadlock_reports(detected) WHERE detected = true;
