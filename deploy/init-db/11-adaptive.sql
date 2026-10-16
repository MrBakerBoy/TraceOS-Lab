-- =============================================================================
-- TraceOS Lab — 自适应教学系统 数据库表
-- =============================================================================

-- 学生能力画像
CREATE TABLE IF NOT EXISTS student_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    -- ELO能力分，每类实验一个分数
    process_elo REAL DEFAULT 1500.0,
    thread_elo REAL DEFAULT 1500.0,
    memory_elo REAL DEFAULT 1500.0,
    fs_elo REAL DEFAULT 1500.0,
    scheduler_elo REAL DEFAULT 1500.0,
    deadlock_elo REAL DEFAULT 1500.0,
    -- 学习行为特征
    avg_submissions_per_exp REAL DEFAULT 0,
    avg_time_spent_seconds REAL DEFAULT 0,
    preferred_difficulty VARCHAR(20) DEFAULT 'medium' CHECK (preferred_difficulty IN ('easy', 'medium', 'hard')),
    -- 薄弱概念列表
    weak_concepts JSONB DEFAULT '[]',
    mastered_concepts JSONB DEFAULT '[]',
    -- 学习速度偏好 (fast/medium/slow)
    learning_pace VARCHAR(10) DEFAULT 'medium' CHECK (learning_pace IN ('fast', 'medium', 'slow')),
    last_activity_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_profiles_student ON student_profiles(student_id);

-- 实验变体池
CREATE TABLE IF NOT EXISTS experiment_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    variant_name VARCHAR(100) NOT NULL,
    difficulty_level VARCHAR(20) NOT NULL CHECK (difficulty_level IN ('easy', 'medium', 'hard')),
    -- ELO难度分
    difficulty_score REAL DEFAULT 1500.0,
    -- 变体参数 (JSON: 如 {"N": 100, "buffer_size": 4096})
    parameters JSONB DEFAULT '{}',
    -- 该变体专用的测试用例ID列表
    test_case_ids JSONB DEFAULT '[]',
    -- 评分权重微调
    output_weight REAL DEFAULT 0.6,
    structure_weight REAL DEFAULT 0.2,
    behavior_weight REAL DEFAULT 0.2,
    -- 时间/内存限制
    time_limit_override INT,
    memory_limit_override BIGINT,
    -- 提示策略 (restricted/moderate/generous)
    hint_strategy VARCHAR(20) DEFAULT 'moderate' CHECK (hint_strategy IN ('restricted', 'moderate', 'generous')),
    -- 前置条件 (JSON: 只有满足条件的学生才能看到此变体)
    prerequisite JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_experiment_variants_exp ON experiment_variants(experiment_id);
CREATE INDEX IF NOT EXISTS idx_experiment_variants_diff ON experiment_variants(difficulty_level);
CREATE INDEX IF NOT EXISTS idx_experiment_variants_score ON experiment_variants(difficulty_score);
CREATE UNIQUE INDEX IF NOT EXISTS uq_variant_name_exp ON experiment_variants(experiment_id, variant_name);

-- 自适应决策日志
CREATE TABLE IF NOT EXISTS adaptation_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    selected_variant_id UUID REFERENCES experiment_variants(id) ON DELETE SET NULL,
    -- 学生当前能力分
    student_elo REAL,
    -- 选中变体的难度分
    variant_difficulty REAL,
    -- 决策依据
    decision_reason TEXT,
    -- 决策类型: auto/ai_override/teacher_force/student_choice
    decision_type VARCHAR(20) DEFAULT 'auto',
    -- 后续结果
    score_achieved INT,
    passed_test_cases INT,
    total_test_cases INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adaptation_log_student ON adaptation_log(student_id);
CREATE INDEX IF NOT EXISTS idx_adaptation_log_exp ON adaptation_log(experiment_id);
CREATE INDEX IF NOT EXISTS idx_adaptation_log_created ON adaptation_log(created_at DESC);

-- 代码审计结果表
CREATE TABLE IF NOT EXISTS code_audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'analyzing', 'completed', 'failed')),
    -- 结构化审计结果
    issues JSONB DEFAULT '[]',
    -- 总体评价 (JSON)
    summary JSONB DEFAULT '{}',
    -- AI深度审计结果 (JSON)
    ai_result JSONB DEFAULT '{}',
    -- 使用的LLM模型
    model_used VARCHAR(50),
    tokens_used INT DEFAULT 0,
    execution_time_ms INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_code_audits_submission ON code_audits(submission_id);
CREATE INDEX IF NOT EXISTS idx_code_audits_student ON code_audits(student_id);

CREATE TRIGGER update_student_profiles_updated_at BEFORE UPDATE ON student_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_experiment_variants_updated_at BEFORE UPDATE ON experiment_variants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
