# TraceOS Lab 项目专业技术文档

> 面向计算机系统能力大赛·操作系统设计赛的各位专家和评委老师们的项目技术资料集。

## 1. 文档定位

本目录面向计算机系统能力大赛·操作系统设计赛的各位专家和评委老师，是 TraceOS Lab 的完整技术叙事资料库，服务于以下场景：

- 专家和评委老师阅读的系统设计与实现说明；
- 团队内部进行功能复盘、部署复现和后续迭代的工程档案。

文档正文采用中文，保留 `eBPF`、`strace`、`NATS JetStream`、`RAG`、`pgvector`、`TimescaleDB`、`AST`、`CFG`、`cgroup`、`seccomp`、`NsJail`、`Harness` 等英文技术术语。

## 2. 推荐阅读顺序

```mermaid
flowchart LR
    A[01 项目总览] --> B[02 总体架构]
    B --> C[03 沙箱与安全]
    C --> D[04 eBPF 主观测]
    D --> E[05 strace 降级]
    E --> F[06 评测与评分]
    F --> G[07 ObsContext]
    G --> H[08 可视化工作台]
    H --> I[09 AI Agent]
    I --> J[10 RAG 知识库]
    J --> K[11 测试与多语言]
    K --> L[12 可视化中枢与 RAG 问答]
```

## 3. 文档目录

| 编号 | 文档 | 核心问题 | 主要使用场景 |
|---|---|---|---|
| 01 | [项目总览与竞赛方案论证](01-项目总览与竞赛方案论证.md) | 为什么做、解决什么痛点、总体价值是什么 | PPT 开场、答辩总述 |
| 02 | [云原生总体架构与全链路数据流](02-云原生总体架构与全链路数据流.md) | 各服务如何协作，提交如何变成诊断结果 | 系统架构讲解 |
| 03 | [实验沙箱、安全隔离与资源治理](03-实验沙箱安全隔离与资源治理.md) | 如何安全、稳定、可复现地运行学生代码 | 安全与工程实现 |
| 04 | [eBPF 主观测引擎设计](04-eBPF主观测引擎设计.md) | 如何获得低侵入、结构化的内核运行轨迹 | 核心创新讲解 |
| 05 | [strace 降级观测与兼容性策略](05-strace降级观测与兼容性策略.md) | eBPF 不可用时如何保持平台可用 | 兼容性与可靠性 |
| 06 | [多维断言评测与公平评分系统](06-多维断言评测与公平评分系统.md) | 如何从“只看输出”升级到系统行为评测 | 评测引擎讲解 |
| 07 | [OS 行为语义建模与三层 ObsContext](07-OS行为语义建模与三层ObsContext.md) | 如何把原始轨迹组织成可理解、可检索的证据 | 观测数据建模 |
| 08 | [内核观测可视化与交互式诊断工作台](08-内核观测可视化与交互式诊断工作台.md) | 如何把复杂系统数据变成可操作的学习界面 | 产品演示、前端亮点 |
| 09 | [AI 智能 Agent、上下文工程与 Harness 工程](09-AI智能Agent上下文工程与Harness工程.md) | AI 如何利用实验上下文进行教学级诊断 | AI 技术讲解 |
| 10 | [RAG 私有知识库与操作系统问答平台](10-RAG私有知识库与操作系统问答平台.md) | 如何让大模型基于课程私有知识可靠回答 | AI 问答演示 |
| 11 | [测试样例体系、实验策略与多语言支持](11-测试样例体系实验策略与多语言支持.md) | 如何覆盖 OS 核心实验并保持可扩展 | 课程内容与评测 |
| 12 | [运行时可视化中枢与 RAG 智能问答系统](12-运行时可视化中枢与RAG智能问答系统.md) | 火焰图、Trace、3D 地图、资源监控如何落地；RAG 如何可信答疑；教学闭环、自适应与工程化如何支撑长期运行 | 核心创新讲解、产品演示、教学与工程完整性 |

## 4. 统一技术叙事

TraceOS Lab 的核心技术主线可以概括为：

```text
统一沙箱
  → 可复现实验环境
  → eBPF 主观测 / strace 降级观测
  → 结构化系统行为证据
  → 多维确定性断言评分
  → ObsContext 语义化组织
  → 可视化运行时工作台
  → RAG + AI Agent 教学诊断
  → 学生反馈、教师分析与自适应学习
```

平台坚持三个工程原则：

1. **评分与诊断职责分离**：分数由 Core Service 的确定性评测引擎产生，AI 负责解释、归因和启发式教学，不改变评分真值。
2. **主路径与降级路径并存**：优先使用 eBPF 获取结构化内核事件，在内核能力、权限或运行环境不满足时自动降级到 strace，保证实验链路具有可用性。
3. **原始证据与教学表达分层**：底层保留 syscall、futex、memory、lifecycle 等运行事实，中层构建 `ObsContext`，上层再生成前端视图与 AI 教学反馈。

## 5. 源码依据约定

文档中提到的源码路径均以仓库根目录 `/root/traceos-lab` 为基准。重点源码区域包括：

- `services/core-service/internal/evaluator/`：编译、运行、断言、评分与评测流水线；
- `services/core-service/internal/sandbox/`：NsJail、Docker、本地沙箱和资源池；
- `services/core-service/internal/ebpf/`：全局 eBPF loader、PID 注入、ring buffer 与事件分发；
- `services/core-service/internal/services/`：观测上下文、事件关联、风险识别与教学叙事；
- `services/core-service/internal/ast/`：AST、CFG、模式检测与静态审计；
- `services/ai-service/app/diagnosis/`：多 Agent 诊断、上下文切片、治理与报告聚合；
- `services/ai-service/app/agents/`：教学问答 Agent、RAG 调用、Guardrails 与上下文拼装；
- `services/ai-service/app/services/rag/`：向量检索、BM25、RRF 与 reranker；
- `frontend/components/`：eBPF 可视化、Trace、火焰图、内存布局、诊断和教学交互组件；
- `deploy/init-db/`：业务表、时序表、RAG、报告、适应性学习和权限管理初始化脚本；
- `docker-compose.yml`：基础设施、应用服务、监控栈和网关编排。



> 说明：本文档集对已实现能力进行专业化归纳；涉及未来扩展的内容会标记为“演进方向”，不与当前运行事实混淆。
