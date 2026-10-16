# TraceOS Lab — 开发问题与解决方案

> 本文档记录开发过程中遇到的各类问题、根因分析及最终解决方案，供后续开发和维护参考。

---

## 概览

| 类别 | 问题数 | 状态 |
|------|:-----:|:----:|
| 🔴 安全漏洞 | 5 | ✅ 已解决 |
| 🟡 功能缺陷 | 10 | ✅ 已解决 |
| 🟠 代码质量 | 10 | ✅ 已解决 |
| 🟢 工程完善 | 7 | ✅ 已解决 |
| 🔵 前端体验 | 5 | ✅ 已解决 |
| 🟣 测试补强 | 4 | ✅ 已解决 |

---

## 一、安全漏洞

### 1. LLM API Key 明文泄露

- **问题**：`.env` 文件中硬编码了 LLM API Key，存在泄露风险
- **影响**：一旦代码提交到公开仓库，API Key 将暴露
- **解决**：移除硬编码密钥，`.env.example` 仅保留占位符 + 注释说明，敏感信息通过环境变量注入

### 2. JWT 密钥使用默认值

- **问题**：`JWT_SECRET` 无强校验，使用弱默认值时无任何警告
- **影响**：生产环境可能使用弱 JWT 密钥导致安全风险
- **解决**：`config.go` 新增 `Validate()` 方法，启动时检测 JWT_SECRET 是否为默认值，若是则打印安全警告

### 3. CORS 全通配符 `*`

- **问题**：`main.go` 中 CORS 配置为 `*`，任意域名均可跨域访问
- **影响**：潜在 CSRF 攻击风险
- **解决**：改为使用配置的 `FRONTEND_URL` 白名单，添加 `Access-Control-Allow-Credentials`

### 4. 评测执行路径不一致

- **问题**：`submission.go` 和 `main.go` 中存在两条评测路径，逻辑不一致
- **影响**：评测行为不可预测，调试困难
- **解决**：统一为 NATS 事件驱动路径，添加 LogBus fallback；`safeEvaluate()` 增加 panic recovery 兜底

### 5. 数据库迁移文件混乱

- **问题**：`deploy/init-db/` 中存在重复文件（`05-seed-v2.sql`、`05-seed-backup.sql`、`09-rag-fix.sql`、`update-codes.sql`、`02-schema.sql.bak`）
- **影响**：迁移顺序不确定，可能导致 Schema 不一致
- **解决**：清理所有重复和备份文件，保持编号连续（01-08 + 10-reports.sql）

---

## 二、功能缺陷

### 6. Python/Rust/Go 无编译器支持

- **问题**：`compiler.go` 不支持编译 Python、Rust、Go 代码
- **影响**：学生无法提交这三种语言的实验代码
- **解决**：完整重写编译器，新增 `compilePython`（语法检查 + 包装脚本）、`compileGo`（GO111MODULE=off）、`compileRust`（rustc），各语言独立错误解析

### 7. RAG 自动触发失效

- **问题**：AI 服务启动后 RAG 知识库自动加载失败，无任何提示
- **影响**：诊断缺少检索增强，反馈质量下降
- **解决**：`main.py` 启动时验证 LLM 配置，打印 provider/model 信息，缺失 API key 时明确警告

### 8. 诊断缓存 Key 碰撞

- **问题**：`diagnosis_service.py` 缓存 key 仅基于 submission_id，同一份代码多次运行产生不同结果时仍返回旧缓存
- **影响**：错误诊断结果被复用，误导学生
- **解决**：缓存 key 加入 test_results JSON 和 strace_summary，确保不同运行结果不会错误命中

### 9. Prompt 注入攻击风险

- **问题**：学生提交的代码直接拼入 LLM Prompt，可能包含恶意指令（如 "ignore previous instructions"）
- **影响**：AI 诊断被操控，输出不可控内容
- **解决**：`prompt_builder.py` 新增 `sanitize_code_for_prompt()` 和 `sanitize_output_for_prompt()`，检测 4 种注入模式并标记；`SYSTEM_PROMPT_BASE` 增加安全约束

### 10. Monaco 编辑器无加载状态

- **问题**：`CodeEditorPanel.tsx` 使用 `dynamic()` 懒加载 Monaco Editor，加载期间白屏
- **影响**：用户体验差，网络慢时以为页面卡死
- **解决**：为 `dynamic()` 添加 loading fallback（spinner + 加载文字）

### 11. TypeScript `any` 类型泛滥

- **问题**：`api.ts` 中大量使用 `any` 类型，请求/响应无类型约束
- **影响**：编译期无法检查类型错误，重构极易引入 bug
- **解决**：完整重写，添加 20+ 类型接口（`User`、`Experiment`、`Submission`、`DiagnosisResult` 等）、请求重试机制、超时控制、Token 过期自动处理

### 12. 前端 API 地址硬编码

- **问题**：`NEXT_PUBLIC_API_URL` 硬编码为固定地址，切换环境需改代码
- **影响**：本地开发与线上部署需手动修改
- **解决**：默认值改为 `localhost`，完全支持通过环境变量覆盖

### 13. bcrypt 加密强度不足

- **问题**：`auth.go` 使用 `bcrypt.DefaultCost(10)`，加密强度较低
- **影响**：密码哈希抗暴力破解能力弱
- **解决**：cost 提升到 `12`

### 14. 缺少用户输入验证

- **问题**：`auth.go` 注册/登录接口未对 username、email、password 做长度和格式校验
- **影响**：数据库可能存入非法数据，SQL 注入风险
- **解决**：添加 username/email/password 长度和格式验证，role 白名单检查

### 15. goroutine 缺少 recovery

- **问题**：`worker.go` 中 goroutine 未使用 `defer recover()`，一旦 panic 导致整个 Worker 崩溃
- **影响**：评测链路不可用
- **解决**：`handleSubmissionCreated` 添加 `defer recover()` + stack trace logging

---

## 三、代码质量

### 16. strace 解析正则不健壮

- **问题**：strace 输出解析仅覆盖少量 syscall，特殊格式的行解析失败
- **影响**：观测数据不完整，特征提取结果不可靠
- **解决**：新增 30 个系统调用的解析测试用例，覆盖成功/失败/边界场景

### 17. context 使用不当（updateStatus）

- **问题**：`pipeline.go` 的 `updateStatus` 使用 `context.Background()`，无超时控制
- **影响**：数据库连接长时间占用，可能耗尽连接池
- **解决**：使用独立 context（30s timeout）

### 18. context 使用不当（InsertSyscallTraces）

- **问题**：同上，批量写入 syscall_traces 时无超时
- **影响**：TimescaleDB 写入阻塞
- **解决**：使用独立 context（30s timeout）

### 19. nsjail 路径硬编码

- **问题**：`nsjail_manager.go` 中 `nsjailBin`、`workBase`、`maxConcurrent` 写死
- **影响**：切换部署环境需改代码重新编译
- **解决**：改为从环境变量读取（`NSJAIL_BIN`、`NSJAIL_WORK_DIR`、`NSJAIL_MAX_CONCURRENT`）

### 20. Python 异常处理过粗

- **问题**：`diagnosis_service.py` 中 RAG 相关异常使用宽泛的 `except Exception`
- **影响**：`ImportError`（依赖缺失）和运行时错误混在一起，难以定位根因
- **解决**：分离 `ImportError` 和通用异常，分别给出针对性日志

### 21. NATS 消息缺少验证

- **问题**：`worker.go` 消费 NATS 消息时未校验 `SubmissionID` 是否为空
- **影响**：畸形消息导致后续逻辑 panic
- **解决**：添加 `SubmissionID` 空值检查，非法消息直接丢弃并记录日志

### 22. 前端提交缺少防重

- **问题**：`workspace.ts` 的 `submitCode()` 没有防重机制，用户快速双击可发起多次提交
- **影响**：数据库出现重复提交记录
- **解决**：添加 `submitting` 标志位，提交中禁止再次点击

### 23. 轮询次数不合理

- **问题**：诊断轮询最多 90 次，每次间隔 2s，最长等待 3 分钟
- **影响**：用户等待时间过长，且轮询 90 次给后端造成不必要压力
- **解决**：降到 60 次，添加错误处理，异常时提前终止

### 24. 缺少骨架屏

- **问题**：实验列表和详情页加载时无过渡效果
- **影响**：用户感知加载慢
- **解决**：新增 `ExperimentSkeleton` 和 `CardSkeleton` 组件

### 25. 缺少前端错误边界

- **问题**：组件渲染异常导致整个页面白屏
- **影响**：用户体验极差
- **解决**：新增 `ErrorBoundary` 和 `withErrorBoundary` HOC，支持重试/刷新

---

## 四、工程完善

### 26. macOS 资源 fork 文件污染

- **问题**：仓库存在 50+ 个 `._*` macOS 资源 fork 文件
- **影响**：仓库体积增大，构建时可能被误包含
- **解决**：删除所有 `._*` 文件，`.gitignore` 添加相应规则

### 27. 备份文件残留

- **问题**：根目录存在 `docker-compose.yml.bak`、`docker-compose.yml.bak2`、`fix_time_limits.sql` 等临时文件
- **影响**：仓库混乱，可能被误用作正式配置
- **解决**：全部删除

### 28. .gitignore 不完整

- **问题**：缺少对 `._*`、`*.bak2`、`nsjail/*.o`、`nsjail/nsjail` 编译产物的忽略规则
- **影响**：编译产物和临时文件可能被误提交
- **解决**：补全所有忽略规则

### 29. AI 服务缺少健康检查

- **问题**：AI 服务启动后不检查 LLM 配置有效性
- **影响**：运行中发现配置错误才报错，排查困难
- **解决**：启动时新增 `validate_llm_config()` 方法，提前校验

### 30. 种子数据弱密码

- **问题**：`05-seed.sql` 中初始账户密码安全性存疑
- **影响**：测试环境账户可能被利用
- **解决**：确认 admin 密码 hash 使用 bcrypt 加密

### 31. nsjail 编译产物管理

- **问题**：nsjail 源码目录中存在编译产物
- **影响**：仓库体积大，跨平台编译冲突
- **解决**：确认 `.gitignore` 排除编译产物

### 32. SQL 迁移编号管理

- **问题**：数据库迁移文件编号曾有跳跃和重复
- **影响**：迁移顺序不确定
- **解决**：最终保持编号连续：01-08 + 10-reports.sql

---

## 五、前端体验增强

| 模块 | 问题 | 解决方案 |
|------|------|---------|
| **API 客户端** | 无重试、无去重、无超时控制 | 完整重写：类型安全接口，自动重试（指数退避），请求去重，超时控制，Token 过期自动重定向 |
| **状态管理** | 缺少加载/错误状态 | 新增 `experimentLoading`、`experimentError`、`submissionsLoading`、`commentsLoading` 状态 |
| **错误边界** | 组件崩溃无兜底 | 新增 `ErrorBoundary` 组件 + `withErrorBoundary` HOC，统一错误 UI（重试/刷新按钮） |
| **骨架屏** | 加载白屏 | `ExperimentSkeleton`（实验加载）+ `CardSkeleton`（列表加载） |
| **编辑器** | Monaco 懒加载白屏 | 添加 loading 骨架屏 |

---

## 六、测试补强

| 测试文件 | 类型 | 覆盖范围 |
|---------|------|---------|
| `pipeline_integration_test.go` | Go 集成测试 | 策略权重验证、strace 解析（正常/错误/空行/30+ syscall）、输出规范化、实质性代码判断（10 场景）、Score 边界 |
| `scorer_test.go` | Go 单元测试 | 全通过/一半通过/零分无代码/零分有努力/空代码/空结果 |
| `test_prompt_sanitization.py` | Python 单元测试 | 代码注入检测（4 模式）、长代码截断、空值处理、markdown 转义、输出截断、Prompt 构建、Hints 构建、RAG 注入 |
| 内联验证 | 手动测试 | AI 服务所有 prompt builder 函数 |

---

## 七、常见问题预防

以下是开发过程中总结的容易踩坑的点，新成员开发时注意规避：

1. **安全类**：API Key 只用环境变量，绝对不写死在代码中；CORS 用白名单而非 `*`
2. **资源类**：所有 context 必须有超时，禁止使用 `context.Background()` 做 IO 操作
3. **并发类**：goroutine 必须 `defer recover()`；前端提交类操作必须加防重锁
4. **数据类**：缓存 key 必须考虑所有影响结果的变量；LLM Prompt 必须对用户输入做 sanitize
5. **配置类**：路径、连接串等一律用环境变量，不做硬编码
6. **工程类**：及时更新 `.gitignore`；删除临时/备份文件后再提交

---

**文档版本**: 1.0 | **最后更新**: 2026-06-20
