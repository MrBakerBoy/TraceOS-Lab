-- Multi-language experiment code templates
-- Adds per-language starter_code and reference_solution support

CREATE TABLE IF NOT EXISTS experiment_code_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    language VARCHAR(20) NOT NULL CHECK (language IN ('c', 'cpp', 'python', 'rust', 'go')),
    starter_code TEXT,
    reference_solution TEXT,
    is_published BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(experiment_id, language)
);

CREATE INDEX IF NOT EXISTS idx_ect_experiment ON experiment_code_templates(experiment_id);
CREATE INDEX IF NOT EXISTS idx_ect_language ON experiment_code_templates(language);

-- Backfill: copy existing C starter_code and reference_solution into templates table
INSERT INTO experiment_code_templates (experiment_id, language, starter_code, reference_solution, is_published)
SELECT id, 'c', starter_code, reference_solution, true
FROM experiments
WHERE starter_code IS NOT NULL OR reference_solution IS NOT NULL
ON CONFLICT (experiment_id, language) DO NOTHING;
