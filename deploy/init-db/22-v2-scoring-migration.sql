-- ============================================================================
-- 22-v2-scoring-migration.sql
-- 评分系统 v2 数据库迁移
--
-- 变更:
--   1. submissions 表新增 is_qualified 列
--   2. test_cases 表 type CHECK 约束扩展，允许 "core"/"edge" 值
--   3. (可选) 迁移现有 type 值: "normal"→"core", "edge_case"→"edge"
--
-- 幂等: 所有语句使用 IF NOT EXISTS / IF EXISTS 保护
-- 回滚: 注释掉 ALTER COLUMN 语句，保留旧值不受影响
-- ============================================================================

BEGIN;

-- ── 1. submissions 表: 新增 is_qualified 列 ──
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'submissions' AND column_name = 'is_qualified'
    ) THEN
        ALTER TABLE submissions ADD COLUMN is_qualified BOOLEAN;
        COMMENT ON COLUMN submissions.is_qualified IS
            'v2 scoring: true if all core test points passed (teaching mode) or total_score=100 (strict mode)';
    END IF;
END $$;

-- ── 2. test_cases 表: 扩展 type CHECK 约束 ──
-- 先 DROP 旧约束（名称可能因 PostgreSQL 版本而异，使用动态查找）
DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'test_cases'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%type%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE test_cases DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

-- 添加新约束，允许 core/edge + 旧值共存
ALTER TABLE test_cases ADD CONSTRAINT test_cases_type_check
    CHECK (type IN ('core', 'edge', 'normal', 'edge_case', 'performance', 'security'));

-- ── 3. 迁移现有 type 值 ──
-- 将旧 type 值 (normal/edge_case) 迁移到新值 (core/edge)
UPDATE test_cases SET type = 'core' WHERE type = 'normal';
UPDATE test_cases SET type = 'edge' WHERE type = 'edge_case';

COMMENT ON COLUMN test_cases.type IS
    'Test point type: core (must pass for is_qualified), edge (bonus/optional), normal (legacy→core), edge_case (legacy→edge), performance, security';

COMMIT;