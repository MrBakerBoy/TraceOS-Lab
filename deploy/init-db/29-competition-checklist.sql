-- ============================================================================
-- 29-competition-checklist.sql
-- 竞争模拟 + 校验清单后端化
--
-- 变更:
--   1. submissions.competition_mode VARCHAR(20) — 提交时选择的竞争模拟模式
--      (high = 高并发竞争, low = 低竞争), 默认 'high'
--   2. submissions.checklist JSONB — 由评估流水线派生的校验清单
--      ([{key,label,status,detail}], status ∈ passed|failed|unknown)
--
-- 幂等: 使用 information_schema 检查列是否存在，可重复执行
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'submissions' AND column_name = 'competition_mode'
    ) THEN
        ALTER TABLE submissions ADD COLUMN competition_mode VARCHAR(20) NOT NULL DEFAULT 'high';
        COMMENT ON COLUMN submissions.competition_mode IS
            'competition simulation mode chosen at submit time: high | low';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'submissions' AND column_name = 'checklist'
    ) THEN
        ALTER TABLE submissions ADD COLUMN checklist JSONB NOT NULL DEFAULT '[]'::jsonb;
        COMMENT ON COLUMN submissions.checklist IS
            'v2 evaluation: derived verification checklist (key/label/status/detail)';
    END IF;
END $$;

COMMIT;