# TraceOS 观测-AI 联动教学诊断方案

> **核心命题**：如何让观测数据"开口说话"——将 eBPF 系统调用、火焰图热点、内存分配、锁竞争、资源波动等底层数据，转化为 AI 诊断与 AI 提问能理解的结构化上下文，实现从「数据可视化」到「智能教学引导」的质变。

> **设计目标**：观测系统调用 → 发现并发竞争 → 定位资源泄漏 → 检测死锁 → 展示过程 → 交给 AI 诊断 → 结合实验逻辑 → 提供精准、启发式、可解释的教学引导。

---

## 一、当前状态与核心差距

### 1.1 AI 诊断现有能力 (来自 agent-diagnosis-upgrade-plan.md)

| 已具备 | 状态 |
|--------|------|
| 8 种数据源各自独立采集 | ✅ |
| 代码提交 → 编译运行 → strace → 打分 → LLM 诊断 | ✅ |
| AST 模式检测 (FD 泄漏/内存不均衡/僵尸进程/段错误) | ✅ |
| eBPF 分析独立端点 | ✅ |
| 火焰图 AI 解读独立端点 | ✅ |
| Trace 分析独立端点 | ✅ |
| 死锁检测 + eBPF 实时事件流 | ✅ |

### 1.2 核心差距：数据→AI 的鸿沟

```
当前状态 (数据孤岛):
  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐
  │ eBPF    │  │ 火焰图   │  │ Trace   │  │ 内存     │
  │ 分析     │  │ 分析     │  │ 分析    │  │ 分析     │
  │ (孤立)  │  │ (孤立)   │  │ (孤立)  │  │ (孤立)   │
  └─────────┘  └─────────┘  └─────────┘  └──────────┘
       │             │            │            │
       └─────────────┴────────────┴────────────┘
                     │
              各自独立调用 LLM
              无跨数据源关联
              AI 看不到完整"故事"

目标状态 (数据融合 → AI 推理):
  ┌─────────────────────────────────────────┐
  │         ObsContext (统一观测上下文)       │
  │  ┌──────┬──────┬──────┬──────┬──────┐  │
  │  │eBPF  │火焰图│Trace │内存  │资源  │  │
  │  │事件  │热点  │时序  │分配  │指标  │  │
  │  └──────┴──────┴──────┴──────┴──────┘  │
  └─────────────────┬───────────────────────┘
                    │ 结构化注入
         ┌──────────┼──────────┐
         ▼                     ▼
  ┌─────────────┐      ┌─────────────┐
  │ AI 诊断 Agent│      │ AI 提问 Agent│
  │ (自动触发)  │      │ (交互触发)   │
  └──────┬──────┘      └──────┬──────┘
         │                    │
         └────────┬───────────┘
                  ▼
    ┌──────────────────────────┐
    │  教学引导输出             │
    │  • 根因分析 + 证据链      │
    │  • OS 概念映射            │
    │  • 实验逻辑关联           │
    │  • 苏格拉底式渐进提示     │
    │  • 修复建议 + 学习路径    │
    └──────────────────────────┘
```

---

## 行业最佳实践参考

本方案深度融合 2026 年 AI 可观测性领域的四大核心实践，确保 TraceOS 的观测-AI 联动体系达到生产级标准。

### OpenTelemetry GenAI 语义约定 (2026 年 5 月)

OpenTelemetry 社区于 2026 年 5 月正式发布 GenAI 语义约定，为 LLM 应用的可观测性提供了统一标准。TraceOS 观测管线全面对齐该规范：

| 约定层级 | 成熟度 | TraceOS 映射 |
|---------|--------|-------------|
| **gen_ai.client spans** | Stable | 每次 LLM 调用（诊断 Agent、提问 Agent）均生成标准 client span，记录 model、token usage |
| **gen_ai.agent spans** | Experimental | Agent 级编排（Orchestrator、Evaluator）使用 agent span。注意：experimental 状态意味着未来稳定化时可能存在字段重映射成本，TraceOS 在 agent span 的字段选择上保持克制，仅记录 task、agent_id、parent_span 等核心属性 |
| **Events 与 Metrics** | Stable | 诊断完成、Issue 发现、教学引导触发等关键事件以 OTel Event 形式挂载到 span；评分延迟、Token 消耗、工具成功率以 OTel Metrics 形式导出 |

**每个 LLM 调用必须发出的信号**（对齐 OTel GenAI 规范）:

```
span.name = "gen_ai.client.chat {model_name}"
span.attributes:
  ├─ gen_ai.system = "anthropic" | "openai" | ...
  ├─ gen_ai.request.model = "claude-sonnet-5"
  ├─ gen_ai.usage.input_tokens = 3420
  ├─ gen_ai.usage.output_tokens = 856
  ├─ gen_ai.response.finish_reason = "stop" | "tool_calls" | "length"
  ├─ gen_ai.response.latency_ms = 1523
  └─ traceos.diagnosis.agent = "SyscallAnalyzer"    (自定义属性)
```

**每个工具调用必须发出的信号**:

```
span.name = "gen_ai.tool.call {tool_name}"
span.attributes:
  ├─ gen_ai.tool.name = "run_strace"
  ├─ gen_ai.tool.arguments = "{...}"                (敏感参数已脱敏)
  ├─ gen_ai.tool.success = true | false
  ├─ gen_ai.tool.latency_ms = 340
  └─ gen_ai.tool.error_message = "..."              (仅失败时)
```

### Langfuse 全栈追踪

TraceOS 选择 Langfuse 作为可观测性后端，基于以下评估：

- **自托管 + OTel 原生**：Langfuse 为 MIT 许可证的开源项目，支持私有化部署，原生兼容 OpenTelemetry 协议，无需额外的数据格式转换层
- **LLM 语义支持**：Token 成本可按 session/agent 维度归因，自动关联 gen_ai.client span 到端到端追踪链路
- **质量仪表板**：
  - 诊断准确率趋势（教师抽样 vs AI 评分对比曲线）
  - 学生满意度（对话后评分 + 问题解决率）
  - 人工复审率（低置信度诊断触发教师介入的比例）
  - 概念级评估热力图（各 OS 概念的正确率分布）
- **异常告警**：
  - 评分分布突变检测（某实验类型的评分中位数突然偏离历史基线）
  - 延迟尖峰告警（P95 诊断耗时超过 30s）
  - Token 成本异常（单次诊断成本超过预设预算上限）
  - Judge κ 漂移告警（季度校准中 κ 值下降超过 0.05）

### LLM-as-Judge 校准 (G-EVAL Chain-of-Thought 模式)

TraceOS 的 AI 评估体系遵循 G-EVAL 2026 最佳实践，采用严格的校准流程确保 LLM Judge 评分的可信度和可复现性。

**四部分 Judge Prompt 结构**（G-EVAL CoT 规范）:

```
① 领域词汇定义标准
   "正确" = 根因分析准确，无冗余或无关信息
   "完整" = 覆盖所有检测到的问题，且有证据支撑
   "可操作" = 修复建议包含具体代码位置和修改方向

② 推理结构 (Chain-of-Thought)
   Step 1: 先检查根因是否正确 — 对照 Gold Set 中人评结论
   Step 2: 再检查证据引用 — 是否每条结论都有 trace/strace/ebpf 来源
   Step 3: 再检查概念映射 — 是否正确关联到 OS 核心概念
   Step 4: 最后给出综合评分

③ 确定性评分规则
   使用 3 点量表 (0/1/2):
     0 = 不正确/不完整/不可操作
     1 = 部分正确/基本完整/可操作但不够精确
     2 = 完全正确/完整/精确可操作
   ⚠ 禁止使用 5 点以上量表 — 模型无法有效利用 5+ 级精度 (MT-Bench 2025 结论)

④ 边界情况处理
   - 含多个子问题时，全部正确才算 2
   - 诊断触及安全红线（泄露完整答案），自动判 0
   - 诊断包含超出实验范围的内容，不影响正确性评分但标记为冗余
```

**Cohen's Weighted Kappa 分级决策框架**:

| κ 范围 | 决策 | 操作 |
|--------|------|------|
| **κ ≥ 0.80** | 自动部署 | LLM Judge 评分直接采用，人工仅做 5% 抽样审计 |
| **κ 0.61-0.79** | 部署 + 人工复审 | 自动评分上线，但低置信度结果（confidence < 0.6）升级人工 |
| **κ 0.41-0.60** | 修订 Rubric | 评分不可直接使用，需要注入更多 Few-Shot 示例或调整分数锚点 |
| **κ < 0.41** | 重新设计 | Rubric 存在根本性问题，需要从 Gold Set 重新构建 |

**二元硬失败规则**（独立于 3 点评分量表，安全约束不受 κ 影响）:

- 诊断包含完整解答代码 → BINARY: VIOLATED，诊断强制截断
- 概念评分无 Rubric 对照依据 → BINARY: VIOLATED，该维度回退到规则引擎
- 幻觉引用（引用的文件行号不存在）→ BINARY: VIOLATED，整份诊断标记为不可信

**校准节奏**:

- 每季度进行一次全量重校（覆盖全部活跃实验类型的 Rubric）
- 每次更换 Judge 模型（如 Claude → GPT 互切换，或 Sonnet → Opus 升级）→ 强制重校
- 追踪 Judge-vs-Human 漂移度：评估集中保留 10% 样本，每季度由教师重评，对比 Judge 评分走势。漂移超过基线 +0.05 → Rubric 标记为需修订

### Context Anxiety 40% 阈值

Anthropic 工程团队 2025 年的研究表明：**Agent 输出质量在上下文窗口利用率超过约 40% 时开始急剧下降**——这一现象被称为 Context Anxiety。TraceOS 在多方位的设计中内化了这一发现：

- **Context Firewall 模式**：每个 Agent 仅接收其诊断领域所需的数据切片，而非全部 8 种数据源的一揽子注入。SyscallAnalyzer 看不到火焰图数据，CodeAnalyzer 看不到 eBPF 事件流——这不是数据遗漏，而是刻意的信息隔离
- **渐进式披露**：上下文按阶段逐步展开——意图识别阶段仅注入 ~200 tokens 的实验元信息；领域诊断阶段注入 ~3K tokens 的领域专用数据；综合评估阶段注入全部 Agent 报告摘要而非原文
- **四级 Token 水位线**：30%（Micro 截断）→ 60%（Slide 价值裁剪）→ 80%（Summary LLM 压缩）→ 95%（Emergency 阻止新调用）
- **硬约束**：任何 Agent 的上下文组包逻辑必须通过 Token 预算校验——预算超标则拒绝注入，迫使 DataCollector 使用摘要而非全量数据

---

## 二、ObsContext：统一的观测-AI 上下文协议

### 2.1 核心设计理念

ObsContext 不是简单的数据聚合，而是**将原始观测数据翻译为 AI 可理解的语义表示**：

```
原始数据:                       ObsContext (语义化):
┌──────────────────┐           ┌──────────────────────────────┐
│ syscall: clone   │           │ 🔵 进程创建:                  │
│ ret: 102         │           │    父进程 PID=100             │
│ time: T+0ms      │    →      │    fork() 创建子进程 PID=101  │
│                  │           │    这是进程管理实验的核心操作  │
│ syscall: execve  │           │                               │
│ ret: 0           │           │ 🔵 程序加载:                  │
│ time: T+2ms      │    →      │    子进程 execve() 加载新程序 │
│                  │           │    替换了进程的地址空间        │
│ syscall: wait4   │           │                               │
│ ret: 101         │           │ 🟢 进程回收 (正确!):          │
│ time: T+500ms    │    →      │    父进程 wait() 回收子进程   │
│                  │           │    状态=正常退出, code=0       │
└──────────────────┘           └──────────────────────────────┘
```

### 2.2 ObsContext 数据模型

```go
// core/types/obs_context.go

type ObsContext struct {
    // ── 基础信息 ──
    SubmissionID   string           `json:"submission_id"`
    ExperimentID   string           `json:"experiment_id"`
    StudentCode    string           `json:"student_code"`
    ExperimentType string           `json:"experiment_type"` // process/thread/memory/io/ipc
    TimelineStart  time.Time        `json:"timeline_start"`
    TimelineEnd    time.Time        `json:"timeline_end"`

    // ── OpenTelemetry 可观测性 ──
    TraceID        string           `json:"trace_id"`       // OTel Trace ID — 贯穿采集→语义化→诊断全链路
    RootSpanID     string           `json:"root_span_id"`   // 评测执行的根 Span ID

    // ── 测试结果 ──
    TestResults    []TestResult     `json:"test_results"`
    CompileErrors  []CompileError   `json:"compile_errors"`
    RuntimeErrors  []RuntimeError   `json:"runtime_errors"`

    // ── 观测数据 (语义化后) ──
    SemanticEvents []SemanticEvent  `json:"semantic_events"`
    ProcessGraph   *ProcessGraph    `json:"process_graph"`
    FlameAnalysis  *FlameAnalysis   `json:"flame_analysis"`
    MemoryAnalysis *MemoryAnalysis  `json:"memory_analysis"`
    LockAnalysis   *LockAnalysis    `json:"lock_analysis"`
    ResourceProfile *ResourceProfile `json:"resource_profile"`

    // ── 检测结果 ──
    DetectedIssues []DetectedIssue  `json:"detected_issues"`
    AnomalyScore   float64          `json:"anomaly_score"`
    HealthSummary  *HealthSummary   `json:"health_summary"`

    // ── AI 标注 ──
    AIContextHints []AIContextHint `json:"ai_context_hints"`
}

// ── 语义事件：将原始 syscall 翻译为教学语言 ──

type SemanticEvent struct {
    Timestamp      time.Time         `json:"timestamp"`
    EventType      string            `json:"event_type"`      // "process_create", "mem_alloc", "lock_acquire"
    Severity       string            `json:"severity"`        // "info", "warning", "critical"
    Label          string            `json:"label"`           // 人类可读标签
    Description    string            `json:"description"`     // 详细描述
    OSConcept      string            `json:"os_concept"`      // 关联的 OS 概念
    ExperimentRelevance string       `json:"experiment_relevance"` // 与当前实验的关联
    SourceLocation *SourceLocation   `json:"source_location"`
    RelatedEvents  []string          `json:"related_events"`  // 关联的其他事件 ID
    Evidence       map[string]any    `json:"evidence"`        // 支撑数据

    // ── OTel 关联 ──
    SpanID         string            `json:"span_id"`         // 该语义事件对应的 OTel Span ID（可跳转到 Langfuse 追踪视图）
}

// ── 检测到的问题 ──

type DetectedIssue struct {
    IssueID        string            `json:"issue_id"`
    Category       string            `json:"category"`       // "deadlock", "race", "leak", "zombie"
    Title          string            `json:"title"`
    Severity       string            `json:"severity"`
    Description    string            `json:"description"`
    Evidence       []EvidenceItem    `json:"evidence"`       // 来自各模块的证据
    RootCause      *RootCause        `json:"root_cause"`
    FixSuggestion  string            `json:"fix_suggestion"`
    OSConceptLinks []string          `json:"os_concept_links"` // 关联的 OS 知识点
    TeachingHint   *TeachingHint     `json:"teaching_hint"`  // 教学引导

    // ── Judge 校准元数据 ──
    JudgeScore     float64           `json:"judge_score"`    // LLM Judge 对该问题严重度的评分
    JudgeKappa     float64           `json:"judge_kappa"`    // 评估时的 Judge κ 值（可追溯校准状态）
}

type EvidenceItem struct {
    Source    string  `json:"source"`     // "ebpf", "flamegraph", "trace", "memory", "resource"
    Type      string  `json:"type"`       // "syscall", "allocation", "lock_event", "metric"
    Detail    string  `json:"detail"`
    Timestamp string  `json:"timestamp"`
    Link      string  `json:"link"`       // 可点击跳转到对应视图的链接
    SpanID    string  `json:"span_id"`    // OTel Span ID — 可跳转到 Langfuse 追踪视图查看该证据的采集过程
}

type TeachingHint struct {
    Level         int      `json:"level"`           // 1=引导, 2=提示, 3=解释
    Hints         []string `json:"hints"`           // 按 level 排列的渐进提示
    OSConcept     string   `json:"os_concept"`       // 对应的 OS 概念
    ExperimentLink string  `json:"experiment_link"` // 与实验逻辑的关联
    FurtherReading string  `json:"further_reading"` // 推荐学习资料
}
```

### 2.3 ObsContext 生成流程

```
Flow: 学生提交代码 → 沙箱运行 → 全量采集 → 语义化 → ObsContext

Step 1: 并行采集 (Go Core Service)
  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ strace   │ │ eBPF     │ │ perf     │ │ mem      │ │ cgroup   │
  │ 采集     │ │ 采集     │ │ 采集     │ │ 采集     │ │ 采集     │
  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
       │              │              │              │              │
       │  gen_ai.tool.call          │              │              │
       │  span 自动生成              │              │              │
       └─────────────┴─────────────┴─────────────┴─────────────┘
                              │
Step 2: 语义化引擎 (Go Core Service)            ▼
  • syscall → SemanticEvent (语义翻译)
  • trace → ProcessGraph (进程拓扑)
  • perf → FlameAnalysis (热点分析)
  • mem → MemoryAnalysis (泄漏检测)
  • eBPF futex → LockAnalysis (死锁分析)
  • cgroup → ResourceProfile (资源画像)
  • [OTel] 每个 SemanticEvent 生成 span link 关联原始 syscall span
                              │
Step 3: 问题检测引擎 (Go Core Service)          ▼
  • 模式匹配 + 规则引擎
  • 跨数据源关联 (如: "内存泄漏" ← mem增长 + 无free事件)
  • 生成 DetectedIssue 列表
  • 生成 TeachingHint
  • [OTel] 每个 DetectedIssue 生成 event 挂载到 Root Span
                              │
Step 4: 发布 ObsContext (NATS)                  ▼
  EvaluationCompletedEvent.ObsContext = obsCtx
  • [OTel] Trace Context 通过 NATS Header 传播 (traceparent)
                              │
Step 5: AI 消费 (Python AI Service)             ▼
  • ContextCollector 接收 ObsContext
  • 转换为 LLM Prompt 结构化文本
  • 注入各 Agent 的 System Prompt
  • [OTel] 每个 Agent 调用生成 gen_ai.client span，parent=Root Span
  • [OTel] gen_ai.agent span 包裹整个诊断编排
  • [Langfuse] 全部 Span 导出至 Langfuse → 质量仪表板 + 异常告警
```

---

## 三、AI 诊断接入观测数据

### 3.1 ContextCollector：为每个 Agent 定制观测视角

不同 Agent 需要不同的观测数据切片：

```python
# ai-service/services/context_collector.py

class ContextCollector:
    """为每个诊断 Agent 构建特定的观测上下文 — 遵循 Context Firewall 模式"""

    def for_syscall_analyzer(self, obs_ctx: ObsContext) -> str:
        """SyscallAnalyzer 关注: 语义事件 + 异常模式 + 进程图"""
        return f"""
## 系统调用语义分析

### 程序运行概要
- 总运行时间: {obs_ctx.timeline_duration_ms}ms
- 进程拓扑: {obs_ctx.process_graph.summary}
- 语义事件数: {len(obs_ctx.semantic_events)}

### 关键语义事件 (Top 10)
{self._format_semantic_events(obs_ctx.semantic_events[:10])}

### 异常模式
{self._format_anomalies(obs_ctx, category="syscall")}

### 检测到的系统调用问题
{self._format_detected_issues(obs_ctx, category="syscall")}
"""

    def for_ebpf_analyzer(self, obs_ctx: ObsContext) -> str:
        """eBPFAnalyzer 关注: 锁行为 + 死锁 + 内核事件"""
        return f"""
## eBPF 内核级分析

### 锁分析
{self._format_lock_analysis(obs_ctx.lock_analysis)}

### 死锁检测
{self._format_deadlock_info(obs_ctx.lock_analysis)}

### 内核事件统计
- futex 调用: {obs_ctx.lock_analysis.futex_count}
- futex 等待: {obs_ctx.lock_analysis.futex_wait_count}
- futex 唤醒: {obs_ctx.lock_analysis.futex_wake_count}
- 锁竞争次数: {obs_ctx.lock_analysis.contention_count}
"""

    def for_memory_analyzer(self, obs_ctx: ObsContext) -> str:
        """MemoryAnalyzer 关注: 内存分配 + 泄漏 + 碎片"""
        ...

    def for_perf_analyzer(self, obs_ctx: ObsContext) -> str:
        """PerfAnalyzer 关注: 火焰图 + 热点 + CPU 分布"""
        ...

    def for_concept_rubric(self, obs_ctx: ObsContext) -> str:
        """ConceptRubric 关注: 实验概念达成度"""
        return f"""
## 实验概念达成度评估上下文

### 实验类型: {obs_ctx.experiment_type}

### 需要评估的概念:
{self._format_experiment_rubric(obs_ctx)}

### 观测到的概念相关证据:
{self._format_concept_evidence(obs_ctx)}

### 学生代码结构:
{obs_ctx.student_code[:3000]}...
"""
```

### 3.2 多 Agent 诊断管线：观测数据驱动

```
用户提交代码
     │
     ▼
┌─ Phase 0: 运行 + 全量采集 ──────────────────────────────┐
│  编译 → 沙箱运行 → strace + eBPF + perf + mem + cgroup  │
│  → ObsContext 生成                                         │
│  [OTel] Root Span 创建 (trace_id 贯穿全链路)              │
└──────────────────────┬──────────────────────────────────┘
                       │ ObsContext + Trace Context
                       ▼
┌─ Phase 1: 问题检测 (规则引擎) ──────────────────────────┐
│  PatternAnalyzer: FD 泄漏/僵尸进程/段错误                │
│  LeakDetector: 内存泄漏                                   │
│  RaceDetector: 数据竞争                                   │
│  LockAnalyzer: 死锁检测                                   │
│  → DetectedIssues[]                                        │
│  [OTel] 每个 DetectedIssue → Event on Root Span          │
└──────────────────────┬──────────────────────────────────┘
                       │ DetectedIssues[] + ObsContext
                       ▼
┌─ Phase 2: 多 Agent 并行诊断 ────────────────────────────┐
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │Syscall      │  │eBPF         │  │Memory       │     │
│  │Analyzer     │  │Analyzer     │  │Analyzer     │     │
│  │             │  │             │  │             │     │
│  │ 输入:       │  │ 输入:       │  │ 输入:       │     │
│  │ • 语义事件  │  │ • 锁分析    │  │ • 内存分析  │     │
│  │ • 进程图    │  │ • 死锁报告  │  │ • 泄漏报告  │     │
│  │ • syscall   │  │ • futex事件 │  │ • 分配栈    │     │
│  │   模式分析  │  │             │  │ • 趋势      │     │
│  │             │  │             │  │             │     │
│  │ [Span]      │  │ [Span]      │  │ [Span]      │     │
│  │ gen_ai.cli- │  │ gen_ai.cli- │  │ gen_ai.cli- │     │
│  │ ent.chat    │  │ ent.chat    │  │ ent.chat    │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │              │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐     │
│  │Perf        │  │Concept     │  │Code        │       │
│  │Analyzer    │  │Rubric      │  │Analyzer    │       │
│  │            │  │            │  │            │       │
│  │ 输入:      │  │ 输入:      │  │ 输入:      │       │
│  │ • 火焰图   │  │ • Rubric   │  │ • AST      │       │
│  │ • 热点     │  │ • 概念证据 │  │ • 代码     │       │
│  │ • CPU分布  │  │ • 实验逻辑 │  │ • 模式     │       │
│  │            │  │            │  │            │       │
│  │ [Span]     │  │ [Span]     │  │ [Span]     │       │
│  │ gen_ai.cli-│  │ gen_ai.cli-│  │ gen_ai.cli-│       │
│  │ ent.chat   │  │ ent.chat   │  │ ent.chat   │       │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         └────────────────┼────────────────┘              │
│                          ▼                               │
│                    Agent 报告集合                         │
│              [OTel] gen_ai.agent span 闭合               │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─ Phase 3: 综合评分 + 报告生成 ─────────────────────────┐
│  RubricScorer: 六维综合评分                             │
│  ReportGenerator: 结构化诊断报告                         │
│    • 每个结论都附带观测证据链                            │
│    • 证据可点击回溯到具体可视化视图 + Langfuse Span      │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─ Phase 4: 评测校验 ────────────────────────────────────┐
│  EvaluationGuard: 置信度检查 + 一致性检查                │
│  [OTel] Evaluator span: gen_ai.agent (独立 Judge)       │
│  [Langfuse] 诊断质量指标写入 Dashboard                   │
│    • 正确性评分 / 置信度 / Agent间一致性                 │
│    • Token 成本归因 (按 session + agent 拆解)            │
└──────────────────────────────────────────────────────────┘
```

### 3.3 证据链：让 AI 诊断"有据可查"

AI 诊断的每个结论，都必须附带来自观测数据的证据：

```
AI 诊断报告示例:

📋 诊断结论: 存在内存泄漏

🔍 证据链:
  ├─ 📊 [内存趋势图] 堆大小从 2MB 持续增长至 14MB, 无下降
  ├─ 📊 [分配火焰图] loop_process() 函数分配了 12MB, 占总量 85%
  ├─ 💾 [内存事件] 检测到 4 次 malloc(3MB) 调用, 但 0 次 free
  ├─ 📝 [源码关联] main.c:45 → malloc(3MB) 在循环内, 未配对 free
  ├─ 🔬 [eBPF 追踪] brk() 被调用了 8 次, munmap() 仅 1 次
  └─ 🔗 [Langfuse] 追踪 ID: trace_abc123 → 查看完整诊断过程

📚 关联 OS 概念:
  • 虚拟内存管理 (Virtual Memory Management)
  • 堆分配 (Heap Allocation — brk/mmap)
  • 内存泄漏 (Memory Leak)

🎯 实验关联:
  这是「内存管理实验」的核心考察点 — 动态内存分配与释放

💡 教学引导:
  L1 (引导): "你的程序在运行过程中，内存使用有什么变化？"
  L2 (提示): "malloc 分配的内存，最后都去哪里了？"
  L3 (解释): "每次调用 loop_process() 时, 都会 malloc(3MB),
             但从未调用 free()。这导致堆内存持续增长——这就是内存泄漏。
             在 OS 中，进程退出时操作系统会回收所有内存，
             但在长期运行的程序中，泄漏会导致系统内存耗尽。"

🔧 修复建议:
  在 loop_process() 结束后添加 free(ptr);
```

---

## 四、AI 提问接入观测数据

### 4.1 实验上下文动态注入

当学生在实验界面打开 AI 提问时，ObsContext 自动注入：

```
学生打开 AI 提问面板 →
  ┌──────────────────────────────────────────┐
  │  实验上下文栏 (自动注入, 可折叠)          │
  │                                           │
  │  📋 实验: 进程调度模拟                    │
  │  📝 提交: #7 (45分, 3/5 用例通过)        │
  │  🔍 检测到: 1个严重问题, 2个警告          │
  │     🔴 死锁: 线程间存在循环等待           │
  │     🟡 警告: CPU使用率异常高 (92%)        │
  │     🟡 警告: close() 未匹配 open()        │
  │                                           │
  │  [📊 查看详细观测数据]                     │
  │  [🤖 让 AI 分析这个问题]                   │
  └──────────────────────────────────────────┘

学生提问: "为什么我的程序卡住不动了?"
  → AI 看到 ObsContext: 死锁检测 + 锁分析 + Trace时间线
  → AI 回答: "你的程序检测到死锁。TID=101 和 TID=102 互相等待对方持有的锁。
             看看[eBPF 锁图], TID=101 持有 mutex_1 在等待 mutex_2,
             而 TID=102 持有 mutex_2 在等待 mutex_1..."

学生追问: "那我该怎么修?"
  → AI 看到 ObsContext: 代码 + AST + 锁位置
  → AI 回答: "统一加锁顺序。让我看看你的代码...
             在 worker.c:23 和 worker.c:45,
             你分别先锁 mutex_1 和先锁 mutex_2, 导致了不一致的顺序。
             修复方法: 两个函数都先锁 mutex_1, 再锁 mutex_2。"
```

### 4.2 AI 提问的观测感知 (Observation-Aware Q&A)

```python
# ai-service/agents/observation_aware_qa.py

class ObservationAwareQAAgent:
    """能"看到"观测数据的 AI 提问 Agent"""

    async def answer(self, question: str, obs_ctx: ObsContext) -> str:
        # 构建观测感知的 System Prompt
        system_prompt = f"""
你是 TraceOS 的 AI 教学助手。你能够"看到"学生程序的实际运行情况。

## 当前实验
{obs_ctx.experiment_info}

## 程序运行观测数据
{self._format_obs_for_qa(obs_ctx)}

## 检测到的问题
{self._format_issues_for_qa(obs_ctx.detected_issues)}

## 你的能力
1. 你可以引用具体的观测数据来回答学生的问题
2. 你可以建议学生查看特定的可视化面板
3. 你必须给出渐进式的教学引导 (L1→L2→L3)
4. 你不能直接给出完整答案，而是引导学生自己发现

## 回答格式
- 先总结观测到的关键现象
- 再针对学生的具体问题给出解释
- 引用具体的数据证据
- 给出 L1 级别的教学引导
"""
        return await self.llm.chat(system_prompt, question)
```

### 4.3 交互式观测引导 (Interactive Observation Guidance)

AI 不只是回答问题，还会主动引导学生去"看"：

```
学生: "我的程序输出不对"

AI: "让我看看你的程序运行情况...
     我注意到你的程序有两个现象值得关注:

     1. 📊 看 [系统Trace 面板], 你的程序在 T+350ms 之后没有
        任何 I/O 操作了 — 这不正常, 因为你的程序应该持续输出结果

     2. 🔍 看 [eBPF 锁分析面板], 在 T+350ms 时刻,
        两个线程进入了死锁状态 — 这就是为什么程序"卡住"了

     你试试点击 [eBPF 面板] → [锁分析 Tab],
     然后拖动时间轴到 T+350ms, 你看到了什么?"

学生点击 [锁分析 Tab], 看到死锁图 →

学生: "我看到两个线程互相等待!"

AI: "对! 这就是死锁。你现在看到的是操作系统中非常重要的概念。
     
     💡 思考一下: 为什么两个线程会互相等待?
                    (提示: 看看它们先锁了什么, 又想要什么?)

     你可以在 [系统Trace] 面板中打开 [泳道视图],
     这会让你更清楚地看到两个线程的执行顺序。"
```

---

## 五、教学引导引擎

### 5.1 三级渐进式教学提示

参考现有 Suprative Method，结合观测数据升级为**证据驱动的渐进提示**：

```
L1 引导 — 让学生自己观察:
  "看看 [内存趋势图], 程序运行过程中堆大小有什么变化?"
  "打开 [系统Trace 泳道视图], 注意两个线程在 T+350ms 之后的状态"
  "在 [火焰图] 中寻找宽度最大的函数——那是最消耗 CPU 的地方"

L2 提示 — 给出方向但不给答案:
  "堆大小持续增长没有下降——这通常意味着什么?"
  "两个线程都在等待某个条件——这让你想到 OS 的哪个概念?"
  "loop_process() 占用了最多的 CPU——检查一下这个函数做了什么"

L3 解释 — 在多次尝试后提供完整解释:
  "每次调用 load_data() 都会 malloc(3MB)，但从未 free()。
   在操作系统中，这叫做内存泄漏 (Memory Leak)。
   泄漏的根本原因是..."
```

### 5.2 教学叙事模板 (Teaching Narrative Templates)

不同类型的 OS 问题，有对应的教学叙事模板：

```python
TEACHING_NARRATIVES = {
    "deadlock": {
        "story_title": "两个线程的"互不相让"",
        "setup": "在我们的程序里，{thread_a} 和 {thread_b} 是两个工作线程...",
        "conflict": "但是在 T+{time}ms, 它们遇到了麻烦...",
        "reveal": "这就是操作系统中的经典问题——死锁",
        "coffman_check": "让我们用 Coffman 四条件来验证...",
        "fix_story": "如果我们让两个线程都先锁 {lock_1}, 再锁 {lock_2}...",
        "lesson": "死锁告诉我们: 在并发编程中, 资源获取的顺序至关重要"
    },
    "memory_leak": {
        "story_title": "消失的内存",
        "setup": "程序开始运行, 堆内存从 {start}MB 开始...",
        "conflict": "每次 {function_name}() 执行, 堆就增加 {size}MB...",
        "reveal": "但它从没有减少过——内存在被"偷走"",
        "fix_story": "在 C 语言中, 每调用一次 malloc(), 就需要一次 free()...",
        "lesson": "动态内存管理是程序员的必修课——借了要还"
    },
    "file_descriptor_leak": {
        "story_title": "用完了不还的文件",
        "setup": "每个进程能打开的文件数量是有限的...",
        "conflict": "你的程序打开了 {fd_count} 个文件...",
        "reveal": "但只关闭了 {close_count} 个",
        "fix_story": "就像用完教室要关灯一样, 打开文件要记得 close()",
        "lesson": "文件描述符是有限的内核资源, 用完必须释放"
    },
    "race_condition": {
        "story_title": "谁先到谁赢?",
        "setup": "{var_name} 是一个共享变量, 两个线程都能访问它...",
        "conflict": "但是——它们没有一个"排队"的机制...",
        "reveal": "这就是数据竞争 (Data Race)——程序的结果依赖于线程执行的顺序",
        "fix_story": "互斥锁 (mutex) 就像一个"正在使用"的牌子...",
        "lesson": "共享数据的访问必须同步——这是并发编程的第一法则"
    }
}
```

### 5.3 学生画像驱动的个性化引导

```python
# ai-service/services/student_profile.py

class StudentGuider:
    """根据学生画像调整教学策略"""

    def adapt_guidance(self, student: StudentProfile, issue: DetectedIssue) -> TeachingHint:
        # 根据学生对 OS 概念的掌握程度, 调整提示级别
        concept_mastery = student.concept_mastery.get(issue.os_concept, 0)

        if concept_mastery < 0.3:
            # 初学者: 更基础的提示, 更多可视化引导
            return TeachingHint(
                level=1,
                hints=[
                    f"在 [观测面板] 中找一个叫 {issue.visual_hint} 的地方看看",
                    "你注意到什么异常了吗?",
                ],
                visual_guide=VisualGuide(
                    panel=issue.primary_panel,
                    tab=issue.primary_tab,
                    highlight=issue.highlight_region,
                ),
            )
        elif concept_mastery < 0.7:
            # 中级: 概念提示
            return TeachingHint(
                level=1,
                hints=[f"这让你想到操作系统的什么概念?"],
                concept_ref=issue.os_concept,
            )
        else:
            # 高级: 深入追问
            return TeachingHint(
                level=2,
                hints=[f"除了当前的修复方法, 还有哪些替代方案?"],
            )
```

---

## 六、AI-AI 协作：诊断结果反哺 AI 提问

### 6.1 诊断 → 提问的双向通道

```
场景: 学生在实验界面, AI 诊断自动完成

诊断报告生成 →
  ┌──────────────────────────────────────────┐
  │  AI 提问面板自动更新上下文:               │
  │                                           │
  │  📋 最新诊断: 检测到内存泄漏              │
  │     • 泄漏位置: main.c:45                │
  │     • 泄漏大小: 12MB                     │
  │     • 严重度: 🔴 严重                    │
  │                                           │
  │  💬 推荐问题 (一键追问):                  │
  │  [为什么 malloc 需要 free?]              │
  │  [堆和栈的区别是什么?]                    │
  │  [如何用 Valgrind 检测内存泄漏?]         │
  │                                           │
  │  📊 相关观测数据已加载                    │
  │     • 内存趋势图                          │
  │     • 分配火焰图                          │
  │     • 源码标注                            │
  └──────────────────────────────────────────┘
```

### 6.2 推荐问题智能生成

```python
def generate_followup_questions(obs_ctx: ObsContext, diagnosis: DiagnosisReport) -> list[str]:
    """根据诊断结果, 生成学生可能想追问的推荐问题"""

    questions = []

    for issue in diagnosis.detected_issues:
        # 概念层面
        questions.append(f"{issue.os_concept} 的原理是什么?")

        # 原因层面
        questions.append(f"为什么我的代码导致了{issue.title}?")

        # 修复层面
        questions.append(f"如何修复{issue.title}? 有什么最佳实践?")

        # 深入层面
        questions.append(f"除了 {issue.fix_suggestion.split('或')[0]}, 还有其他方法吗?")

    return questions[:4]  # 最多 4 个推荐问题
```

---

## 七、完整教学场景示例

### 场景: 学生实现生产者-消费者, 程序运行失败

```
┌─ Step 1: 学生提交代码, 自动运行 ──────────────────────┐
│  编译: ✅ 通过                                          │
│  运行: 程序运行 2 秒后无输出, 判定超时 ❌                │
│  观测数据自动采集...                                    │
└──────────────────────────────────────────────────────────┘

┌─ Step 2: ObsContext 自动生成 ──────────────────────────┐
│  语义事件: 创建了 2 个线程, 各获取了一把锁后停止活动    │
│  进程拓扑: Producer → [shared_buffer] ← Consumer       │
│  锁分析: 🔴 检测到死锁!                                 │
│     Thread-1(Producer): 持有 mutex_1 → 等待 mutex_2     │
│     Thread-2(Consumer): 持有 mutex_2 → 等待 mutex_1     │
│  内存分析: ✅ 无泄漏                                    │
│  火焰图: CPU 使用率很低 — 程序在等待                    │
└──────────────────────────────────────────────────────────┘

┌─ Step 3: AI 诊断自动触发 ──────────────────────────────┐
│  📋 诊断结论:                                           │
│  你的程序存在死锁 (Deadlock)                            │
│                                                         │
│  🔍 证据链:                                             │
│  • [锁分析] Thread-1 持有 mutex_1 等待 mutex_2         │
│  • [锁分析] Thread-2 持有 mutex_2 等待 mutex_1         │
│  • [Trace] 两个线程在 T+350ms 后无任何 futex_wake       │
│  • [CPU] 程序 CPU 使用率从 80% 降至 2%                  │
│                                                         │
│  🎬 叙事:                                               │
│  这是经典的"交叉加锁"死锁:                              │
│  Producer 先锁了 mutex_1 再想锁 mutex_2,               │
│  Consumer 先锁了 mutex_2 再想锁 mutex_1,               │
│  结果两个线程互相等待——永远等不到。                     │
│                                                         │
│  🔧 修复: 统一加锁顺序——两个线程都先锁 mutex_1          │
│  💡 引导: "为什么改变加锁顺序就能避免死锁?"              │
│                                                         │
│  🔗 [Langfuse] 追踪 link: trace_prodcon_2026 →          │
│     gen_ai.agent (DiagnosisOrchestrator) →               │
│     ├─ gen_ai.client (SyscallAnalyzer): 2341 tokens     │
│     ├─ gen_ai.client (eBPFAnalyzer): 1892 tokens        │
│     └─ gen_ai.agent (Evaluator): κ=0.84, confidence=0.91│
└──────────────────────────────────────────────────────────┘

┌─ Step 4: 学生点击 AI 提问, 追问 ───────────────────────┐
│                                                         │
│  学生: "为什么我的程序会死锁? 我不理解"                  │
│                                                         │
│  AI: "让我用观测数据帮你理解:                            │
│                                                         │
│       打开 [eBPF 追踪] → [锁分析] 面板,                  │
│       你看到 Thread-1 和 Thread-2 之间的箭头了吗?        │
│                                                         │
│       Thread-1 → mutex_2 → Thread-2 → mutex_1 → Thread-1│
│       这形成了一个 🔄 循环等待!                          │
│                                                         │
│       这就是死锁的充要条件 — 循环等待。                  │
│                                                         │
│       在操作系统中, 这叫做 Coffman 条件。                │
│       [点击展开 Coffman 四条件验证]"                     │
│                                                         │
│  学生: "那我该怎么改?"                                   │
│                                                         │
│  AI: "看你的代码, 问题在于加锁的顺序:                    │
│                                                         │
│       Producer: lock(m1) → lock(m2)                     │
│       Consumer: lock(m2) → lock(m1)  ← 顺序反了!        │
│                                                         │
│       最简单的修复: 让 Consumer 也先 lock(m1)            │
│       这样两个线程的加锁顺序一致, 就不会形成循环等待了。  │
│                                                         │
│       💡 你想试试自己修改吗? 还是想看看修复后的效果?"     │
└──────────────────────────────────────────────────────────┘
```

---

## 八、实施路线图

### Phase 1: ObsContext 基础设施 (1-2周) 🔴 P0

| 任务 | 内容 |
|------|------|
| ObsContext 数据模型 | `core/types/obs_context.go` + 集成 OTel trace_id/span_id 字段 |
| 语义化引擎 v1 | `core/services/semantic_engine.go` — 20+ OS 语义模式 |
| 统一事件总线 | 所有数据源 → NATS → ContextCollector（含 OTel Trace Context 传播） |
| AI ContextCollector | `ai-service/services/context_collector.py` |

### Phase 2: 问题检测引擎 (1-2周) 🔴 P0

| 任务 | 内容 |
|------|------|
| LeakDetector | 内存泄漏自动检测 |
| RaceDetector | 数据竞争检测 |
| DeadlockAnalyzer | 死锁演化分析 |
| 跨模块证据链 | 检测结果 → 关联观测数据 + Langfuse Span 链接 |

### Phase 3: AI 集成 (2-3周) 🟡 P1

| 任务 | 内容 |
|------|------|
| Agent Prompt 升级 | 每个 Agent 接入 ObsContext + 遵循 Context Firewall |
| 证据链输出 | AI 报告附带可点击的证据链接 + Langfuse 追踪链接 |
| 教学叙事引擎 | TeachingNarrative 模板系统 |
| 推荐问题生成 | 诊断 → 推荐追问 |
| OTel 插桩 | 所有 LLM 调用 → gen_ai.client span；Agent 编排 → gen_ai.agent span |
| Langfuse 集成 | 全链路可视化 + 质量仪表板 + 异常告警 |

### Phase 4: 前端集成 (2-3周) 🟡 P1

| 任务 | 内容 |
|------|------|
| AI 提问上下文栏 | 显示 ObsContext 摘要 + 推荐问题 |
| 证据链接跳转 | 点击证据 → 跳转具体面板/时刻 |
| 渐进提示 UI | L1/L2/L3 三级折叠提示 |
| 教学叙事渲染 | 问题"故事"的可视化展示 |

### Phase 5: 学生画像 (1-2周) 🟢 P2

| 任务 | 内容 |
|------|------|
| 概念掌握度追踪 | 学生画像 + 概念图谱 |
| 个性化引导 | 根据画像调整提示级别 |
| 进步可视化 | 学生概念成长曲线 |

---

## 九、成功指标

| 指标 | 当前 | 目标 |
|------|------|------|
| AI 诊断引用观测证据的比例 | 0% | >80% |
| 学生主动查看观测面板的比例 | ~30% | >70% |
| "理解根因"的平均对话轮次 | 8-10轮 | 3-5轮 |
| 学生满意度 (诊断+提问) | ~70% | >85% |
| 概念掌握度提升 (前后测) | 未测量 | >30% |
| 从观测到修复的平均时间 | ~15分钟 | <5分钟 |
| OTel Span 覆盖率 | 0% | 100%（每个 LLM 调用、每个 Tool 调用） |
| LLM Judge κ 值 | 未测量 | ≥ 0.80（G-EVAL CoT 校准后） |
| 上下文窗口平均利用率 | 未测量 | < 40%（Context Anxiety 安全线） |

---

*文档版本 v2.0 | 最后更新 2026-08-06*
*关联文档: master-observability-upgrade-plan.md | agent-diagnosis-upgrade-plan.md | agent-harness-upgrade-plan.md*
*行业参考: OpenTelemetry GenAI Conventions (May 2026) | Langfuse Full-Stack Tracing | G-EVAL Chain-of-Thought Calibration | Anthropic Context Anxiety Research*
