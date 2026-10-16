-- TraceOS Lab 核心业务表 Schema
-- 部署顺序：先执行 01-extensions.sql

-- ==================== 用户管理 ====================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher', 'admin')),
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户索引
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_search ON users USING gin(to_tsvector('english', COALESCE(full_name, '') || ' ' || username));

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme VARCHAR(20) DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'auto')),
    language VARCHAR(10) DEFAULT 'zh-CN',
    editor_theme VARCHAR(30) DEFAULT 'vs-dark',
    editor_font_size INT DEFAULT 14 CHECK (editor_font_size >= 10 AND editor_font_size <= 24),
    notifications_enabled BOOLEAN DEFAULT true,
    jsonb_preferences JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== 课程与实验 ====================

CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    teacher_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courses_code ON courses(code);
CREATE INDEX IF NOT EXISTS idx_courses_teacher ON courses(teacher_id);
CREATE INDEX IF NOT EXISTS idx_courses_published ON courses(is_published);

CREATE TABLE IF NOT EXISTS course_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(course_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_course ON course_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON course_enrollments(student_id);

CREATE TABLE IF NOT EXISTS invite_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL UNIQUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    max_uses INT DEFAULT 0,
    current_uses INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_codes_course ON invite_codes(course_id);


CREATE TABLE IF NOT EXISTS experiments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('process', 'thread', 'memory', 'fs', 'scheduler', 'deadlock')),
    name VARCHAR(200) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    instructions TEXT,
    starter_code TEXT,
    reference_solution TEXT,
    answer_explanation TEXT,
    difficulty VARCHAR(20) DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    time_limit INT DEFAULT 300 CHECK (time_limit > 0),
    memory_limit BIGINT DEFAULT 268435456 CHECK (memory_limit > 0),
    sandbox_level INT DEFAULT 1 CHECK (sandbox_level IN (1, 2, 3)),
    max_submissions INT DEFAULT 100 CHECK (max_submissions > 0),
    is_published BOOLEAN DEFAULT false,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_experiments_course ON experiments(course_id);
CREATE INDEX IF NOT EXISTS idx_experiments_category ON experiments(category);
CREATE INDEX IF NOT EXISTS idx_experiments_difficulty ON experiments(difficulty);
CREATE INDEX IF NOT EXISTS idx_experiments_published ON experiments(is_published);
CREATE UNIQUE INDEX IF NOT EXISTS uq_experiments_name ON experiments(name);
CREATE INDEX IF NOT EXISTS idx_experiments_search ON experiments USING gin(to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(description, '')));

CREATE TABLE IF NOT EXISTS test_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('core', 'edge', 'performance', 'security')),
    input_data TEXT,
    expected_output TEXT,
    is_public BOOLEAN DEFAULT true,
    score_weight INT DEFAULT 10 CHECK (score_weight > 0),
    order_index INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_cases_experiment ON test_cases(experiment_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_type ON test_cases(type);

-- ==================== 提交与评测 ====================

CREATE TABLE IF NOT EXISTS submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    language VARCHAR(20) NOT NULL CHECK (language IN ('c', 'cpp', 'python', 'rust', 'go')),
    submission_number INT NOT NULL CHECK (submission_number > 0),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'timeout', 'memory_exceeded', 'compile_error')),
    score INT CHECK (score >= 0 AND score <= 100),
    total_score INT CHECK (total_score > 0),
    passed_test_cases INT DEFAULT 0,
    total_test_cases INT DEFAULT 0,
    compile_error TEXT,
    runtime_error TEXT,
    execution_time INT, -- 毫秒
    memory_usage BIGINT, -- 字节
    sandbox_container_id VARCHAR(100),
    trace_file_path VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE(experiment_id, student_id, submission_number)
);

CREATE INDEX IF NOT EXISTS idx_submissions_experiment ON submissions(experiment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_score ON submissions(score DESC);

CREATE TABLE IF NOT EXISTS test_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    test_case_id UUID NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL CHECK (status IN ('passed', 'failed', 'error', 'timeout')),
    actual_output TEXT,
    error_message TEXT,
    execution_time INT, -- 毫秒
    memory_usage BIGINT, -- 字节
    score INT CHECK (score >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_results_submission ON test_results(submission_id);
CREATE INDEX IF NOT EXISTS idx_test_results_test_case ON test_results(test_case_id);
CREATE INDEX IF NOT EXISTS idx_test_results_status ON test_results(status);

-- ==================== AI 诊断与反馈 ====================

-- diagnoses 表定义已移至 06-diagnoses.sql（M2 规范）

CREATE TABLE IF NOT EXISTS agent_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    diagnosis_id UUID REFERENCES diagnoses(id) ON DELETE CASCADE,
    agent_name VARCHAR(100) NOT NULL CHECK (agent_name IN ('TraceAnalyzer', 'ErrorDiagnosis', 'Pedagogical', 'CodeReview', 'Orchestrator')),
    input_data JSONB,
    output_data JSONB,
    thinking_process TEXT,
    execution_time INT, -- 毫秒
    token_usage JSONB,
    model_used VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_interactions_diagnosis ON agent_interactions(diagnosis_id);
CREATE INDEX IF NOT EXISTS idx_agent_interactions_agent ON agent_interactions(agent_name);

-- ==================== 教学数据 ====================

CREATE TABLE IF NOT EXISTS student_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    best_score INT DEFAULT 0 CHECK (best_score >= 0),
    total_submissions INT DEFAULT 0,
    first_submission_at TIMESTAMPTZ,
    last_submission_at TIMESTAMPTZ,
    time_spent INT DEFAULT 0,
    common_errors JSONB DEFAULT '{}',
    mastered_concepts JSONB DEFAULT '[]',
    weak_concepts JSONB DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(student_id, experiment_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_student ON student_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_progress_experiment ON student_progress(experiment_id);
CREATE INDEX IF NOT EXISTS idx_progress_best_score ON student_progress(best_score DESC);

CREATE TABLE IF NOT EXISTS error_statistics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    error_type VARCHAR(100) NOT NULL,
    experiment_id UUID REFERENCES experiments(id) ON DELETE SET NULL,
    occurrence_count INT DEFAULT 0,
    affected_students INT DEFAULT 0,
    first_occurred_at TIMESTAMPTZ,
    last_occurred_at TIMESTAMPTZ,
    related_syscalls JSONB DEFAULT '[]',
    related_error_codes JSONB DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(error_type, experiment_id)
);

CREATE INDEX IF NOT EXISTS idx_error_stats_type ON error_statistics(error_type);
CREATE INDEX IF NOT EXISTS idx_error_stats_experiment ON error_statistics(experiment_id);
CREATE INDEX IF NOT EXISTS idx_error_stats_occurrence ON error_statistics(occurrence_count DESC);

-- ==================== 系统表 ====================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    ip_address INET,
    user_agent TEXT,
    request_data JSONB,
    response_status INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- 创建更新时间触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为需要自动更新 updated_at 的表创建触发器
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_experiments_updated_at BEFORE UPDATE ON experiments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_student_progress_updated_at BEFORE UPDATE ON student_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_error_statistics_updated_at BEFORE UPDATE ON error_statistics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();