-- =============================================================================
-- TraceOS Lab - AI 诊断表 (M2 规范)
-- 此文件是 diagnoses 表的权威定义
-- 02-schema.sql 中的 diagnoses 定义已被移除，由本文件取代
-- =============================================================================

CREATE TABLE IF NOT EXISTS diagnoses (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id       UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    student_id          UUID NOT NULL REFERENCES users(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
    error_type          VARCHAR(50),
    severity            VARCHAR(20),
    root_cause          TEXT,
    feedback_l1         TEXT,
    feedback_l2         TEXT,
    feedback_l3         TEXT,
    related_concepts    JSONB DEFAULT '[]',
    related_syscalls    JSONB DEFAULT '[]',
    suggested_fixes     JSONB DEFAULT '[]',
    confidence_score    FLOAT DEFAULT 0,
    mimo_model          VARCHAR(50),
    mimo_tokens_used    INT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_diagnoses_submission ON diagnoses(submission_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_student ON diagnoses(student_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_error_type ON diagnoses(error_type);
