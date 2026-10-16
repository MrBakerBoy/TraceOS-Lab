-- =============================================================================
-- TraceOS Lab - Experiment Reports Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS experiment_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    file_url TEXT,
    score INT CHECK (score >= 0 AND score <= 100),
    feedback TEXT,
    status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('submitted', 'graded')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(submission_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_submission ON experiment_reports(submission_id);
CREATE INDEX IF NOT EXISTS idx_reports_student ON experiment_reports(student_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON experiment_reports(status);
