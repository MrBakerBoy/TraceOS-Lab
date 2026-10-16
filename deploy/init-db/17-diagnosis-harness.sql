-- =============================================================================
-- TraceOS Lab - AI 诊断 Harness 数据表 (Phase 1+2)
-- 对应 agent-diagnosis-upgrade-plan.md 第八章
-- =============================================================================

-- 依赖 02-schema.sql (submissions, experiments, users) 已存在

-- ---------------------------------------------------------------------------
-- 1. diagnosis_reports — 诊断报告主表 (六维评分 + 校验元数据 + 成本)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diagnosis_reports (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id       UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    student_id          UUID NOT NULL REFERENCES users(id),
    experiment_id       UUID NOT NULL,
    trace_id            VARCHAR(64),

    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'degraded')),

    -- 六维评分 (Evaluator 校准后最终分,各维度满分即列名所示)
    correctness_score       DECIMAL(5,2) DEFAULT 0,   -- 正确性 (0-30)
    completeness_score     DECIMAL(5,2) DEFAULT 0,   -- 完整性 (0-15)
    concept_score          DECIMAL(5,2) DEFAULT 0,   -- OS 概念理解 (0-25)
    code_quality_score     DECIMAL(5,2) DEFAULT 0,   -- 代码质量 (0-15)
    runtime_behavior_score DECIMAL(5,2) DEFAULT 0,   -- 运行时行为 (0-10)
    performance_score      DECIMAL(5,2) DEFAULT 0,   -- 性能效率 (0-5)
    total_score            DECIMAL(5,2) DEFAULT 0,

    -- 确定性评分器原始产出
    raw_test_score         INT,
    raw_output_score       INT,
    raw_structure_score    INT,
    raw_behavior_score     INT,
    raw_fd_balance         INT,
    raw_memory_balance     INT,
    raw_process_balance    INT,

    -- 诊断内容
    summary            TEXT,
    strength_points    JSONB DEFAULT '[]',
    weakness_points    JSONB DEFAULT '[]',
    related_concepts   JSONB DEFAULT '[]',
    related_syscalls   JSONB DEFAULT '[]',
    suggested_fixes   JSONB DEFAULT '[]',
    feedback_levels   JSONB DEFAULT '{}',

    -- 可视化数据
    radar_data        JSONB DEFAULT '{}',
    concept_radar     JSONB DEFAULT '{}',

    -- 校验元数据
    confidence_score       DECIMAL(3,2) DEFAULT 0,
    agent_agreement_score  DECIMAL(3,2) DEFAULT 0,
    evaluator_model        VARCHAR(50),
    evaluator_rubric_version VARCHAR(20),
    requires_review        BOOLEAN DEFAULT FALSE,
    review_reason          TEXT,
    calibration_kappa      DECIMAL(3,2) DEFAULT 0,

    -- 成本追踪
    llm_model          VARCHAR(50),
    llm_tokens_used    INT DEFAULT 0,
    total_cost_cents   INT DEFAULT 0,

    -- 降级标记
    degraded           BOOLEAN DEFAULT FALSE,
    degradation_reason TEXT,

    generated_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dr_submission ON diagnosis_reports(submission_id);
CREATE INDEX IF NOT EXISTS idx_dr_student ON diagnosis_reports(student_id);
CREATE INDEX IF NOT EXISTS idx_dr_experiment ON diagnosis_reports(experiment_id);
CREATE INDEX IF NOT EXISTS idx_dr_status ON diagnosis_reports(status);
CREATE INDEX IF NOT EXISTS idx_dr_confidence ON diagnosis_reports(confidence_score)
    WHERE confidence_score < 0.6;
CREATE INDEX IF NOT EXISTS idx_dr_review ON diagnosis_reports(requires_review)
    WHERE requires_review = TRUE;

-- ---------------------------------------------------------------------------
-- 2. agent_results — 各 Agent 中间结果 (溯源)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_results (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id       UUID NOT NULL REFERENCES diagnosis_reports(id) ON DELETE CASCADE,
    agent_name      VARCHAR(50) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'completed', 'failed', 'skipped')),
    result_json     JSONB NOT NULL DEFAULT '{}',
    findings        JSONB DEFAULT '[]',
    dimension_scores JSONB DEFAULT '{}',
    evidence        JSONB DEFAULT '[]',
    assembled_prompt TEXT,
    confidence_score DECIMAL(3,2) DEFAULT 0,
    tokens_used     INT DEFAULT 0,
    execution_ms    INT DEFAULT 0,
    span_id         VARCHAR(64),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ar_report ON agent_results(report_id);
CREATE INDEX IF NOT EXISTS idx_ar_agent ON agent_results(agent_name);

-- ---------------------------------------------------------------------------
-- 3. experiment_rubrics — 概念 Rubric (版本化管理)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS experiment_rubrics (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    experiment_id   VARCHAR(100) NOT NULL,
    version         VARCHAR(20) NOT NULL DEFAULT '1.0',
    category        VARCHAR(30) NOT NULL,
    rubric_json     JSONB NOT NULL DEFAULT '{}',
    calibration_kappa DECIMAL(3,2) DEFAULT 0,
    judge_model     VARCHAR(50),
    calibrated_by   VARCHAR(100),
    calibrated_at   TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (experiment_id, version)
);

CREATE INDEX IF NOT EXISTS idx_er_experiment ON experiment_rubrics(experiment_id);
CREATE INDEX IF NOT EXISTS idx_er_active ON experiment_rubrics(experiment_id)
    WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_er_category ON experiment_rubrics(category);

-- ---------------------------------------------------------------------------
-- 4. error_patterns — 错误模式知识库 (Ratchet 积累)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS error_patterns (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category        VARCHAR(30) NOT NULL,
    pattern_name    VARCHAR(200) NOT NULL,
    description     TEXT NOT NULL,
    typical_causes  JSONB DEFAULT '[]',
    fix_strategies  JSONB DEFAULT '[]',
    related_concepts JSONB DEFAULT '[]',
    occurrence_count INT DEFAULT 0,
    first_seen_at   TIMESTAMPTZ,
    last_seen_at    TIMESTAMPTZ,
    source_agent    VARCHAR(50),
    source_diagnosis_id UUID,
    confirmed       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (category, pattern_name)
);

CREATE INDEX IF NOT EXISTS idx_ep_category ON error_patterns(category);
CREATE INDEX IF NOT EXISTS idx_ep_confirmed ON error_patterns(confirmed)
    WHERE confirmed = FALSE;
