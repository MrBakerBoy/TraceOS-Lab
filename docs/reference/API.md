# TraceOS Lab API 设计文档

本文档描述 TraceOS Lab 的完整 API 接口设计，包括 REST API 和 gRPC 接口。

---

## 📋 目录

- [API 架构概览](#api-架构概览)
- [REST API 规范](#rest-api-规范)
- [gRPC 接口规范](#grpc-接口规范)
- [认证与授权](#认证与授权)
- [错误处理](#错误处理)
- [接口版本管理](#接口版本管理)

---

## API 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      Traefik (API Gateway)                   │
│                                                               │
│  REST API (http://localhost)  ←→  grpc-gateway (转译)        │
│  gRPC API (grpc://localhost)   ←→  直接 gRPC 调用           │
│  WebSocket (/ws/*)             ←→  实时通信                │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
┌───────▼────────┐ ┌─────▼──────────┐ ┌───▼────────────────┐
│  Core Service  │ │  AI Service    │ │  Observability     │
│  (Go/Gin)      │ │  (Python/FastAPI)│ │  Service (Go)      │
│  Port: 8080    │ │  Port: 8000    │ │  Port: 9091        │
│  gRPC: 9090    │ │                │ │  gRPC only         │
└────────────────┘ └────────────────┘ └────────────────────┘
```

### 服务端口分配

| 服务 | HTTP 端口 | gRPC 端口 | 说明 |
|------|----------|----------|------|
| Core Service | 8080 | 9090 | 核心业务 API |
| AI Service | 8000 | - | AI 诊断 API |
| Observability Service | - | 9091 | 仅 gRPC |
| Frontend | 3000 | - | Web 界面 |
| Traefik | 80, 443 | - | API 网关 |

---

## REST API 规范

### 通用规范

- **Base URL**: `http://localhost:8080/api/v1`（开发环境）
- **Content-Type**: `application/json`
- **字符编码**: UTF-8
- **日期格式**: ISO 8601 (`2024-06-02T10:30:00Z`)
- **分页参数**: `page` (默认 1), `page_size` (默认 20, 最大 100)

### 通用响应格式

#### 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "timestamp": "2024-06-02T10:30:00Z"
}
```

#### 错误响应

```json
{
  "code": 1001,
  "message": "参数验证失败",
  "errors": [
    {
      "field": "email",
      "message": "邮箱格式不正确"
    }
  ],
  "timestamp": "2024-06-02T10:30:00Z"
}
```

#### 分页响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 100,
      "total_pages": 5
    }
  },
  "timestamp": "2024-06-02T10:30:00Z"
}
```

---

### 1. 用户认证模块

#### 1.1 用户注册

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "username": "student01",
  "email": "student@example.com",
  "password": "securepassword123",
  "full_name": "张三"
}
```

**响应 (201 Created)**

```json
{
  "code": 0,
  "message": "注册成功",
  "data": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "student01",
    "email": "student@example.com",
    "role": "student"
  }
}
```

#### 1.2 用户登录

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "student@example.com",
  "password": "securepassword123"
}
```

**响应 (200 OK)**

```json
{
  "code": 0,
  "message": "登录成功",
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_in": 3600,
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "username": "student01",
      "email": "student@example.com",
      "full_name": "张三",
      "role": "student"
    }
  }
}
```

#### 1.3 刷新 Token

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### 1.4 用户登出

```http
POST /api/v1/auth/logout
Authorization: Bearer <access_token>
```

---

### 2. 用户管理模块

#### 2.1 获取当前用户信息

```http
GET /api/v1/users/me
Authorization: Bearer <access_token>
```

**响应 (200 OK)**

```json
{
  "code": 0,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "student01",
    "email": "student@example.com",
    "full_name": "张三",
    "role": "student",
    "preferences": {
      "theme": "dark",
      "language": "zh-CN"
    },
    "created_at": "2024-05-01T10:00:00Z",
    "last_login_at": "2024-06-02T10:30:00Z"
  }
}
```

#### 2.2 更新用户信息

```http
PATCH /api/v1/users/me
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "full_name": "张三丰",
  "preferences": {
    "theme": "light"
  }
}
```

---

### 3. 课程管理模块

#### 3.1 获取课程列表

```http
GET /api/v1/courses?page=1&page_size=20
Authorization: Bearer <access_token>
```

**响应 (200 OK)**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "id": "660e8400-e29b-41d4-a716-446655440001",
        "code": "OS2024",
        "name": "操作系统原理",
        "description": "学习操作系统的核心概念和实现",
        "teacher": {
          "id": "550e8400-e29b-41d4-a716-446655444444",
          "name": "李老师"
        },
        "is_enrolled": true,
        "enrollment_count": 45
      }
    ],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 5,
      "total_pages": 1
    }
  }
}
```

#### 3.2 获取课程详情

```http
GET /api/v1/courses/{course_id}
Authorization: Bearer <access_token>
```

#### 3.3 加入课程

```http
POST /api/v1/courses/{course_id}/enroll
Authorization: Bearer <access_token>
```

---

### 4. 实验管理模块

#### 4.1 获取实验列表

```http
GET /api/v1/courses/{course_id}/experiments?category=process&page=1
Authorization: Bearer <access_token>
```

**响应 (200 OK)**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "id": "770e8400-e29b-41d4-a716-446655440002",
        "category": "process",
        "name": "lab1_fork",
        "title": "进程创建与控制",
        "description": "学习 fork()、exec()、wait() 的使用",
        "difficulty": "medium",
        "time_limit": 300,
        "memory_limit": 268435456,
        "sandbox_level": 2,
        "status": "not_started",
        "best_score": null,
        "submission_count": 0
      }
    ],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 6,
      "total_pages": 1
    }
  }
}
```

#### 4.2 获取实验详情

```http
GET /api/v1/experiments/{experiment_id}
Authorization: Bearer <access_token>
```

**响应 (200 OK)**

```json
{
  "code": 0,
  "data": {
    "id": "770e8400-e29b-41d4-a716-446655440002",
    "course": {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "code": "OS2024",
      "name": "操作系统原理"
    },
    "category": "process",
    "name": "lab1_fork",
    "title": "进程创建与控制",
    "description": "本实验要求你实现一个简单的命令行程序...",
    "instructions": "# 实验目标\n\n1. 使用 fork() 创建子进程\n2. ...",
    "starter_code": "#include <stdio.h>\n#include <unistd.h>\n\nint main() {\n    // 在这里编写你的代码\n    return 0;\n}",
    "difficulty": "medium",
    "time_limit": 300,
    "memory_limit": 268435456,
    "sandbox_level": 2,
    "max_submissions": 100,
    "submission_count": 5,
    "best_score": 85,
    "can_submit": true
  }
}
```

#### 4.3 获取学生实验进度

```http
GET /api/v1/experiments/{experiment_id}/progress
Authorization: Bearer <access_token>
```

---

### 5. 代码提交与评测模块

#### 5.1 提交代码

```http
POST /api/v1/experiments/{experiment_id}/submissions
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "language": "c",
  "code": "#include <stdio.h>\n#include <unistd.h>\n\nint main() {\n    pid_t pid = fork();\n    if (pid == 0) {\n        printf(\"子进程\\n\");\n    } else {\n        printf(\"父进程\\n\");\n        wait(NULL);\n    }\n    return 0;\n}"
}
```

**响应 (202 Accepted)**

```json
{
  "code": 0,
  "message": "提交成功，评测中",
  "data": {
    "submission_id": "880e8400-e29b-41d4-a716-446655440003",
    "experiment_id": "770e8400-e29b-41d4-a716-446655440002",
    "submission_number": 6,
    "status": "pending",
    "created_at": "2024-06-02T10:30:00Z"
  }
}
```

#### 5.2 获取提交状态（轮询）

```http
GET /api/v1/submissions/{submission_id}
Authorization: Bearer <access_token>
```

**响应 (200 OK)**

```json
{
  "code": 0,
  "data": {
    "id": "880e8400-e29b-41d4-a716-446655440003",
    "experiment_id": "770e8400-e29b-41d4-a716-446655440002",
    "student_id": "550e8400-e29b-41d4-a716-446655440000",
    "submission_number": 6,
    "status": "completed",
    "score": 100,
    "total_score": 100,
    "passed_test_cases": 5,
    "total_test_cases": 5,
    "compile_error": null,
    "runtime_error": null,
    "execution_time": 45,
    "memory_usage": 2097152,
    "created_at": "2024-06-02T10:30:00Z",
    "completed_at": "2024-06-02T10:30:45Z"
  }
}
```

#### 5.3 获取提交历史

```http
GET /api/v1/experiments/{experiment_id}/submissions?page=1&page_size=10
Authorization: Bearer <access_token>
```

#### 5.4 获取测试结果详情

```http
GET /api/v1/submissions/{submission_id}/test-results
Authorization: Bearer <access_token>
```

**响应 (200 OK)**

```json
{
  "code": 0,
  "data": [
    {
      "id": "990e8400-e29b-41d4-a716-446655440004",
      "test_case": {
        "id": "aa0e8400-e29b-41d4-a716-446655440005",
        "name": "正常情况测试",
        "type": "normal"
      },
      "status": "passed",
      "actual_output": "父进程\n子进程\n",
      "execution_time": 45,
      "memory_usage": 2097152,
      "score": 20
    }
  ]
}
```

---

### 6. 系统调用观测模块（eBPF + strace 双层架构）

#### 6.1 获取 syscall trace（历史数据，REST）

```http
GET /api/v1/submissions/{submission_id}/traces
Authorization: Bearer <access_token>
```

**响应 (200 OK)**

```json
{
  "code": 0,
  "data": {
    "submission_id": "880e8400-e29b-41d4-a716-446655440003",
    "summary": {
      "total_syscalls": 23,
      "error_count": 0,
      "unique_syscalls": 12,
      "execution_time_ms": 45,
      "pid": 12345
    },
    "traces": [
      {
        "time": "2024-06-02T10:30:00.123456Z",
        "pid": 12345,
        "tid": 12345,
        "syscall_name": "clone",
        "syscall_number": 56,
        "args": {
          "flags": "CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD"
        },
        "return_value": 12346,
        "error_code": 0,
        "duration_ns": 523400
      }
    ]
  }
}
```

#### 6.2 获取资源使用情况

```http
GET /api/v1/submissions/{submission_id}/resource-usage
Authorization: Bearer <access_token>
```

---

### 6A. eBPF 实时观测模块（SSE 流式推送）

> 基于 bpftrace tracepoint 的 eBPF 内核级观测，支持系统调用追踪、死锁检测、内存追踪、调度追踪四种探针。strace 为 fallback。

#### 6A.1 启动 eBPF 观测

```http
POST /api/v1/ebpf/observe
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "pid": 0,
  "probes": ["deadlock", "syscall", "mem"],
  "code": "#include <pthread.h>..."
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `pid` | int | 目标进程 PID（0=编译运行 code） |
| `probes` | string[] | 探针列表：`deadlock`/`syscall`/`sched`/`mem` |
| `code` | string | 学生代码（pid=0 时编译运行） |

**响应 (200 OK)**

```json
{
  "pid": 12345,
  "status": "started"
}
```

#### 6A.2 SSE 实时事件流

```http
GET /api/v1/ebpf/stream/{pid}?token=<jwt_token>
```

> ⚠️ 使用查询参数 `?token=` 认证：浏览器 `EventSource` API 不支持自定义 Header。

**SSE 事件类型**：

| type | payload | 说明 |
|------|---------|------|
| `syscall` | `{syscall, count}` | 系统调用实时计数 |
| `graph` | `{threads, locks}` | 锁等待图更新（力导向图） |
| `deadlock` | `{detected, cycle, details, fix}` | 死锁检测报告 |
| `safe` | `{msg}` | 安全（无死锁） |
| `mem` | `{brk_count, mmap_count, munmap_count, leak_bytes, leak_warning}` | 内存分配汇总 |
| `sched` | `{switches, wakeups, migrations}` | 调度统计 |
| `info` | `{pid, msg}` | 状态信息 |
| `done` | — | 观测完成 |
| `error` | `{msg}` | 错误信息 |

**SSE 流示例**：

```
data: {"type":"info","payload":{"pid":12345,"msg":"eBPF futex trace PID=12345 (bpftrace tracepoints)"}}

data: {"type":"syscall","payload":{"syscall":"write","count":1}}

data: {"type":"graph","payload":{"threads":[{"tid":12345},{"tid":12346}],"locks":[{"uaddr":"0x7f...","holder":12345,"waiters":[12346]}]}}

data: {"type":"deadlock","payload":{"detected":true,"cycle":[12345,12346],"details":["TID=12345 waits for lock 0x... held by TID=12346"],"fix":"All threads must acquire locks in the same order."}}

data: {"type":"done"}
```

#### 6A.3 查询观测状态

```http
GET /api/v1/ebpf/observe/{pid}
Authorization: Bearer <access_token>
```

**响应 (200 OK)**

```json
{
  "pid": 12345,
  "status": "running",
  "probes": ["deadlock", "syscall", "mem"],
  "deadlock": {
    "detected": true,
    "cycle": [12345, 12346],
    "details": ["TID=12345 waits for lock 0x... held by TID=12346"],
    "fix": "All threads must acquire locks in the same order."
  }
}
```

#### 6A.4 停止 eBPF 观测

```http
DELETE /api/v1/ebpf/observe/{pid}
Authorization: Bearer <access_token>
```

**响应 (200 OK)**

```json
{
  "pid": 12345,
  "status": "stopped"
}
```

---

### 7. AI 诊断模块

#### 7.1 请求 AI 诊断

```http
POST /api/v1/submissions/{submission_id}/diagnose
Authorization: Bearer <access_token>
```

**响应 (202 Accepted)**

```json
{
  "code": 0,
  "message": "诊断任务已提交",
  "data": {
    "diagnosis_id": "bb0e8400-e29b-41d4-a716-446655440006",
    "status": "pending",
    "estimated_time": 10
  }
}
```

#### 7.2 获取诊断结果

```http
GET /api/v1/diagnoses/{diagnosis_id}
Authorization: Bearer <access_token>
```

**响应 (200 OK)**

```json
{
  "code": 0,
  "data": {
    "id": "bb0e8400-e29b-41d4-a716-446655440006",
    "submission_id": "880e8400-e29b-41d4-a716-446655440003",
    "status": "completed",
    "error_type": null,
    "severity": null,
    "root_cause": null,
    "feedback": {
      "level_1": "你的代码表现良好，所有测试用例都通过了！",
      "level_2": "进程创建和控制部分实现正确，fork() 和 wait() 的使用符合预期。",
      "level_3": "代码正确实现了父子进程的创建和同步。fork() 返回后，父进程等待子进程结束，避免了僵尸进程的产生。"
    },
    "related_concepts": [
      {
        "name": "fork",
        "description": "创建子进程的系统调用"
      },
      {
        "name": "wait",
        "description": "等待子进程状态变化的系统调用"
      }
    ],
    "confidence_score": 0.95,
    "completed_at": "2024-06-02T10:30:10Z"
  }
}
```
---

### 10. 火焰图与 eBPF 分析模块

#### 10.1 生成火焰图

```http
POST /api/v1/submissions/{submission_id}/flamegraph?duration=10
Authorization: Bearer <teacher_token>
```

**响应 (200 OK)**

```json
{
  "submission_id": "880e8400-...",
  "user_svg": "<svg>...</svg>",
  "kernel_svg": "<svg>...</svg>",
  "hot_functions": [
    {"name": "main", "percent": 45.2, "module": "a.out"},
    {"name": "printf", "percent": 30.1, "module": "libc.so.6"}
  ],
  "user_percent": 78.5,
  "kernel_percent": 21.5,
  "status": "generated"
}
```

#### 10.2 AI eBPF 系统调用解读

```http
POST /api/ai/ebpf/analyze
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "submission_id": "...",
  "code": "#include <stdio.h>...",
  "language": "c",
  "total_calls": 1523,
  "unique_syscalls": 28,
  "error_count": 3,
  "top_syscalls": [{"name": "write", "count": 500, "percent": 32.8}],
  "error_syscalls": [{"name": "openat", "error": "ENOENT", "count": 2}],
  "execution_time_ms": 45.2
}
```

**响应 (200 OK)**

```json
{
  "plain_summary": "程序共发起 1523 次系统调用...",
  "syscall_explanations": [
    {"name": "write", "plain_meaning": "向文件描述符写入数据", "why_program_uses_it": "用于向标准输出打印内容"}
  ],
  "error_explanations": [
    {"syscall": "openat", "error": "ENOENT", "plain_reason": "尝试打开的文件不存在", "fix_hint": "检查文件路径是否正确"}
  ],
  "patterns": []
}
```

#### 10.3 AI 火焰图性能分析

```http
POST /api/ai/flamegraph/analyze
Authorization: Bearer <teacher_token>
Content-Type: application/json

{
  "submission_id": "...",
  "code": "#include <stdio.h>...",
  "language": "c",
  "hot_functions": [{"name": "main", "percent": 45.2, "module": "a.out"}],
  "user_percent": 78.5,
  "kernel_percent": 21.5,
  "elapsed_sec": 10
}
```

---

### 11. 可观测性查询接口

#### 11.1 获取系统调用追踪（TimescaleDB）

```http
GET /api/obs/traces/{submission_id}?limit=500&errors_only=false
Authorization: Bearer <access_token>
```

#### 11.2 获取性能指标

```http
GET /api/obs/metrics/{submission_id}
```

#### 11.3 获取资源使用

```http
GET /api/obs/resources/{submission_id}
```

---

### 8. 教学数据模块（仅教师）

#### 8.1 获取班级学情统计

```http
GET /api/v1/courses/{course_id}/statistics
Authorization: Bearer <teacher_token>
```

**响应 (200 OK)**

```json
{
  "code": 0,
  "data": {
    "course": {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "name": "操作系统原理"
    },
    "enrollment_count": 45,
    "active_students": 42,
    "experiments": [
      {
        "experiment_id": "770e8400-e29b-41d4-a716-446655440002",
        "title": "进程创建与控制",
        "submission_rate": 0.93,
        "average_score": 78.5,
        "common_errors": [
          {
            "error_type": "fd_leak",
            "occurrence_count": 8,
            "affected_students": 5
          }
        ]
      }
    ]
  }
}
```

#### 8.2 获取错误统计

```http
GET /api/v1/errors/statistics?experiment_id={experiment_id}
Authorization: Bearer <teacher_token>
```

---

### 9. WebSocket / SSE 接口

#### 9.1 实时评测状态推送（WebSocket）

```
WS /ws/submissions/{submission_id}/status
```

#### 9.2 实时 syscall trace 推送（WebSocket）

```
WS /ws/submissions/{submission_id}/traces
```

#### 9.3 eBPF 实时观测事件流（SSE） ⭐

```
GET /api/v1/ebpf/stream/{pid}?token=<jwt_token>
Content-Type: text/event-stream
```

> SSE（Server-Sent Events）用于 eBPF 实时观测，支持 syscall/graph/deadlock/safe/mem/sched/info/done/error 九种事件类型。详见 [6A 节](#6a-ebpf-实时观测模块sse-流式推送)。

---

## gRPC 接口规范

### Proto 包结构

```
proto/
├── core/
│   └── v1/
│       ├── user.proto          # 用户服务
│       ├── experiment.proto    # 实验服务
│       ├── evaluation.proto    # 评测服务
│       └── submission.proto    # 提交服务
├── ai/
│   └── v1/
│       ├── diagnosis.proto     # 诊断服务
│       ├── agent.proto         # Agent 服务
│       └── knowledge.proto     # 知识库服务
└── observability/
    └── v1/
        ├── trace.proto         # Trace 服务
        └── stream.proto        # 流式传输
```

### 生成代码

```bash
make gen-proto
```

### 核心服务定义

#### 1. 用户服务 (UserService)

```protobuf
syntax = "proto3";

package core.v1;

option go_package = "github.com/xxx/TraceOS-Lab/services/core-service/pkg/gen/core/v1;corev1";

import "google/protobuf/timestamp.proto";

// 用户服务
service UserService {
  // 获取用户信息
  rpc GetUser(GetUserRequest) returns (GetUserResponse);
  // 更新用户信息
  rpc UpdateUser(UpdateUserRequest) returns (UpdateUserResponse);
  // 批量获取用户
  rpc BatchGetUsers(BatchGetUsersRequest) returns (BatchGetUsersResponse);
}

message GetUserRequest {
  string user_id = 1;
}

message GetUserResponse {
  User user = 1;
}

message User {
  string id = 1;
  string username = 2;
  string email = 3;
  string full_name = 4;
  string role = 5;
  bool is_active = 6;
  google.protobuf.Timestamp created_at = 7;
  google.protobuf.Timestamp updated_at = 8;
}
```

#### 2. 评测服务 (EvaluationService)

```protobuf
syntax = "proto3";

package core.v1;

option go_package = "github.com/xxx/TraceOS-Lab/services/core-service/pkg/gen/core/v1;corev1";

import "google/protobuf/timestamp.proto";

// 评测服务
service EvaluationService {
  // 提交评测任务
  rpc SubmitEvaluation(SubmitEvaluationRequest) returns (SubmitEvaluationResponse);
  // 获取评测结果
  rpc GetEvaluationResult(GetEvaluationResultRequest) returns (GetEvaluationResultResponse);
  // 流式获取评测进度
  rpc StreamEvaluationProgress(StreamEvaluationProgressRequest) returns (stream EvaluationProgress);
}

message SubmitEvaluationRequest {
  string experiment_id = 1;
  string student_id = 2;
  string language = 3;
  string code = 4;
}

message SubmitEvaluationResponse {
  string submission_id = 1;
  string status = 2;  // pending, running, completed, failed
  google.protobuf.Timestamp created_at = 3;
}

message GetEvaluationResultRequest {
  string submission_id = 1;
}

message GetEvaluationResultResponse {
  EvaluationResult result = 1;
}

message EvaluationResult {
  string submission_id = 1;
  string status = 2;
  int32 score = 3;
  int32 total_score = 4;
  int32 passed_test_cases = 5;
  int32 total_test_cases = 6;
  repeated TestCaseResult test_results = 7;
  int32 execution_time_ms = 8;
  int64 memory_usage_bytes = 9;
  string compile_error = 10;
  string runtime_error = 11;
}

message TestCaseResult {
  string test_case_id = 1;
  string test_case_name = 2;
  string status = 3;  // passed, failed, error, timeout
  string actual_output = 4;
  string error_message = 5;
  int32 execution_time_ms = 6;
  int64 memory_usage_bytes = 7;
  int32 score = 8;
}

message StreamEvaluationProgressRequest {
  string submission_id = 1;
}

message EvaluationProgress {
  string status = 1;
  int32 progress = 2;  // 0-100
  string message = 3;
  google.protobuf.Timestamp timestamp = 4;
}
```

#### 3. Trace 服务 (Observability)

```protobuf
syntax = "proto3";

package observability.v1;

option go_package = "github.com/xxx/TraceOS-Lab/services/observability/pkg/gen/observability/v1;observabilityv1";

import "google/protobuf/timestamp.proto";

// Trace 观测服务
service TraceService {
  // 获取 syscall trace
  rpc GetSyscallTrace(GetSyscallTraceRequest) returns (GetSyscallTraceResponse);
  // 流式获取 syscall trace（实时）
  rpc StreamSyscallTrace(StreamSyscallTraceRequest) returns (stream SyscallEvent);
  // 获取性能指标
  rpc GetPerformanceMetrics(GetPerformanceMetricsRequest) returns (GetPerformanceMetricsResponse);
  // 获取资源使用情况
  rpc GetResourceUsage(GetResourceUsageRequest) returns (GetResourceUsageResponse);
}

message GetSyscallTraceRequest {
  string submission_id = 1;
  optional int64 start_time = 2;  // Unix timestamp (nanoseconds)
  optional int64 end_time = 3;
  optional int32 limit = 4;
}

message GetSyscallTraceResponse {
  string submission_id = 1;
  SyscallSummary summary = 2;
  repeated SyscallEvent traces = 3;
}

message SyscallSummary {
  int64 total_count = 1;
  int64 error_count = 2;
  int64 unique_syscalls = 3;
  int64 execution_time_ns = 4;
  int32 pid = 5;
}

message SyscallEvent {
  google.protobuf.Timestamp time = 1;
  int32 pid = 2;
  optional int32 tid = 3;
  string syscall_name = 4;
  int32 syscall_number = 5;
  map<string, string> args = 6;
  int64 return_value = 7;
  int32 error_code = 8;
  optional string error_name = 9;
  int64 duration_ns = 10;
  optional int32 cpu_id = 11;
}

message StreamSyscallTraceRequest {
  string submission_id = 1;
}

message GetPerformanceMetricsRequest {
  string submission_id = 1;
}

message GetPerformanceMetricsResponse {
  repeated PerformanceMetric metrics = 1;
}

message PerformanceMetric {
  string metric_name = 1;  // sched_latency, lock_contention, page_faults, etc.
  double value = 2;
  string unit = 3;
  google.protobuf.Timestamp timestamp = 4;
}

message GetResourceUsageRequest {
  string submission_id = 1;
}

message GetResourceUsageResponse {
  repeated ResourceUsagePoint points = 1;
}

message ResourceUsagePoint {
  google.protobuf.Timestamp time = 1;
  double cpu_percent = 2;
  int64 memory_bytes = 3;
  int64 disk_read_bytes = 4;
  int64 disk_write_bytes = 5;
}
```

#### 4. AI 诊断服务 (DiagnosisService)

```protobuf
syntax = "proto3";

package ai.v1;

option go_package = "github.com/xxx/TraceOS-Lab/services/ai-service/pkg/gen/ai/v1;aiv1";

import "google/protobuf/timestamp.proto";

// AI 诊断服务
service DiagnosisService {
  // 请求诊断
  rpc RequestDiagnosis(RequestDiagnosisRequest) returns (RequestDiagnosisResponse);
  // 获取诊断结果
  rpc GetDiagnosis(GetDiagnosisRequest) returns (GetDiagnosisResponse);
  // 流式获取诊断进度
  rpc StreamDiagnosisProgress(StreamDiagnosisProgressRequest) returns (stream DiagnosisProgress);
  // 获取渐进式提示
  rpc GetHint(GetHintRequest) returns (GetHintResponse);
}

message RequestDiagnosisRequest {
  string submission_id = 1;
  string experiment_id = 2;
  string student_id = 3;
}

message RequestDiagnosisResponse {
  string diagnosis_id = 1;
  string status = 2;  // pending, in_progress, completed, failed
  int32 estimated_time_seconds = 3;
}

message GetDiagnosisRequest {
  string diagnosis_id = 1;
}

message GetDiagnosisResponse {
  DiagnosisResult result = 1;
}

message DiagnosisResult {
  string diagnosis_id = 1;
  string status = 2;
  optional string error_type = 3;
  optional string severity = 4;
  optional string root_cause = 5;
  Feedback feedback = 6;
  repeated Concept related_concepts = 7;
  repeated SyscallInfo related_syscalls = 8;
  double confidence_score = 9;
  google.protobuf.Timestamp completed_at = 10;
}

message Feedback {
  string level_1 = 1;  // 最轻量级提示
  string level_2 = 2;  // 引导级提示
  string level_3 = 3;  // 详细解释
}

message Concept {
  string name = 1;
  string description = 2;
  string type = 3;  // syscall, concept, resource
}

message SyscallInfo {
  string name = 1;
  string description = 2;
  optional string error_code = 3;
}

message StreamDiagnosisProgressRequest {
  string diagnosis_id = 1;
}

message DiagnosisProgress {
  string stage = 1;  // trace_analysis, code_review, error_diagnosis, feedback_generation
  string agent_name = 2;
  int32 progress = 3;  // 0-100
  string message = 4;
  google.protobuf.Timestamp timestamp = 5;
}

message GetHintRequest {
  string diagnosis_id = 1;
  int32 level = 2;  // 1, 2, 3
}

message GetHintResponse {
  string hint = 1;
  string explanation = 2;
  repeated Concept related_concepts = 3;
}
```

---

## 认证与授权

### JWT Token 结构

```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "student01",
    "role": "student",
    "exp": 1717348200,
    "iat": 1717344600
  }
}
```

### 请求头格式

```
Authorization: Bearer <jwt_token>
```

### 权限级别

| 角色 | 权限 |
|------|------|
| `student` | 查看自己提交的作业、提交代码、查看自己的 trace |
| `teacher` | 查看课程统计、查看学生提交、管理实验 |
| `admin` | 全部权限 |

---

## 错误处理

### 错误码规范

| 错误码 | HTTP 状态码 | 说明 |
|--------|-------------|------|
| 0 | 200 | 成功 |
| 1001 | 400 | 参数验证失败 |
| 1002 | 401 | 未授权 |
| 1003 | 403 | 禁止访问 |
| 1004 | 404 | 资源不存在 |
| 1005 | 409 | 资源冲突 |
| 1006 | 429 | 请求过于频繁 |
| 2001 | 500 | 服务器内部错误 |
| 2002 | 503 | 服务不可用 |

### 错误响应示例

```json
{
  "code": 1004,
  "message": "实验不存在",
  "details": {
    "experiment_id": "invalid-id"
  },
  "timestamp": "2024-06-02T10:30:00Z"
}
```

---

## 接口版本管理

### 版本策略

- **URL 版本**: `/api/v1/`, `/api/v2/`
- **向后兼容**: v1 在弃用前至少支持 6 个月
- **弃用通知**: 通过响应头 `X-API-Deprecation` 通知

### 版本响应头

```
X-API-Version: 1.0
X-API-Latest: 2.0
```

---

**文档版本**: 2.0
**最后更新**: 2026-08-03