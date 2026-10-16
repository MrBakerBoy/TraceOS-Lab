# TraceOS Lab — 部署与运维指南

> 本文档涵盖 TraceOS Lab 的完整部署流程、环境配置、服务管理、故障排查与运维监控。

---

## 📖 目录

- [前置要求](#-前置要求)
- [快速部署](#-快速部署)
- [环境配置详解](#-环境配置详解)
- [分步部署](#-分步部署)
- [服务访问](#-服务访问)
- [Makefile 命令参考](#-makefile-命令参考)
- [Docker Compose 配置说明](#-docker-compose-配置说明)
- [数据库管理](#-数据库管理)
- [LLM Provider 配置](#-llm-provider-配置)
- [监控与可观测性](#-监控与可观测性)
- [沙箱镜像构建](#-沙箱镜像构建)
- [故障排查](#-故障排查)
- [生产环境建议](#-生产环境建议)

---

## 📋 前置要求

### 硬件要求

| 资源 | 最低配置 | 推荐配置 |
|------|---------|---------|
| CPU | 2 核 | 4 核+ |
| 内存 | 4 GB | 8 GB+ |
| 磁盘 | 20 GB | 50 GB+ (SSD) |
| 网络 | 可访问外网（拉取镜像） | — |

### 软件依赖

| 软件 | 最低版本 | 安装方式 |
|------|---------|---------|
| **Docker** | ≥ 24.0 | `curl -fsSL https://get.docker.com \| sh` |
| **Docker Compose** | ≥ v2 (plugin) | 随 Docker Desktop 附带，或 `apt install docker-compose-plugin` |
| **Git** | ≥ 2.0 | `apt install git` |
| **bash** | ≥ 4.0 | 系统自带 |

### 验证安装

```bash
docker --version          # Docker version 24.x+
docker compose version    # Docker Compose version v2.x+
```

---

## 🚀 快速部署

### 方式一：一键部署脚本（推荐用于生产）

```bash
# 1. 克隆项目
git clone <your-repo-url>
cd traceos-lab

# 2. 赋予执行权限并运行
chmod +x deploy-traceos.sh
./deploy-traceos.sh
```

脚本会自动完成：
1. 检查并安装 Docker + Docker Compose
2. 创建 `.env` 配置文件（基于 `.env.example`）
3. 写入默认 LLM API Key
4. 配置防火墙规则（放行 22/80/443/8000/8080/8081）
5. 启动基础设施（PostgreSQL, Redis, NATS, MinIO）
6. 等待基础设施就绪（含健康检查）
7. 构建并启动所有应用服务
8. 执行健康检查并打印访问地址

### 方式二：Makefile（推荐用于开发）

```bash
# 完整部署
make deploy

# 或手动控制
make deploy-infra     # 第一步：仅基础设施
make deploy-app       # 第二步：基础设施 + 应用
make deploy-monitor   # 第三步：基础设施 + 监控（可选）
```

### 方式三：直接 Docker Compose

```bash
# 最小化启动（仅基础设施）
docker compose up -d

# 启动全部服务
docker compose --profile app --profile monitoring up -d
```

---

## ⚙️ 环境配置详解

### 创建 .env 文件

```bash
cp .env.example .env
```

### 必填配置

```bash
# ──────────────────────── LLM 配置（必填）────────────────────────
# 选择一个 Provider 并填入对应 API Key
LLM_PROVIDER=deepseek-v4              # deepseek-v4 | openai | mimo | custom
LLM_API_KEY=sk-your-api-key-here      # ⚠️ 必须填入真实 Key
LLM_MODEL=deepseek-v4-pro             # 模型名称

# ──────────────────────── 数据库密码（建议修改）───────────────────
PG_PASSWORD=traceos_dev               # 生产环境请改为强密码

# ──────────────────────── JWT 密钥（建议修改）─────────────────────
JWT_SECRET=your-jwt-secret-change-in-production
```

### 可选配置

```bash
# ──────────────────────── 数据库 ─────────────────────────────────
PG_DATABASE=traceos                   # 数据库名
PG_USER=traceos                       # 数据库用户
PG_PORT=5432                          # 对外端口

# ──────────────────────── Redis ──────────────────────────────────
REDIS_PORT=6379

# ──────────────────────── MinIO ──────────────────────────────────
MINIO_USER=traceos                    # 管理后台用户名
MINIO_PASSWORD=traceos_dev            # 管理后台密码

# ──────────────────────── 前端 ───────────────────────────────────
NEXT_PUBLIC_API_URL=http://YOUR_SERVER_IP:80
NEXT_PUBLIC_WS_URL=ws://YOUR_SERVER_IP:80

# ──────────────────────── RAG 功能开关 ────────────────────────────
RAG_ENABLED=true                      # 是否启用 RAG
RAG_DIAGNOSIS_ENABLED=true            # 诊断时注入 RAG 上下文
RAG_HINTS_ENABLED=true                # 提示时注入 RAG 上下文
RAG_CHAT_ENABLED=true                 # 对话时注入 RAG 上下文

# ──────────────────────── RAG 嵌入模型 ───────────────────────────
RAG_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
RAG_EMBEDDING_DIMENSION=512
RAG_TOP_K=8

# ──────────────────────── 监控（可选）─────────────────────────────
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
GRAFANA_USER=admin
GRAFANA_PASSWORD=admin                # 生产环境请修改
```

### Provider 完整配置示例

#### DeepSeek V4（默认）

```bash
LLM_PROVIDER=deepseek-v4
LLM_API_KEY=sk-your-deepseek-key
LLM_MODEL=deepseek-v4-pro
```

#### OpenAI

```bash
LLM_PROVIDER=openai
LLM_API_KEY=sk-your-openai-key
LLM_MODEL=gpt-4o
```

#### MiMo（兼容旧版）

```bash
LLM_PROVIDER=mimo
MIMO_API_KEY=your-mimo-key
MIMO_API_BASE_URL=https://open.mimoai.com/v1
MIMO_MODEL=mimo-chat
```

#### 自定义兼容接口

```bash
LLM_PROVIDER=custom
LLM_API_BASE_URL=https://your-api.example.com/v1
LLM_API_KEY=your-custom-key
LLM_MODEL=your-model-name
```

---

## 📦 分步部署

### 第一步：启动基础设施

```bash
docker compose up -d
```

启动的容器：`postgres`、`redis`、`minio`、`nats`、`traefik`

验证：

```bash
docker compose ps
# 所有容器 Status 应为 "healthy"
```

### 第二步：等待数据库就绪

```bash
# 查看 PostgreSQL 健康状态
docker compose ps postgres

# 查看数据库初始化日志
docker compose logs postgres | grep -i "database system is ready"
```

PostgreSQL 容器首次启动时会自动执行 `deploy/init-db/` 中的 SQL 文件：

1. `01-extensions.sql` — 安装 pgvector、TimescaleDB、Apache AGE 等扩展
2. `02-schema.sql` — 创建核心业务表
3. `03-hypertables.sql` — 创建 TimescaleDB 超表
4. `04-rag.sql` — 创建 RAG 向量表
5. `05-seed.sql` — 导入 31 个实验的种子数据
6. `06-diagnoses.sql` — 创建 AI 诊断表
7. `07-comments.sql` — 创建评论表
8. `08-rag.sql` — RAG 数据更新

### 第三步：启动应用服务

```bash
docker compose --profile app up -d
```

启动的容器：`core-service`、`ai-service`、`observability`、`frontend`

### 第四步（可选）：启动监控栈

```bash
docker compose --profile monitoring up -d
```

启动的容器：`prometheus`、`grafana`、`loki`、`jaeger`

### 第五步：验证部署

```bash
# 检查所有服务状态
make status

# 测试各端点
curl -s http://localhost:8080/healthz    # Core Service
curl -s http://localhost:8000/healthz    # AI Service
curl -s http://localhost:9091/healthz    # Observability
curl -s http://localhost                 # Frontend (via Traefik)
```

---

## 🌐 服务访问

部署完成后，可以通过以下地址访问各服务：

| 服务 | 外部地址 | 内部地址（容器间） | 说明 |
|------|---------|-------------------|------|
| 🌐 **前端** | `http://<SERVER_IP>` | `http://frontend:3000` | Web 界面，经 Traefik 路由 |
| 🔧 **Core API** | `http://<SERVER_IP>:8080` | `http://core-service:8080` | 或经 Traefik `/api/v1/*` |
| 🤖 **AI Service** | `http://<SERVER_IP>:8000` | `http://ai-service:8000` | Swagger UI: `/docs` |
| 📡 **Observability** | `http://<SERVER_IP>:9091` | `http://observability:9091` | 或经 Traefik `/api/obs/*` |
| 🚪 **Traefik** | `http://<SERVER_IP>:8080` | — | API 网关管理面板 |
| 📈 **Grafana** | `http://<SERVER_IP>:3001` | — | 默认 `admin/admin` |
| 🔍 **Jaeger** | `http://<SERVER_IP>:16686` | — | 分布式链路追踪 |
| 💾 **MinIO** | `http://<SERVER_IP>:9001` | — | 对象存储控制台 |
| 📡 **NATS** | `http://<SERVER_IP>:8222` | — | 消息系统监控 |

---

## 📋 Makefile 命令参考

```bash
# 部署相关
make deploy           # 一键部署全部服务（推荐）
make deploy-infra     # 仅部署基础设施
make deploy-app       # 部署基础设施 + 应用服务
make deploy-monitor   # 部署基础设施 + 监控栈

# Docker Compose 直接操作
make up               # 启动全部服务
make down             # 停止全部服务
make destroy          # 停止并删除所有数据卷（⚠️ 数据将丢失）
make build            # 重新构建所有镜像
make status           # 查看所有容器状态
make logs             # 查看全部实时日志

# 开发环境
make dev              # 开发模式启动（含 --build）
make dev-down         # 停止开发环境

# 生产环境
make prod             # 生产模式（同 deploy）
make prod-down        # 停止生产环境

# 工具
make gen-proto        # 生成 Proto 代码
make sandbox          # 构建沙箱镜像（base + process-lab）
make sandbox-base     # 仅构建基础沙箱镜像
make sandbox-process  # 仅构建进程实验镜像
make help             # 显示帮助
```

---

## 🐳 Docker Compose 配置说明

### Profile 机制

项目使用 Docker Compose Profile 机制隔离不同服务组：

| Profile | 包含服务 | 用途 |
|---------|---------|------|
| **(默认)** | postgres, redis, minio, nats, traefik | 基础设施（始终需要） |
| **app** | core-service, ai-service, observability, frontend | 应用服务 |
| **monitoring** | prometheus, grafana, loki, jaeger | 监控栈（按需启动） |

### 启动组合

```bash
# 仅基础设施
docker compose up -d

# 基础设施 + 应用
docker compose --profile app up -d

# 基础设施 + 监控
docker compose --profile monitoring up -d

# 全部
docker compose --profile app --profile monitoring up -d
```

### 持久化卷

| 卷名 | 用途 | 数据内容 |
|------|------|---------|
| `pgdata` | PostgreSQL | 数据库文件、TimescaleDB 超表 |
| `minio_data` | MinIO | 提交代码、实验报告 |
| `nats_data` | NATS JetStream | 消息持久化存储 |
| `prometheus_data` | Prometheus | 监控指标（保留 15 天） |
| `grafana_data` | Grafana | 仪表盘配置 |
| `loki_data` | Loki | 日志数据 |

### 容器特权说明

核心服务和观测服务需要以下 Linux Capabilities 以执行系统级观测：

| Capability | 用途 |
|-----------|------|
| `SYS_PTRACE` | strace / ptrace 系统调用追踪 |
| `SYS_ADMIN` | nsjail 沙箱创建 / cgroups 操作 |
| `BPF` | eBPF 程序加载 |
| `PERFMON` | perf_events 性能采样 |
| `NET_ADMIN` | 网络命名空间管理（观测服务） |

---

## 🗄️ 数据库管理

### 连接数据库

```bash
# 通过容器内 psql
docker compose exec postgres psql -U traceos -d traceos

# 从宿主机连接（如果开放了 5432 端口）
psql -h localhost -U traceos -d traceos
```

### 核心数据表

| 表 | 用途 | 所属模块 |
|----|------|---------|
| `users`, `user_preferences` | 用户与偏好 | M8 通信基础 |
| `courses`, `course_enrollments`, `invite_codes` | 课程与选课 | M8 通信基础 |
| `experiments`, `test_cases` | 实验与测试用例 | M3 评测引擎 |
| `submissions`, `test_results` | 提交与测试结果 | M3 评测引擎 |
| `diagnoses`, `agent_interactions` | AI 诊断记录 | M2 AI 诊断 |
| `student_progress`, `error_statistics` | 学习进度与错误统计 | M7 教师仪表盘 |
| `comments` | 实验评论 | M6 评论系统 |
| `syscall_traces`, `perf_events`, `resource_usage` | 观测数据 (TimescaleDB 超表) | M4 观测引擎 |
| `rag_knowledge`, `code_embeddings` | RAG 知识库 (pgvector) | M2 AI 诊断 |
| `audit_logs` | 操作审计 | M8 通信基础 |

### 常用查询

```sql
-- 查看所有实验
SELECT id, category, title, difficulty FROM experiments ORDER BY category, difficulty;

-- 查看最近提交
SELECT s.id, u.username, e.title, s.status, s.score, s.created_at
FROM submissions s
JOIN users u ON s.student_id = u.id
JOIN experiments e ON s.experiment_id = e.id
ORDER BY s.created_at DESC LIMIT 20;

-- 查看 AI 诊断记录
SELECT d.id, d.submission_id, d.error_type, d.severity, d.confidence_score, d.diagnosis_status
FROM diagnoses d ORDER BY d.created_at DESC LIMIT 10;

-- 查看某个学生的进度
SELECT e.title, sp.best_score, sp.total_submissions, sp.mastered_concepts, sp.weak_concepts
FROM student_progress sp
JOIN experiments e ON sp.experiment_id = e.id
WHERE sp.student_id = '<student-uuid>'
ORDER BY sp.best_score DESC;
```

### 数据库备份

```bash
# 备份全部数据
docker compose exec postgres pg_dump -U traceos traceos > traceos_backup_$(date +%Y%m%d).sql

# 仅备份 schema（不含数据）
docker compose exec postgres pg_dump -U traceos --schema-only traceos > traceos_schema.sql

# 恢复
docker compose exec -T postgres psql -U traceos traceos < traceos_backup.sql
```

---

## 🤖 LLM Provider 配置

### Provider 架构

AI Service 使用统一的 `BaseLLMProvider` 抽象层，支持即插即用的 Provider 切换：

```
app/services/llm_client.py
├── BaseLLMProvider (抽象基类)
└── OpenAICompatibleProvider (兼容实现)
    ├── DeepSeek V3 / V4
    ├── OpenAI (GPT-4o 等)
    ├── MiMo Chat
    └── 自定义兼容端点 (v1/chat/completions)
```

### 切换 Provider

只需修改 `.env` 中的 `LLM_PROVIDER` 并重启 AI Service：

```bash
# 编辑配置
vim .env

# 重启 AI Service
docker compose restart ai-service
```

### 验证 LLM 连接

```bash
# 测试 AI Service 健康状态
curl http://localhost:8000/healthz

# 测试诊断接口
curl -X POST http://localhost:8000/api/ai/diagnose \
  -H 'Content-Type: application/json' \
  -d '{
    "submission_id": "00000000-0000-0000-0000-000000000001",
    "experiment_id": "00000000-0000-0000-0000-000000000001",
    "student_id": "00000000-0000-0000-0000-000000000001"
  }'
```

---

## 📊 监控与可观测性

### 启动监控栈

```bash
docker compose --profile monitoring up -d
```

### Grafana 仪表盘

1. 访问 `http://<SERVER_IP>:3001`
2. 默认账户：`admin` / `admin`（可通过 `.env` 修改）
3. Prometheus 数据源已自动配置

### Prometheus 抓取端点

| 目标 | 端口 | 路径 |
|------|------|------|
| Core Service | 8080 | `/metrics` |
| AI Service | 8000 | `/metrics` |
| Observability | 9091 | `/metrics` |
| PostgreSQL | 9187 | `/metrics` (via postgres-exporter) |
| Redis | 9121 | `/metrics` (via redis-exporter) |

### 日志查看

```bash
# Docker Compose 日志
docker compose logs -f                    # 全部日志
docker compose logs -f core-service       # 特定服务
docker compose logs -f --tail=100         # 最近 100 行

# 通过 Loki + Grafana 查询（监控栈启动后）
# 访问 Grafana → Explore → 选择 Loki 数据源
```

### Jaeger 链路追踪

访问 `http://<SERVER_IP>:16686` 查看分布式调用链：

- Core Service → AI Service 的内部调用
- 评测链路的完整追踪

---

## 🔒 沙箱镜像构建

沙箱镜像为实验代码提供编译和运行环境：

### 基础镜像

```bash
# 构建基础镜像（Ubuntu 22.04 + GCC + Clang + strace + perf + GDB + Valgrind）
make sandbox-base
```

镜像内容：
- **编译器**：GCC 12, G++ 12, Clang 15
- **调试工具**：GDB, Valgrind
- **观测工具**：strace, perf
- **脚本语言**：Python 3, Rust, Go

### 实验专用镜像

```bash
# 构建进程实验镜像
make sandbox-process

# 构建全部沙箱镜像
make sandbox
```

### nsjail 配置

三级安全策略，`sandbox/nsjail-configs/` 中预置：

| 级别 | 配置文件 | 允许 syscall | 内存限制 | 时间限制 | 适用实验 |
|:---:|---------|:-----------:|:-------:|:-------:|---------|
| 1 | `level1-standard.pb` | ~100 | 256 MB | 300s | 进程管理、文件 I/O |
| 2 | `level2-secure.pb` | ~60 | 128 MB | 300s | 线程同步、内存管理 |
| 3 | `level3-hardened.pb` | ~40 | 64 MB | 180s | 处理机调度、死锁检测 |

### seccomp 白名单

6 个实验类别各有专属 seccomp 配置，位于 `sandbox/seccomp-profiles/`：

| 文件 | 实验类别 | 允许的 syscall 数 |
|------|---------|:-----------------:|
| `process-lab.json` | 进程管理 | ~80 |
| `thread-lab.json` | 线程同步 | ~55 |
| `memory-lab.json` | 内存管理 | ~50 |
| `fs-lab.json` | 文件 I/O | ~45 |
| `scheduler-lab.json` | 处理机调度 | ~40 |
| `deadlock-lab.json` | 死锁检测 | ~40 |

---

## 🔧 故障排查

### 常见问题

#### 1. 容器启动失败

```bash
# 查看具体错误
docker compose logs <service-name>

# 检查端口占用
ss -tlnp | grep -E '5432|6379|9000|4222|80|8080|8000|9091'

# 释放冲突端口（例如停止本地 PostgreSQL）
sudo systemctl stop postgresql
```

#### 2. PostgreSQL 连接失败

```bash
# 检查 PostgreSQL 是否就绪
docker compose ps postgres

# 查看初始化日志
docker compose logs postgres | tail -50

# 手动连接测试
docker compose exec postgres psql -U traceos -d traceos -c "SELECT 1;"
```

#### 3. AI Service 启动失败

常见原因：

- **LLM_API_KEY 未配置**：检查 `.env` 中是否设置了有效密钥
- **模型下载超时**：AI Service 启动时会预下载 Embedding 模型，首次启动较慢
- **Core Service 不可达**：AI Service 依赖 Core Service 获取实验数据

```bash
# 查看 AI Service 启动日志
docker compose logs ai-service | tail -100

# 检查 AI Service 是否能访问 Core Service
docker compose exec ai-service curl -s http://core-service:8080/healthz
```

#### 4. 前端无法访问后端

前端通过 Traefik 网关反向代理后端服务。如果前端页面正常但 API 请求失败：

```bash
# 检查 Traefik 路由配置
curl http://localhost:8080/api/http/routers

# 确认后端服务健康状态
curl http://localhost:8080/healthz     # Core
curl http://localhost:8000/healthz     # AI

# 查看 Traefik 日志
docker compose logs traefik --tail=50
```

#### 5. 沙箱执行失败

```bash
# 检查内核是否支持 cgroups v2
stat -fc %T /sys/fs/cgroup/

# 检查 strace 是否可用
docker compose exec core-service strace --version

# 查看 nsjail 是否编译正确
docker compose exec core-service nsjail --help
```

#### 6. 数据卷空间不足

```bash
# 查看卷占用
docker system df -v

# 清理未使用的镜像和卷
docker system prune -a --volumes

# 仅清理构建缓存
docker builder prune
```

### 日志级别调整

```bash
# Core Service: 设置 GIN_MODE
# 编辑 docker-compose.yml 或 .env，添加：
#   GIN_MODE=debug

# AI Service: 日志级别
# 编辑 services/ai-service/app/main.py 中的日志级别
#   logging.basicConfig(level=logging.DEBUG)

# Traefik: 调整日志级别
# 编辑 docker-compose.yml 中 traefik 的 command：
#   -- "--log.level=DEBUG"
```

---

## 🏭 生产环境建议

### 安全加固

1. **修改默认密码**
   ```bash
   # .env 中修改以下变量
   PG_PASSWORD=<强密码>
   JWT_SECRET=<随机字符串>
   GRAFANA_PASSWORD=<强密码>
   MINIO_PASSWORD=<强密码>
   ```

2. **启用 HTTPS**
   ```yaml
   # docker-compose.yml 中为 Traefik 添加 TLS 配置
   # 配置 ACME (Let's Encrypt) 自动证书
   ```

3. **限制端口暴露**
   ```yaml
   # 在生产环境中，仅暴露 80/443 端口
   # 将数据库/Redis/NATS 的 ports 设为仅内部访问
   ```

4. **API 限流**
   - Core Service 已内置限流中间件（登录 5/min，提交 120/min，写操作 30/min）
   - 如需调整，修改 `cmd/server/main.go` 中的 `RateLimit` 参数

### 性能优化

1. **数据库连接池**
   ```bash
   # .env 中添加
   PG_POOL_MAX=20
   PG_POOL_MIN=5
   ```

2. **Redis 内存限制**
   ```yaml
   # docker-compose.yml 中 redis 的 command 已配置:
   #   --maxmemory 512mb --maxmemory-policy allkeys-lru
   ```

3. **容器资源限制**
   ```yaml
   # 为各服务添加资源限制
   services:
     core-service:
       deploy:
         resources:
           limits:
             cpus: '2'
             memory: 1G
   ```

### 备份策略

```bash
# 创建定时备份脚本
cat > /opt/backup-traceos.sh << 'EOF'
#!/bin/bash
BACKUP_DIR=/opt/backups/traceos
mkdir -p $BACKUP_DIR
DATE=$(date +%Y%m%d_%H%M%S)
cd /path/to/traceos-lab
docker compose exec -T postgres pg_dump -U traceos traceos | gzip > $BACKUP_DIR/db_$DATE.sql.gz
# 保留最近 7 天的备份
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
EOF

# 设置 cron 定时任务（每天凌晨 2 点）
# crontab -e
# 0 2 * * * /opt/backup-traceos.sh
```

---

> 📖 返回主文档: [README.md](./README.md)
