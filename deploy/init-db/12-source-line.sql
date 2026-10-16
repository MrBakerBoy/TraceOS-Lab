-- TraceOS Lab: Source Line Tracking
-- Adds source_line column to syscall_traces for addr2line-resolved line numbers.

ALTER TABLE syscall_traces ADD COLUMN IF NOT EXISTS source_line INT;

-- Index for filtering traces that have source line info
CREATE INDEX IF NOT EXISTS idx_syscall_traces_source_line
    ON syscall_traces(submission_id, source_line) WHERE source_line IS NOT NULL;
