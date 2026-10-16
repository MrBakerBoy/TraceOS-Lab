# TraceOS AI 提问板块升级方案：基于 Harness 工程的多 Agent 对话系统

> **定位**：将当前简单调 API 的 AI 问答模块，全面升级为**生产级多 Agent 客服对话系统**，对标 Anthropic / Stripe / OpenAI 的 Harness 工程实践。
>
> **核心公式**：Agent = Model + Harness — 决定 Agent 上限的不是模型权重，而是包裹在模型外面的那层工程系统。
>
> **设计范式**：ETCLOVG 七层架构 + Supervisor Blueprint（混合状态机） + Ratchet 持续积累 + LLM-as-Judge 校准

---

## 行业最佳实践参考

本方案系统性地吸收了 2025-2026 年 AI Engineering 领域的核心实践模式，确保 TraceOS 对话 Harness 达到生产级标准。

### Supervisor Blueprint 混合状态机 (Stripe Minions)

Stripe Minions 团队在大规模 Agent 部署中提炼出的核心编排模式——将 Agent 编排拆分为两种性质截然不同的节点：

- **确定性节点 (Deterministic Nodes)**：执行为固定逻辑，无 LLM 参与。包括：意图置信度检查（confidence > 0.7）、工具调用次数计数（单轮 > 5 次截断）、熔断判断（同类工具连续 3 次失败禁用）、Token 水位线监控。这些是 Agent **无法穿越**的墙——不是 Prompt 里的"建议"，而是代码层的 if/else 硬逻辑
- **Agentic 节点 (Agentic Nodes)**：调用 LLM 进行推理和生成。包括：意图理解、RAG 检索策略制定、诊断推理、教学回复生成。这些是需要语义理解和创造力的环节

**混合状态机的核心优势**：确定性 Gate 为 Agent 提供了不可绕过的安全边界，而 Agentic 节点保证了 LLM 在需要发挥推理能力的环节不被过度约束。两者之间的"接口"是结构化的状态传递——确定性节点产出布尔判定和计数，Agentic 节点产出文本和结构化决策。

### Context Firewall 模式

每个子 Agent 获得独立的、最小化的上下文窗口——而不是把所有 Agent 的 Prompt + 工具列表 + 全部上下文一次性注入 Supervisor。这是防止 Context Anxiety 的关键工程手段：

- **反模式**：将全部子 Agent 的 System Prompt + 工具定义 + 上下文全部加载到 Supervisor 的上下文中 —— 这会在请求尚未到达专用 Agent 之前就吃掉 40%+ 的上下文预算
- **正确做法**：Supervisor 仅持有路由信息（~2K tokens），每个子 Agent 独立接收其领域专用数据。各 Agent 的上下文预算如下：

| Agent | 上下文预算 | 内容 |
|-------|-----------|------|
| **Supervisor** | ~2K tokens | 系统 Prompt + 当前消息 + 最近 3 轮摘要 + 学生画像缩略 |
| **RAG Agent** | ~1K tokens + 检索结果 | 改写 Query + 检索参数 + 前次检索摘要 |
| **Diagnosis Agent** | ~3K tokens | 实验信息 + 提交 ID + 测试结果摘要 + strace 摘要 + 相关错误模式 |
| **Code Reviewer** | ~2K tokens | student_code + AST 注解 + 模式检测结果 |
| **Knowledge Tutor** | ~3K tokens | RAG Top-K 结果 + 学生画像 + L1-L3 提示策略 + 已给出提示级别 |

### 四级 Token 水位线策略

这是 TraceOS 上下文管理系统的核心工程组件。四级水位线按照成本和效果递进设计——零成本纯代码操作优先，必要时才调用 LLM 做结构化压缩：

| 水位线 | 名称 | 触发动作 | 成本 | LLM 调用 |
|--------|------|---------|------|---------|
| **30%** | Micro (微压缩) | 工具输出截断：仅保留最近 3 轮完整工具返回；更早的结果替换为 1 行摘要（`[调用 run_tests → 通过 8/10]`）；不修改用户消息和模型推理；保留所有诊断结论和错误模式 | 零（纯代码遍历） | 无 |
| **60%** | Slide (滑动裁剪) | 基于价值而非时间的裁剪策略：标记关键轮次（用户提问、诊断结论、错误发现）；非关键轮次仅保留 1 行摘要；关键轮次保留完整原文；实验信息、诊断结果永不硬删除 | 零（纯代码遍历） | 无 |
| **80%** | Summary (结构化摘要) | 调用轻量 LLM 对历史对话进行结构化压缩：用户意图、主要请求、技术概念、关键结论、已排除假设、当前状态、待办任务。压缩比 10:1 ~ 20:1。压缩结果缓存到 chat_conversations.l3_summary | 低成本 | 轻量模型 |
| **95%** | Emergency (紧急降级) | 最激进的压缩策略：仅保留用户目标 + 当前状态，其余全部替换为 L3 Summary；阻止所有非必要工具调用；主动提示用户开始新会话 | 中等成本 | 标准模型 |

**关键设计原则**：
- 30% 和 60% 级是零 LLM 成本的纯代码操作——工具输出的摘要替换和对话轮次的价值裁剪都是确定性逻辑
- 仅在 80% 和 95% 级才引入 LLM 调用，且使用轻量模型以控制成本
- 关键轮次（用户提问、诊断结论）永不做硬删除——这是"不丢信息"的底线

### 成本级联：确定性优先

这是 Stripe Minions "Don't burn tokens on what code can do" 原则在安全与过滤领域的直接应用：

```
请求进入
    │
    ▼
┌─────────────────────────────────────┐
│ 确定性检查 (Deterministic Checks)   │
│ • 正则 / JSON Schema / 规则引擎     │
│ • 用途: PII检测 / 格式校验 / 注入   │
│   模式匹配                          │
│ • 成本: 近乎零                      │
│ • 延迟: < 1ms                       │
│   → "不要用 LLM 做正则能做的事"     │
└────────┬────────────────────────────┘
         │ 通过
         ▼
┌─────────────────────────────────────┐
│ 分类器检查 (Classifier Checks)      │
│ • 微调模型 / 嵌入距离               │
│ • 用途: 毒性检测 / 越界请求识别     │
│ • 成本: 极低                        │
│ • 延迟: ~10ms                       │
│   → 比 LLM 便宜 1000x，速度快 100x  │
└────────┬────────────────────────────┘
         │ 通过
         ▼
┌─────────────────────────────────────┐
│ LLM Judge (仅边界/模糊情况)         │
│ • 标准模型调用                      │
│ • 用途: 内容质量评估 / 安全边界模糊 │
│   时的最终仲裁                      │
│ • 成本: 中等                        │
│ • 延迟: ~1-3s                       │
│   → "LLM 是最后一道防线，不是第一道"│
└─────────────────────────────────────┘
```

**工程原则**：每一层只处理上一层无法确定判断的请求。绝大多数请求在确定性检查层即可完成过滤（正则匹配 PII 模式、JSON Schema 校验输出格式），不会触发 LLM Judge 的调用。

### MCP + Skill 系统

| 概念 | 类比 | 作用 |
|------|------|------|
| **MCP** | USB 接口 | 统一工具连接标准——任何 MCP Server 的工具自动发现并注册到 ToolRegistry，无需手写适配代码 |
| **Skill** | 菜谱/Recipe Book | 告诉 Agent："遇到 X → 按 Y 步骤 → 用 Z 工具 → 输出 W 格式"。Skill 确保 Agent 在特定场景下的行为一致性和质量 |
| **Tool** | 厨具 | 具体的可调用函数——Skill 编排 Tool 的调用顺序和参数选择 |

**Skill 管理原则**：
- 每个 Skill 有版本号，可追溯到触发它创建的失败事件（Ratchet 原则）
- 追踪 Skill 触发率：长期未被触发的 Skill（如 6 个月零触发）标记为待废弃——模型能力可能已经覆盖了该场景
- Skill 的 `evaluation_criteria` 包含可被 Evaluator 验证的二元指标（如"是否检查了 Coffman 条件"）

---

## 一、Harness 工程定位

### 1.1 这个方案解决什么问题

当前 AI 问答模块的核心矛盾不是"模型不够强"，而是**模型外面没有一套可靠的工程系统**——对话刷新即丢、上下文无条件膨胀、工具调用没有兜底、输出质量无法评估。这套工程系统就叫 Harness。

**关键洞察**（来自业界实践）：
- 仅改变 Harness（系统 Prompt 重构 + 中间件上下文注入 + 自校验 Hook），不动模型权重 → Terminal-Bench 2.0 **+13.7pp**（52.8% → 66.5%）
- 一个中等模型配上优秀的 Harness，常常胜过优秀模型配上糟糕的 Harness
- **Harness 不会缩小——它会迁移**：模型升级后，旧的脚手架可能不再需要，但新的能力边界会暴露新的失败模式

### 1.2 五个基石原则

| 原则 | 来源 | 含义 | 在本方案中的体现 |
|------|------|------|-----------------|
| **Ratchet 原则** | Mitchell Hashimoto | 每次失败→永久规则/检查。约束只在真实失败后加，不做预判。Harness 只会收紧，不会放松。 | 错误模式随时间自动积累到 ErrorKB；每个 Guardrail 规则可追溯到具体失败事件 |
| **机械执行 > Prompt 指令** | OpenAI Codex / Stripe | Lint 规则 = Agent 穿不过的墙；Prompt 一句话 = 可能被遗忘的请求 | 输出格式用 JSON Schema 校验（非 Prompt 描述）；安全规则用代码过滤（非 Prompt 约束） |
| **生成与评估分离** | Anthropic | Agent 系统高估自己——必须用独立的 Evaluator | LLM-as-Judge 独立评分；Generator 看不到 Judge 的上下文 |
| **混合状态机** | Stripe Minions | 确定性的归确定性（代码执行），不确定的归 LLM | 工具调用重试/熔断 = 确定性 Gate 节点；对话生成 = Agentic 节点 |
| **Bitter Lesson** | Richard Sutton / Anthropic | 过度工程化的控制流在模型升级时会断裂。构建能让你丢弃昨天"聪明"逻辑的 Harness。 | 每个 Harness 组件标注来源和场景；定期审计移除过时约束 |

---

## 二、现状分析：ETCLOVG 差距矩阵

### 2.1 现有资产盘点

| ETCLOVG 层 | 现有实现 | 文件位置 | 成熟度 |
|-------------|---------|---------|--------|
| **L - 生命周期** | LangGraph 多节点图 (classify→retrieve→route) | `services/ai-service/app/agents/graph.py` | 🟡 基础编排（**未被任何路由调用**，见 2.3） |
| **L - 生命周期** | Orchestrator 4 类意图分类（intent + confidence + extracted_info，error 时 fallback general_chat conf=0.3） | `services/ai-service/app/agents/orchestrator.py` | ✅ |
| **C - 上下文** | Query Rewrite + 混合检索(BM25+Vector) + Re-rank + Reflection | `services/ai-service/app/agents/rag_agent.py` + `services/rag/hybrid_retriever.py` | ✅ 成熟 |
| **C - 上下文** | StudentMemory 学生画像持久化（`student_profiles` 表；L0-L3 仅注释级定义，无 L2 决策/知识/错误模式表） | `services/ai-service/app/agents/memory.py` | 🟡 基础 |
| **C - 上下文** | 7 层 AgentContext 动态组装 + should_use_tools 门控 | `services/ai-service/app/agents/context_builder.py` | ✅ |
| **T - 工具** | 8 个 ToolDef（run_code, run_tests, get_strace, search_knowledge, find_similar_errors, analyze_code_patterns, get_student_profile, get_experiment_info） | `services/ai-service/app/agents/tools.py` | ✅ |
| **L - 生命周期** | DiagnosisTutor 联合诊断+苏格拉底教学 | `services/ai-service/app/agents/diagnosis_tutor.py` | ✅ |
| **T - 工具** | 多 Provider LLM 适配（chat_completion / chat_completion_with_messages） | `services/ai-service/app/services/llm_client.py` | ✅ |
| **V - 验证** | Chat Router 兼容 ask/chat 双格式，含 RAG 注入 + context_builder 注入，但**直连 llm_provider 绕过 agent graph** | `services/ai-service/app/routers/chat.py` | 🟡 断路 |

### 2.2 关键差距（按严重度排序）

| 差距 | ETCLOVG 层 | 严重度 | 为什么致命 |
|------|-----------|--------|-----------|
| **前端未接入 Agent 系统**：`frontend/app/(dashboard)/rag/page.tsx` → `ragApi.ask()` → `POST /api/chat` → `chat.py` 直连 `llm_provider`；`run_agent_pipeline`/`create_agent_graph` 未被任何路由 import | L - 生命周期 | 🔴 致命 | 已建好的图编排完全断路，意图分类与专用 Agent 失效 |
| **无多会话管理**：chatHistory 在 React state 刷新即丢；且 `chat.py:92` 引用的 `conversations` 表在 `deploy/init-db/` 中不存在（被 try/except 静默吞掉） | C - 上下文 | 🔴 致命 | 用户丢失全量历史；conversation_id 路径永远走 fallback |
| **无上下文压缩**：长对话无条件膨胀导致 Context Anxiety | C - 上下文 | 🔴 致命 | 超过 ~40% 利用率后输出质量急剧下降 |
| **无评估观测**：无 Tracing / 无质量评估 / 无法定位故障 | O - 可观测 | 🔴 致命 | 你不知道系统在什么时候做什么失败了 |
| **无约束恢复**：无 Guardrails / 无重试 / 无熔断 | G - 治理 | 🔴 致命 | 一次工具失败或恶意输入可以瘫痪整个对话 |
| **L2 长期记忆不完整**：仅学生画像，缺决策/知识/错误模式 | C - 上下文 | 🟡 重要 | Agent 在多轮对话中"失忆" |
| **无 MCP 协议支持**：工具扩展需手写代码 | T - 工具 | 🟡 重要 | 工具生态无法规模化接入 |
| **无 Skill/SOP 体系**：模型每次"自由发挥" | L - 生命周期 | 🟢 增强 | 诊断/教学一致性无法保证 |

### 2.3 现状代码核查（2026-08-08）

> 对照远程仓库 `root@120.26.249.117:/root/traceos-lab` 实际代码核查，校准本方案落地起点。

| 核查项 | 文档/预期 | 实际代码 | 结论 |
|--------|----------|---------|------|
| Agent graph 是否被调用 | 期望前端经 Agent 编排 | `grep -rn run_agent_pipeline app/routers/` 无命中；仅 `graph.py:256` 自引用 | ❌ 图编排已建但断路 |
| Chat 路由调用链 | chat.py → agent pipeline | `chat.py:152` 直连 `llm_provider.chat_completion_with_messages`，未经 orchestrator | ❌ 绕过编排 |
| `conversations` 表 | §8.1 拟建 | `deploy/init-db/` 无该表；`chat.py:92` SELECT 被外层 try/except 吞掉 | ❌ 表不存在，路径静默失败 |
| `long_term_memories` 表 | §8.1 拟建 | 不存在 | ❌ 待建 |
| `student_profiles` 表 | memory.py 读写依赖 | `memory.py:47` `SELECT ... FROM student_profiles` 可用 | ✅ 已在用 |
| `memory_layouts` 表 | 文档未提 | `12-memory-layout.sql` 是 OS 内存布局采集（text/data/bss/heap/stack），非 AI 记忆 | ⚠️ 命名易混淆，勿当 AI 记忆层 |
| 工具数量 | 8 个 | `tools.py._register_defaults` 注册 8 个 ToolDef | ✅ 一致 |
| 意图分类 | 4 类 + confidence | `orchestrator.py.Intent` 四类齐全 | ✅ 一致 |
| Router 置信度门控 | 期望 confidence 阈值 Gate | `route_by_intent` 纯字符串分发，无 confidence 判断 | 🟡 缺确定性 Gate |
| RAG 双路 | BM25+Vector | `chat._get_rag_context` 先 `hybrid_retriever` 再 fallback `retrieval_service` | ✅ 一致 |
| 前端入口 | 期望 `/agent` 路由 | 仅 `frontend/app/(dashboard)/rag/page.tsx` 调 `ragApi.ask(courseId, q)` | 🟡 仅有 rag 路由 |

**落地结论**：必须先做 Phase 0「接线」——让 `chat.py` 或新建 `routers/conversations.py` 调用 `run_agent_pipeline`，并补建 `chat_conversations`/`chat_messages` 基础表；否则后续 Agent 能力（记忆/压缩/Guardrails/评估）均无附着点。

---

## 三、ETCLOVG 七层架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                   TraceOS Agent Harness (ETCLOVG)                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  G 治理层 (Governance) —— "错了能兜底"                               │
│  ├─ 成本级联防线: 确定性检查(正则,<1ms) → 分类器(嵌入距离,~10ms)    │
│  │   → LLM Judge(仅边界情况,~1-3s)                                   │
│  ├─ 输入护栏: PII 检测(正则+Presidio) / Prompt 注入检测 / 越界请求   │
│  ├─ 输出护栏: 幻觉检测 / 违规内容过滤 / 格式校验（JSON Schema）      │
│  ├─ 工具重试 + Fallback: 最多 3 次重试 → 失败降级 → 熔断             │
│  ├─ 循环控制: max_iterations=15 + circuit_breaker                    │
│  ├─ Human-in-the-Loop: 关键操作人工审核                              │
│  └─ AGENTS.md Ratchet: 每个 Guardrail 规则可追溯到具体失败事件        │
│                                                                      │
│  V 校验层 (Verification) —— "知道做没做对"                           │
│  ├─ LLM-as-Judge: 响应质量自动评分（校准后 κ ≥ 0.80）                │
│  ├─ G-EVAL CoT 四部分 Judge Prompt: ①词汇定义 ②推理结构             │
│  │   ③确定性评分规则(3点量表) ④边界处理                              │
│  ├─ 五阶段校验: 基准 → 执行就绪 → 轨迹采集 → 多级评判 → 回归优化    │
│  ├─ 质量回归检测: 上线前 freeze 评估集 → 换 Prompt 后重跑            │
│  └─ Judge 校准漂移监控: 每季度 + 每次换 Judge 模型后重校             │
│                                                                      │
│  O 可观测层 (Observability) —— "每一步都可追踪"                      │
│  ├─ OpenTelemetry: 每个 LLM/Tool/Agent Span 全链路追踪               │
│  ├─ Langfuse Dashboard: 执行可视化 + Token 成本归因                  │
│  ├─ 质量监控: 准确率 / 满意度 / 幻觉率 / 工具成功率                  │
│  └─ 异常告警: 错误率飙升 / 延迟恶化 / 成本异常                       │
│                                                                      │
│  L 生命周期层 (Lifecycle) —— "做得对"                                │
│  ├─ Supervisor Blueprint: 混合状态机（确定性 Gate + Agentic 节点）   │
│  ├─ 确定性 Gate: Router Gate / Tool Layer Gate / Guardrail Gate      │
│  │   / Output Gate — Agent 无法穿越的代码级硬逻辑                    │
│  ├─ Agentic 节点: RAG / Diagnosis / CodeReview / Tutor / Chat        │
│  ├─ LangGraph StateGraph: 条件路由 + 循环 + Checkpoint               │
│  ├─ Context Firewall: 每个子 Agent 独立上下文窗口（~1K~3K tokens）   │
│  └─ Skill Registry: SOP 标准操作流程（遇到 X → 按 Y 步骤 → 用 Z 工具）│
│                                                                      │
│  C 上下文层 (Context) —— "看得准"                                    │
│  ├─ ContextAssembler: 7 层动态上下文 + 渐进式披露                    │
│  ├─ RAG Agent: Agentic RAG 循环（改写→检索→重排→自省→不够再搜）      │
│  ├─ 四级 Token 水位线: 30%(Micro)→60%(Slide)→80%(Summary)→95%(Emerg)│
│  ├─ 上下文预算硬约束: 每个 Agent < 40% 窗口利用率                    │
│  ├─ 记忆系统: L0(工作) → L1(短期,PG) → L2(长期,pgvector)            │
│  └─ 实验上下文快照: experiment/submission/diagnosis                  │
│                                                                      │
│  T 工具层 (Tooling)                                                  │
│  ├─ 8 个内置 Tool + Tool Sandbox (执行隔离 + 超时控制)               │
│  ├─ MCP Client: 动态发现 + 自动注册外部 MCP Server 工具              │
│  ├─ Skill Registry: 告知 Agent 何时用哪个工具 + 怎么用                │
│  └─ 工具返回精炼: 保留头部+尾部 → 中间替换为结构化摘要               │
│                                                                      │
│  E 执行层 (Execution)                                                 │
│  ├─ Python AI Service: Agent 编排 + LLM 调用 + 流式输出              │
│  ├─ Go Core Service: 代码执行 + 数据采集（通过 NATS 通信）           │
│  └─ PostgreSQL + pgvector: 会话、消息、长期记忆、知识库              │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 为什么是七层而不是六层

ETCLOVG 框架将 **Observability** 和 **Governance** 提升为独立的一级架构层，而非从属于其他层。理由是：

- **Observability** 拥有独立的工具生态（Langfuse、Arize Phoenix、OpenLLMetry）和独特的工程实践，不是"日志"那么简单
- **Governance** 跨越三个子层级——模型级（Guardrails、内容过滤）、系统级（网关、Agent、权限模型）和组织级（审计、合规、人工监督）——通常由不同的团队负责

---

## 四、多 Agent 架构：Supervisor Blueprint（混合状态机）

### 4.1 为什么用混合状态机

借鉴 **Stripe Minions** 的 Blueprint 模式——将编排拆分为两种节点：

- **确定性节点（Deterministic Gate）**：执行为固定逻辑，无 LLM 参与。例如：意图分类的置信度检查、工具调用次数计数、熔断判断、Token 水位线监控。这些是 Agent **无法跳过**的墙——不是 Prompt 里的"建议"，而是代码层的 if/else 硬逻辑。
- **Agentic 节点（Agentic Node）**：调用 LLM 进行推理和生成。例如：意图理解、RAG 检索策略、诊断推理、教学回复。

```
                          ┌──────────────┐
                          │   用户输入    │
                          └──────┬───────┘
                                 │
                    ┌────────────▼────────────┐
                    │  [确定性] Gateway        │  ← G 层
                    │  PII / 注入 / 越界检测   │
                    │  (正则+分类器, 非LLM)    │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  [Agentic] Supervisor   │  ← L 层
                    │  意图识别 + 任务拆解     │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  [确定性] Router Gate    │  ← L 层
                    │  intent_confidence > 0.7?│
                    │  工具调用计数 < 5?       │
                    └──┬─────────┬───────────┘
                       │ YES     │ NO
                       ▼         ▼
              ┌──────────┐  ┌──────────────┐
              │ [Agentic]│  │ [确定性]      │
              │ 专用     │  │ 升级人工      │
              │ Agent    │  │ / 降级通用    │
              └────┬─────┘  │ Chat          │
                   │        └──────────────┘
    ┌──────────────┼──────────────┬──────────────┐
    ▼              ▼              ▼              ▼
┌───────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐
│RAG    │  │Diagnosis│  │Code      │  │Knowledge │
│Agent  │  │Agent    │  │Reviewer  │  │Tutor     │
│[Agent]│  │[Agent]  │  │[Agent]   │  │[Agent]   │
└──┬────┘  └────┬────┘  └────┬─────┘  └────┬─────┘
   │            │             │             │
   └────────────┼─────────────┼─────────────┘
                │             │
         ┌──────▼─────────────▼─────────────▼──────┐
         │  [确定性] Tool Layer Gate                │  ← T 层
         │  工具调用计数 / 参数校验 / 超时控制       │
         │  ┌────────────────────────────────────┐  │
         │  │ [Agentic] Tool 执行（含 LLM 决策）  │  │
         │  └────────────────────────────────────┘  │
         └──────────────────┬──────────────────────┘
                            │
         ┌──────────────────▼──────────────────────┐
         │  [确定性] Guardrail Gate                 │  ← G 层
         │  max_iterations < 15? / circuit_breaker? │
         │  Token 水位线 < 95%?                     │
         │  ┌────────────────────────────────────┐  │
         │  │ [Agentic] 失败恢复 / LLM 反思      │  │
         │  └────────────────────────────────────┘  │
         └──────────────────┬──────────────────────┘
                            │
         ┌──────────────────▼──────────────────────┐
         │  [确定性] Output Gate                    │  ← G+V 层
         │  JSON Schema / 幻觉检测 / 格式校验       │
         │  (成本级联: 正则→分类器→LLM Judge)       │
         └──────────────────┬──────────────────────┘
                            │
                    ┌───────▼───────┐
                    │   用户回复     │
                    └───────────────┘
```

### 4.2 Agent 角色定义

| Agent | 角色类比 | 何时调用 | 上下文（Context Firewall） | 模型策略 |
|-------|---------|---------|--------------------------|---------|
| **Supervisor** | 总控调度 | 每次请求 | 用户输入 + 系统 Prompt + 意图定义 | 标准模型 |
| **Router** | 意图网关 | Supervisor 后 | intent + confidence + 历史意图 | 轻量模型 |
| **Planner** | 任务规划 | 复杂任务（> 3 步）时 | full_task + agent_capabilities + 依赖图 | 标准模型 |
| **Context Mgr** | 上下文管家 | 每轮对话 | Token 计数器 + 水位线阈值 + 压缩策略 | 代码逻辑 |
| **RAG Agent** | 知识检索专家 | knowledge_qa / 需要文档时 | query + rewrite_history + top_k | 轻量模型摘要 + 嵌入模型检索 |
| **Diagnosis Agent** | 诊断分析师 | diagnosis 意图 | 提交信息 + strace 摘要 + 测试结果 + 错误日志 | 标准模型 |
| **Code Reviewer** | 代码审查员 | code_related 意图 | student_code + AST 注解 + 模式检测结果 | 标准模型 |
| **Knowledge Tutor** | 苏格拉底导师 | knowledge_qa / 教学意图 | RAG 结果 + 学生画像 + 错误历史 + L1-L3 提示策略 | 标准模型 |
| **General Chat** | 通用对话 | 闲聊 / 平台引导 | 用户消息 + 基本上下文 | 轻量模型 |

### 4.3 Context Firewall 模式

**核心理念**：每个子 Agent 不是看到"整个世界的全部信息"，而是只看到"它需要的那一小部分"。借鉴 Anthropic 的 Sub-Agent 实践——每个 Agent 拥有独立的、最小化的上下文窗口。

```
Supervisor 上下文（~2K tokens）:
  ├─ 系统 Prompt: 你是谁、能做什么、不能做什么
  ├─ 当前用户消息
  ├─ 最近 3 轮对话摘要（非原文）
  └─ 学生画像缩略（薄弱知识点 + 偏好 hint 级别）

RAG Agent 上下文（~1K tokens + 检索结果）:
  ├─ 改写后的 Query
  ├─ 检索策略参数 (top_k, 来源过滤)
  └─ 前次检索结果摘要（如有 Agentic RAG 循环）

Diagnosis Agent 上下文（~3K tokens）:
  ├─ 实验信息 + 提交 ID
  ├─ 测试结果摘要 + strace 摘要
  └─ 相关错误模式（来自 ErrorKB）

Code Reviewer 上下文（~2K tokens）:
  ├─ student_code + AST 注解
  └─ 模式检测结果

Knowledge Tutor 上下文（~3K tokens）:
  ├─ RAG 检索结果（Top-K 文档片段）
  ├─ 学生画像（薄弱知识点 + 学习进度）
  ├─ L1-L3 渐进提示策略
  └─ 本次对话中已给出的提示级别
```

**反模式警告**：❌ 把所有 Agent 的 Prompt + 工具列表 + 全部上下文一次注入 Supervisor。这会吃掉上下文窗口的 40%+ 预算，导致 Context Anxiety——在请求尚未到达专用 Agent 之前，Supervisor 的上下文已经膨胀到影响输出质量的程度。

---

## 五、记忆系统：L0-L2 三层 + Ratchet 积累

### 5.1 三层记忆架构

参考 Letta (MemGPT) OS 式虚拟内存 + Mem0 结构化记忆 + Mitchell Hashimoto 的 Ratchet 积累：

```
┌──────────────────────────────────────────────────────────┐
│                   记忆系统三层架构                        │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  L0 工作记忆 (Working Memory)                            │
│  • 容量：当前上下文窗口 (~8K-32K tokens)                  │
│  • 内容：最近 N 轮完整对话 + 系统 Prompt + 工具返回       │
│  • 管理：Token 水位线监控 → 超阈值触发压缩               │
│  • 存储：内存（不持久化）                                 │
│  • 关键约束: 利用率 < 40% → 保持原样；40%-60% → L1 微压缩│
│                                                          │
│  ⬇ 压缩/降级 ⬇                                          │
│                                                          │
│  L1 短期记忆 (Session Memory)                            │
│  • 容量：当前会话全量消息（完整保存）                      │
│  • 内容：所有轮次原文 + 工具调用 + 中间结果               │
│  • 功能：会话内滚动加载、上下文压缩时回溯原文              │
│  • 存储：PostgreSQL chat_messages 表                     │
│                                                          │
│  ⬇ 退出会话/定时提取 ⬇                                  │
│                                                          │
│  L2 长期记忆 (Long-term Memory)                          │
│  • 类型：                                                 │
│    ├─ 用户画像：薄弱知识点、学习风格、偏好 hint 级别      │
│    ├─ 关键决策：已确认的约束、方案、排除的假设            │
│    ├─ 知识片段：学生在对话中获得的重要认知                 │
│    ├─ 错误模式：常犯错误 + 对应解决方案                   │
│    └─ Ratchet 规则：每次失败沉淀的永久约束                 │
│  • 检索：向量语义搜索 + 时间衰减排序                      │
│  • 存储：PostgreSQL + pgvector                           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 5.2 Ratchet 积累机制

借鉴 Mitchell Hashimoto 的 `AGENTS.md` 设计：**每个错误模式、每条约束规则、每个 Guardrail 条件，都必须可追溯到具体的失败事件。**

```python
# 错误模式积累示例
class ErrorPatternKB:
    """
    Ratchet 知识库 — 只会增长，不会缩减
    每条规则可追溯到:
      - 哪个学生的哪次对话
      - 什么场景触发了错误
      - 什么时候加入的规则
      - 被引用了多少次
    """

    async def learn_from_failure(
        self,
        failure: DiagnosisFailure,
        session_id: UUID,
        student_id: UUID
    ):
        pattern = await self.extract_pattern(failure)
        existing = await self.find_similar(pattern)

        if existing:
            existing.occurrence_count += 1        # ← 只增加计数
            existing.last_seen_at = now()
        else:
            await self.insert(ErrorPattern(         # ← 新失败 → 新规则
                pattern=pattern,
                source_session=session_id,
                source_student=student_id,
                first_seen_at=now(),
                occurrence_count=1
            ))
```

---

## 六、上下文压缩：四级水位线 + 渐进式披露

### 6.1 为什么需要分级压缩

Anthropic 的研究表明：**上下文窗口利用率超过约 40% 时，Agent 输出质量急剧下降**（Context Anxiety）。分级压缩在成本和质量之间取得平衡——低成本操作优先（纯代码遍历，零 LLM 调用），必要时才调 LLM 做结构化摘要。

### 6.2 四级水位线策略

```
Token 水位线       触发动作                          成本          LLM 调用
─────────────────────────────────────────────────────────────────────────
 0% ──┬── 正常       不做任何处理                      零           无
      │
30% ──┼── L1 微压缩   工具输出截断 + 去噪              零(纯代码)   无
      │   (Micro)     • 工具返回仅保留最近 3 轮完整
      │               • 更早的工具结果替换为 1 行摘要:
      │                 [调用 run_tests → 通过 8/10]
      │               • 不修改用户消息和模型推理
      │               • 保留所有诊断结论和错误模式
      │               • 不触发 LLM 调用——纯字符串处理
      │
60% ──┼── L2 滑动裁剪  按价值保留，非按时间             零(纯代码)   无
      │   (Slide)     • 标记关键轮次(user 提问/诊断结论)
      │               • 非关键轮次→仅保留 1 行摘要
      │               • 关键轮次→保留原文
      │               • 实验信息、诊断结果永不做硬删除
      │               • 不触发 LLM 调用——确定性标记逻辑
      │
80% ──┼── L3 结构化摘要 调轻量 LLM 压缩                 低成本       轻量模型
      │   (Summary)   • 用户意图、主要请求、技术概念
      │               • 关键结论、已排除假设
      │               • 当前状态、待办任务
      │               • 压缩比: 10:1 ~ 20:1
      │               • 结果缓存到 chat_conversations.l3_summary
      │               • 避免重复压缩相同内容
      │
95% ──┼── L4 紧急降级  最激进压缩 + 阻止新工具调用      中等成本     标准模型
      │   (Emergency) • 仅保留: 用户目标 + 当前状态
      │               • 其余全部替换为 L3 Summary
      │               • 阻止非必要工具调用
      │               • 主动提示用户开始新会话
      │               • 触发条件同时写入告警系统
─────────────────────────────────────────────────────────────────────────
```

**四级水位线的工程原则**：
1. **成本递进**：30% 和 60% 级是零 LLM 成本的纯代码操作，仅在 80% 和 95% 级引入 LLM
2. **信息不丢**：关键轮次（用户提问、诊断结论、错误发现）永不做硬删除——即使在 95% Emergency 级，也保留结构化摘要而非丢弃
3. **缓存复用**：L3 Summary 在会话级缓存，避免对同一段对话反复调用 LLM 进行摘要
4. **可观测**：每次水位线触发记录 event 到 OTel Span，包含触发前利用率、触发后利用率、压缩耗时

### 6.3 渐进式上下文披露

**不是一次性把全部上下文注入 LLM**，而是按对话阶段逐步展开：

```
阶段 1: 意图识别
  → 注入: 系统 Prompt + 用户消息 + 最近 3 轮摘要
  → 不注入: RAG 结果、实验上下文、学生画像全量

阶段 2: RAG 检索（仅 knowledge_qa 意图）
  → 注入: Query + 检索参数 + 实验描述 + 课程范围
  → 不注入: 学生代码、strace 数据、诊断结果全量

阶段 3: 专家分析（DiagnosisAgent / CodeReviewer / Tutor）
  → 注入: 领域专用数据（按 Context Firewall 策略）
  → 不注入: 无关领域数据

阶段 4: 教学回复
  → 注入: 学生画像 + 错误历史 + L1-L3 提示策略 + RAG 结果
  → 不注入: 原始 strace 全文、eBPF 事件流
```

---

## 七、RAG 的 Agentic 接入方式

### 7.1 核心设计

RAG 不是"前置步骤"，而是 Agent 循环中的**可调用工具 + 上下文注入层**：

```
用户问："进程调度有哪些经典算法？"
         │
         ▼
┌─ Supervisor: intent=knowledge_qa ─────┐
│  决定调用 RAG Agent                   │
│  + Knowledge Tutor Agent 联合处理     │
└────────────┬──────────────────────────┘
             │
    ┌────────▼────────┐
    │ RAG Agent 执行   │  ← Agentic RAG 循环（可多轮）
    │ 1. Query Rewrite │ ← LLM 改写为多个搜索词
    │ 2. BM25 搜索     │ ← 关键词精确匹配
    │ 3. Vector 搜索   │ ← 语义相似度
    │ 4. Re-rank       │ ← 去重 + 精排 Top-K
    │ 5. Self-Reflect  │ ← LLM 检查"够不够回答"
    │ 6. 不够→改写再搜 │ ← 回到步骤 1（最多 3 轮）
    └────────┬────────┘
             │
    ┌────────▼────────┐
    │ [确定性] RAG Gate│
    │ 检索结果非空?    │
    │ 相关性 > 阈值?   │
    └──┬─────────┬────┘
       │ YES     │ NO
       ▼         ▼
  ┌─────────┐  ┌──────────────┐
  │ 注入结果│  │ 告知用户      │
  │ 到 Tutor│  │ 知识库无此内容│
  └─────────┘  └──────────────┘
```

### 7.2 RAG 结果的结构化引用

```python
# RAG 返回的每条结果必须携带
{
    "doc_id": "os_process_scheduling_v2",
    "title": "进程调度算法",
    "snippet": "先来先服务(FCFS)是最简单的调度算法...",
    "relevance_score": 0.92,
    "source": "course_material",         # 来源分类
    "section": "Chapter 3.2",
    "citation_key": "[OS-3.2]"           # 用于回答中引用
}
```

回答中的引用格式：`优先调度（FCFS）将进程按到达顺序排列 [OS-3.2]。`

---

## 八、多会话持久化架构

### 8.1 数据库设计

```sql
-- 会话表
CREATE TABLE chat_conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    title           VARCHAR(200) DEFAULT '新对话',
    agent_mode      VARCHAR(50) DEFAULT 'general_chat',
    experiment_id   UUID,
    submission_id   UUID,
    context_snapshot JSONB,              -- 实验上下文快照
    l3_summary      TEXT,                -- L3 压缩摘要缓存
    message_count   INT DEFAULT 0,
    total_tokens    INT DEFAULT 0,       -- 本会话累计 Token
    pinned          BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 消息表（完整历史，压缩后原文仍在此保留）
CREATE TABLE chat_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL,  -- user/assistant/system/tool
    content         TEXT NOT NULL,
    tool_calls      JSONB,
    tool_results    JSONB,
    rag_sources     JSONB,
    tokens_used     INT DEFAULT 0,
    cost_cents      INT DEFAULT 0,         -- 该条消息的 Token 成本
    span_id         UUID,                  -- OpenTelemetry Span ID
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 长期记忆表
CREATE TABLE long_term_memories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    memory_type     VARCHAR(50) NOT NULL,  -- profile/decision/knowledge/error_pattern/ratchet_rule
    content         JSONB NOT NULL,
    embedding       vector(1536),
    importance      FLOAT DEFAULT 0.5,
    access_count    INT DEFAULT 0,
    last_accessed   TIMESTAMPTZ,
    source_session  UUID,                  -- 来源会话（Ratchet 可追溯）
    source_message  UUID,                  -- 来源消息
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_cc_user ON chat_conversations(user_id);
CREATE INDEX idx_cc_updated ON chat_conversations(updated_at DESC);
CREATE INDEX idx_cm_conv ON chat_messages(conversation_id);
CREATE INDEX idx_cm_created ON chat_messages(conversation_id, created_at);
CREATE INDEX idx_ltm_user ON long_term_memories(user_id);
CREATE INDEX idx_ltm_type ON long_term_memories(user_id, memory_type);
CREATE INDEX idx_ltm_embedding ON long_term_memories
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 8.2 前端 UI 架构

```
┌──────────────────────────────────────────────────┐
│  ┌─────────────┐  ┌─────────────────────────────┐│
│  │  会话列表    │  │      对话主区域              ││
│  │             │  │                              ││
│  │ 🔍 搜索     │  │  ┌─────────────────────────┐ ││
│  │             │  │  │ 实验上下文栏（可折叠）    │ ││
│  │ + 新对话    │  │  │ • 实验: 进程调度模拟     │ ││
│  │             │  │  │ • 提交: #42 (45分)       │ ││
│  │ 📌 置顶会话 │  │  │ • 诊断: 内存泄漏警告     │ ││
│  │ 📝 会话1    │  │  │ • 当前 L 提示级别: L1    │ ││
│  │ 📝 会话2    │  │  └─────────────────────────┘ ││
│  │ 📝 会话3    │  │                              ││
│  │             │  │  用户: 为什么我的进程...      ││
│  │             │  │  AI: 根据你的 strace [链接]   ││
│  │             │  │       分析，你的 fork()...     ││
│  │             │  │                              ││
│  │             │  │  ┌─────────────────────────┐ ││
│  │             │  │  │ 输入框 + SSE 流式        │ ││
│  │             │  │  │ + Agent 思考过程展开    │ ││
│  │             │  │  └─────────────────────────┘ ││
│  └─────────────┘  └─────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

---

## 九、MCP + Skill 扩展方案

### 9.1 设计哲学

| 概念 | 类比 | 作用 |
|------|------|------|
| **MCP** | USB 接口 | 统一工具接入标准——任何 MCP Server 的工具自动发现并注册 |
| **Skill** | 菜谱/Recipe Book | 告诉 Agent："遇到 X → 按 Y 步骤 → 用 Z 工具 → 输出 W 格式" |
| **Tool** | 厨具 | 具体的可调用函数 |

**关键认知**：MCP 解决"有什么工具可用"，Skill 解决"什么时候该用什么工具、按什么顺序用"。

### 9.2 MCP Client 集成

```python
# 新增 app/agents/mcp_client.py
class MCPToolBridge:
    """MCP 工具桥接层 — 自动发现外部 MCP Server 的工具"""

    async def connect_mcp_server(self, name: str, command: str, args: list[str]):
        """连接 MCP Server → 发现工具 → 注册到 ToolRegistry"""
        ...

    async def discover_and_register(self):
        """自动将外部工具注册为标准 ToolDef，纳入工具调用计数和超时管理"""
        ...
```

可接入的 MCP Server：
- **文件系统 MCP** — 读取实验指导书、参考代码
- **Git MCP** — 查看提交历史、代码变更
- **数据库 MCP** — 查询历史错误模式库、学生画像
- **Core Service MCP** — 实时查询实验状态、提交进度

### 9.3 Skill 体系（SOP 标准操作流程）

Skill 是预定义的 SOP，确保 Agent 在特定场景下的行为一致性和质量：

```python
SKILLS_REGISTRY = {
    "diagnose_segfault": {
        "name": "段错误诊断",
        "version": "1.0",
        "trigger": "segmentation fault / SIGSEGV / 段错误",
        "added_due_to": "2026-03-15: 3 次诊断未定位到空指针根因，学生反馈诊断无用",
        # ↑ Ratchet: 每条 Skill 可追溯到触发它创建的失败事件
        "steps": [
            {
                "step": 1,
                "action": "检查 strace 中 SIGSEGV 前的最后一个系统调用",
                "tool": "get_strace",
                "output": "崩溃点文件和行号"
            },
            {
                "step": 2,
                "action": "分析崩溃点是否涉及空指针/越界访问",
                "tool": "analyze_code_patterns",
                "output": "指针使用模式分析"
            },
            {
                "step": 3,
                "action": "关联 OS 概念：虚拟内存、页保护、mmap",
                "tool": "search_knowledge",
                "output": "相关概念卡片"
            },
            {
                "step": 4,
                "action": "按 L1→L2→L3 渐进给出提示",
                "output": "提示序列"
            }
        ],
        "tools": ["get_strace", "analyze_code_patterns", "search_knowledge"],
        "evaluation_criteria": {                     # ← Sprint Contract
            "root_cause_correct": "binary",          # 根因是否正确
            "hint_progression_followed": "binary",   # 是否按 L1→L2→L3
            "evidence_cited": "binary"               # 是否引用具体证据
        }
    },
    "diagnose_deadlock": {
        "name": "死锁诊断",
        "version": "1.0",
        "trigger": "timeout / futex blocking / 死锁 / 卡住不动",
        "added_due_to": "2026-04-02: 学生报告死锁诊断未检查 Coffman 条件",
        "steps": [
            {"step": 1, "action": "检查锁的获取/释放配对 → 识别死锁环路", "tool": "analyze_code_patterns"},
            {"step": 2, "action": "分析 Coffman 四个必要条件是否全部满足", "tool": "search_knowledge"},
            {"step": 3, "action": "关联 OS 概念：互斥、死锁预防/避免/检测", "tool": "search_knowledge"},
            {"step": 4, "action": "按 L1→L2→L3 渐进给出提示", "output": "提示序列"}
        ],
        "tools": ["analyze_code_patterns", "search_knowledge"],
        "evaluation_criteria": {
            "coffman_conditions_checked": "binary",
            "deadlock_cycle_identified": "binary",
            "hint_progression_followed": "binary"
        }
    }
}
```

**Skill 生命周期管理**：
- 每个 Skill 有版本号，新增 Skill 必须记录 `added_due_to` 字段（可追溯到失败事件）
- 追踪 Skill 触发率：超过 6 个月零触发的 Skill → 标记为待废弃（模型能力已覆盖该场景）
- Skill 废弃流程：标记 → 观察 1 个月 → 确认无触发 → 归档（不删除，保留历史记录）

---

## 十、评估观测体系：LLM-as-Judge + 校准

### 10.1 为什么需要独立的评估体系

**Agent 会系统性地高估自己的输出质量。** 这是 Anthropic 工程团队发现的普遍现象——当让 Agent 评价自己的工作时，它"自信地赞扬"平庸甚至错误的输出。唯一已知的解法：**分离生成和评估**。

### 10.2 评估维度

| 维度 | 评估对象 | 评估方式 | 频率 |
|------|---------|---------|------|
| **正确性** | 回答是否解决了用户问题 | LLM-as-Judge (校准后) | 每次响应 |
| **安全性** | 是否包含违规内容 / 泄露答案 | 确定性过滤 + 分类器 | 每次响应 |
| **教学有效性** | 是否遵循 L1→L2→L3 渐进提示 | LLM-as-Judge | 教学类响应 |
| **引用准确性** | RAG 引用是否准确、是否幻觉 | LLM-as-Judge | 有引用的响应 |
| **工具使用** | 工具选择/参数/轨迹是否合理 | 轨迹分析 | 有工具调用的响应 |

### 10.3 LLM-as-Judge 校准流程

```
1. 构建 Gold Set
   └─ 抽取 100-200 组历史对话
   └─ 2 位以上教师独立评分（正确性 / 教学有效性 / 引用准确性）

2. Judge Prompt 设计（G-EVAL CoT 四部分结构）
   └─ ① 领域词汇定义标准（"正确"="根因分析准确，无无关信息"）
   └─ ② 推理结构（"先检查根因是否正确，再检查证据引用..."）
   └─ ③ 确定性评分规则（"3点量表: 0=错误, 1=部分正确, 2=完全正确"）
   └─ ④ 边界处理（"含多个子问题时，全部正确才算 2"）

3. 校准验证
   └─ Cohen's Weighted Kappa:
      κ ≥ 0.80 → 可自动评估，人工仅抽查 5%
      κ 0.61-0.79 → 自动评估 + 低置信度升级人工
      κ 0.41-0.60 → 修订 Rubric + 注入 Few-Shot 示例
      κ < 0.41 → 重新设计 Rubric

4. 持续漂移监控
   └─ 每季度 + 每次换 Judge 模型后重校
   └─ κ 波动 > 0.05 → Rubric 需要修订
   └─ 追踪 Judge-vs-Human 漂移度
```

### 10.4 可观测性栈

```
OpenLLMetry (自动插桩)
    +
Langfuse (Tracing Backend + Dashboard)
    ↓
每个 Span 可追踪:
  ├─ LLM 调用: gen_ai.client span — latency / tokens / model / finish_reason / cost
  ├─ Tool 调用: gen_ai.tool span — name / arguments(redacted) / success / latency / retry_count
  ├─ Agent Span: gen_ai.agent span — total_tokens / duration / task_completion / handoff_target
  └─ Session Span: total_tokens / cost / user_satisfaction / task_resolution

告警规则:
  ├─ 工具失败率 > 10% → 通知
  ├─ 响应延迟 P95 > 5s → 通知
  ├─ 幻觉检测触发率突增 → 通知
  ├─ 成本异常（单会话 > $2） → 通知
  └─ 评分分布突变 → 通知（可能指示模型退化或 Prompt 回归）
```

---

## 十一、约束恢复：输入护栏 → 过程监控 → 失败恢复

### 11.1 三层防护体系

借鉴 ETCLOVG 的 Governance 层设计 + Stripe Minions 的确定性 Gate 实践 + 成本级联原则：

```
【第一层：输入护栏】—— 模型调用前（成本级联: 确定性优先）
├─ PII 检测: 正则 + Presidio 分类器（非 LLM，10,000x 更便宜，< 1ms）
├─ Prompt 注入检测: 基于模式 + 嵌入距离（分类器级，~10ms）
├─ 越界请求检测: 与课程范围无关的请求 → 礼貌拒绝模板（确定性匹配）
└─ 意图置信度门: confidence < 0.6 → 请求用户澄清（确定性 Gate）

【第二层：过程监控】—— 执行中
├─ 工具调用计数: 单轮 > 5 次工具调用 → 截断并要求聚焦
├─ 工具参数校验: JSON Schema 验证（非 LLM — 确定性检查）
├─ 工具超时: 每个工具独立的 timeout（默认 30s）
├─ 循环检测: max_iterations = 15, 超过 → 强制终止
├─ 熔断器: 同类工具连续 3 次失败 → 禁用该工具 → 降级
└─ Token 水位线: 超 95% → 触发 Emergency 压缩 + 阻止新工具调用

【第三层：失败恢复】—— 出错后
├─ 工具重试策略:
│   ├─ 网络超时 → 重试 1 次（指数退避）
│   ├─ 参数错误 → 修正参数重试 1 次
│   ├─ 连续失败 3 次 → 跳过该工具 + 告知用户
│   └─ 全部工具不可用 → 降级为纯文本回答 + 建议提交工单
├─ LLM 调用失败:
│   ├─ 超时 → 切换到备用模型
│   ├─ Rate Limit → 退避 + 重试
│   └─ Content Filter → 截断 + "我无法回答这个问题"
└─ 会话级恢复:
    └─ 会话状态 Checkpoint → 失败后可从最近 Checkpoint 恢复
```

### 11.2 成本级联：确定性优先

这是 Stripe Minions "Don't burn tokens on what code can do" 原则在安全与治理领域的直接应用。每一层只处理上一层无法确定判断的请求：

```
请求进入
    │
    ▼
┌─────────────────────────────────────┐
│ 确定性检查 (Deterministic Checks)   │
│ • 正则 / JSON Schema / 规则引擎     │
│ • PII检测: 正则匹配身份证/手机号    │
│ • 注入检测: 已知注入模式匹配        │
│ • 格式校验: JSON Schema 验证输出    │
│ • 成本: 近乎零                      │
│ • 延迟: < 1ms                       │
│ • 覆盖: ~90% 的过滤场景             │
└────────┬────────────────────────────┘
         │ 通过（无法确定判断的 ~10%）
         ▼
┌─────────────────────────────────────┐
│ 分类器检查 (Classifier Checks)      │
│ • 微调模型 / 嵌入距离               │
│ • 毒性检测: 微调的分类模型          │
│ • 越界识别: 嵌入距离 vs 课程范围    │
│ • 成本: 极低                        │
│ • 延迟: ~10ms                       │
│ • 覆盖: ~9% 的过滤场景              │
└────────┬────────────────────────────┘
         │ 通过（边界/模糊情况 ~1%）
         ▼
┌─────────────────────────────────────┐
│ LLM Judge (仅边界/模糊情况)         │
│ • 标准模型调用                      │
│ • 内容质量评估（教学有效性等）      │
│ • 安全边界模糊时的最终仲裁          │
│ • 成本: 中等                        │
│ • 延迟: ~1-3s                       │
│ • 覆盖: ~1% 的过滤场景              │
│                                     │
│ "LLM 是最后一道防线，不是第一道"     │
└─────────────────────────────────────┘
```

**工程原则**：绝大多数请求（~99%）在前两层即可完成判断，不会触发 LLM Judge。只有在正则、分类器都无法确定的边界情况下，才调用 LLM 做最终仲裁。这是成本与安全性之间的最优平衡。

---

## 十二、实验上下文注入

### 12.1 数据结构

```python
@dataclass
class ExperimentContext:
    """注入到 Agent 调用的实验上下文 — 渐进式披露"""

    # 阶段 1: 意图识别（轻量注入）
    experiment_id: str
    experiment_title: str
    experiment_category: str       # process/sync/memory/io

    # 阶段 2: 知识检索（中等注入）
    experiment_description: str
    experiment_instructions: str
    key_concepts: list[str]        # 本实验涉及的核心 OS 概念

    # 阶段 3: 代码诊断（完整注入）
    submission_id: str | None
    student_code: str
    language: str = "c"
    compile_error: str | None
    runtime_error: str | None
    test_results: list[dict]
    strace_summary: str | None
    score: int | None

    # 阶段 4: 教学回复（注入诊断 + 画像）
    diagnosis_result: dict | None
    root_cause: str | None
    related_concepts: list[str]
    student_profile: dict | None   # 薄弱知识点 + 学习风格
```

### 12.2 渐进式披露策略

```
阶段 1: 意图识别         → experiment_title + category（~100 tokens）
阶段 2: RAG 检索         → experiment_description + instructions + key_concepts（~500 tokens）
阶段 3: 专家诊断         → student_code + errors + test_results + strace（~3K tokens）
阶段 4: 教学回复         → diagnosis_result + related_concepts + 学生画像（~1K tokens）
```

---

## 十三、实施路线图

| 阶段 | 内容 | 新增/修改文件 | 预计工作量 |
|------|------|-------------|-----------|
| **Phase 0** | 接线（前置依赖）：`chat.py` 改调 `run_agent_pipeline` 或新建 `routers/conversations.py` 走 agent graph；补建 `chat_conversations`/`chat_messages` 基础表（先 user_id/title/created_at，不带 pgvector 也不阻塞）；`rag/page.tsx` 透传 conversation_id；`route_by_intent` 加 confidence≥0.7 门 | `services/ai-service/app/routers/chat.py` 或 `routers/conversations.py`, `deploy/init-db/19-chat-conversations.sql` | 2-3 天 |
| **Phase 1** | 数据库建表 + 多会话 CRUD API + 前端会话列表 | `chat_conversations` 表, `chat_messages` 表, `long_term_memories` 表, `routers/conversations.py`, 前端会话列表组件 | 1 周 |
| **Phase 2** | 四级压缩引擎 + Token 水位线监控 + Context Firewall | `agents/context_compressor.py`, `agents/context_budget.py` | 1 周 |
| **Phase 3** | L2 长期记忆提取 + pgvector 检索 + Ratchet 日志 | `agents/long_term_memory.py`, `agents/ratchet.py` | 1 周 |
| **Phase 4** | Supervisor Blueprint 升级 + 实验上下文注入 + Skill 体系 | `agents/graph.py`, `agents/orchestrator.py`, `agents/skills/` | 1-2 周 |
| **Phase 5** | MCP Client 集成 + 新工具接入 | `agents/mcp_client.py` | 1 周 |
| **Phase 6** | Guardrails + 成本级联防线 + LLM-as-Judge 校准 + Langfuse/OTel | `agents/guardrails.py`, `agents/evaluator.py`, `services/observability.py` | 1-2 周 |
| **Phase 7** | 前端全面重构：多会话 + SSE 流式 + 上下文栏 + Agent 思考过程 | `app/(dashboard)/agent/`, 前端组件重构 | 2 周 |

---

## 十四、风险与反模式

### 14.1 已知风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **Harness 过度工程化** | 维护成本高，模型升级后逻辑过时 | 每条规则标注来源和日期；季度审计移除过时约束；Bitter Lesson：模型升级后敢于丢弃 |
| **AGENTS.md 膨胀** | ETH Zurich 研究表明 LLM 生成的规则反而降低性能 | 仅记录真实失败驱动的规则；保持 ~100 行；使用渐进式披露 |
| **上下文压缩丢失关键信息** | 压缩后 Agent 缺少决策所需上下文 | 关键轮次永不做硬删除；压缩前标记 user_questions / diagnosis_conclusions |
| **LLM Judge 校准漂移** | 自动评分逐渐偏离教师标准 | 季度重校；换 Judge 模型后强制重校；追踪 κ 趋势 |
| **Skill 体系过时** | 预定义 SOP 与模型能力不匹配 | Skill 版本化管理；追踪 Skill 触发率 → 6 个月零触发标记废弃 |
| **成本失控** | 压缩 LLM + Judge LLM + Agent LLM 累加 | Token 预算制；成本归因到会话级；异常成本告警；成本级联优先走确定性路径 |

### 14.2 反模式警告

| 反模式 | 为什么危险 | 正确做法 |
|--------|-----------|---------|
| 把所有 Agent 的 Prompt + 工具一次注入 Supervisor | Context Anxiety → 输出质量下降 | Context Firewall：每个 Agent 独立上下文 (~1K~3K tokens) |
| 把"不要泄露答案"写在 Prompt 里 | 模型可能忽略 Prompt 指令 | 输出后确定性过滤 + 截断（成本级联第一层） |
| 在 AGENTS.md 里写 1000 条规则 | 模型无法有效利用，反而降低性能 | ~100 行路由表 + 指向深度文档的指针 |
| 每条错误都加一条 Prompt 约束 | 约束膨胀导致"指令预算"耗尽 | 能用 Lint/Hook/CI 的就不要写成 Prompt |
| 不做金标校准就上线 LLM Judge | LLM 评分与教师标准偏差无法检测 | 50+ 金标 → κ ≥ 0.80 → 上线 |
| 前端直连 API 而不经过 Agent 编排 | 所有 Agent 基础设施（记忆/压缩/Guardrails）被绕过 | 前端只与 Agent Gateway 通信 |
| 规范性的 Harness 规则（"Agent 应该做 X"） | 模型升级后不再需要，但 Harness 不知道 | 每个规则标注来源事件 + 日期；季度审计 |
| 用 LLM 做正则能做的事（如 PII 检测） | 成本 10,000x + 延迟 1,000x | 成本级联：确定性检查 → 分类器 → LLM（仅边界） |

---

## 十五、技术决策记录

| 决策 | 选项 | 选择 | 理由 | 来源 |
|------|------|------|------|------|
| **编排模式** | 纯 Agentic / 纯状态机 / 混合 | **混合状态机 (Blueprint)** | 确定性的归状态机（重试/熔断/门禁），不确定的归 LLM | Stripe Minions |
| **记忆框架** | Mem0 / Letta / 自研 | **自研 (PG + pgvector)** | 与现有 DB 统一，轻量可控，满足教学场景 | 内部积累 |
| **压缩 LLM** | 独立模型 / 复用 | **复用现有 Provider + 轻量模型** | 简化部署；L3 摘要用轻量模型（够用且便宜） | - |
| **编排框架** | LangGraph / CrewAI / 自建 | **LangGraph（现有）** | 已有基础 + StateGraph + Checkpoint + 社区成熟 | 内部积累 |
| **MCP 集成** | 全面接入 / 先验证 | **先做基础 + 1-2 个验证** | 渐进式，确认价值后再扩展 | - |
| **可观测** | Langfuse / Arize / 自建 | **Langfuse（开源 MIT）** | 自托管、OTel 原生、LLM 语义支持好 | ETCLOVG 推荐 |
| **LLM Judge** | 同模型 / 异构 | **异构模型** | 避免自我偏好偏差：Judge 模型家族 ≠ Agent 模型家族 | G-Eval / GEDD |
| **评分量表** | 5 点 / 3 点 / 二元 | **3 点 + 二元硬规则** | 3 点足够区分质量等级；关键规则用二元（降低 Judge 负担） | MT-Bench |
| **前端策略** | 先前端 / 先后端 | **后端优先，前端做最小适配再全面重构** | 降低风险，核心能力（记忆/压缩/Guardrails）必须先落地 | - |
| **Harness 规则积累** | 手动 / 自动 | **半自动（Agent 建议 + 人工确认）** | Ratchet 自动发现 → 候选入库 → 教师确认 → 永久规则 | Mitchell Hashimoto |
| **安全检查级联** | 全部 LLM / 全部规则 / 级联 | **三级成本级联** | 确定性(正则) → 分类器(嵌入) → LLM(仅边界)。不用 LLM 做正则的事 | Stripe Minions |

---

## 十六、关键指标

| 指标 | 当前值 | 目标值 | 测量方法 |
|------|--------|--------|---------|
| ETCLOVG 层覆盖 | 2/7 (C, T 基础) | 7/7 | 每层是否有独立模块和监控 |
| 对话持久化 | ❌ 刷新即丢 | ✅ 多会话 + 完整历史 | 功能验收 |
| 上下文管理 | 无压缩 | 四级水位线自动压缩 | Token 水位线日志 |
| 长期记忆 | 仅学生画像 | 画像 + 决策 + 知识 + 错误模式 + Ratchet | L2 条目数 / 检索命中率 |
| 工具数量 | 8 | 12+ (含 MCP 动态工具) | ToolRegistry 计数 |
| 可观测性 | ❌ 无 | ✅ Langfuse 全链路 | 每个 Span 覆盖率 100% |
| LLM Judge κ 值 | 未测量 | ≥ 0.80 | Gold Set 校准 |
| 前端 Agent 体验 | 单次 QA | 多会话 + 流式 + 上下文栏 + Agent 过程 | 功能验收 |
| 约束恢复 | ❌ 无 | ✅ Guardrails + Retry + Fallback + 熔断 + 成本级联 | 工具失败恢复率 > 95% |
| 工具成功率 | 未测量 | > 95% | Langfuse 统计 |
| 平均响应延迟 | ~5s | < 8s（含 Agent 编排） | OTel Span 时长 |
| 幻觉检测率 | 未测量 | 建立基线 | Evaluator 日志 |
| 成本级联命中分布 | N/A | 确定性层 > 90%, 分类器层 > 9%, LLM < 1% | Guardrails 日志 |

---

## 附录：与 AI 诊断模块的共享基础设施

```
                    ETCLOVG 共享层
    ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐
    │ RAG引擎 │  │ 错误模式库│  │ 学生画像  │  │ Langfuse  │
    │ (共用)  │  │ (Ratchet) │  │ (共用)   │  │ (共用)    │
    └─────────┘  └──────────┘  └──────────┘  └───────────┘
         │            │             │             │
    ┌────┴────────────┴─────────────┴─────────────┴────┐
    │              AI 提问 Harness                       │
    │  Supervisor → RAG/Diagnosis/CodeReview/Tutor/Chat │
    │  + Context Firewall + 4级压缩 + Skill Registry     │
    │  + 成本级联(Gate→Classifier→LLM Judge)            │
    └───────────────────────────────────────────────────┘
                         │
                         │ 诊断报告可被引用
                         ▼
    ┌───────────────────────────────────────────────────┐
    │              AI 诊断 Harness                       │
    │  Planner → Gen×5 → Evaluator → ReportGenerator    │
    │  + Context Firewall + Sprint Contract + 混合评分   │
    └───────────────────────────────────────────────────┘
                         │
                         │ 诊断中发现的模式反哺
                         ▼
              ┌─────────────────────┐
              │   ErrorPatternKB    │
              │   (Ratchet 积累)    │
              └─────────────────────┘
```

---

> **文档版本**: v2.1
> **创建日期**: 2026-08-06
> **状态**: 待评审
> **变更**: 基于 Harness 工程最佳实践（Anthropic / Stripe Minions / OpenAI Codex / Mitchell Hashimoto / ETCLOVG）全面重写；新增「行业最佳实践参考」章节，涵盖 Supervisor Blueprint 混合状态机、Context Firewall 模式、四级 Token 水位线策略、三级成本级联防线、MCP+Skill 系统设计
>
> **v2.2 变更（2026-08-08）**：对照远程实际代码核查，修正「2.1 现有资产盘点」全部文件路径（补 `services/ai-service/` 前缀）并新增 V-验证层 chat.py 行；扩写 2.2「前端未接入」「无多会话管理」两条差距为精确调用链与表缺失证据；新增「2.3 现状代码核查」对照表（11 项）；实施路线图前置「Phase 0 接线」阶段
