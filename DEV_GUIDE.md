# TraceOS Lab - 开发运维指南 (DevOps Guide)

## 服务器信息
- 地址: 47.98.115.61
- 用户: root
- 密码: 88888888aA@
- 项目路径: /root/traceos-lab

---

## 热更新机制

| 服务 | 热更新方式 | 改动后行为 |
|---|---|---|
| 前端 (Next.js) | 
ext dev HMR | 保存文件 -> 浏览器自动刷新，0秒 |
| AI 服务 (Python) | Uvicorn --reload | 改.py -> 3-5秒自动重启 |
| Core (Go) | 需手动编译部署 | 改.go -> 编译+重启，~10秒 |
| Observability (Go) | 需手动编译部署 | 改.go -> 编译+重启，~10秒 |

---

## Core 服务 (Go) 修改后重新部署

Go 是编译型语言，改代码后必须重新编译。服务器已安装 Go 1.22 在 /usr/local/go/bin/go。

### 步骤：

# 1. 编译 (项目根目录)
cd /root/traceos-lab/services/core-service
GOPROXY=https://goproxy.cn,direct /usr/local/go/bin/go build -a -ldflags="-s -w" -o server_new ./cmd/server

# 2. 部署到容器
docker cp server_new traceos-core:/app/server
docker restart traceos-core

# 3. 验证 (等5秒后)
curl -s http://localhost/api/v1/auth/register -H 'Content-Type: application/json' -d '{"username":"test","email":"t@t.com","password":"123456"}'

### 注意事项：
- 编译约10秒，不要用docker build（Docker Hub被墙，拉不到ubuntu镜像）
- GOPROXY 用 goproxy.cn（国内可用）
- 编译产物约13MB
- 宿主机 Go 版本: 1.22.10

---

## 后端错误消息中文化

已修改文件：
- /root/traceos-lab/services/core-service/internal/handler/auth.go - 所有错误消息改为中文
- /root/traceos-lab/services/core-service/internal/model/model.go - 去掉 RegisterRequest/LoginRequest 的 binding 标签（让手动校验生效）

### 注册错误提示：
| 场景 | 中文提示 |
|---|---|
| 用户名不符合要求 | 用户名需为 2-50 个字符 |
| 邮箱格式不正确 | 邮箱格式不正确 |
| 密码不符合要求 | 密码需为 6-128 个字符 |
| 用户名已存在 | 用户名已存在 |
| JSON格式错误 | 请求数据格式不正确，请检查输入 |

### 登录错误提示：
| 场景 | 中文提示 |
|---|---|
| 用户名或密码错误 | 用户名或密码错误 |
| 账号被禁用 | 账号已被禁用 |

---

## 前端修改

前端使用 Next.js dev 模式，文件挂载到容器，保存即生效。
- 容器名: traceos-frontend
- 挂载: ./frontend:/app
- 命令: npx next dev -H 0.0.0.0 -p 3000

### 注册页面
- 文件: /root/traceos-lab/frontend/app/register/page.tsx
- 角色选择器: 学生/教师 双卡片切换
- API调用: api.register(username, email, password, role, fullName)

### 前端 API 客户端
- 文件: /root/traceos-lab/frontend/lib/api.ts
- API_BASE: 空字符串（走 Next.js rewrites 代理到 Traefik）

---

## Docker 运维

### 容器列表
`
traceos-frontend      - Next.js 前端
traceos-core          - Go 核心服务
traceos-postgres      - PostgreSQL 数据库
traceos-ai            - Python AI 服务
traceos-observability - Go 可观测性服务
traceos-minio         - MinIO 对象存储
traceos-redis         - Redis 缓存
traceos-traefik       - Traefik 反向代理
traceos-nats          - NATS 消息队列
`

### 常用命令
`ash
# 查看日志
docker logs traceos-core --tail 50
docker logs traceos-frontend --tail 20

# 重启服务
docker restart traceos-core
docker restart traceos-frontend

# 进入容器
docker exec -it traceos-core bash
docker exec -it traceos-postgres psql -U traceos -d traceos

# 全部重启 (dev模式)
cd /root/traceos-lab
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart
`

---

## Windows 本地连接服务器 (Python paramiko)

`python
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.98.115.61', username='root', password='88888888aA@', timeout=15)
stdin, stdout, stderr = ssh.exec_command('你的命令')
print(stdout.read().decode('utf-8', errors='replace'))
ssh.close()
`

注意: Windows 终端编码是 GBK，中文输出可能有编码问题。建议输出写入文件或使用 errors='replace'。

---

## 关键文件路径

| 用途 | 路径 |
|---|---|
| 注册页面 | /root/traceos-lab/frontend/app/register/page.tsx |
| 登录页面 | /root/traceos-lab/frontend/app/login/page.tsx |
| API客户端 | /root/traceos-lab/frontend/lib/api.ts |
| 认证处理器 | /root/traceos-lab/services/core-service/internal/handler/auth.go |
| 数据模型 | /root/traceos-lab/services/core-service/internal/model/model.go |
| Docker Compose | /root/traceos-lab/docker-compose.yml |
| Dev Compose | /root/traceos-lab/docker-compose.dev.yml |

