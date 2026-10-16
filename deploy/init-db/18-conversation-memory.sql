-- ============================================================================
-- Phase 3: L1 Short-Term Memory (Conversation Compression)
-- ============================================================================

-- Conversation memory (compression state per conversation)
CREATE TABLE IF NOT EXISTS conversation_memories (
    conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    full_summary TEXT,
    key_facts JSONB DEFAULT '[]',
    compressed_until_turn INT DEFAULT 0,
    last_compressed_at TIMESTAMPTZ,
    total_compressed_tokens INT DEFAULT 0,
    memory_version INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages additions for compression tracking
ALTER TABLE messages ADD COLUMN IF NOT EXISTS importance FLOAT DEFAULT 0.5;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_compressed BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS compressed_summary TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS turn_index INT;

-- Index for efficient compressed/uncompressed message queries
CREATE INDEX IF NOT EXISTS idx_messages_compressed ON messages(conversation_id, is_compressed, turn_index);
CREATE INDEX IF NOT EXISTS idx_messages_importance ON messages(conversation_id, importance DESC);

-- ============================================================================
-- Phase 4: L3 Long-Term Memory (Cross-Session Knowledge)
-- ============================================================================

CREATE TABLE IF NOT EXISTS long_term_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    experiment_id UUID,
    memory_type TEXT NOT NULL,
    content TEXT NOT NULL,
    importance FLOAT DEFAULT 0.5,
    source_conversation_ids UUID[],
    hit_count INT DEFAULT 0,
    last_recalled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ltm_user_exp ON long_term_memories(user_id, experiment_id);
CREATE INDEX IF NOT EXISTS idx_ltm_importance ON long_term_memories(user_id, importance DESC);