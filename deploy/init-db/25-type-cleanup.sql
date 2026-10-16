-- ============================================================================
-- 25-type-cleanup.sql
-- 完成 test_cases.type 值从旧到新的迁移，并收紧 CHECK 约束只允许新值。
--
-- 背景:
--   22-v2-scoring-migration.sql 将约束扩展为同时接受新旧值 (core/edge/normal/edge_case)，
--   但旧值转换的 UPDATE 之前被注释掉。本迁移执行数据转换并清理约束。
--
-- 幂等:
--   - UPDATE 语句只修改匹配行（已转换的行不受影响）
--   - 动态 DROP CONSTRAINT，允许重复执行
--   - ADD CONSTRAINT 使用 IF NOT EXISTS 语义（PostgreSQL 不支持此语法，用 DO 块保护）
-- ============================================================================

BEGIN;

-- Step 1: 将旧 type 值转换为新值（幂等：已转换行不受影响）
UPDATE test_cases SET type = 'core' WHERE type = 'normal';
UPDATE test_cases SET type = 'edge' WHERE type = 'edge_case';

-- Step 2: 删除所有现有的 type CHECK 约束（可能为旧名 test_cases_type_check 或自动生成名）
DO $$
DECLARE
    c_name text;
BEGIN
    FOR c_name IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'test_cases'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) LIKE '%type%'
    LOOP
        EXECUTE format('ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS %I', c_name);
    END LOOP;
END $$;

-- Step 3: 添加干净的约束（只允许新值）
DO $$
BEGIN
    -- 仅在约束不存在时添加
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'test_cases'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) LIKE '%type%'
    ) THEN
        ALTER TABLE test_cases ADD CONSTRAINT test_cases_type_check
            CHECK (type IN ('core', 'edge', 'performance', 'security'));
    END IF;
END $$;

-- Step 4: 更新列注释
COMMENT ON COLUMN test_cases.type IS
    'Test point type: core (teaching-mode must-pass), edge (bonus/optional), performance, security';

COMMIT;