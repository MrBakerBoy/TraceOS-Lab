# TraceOS 实施状态评估与下一步计划

> **评估日期**: 2026-08-10  
> **评估范围**: 7 个 Plan 文档涉及的所有模块  
> **评估方法**: 源码级比对（前端 TSX/后端 Go/Python AI Service）

---

## 一、总体实施进度总览

| Plan | 进度 | 状态 |
|------|------|------|
| **frontend-beautification-upgrade-plan.md** | **P0: 100% / P1: 60% / P2: 0%** | 🟡 进行中 |
| **ebpf-trace-flamegraph-upgrade-plan.md** | **前端 80% / 后端 30%** | 🟡 前端完成，后端未接线 |
| **system-trace-concurrency-upgrade-plan.md** | **前端 85% / 后端 30%** | 🟡 前端完成，后端未接线 |
| **memory-resource-visualization-upgrade-plan.md** | **前端 50% / 后端 30%** | 🟡 部分完成，后端未接线 |
| **master-observability-upgrade-plan.md** | **Phase 1: 60% / Phase 2-4: 未开始** | 🔴 基础设施部分完成 |
| **observability-ai-integration-plan.md** | **Phase 1-3: 75% / Phase 4: 30%** | 🟡 AI 服务端大量完成，Go 端未接线 |
| **agent-diagnosis-upgrade-plan.md** | **Phase 1-6: 70% / Phase 7: 20%** | 🟡 AI 后端基本完成，前端未落地 |

**综合评估：整体约 55-60% 完成率。核心问题是「前后端接线」和「端到端集成」未打通。**

---

## 二、逐 Plan 详细审计

### 2.1 frontend-beautification-upgrade-plan.md

#### ✅ P0 基础设施 — 100% 完成
| 任务 | 状态 | 证据 |
|------|------|------|
| Framer Motion 安装 | ✅ | `package.json`: `"framer-motion": "^13.0.0"` |
| ECharts 主题联动引擎 | ⚠️ | 文件存在但为**静态硬编码**，未实现 CSS 变量实时读取联动 |
| PanelHeader 组件 | ✅ | `ui/panel-header.tsx` 153行，完整实现 badge/actions/children |
| 骨架屏系统 | ✅ | `ui/skeleton-card.tsx` 含 KpiCard/Chart/Table/Text |
| 空状态组件 | ✅ | `ui/empty-state.tsx` 含 4 种变体 |
| 动画数字计数器 | ✅ | `ui/animated-counter.tsx` + StatChange |
| 状态指示器 | ✅ | `ui/status-badge.tsx` 含 StatusBadge + ConnectionStatus |
| Neon Dark 主题 | ✅ | 5 套主题系统，4 处 neon 引用 |
| Cross-panel sync 状态 | ✅ | `stores/workspace.ts` 含 obsContext/tier/crossPanelSync (22 处引用) |
| 组件导出 | ✅ | `ui/index.ts` |

#### 🟡 P1 面板升级 — 60% 完成
| 面板 | 新组件使用 | 评价 |
|------|-----------|------|
| EBPFTracePanel | ✅✅ 14 处引用 (PanelHeader/StatusBadge/EmptyState/SkeletonChart) | 较好 |
| FlameGraphPanel | ⚠️ 2 处引用 | 基本未升级 |
| TraceViewer | ✅ 6 处引用，整合 5 个新子面板 | 较好 |
| WaterfallTimeline | ⚠️ 3 处引用 | 部分升级 |
| MemoryLayout3D | ❌ 0 处引用 | **未升级** |
| DiagnosisPanel | ❌ 1 处引用 | **基本未升级** |
| AIChatPanel | ❌ 2 处引用 | **基本未升级** |
| RightStatusCards | ❌ 2 处引用 | **基本未升级** |
| FloatingDock | ❌ 0 处引用 | **未升级** |
| DeadlockGraph | 未检查 | 需核实 |

#### ❌ P2 体验增强 — 0% 完成
- 响应式面板布局未实现
- 交互式新手引导未实现
- 主题切换动画未实现

---

### 2.2 ebpf-trace-flamegraph-upgrade-plan.md

#### ✅ 前端 — 80% 完成
| 组件 | 行数 | 集成状态 |
|------|------|---------|
| ProcessMapView.tsx | 250 | ✅ 已集成进 EBPFTracePanel Tab |
| SemanticEventView.tsx | 201 | ✅ 已集成进 EBPFTracePanel Tab |
| CausalChainView.tsx | 293 | ✅ 已集成进 EBPFTracePanel Tab |

#### ❌ 后端 — 未接线
| 服务文件 | 状态 | 问题 |
|---------|------|------|
| `semantic_engine.go` | ✅ 存在 | ❌ 无 API handler，无路由注册 |
| `flamegraph_diff.go` | ✅ 存在 | ❌ 无 API handler |
| `continuous_profiler.go` | ❌ 不存在 | 计划中但未实现 |
| `process_graph.go` | ❌ 不存在（前端自行解析） | 计划中但未实现 |
| `ebpf/loader.go` (uprobe 扩展) | ⚠️ | 需检查 malloc/I/O 探针 |

---

### 2.3 system-trace-concurrency-upgrade-plan.md

#### ✅ 前端 — 85% 完成
| 组件 | 行数 | 集成状态 |
|------|------|---------|
| MultiThreadLaneView.tsx | 303 | ✅ 已集成进 TraceViewer Tab |
| SpanTreeView.tsx | 181 | ✅ 已集成进 TraceViewer Tab |
| ThreadStateView.tsx | 222 | ✅ 已集成进 TraceViewer Tab |
| RaceDetectionView.tsx | 190 | ✅ 已集成进 TraceViewer Tab |
| SchedVisualizer.tsx | 231 | ✅ 已集成进 TraceViewer Tab |

#### ❌ 后端 — 未接线
| 服务文件 | 状态 |
|---------|------|
| `span_builder.go` | ✅ 存在，编译通过，无 API |
| `race_detector.go` | ✅ 存在，编译通过，无 API |
| `thread_state_tracker.go` | ✅ 存在，编译通过，无 API |
| `deadlock_evolver.go` | ✅ 存在，编译通过，无 API |

---

### 2.4 memory-resource-visualization-upgrade-plan.md

#### 🟡 前端 — 50% 完成
| 组件 | 状态 |
|------|------|
| MemorySnapshotDiff.tsx | ✅ 195 行存在 | ❌ **未集成进 MemoryLayout3D** |
| ResourceMonitorCard.tsx | ✅ 463 行，已集成进 ExperimentWorkspace |
| LivePerfDashboard.tsx | ✅ 428 行，已集成进 ExperimentWorkspace |
| SandboxResourcePanel.tsx | ✅ 156 行 | ❌ **未集成进 ExperimentWorkspace** |
| MemoryLayout3D.tsx | ❌ 未升级（0 处新 UI 组件引用） |

#### ❌ 后端 — 未接线
| 服务文件 | 状态 |
|---------|------|
| `leak_detector.go` | ✅ 存在，编译通过，无 API |
| `sandbox_metrics.go` | ✅ 存在，编译通过，无 API |
| `risk_indicator.go` | ✅ 存在，编译通过，无 API |
| `event_correlator.go` | ✅ 存在，编译通过，无 API |

---

### 2.5 master-observability-upgrade-plan.md

#### Phase 1 基础设施 — 60%
| 任务 | 状态 |
|------|------|
| ObsContext 数据模型 | ✅ `types/obs_context.go` + 前端 `types/obs_context.ts` |
| 统一事件总线升级 | ⚠️ `events.go` 存在，但未接入新事件类型 |
| 时间轴校准服务 | ✅ `timeline_calibrator.go` 存在，无 API |
| ExperimentWorkspace Store | ✅ workspace store 含 obsContext + tier 状态 |
| Filter Bar 基础设施 | ✅ `filter_index.go` + `FilterBar.tsx` 存在 |

#### ❌ 缺失
- TierNavBar/TierOverview/TeachingHintPanel 文件存在但**未接入 ExperimentWorkspace**
- 三层视图架构在 UI 层面未激活
- 统一时间轴联动未实现

---

### 2.6 observability-ai-integration-plan.md

#### ✅ AI 服务端 — 75% 完成
Python AI Service 有大量实现（3160+ 行核心代码）：
| 模块 | 文件 | 行数 |
|------|------|------|
| 诊断编排器 | `diagnosis/orchestrator.py` | ✅ |
| 多 Agent | `diagnosis/agents/*.py` (6 个 Agent) | 1175 |
| Context Firewall | `agents/context_firewall.py` | 336 |
| ObsContext Collector | `agents/obs_context_collector.py` | 264 |
| 可观测性 | `agents/observability.py` | 440 |
| 校准 | `diagnosis/calibration.py` | 217 |
| 评估守卫 | `diagnosis/evaluation_guard.py` | ✅ |
| 降级策略 | `diagnosis/fallback.py` | ✅ |
| 治理 | `diagnosis/governance.py` | ✅ |
| DB 仓储 | `db/diagnosis_harness_repo.py` | 259 |

#### ❌ 缺失
- **Go 端 ObsContext 未注入 AI 管线** — NATS 事件 `EvaluationCompletedEvent` 未携带 ObsContext
- **前端 AI 面板未升级** — 无证据链跳转、无 L1/L2/L3 渐进提示 UI
- Langfuse 集成为代码层面完成但需部署配置

---

### 2.7 agent-diagnosis-upgrade-plan.md

#### ✅ 后端 — 70% 完成
- Planner-Generator-Evaluator 架构已实现
- 6 个 Specialist Agent (CodeAnalyzer/SyscallAnalyzer/ConceptRubric/TestEvaluator/PerfAnalyzer/eBPFAnalyzer)
- 独立 Evaluator Agent
- EvaluationGuard + 降级链
- 数据库表设计已实现（diagnosis_harness_repo.py）
- 测试文件存在（test_diagnosis_orchestrator.py 等）

#### ❌ 前端 — 20% 完成
- HarnessReportPanel.tsx 存在但**六维雷达图/概念达成度柱状图/Agent 结果 Tab 切换/证据引用高亮/历史对比曲线**均未实现
- 教师端 Rubric 编辑器未实现
- 诊断质量 Dashboard 未实现

---

## 三、关键阻塞问题

### 🔴 阻塞 1：Go 后端服务未接线（影响 4 个 Plan）
**问题**: 15+ 个 Go service 文件存在且编译通过，但：
- `main.go` 中无任何新 handler 初始化
- 无新 API 路由注册
- NATS 事件未扩展携带新数据

**影响**: 所有新前端面板无法获取后端数据，处于"空壳"状态

### 🔴 阻塞 2：前端 Tier 组件未接入（影响 Master Plan）
**问题**: TierNavBar/TierOverview/TeachingHintPanel/SandboxResourcePanel/FilterBar 文件存在，但 ExperimentWorkspace 中无任何引用

**影响**: 三层观测架构在 UI 层面完全不可见

### 🟡 阻塞 3：MemoryLayout3D 未升级（影响 Memory Plan）
**问题**: MemorySnapshotDiff 未集成、无新 UI 组件引用、无泄漏高亮

### 🟡 阻塞 4：ECharts 主题未动态化（影响 Frontend Plan）
**问题**: `echarts-theme.ts` 是静态 JSON，未按 Plan 设计实现 `getComputedStyle()` 读取 CSS 变量实现5主题联动

---

## 四、下一步实施计划

### Phase A: 后端接线（优先级 🔴 最高，预计 3-5 天）

#### A1. 创建 API Handlers（Day 1-2）
新增以下 handler 文件并注册到 `main.go`：

| Handler | 对应 Service | API 端点 |
|---------|-------------|---------|
| `handler/semantic_handler.go` | `semantic_engine.go` | `GET /api/v1/submissions/:id/semantic-events` |
| `handler/process_graph_handler.go` | 前端自行构建 | `GET /api/v1/submissions/:id/process-graph` |
| `handler/leak_handler.go` | `leak_detector.go` | `GET /api/v1/submissions/:id/leak-report` |
| `handler/race_handler.go` | `race_detector.go` | `GET /api/v1/submissions/:id/race-report` |
| `handler/sandbox_metrics_handler.go` | `sandbox_metrics.go` | `GET /api/v1/submissions/:id/sandbox-metrics` |
| `handler/obs_context_handler.go` | `obs_context_builder.go` | `GET /api/v1/submissions/:id/obs-context` (聚合端点) |
| `handler/flamegraph_diff_handler.go` | `flamegraph_diff.go` | `POST /api/v1/submissions/:id/flamegraph/diff` |
| `handler/span_handler.go` | `span_builder.go` | `GET /api/v1/submissions/:id/span-tree` |
| `handler/risk_handler.go` | `risk_indicator.go` | `GET /api/v1/submissions/:id/risk-indicators` |

#### A2. 扩展 NATS 事件（Day 2-3）
- `EvaluationCompletedEvent` 增加 `ObsContext` 字段
- 发布新事件类型：`LeakDetected`, `RaceDetected`, `DeadlockEvolved`
- AI Service 订阅新事件触发自动诊断

#### A3. 前端 API 层对接（Day 3-5）
- `lib/api.ts` 新增所有新端点的调用函数
- 为每个新面板添加数据加载状态（loading/empty/error）

---

### Phase B: 前端集成（优先级 🔴 高，预计 3-4 天）

#### B1. ExperimentWorkspace 三层架构激活（Day 1-2）
```
ExperimentWorkspace 当前:
  [Editor] [Panel: EBPF/FlameGraph/Trace/Memory3D...]

ExperimentWorkspace 目标:
  [TierNavBar: 全景总览 | 进程分析 | 函数调试]
  
  Tier 1 (默认): TierOverview (健康评分 + RED + USE + 异常摘要)
  Tier 2: 当前面板 (EBPF/FlameGraph/Trace/Memory/Resource)
  Tier 3: 按需展开 (差分火焰图/CausalChain/RaceReport...)
```
- 导入并集成 `TierNavBar`, `TierOverview`, `FilterBar`
- 导入并集成 `TeachingHintPanel`, `SandboxResourcePanel`

#### B2. MemoryLayout3D 升级（Day 2-3）
- 集成 `MemorySnapshotDiff` 组件
- 添加 PanelHeader/EmptyState/SkeletonCard
- 泄漏高亮辉光动画

#### B3. 面板补升级（Day 3-4）
- DiagnosisPanel: PanelHeader + 骨架屏 + 证据链 stagger
- AIChatPanel: PanelHeader + 消息滑入 + 上下文折叠
- RightStatusCards: AnimatedCounter + StatChange
- FloatingDock: Framer Motion whileHover 微动效

---

### Phase C: ECharts 主题动态化（优先级 🟡 中，预计 1-2 天）

- 重写 `lib/echarts-theme.ts`：
  - 注册 5 套主题（对应 5 个配色方案）
  - 从 CSS 变量 `getComputedStyle()` 读取颜色
  - 主题切换时重新 `echarts.registerTheme()` + 所有图表实例 `setOption()`
- 更新 `useEChart` hook 监听 `data-theme` 属性变化

---

### Phase D: 端到端测试与验证（优先级 🟡 中，预计 2 天）

#### D1. 构建验证
```bash
cd frontend && npm run build  # TypeScript + Next.js
cd services/core-service && go build ./...
cd services/ai-service && python -m pytest
```

#### D2. 功能验证清单
| 验证项 | 方法 |
|--------|------|
| 5 主题 ECharts 联动 | 切换主题 → 检查图表颜色 |
| PanelHeader 在所有面板 | 逐个面板检查标题栏 |
| 骨架屏 → 内容过渡 | 提交代码 → 观察加载态 |
| 空状态展示 | 首次打开面板 → 检查引导文案 |
| 新 Tab (ProcessMap/Semantic/Causal/Lane/Span/Thread/Sched/Race) | 逐个切换 Tab |
| Tier 三层导航 | 点击 TierNavBar 切换层级 |
| 后端 API 返回数据 | curl 各新端点 |
| AI 诊断引用观测证据 | 查看诊断报告是否有证据链 |

---

### Phase E: 部署与文档（预计 1 天）

- 更新 `DEPLOYMENT.md` 添加新服务依赖
- 数据库迁移脚本（diagnosis_reports/agent_results 等表）
- Langfuse 配置文档

---

## 五、整体时间线

```
Week 1 (Aug 11-15):  Phase A 后端接线 + A1/A2 完成
Week 2 (Aug 18-22):  Phase A3 前端 API 对接 + Phase B 前端集成
Week 3 (Aug 25-29):  Phase C ECharts 动态化 + Phase D 测试验证
Week 4 (Sep 1-5):    Phase E 部署文档 + 缓冲区
```

---

## 六、风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| Go service 功能不完整，handler 需要大量修改 | 中 | 优先检查每个 service 的公开函数签名 |
| 前端面板"空壳"需要大量 mock 数据联调 | 高 | 先用 mockMode 验证 UI，再逐步切真实 API |
| AI Service 测试覆盖不足导致回归 | 中 | 先跑现有 pytest，修复后再加新测试 |
| 跨模块联动复杂度超预期 | 中 | 先实现单一数据流（提交→ObsContext→前端），再扩展 |

---

*文档版本 v1.0 | 创建日期 2026-08-10*
*基于 7 个 Plan 文档的源码级审计*
