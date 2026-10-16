# TraceOS Lab 开发指南

本文档详细介绍如何在 WSL2 环境下搭建 TraceOS Lab 的本地开发环境。

---

## 📋 目录

- [前置要求](#前置要求)
- [WSL2 环境配置](#wsl2-环境配置)
- [开发环境搭建](#开发环境搭建)
- [服务启动流程](#服务启动流程)
- [开发工作流](#开发工作流)
- [调试技巧](#调试技巧)
- [常见问题](#常见问题)

---

## 前置要求

### 必须安装的软件

| 软件 | 版本要求 | 用途 |
|------|---------|------|
| Windows 11/10 | 21H2+ | WSL2 支持基础 |
| WSL2 | 2.0+ | Linux 环境 |
| Docker Desktop | 20.10+ | 容器运行时 |
| Go | 1.22+ | 后端开发 |
| Python | 3.11+ | AI 服务开发 |
| Node.js | 20+ | 前端开发 |
| Git | 2.30+ | 版本控制 |

### 可选工具

- **Visual Studio Code** - 推荐的代码编辑器
- **Postman/Insomnia** - API 测试
- **DBeaver/pgAdmin** - 数据库管理

---

## WSL2 环境配置

### 1. 启用 WSL2

```powershell
# Windows PowerShell（管理员）
wsl --install
# 重启计算机

# 安装完成后，设置 WSL2 为默认版本
wsl --set-default-version 2

# 安装 Ubuntu（推荐 Ubuntu 22.04 或 24.04）
wsl --install -d Ubuntu-22.04
```

### 2. 配置 WSL2 资源限制

在 Windows 用户目录下创建 `.wslconfig` 文件：

```ini
# C:\Users\<你的用户名>\.wslconfig
[wsl2]
memory=16GB           # 分配 16GB 内存（推荐）
processors=8          # 分配 8 核 CPU
swap=8GB              # 交换空间 8GB
localhostForwarding=true  # 启用 localhost 转发

[experimental]
autoMemoryReclaim=gradual  # 自动回收内存
sparseVhd=true            # 使用稀疏 VHD，减少磁盘占用
```

应用配置：

```powershell
# 在 Windows PowerShell 中运行
wsl --shutdown
# 重新打开 WSL
```

### 3. 验证内核版本

```bash
# 在 WSL2 中运行
uname -r
# 确保版本 >= 5.15（支持 cgroups v2 和基础 eBPF）
```

如果版本过低，更新 WSL：

```powershell
# Windows PowerShell
wsl --update
wsl --shutdown
```

### 4. 启用 systemd

在 WSL2 中编辑 `/etc/wsl.conf`：

```bash
sudo vim /etc/wsl.conf
```

添加以下内容：

```ini
[boot]
systemd=true
```

重启 WSL：

```powershell
wsl --shutdown
```

### 5. 验证 cgroups v2

```bash
# 检查 cgroups 版本
stat -f -c %T /sys/fs/cgroup/
# 输出应为 "cgroup2fs"
```

---

## 开发环境搭建

### 方式一：使用自动安装脚本（推荐）

```bash
# 在项目根目录运行
bash scripts/setup-dev.sh
```

脚本会自动完成：
- ✅ 检查并安装 Go 1.22+
- ✅ 检查并安装 Python 3.11+ 和 uv
- ✅ 检查并安装 Node.js 20+ 和 pnpm
- ✅ 安装 Go 开发工具（air, protoc 插件）
- ✅ 安装 buf（Proto 管理工具）
- ✅ 启动基础设施容器
- ✅ 生成 Proto 代码

### 方式二：手动安装

#### 1. 安装 Go

```bash
# 检查是否已安装
go version

# 如果未安装
wget -q https://go.dev/dl/go1.22.5.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.22.5.linux-amd64.tar.gz
rm go1.22.5.linux-amd64.tar.gz

# 添加到 PATH（如果你使用 bash）
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
echo 'export GOPATH=$HOME/go' >> ~/.bashrc
echo 'export PATH=$PATH:$GOPATH/bin' >> ~/.bashrc
source ~/.bashrc

# 验证
go version
```

#### 2. 安装 Python 和 uv

```bash
# Ubuntu 22.04 已包含 Python 3.11
python3 --version

# 安装 uv（Python 包管理工具）
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc

# 验证
uv --version
```

#### 3. 安装 Node.js 和 pnpm

```bash
# 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 pnpm
npm install -g pnpm

# 验证
node --version
pnpm --version
```

#### 4. 安装 Go 开发工具

```bash
# air - Go 热重载工具
go install github.com/air-verse/air@latest

# protoc 代码生成插件
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
go install github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-openapiv2@latest
```

#### 5. 安装 buf（Proto 管理工具）

```bash
curl -sSL "https://github.com/bufbuild/buf/releases/latest/download/buf-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/buf && chmod +x /usr/local/bin/buf

# 验证
buf version
```

#### 6. 验证 nsjail

```bash
# nsjail 应该已经安装（参考"已经完成的.md"）
nsjail --version

# 测试隔离功能
nsjail --config /dev/null -- /bin/echo "nsjail working!"
```

#### 7. 验证 Docker

```bash
docker --version
docker compose version

# 测试 Docker 是否正常运行
docker run --rm hello-world
```

#### 8. 验证系统工具

```bash
# strace
strace --version

# perf
perf --version

# cgroups
ls /sys/fs/cgroup/
```

---

## 服务启动流程

### 1. 初始化项目

```bash
# 克隆项目（如果还没有）
git clone https://github.com/xxx/TraceOS-Lab.git
cd TraceOS-Lab

# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件
vim .env
```

**必填的环境变量：**

```bash
# PostgreSQL
PG_PASSWORD=change_me_in_production

# JWT 密钥（生成随机字符串）
JWT_SECRET=$(openssl rand -base64 32)

# AI 模型 API Key（至少配置一个）
OPENAI_API_KEY=sk-xxx
# 或
CLAUDE_API_KEY=sk-ant-xxx

# MinIO
MINIO_PASSWORD=change_me_in_production

# Grafana
GRAFANA_PASSWORD=change_me
```

### 2. 启动基础设施

```bash
# 使用 Makefile
make dev

# 或直接使用 docker compose
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# 查看启动状态
docker compose ps

# 查看日志（等待数据库就绪）
docker compose logs -f postgres
# 看到 "database system is ready" 即可 Ctrl+C 退出
```

### 3. 生成 Proto 代码

```bash
# 使用 Makefile
make gen-proto

# 或直接运行脚本
./scripts/gen-proto.sh
```

这会生成：
- Go 代码：`services/core-service/pkg/gen/`
- Python 代码：`services/ai-service/pkg/gen/`
- gRPC-HTTP 转换代码（用于 REST API）

### 4. 启动应用服务（本地开发模式）

#### 终端 1：Core Service

```bash
cd services/core-service

# 首次运行需要下载依赖
go mod download

# 启动服务（带热更新）
air
```

服务将监听：
- HTTP API: `http://localhost:8080`
- gRPC: `http://localhost:9090`

#### 终端 2：AI Service

```bash
cd services/ai-service

# 首次运行需要安装依赖
uv pip install -r requirements.txt

# 启动服务（带热更新）
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

服务将监听：
- HTTP API: `http://localhost:8000`
- API 文档: `http://localhost:8000/docs`

#### 终端 3：Observability Service

```bash
cd services/observability

# 首次运行
go mod download

# 启动服务（带热更新）
air
```

服务将监听：
- gRPC: `http://localhost:9091`

#### 终端 4：Frontend

```bash
cd frontend

# 首次运行需要安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

前端将运行在：
- Web 界面: `http://localhost:3000`

### 5. 验证服务可用性

```bash
# 测试 Core Service
curl http://localhost:8080/api/v1/health

# 测试 AI Service
curl http://localhost:8000/health

# 查看 Prometheus
curl http://localhost:9090/-/healthy

# 查看 Grafana
# 浏览器访问 http://localhost:3001
```

---

## 开发工作流

### 日常开发流程

```bash
# 每天开始工作时
make dev                    # 启动基础设施

# 然后在四个终端分别启动应用服务
# Terminal 1: cd services/core-service && air
# Terminal 2: cd services/ai-service && uvicorn app.main:app --reload --port 8000
# Terminal 3: cd services/observability && air
# Terminal 4: cd frontend && pnpm dev

# 修改代码后，air/uvicorn/pnpm dev 会自动重新加载

# 查看某个服务的日志
docker compose logs -f postgres
docker compose logs -f redis

# 结束工作时
make dev-down               # 停止基础设施，保留数据
```

### 添加新的 Proto 定义

```bash
# 1. 编辑或创建 .proto 文件
vim proto/core/v1/xxx.proto

# 2. 重新生成代码
make gen-proto

# 3. 在 Go 或 Python 中使用生成的代码
```

### 数据库迁移

```bash
# 创建新的迁移文件
vim deploy/init-db/06-new-table.sql

# 应用迁移
docker compose exec postgres psql -U traceos -f /docker-entrypoint-initdb.d/06-new-table.sql

# 或使用 make 命令（如果 Makefile 中定义了 migrate 目标）
make migrate
```

### 运行测试

```bash
# Go 测试
cd services/core-service
go test ./...

# Python 测试
cd services/ai-service
pytest

# 前端测试
cd frontend
pnpm test
```

---

## 调试技巧

### Go 服务调试

```bash
# 使用 delve 进行调试
cd services/core-service
dlv debug ./cmd/server

# 或使用 VS Code 的调试功能
# 安装扩展: Go
# 配置 launch.json:
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Launch Package",
      "type": "go",
      "request": "launch",
      "mode": "auto",
      "program": "${workspaceFolder}/cmd/server"
    }
  ]
}
```

### Python 服务调试

```bash
# 使用 pdb 进行调试
cd services/ai-service
python -m pdb app/main.py

# 或使用 VS Code 的调试功能
# 安装扩展: Python
```

### Docker 容器调试

```bash
# 进入运行中的容器
docker compose exec postgres psql -U traceos
docker compose exec redis redis-cli

# 查看容器资源使用
docker stats

# 查看容器日志
docker compose logs -f core-service
docker compose logs -f ai-service
```

### 查看数据库内容

```bash
# 使用 psql
docker compose exec postgres psql -U traceos

# 在 psql 中
\dt                    # 列出所有表
\d table_name         # 查看表结构
SELECT * FROM users;  # 查询数据

# 退出
\q
```

---

## 常见问题

### Q: Docker Desktop 在 WSL2 中无法启动

```bash
# 1. 确保 Docker Desktop 已安装并启动
# 2. 检查 WSL 集成设置
#    Docker Desktop → Settings → Resources → WSL Integration
# 3. 确保 docker 命令可用
docker --version

# 如果仍有问题，重启 Docker Desktop
# Windows PowerShell
Restart-Service docker
```

### Q: 内存不足

```bash
# 1. 调整 .wslconfig 中的内存设置
# 2. 清理 Docker 资源
docker system prune -a --volumes

# 3. 限制 Docker Desktop 资源
#    Docker Desktop → Settings → Resources → Advanced
```

### Q: PostgreSQL 扩展安装失败

```bash
# 使用已集成扩展的镜像
# 编辑 docker-compose.yml
postgres:
  image: timescale/timescaledb-ha:pg16

# 验证扩展是否可用
docker compose exec postgres psql -U traceos -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
docker compose exec postgres psql -U traceos -c "CREATE EXTENSION IF NOT EXISTS vector;"
docker compose exec postgres psql -U traceos -c "CREATE EXTENSION IF NOT EXISTS age;"
```

### Q: Proto 代码生成失败

```bash
# 确保 protoc 和相关插件已安装
protoc --version
protoc-gen-go --version
protoc-gen-go-grpc --version

# 清理并重新生成
rm -rf services/*/pkg/gen
make gen-proto
```

### Q: nsjail 权限问题

```bash
# nsjail 需要 CAP_SYS_ADMIN 权限
# 在 Docker 中运行 observability 服务时需要 privileged: true
# 或使用 capabilities:

observability:
  cap_add:
    - SYS_ADMIN
    - SYS_PTRACE
    - NET_ADMIN
```

### Q: 前端热更新不生效

```bash
# 1. 清理 Next.js 缓存
cd frontend
rm -rf .next

# 2. 重新启动
pnpm dev

# 3. 检查端口是否被占用
lsof -i :3000
```

### Q: 无法连接到数据库

```bash
# 1. 检查 PostgreSQL 是否运行
docker compose ps postgres

# 2. 查看日志
docker compose logs postgres

# 3. 检查连接字符串
#    .env 中的 PG_HOST 应为 postgres（Docker 服务名）
```

---

## 下一步

开发环境搭建完成后，你可以：

1. 阅读 [API 设计文档](./API.md) 了解接口规范
2. 阅读 [数据库设计](./DATABASE.md) 了解数据模型
3. 查看 [proto 定义](../proto/) 了解 gRPC 接口
4. 开始开发你的第一个功能！

---

**祝开发愉快！** 🚀