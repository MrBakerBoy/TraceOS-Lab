# TraceOS AI 诊断模块升级方案：基于 Harness 工程的多 Agent 诊断与多维评估体系

> **定位**：将「代码提交 → 判题打分 → 单次 LLM 诊断」升级为「代码提交 → 编译运行 → 全量采集 → 多 Agent 并行诊断 → 多维校准评估 → 综合诊断报告」的**生产级 Agent Harness**。
>
> **核心原则**：Agent = Model + Harness — 一个中等模型配上优秀的 Harness，胜过优秀模型配上糟糕的 Harness。（ΔPerformance_Harness ≫ ΔPerformance_Model）
>
> **设计范式**：ETCLOVG 七层架构 + Planner–Generator–Evaluator 三体模式 + 混合状态机（确定性评分 + LLM 评审） + Ratchet 持续积累

---

## 行业最佳实践参考

本方案系统性地吸收了 2025-2026 年 AI Engineering 领域的前沿研究成果，确保 TraceOS 诊断 Harness 达到生产级标准。

### Harness 工程 9 大核心组件 (arXiv 2605.18747)

2026 年 5 月发表的系统化综述论文《Harness Engineering: A Systematic Survey》定义了生产级 Agent Harness 的 9 大核心组件。该论文通过对 Anthropic、OpenAI Codex、Stripe Minions、Mitchell Hashimoto 等业界实践的归纳分析，提出以下组件清单——TraceOS 诊断 Harness 的 ETCLOVG 七层架构完整覆盖全部 9 个组件：

| # | 组件 | 核心职责 | TraceOS 映射 |
|---|------|---------|-------------|
| 1 | **While-Loop Engine** | perception→planning→action 心跳循环；必须设置最大迭代上限 | L 层 Orchestrator 的 Phase 2 并行诊断循环，max_iterations = 5 |
| 2 | **Context Management** | 压缩/摘要化，保持上下文窗口利用率 < 40% | C 层 Context Firewall + 四级 Token 水位线 + 渐进式披露 |
| 3 | **Tool Registry** | 动态工具分发（相比静态加载节省 37% Token 开销） | T 层 9 个内置 Tool + MCP Client 动态发现 + Tool Sandbox |
| 4 | **Sub-Agent Management** | 有界任务委托 + 最小权限原则（Least Privilege） | L 层 5 个 Specialist Agent + 独立 Evaluator，每个 Agent 仅接收 Context Firewall 限定的最小数据集 |
| 5 | **Built-in Skills** | 确定性操作与 LLM 推理分离 | 确定性评分器（测试通过率、FD 平衡检测）运行于代码而非 LLM；Skill Registry 中的 SOP 路径 |
| 6 | **Session Persistence** | 外部化状态，在上下文重置后仍然存活 | PostgreSQL 持久化：diagnosis_reports + agent_results + experiment_rubrics + error_patterns |
| 7 | **Dynamic Prompt Assembly** | 状态→Prompt 转换（必须记录组装的完整 Prompt 以便审计） | C 层 ContextCollector + DataCollector 按 Agent 需求动态组装；组装的最终 Prompt 存档于 agent_results |
| 8 | **Lifecycle Hooks** | pre/post-LLM-call、pre/post-tool-execution 注入点 | O 层 OTel Span 的 before_llm_call / after_llm_call 事件钩子；Guardrail Gate 的确定性检查 |
| 9 | **Permission Enforcement** | 沙箱隔离 + 身份网关 | E 层 nsjail/Docker 沙箱；G 层输入护栏（PII/注入检测）+ 输出护栏（完整解答泄漏检测） |

**关键引用**: arXiv 2605.18747 — 这 9 个组件不是可选的"最佳实践"，而是生产级 Harness 的**必要条件**。缺少任何一个组件，系统在对应的故障模式下将无防御能力。

### Planner-Generator-Evaluator 架构 (Anthropic)

Anthropic 工程团队通过大规模 Agent 部署发现的核心模式：

- **自我评价偏差**：Agent 会系统性地高估自己的输出质量——当让 Agent 评价自己的工作时，它"自信地赞扬"平庸甚至错误的输出。这是无法通过 Prompt 工程修复的结构性问题，唯一已知解法是**将 Generator 与 Evaluator 分离为独立 Agent**
- **Sprint Contract 模式**：在诊断开始前，Planner（Orchestrator）和 Evaluator 必须就"什么是好的诊断"达成书面共识——这包括硬阈值（hard thresholds）和硬失败规则（hard-fail rules）。硬失败规则采用二进制判定（VIOLATED/CLEAR），不能使用模糊的评分尺度

### 混合评分器架构 (Stripe Blueprint)

Stripe Minions 团队的核心工程洞察——"Don't burn tokens on what code can do"：

- **确定性评分（代码执行）**：测试通过率、执行时间、输出匹配 — 这些是数学可计算的值，不需要 LLM
- **规则引擎（模式检测）**：FD 平衡、内存平衡、进程回收 — 这些是模式匹配可检测的问题，不需要 LLM
- **LLM 评分（经校准）**：代码质量、概念达成度、内核行为解读 — 只有在需要语义理解时才调用 LLM

混合架构的核心优势：确定性评分和规则引擎是 Agent 无法穿越的墙，而 LLM 评分补充了语义覆盖的盲区。三者之间由 Evaluator 做最终仲裁。

### Ratchet 原则 (Mitchell Hashimoto)

HashiCorp 创始人 Mitchell Hashimoto 在 2025 年提出的 Agent 工程核心方法论：

- **每次 Agent 犯错 → 一个永久的规则/检查/门禁** — 不做预判性约束，只在真实失败发生后增加约束
- **每个规则可追溯到具体的失败事件 + 日期** — 无法追溯来源的规则将在审计中被移除
- **Harness 只会收紧，不会放松** — 这是 Ratchet（棘轮）的核心隐喻
- **Bitter Lesson**：模型升级后，旧的能力边界被突破，一些约束可能不再需要。必须每季度审计：哪些规则仍然是必需的？哪些已经可以被模型能力覆盖？

---

## 一、Harness 工程定位

### 1.1 什么是 Harness 工程

Harness 工程是 2026 年 AI 工程的核心范式，由 Mitchell Hashimoto（HashiCorp 创始人）首次系统化定义，并由 arXiv 2605.18747 论文提供了系统性的学术框架：

> *"每当 Agent 犯一个错误，你就花时间设计一个工程方案，确保它永远不会再犯同样的错误。"*

核心公式：**Agent = Model + Harness**。Harness 是包裹在模型外层的完整执行环境——系统 Prompt、工具、沙箱、编排逻辑、9 大核心组件（While-Loop Engine / Context Management / Tool Registry / Sub-Agent Management / Built-in Skills / Session Persistence / Dynamic Prompt Assembly / Lifecycle Hooks / Permission Enforcement）、Hook、记忆、反馈回路、可观测性和治理规则。**仅改变 Harness 而不动模型权重，就能在 Terminal-Bench 2.0 上实现 +13.7pp 的提升**（从 52.8% 到 66.5%）。

### 1.2 三个基石原则

| 原则 | 来源 | 含义 |
|------|------|------|
| **Ratchet 原则** | Mitchell Hashimoto / Addy Osmani | Harness 只会收紧，不会放松。每次失败→永久规则/检查/门禁。约束只在真实失败后增加，不做预判性约束。 |
| **机械执行 > Prompt 指令** | OpenAI Codex / Stripe Minions | 一条 Lint 规则是 Agent 无法穿越的墙；一句 Prompt 指令只是可能被遗忘的请求。确定性的自动化检查 >> 写在 Prompt 里的要求。 |
| **生成与评估分离** | Anthropic (Prithvi Rajasekaran) | Agent 存在系统性"自我评价偏差"——总是高估自己的输出质量。独立的评估 Agent 是该问题的唯一已知解法。 |

---

## 二、现状分析：ETCLOVG 差距矩阵

### 2.1 现有资产盘点

| ETCLOVG 层 | 现有实现 | 状态 |
|-------------|---------|------|
| **E - 执行** | nsjail/Docker 沙箱 + strace + eBPF + perf + AST 分析 | ✅ 成熟 |
| **T - 工具** | run_code / run_tests / get_strace / search_knowledge / get_flamegraph / analyze_ebpf / pattern_analyzer / trace_diff / AST mode detector（9 工具） | ✅ 成熟 |
| **C - 上下文** | 单次 Prompt 组装 + RAG 注入 + SHA256 缓存 | 🟡 基础 |
| **L - 生命周期** | 单一 `diagnosis.py` 端点 → LLM 调用 | 🔴 简陋 |
| **O - 可观测** | 无 | ❌ 空白 |
| **V - 校验** | 无（无评分校准、无一致性检测、无置信度约束） | ❌ 空白 |
| **G - 治理** | 无（无降级策略、无人工复审触发、无安全约束） | ❌ 空白 |

### 2.2 关键差距（按严重度排序）

| 差距 | ETCLOVG 层 | 严重度 | 根因 |
|------|-----------|--------|------|
| 无多 Agent 协同诊断，每种分析独立调用 LLM | L - 生命周期 | 🔴 致命 | 缺少诊断编排器 |
| 无独立评估 Agent，诊断结果没有校验 | V - 校验 | 🔴 致命 | 生成与评估未分离 |
| 无评估校准机制，LLM 评分不可信 | V - 校验 | 🔴 致命 | 缺少 LLM-as-Judge 校准 |
| 无上下文窗口管理，长诊断可能超 Token | C - 上下文 | 🔴 致命 | 缺少 Context Firewall + 压缩（利用率超 40% 后质量急剧下降） |
| 无执行追踪，无法定位诊断失败原因 | O - 可观测 | 🟡 重要 | 缺少 Tracing |
| 无降级/熔断，LLM 失败无兜底 | G - 治理 | 🟡 重要 | 缺少 Fallback 链 |
| eBPF/AST/火焰图数据未注入诊断管线 | C - 上下文 | 🟡 重要 | 数据源未打通 |
| 无实验专属概念 Rubric | V - 校验 | 🟡 重要 | 评估维度不匹配 |
| 无历史对比/进步追踪 | C - 上下文 | 🟢 增强 | 缺少学生画像 |
| 诊断结果无知识图谱沉淀 | C - 上下文 | 🟢 增强 | 缺少错误模式库 |

---

## 三、ETCLOVG 七层架构设计

### 3.1 架构总览（对齐 Harness 9 大核心组件）

```
┌──────────────────────────────────────────────────────────────────────┐
│                 TraceOS AI Diagnosis Harness (ETCLOVG)                │
│         全覆盖 arXiv 2605.18747 定义的 9 大核心组件                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  G 治理层 (Governance)                  ← 组件9: Permission Enforcement│
│  ├─ 输入护栏: 代码注入检测 / 实验范围校验                              │
│  ├─ 输出护栏: 幻觉检测 / 完整解答泄漏检测 / 格式校验                    │
│  ├─ 降级策略: LLM 失败 → 规则引擎 → 预置诊断模板                      │
│  ├─ 人工复审: confidence < 0.6 或 Agent 间偏差 > 15% 触发              │
│  └─ 安全约束: 诊断不含完整解答 → 违反则截断 + 教师端告警               │
│                                                                      │
│  V 校验层 (Verification)                    ← 对标 Anthropic Evaluator│
│  ├─ 独立 Evaluator Agent: 不看 Generator 上下文，独立评分              │
│  ├─ 多 Agent 交叉验证: Agent 间评分偏差 > 15% → 标记人工复审           │
│  ├─ LLM-as-Judge 校准: Cohen's κ ≥ 0.80 → 可自动评分                  │
│  ├─ 五阶段校验: 基准 → 执行就绪 → 轨迹采集 → 多级评判 → 回归优化      │
│  └─ 校准漂移监控: 每季度重校，换 Judge 模型后重校                      │
│                                                                      │
│  O 可观测层 (Observability)                ← 组件8: Lifecycle Hooks   │
│  ├─ OpenTelemetry Tracing: 每个 Agent 调用 Span 可追踪                │
│  ├─ Langfuse 集成: 全链路可视化 + Token 成本归因                       │
│  ├─ 诊断质量 Dashboard: 准确率 / 学生满意度 / 人工复审率               │
│  └─ 异常检测: 评分分布突变 / 耗时异常 / 模型退化告警                   │
│                                                                      │
│  L 生命周期层 (Lifecycle) ← 组件1: While-Loop Engine                  │
│  │                        组件4: Sub-Agent Management                │
│  ├─ Orchestrator (Planner): 分析评测结果 → 制定诊断计划                │
│  ├─ 5 个 Specialist Agent (Generator): 并行执行分领域诊断              │
│  ├─ Evaluator Agent: 独立校验诊断质量                                 │
│  └─ ReportGenerator: 综合报告 + 学习建议                               │
│                                                                      │
│  C 上下文层 (Context) ← 组件2: Context Management (利用率 < 40%)      │
│  │                     组件7: Dynamic Prompt Assembly                │
│  ├─ 渐进式披露: 按 Agent 阶段逐步展开数据（不一次性注入）              │
│  ├─ Context Firewall: 每个 Agent 仅接收其领域数据                      │
│  ├─ 上下文预算: 严格控制在 40% 窗口利用率以下                          │
│  ├─ DataCollector: 并行收集 8 种数据源 → ContextPackage               │
│  └─ 学生画像 + 历史诊断 + 错误模式库（L2 长期记忆）                    │
│                                                                      │
│  T 工具层 (Tooling)                     ← 组件3: Tool Registry       │
│  │                                       组件5: Built-in Skills      │
│  ├─ MCP 协议接入: 统一工具接口标准                                    │
│  ├─ 9 个内置 Tool + Tool Sandbox（执行隔离 + 超时控制）               │
│  ├─ 动态工具分发: 按需注册（相比静态加载节省 37% Token）              │
│  └─ 工具返回自动精炼: 保留头部+尾部，中间替换为结构化摘要              │
│                                                                      │
│  E 执行层 (Execution)                   ← 组件6: Session Persistence │
│  ├─ Go Core Service: 编译 → 沙箱运行 → 全量数据采集                   │
│  ├─ Python AI Service: Agent 编排 + LLM 调用 + 报告生成               │
│  └─ NATS 事件总线: 跨服务解耦通信                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 四、多 Agent 协作模式：Planner–Generator–Evaluator

### 4.1 为什么需要三体模式

Anthropic 工程团队发现两个致命问题：
1. **自我评价偏差**：Agent 对自身输出的评价系统性偏高。把"做事的 Agent"和"评判的 Agent"分开，效果远超让同一个 Agent 自评。
2. **上下文焦虑**：长任务导致上下文窗口膨胀，Agent 在约 **40% 利用率**时输出质量开始急剧下降（Anthropic 2025）。结构化 Reset + Sprint 分解保持专注。TraceOS 将 40% 设为硬约束——任何 Agent 的上下文组包必须通过 Token 预算校验，超标则拒绝注入并回退到摘要模式。

### 4.2 TraceOS 诊断三体架构

```
                        评测完成事件 (NATS)
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Planner (DiagnosisOrchestrator)                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 1. 分析评测结果 → 确定诊断范围                                 │   │
│  │ 2. 制定诊断计划: 哪些 Specialist 需要启动？                    │   │
│  │ 3. 分发 ContextPackage（渐进式，仅包含各 Agent 需要的部分）      │   │
│  │ 4. 收集 Agent 报告 → 综合评分 → 交给 Evaluator                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ CodeAnalyzer    │ │ SyscallAnalyzer │ │ ConceptRubric   │
│ (代码质量)       │ │ (系统调用行为)   │ │ (概念达成度)     │
│ Context:        │ │ Context:        │ │ Context:        │
│ code+AST+issues │ │ strace+pattern  │ │ code+rubric     │
│                 │ │ +trace_diff     │ │ +test_results   │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ TestEvaluator   │ │ eBPFAnalyzer    │ │ PerfAnalyzer    │
│ (测试结果分析)   │ │ (内核行为分析)   │ │ (性能热点分析)   │
│ Context:        │ │ Context:        │ │ Context:        │
│ test_results    │ │ ebpf_events     │ │ flamegraph      │
│ +expected_vs    │ │ +deadlock       │ │ +hotspots       │
│ _actual         │ │ +mem_events     │ │ +exec_time      │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │ 各 Agent 诊断报告
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Evaluator Agent（独立校验 — 不看任何 Generator 上下文）               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 1. 逐维度独立打分（使用校准后的 Rubric）                        │   │
│  │ 2. 交叉验证: 各 Agent 报告之间是否一致？                        │   │
│  │ 3. 置信度评估: 是否有足够证据支撑结论？                         │   │
│  │ 4. 安全校验: 诊断是否泄露了完整解答？                           │   │
│  │ 5. 输出: 校准后的六维评分 + 置信度 + 复审建议                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ 校准后评分 + 校验结果
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ReportGenerator                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 1. 综合诊断报告（含六维雷达图数据）                             │   │
│  │ 2. 修复建议按优先级排序 + 引用具体证据（strace 行号等）         │   │
│  │ 3. 学习建议 + 推荐资料                                         │   │
│  │ 4. 历史进步曲线（如有多份提交）                                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.3 Context Firewall 模式

**核心设计**：每个 Specialist Agent 拥有独立的、最小化的上下文窗口 — 仅包含其诊断领域所需的数据。此模式直接借鉴了 Anthropic 的 Sub-Agent 实践以及 arXiv 2605.18747 论文中定义的 "Sub-Agent Management" 组件（组件4：有界任务委托 + 最小权限原则）。

**上下文预算硬约束**：每个 Agent 的上下文组包必须通过 Token 预算校验。基于 Anthropic 的 Context Anxiety 研究，预算上限设为各模型上下文窗口的 40%。例如，对于 128K 上下文窗口的模型，每个 Agent 的上下文预算上限为 ~51K tokens。实际注入量通常远低于此上限（因为 Context Firewall 仅注入领域专用数据）。

```
                    ┌─────────────────────┐
                    │  DataCollector      │
                    │  全量数据（8源）      │
                    └─────────┬───────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ CodeAnalyzer     │ │ SyscallAnalyzer  │ │ ConceptRubric    │
│ ─────────────────│ │ ─────────────────│ │ ─────────────────│
│ ✅ code + AST    │ │ ✅ strace 全文   │ │ ✅ code          │
│ ✅ AST issues    │ │ ✅ pattern分析   │ │ ✅ rubric定义    │
│ ❌ strace 数据   │ │ ✅ trace_diff    │ │ ✅ test_results  │
│ ❌ eBPF 数据     │ │ ❌ code 全文     │ │ ❌ strace 数据   │
│ ❌ 火焰图        │ │ ❌ 火焰图        │ │ ❌ eBPF 数据     │
│ ❌ 测试细节      │ │ ❌ AST issues    │ │ ❌ 火焰图        │
│                  │ │                  │ │                  │
│ 预算: ~2K tokens │ │ 预算: ~3K tokens │ │ 预算: ~2K tokens │
│ 利用率: ~15%     │ │ 利用率: ~23%     │ │ 利用率: ~15%     │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

**反模式警告**：❌ 把全部 8 种数据源注入每个 Agent — 这不仅会撑爆上下文窗口（Context Anxiety — 超过 40% 利用率后输出质量急剧下降），且 Agent 容易被无关信息干扰。每个 Agent 应只看到它需要的数据。❌ 把"不要泄露答案"写在 Prompt 里就认为安全了 — 必须用输出后确定性过滤 + 截断（机械执行 > Prompt 指令）。

---

## 五、Agent 角色定义与 Sprint Contract

### 5.1 Agent 矩阵

| Agent | 角色类比 | 输入（Context Firewall） | 输出 Schema | 模型策略 | 评分器类型 |
|-------|---------|------------------------|------------|---------|-----------|
| **CodeAnalyzer** | 代码审查专家 | code + AST 注解 + AST issues | `{issues, quality_score, patterns}` | 轻量模型 + 规则优先 | 混合（AST 规则 + LLM） |
| **TestEvaluator** | 测试分析师 | test_results + expected vs actual | `{overview, per_test, failure_categories}` | 标准模型 | LLM 评分器 |
| **SyscallAnalyzer** | 系统行为分析师 | strace + pattern 分析 + trace_diff | `{summary, leaks, anomalies, similarity}` | 规则优先 + LLM 补充 | 确定性评分器 |
| **eBPFAnalyzer** | 内核行为分析师 | eBPF 事件 + 死锁检测 + 内存事件 | `{deadlock, mem_patterns, distribution}` | 标准模型 | LLM 评分器 |
| **PerfAnalyzer** | 性能分析师 | 火焰图热点 + 用户/内核态比例 | `{hotspots, issues, tips}` | 轻量模型 | 混合（执行时间 + LLM） |
| **ConceptRubric** | 概念评估专家 | code + experiment rubric + test_results | `{concept_scores, total, evidence}` | 标准模型 | LLM 评分器 |
| **Evaluator** | 独立 QA（不看 Generator 上下文） | 全部 Agent 报告 + 原始评测数据 | `{calibrated_scores, confidence, review_flag}` | 标准模型 | **校准过的** LLM Judge |
| **ReportGenerator** | 报告撰写人 | Evaluator 结果 + 全部 Agent 报告 | 完整 DiagnosisReport JSON | 标准模型 | - |

### 5.2 Sprint Contract 模式

借鉴 Anthropic 的 Sprint Contract 实践：在 Agent 开始诊断前，Orchestrator（Planner）和 Evaluator 先就"什么是好的诊断"达成共识。

```python
# 每个诊断任务的 Sprint Contract
{
    "submission_id": "sub_xxx",
    "experiment_category": "process",
    "contract": {
        "what_to_diagnose": [
            "代码结构质量（依赖 AST + LLM）",
            "测试失败根因（依赖测试结果 + strace）",
            "OS 概念正确性（依赖概念 Rubric）",
            "系统调用行为异常（依赖 strace 模式分析）",
            "内核级行为（依赖 eBPF，如有）",
            "性能热点（依赖火焰图，如有）"
        ],
        "evaluation_criteria": {           # ← 硬阈值（借鉴 Anthropic）
            "correctness_accuracy": 0.80,  # 正确性诊断准确率 ≥ 80%
            "evidence_quality": 0.70,      # 诊断有具体证据支撑 ≥ 70%
            "actionability": 0.75,         # 建议可操作性 ≥ 75%
            "safety_compliance": 1.0       # 安全合规 = 100%（硬性要求）
        },
        "hard_fail_rules": [
            "诊断不得包含完整解答代码",
            "诊断必须有具体证据引用（文件+行号或 strace 行号）",
            "概念达成度评分必须有 Rubric 对照依据"
        ]
    }
}
```

**关键设计**：
- **硬阈值（Hard Threshold）**：任何一条标准低于阈值 → 诊断不合格，回到 Generator 修正或触发人工复审
- **硬失败规则（Hard-Fail Rules）**：二进制 VIOLATED/CLEAR 判定，违反任何一条直接拦截。不使用评分量表——这是"是/否"的判断，不是"好/坏"的程度判断

---

## 六、多维评估体系设计（含校准策略）

### 6.1 六维评估模型

```
                    正确性 (30%)
                   /    \
                  /      \
      性能效率 (5%)       完整性 (15%)
              \          /
               \        /
              总分 100分
               /        \
              /          \
     运行时行为 (10%)    OS概念理解 (25%)
                    \    /
                     \  /
                  代码质量 (15%)
```

| 维度 | 权重 | 评估方法 | 评分器类型 | 为什么用这种评分器 |
|------|------|---------|-----------|-------------------|
| **正确性** | 30% | 加权测试通过率 | **确定性评分器**（代码计算） | 测试结果数学可计算，不需要 LLM |
| **完整性** | 15% | 实验要求覆盖度 | **LLM 评分器**（经校准） | 需求覆盖需要语义理解 |
| **OS 概念理解** | 25% | 概念 Rubric 逐项评估 | **LLM 评分器**（经校准） | 概念正确性需要深度推理 |
| **代码质量** | 15% | AST 模式 + LLM 评审 | **混合评分器**（规则 + LLM） | 结构问题规则可检测，语义问题需 LLM |
| **运行时行为** | 10% | strace 模式 + eBPF | **确定性评分器**（代码计算） | FD/内存/进程计数可直接计算 |
| **性能效率** | 5% | 火焰图 + 执行时间 | **混合评分器**（执行时间 + LLM） | 时间可直接测量，热点解读需 LLM |

**核心原则**：**能确定计算的，绝不用 LLM。** 借鉴 Stripe Minions 的设计——"Don't burn tokens on what code can do." 确定性评分器（测试通过率、FD 平衡检测、内存平衡检测）是 Agent 无法跳过的墙；LLM 评分只在需要语义理解时使用。

### 6.2 LLM-as-Judge 校准策略

**为什么需要校准**：未经校准的 LLM 评分存在系统性偏差——位置偏差（Position Bias）、冗长偏好（Verbosity Bias）、中间分膨胀（Middle Score Inflation）、自我偏好（Self-Preference Bias）。校准是让评分从"不可信"变为"可部署"的唯一路径。

```
校准流程:
1. 构建 Gold Set（金标集）
   └─ 抽取 50-200 份历史提交，由 2 位以上教师独立人工评分
   └─ 标注涵盖: 正确性 / 概念理解 / 代码质量 / 完整性

2. Judge Prompt 调优（G-EVAL Chain-of-Thought 四部分结构）
   └─ ① 领域词汇定义标准: "正确"="根因分析准确，无冗余信息"
   └─ ② 推理结构: "Step1:检查根因→Step2:检查证据→Step3:检查概念→Step4:综合评分"
   └─ ③ 确定性评分规则: 使用 3 点量表 (0/1/2)，禁止 5 点以上——模型无法有效使用
   └─ ④ 边界处理: "含多个子问题时，全部正确才算 2"; "触及安全红线→自动判 0"

3. 计算 Cohen's Weighted Kappa
   └─ κ ≥ 0.80 → 可自动部署，人审仅抽查 5%
   └─ κ 0.61-0.79 → 可部署 + 人工复审低置信度结果
   └─ κ 0.41-0.60 → 需修正 Rubric + 注入 Few-Shot 示例
   └─ κ < 0.41 → 重新设计 Rubric

4. 持续校准
   └─ 每季度重校一次
   └─ 每次换 Judge 模型后重校（Claude/GPT 同 Rubric 分布不同）
   └─ 追踪 Judge-vs-Human 漂移度，超过基线 +0.05 → Rubric 标记为需修订
```

**二元硬失败规则**（独立于 3 点评分量表）:
- 诊断包含完整解答代码 → BINARY: VIOLATED
- 概念评分无 Rubric 对照依据 → BINARY: VIOLATED
- 幻觉引用（引用的文件行号不存在）→ BINARY: VIOLATED

### 6.3 评分器混合架构（借鉴 Stripe Blueprint）

```
                    评测完成事件
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │确定性评分 │  │规则引擎   │  │LLM 评审  │
    │(代码执行) │  │(模式检测) │  │(经校准)  │
    ├──────────┤  ├──────────┤  ├──────────┤
    │测试通过率│  │FD 平衡   │  │代码质量  │
    │执行时间  │  │内存平衡  │  │概念达成度│
    │输出匹配  │  │进程回收  │  │内核行为  │
    │          │  │Trace Diff│  │性能建议  │
    └────┬─────┘  └────┬─────┘  └────┬─────┘
         │             │             │
         └─────────────┼─────────────┘
                       │
                       ▼
              ┌────────────────┐
              │ Evaluator Agent │  ← 独立评分（已校准 Judge）
              │ 综合六维评分    │
              │ 交叉验证        │
              │ 置信度评估      │
              └────────────────┘
```

> **为什么混合？** 纯 LLM 评估成本高、不稳定、有偏差；纯规则评估覆盖不全、无法理解语义。混合架构是 Stripe（Minions）、Anthropic、OpenAI Codex 的共识方案。确定性的归确定性，语义的归 LLM——两者之间用 Evaluator 做最终仲裁。

### 6.4 实验专属概念 Rubric（改进版）

为每种实验类型定义可独立评估的**原子化**概念 Rubric，每个 Rubric 度量单一可观测属性：

```json
{
  "experiment_id": "exp_process_001",
  "category": "process",
  "rubric_version": "2.0",
  "calibration": {
    "kappa": 0.83,
    "calibrated_by": "teacher_panel_3",
    "calibrated_at": "2026-08-01",
    "judge_model": "claude-sonnet-5"
  },
  "concept_rubrics": [
    {
      "concept": "fork创建子进程",
      "weight": 20,
      "atomic_criteria": [                          // ← 原子化：每个标准度量单一属性
        "代码中存在 fork() 调用（二元判定）",
        "fork() 返回值被正确处理（区分父子进程）",
        "父子进程执行了不同逻辑分支"
      ],
      "evidence_mapping": {                         // ← 证据映射：标准→可验证信号
        "primary": "strace 中 clone/fork 系统调用",
        "secondary": "代码中 fork() 调用点 + AST 控制流图"
      },
      "scoring_scale": "3-point",                   // ← 最低精度可用即可
      "scale_anchors": {
        "0": "未使用 fork 或完全错误",
        "1": "使用 fork 但存在返回值处理缺陷",
        "2": "正确使用 fork 且父子逻辑清晰分离"
      }
    }
    // ... 其余概念 Rubric 同理
  ],
  "hard_fail_rules": [                              // ← 硬失败规则（独立于评分）
    "子进程不存在 wait/waitpid 调用 → 标记严重缺陷",
    "管道创建后所有端均未关闭 → 标记资源泄漏"
  ]
}
```

---

## 七、数据流全链路

```
                          代码提交 (Student)
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  E 执行层: 评测执行 (Go Core Service - 现有，增强)                    │
│                                                                      │
│  编译 → 沙箱运行 + strace → 解析 syscall → 模式识别 →                 │
│  Trace Diff → 采集内存布局 → perf 火焰图 → eBPF 事件 → AST 分析       │
│                                                                      │
│  [增强] 全部数据源打包进 EvaluationCompletedEvent（含火焰图+eBPF+AST）│
│  [增强] 事件增加 trace_id / span_id 字段（OpenTelemetry 传播）        │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ NATS Event (完整数据包 + Trace Context)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  C 上下文层: DataCollector                                           │
│                                                                      │
│  并行收集 8 种数据源 → 按 Agent 需求分组 → ContextPackage             │
│  渐进式注入: 阶段1(意图识别) → 阶段2(领域诊断) → 阶段3(综合评估)       │
│  Context Firewall: 每个 Agent 仅接收其领域数据，预算 < 40% 窗口利用率  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ ContextPackage (8源 + 渐进式标记)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  L 生命周期层: Planner → Generator×5 → Evaluator → ReportGenerator   │
│                                                                      │
│  Planner: 分析评测结果 → 制定诊断计划 → 分发 Context（Context Firewall）│
│  Generator×5: 并行执行 → 各自产出诊断报告（独立上下文）               │
│  Evaluator: 独立校验 → 校准后评分 → 一致性检查 → 置信度评估           │
│  ReportGenerator: 综合报告 + 学习建议                                 │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ 全量 Span 导出
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  O 可观测层: Langfuse + OpenTelemetry                                │
│  ├─ 每个 LLM 调用: gen_ai.client span — latency / tokens / model     │
│  │                 / finish_reason                                    │
│  ├─ 每个 Tool 调用: gen_ai.tool span — name / arguments / success    │
│  │                  / latency                                         │
│  ├─ 每个 Agent: gen_ai.agent span — total_tokens / duration /        │
│  │              task_completion                                       │
│  └─ 异常告警: 评分分布突变 / 诊断耗>30s / 错误率飙升                  │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  V+G 校验+治理层: EvaluationGuard                                    │
│                                                                      │
│  ├─ 置信度检查: confidence < 0.6 → 降级到规则诊断                     │
│  ├─ 一致性检查: Agent 间评分偏差 > 15% → 标记人工复审                  │
│  ├─ 安全约束: 诊断不含完整解答 → 违反则截断 + 教师端告警               │
│  ├─ 持久化: 诊断报告 + 各 Agent 中间结果 + 完整 Trace 入库            │
│  └─ 知识沉淀: 典型错误模式 → 错误模式库（Ratchet 积累）                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 八、数据库设计

### 8.1 核心表

```sql
-- 诊断报告表
CREATE TABLE diagnosis_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES submissions(id),
    student_id UUID NOT NULL,
    experiment_id UUID NOT NULL,
    trace_id UUID,                           -- OpenTelemetry trace_id
    status VARCHAR(20) NOT NULL DEFAULT 'pending',

    -- 六维评分（经过 Evaluator 校准的最终分）
    correctness_score DECIMAL(5,2),          -- 正确性 (0-30)
    completeness_score DECIMAL(5,2),         -- 完整性 (0-15)
    concept_score DECIMAL(5,2),              -- OS 概念理解 (0-25)
    code_quality_score DECIMAL(5,2),         -- 代码质量 (0-15)
    runtime_behavior_score DECIMAL(5,2),     -- 运行时行为 (0-10)
    performance_score DECIMAL(5,2),          -- 性能效率 (0-5)
    total_score DECIMAL(5,2),

    -- 原始评测（确定性评分器产出）
    raw_test_score INT,
    raw_output_score INT,
    raw_structure_score INT,
    raw_behavior_score INT,

    -- 诊断内容
    summary TEXT,
    strength_points JSONB DEFAULT '[]',
    weakness_points JSONB DEFAULT '[]',
    related_concepts JSONB DEFAULT '[]',
    related_syscalls JSONB DEFAULT '[]',
    suggested_fixes JSONB DEFAULT '[]',      -- 按优先级排序
    feedback_levels JSONB DEFAULT '{}',

    -- 可视化数据
    radar_data JSONB DEFAULT '{}',
    concept_radar JSONB DEFAULT '{}',

    -- 校验元数据
    confidence_score DECIMAL(3,2),           -- Evaluator 置信度
    agent_agreement_score DECIMAL(3,2),      -- Agent 间一致性评分
    evaluator_model VARCHAR(50),             -- Judge 模型 ID
    evaluator_rubric_version VARCHAR(20),    -- Rubric 版本
    requires_review BOOLEAN DEFAULT FALSE,
    review_reason TEXT,
    calibration_kappa DECIMAL(3,2),          -- 当时使用的 Judge κ 值

    -- 成本追踪
    llm_model VARCHAR(50),
    llm_tokens_used INT,
    total_cost_cents INT,

    generated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 各 Agent 中间结果（用于溯源）
CREATE TABLE agent_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES diagnosis_reports(id),
    agent_name VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    result_json JSONB NOT NULL,
    assembled_prompt TEXT,                   -- 组装的完整 Prompt（用于审计）
    confidence_score DECIMAL(3,2),
    tokens_used INT,
    execution_ms INT,
    span_id UUID,                            -- OpenTelemetry span_id
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 实验概念 Rubric 表（版本化管理）
CREATE TABLE experiment_rubrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id),
    version VARCHAR(20) NOT NULL DEFAULT '1.0',
    category VARCHAR(20) NOT NULL,
    rubric_json JSONB NOT NULL,              -- 完整 Rubric 定义
    calibration_kappa DECIMAL(3,2),          -- 该版本的校准 κ 值
    judge_model VARCHAR(50),                 -- 校准时使用的 Judge 模型
    calibrated_by VARCHAR(100),              -- 校准人/团队
    calibrated_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (experiment_id, version)
);

-- 错误模式知识库（Ratchet 积累）
CREATE TABLE error_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(20) NOT NULL,
    pattern_name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    typical_causes JSONB DEFAULT '[]',
    fix_strategies JSONB DEFAULT '[]',
    related_concepts JSONB DEFAULT '[]',
    occurrence_count INT DEFAULT 0,
    first_seen_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    source_agent VARCHAR(50),                -- 哪个 Agent 发现的
    source_diagnosis_id UUID,                -- 来源诊断
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_dr_submission ON diagnosis_reports(submission_id);
CREATE INDEX idx_dr_student ON diagnosis_reports(student_id);
CREATE INDEX idx_dr_experiment ON diagnosis_reports(experiment_id);
CREATE INDEX idx_dr_status ON diagnosis_reports(status);
CREATE INDEX idx_dr_confidence ON diagnosis_reports(confidence_score)
    WHERE confidence_score < 0.6;            -- 快速查询低置信度记录
CREATE INDEX idx_ar_report ON agent_results(report_id);
CREATE INDEX idx_er_experiment ON experiment_rubrics(experiment_id);
CREATE INDEX idx_er_active ON experiment_rubrics(experiment_id)
    WHERE is_active = TRUE;
```

---

## 九、实施路线图

### Phase 1: 数据基础设施 + 评估校准 (Week 1-2)

| 任务 | 内容 | 产出 | 优先级 |
|------|------|------|--------|
| 1.1 | 创建全部数据库表（含迁移脚本） | SQL 迁移 | 🔴 阻塞 |
| 1.2 | 为 6 种实验类型编写初始 Rubric，定义评分标准和证据映射 | `rubric_templates.json` | 🔴 阻塞 |
| 1.3 | 构建 Gold Set：抽取 100 份历史提交，3 位教师独立评分 | 金标数据集 | 🔴 阻塞 |
| 1.4 | 校准 Judge：在 Gold Set 上迭代 Rubric → κ ≥ 0.80 | 校准报告 + Judge Prompt | 🔴 阻塞 |
| 1.5 | 扩展 EvaluationCompletedEvent（增加火焰图 + eBPF + AST） | NATS Schema 更新 | 🟡 |
| 1.6 | 创建 DiagnosisContext 数据模型 + Context Firewall 逻辑 | `context_package.py` | 🟡 |

### Phase 2: Agent 矩阵搭建 (Week 3-4)

| 任务 | 内容 | 产出 |
|------|------|------|
| 2.1 | 实现 CodeAnalyzerAgent（AST 规则 + LLM 混合） | `agents/diagnosis/code_analyzer.py` |
| 2.2 | 实现 TestEvaluatorAgent | `agents/diagnosis/test_evaluator.py` |
| 2.3 | 实现 SyscallAnalyzerAgent（规则优先 + LLM 补充） | `agents/diagnosis/syscall_analyzer.py` |
| 2.4 | 实现 ConceptRubricAgent（使用校准后 Rubric） | `agents/diagnosis/concept_rubric.py` |
| 2.5 | 实现 Evaluator Agent（独立 + 校准后 Judge Prompt） | `agents/diagnosis/evaluator.py` |
| 2.6 | 为每个 Agent 设计专用 System Prompt（含 Context Firewall + 40% 预算约束） | `prompts/diagnosis_agents.py` |

### Phase 3: 编排层 + 报告 (Week 5-6)

| 任务 | 内容 | 产出 |
|------|------|------|
| 3.1 | 实现 DiagnosisOrchestrator（Planner + Generator Router） | `agents/diagnosis_orchestrator.py` |
| 3.2 | 实现 ReportGeneratorAgent | `agents/diagnosis/report_generator.py` |
| 3.3 | 实现 OpenTelemetry 插桩（gen_ai.client + gen_ai.agent + gen_ai.tool spans） | `services/tracing.py` |
| 3.4 | 集成 Langfuse（全链路可视化） | 配置文件 |
| 3.5 | 升级 diagnosis.py router → 使用 Orchestrator | 修改 `routers/diagnosis.py` |

### Phase 4: eBPF + Perf 深度集成 (Week 7)

| 任务 | 内容 | 产出 |
|------|------|------|
| 4.1 | 实现 eBPFAnalyzerAgent | `agents/diagnosis/ebpf_analyzer.py` |
| 4.2 | 实现 PerfAnalyzerAgent | `agents/diagnosis/perf_analyzer.py` |
| 4.3 | 数据源打通：eBPF/火焰图/内存布局注入 DiagnosisContext | 修改 pipeline.go + events.go |

### Phase 5: 治理校验体系 (Week 8)

| 任务 | 内容 | 产出 |
|------|------|------|
| 5.1 | 实现 EvaluationGuard（置信度/一致性/安全约束检查） | `evaluation_guard.py` |
| 5.2 | 实现降级策略链（LLM → 规则引擎 → 模板诊断） | `fallback.py` |
| 5.3 | 实现完整解答泄漏检测 + 截断 | `safety_filter.py` |
| 5.4 | 实现人工复审触发机制 + 教师端通知 | 通知系统集成 |
| 5.5 | 实现校准漂移监控（κ 季度跟踪） | `calibration_monitor.py` |

### Phase 6: 知识沉淀 + 历史追踪 (Week 9-10)

| 任务 | 内容 | 产出 |
|------|------|------|
| 6.1 | 实现错误模式自动入库（典型错误 → ErrorPatternKB） | `error_kb.py` |
| 6.2 | 实现学生进步追踪（多次提交六维雷达对比） | `student_progress.py` |
| 6.3 | 实现班级统计（平均分、高频错误分布、班级排名） | `class_stats.py` |
| 6.4 | 实现 Ratchet 自动建议：新错误模式 → 建议加入 ErrorPatternKB | `ratchet_suggestions.py` |

### Phase 7: 前端升级 (Week 11-12)

| 任务 | 内容 | 产出 |
|------|------|------|
| 7.1 | 诊断结果页：六维雷达图 + 概念达成度柱状图 | 新组件 |
| 7.2 | Agent 分析结果 Tab 切换 + 证据引用高亮 | 新组件 |
| 7.3 | 历史提交六维对比曲线 | 新组件 |
| 7.4 | 教师端：实验概念 Rubric 编辑器（可视化配置） | 新组件 |
| 7.5 | 教师端：诊断质量 Dashboard（准确率/人工复审率/κ 漂移） | 新组件 |

---

## 十、风险与反模式

### 10.1 已知风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **LLM 评分偏差** | 学生收到不公平的诊断 | 校准 κ ≥ 0.80 才上线；低置信度走人工复审 |
| **多 Agent 诊断总耗时过长** | 学生等待 > 30s | 并行执行；轻量模型用于规则型 Agent；异步通知 |
| **Harness 过度工程化** | 维护成本高，模型升级后逻辑过时 | 定期审计：每个组件必须可追溯到真实失败；Bitter Lesson：模型升级后移除不再需要的约束 |
| **Rubric 校准漂移** | 评分逐渐偏离教师标准 | 每季度重校；换模型后强制重校；追踪 κ 趋势 |
| **Context Firewall 遗漏关键数据** | 某 Agent 因缺少数据而误判 | Firewall 规则基于实验类型可配置；Evaluator 交叉验证可检测信息不完整 |
| **Brownfield 挑战** | 旧版诊断结果与新系统不兼容 | 分阶段迁移；旧版诊断保持只读 |

### 10.2 反模式警告

| 反模式 | 为什么危险 | 正确做法 |
|--------|-----------|---------|
| 把所有数据注入每个 Agent | Context Anxiety → 输出质量在 40% 利用率后急剧下降 | Context Firewall：每个 Agent 仅接收需要的数据 + Token 预算硬约束 |
| 让同一个 Agent 自评 | 自我评价偏差 → 分数系统性偏高 | 独立的 Evaluator Agent（不看 Generator 上下文） |
| "用你的判断打分" | 评分不可复现，无法校准 | 具体的原子化标准 + 证据映射 + 分数锚点 |
| 5 点以上评分量表 | LLM 无法有效区分，中间分膨胀 | 3 点（0/1/2）或二元判定（0/1） |
| 不做金标校准就上线 | LLM 分数与教师标准偏差无法检测 | 50+ 金标样本 → κ ≥ 0.80 → 上线 |
| 把"不许泄露答案"写在 Prompt 里 | 模型可能忽略 | 输出后确定性过滤 + 截断（机械执行 > Prompt 指令） |
| 诊断缓存仅用 SHA256 | 相同代码不同实验上下文应有不同诊断 | 缓存键 = hash(code + experiment_id + rubric_version) |
| 规范性的约束（"应该做 X"） | 模型升级后可能不再需要，但 Harness 不知道 | 每个约束标注来源（追溯到具体失败事件 + 日期） |

---

## 十一、技术决策记录

| 决策 | 选项 | 选择 | 理由 | 来源 |
|------|------|------|------|------|
| Agent 编排框架 | LangGraph / 自建 / CrewAI | **LangGraph** | 已有基础 + StateGraph 支持并行分支 + 社区成熟 | 内部积累 |
| Agent 间通信 | NATS / HTTP / 内存 | **内存 + NATS** | 轻量 Agent 间内存传递 + 跨服务 NATS 解耦 | - |
| 评估模型分工 | 单一模型 / 多模型分工 | **多模型分工** | 代码/规则用轻量模型（省成本），诊断/评分用标准模型。不要用 Token 做代码能做的事。 | Stripe Minions |
| 生成-评估分离 | 自评 / 独立评估 | **独立 Evaluator Agent** | Agent 自评系统偏差严重，唯一解法是分离 | Anthropic |
| 概念 Rubric | 硬编码 / DB / Prompt 内联 | **DB 存储 + 版本化** | 可动态配置；版本化管理支持校准漂移追踪；教师可自定义 | - |
| 评分校准 | LLM 自评 / 人工抽检 / 交叉验证 | **交叉验证 + Gold Set 校准** | 金标 κ ≥ 0.80 可信任自动评分；低于阈值人工复审 | GEDD / AgentEval |
| 评分量表 | 5 点 / 10 点 / 3 点 / 二元 | **3 点为主，二元硬规则为辅** | 3 点足够区分 (fail/partial/pass)；硬失败规则用二元。模型无法有效使用 5 点以上精度 | MT-Bench / G-Eval 2026 |
| 报告存储 | JSON 字段 / 独立表 | **独立表 + JSON 字段** | 结构化评分独立列可查询排序 + 灵活内容 JSON | - |
| 可观测平台 | 自建 / Langfuse / Arize | **Langfuse**（开源 MIT） | 自托管、OTel 原生、LLM 语义支持好、成本归因清晰 | - |
| 错误模式积累 | 专家录入 / 自动发现 | **自动发现 + 人工确认** | Ratchet 原则：每次 Agent 发现新模式 → 候选入库 → 教师确认 → 永久规则 | Mitchell Hashimoto |

---

## 十二、成功指标

| 指标 | 当前值 | 目标值 | 测量方法 |
|------|--------|--------|---------|
| 诊断准确率 | ~70%（单一 LLM） | > 85%（多 Agent + 独立 Evaluator） | 教师抽查 100 份诊断，计算与教师判断一致率 |
| Judge κ 值 | 未测量 | ≥ 0.80（可自动部署） | Gold Set 上计算 Cohen's Weighted Kappa |
| 评估维度 | 3 维 | 6 维 + 概念级 | 直接计数 |
| 概念级评估 | 无 | 每种实验 6-8 个概念逐项打分 | 直接计数 |
| 诊断覆盖率 | 只覆盖测试失败 | 覆盖全部 8 种数据源 | 每种数据源是否有对应 Agent 产出 |
| 诊断平均耗时 | ~15s | < 25s（并行 Agent） | OpenTelemetry Span 时长 |
| 人工复审率 | N/A | < 15%（即 85% 自动通过） | Evaluator 日志统计 |
| 诊断可解释性 | 单一 LLM 输出 | 每维度可溯源到具体 Agent + 证据引用 | 抽查报告中证据引用率 |
| Agent 间一致性 | 未测量 | 评分偏差 < 15% | Evaluator 交叉验证日志 |
| 校准漂移 | N/A | 季度 κ 波动 < 0.05 | 季度重校对比 |
| 上下文利用率 | 未测量 | 每个 Agent < 40% 窗口容量 | Token 预算校验日志 |

---

## 十三、与 AI 提问模块的协作

两个 Agent 系统基于同一 ETCLOVG 基础设施：

```
                        共享基础设施
    ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐
    │ RAG引擎 │  │ 知识图谱  │  │ 学生画像  │  │ 错误模式库│  │ Langfuse  │
    │ (共用)  │  │ (共用)   │  │ (共用)   │  │ (诊断专用)│  │ (共用)    │
    └─────────┘  └──────────┘  └──────────┘  └───────────┘  └───────────┘

    AI 提问 Harness                AI 诊断 Harness
    ┌──────────┐ ┌──────────┐    ┌──────────┐ ┌────────┐ ┌──────────┐
    │Supervisor│ │TutorAgent│    │Planner   │ │Gen×5   │ │Evaluator │
    └──────────┘ └──────────┘    └──────────┘ └────────┘ └──────────┘

    对话上下文复用: 诊断报告 → AI 提问 Agent 可引用
    诊断知识反哺: AI 提问中发现的常见错误 → 注入 ConceptRubric 评估
    Ratchet 共享: 两个系统共享 ErrorPatternKB，错误只入一次库
```

---

> **文档版本**: v2.1
> **最后更新**: 2026-08-06
> **变更**: 基于 Harness 工程最佳实践（Anthropic / Stripe / OpenAI / ETCLOVG）全面重写；新增「行业最佳实践参考」章节，引入 arXiv 2605.18747 的 9 大核心组件框架、Context Anxiety 40% 阈值硬约束、G-EVAL CoT 四部分 Judge Prompt 结构、Stripe 混合评分器架构