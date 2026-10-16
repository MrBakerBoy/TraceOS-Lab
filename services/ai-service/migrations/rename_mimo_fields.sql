-- =============================================================================
-- Migration: Rename MiMo-specific columns to LLM-generic names
-- Purpose:  Remove MiMo branding, support multi-provider LLM architecture
-- Date:    2026-06-29
-- =============================================================================

-- Step 1: Check if old column names exist before renaming
DO $$
BEGIN
    -- diagnoses table: mimo_model -> llm_model
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'diagnoses' AND column_name = 'mimo_model'
    ) THEN
        ALTER TABLE diagnoses RENAME COLUMN mimo_model TO llm_model;
        RAISE NOTICE 'Renamed diagnoses.mimo_model -> llm_model';
    END IF;
END $$;

DO $$
BEGIN
    -- diagnoses table: mimo_tokens_used -> llm_tokens_used
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'diagnoses' AND column_name = 'mimo_tokens_used'
    ) THEN
        ALTER TABLE diagnoses RENAME COLUMN mimo_tokens_used TO llm_tokens_used;
        RAISE NOTICE 'Renamed diagnoses.mimo_tokens_used -> llm_tokens_used';
    END IF;
END $$;

-- Step 2: Add new columns if they don't exist (fresh install scenario)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'diagnoses' AND column_name = 'llm_model'
    ) THEN
        ALTER TABLE diagnoses ADD COLUMN llm_model VARCHAR(64);
        RAISE NOTICE 'Added diagnoses.llm_model column';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'diagnoses' AND column_name = 'llm_tokens_used'
    ) THEN
        ALTER TABLE diagnoses ADD COLUMN llm_tokens_used INTEGER DEFAULT 0;
        RAISE NOTICE 'Added diagnoses.llm_tokens_used column';
    END IF;
END $$;

-- Step 3: Verify migration
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'diagnoses'
  AND column_name IN ('llm_model', 'llm_tokens_used', 'mimo_model', 'mimo_tokens_used');
