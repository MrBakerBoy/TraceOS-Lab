# TraceOS Lab 开发进度

## 总览
- [x] Wave 1: M8 + M2 + M5
- [x] Wave 2: M3 + M4 + M6
- [x] Wave 3: M1 + M7 (后端完成，前端需本地环境)
- [ ] Wave 4: 集成验证

## 模块状态

| 模块 | 任务文件 | 任务数 | 完成数 | 状态 | 门禁 | 重试 |
|------|---------|--------|--------|------|------|------|
| M8 通信基础 | m8-communication.md | 16 | 16 | ✅ | 待验证 | 0 |
| M2 AI 诊断 | m2-ai-diagnosis.md | 30 | 28 | ✅ | 待验证 | 0 |
| M5 沙箱管理 | m5-sandbox.md | 18 | 18 | ✅ | 待验证 | 0 |
| M3 评测引擎 | m3-evaluation-engine.md | 22 | 20 | ✅ | 待验证 | 0 |
| M4 观测引擎 | m4-observability.md | 17 | 17 | ✅ | 待验证 | 0 |
| M6 评论 | m6-comments.md | 12 | 12 | ✅ | 待验证 | 0 |
| M1 前端 | m1-frontend.md | 33 | 28 | 🟡 | 待验证 | 0 |
| M7 教师仪表盘 | m7-teacher-dashboard.md | 19 | 15 | 🟡 | 待验证 | 0 |

## 已完成的代码文件

### Wave 1 — M8 通信基础
- `internal/nats/events.go` — 事件类型定义
- `internal/nats/client.go` — EventBus 接口 + LogBus 实现
- `internal/nats/events_test.go` — 事件序列化测试
- `internal/nats/client_test.go` — LogBus 测试
- `internal/ws/hub.go` — WebSocket Hub
- `internal/ws/hub_test.go` — Hub 测试
- `internal/middleware/ratelimit.go` — 速率限制
- `internal/middleware/ratelimit_test.go` — 限流测试
- `internal/handler/auth.go` — RefreshToken + Logout
- `internal/config/config.go` — +NATSUrl

### Wave 1 — M2 AI 诊断
- `app/config.py` — +mimo_* 配置
- `app/services/__init__.py`
- `app/services/mimo_client.py` — Mimo HTTP 客户端
- `app/services/prompt_builder.py` — Prompt 构造器
- `app/services/result_parser.py` — JSON 结果解析
- `app/services/diagnosis_service.py` — 诊断业务编排
- `app/routers/diagnosis.py` — 重写（异步+持久化）
- `app/routers/hints.py` — 重写（Mimo 动态提示）
- `app/routers/agents.py` — 更新
- `tests/test_prompt_builder.py` — Prompt 测试
- `tests/test_result_parser.py` — 解析测试
- `tests/test_mimo_client.py` — Mimo 客户端测试
- `tests/test_diagnosis_service.py` — 诊断服务测试
- `tests/test_diagnosis_router.py` — 路由测试
- `tests/test_hints_router.py` — 提示路由测试
- `tests/conftest.py` — pytest 配置
- `deploy/init-db/06-diagnoses.sql` — 诊断表

### Wave 1 — M5 沙箱管理
- `internal/sandbox/types.go` — 类型定义
- `internal/sandbox/config.go` — 配置选择
- `internal/sandbox/config_test.go` — 配置测试
- `internal/sandbox/manager.go` — 接口 + Mock
- `internal/sandbox/pool.go` — 沙箱池
- `internal/sandbox/pool_test.go` — 池测试

### Wave 2 — M3 评测引擎
- `internal/evaluator/types.go` — 类型定义
- `internal/evaluator/strategy.go` — 6 种策略
- `internal/evaluator/strategy_test.go` — 策略测试
- `internal/evaluator/comparator.go` — 5 种比对模式
- `internal/evaluator/comparator_test.go` — 比对测试
- `internal/evaluator/scorer.go` — 评分引擎
- `internal/evaluator/scorer_test.go` — 评分测试
- `internal/evaluator/compiler.go` — C/C++ 编译器

### Wave 2 — M4 观测引擎
- `internal/collector/parser.go` — strace 解析器
- `internal/collector/parser_test.go` — 解析测试
- `internal/collector/feature_extractor.go` — 特征提取 + 摘要
- `internal/collector/feature_extractor_test.go` — 特征测试
- `internal/collector/testdata/strace_sample.log` — 测试数据

### Wave 2 — M6 评论
- `internal/model/model.go` — +Comment 结构体
- `internal/repository/comment.go` — CRUD
- `internal/handler/comment.go` — HTTP Handler
- `deploy/init-db/07-comments.sql` — 评论表

### Wave 3 — M7 教师仪表盘（后端）
- `internal/handler/teacher/stats.go` — 统计 API

### 集成 — main.go
- 完整路由注册：Auth + Experiments + Submissions + Progress + Comments + Teacher + WebSocket
- NATS LogBus 初始化
- WebSocket Hub 初始化

## BLOCKED
- M1 前端（TypeScript）：需本地环境安装 node_modules 后实现
- M7 前端部分：同上
- 门禁验证：沙箱无 Go/Python 测试环境，需本地运行

## M3 评测引擎模块 — 完成 (2026-06-06)

### 新增文件
-  — TestCaseRunner: 在沙箱中运行编译后的二进制文件，比对输出
-  — Pipeline: 编译→运行→评分→更新DB→发布NATS事件
-  — NATS Worker: 订阅 submission.created 事件
-  — LocalSandboxManager: 本地执行沙箱 (M3 MVP)

### 修改文件
-  — 添加 StrPtr 辅助函数
-  — 添加 NatsBus (真实NATS连接 + JetStream支持)
-  — EvaluationCompletedEvent 添加 ExperimentID/StudentID
-  — 替换 mock 评测为真实 Pipeline
-  — 接入 NATS、Pipeline、Worker
-  — 添加 gcc/g++/musl-dev 支持运行时编译
-  — 添加 github.com/nats-io/nats.go 依赖

### 流程验证
1. 学生提交代码 → 保存到DB (status=pending)
2. Pipeline 编译代码 (gcc -Wall -Wextra -O2)
3. Pipeline 在沙箱中运行测试用例，比对输出
4. Pipeline 评分并更新 submissions 表
5. Pipeline 发布 evaluation.completed 到 JetStream
6. AI 服务接收事件，调用 Mimo AI 诊断，保存到 diagnoses 表


## 补充修复 (2026-06-06 15:27)

### Bug 修复
- **Rate Limiter 滑动窗口**: 修复 `windowStart` 替代 `lastSeen`，防止持续请求导致计数器永不重置
- **Health Check**: 移到全局 rate limiter 之前，避免 Docker health check 触发 429
- **Frontend 构建**: 修复 Next.js Server Action 版本不匹配的构建错误

### M1 前端新增组件
- `components/workspace/TopBar.tsx` — 顶栏组件（用户信息+退出）
- `components/workspace/EditorToolbar.tsx` — 编辑器工具栏（语言选择、主题切换、字体大小）
- `hooks/useWebSocket.ts` — WebSocket 实时推送 hook（M8 集成）
- `ExperimentWorkspace.tsx` — 重构为使用 TopBar 组件
- `CodeEditorPanel.tsx` — 重构为使用 EditorToolbar 组件
- `stores/workspace.ts` — 新增 editorFontSize/editorTheme 状态

### M7 教师仪表盘新增
- `app/(dashboard)/teacher/students/[id]/page.tsx` — 学生详情页（实验进度+薄弱概念）
