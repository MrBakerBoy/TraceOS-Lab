-- ============================================================================
-- 26-test-points.sql
-- 评分系统 v2: submissions 表增加逐测试点明细与核心/附加分列
--
-- 变更:
--   1. test_points JSONB — 每个测试点的评估明细
--      (id/name/type/weight/passed/fail_reason/exec_time_ms/actual_output/
--       expected_output/assertions)
--   2. core_score INT    — 通过的核心测试点权重和
--   3. edge_score INT    — 通过的附加测试点权重和
--
-- 幂等: 使用 information_schema 检查列是否存在，可重复执行
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'submissions' AND column_name = 'test_points'
    ) THEN
        ALTER TABLE submissions ADD COLUMN test_points JSONB NOT NULL DEFAULT '[]'::jsonb;
        COMMENT ON COLUMN submissions.test_points IS
            'v2 scoring: per-test-point evaluation results (name/type/weight/passed/fail_reason/actual_output/expected_output/assertions)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'submissions' AND column_name = 'core_score'
    ) THEN
        ALTER TABLE submissions ADD COLUMN core_score INTEGER;
        COMMENT ON COLUMN submissions.core_score IS
            'v2 scoring: weighted sum of passed core test points';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'submissions' AND column_name = 'edge_score'
    ) THEN
        ALTER TABLE submissions ADD COLUMN edge_score INTEGER;
        COMMENT ON COLUMN submissions.edge_score IS
            'v2 scoring: weighted sum of passed edge test points';
    END IF;
END $$;

COMMIT;