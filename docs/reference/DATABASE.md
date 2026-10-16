# TraceOS Lab 数据库设计文档

本文档描述 TraceOS Lab 的完整数据库 Schema 设计，包括业务数据、时序数据、向量数据和图数据。

---

## 📋 目录

- [数据库架构概览](#数据库架构概览)
- [扩展与配置](#扩展与配置)
- [核心业务表](#核心业务表)
- [时序数据表](#时序数据表)
- [向量表（RAG）](#向量表rag)
- [图数据（知识图谱）](#图数据知识图谱)
- [索引与性能](#索引与性能)
- [迁移策略](#迁移策略)

---

## 数据库架构概览

### 多模存储架构

```
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL 16                             │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  核心业务表  │  │  时序数据表  │  │   向量表     │     │
│  │  (普通表)    │  │ (Hypertable) │  │  (pgvector)  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Apache AGE 图扩展                       │   │
│  │           (OS 概念知识图谱)                           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

 TimescaleDB: syscall trace 等时序数据的自动分区和连续聚合
 pgvector: RAG 知识库的向量检索
 Apache AGE: 知识图谱的 Cypher 查询
```

### 数据流

```
用户提交代码 → 容器执行 → syscall trace → TimescaleDB
              → perf 数据 → TimescaleDB
              → 评分结果 → 核心业务表
              → AI 诊断 → 核心业务表
              → 向量化 → pgvector
              → 知识推理 → Apache AGE
```

---

## 扩展与配置

### 1. 安装扩展

```sql
-- deploy/init-db/01-extensions.sql

-- TimescaleDB (时序数据库)
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- pgvector (向量检索)
CREATE EXTENSION IF NOT EXISTS vector;

-- Apache AGE (图数据库)
CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SET search_path = ag_catalog, "$user", public;

-- 其他有用扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- UUID 生成
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- 全文搜索
CREATE EXTENSION IF NOT EXISTS btree_gin;   -- GIN 索引
```

---

## 核心业务表

### 1. 用户管理

#### users

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'student', -- student, teacher, admin
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);

-- 全文搜索索引
CREATE INDEX idx_users_search ON users USING gin(
    to_tsvector('english', full_name || ' ' || username)
);
```

#### user_preferences

```sql
CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme VARCHAR(20) DEFAULT 'light',
    language VARCHAR(10) DEFAULT 'zh-CN',
    editor_theme VARCHAR(30) DEFAULT 'vs-dark',
    editor_font_size INT DEFAULT 14,
    notifications_enabled BOOLEAN DEFAULT true,
    jsonb_preferences JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. 课程与实验

#### courses

```sql
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    teacher_id UUID REFERENCES users(id),
    is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_courses_code ON courses(code);
CREATE INDEX idx_courses_teacher ON courses(teacher_id);
CREATE INDEX idx_courses_published ON courses(is_published);
```

#### course_enrollments

```sql
CREATE TABLE course_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(course_id, student_id)
);

CREATE INDEX idx_enrollments_course ON course_enrollments(course_id);
CREATE INDEX idx_enrollments_student ON course_enrollments(student_id);
```

#### experiments

```sql
CREATE TABLE experiments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    category VARCHAR(50) NOT NULL, -- process, thread, memory, fs, scheduler, deadlock
    name VARCHAR(200) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    instructions TEXT, -- Markdown 格式的实验指导
    starter_code TEXT, -- 初始代码模板
    reference_solution TEXT, -- 参考答案（仅教师可见）
    difficulty VARCHAR(20) DEFAULT 'medium', -- easy, medium, hard
    time_limit INT DEFAULT 300, -- 秒
    memory_limit INT DEFAULT 268435456, -- 256MB
    sandbox_level INT DEFAULT 1, -- 1, 2, 3
    max_submissions INT DEFAULT 100,
    is_published BOOLEAN DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_experiments_course ON experiments(course_id);
CREATE INDEX idx_experiments_category ON experiments(category);
CREATE INDEX idx_experiments_difficulty ON experiments(difficulty);
CREATE INDEX idx_experiments_published ON experiments(is_published);

-- 全文搜索
CREATE INDEX idx_experiments_search ON experiments USING gin(
    to_tsvector('english', title || ' ' || description)
);
```

#### test_cases

```sql
CREATE TABLE test_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(50) NOT NULL, -- normal, edge_case, performance, security
    input_data TEXT,
    expected_output TEXT,
    is_public BOOLEAN DEFAULT true, -- 是否对学生可见
    score_weight INT DEFAULT 10,
    order_index INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_test_cases_experiment ON test_cases(experiment_id);
CREATE INDEX idx_test_cases_type ON test_cases(type);
```

### 3. 提交与评测

#### submissions

```sql
CREATE TABLE submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    language VARCHAR(20) NOT NULL, -- c, cpp, python, rust, go
    submission_number INT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- pending, running, completed, failed, timeout, memory_exceeded
    score INT, -- 0-100
    total_score INT, -- 满分
    passed_test_cases INT DEFAULT 0,
    total_test_cases INT DEFAULT 0,
    compile_error TEXT,
    runtime_error TEXT,
    execution_time INT, -- 毫秒
    memory_usage BIGINT, -- 字节
    sandbox_container_id VARCHAR(100),
    trace_file_path VARCHAR(500), -- MinIO 路径
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE(experiment_id, student_id, submission_number)
);

CREATE INDEX idx_submissions_experiment ON submissions(experiment_id);
CREATE INDEX idx_submissions_student ON submissions(student_id);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_created ON submissions(created_at DESC);
CREATE INDEX idx_submissions_score ON submissions(score DESC);
```

#### test_results

```sql
CREATE TABLE test_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    test_case_id UUID NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL, -- passed, failed, error, timeout
    actual_output TEXT,
    error_message TEXT,
    execution_time INT, -- 毫秒
    memory_usage BIGINT, -- 字节
    score INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_test_results_submission ON test_results(submission_id);
CREATE INDEX idx_test_results_test_case ON test_results(test_case_id);
CREATE INDEX idx_test_results_status ON test_results(status);
```

### 4. AI 诊断与反馈

#### diagnoses

```sql
CREATE TABLE diagnoses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    diagnosis_status VARCHAR(50) DEFAULT 'pending', -- pending, in_progress, completed, failed
    error_type VARCHAR(100), -- fd_leak, deadlock, race_condition, memory_leak, 等
    severity VARCHAR(20) DEFAULT 'medium', -- low, medium, high, critical
    root_cause TEXT, -- AI 识别的根因
    hint_level_1 TEXT, -- 最轻量级提示
    hint_level_2 TEXT, -- 引导级提示
    hint_level_3 TEXT, -- 详细解释
    related_concepts JSONB, -- 关联的 OS 概念
    related_syscalls JSONB, -- 关联的系统调用
    suggested_fixes JSONB, -- 建议的修复方案
    confidence_score FLOAT, -- AI 置信度 0-1
    agent_chain JSONB, -- Agent 调用链（用于调试）
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_diagnoses_submission ON diagnoses(submission_id);
CREATE INDEX idx_diagnoses_student ON diagnoses(student_id);
CREATE INDEX idx_diagnoses_error_type ON diagnoses(error_type);
CREATE INDEX idx_diagnoses_severity ON diagnoses(severity);
```

#### agent_interactions

```sql
CREATE TABLE agent_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    diagnosis_id UUID REFERENCES diagnoses(id) ON DELETE CASCADE,
    agent_name VARCHAR(100) NOT NULL, -- TraceAnalyzer, ErrorDiagnosis, Pedagogical, CodeReview
    input_data JSONB,
    output_data JSONB,
    thinking_process TEXT, -- Agent 的思考过程（用于可解释性）
    execution_time INT, -- 毫秒
    token_usage JSONB, -- {prompt_tokens, completion_tokens, total_tokens}
    model_used VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_interactions_diagnosis ON agent_interactions(diagnosis_id);
CREATE INDEX idx_agent_interactions_agent ON agent_interactions(agent_name);
```

### 5. 教学数据

#### student_progress

```sql
CREATE TABLE student_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    best_score INT DEFAULT 0,
    total_submissions INT DEFAULT 0,
    first_submission_at TIMESTAMPTZ,
    last_submission_at TIMESTAMPTZ,
    time_spent INT DEFAULT 0, -- 总耗时（秒）
    common_errors JSONB, -- {error_type: count}
    mastered_concepts JSONB, -- 已掌握的概念
    weak_concepts JSONB, -- 薄弱的概念
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(student_id, experiment_id)
);

CREATE INDEX idx_progress_student ON student_progress(student_id);
CREATE INDEX idx_progress_experiment ON student_progress(experiment_id);
CREATE INDEX idx_progress_best_score ON student_progress(best_score DESC);
```

#### error_statistics

```sql
CREATE TABLE error_statistics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    error_type VARCHAR(100) NOT NULL,
    experiment_id UUID REFERENCES experiments(id) ON DELETE SET NULL,
    occurrence_count INT DEFAULT 0,
    affected_students INT DEFAULT 0,
    first_occurred_at TIMESTAMPTZ,
    last_occurred_at TIMESTAMPTZ,
    related_syscalls JSONB,
    related_error_codes JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(error_type, experiment_id)
);

CREATE INDEX idx_error_stats_type ON error_statistics(error_type);
CREATE INDEX idx_error_stats_experiment ON error_statistics(experiment_id);
CREATE INDEX idx_error_stats_occurrence ON error_statistics(occurrence_count DESC);
```

### 6. 系统表

#### audit_logs

```sql
CREATE TABLE audit_logs (
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

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- 30 天后自动删除旧日志
SELECT add_retention_policy('audit_logs', INTERVAL '30 days');
```

---

## 时序数据表

### syscall_traces (Hypertable)

```sql
-- deploy/init-db/03-hypertables.sql

CREATE TABLE syscall_traces (
    time TIMESTAMPTZ NOT NULL,
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    pid INT NOT NULL,
    tid INT,
    syscall_name VARCHAR(100) NOT NULL,
    syscall_number INT,
    args JSONB, -- {arg1: value1, arg2: value2, ...}
    return_value BIGINT,
    return_value_hex VARCHAR(20),
    error_code INT,
    error_name VARCHAR(50),
    duration_ns BIGINT, -- 纳秒
    cpu_id INT,
    call_stack JSONB -- 可选：调用栈信息
);

-- 转换为 TimescaleDB Hypertable（自动按时间分区）
SELECT create_hypertable('syscall_traces', 'time');

-- 索引
CREATE INDEX idx_syscall_traces_submission ON syscall_traces(submission_id, time DESC);
CREATE INDEX idx_syscall_traces_pid ON syscall_traces(submission_id, pid, time);
CREATE INDEX idx_syscall_traces_syscall ON syscall_traces(submission_id, syscall_name, time);

-- 连续聚合：按 syscall 类型统计
CREATE MATERIALIZED VIEW syscall_stats_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    submission_id,
    syscall_name,
    COUNT(*) AS call_count,
    AVG(duration_ns) AS avg_duration_ns,
    SUM(duration_ns) AS total_duration_ns,
    COUNT(CASE WHEN error_code != 0 THEN 1 END) AS error_count
FROM syscall_traces
GROUP BY bucket, submission_id, syscall_name;

-- 自动刷新连续聚合视图
SELECT add_continuous_aggregate_policy('syscall_stats_1h',
    start_offset => INTERVAL '1 hour',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 hour');

-- 数据保留策略：90 天后自动删除
SELECT add_retention_policy('syscall_traces', INTERVAL '90 days');
```

### perf_events (Hypertable)

```sql
CREATE TABLE perf_events (
    time TIMESTAMPTZ NOT NULL,
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    pid INT NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- sched_switch, lock_acquire, lock_contention, page_fault, 等
    event_name VARCHAR(100),
    data JSONB NOT NULL, -- 事件特定数据
    cpu_id INT,
    duration_ns BIGINT
);

SELECT create_hypertable('perf_events', 'time');

CREATE INDEX idx_perf_events_submission ON perf_events(submission_id, time DESC);
CREATE INDEX idx_perf_events_type ON perf_events(submission_id, event_type, time);
CREATE INDEX idx_perf_events_pid ON perf_events(submission_id, pid, time);

-- 调度延迟统计
CREATE MATERIALIZED VIEW sched_latency_stats_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time) AS bucket,
    submission_id,
    AVG((data->>'latency_ns')::BIGINT) AS avg_latency_ns,
    MAX((data->>'latency_ns')::BIGINT) AS max_latency_ns,
    COUNT(*) AS context_switches
FROM perf_events
WHERE event_type = 'sched_switch'
GROUP BY bucket, submission_id;

SELECT add_continuous_aggregate_policy('sched_latency_stats_1m',
    start_offset => INTERVAL '1 day',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '5 minutes');
```

### resource_usage (Hypertable)

```sql
CREATE TABLE resource_usage (
    time TIMESTAMPTZ NOT NULL,
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    pid INT NOT NULL,
    cpu_percent FLOAT,
    memory_bytes BIGINT,
    memory_percent FLOAT,
    disk_read_bytes BIGINT,
    disk_write_bytes BIGINT,
    network_rx_bytes BIGINT,
    network_tx_bytes BIGINT
);

SELECT create_hypertable('resource_usage', 'time');

CREATE INDEX idx_resource_usage_submission ON resource_usage(submission_id, time DESC);

SELECT add_retention_policy('resource_usage', INTERVAL '30 days');
```

---

## 向量表（RAG）

### rag_knowledge (向量检索)

```sql
CREATE TABLE rag_knowledge (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_type VARCHAR(50) NOT NULL, -- textbook, manual, common_error, example_code
    source_ref VARCHAR(200), -- 来源引用（章节名、文档链接等）
    title VARCHAR(200),
    content TEXT NOT NULL,
    chunk_index INT, -- 文档切片索引
    embedding vector(1536), -- OpenAI embedding 维度
    metadata JSONB, -- {category: "memory", difficulty: "medium", ...}
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 向量相似度索引
CREATE INDEX idx_rag_embedding ON rag_knowledge USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- 全文搜索索引
CREATE INDEX idx_rag_search ON rag_knowledge USING gin(
    to_tsvector('english', title || ' ' || content)
);

CREATE INDEX idx_rag_source ON rag_knowledge(source_type);
```

### code_embeddings (代码相似度)

```sql
CREATE TABLE code_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    code_hash VARCHAR(64) NOT NULL, -- SHA256
    embedding vector(1024),
    is_plagiarism BOOLEAN DEFAULT false,
    plagiarism_score FLOAT,
    similarity_threshold FLOAT DEFAULT 0.85,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(submission_id)
);

CREATE INDEX idx_code_embedding ON code_embeddings USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

CREATE INDEX idx_code_hash ON code_embeddings(code_hash);
```

---

## 图数据（知识图谱）

### Apache AGE 图模型

```sql
-- deploy/init-db/04-graph.sql

-- 创建图
SELECT create_graph('os_knowledge');

-- 加载扩展
LOAD 'age';
SET search_path = ag_catalog, "$user", public;
```

#### 图概念

```cypher
-- 概念节点
SELECT * FROM cypher('os_knowledge', $$
    CREATE (c:Concept {
        name: '文件描述符',
        type: 'resource',
        description: '内核用于标识打开文件的整数',
        difficulty: 'medium'
    })
$$) as (a agtype);

-- 关系节点
SELECT * FROM cypher('os_knowledge', $$
    CREATE (r:Relation {
        name: '继承',
        type: 'inheritance',
        description: '子进程继承父进程的文件描述符'
    })
$$) as (a agtype);

-- 建立关系
SELECT * FROM cypher('os_knowledge', $$
    MATCH (c1:Concept {name: '子进程'}), (c2:Concept {name: '文件描述符'})
    CREATE (c1)-[:INHERITS {context: 'fork'}]->(c2)
$$) as (a agtype);
```

#### 常见图查询

```sql
-- 查找与错误模式相关的所有概念
SELECT * FROM cypher('os_knowledge', $$
    MATCH (e:ErrorPattern {name: '文件描述符泄漏'})-[:RELATED_TO]->(c:Concept)
    MATCH (e)-[:FOUND_IN]->(lab:Lab)
    RETURN c.name, lab.name
$$) as (concept_name agtype, lab_name agtype);

-- 查找概念路径
SELECT * FROM cypher('os_knowledge', $$
    MATCH path = (start:Concept {name: 'fork'})-[:CAUSES*]->(end:Concept {name: '资源泄漏'})
    RETURN path
$$) as (p agtype);
```

---

## 索引与性能

### 核心索引策略

| 表名 | 索引类型 | 索引列 | 用途 |
|------|---------|--------|------|
| users | B-tree | email, username | 登录查询 |
| submissions | B-tree | experiment_id, created_at DESC | 提交列表 |
| submissions | B-tree | student_id, experiment_id | 学生作业 |
| syscall_traces | BRIN | time | 时序范围查询 |
| syscall_traces | B-tree | submission_id, time DESC | Trace 查询 |
| rag_knowledge | ivfflat | embedding | 向量相似度 |
| rag_knowledge | GIN | to_tsvector(...) | 全文搜索 |

### 分区策略

TimescaleDB 自动按时间分区：
- `syscall_traces`: 按天分区
- `perf_events`: 按天分区
- `resource_usage`: 按小时分区

---

## 迁移策略

### 迁移文件命名规范

```
deploy/init-db/
├── 01-extensions.sql      # 扩展安装
├── 02-schema.sql          # 核心业务表
├── 03-hypertables.sql     # 时序表
├── 04-graph.sql           # 知识图谱
├── 05-seed.sql            # 初始数据
└── migrations/
    ├── 20240602_001_add_column.sql
    ├── 20240602_002_rename_table.sql
    └── ...
```

### 执行迁移

```bash
# 使用 Makefile
make migrate

# 或直接执行
docker compose exec postgres psql -U traceos -f /docker-entrypoint-initdb.d/02-schema.sql
```

---

## 数据完整性

### 外键约束

所有关联表都设置了 `ON DELETE CASCADE` 或 `ON DELETE SET NULL`：
- `users`: 删除用户时级联删除其提交、诊断等数据
- `experiments`: 删除实验时级联删除测试用例和提交
- `courses`: 删除课程时保留提交数据（SET NULL）

### 唯一约束

- `users.username`: 用户名唯一
- `users.email`: 邮箱唯一
- `submissions`: (experiment_id, student_id, submission_number) 唯一

---

## 备份与恢复

```bash
# 备份
docker compose exec postgres pg_dump -U traceos traceos > backup.sql

# 恢复
docker compose exec -T postgres psql -U traceos < backup.sql
```

---

**文档版本**: 1.0
**最后更新**: 2024-06-02