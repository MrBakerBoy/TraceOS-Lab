# 上线前最后一遍整改计划（Pre-Release Final Pass）

> 状态：**当前执行版**
> 定位：项目收尾，只处理会「影响线上正确性 / 稳定性」的小细节，不做架构级改动。
> 前提：Phase 0/1/2 已收敛（AI 不碰评分、诊断唯一入口 NATS、eBPF 闭环、提问单 Agent）。本计划只做收口。

---

## 0. 结论先行

盘点后确认：功能链路已通，但存在 **2 个上线阻塞项 + 1 个真实运行时 bug**，其余为可延后的类型债与工程整理。

| 级别 | 数量 | 是否阻塞上线 | 处理策略 |
|---|---|---|---|
| P0 上线阻塞 | 2 | 是 | 本次必须修 |
| P1 真实 bug | 1 | 是 | 本次必须修 |
| P2 前端类型债 | 60+ 条 | 否（`ignoreBuildErrors`） | 记录，不强修 |
| P3 工程整理 | 3 | 否 | 视时间收口 |

---

## 1. P0-1 宿主残留 uvicorn 进程抢 NATS durable consumer（致命）

### 现象
- 宿主机残留 `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`，PID `2154988`（Aug12 启动）。
- 与 docker 容器 `traceos-ai` 抢同一个 NATS durable consumer `ai-service`。
- 日志证据（`traceos-ai`）：

```
04:02:34 WARNING NATS connection failed: consumer is already bound to a subscription
...（重试约 40s）...
04:03:14 INFO NATS: subscribed to evaluation.completed
```

- 后果：AI 服务重启 / 容器重建时，诊断订阅会间歇性失败，`evaluation.completed` 事件漏消费，诊断链路断。

### 根因
开发期在宿主机直接 `uvicorn --reload` 跑了 AI 服务副本，之后未清理。`--reload` 还会 fork 出 reloader 子进程，进一步加剧 consumer 竞争。

### 修复
1. 杀掉宿主残留进程及其子进程：
   ```bash
   kill 2154988
   # 确认无残留
   ps aux | grep -E "uvicorn|main:app" | grep -v grep || echo "clean"
   ```
2. 确认没有 systemd / 脚本 / 容器 restart 策略会自动拉起它（当前无 systemd unit，纯手动残留）。
3. 验证容器内 AI 服务是唯一 consumer 订阅者：
   ```bash
   docker logs traceos-ai 2>&1 | grep "subscribed to evaluation.completed" | tail -3
   ```

### 验收
- 宿主机 `ps aux` 无 uvicorn 残留。
- `docker logs traceos-ai` 重启后一次到位 `subscribed to evaluation.completed`，无 `consumer is already bound` 重试。

---

## 2. P0-2 docker-compose.yml ai-service 生产配置含 dev 污染（致命）

### 现象
`docker-compose.yml` 的 `ai-service` 段：

```yaml
ai-service:
  image: traceos-lab-ai-service:final3
  command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload   # 生产不该 --reload
  volumes:
    - ./services/ai-service/app:/app/app:ro   # 开发源码挂载，生产不该挂
```

### 后果
1. `--reload` 让 uvicorn 起 reloader 子进程 → 双进程抢 durable consumer（与 P0-1 同源）。
2. 源码挂载意味着镜像 `final3` 里的代码被宿主机目录覆盖：**重建容器后跑的是宿主机源码，不是镜像快照**。宿主机目录一旦变动 / 缺失，线上行为不可控，违背「镜像即交付物」原则。

### 修复
生产段改为纯镜像运行，去掉 `--reload` 与源码挂载：

```yaml
ai-service:
  image: traceos-lab-ai-service:final3
  # 不再覆写 command，用镜像内置 CMD
  # 不再挂载 ./services/ai-service/app
  volumes:
    - ${HOME}/.cache/huggingface:/root/.cache/huggingface   # 仅保留模型缓存
```

> 保留 HF 模型缓存挂载（避免重下 2.5GB）；去掉源码挂载与 `--reload`。

### 前置依赖
- 必须先重新构建 `traceos-lab-ai-service` 镜像，把当前 `services/ai-service/app` 的最新代码打进镜像（否则去掉挂载后容器会跑旧代码）。
- 构建前确认 `python3 -m compileall -q app` 通过（已验证 EXIT=0）。

### 验收
- `docker-compose.yml` 中 `ai-service` 无 `--reload`、无源码挂载。
- `docker inspect traceos-lab-ai-service` 的 `Cmd` 不含 `--reload`。
- 重建后 `traceos-ai` 无 `consumer is already bound`。

---

## 3. P1 `AIAskButton` 调用不存在的 API 契约（真实 bug）

### 现象
`frontend/components/ebpf/shared/AIAskButton.tsx:34`：

```ts
const result = await api.aiChat({
  message: prompt,
  role: "student",
  context_type: "ebpf_trace",
  context_id: context.substring(0, 100),
});
```

而真实签名（`frontend/lib/api.ts:749`）：

```ts
aiChat: (experimentId: string, question: string, code: string, language: string, history?: unknown[]) =>
  request<{ reply: string; created_at: string }>(`/api/v1/experiments/${experimentId}/ai-chat`, {...})
```

- 调用方传「单个对象」，真实签名是「4-5 个位置参数」，完全错配。
- tsc 报 `Expected 4-5 arguments, but got 1`；返回体还读了不存在的 `result.content`。
- 该组件被 3 个 tab 真实使用：`SyscallAnalysisTab`、`ConcurrencyAnalysisTab`、`MemoryAnalysisTab`。

### 后果
用户点击 eBPF 面板的「问 AI」按钮 → 调用参数错误 → 后端收到 `undefined` 的 experimentId → 请求失败 / 404。这是一个真实的、用户可触达的功能失效。

### 修复方向（二选一，执行时确定）
- **方案 A（推荐，贴合「提问侧单 Agent」收敛）**：`AIAskButton` 改调提问侧通用 chat 接口（`/api/ai/chat`，即 `app/routers/chat.py`），在 `lib/api.ts` 或复用 `lib/stream-chat.ts` 补一个通用提问封装；组件 props 增加 `experimentId`（从父 tab 传入，或从 store 取）。
- **方案 B（最小改动）**：`AIAskButton` 改为正确的 `api.aiChat(experimentId, question, code, language)`，`question` 用 `prompt`，`code`/`language` 从父组件或 store 注入，返回体只读 `result.reply`。

> 执行时需确认父 tab 是否能拿到 `experimentId`（`ExperimentWorkspace` / store 里应有）。若拿不到，方案 A 更稳。

### 验收
- `npx tsc --noEmit` 中 `AIAskButton.tsx` 无报错。
- 点击「问 AI」能正常返回流式/非流式回答，不再报参数错误。

---

## 4. P2 前端类型债（60+ 条，不阻塞，记录）

`next.config.js` 已设 `typescript.ignoreBuildErrors: true`，`next build` 不会因此失败，故**不阻塞上线**。但暴露了依赖版本漂移，先记录、不强修（收尾阶段大动类型系统风险 > 收益）。

### 分类与信号

| 文件 | 错误 | 真实信号 |
|---|---|---|
| `components/ui/tooltip.tsx` | `asChild` / `delayDuration` 不存在 | `@radix-ui/react-tooltip` 类型版本漂移 |
| `components/layout/Sidebar.tsx` | lucide 图标组件当 `ReactNode` / `NavItem.icon` 类型 | React 19 升级后 lucide 类型不匹配 |
| `components/ui/SafeHtml.tsx` | `map` 属性缺 `Texture` | 全局类型污染（PIXI/three `Texture` 与 DOM `map` 冲突） |
| `components/ebpf/tabs/*`（Health/Memory/Resource/Syscall） | `RefObject<HTMLDivElement \| null>` vs `LegacyRef` | React 19 `useRef` 类型收窄 |
| `components/ebpf/tabs/ConcurrencyAnalysisTab.tsx` | `deadlock` 可能为 `null` | 空值守卫缺失 |
| `components/ebpf/tabs/SyscallAnalysisTab.tsx` | ECharts `OptionDataItem` vs `(string\|number)[]` | echarts 类型 |
| `components/panels/TierDeepAnalysis.tsx` | `undefined` 数组传给 `any[]` | 空值守卫缺失 |
| `components/ebpf/shared/DetectionSummaryCard.tsx` / `EmptyState.tsx` | `style`/`aria-hidden` 传给子组件 | 子组件 props 缺透传 |
| `app/.../courses/page.tsx` / `experiments/[id]/edit/page.tsx` | `Course[]` / `TestCase[]` 类型不一致 | 前后端字段 `undefined` 约束不一致 |

### 策略
- 本次**不修**（`ignoreBuildErrors` 已兜底，且前端容器 15h healthy，运行未受这些类型错误影响）。
- 若上线后用户反馈 tooltip / sidebar 图标渲染异常，再按上表逐条修复（优先 `tooltip.tsx` 与 `Sidebar.tsx`，因其可能反映真实运行隐患）。

---

## 5. P3 工程整理（不阻塞）

### 5.1 git 状态
- 当前 `master` 有 **150 个未提交改动 + 约 25 个未跟踪文件**（含核心整改的全部成果）。
- 建议：上线前做一次干净的提交，把 Phase 0/1/2 成果固化，避免「能跑但 git 里没有」的失控状态。
- 未跟踪文件需人工确认去留：
  - 保留：`services/ai-service/app/agents/teaching_assistant.py`、`app/diagnosis/agents/resource_analyzer.py`、`services/core-service/internal/evaluator/ebpf_metrics.go`、`services/ai-service/app/services/rag/rag_chain.py`、`frontend/lib/knowledge-*.ts`、`frontend/components/rag/`、`frontend/components/workspace/evaluation/`、`deploy/init-db/2[5-7]-*.sql`。
  - 待定：`e2e_test_round.sh`、`rebuild-frontend.sh`（临时脚本，可进 `scripts/` 或删除）、`.cursor/`（编辑器缓存，应 `.gitignore`）。

### 5.2 docs/plan 目录
- 现有 20 个计划文档，多为历史演进稿。建议归档到一个 `docs/plan/archive/` 子目录，只保留「生效版」在顶层（`ai-diagnosis-refactor-plan.md` + 本计划）。

### 5.3 `.gitignore`
- 确认 `.cursor/` 已忽略（当前被 git 视为未跟踪）。

---

## 5.5 镜像构建链路现状（重要补充，P0 级）

盘点「重建容器上线」时发现：**当前运行环境是 dev 模式**（`docker-compose.dev.yml` 叠加，源码挂载 + 热加载），而生产镜像（纯镜像模式）的构建链路存在断裂，直接 `docker build` 会失败。

### 5.5.1 现状

| 镜像 | tag | 构建链路 | 问题 |
|---|---|---|---|
| AI | `traceos-lab-ai-service:final3` | `services/ai-service/Dockerfile` | **`requirements.txt` 与 `wheels/` 目录已丢失**（宿主与容器内均无），`COPY requirements.txt` / `COPY wheels/` / `pip install ./wheels/torch-*.whl` 全部失败，无法从零重建 |
| Core | `traceos-lab-core-service:latest` | `services/core-service/Dockerfile` | `services/core-service/nsjail` 是 **0 字节空文件**，`COPY nsjail /usr/local/bin/nsjail` 会把空文件打进镜像；`go mod download` 需外网 GOPROXY |
| Frontend | `traceos-lab-frontend:latest` | `frontend/Dockerfile` | 正常（`package-lock.json` + `node_modules` 在，`npm run build` 可行） |

### 5.5.2 AI 镜像修复方案（推荐：基于 final3 增量，避免重装 torch）

AI 服务收敛后，`torch` / `sentence-transformers` 已降级为**懒加载可选后端**（`embedding_service.py` / `reranker.py` 内 try/except），生产默认走 external embedding API，兜底 TF-IDF 纯 Python 实现。因此 torch 不再是硬依赖。

但为「零风险、不降级 RAG 本地 embedding」，推荐**基于现有 final3 镜像（依赖完整）做增量构建**，只覆盖最新代码：

```dockerfile
FROM traceos-lab-ai-service:final3
RUN rm -rf /app/app
COPY app/ /app/app/
```

- 优点：保留 final3 里完整的 torch 依赖，构建快（分钟级），不破坏 RAG 本地 embedding。
- 缺点：依赖 final3 作为 base（不可删）；`rm -rf /app/app` 会清掉旧代码残留，避免「新代码 + 旧文件」import 冲突。
- 长期：需恢复 `requirements.txt` + torch CPU wheels，才能支持从零重建。

### 5.5.3 Core 镜像修复要点

- `services/core-service/nsjail` 空文件需替换为真实编译产物，或用挂载方式注入。
- 当前 dev 模式 core 跑 `golang:1.22-alpine` + 热加载，沙箱 `SANDBOX_MODE=local`，未依赖镜像内 nsjail，故 dev 评测通过；生产镜像需单独补 nsjail 二进制。

### 5.5.4 上线方式（待确认）

| 方案 | 做法 | 风险 | 耗时 |
|---|---|---|---|
| **A. 纯镜像生产** | 修复 3 个构建链路 → `docker build` → `docker compose -f docker-compose.yml --profile app up -d` | 低（镜像自包含） | 中（需补 AI/Core 构建） |
| **B. 半生产（保留源码挂载）** | 仅去 `--reload`、去 NATS consumer 冲突，保留源码挂载 | 中（代码依赖宿主机目录） | 低（分钟级） |
| **C. 维持 dev 重启** | 仅重启 dev 容器让最新代码生效 | 高（非生产形态） | 低 |

> 推荐 **A**：AI 用「FROM final3 增量」、Frontend 正常重建、Core 补 nsjail 后重建。这与「镜像即交付物」原则一致。

---

## 6. 上线前验证清单（重建容器后逐条过）

1. **进程**：宿主机无 `uvicorn` 残留。
2. **compose**：`ai-service` 无 `--reload`、无源码挂载。
3. **构建**：
   - `cd services/core-service && GOPROXY=off go build ./...` EXIT=0。
   - `cd services/ai-service && python3 -m compileall -q app` EXIT=0。
   - `cd frontend && npm run build` 成功（`ignoreBuildErrors` 下）。
4. **镜像重建**：
   - 重建 `traceos-lab-ai-service`（含最新 AI 代码）。
   - 重建 `traceos-lab-core-service`（含最新 Go 代码）。
   - 重建 `traceos-lab-frontend`（含最新前端代码）。
5. **容器重启**：`docker compose --profile app up -d --build`。
6. **NATS 订阅**：`docker logs traceos-ai` 一次到位 `subscribed to evaluation.completed`，无 `consumer is already bound`。
7. **端到端**：跑 `e2e_test_round.sh`，确认 golden score=100、诊断正常产出、AI 消费事件并携带 `ebpf_metrics`。
8. **前端功能**：eBPF 面板「问 AI」按钮正常返回。

---

## 7. 回滚预案

- 保留当前可用的旧镜像 tag：`traceos-lab-ai-service:final3`（重建前先 `docker tag` 备份为 `final3.bak`）。
- 若重建后 AI 诊断异常：`docker tag traceos-lab-ai-service:final3.bak traceos-lab-ai-service:final3` 回退镜像，或恢复源码挂载临时续命。
- 宿主 uvicorn 残留已 kill 后**不再手动拉起**；如需本地调试 AI，用独立端口且禁用 NATS 订阅（避免 consumer 竞争）。

---

## 8. 执行顺序（本轮）

1. P0-1：kill 宿主 uvicorn 残留。
2. P0-2：改 `docker-compose.yml` ai-service 生产化（去 `--reload` + 去源码挂载）。
3. P1：修 `AIAskButton` API 契约（先确认父组件能否拿 `experimentId`）。
4. P3：视情况 git 提交 + 归档 docs/plan（待用户确认是否提交）。
5. 重建镜像 + 重建容器 + 跑验证清单。