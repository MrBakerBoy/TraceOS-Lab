-- =============================================================================
-- TraceOS Lab - PostgreSQL 扩展初始化
-- =============================================================================
-- 此脚本在首次启动时自动执行，安装必要的 PostgreSQL 扩展
-- 注意：TimescaleDB 已通过 timescale/timescaledb 镜像预装
-- =============================================================================

-- 基础扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- pgvector: 向量搜索 (RAG 知识库 + 代码相似度)
CREATE EXTENSION IF NOT EXISTS "vector";

-- TimescaleDB: 时序数据 (系统调用追踪、性能事件、资源使用)
-- 已通过 timescale/timescaledb Docker 镜像预装，此处确保激活
CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;

-- Apache AGE: 图数据库 (OS 知识图谱)
-- 注意：标准 PostgreSQL 镜像不包含 AGE，需要额外安装
-- 如果使用 apache/age Docker 镜像，取消下面的注释：
-- CREATE EXTENSION IF NOT EXISTS "age";
-- LOAD 'age';
-- SET search_path = ag_catalog, "$user", public;
