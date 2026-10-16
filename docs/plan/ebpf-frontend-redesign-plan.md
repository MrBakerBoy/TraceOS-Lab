# eBPF 追踪面板全面重设计计划

> 状态: 待实施 | 创建: 2026-03-14 | 关联: eBPF 主追踪迁移计划, 评分系统改造计划

---

## 目录

1. [反思：现状缺口分析](#1-反思现状缺口分析)
2. [核心设计原则](#2-核心设计原则)
3. [信息架构：Tab 重设计](#3-信息架构tab-重设计)
4. [详细 Tab 设计](#4-详细-tab-设计)
5. [通用组件设计](#5-通用组件设计)
6. [主题适配策略](#6-主题适配策略)
7. [用户操作流程](#7-用户操作流程)
8. [组件树与数据流](#8-组件树与数据流)
9. [实施计划](#9-实施计划)

---

## 1. 反思：现状缺口分析

### 后端已提供、前端未展示的数据

后端已经实现了 11 个 API 端点，返回了丰富的数据。但现有 `EBPFTracePanel`（约 1266 行）仅覆盖了 SSE 实时流和 syscall 轨迹分析，大量数据闲置：

| API 端点 | 返回核心数据 | 前端现状 |
|---|---|---|
| `GET /submissions/:id/sandbox-metrics` | CPU/内存/IO/FD/线程/缺页/上下文切换/OOM 风险/CFS 节流/资源告警 | **完全未展示** |
| `GET /submissions/:id/leak-report` | 泄漏列表(按严重度分级)/Heaptrack 摘要/堆历史/泄漏汇总 | **完全未展示** |
| `GET /submissions/:id/alloc-flamegraph` | Top 分配者排行/分配摘要 | **完全未展示** |
| `GET /submissions/:id/memory-trend` | 堆时间线(含分配/释放速率)/趋势方向/峰值/增长率 | **完全未展示** |
| `GET /submissions/:id/race-report` | 竞态检测结果/Happens-Before 分析/线程计数/竞态摘要 | **完全未展示** |
| `GET /submissions/:id/deadlock-evolution` | 死锁演化步骤/Coffman 四条件/循环信息/教学叙事 | **完全未展示** |
| `POST /ebpf/observe` + SSE stream | syscall/trace_event/graph/deadlock/safe/mem/sched 实时事件 | 有展示但不完整，缺少 deadlock 演化重放 |
| `GET /submissions/:id/traces` | 完整 syscall 轨迹列表 | 有时间线视图但缺少语义分类 |

### 现有 Tab 的问题

1. **overview** — 只有 syscall 统计 KPI，没有资源指标、没有一体化健康评分
2. **timeline** — 有时间线但没有按分类着色、没有错误高亮
3. **memory** — 有 raw SSE mem 数据但没有泄漏报告、没有堆趋势、没有分配火焰图
4. **locks** — 有实时锁图但没有死锁演化重放、没有 Coffman 条件可视化
5. **live** — 有 SSE 流但没有重放控制、没有事件过滤器
6. **ai** — 有 AI 解读但没有与具体检测结果联动
7. **compare** — 有框架但没有与本次提交的上下文关联
8. **process-map/semantic/causal** — 存在但未充分利用 eBPF 数据

### 关键反思

**问题不是数据不够，而是数据没被组织成用户能理解的故事。** 用户提交代码后，他们的自然问题是：
- 我的程序跑得怎么样？（资源消耗、执行时间）
- 有没有 bug？（内存泄漏、数据竞争、死锁）
- bug 在哪里、为什么？（堆时间线、锁演化、Happens-Before）
- 怎么修？（教学叙事、修复建议）

现在的面板回答了「程序调用了哪些 syscall」，但没有回答上面的问题。重设计的核心目标就是让 eBPF 数据讲出这个故事。

---

## 2. 核心设计原则

### 2.1 叙事驱动而非指标陈列

每个 Tab 回答一个具体问题，而不是堆砌数据点。问题驱动布局：
- **总览** — 我的程序健康吗？（一站式健康评分 + 关键告警）
- **资源** — 程序消耗了多少系统资源？
- **内存** — 有没有泄漏？哪里泄漏的？趋势是什么？
- **并发** — 有没有竞态？有没有死锁？怎么发生的？
- **系统调用** — 程序做了什么系统调用？时序如何？

### 2.2 渐进式信息披露

遵循「摘要 → 详情 → 原始数据」三层结构：
- 第一层（卡片头部）：关键指标 + 状态徽章（正常/警告/危险）
- 第二层（卡片主体）：图表/可视化 + 事件列表
- 第三层（折叠/侧滑）：原始数据表格/JSON

### 2.3 教育性优先

TraceOS Lab 是教学平台。每个检测结果必须附带：
- **通俗解释** — 这个问题是什么（一句话说清楚）
- **示例说明** — 代码中哪里导致了这个问题
- **修复建议** — 怎么改

### 2.4 一致的视觉语言

- 状态颜色系统：正常=绿色，警告=琥珀色，危险=红色，信息=青色
- 卡片组件统一：相同的圆角、边框、间距、阴影
- 数据可视化统一：ECharts 图表共用主题配置
- 空状态、加载状态、错误状态统一样式

---

## 3. 信息架构：Tab 重设计

### 3.1 新 Tab 结构

不再沿用旧的 10 个 Tab 平铺。改为 5 个语义化 Tab，每个 Tab 内容丰富而非单薄：

| Tab ID | 标签 | 图标 | 核心问题 | 聚合的后端数据 |
|---|---|---|---|---|
| `health` | 健康总览 | `HeartPulse` | 我的程序健康吗？ | sandbox-metrics + leak-report + race-report + deadlock-evolution + traces |
| `resources` | 资源监控 | `Cpu` | 消耗了多少资源？ | sandbox-metrics (CPU/内存/IO/FD/线程/缺页/上下文切换/CFS) |
| `memory` | 内存分析 | `MemoryStick` | 有没有泄漏？ | leak-report + memory-trend + alloc-flamegraph |
| `concurrency` | 并发分析 | `Network` | 有没有竞态/死锁？ | race-report + deadlock-evolution + SSE lock-graph |
| `syscalls` | 系统调用 | `Activity` | 程序做了什么？ | traces (完整列表+时间线+语义) |

### 3.2 为什么砍掉旧 Tab

- **live (实时推送)** — 实时 SSE 流不是独立的分析维度，它的数据（syscall、lock、mem）已经被上述 Tab 吸收。实时能力作为各 Tab 内的"实时模式开关"存在。
- **ai (AI 解读)** — AI 解读不应是独立 Tab，而是每个检测结果卡片内的"问 AI"按钮，点击后在侧栏弹窗显示。
- **compare (对比)** — 对比功能保留但作为浮层，在健康总览和资源监控中提供"对比上次提交"的快捷操作。
- **process-map/semantic/causal** — 这三个是教学 Tier 特有的分析视图，保留在 Tier 系统内，不混入 eBPF Tab。

### 3.3 Tab 切换交互

- 顶部横向 Tab 导航，带滑动指示器动画
- Tab 右侧显示"实时模式"开关（各 Tab 通用）
- 窄屏时 Tab 折叠为下拉选择

---

## 4. 详细 Tab 设计

### 4.1 健康总览 (health)

**页面布局：三段式从上到下**

#### 第一段：健康评分横幅

```
┌─────────────────────────────────────────────────────────┐
│  🟢 健康评分：92/100                                    │
│  编译通过 · 无内存泄漏 · 无数据竞态 · 无死锁 · 资源正常    │
│  [查看详细报告]  [对比上次提交]  [导出报告]               │
└─────────────────────────────────────────────────────────┘
```

- 评分算法：编译(20分) + 资源(20分) + 内存(20分) + 并发(20分) + 执行正确性(20分)
- 每个维度一个子分数，点击跳转到对应 Tab
- 颜色编码：90+=绿色，70-89=琥珀色，<70=红色
- 横幅右侧显示 4 个核心检查项的状态徽章

#### 第二段：关键指标 KPI 卡片行（2行 × 4列）

**第一行：执行概要**

| 执行时间 | 系统调用总数 | 唯一系统调用 | 线程峰值 |
|---|---|---|---|
| 1.23s | 5,432 | 28 | 4 |

**第二行：问题检测摘要**（每个卡片可点击跳转到对应 Tab）

| 🟢 内存泄漏 | 🟢 数据竞态 | 🟢 死锁检测 | 🔴 资源告警 |
|---|---|---|---|
| 0 个确定泄漏 | 0 个竞态 | 无死锁 | 2 个告警 |
| 查看详情 → | 查看详情 → | 查看详情 → | 查看详情 → |

- 每个 KPI 卡片：数值 + 单位 + 趋势箭头 + 与基准对比
- 问题卡片：状态图标 + 问题计数 + 严重度级联

#### 第三段：时间线摘要

- 紧凑的甘特式时间线展示进程生命周期
- 关键事件标记：进程启动、线程创建、内存峰值、程序退出
- 悬停显示事件详情 tooltip
- 点击事件跳转到 syscalls Tab 的相关时间点

#### 数据源

- `GET /submissions/:id/sandbox-metrics`
- `GET /submissions/:id/leak-report` (只取 leak_summary)
- `GET /submissions/:id/race-report` (只取 race_summary)
- `GET /submissions/:id/deadlock-evolution` (只取 detected + cycle_info)
- `GET /submissions/:id/traces` (只取 summary)

---

### 4.2 资源监控 (resources)

**页面布局：两行**

#### 第一行：CPU & 内存概览（两个大卡片，各 50% 宽度）

**CPU 卡片**
- 环形仪表盘：CPU 使用率百分比
- 下方指标行：CFS 节流时间 | 上下文切换次数 | 线程数(运行/休眠)
- 趋势线：CPU 使用率随时间变化（从 syscall 密度推算）

**内存卡片**
- 环形仪表盘：内存使用率百分比
- 下方指标行：RSS | 工作集 | 限制 | OOM 风险分数
- OOM 风险进度条（颜色渐变：绿→琥珀→红）

#### 第二行：IO & FD 详细指标

**IO 卡片（50% 宽度）**
- 双柱状图：读取字节 vs 写入字节
- IO 等待百分比仪表
- 读写速率趋势线

**FD 与线程卡片（50% 宽度）**
- FD 使用量：当前值/软限制，进度条 + 数值
- 线程面板：总数、运行中、休眠中（小多色条状图）
- 缺页统计：minor vs major page faults

#### 告警横幅

当 sandbox-metrics 返回 alerts 时，在 Tab 顶部显示告警横幅：
- 按严重度排序（critical > warning > info）
- 每条告警：图标 + 消息 + 当前值 vs 阈值
- 可关闭，但下次加载时重新出现

#### 数据源

- `GET /submissions/:id/sandbox-metrics`

---

### 4.3 内存分析 (memory)

**页面布局：三行**

#### 第一行：泄漏检测摘要卡片

```
┌──────────────────────────────────────────────────────────┐
│  🔴 内存泄漏检测                                         │
│  ┌──────────┬──────────┬──────────┬──────────┐           │
│  │ 确定泄漏  │ 间接泄漏  │ 可能泄漏  │ 仍可访问  │           │
│  │   3 个   │   1 个   │   0 个   │   5 个   │           │
│  │  ████░░  │  ██░░░░  │  ░░░░░░  │  █████░  │           │
│  └──────────┴──────────┴──────────┴──────────┘           │
│  总分配: 12.5 MB  总释放: 10.2 MB  净增长: +2.3 MB       │
│  泄漏概率: 78%  峰值堆: 8.4 MB                           │
└──────────────────────────────────────────────────────────┘
```

- 四个严重度卡片用不同颜色（红、橙、黄、灰）
- 进度条表示占总泄漏的比例
- 如果有确定泄漏，卡片边框和标题变红

#### 第二行：堆趋势图（全宽）

- 折线图：X 轴 = 时间，Y 轴 = 堆大小
- 两条线：当前堆大小 + 峰值堆大小
- 分配/释放事件以散点标注在线下方
- 可缩放、可平移（ECharts dataZoom）
- 鼠标悬停显示时间点的详细堆快照

#### 第三行：泄漏详情列表 + 分配火焰图

**左栏（60%）：泄漏详情表**
- 表格列：严重度 | 地址 | 大小 | 分配时间 | 增长率 | 源代码位置 | 修复建议
- 严重度用彩色徽章
- 点击行展开详细信息：调用栈、分配上下文
- 默认按严重度排序（确定 > 间接 > 可能 > 可访问）
- 如果无泄漏，显示空状态："🎉 未检测到内存泄漏"

**右栏（40%）：Top 分配者卡片**
- 水平条形图：函数名 → 分配总量（降序）
- 每个条形显示：函数名、分配字节、分配次数、百分比
- 前 3 名用渐变色高亮
- 悬停显示源代码文件位置

#### 数据源

- `GET /submissions/:id/leak-report`（核心数据）
- `GET /submissions/:id/memory-trend`（堆趋势图）
- `GET /submissions/:id/alloc-flamegraph`（Top 分配者）

---

### 4.4 并发分析 (concurrency)

**页面布局：两行**

#### 第一行：竞态检测 + 死锁检测（两个卡片，各 50%）

**竞态检测卡片**
```
┌──────────────────────────────────────────┐
│  🟡 数据竞态检测                         │
│  ┌──────────────────────────────────┐    │
│  │ 发现 2 个竞态 | 线程数 4         │    │
│  │ 置信度: 72%                      │    │
│  └──────────────────────────────────┘    │
│  ┌──────────────────────────────────┐    │
│  │ 竞态 #1: 地址 0x7f... 写-写      │    │
│  │ 线程 1 ↔ 线程 3                  │    │
│  │ 源位置: trace:42 vs trace:78     │    │
│  │ Happens-Before: 否               │    │
│  │ [问 AI] [查看详情]               │    │
│  ├──────────────────────────────────┤    │
│  │ 竞态 #2: 地址 0x7f... 读-写      │    │
│  │ 线程 2 ↔ 线程 4                  │    │
│  │ [问 AI] [查看详情]               │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

- 顶部摘要行：竞态数量 + 线程数 + 置信度
- 竞态列表：每行一个竞态，显示冲突类型（读-写/写-写）、涉及的线程、源位置
- Happens-Before 状态用徽章（是=安全/否=危险）
- 如果无竞态：显示绿色空状态"未检测到数据竞态"
- "问 AI"按钮触发 AI 侧栏

**死锁检测卡片**
```
┌──────────────────────────────────────────┐
│  🔴 死锁检测                             │
│  ┌──────────────────────────────────┐    │
│  │ 检测到死锁 | 循环涉及 2 个线程    │    │
│  └──────────────────────────────────┘    │
│  ┌──────────────────────────────────┐    │
│  │ Coffman 条件满足情况:             │    │
│  │ ✅ 互斥        ✅ 持有并等待       │    │
│  │ ✅ 不可抢占    ✅ 循环等待         │    │
│  └──────────────────────────────────┘    │
│  循环: T1 → LockA → T2 → LockB → T1      │
│  [查看演化步骤] [问 AI]                  │
└──────────────────────────────────────────┘
```

- Coffman 四个条件各用一个带图标的小卡片
- 满足条件=红色勾，不满足=灰色叉
- 循环信息用流程图式文本展示
- "查看演化步骤"按钮展开死锁演化重放

#### 死锁演化重放（全宽，可折叠展开）

展开后在第二行显示：

```
┌──────────────────────────────────────────────────────────┐
│  死锁演化步骤重放                  [▶ 播放] [⏸ 暂停] [↺ 重置]  │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Step 1: 线程 1 获取锁 0xa0000000      (0.0ms)    │    │
│  │  Step 2: 线程 2 获取锁 0xa0000008      (1.2ms)    │    │
│  │  Step 3: 线程 1 尝试获取锁 0xa0000008  (2.5ms) ⚠  │    │
│  │  Step 4: 线程 2 尝试获取锁 0xa0000000  (3.8ms) ⚠  │    │
│  │  Step 5: ⚠ 死锁！循环等待检测到        (5.0ms) 🔴  │    │
│  └──────────────────────────────────────────────────┘    │
│  教学叙事:                                               │
│  "这是一个经典的 ABBA 死锁。线程 1 先获取锁 A 再尝试获取   │
│   锁 B，而线程 2 先获取锁 B 再尝试获取锁 A。两个线程互相    │
│   等待对方释放锁，导致死锁。修复方法：统一锁的获取顺序..."  │
└──────────────────────────────────────────────────────────┘
```

- 步骤列表：按时间排序，每步显示序号、线程、动作、锁地址、时间戳
- 等待步骤标黄色，死锁检测标红色
- 播放控制：自动逐步骤动画（300ms/步），可暂停、重置
- 当前步骤高亮，自动滚动到可见区域
- 教学叙事：后端返回的中文解释 + 修复建议

#### 数据源

- `GET /submissions/:id/race-report`
- `GET /submissions/:id/deadlock-evolution`
- SSE stream（实时锁图状态，仅实时模式）

---

### 4.5 系统调用 (syscalls)

**页面布局：两行**

#### 第一行：syscall 统计 KPI + 分类饼图

**KPI 行（4 个卡片）**
- 总调用次数 | 唯一 syscall 种类 | 错误次数 | 执行总时间

**分类饼图 + Top 10 柱状图（左右各 50%）**
- 左：按分类（I/O、内存、同步、进程、其他）着色的环形图
- 右：Top 10 调用频率最高的 syscall 柱状图

#### 第二行：时间线 + 详情面板

**全宽时间线视图**
- 甘特式时间线：横轴=时间，每个 syscall 一个色条（按分类着色）
- 错误 syscall 用红色标记
- 支持缩放平移（ECharts dataZoom）
- 点击色条选中，显示详情

**底部详情面板（选中时展开）**
```
┌──────────────────────────────────────────────────┐
│  write(fd=3, buf=0x7fff..., count=64) = 64       │
│  时间: 1.234s | 耗时: 12.3μs | PID: 1234         │
│  分类: I/O 读写                                   │
│  [问 AI: 这个 syscall 是什么意思？]               │
└──────────────────────────────────────────────────┘
```

#### 附加功能
- 按分类过滤（5 个分类开关按钮）
- 仅显示错误开关
- 搜索 syscall 名称
- 导出 CSV（可选）

#### 数据源

- `GET /submissions/:id/traces`

---

## 5. 通用组件设计

提取以下跨 Tab 使用的通用组件：

### 5.1 HealthBadge

```typescript
type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

interface HealthBadgeProps {
  status: HealthStatus;
  label: string;
  count?: number;
  onClick?: () => void;  // 跳转到对应 Tab
}
```

- 健康=绿色圆点 + "正常"文字
- 警告=琥珀色三角 + "N 个问题"
- 危险=红色菱形 + "N 个严重问题"
- 未知=灰色虚线圆，loading 动画
- 如果 count > 0，label 后面显示数字
- 如果 onClick 存在，显示 → 箭头表示可点击

### 5.2 MetricCard

```typescript
interface MetricCardProps {
  title: string;
  value: number | string;
  unit?: string;
  trend?: "up" | "down" | "stable";
  trendValue?: string;     // "+12%" 或 "比上次 -3%"
  status?: HealthStatus;
  comparisonValue?: string; // "上次: 1.5s"
  icon?: React.ReactNode;
  onClick?: () => void;
}
```

- 紧凑卡片：图标 + 标题(小字) + 值(大号) + 单位 + 趋势箭头 + 对比行
- 趋势箭头：上=绿色↑、下=红色↓、平=灰色→
- 可点击时加 hover 边框效果
- 状态颜色影响卡片左侧边框颜色

### 5.3 DetectionSummaryCard

```typescript
interface DetectionSummaryCardProps {
  title: string;
  icon: React.ReactNode;
  status: HealthStatus;
  summary: string;           // "0 个确定泄漏"
  details?: string;          // "总分配 12.5 MB"
  collapsedContent?: React.ReactNode; // 展开后的详情
  onClick?: () => void;      // 跳转到对应 Tab
}
```

- 在健康总览中展示一个问题检测摘要
- 左侧大面积状态色背景 + 图标
- 右侧标题 + 摘要 + 详情行
- 底部可展开区域(通过 Accordion)
- "查看详情 →"在右下角

### 5.4 AIAskButton

```typescript
interface AIAskButtonProps {
  context: string;              // 传给 AI 的上下文描述
  question?: string;            // 预设问题
  variant?: "inline" | "icon";
}
```

- inline 模式：显示为"问 AI"文字按钮，点击后弹出侧栏
- icon 模式：仅显示 Bot 图标
- 点击后打开 AI 对话侧栏，自动填入上下文和预设问题
- 复用现有的 AI 对话组件

### 5.5 EmptyState

```typescript
interface EmptyStateProps {
  type: "no-data" | "no-issues" | "loading" | "error";
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}
```

- no-data：灰色图标 + "暂无数据" + 说明文字
- no-issues：绿色图标 + "未检测到问题" + 鼓励文字
- loading：骨架屏或旋转图标 + "正在分析..."
- error：红色图标 + 错误信息 + 重试按钮

### 5.6 TabHeader

```typescript
interface TabHeaderProps {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (id: string) => void;
  rightContent?: React.ReactNode;  // 实时模式开关等
}
```

- 滑动的底部指示器（framer-motion layoutId）
- Tab 标签支持图标 + 文字
- 响应式：窄屏时折叠为下拉选择

---

## 6. 主题适配策略

### 6.1 ECharts 主题桥接

创建 `useEbpfChartTheme` hook，将 5 套 CSS 变量映射为 ECharts 主题配置：

```typescript
// 核心映射规则
const CHART_THEME_MAP = {
  textColor:        "var(--kt-text)",
  textColorSecondary: "var(--kt-text-secondary)",
  borderColor:      "var(--kt-border)",
  backgroundColor:  "transparent",
  axisLineColor:    "var(--kt-border-strong)",
  splitLineColor:   "var(--kt-border)",
  // 分类色板（与 syscall 分类一致）
  ioColor:          "var(--kt-cyan)",
  memColor:         "var(--kt-amber)",
  syncColor:        "var(--kt-green)",
  procColor:        "var(--kt-purple)",
  otherColor:       "var(--kt-text-tertiary)",
};
```

每个图表组件通过 `useEbpfChartTheme()` 获取当前主题的颜色映射。

### 6.2 5 主题下的差异化处理

| 主题 | 图表调整 | 强调色 |
|---|---|---|
| Light 浅白 | 使用较深的轴线颜色确保对比度 | #0071e3 (蓝) |
| Dark 暗黑 | 使用较亮的网格线(10% 透明度) | #00D4FF (青) |
| Warm 暖黄 | 暖色调色温偏移，降低蓝色饱和度 | #d97706 (琥珀) |
| Slate 墨蓝 | 网格线对比度提高至 14% | #38bdf8 (天蓝) |
| Neon 霓虹 | 网格线带绿色调，文字亮度+10% | #00ff41 (终端绿) |

### 6.3 色彩无障碍

- 所有状态指示除了颜色外，必须有图标区分（勾/叉/三角/圆）
- 图表中使用图案填充作为颜色的备选（ECharts 支持 pattern fill）
- 数据表格中的状态列同时显示颜色徽章和文字标签

---

## 7. 用户操作流程

### 7.1 主流程：提交代码 → 理解问题 → 修复

```
用户在编辑器中编写代码
        │
        ▼
点击"提交运行"
        │
        ▼
提交完成，自动打开 eBPF 追踪面板 (健康总览 Tab)
        │
        ├── 健康评分 85+ → 绿色横幅 → "程序运行正常"
        │    │
        │    └── 浏览资源监控 → 优化 CPU/内存使用
        │
        ├── 健康评分 60-84 → 琥珀色横幅 → "检测到潜在问题"
        │    │
        │    ├── 点击"内存泄漏: 2 个疑似" → 跳转内存分析 Tab
        │    │   查看泄漏详情 → 读修复建议 → 问 AI
        │    │
        │    └── 点击"资源告警: 1 个" → 跳转资源监控 Tab
        │        查看具体告警 → 调整代码
        │
        └── 健康评分 <60 → 红色横幅 → "检测到严重问题"
             │
             ├── 死锁检测 → 并发分析 Tab
             │   查看演化步骤重放 → 理解 ABBA 死锁 → 读教学叙事
             │
             └── 内存泄漏 → 内存分析 Tab
                 查看堆趋势 → 确认泄漏类型 → 找源代码位置
```

### 7.2 快捷路径

- **从 KPI 卡片跳转** — 健康总览的任何检测摘要卡片点击后直接跳转到对应 Tab，并自动滚动到相关区域
- **实时模式** — 打开实时开关后，各 Tab 的数据通过 SSE 实时更新，适合长时间运行的程序观察
- **AI 辅助** — 任何检测结果旁边的"问 AI"按钮，提供上下文感知的即时帮助
- **对比模式** — 健康总览和资源监控的"对比上次提交"，显示差分指标

### 7.3 状态流转

```
加载中 (骨架屏)
    │
    ├── 成功有数据 → 渲染完整内容
    │
    ├── 成功无问题 → 渲染绿色空状态 ("未检测到问题")
    │
    └── 失败 → 渲染错误状态 + 重试按钮
```

---

## 8. 组件树与数据流

### 8.1 组件树

```
SlideUpPanel
└── EBPFTracePanel (重构后)
    ├── TabHeader
    │   ├── Tab 标签列表 (5 tabs)
    │   └── 实时模式开关
    │
    ├── [health] HealthOverviewTab
    │   ├── HealthScoreBanner
    │   │   ├── 健康评分环形图
    │   │   ├── 子项分数列表
    │   │   └── 操作按钮组
    │   ├── MetricCardRow (2行×4列)
    │   │   ├── MetricCard (执行时间)
    │   │   ├── MetricCard (syscall 总数)
    │   │   ├── MetricCard (唯一 syscall)
    │   │   ├── MetricCard (线程峰值)
    │   │   ├── DetectionSummaryCard (内存泄漏)
    │   │   ├── DetectionSummaryCard (数据竞态)
    │   │   ├── DetectionSummaryCard (死锁)
    │   │   └── DetectionSummaryCard (资源告警)
    │   └── ProcessTimeline (紧凑甘特图)
    │
    ├── [resources] ResourceMonitorTab
    │   ├── AlertBanner (告警列表)
    │   ├── MetricCardRow (CPU + 内存仪表)
    │   │   ├── GaugeCard (CPU)
    │   │   └── GaugeCard (内存)
    │   ├── MetricCardRow (IO + FD)
    │   │   ├── ChartCard (IO 柱状图)
    │   │   └── StatCard (FD + 线程)
    │   └── DetailTable (缺页/上下文切换明细)
    │
    ├── [memory] MemoryAnalysisTab
    │   ├── LeakSummaryCard
    │   │   ├── SeverityGrid (4 个严重度块)
    │   │   └── HeaptrackStats (总分配/释放/净增长)
    │   ├── HeapTrendChart (全宽折线图)
    │   ├── LeakDetailsTable (泄漏详情表)
    │   └── TopAllocatorsChart (水平条形图)
    │
    ├── [concurrency] ConcurrencyAnalysisTab
    │   ├── Row
    │   │   ├── RaceDetectionCard
    │   │   │   ├── RaceSummary
    │   │   │   └── RaceList
    │   │   └── DeadlockDetectionCard
    │   │       ├── DeadlockSummary
    │   │       └── CoffmanConditionsGrid
    │   └── DeadlockReplay (可折叠)
    │       ├── PlaybackControls
    │       ├── StepTimeline
    │       └── TeachingNarrative
    │
    ├── [syscalls] SyscallAnalysisTab
    │   ├── MetricCardRow (4 KPI 卡片)
    │   ├── Row
    │   │   ├── CategoryPieChart (分类饼图)
    │   │   └── TopSyscallsBarChart (Top 10 柱状图)
    │   ├── SyscallTimeline (全宽甘特图)
    │   │   ├── 分类过滤器
    │   │   └── 错误开关
    │   └── DetailDrawer (选中 syscall 详情)
    │
    └── AIAskSidebar (问 AI 侧栏，所有 Tab 共用)
```

### 8.2 数据流

```
                    ┌─────────────────┐
                    │   EBPFTracePanel │
                    │  (root component)│
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         submissionId   experimentId   activeTab
              │              │              │
    ┌─────────┴─────────┐    │    ┌────────┴────────┐
    │  useEbpfData hook  │    │    │ Tab conditional │
    │                    │    │    │   rendering     │
    │ ┌────────────────┐ │    │    └────────┬────────┘
    │ │ fetchHealth()  │ │    │             │
    │ │ fetchResource()│ │    │    ┌────────┴────────────┐
    │ │ fetchMemory()  │ │    │    │ Individual Tab Hooks│
    │ │ fetchConcur()  │ │    │    ├─ useHealthData()   │
    │ │ fetchSyscalls()│ │    │    ├─ useResourceData() │
    │ └────────────────┘ │    │    ├─ useMemoryData()   │
    │   parallel fetch    │    │    ├─ useConcurrency()  │
    │   on mount          │    │    └─ useSyscallData()  │
    └─────────────────────┘    │                          │
                               │              ┌───────────┴──────────┐
                    ┌──────────┴──────────┐   │  Each hook manages:  │
                    │  Data Context/Store │   │  - loading/error/empty│
                    │  Zustand or Context │   │  - fetch + cache      │
                    │                     │   │  - SSE subscription   │
                    │  Shared state:      │   │  - auto-refresh       │
                    │  - all tab data     │   └──────────────────────┘
                    │  - activeTab        │
                    │  - realtimeMode     │
                    │  - AI context       │
                    └─────────────────────┘
```

### 8.3 数据获取策略

- **健康总览**：组件挂载时并行 fetch 所有 5 个 API，聚合计算健康评分
- **其他 Tab**：切换到对应 Tab 时按需 fetch（首次访问缓存结果）
- **实时模式**：开启后 SSE 连接到 `/ebpf/stream/:pid`，各 Tab 订阅相关事件类型
- **轮询**：非实时模式下，每 30 秒自动刷新（可配置）
- **缓存**：同一 submissionId 的数据在会话内缓存，切换 Tab 不重复请求

---

## 9. 实施计划

### Phase 1: 基础设施（预计 2-3 天）

**P1.1 扩展前端类型定义**

更新 `/frontend/types/ebpf.ts`，新增以下类型：

- `SandboxMetrics`（资源指标）
- `LeakReport` / `LeakResult` / `LeakSummary`
- `HeapTimelinePoint` / `MemoryTrendSummary`
- `RaceReport` / `RaceResult` / `RaceSummary`
- `DeadlockAnalysis` / `DeadlockStep` / `CoffmanConditions`
- `TopAllocator`
- `HealthScore` / `HealthStatus`

**P1.2 创建通用组件**

在 `/frontend/components/ebpf/` 下创建：
- `HealthBadge.tsx`
- `MetricCard.tsx`
- `DetectionSummaryCard.tsx`
- `AIAskButton.tsx`
- `EmptyState.tsx`
- `TabHeader.tsx`

**P1.3 创建 ECharts 主题桥接**

- `/frontend/hooks/useEbpfChartTheme.ts` — CSS 变量 → ECharts 配置映射
- 5 主题下的图表颜色预设

### Phase 2: 数据层（预计 1-2 天）

**P2.1 创建数据获取 hooks**

- `/frontend/hooks/useSandboxMetrics.ts`
- `/frontend/hooks/useLeakReport.ts`
- `/frontend/hooks/useMemoryTrend.ts`
- `/frontend/hooks/useAllocFlamegraph.ts`
- `/frontend/hooks/useRaceReport.ts`
- `/frontend/hooks/useDeadlockEvolution.ts`
- `/frontend/hooks/useEbpfHealth.ts`（聚合健康评分）

每个 hook：
- 管理 loading / error / data 三态
- 支持 refetch
- 支持 SSE 实时更新（可选）
- 30 秒内存缓存

**P2.2 创建 eBPF 数据 store (Zustand)**

- `ebpfStore` — 跨 Tab 的数据共享
- 状态：所有 API 数据、activeTab、realtimeMode、selectedTrace、AI context

### Phase 3: Tab 实现（预计 3-4 天）

**P3.1 健康总览 Tab**

- `HealthOverviewTab.tsx`
- `HealthScoreBanner.tsx`（评分环形图 + 子分数）
- 4 × KPI 卡片 + 4 × 检测摘要卡片
- 进程时间线（紧凑版）

**P3.2 资源监控 Tab**

- `ResourceMonitorTab.tsx`
- CPU 仪表卡片 + 内存仪表卡片
- IO 柱状图卡片 + FD/线程卡片
- 告警横幅

**P3.3 内存分析 Tab**

- `MemoryAnalysisTab.tsx`
- 泄漏摘要卡片（4 严重度格）
- 堆趋势折线图
- 泄漏详情表
- Top 分配者条形图

**P3.4 并发分析 Tab**

- `ConcurrencyAnalysisTab.tsx`
- 竞态检测卡片 + 死锁检测卡片
- 死锁演化重放（含播放控制）
- Coffman 条件可视化

**P3.5 系统调用 Tab**

- `SyscallAnalysisTab.tsx`（大部分复用现有代码，重构到新结构）
- 分类饼图 + Top 柱状图
- 时间线甘特图
- 详情抽屉

### Phase 4: 集成与打磨（预计 1-2 天）

**P4.1 重写 EBPFTracePanel 主组件**

- 替换旧 10 Tab 结构为新 5 Tab
- 集成 TabHeader + 实时模式开关
- 接入 eBPF store

**P4.2 添加过渡动画**

- Tab 切换：内容区淡入淡出 (framer-motion AnimatePresence)
- 数据加载：骨架屏 → 内容的平滑过渡
- 状态变化：健康评分数字滚动动画
- 死锁重放：步骤高亮逐个点亮动画

**P4.3 响应式适配**

- 桌面（≥1280px）：双列布局
- 平板（768-1279px）：单列布局，卡片堆叠
- 移动（<768px）：KPI 卡片 2 列，图表全宽

**P4.4 边界情况处理**

- 所有 API 返回空数据时 → EmptyState 组件
- 编译错误 / 运行时错误 → 错误状态 + 错误信息展示
- 部分 API 失败时 → 对应部分显示错误，其余正常渲染
- SSE 断连 → 自动重连 + 连接状态指示器
- 超大数据集 → 虚拟滚动 + 图表降采样

### Phase 5: 测试与收尾（预计 1 天）

- 5 个主题下的截图检查
- 键盘导航测试
- 屏幕阅读器测试
- 提交运行 → 自动打开面板 → 查看结果的端到端流程验证

---

## 附录 A：API 端点与数据类型速查

| API | Method | 关键返回字段 |
|---|---|---|
| `/ebpf/observe` | POST | `{ pid, status }` |
| `/ebpf/observe/:pid` | GET | `{ pid, status, probes, deadlock }` |
| `/ebpf/stream/:pid` | GET (SSE) | `{ type, payload }` — syscall/trace_event/graph/deadlock/safe/info/mem/sched/done/error |
| `/ebpf/deadlock/:submission_id` | GET | `{ detected, cycle, details, fix, lock_graph, syscall_counts }` |
| `/submissions/:id/sandbox-metrics` | GET | `{ cpu_percent, mem_percent, mem_rss_mb, io_read_bytes, io_write_bytes, fd_count, thread_count, page_faults_minor/major, context_switches, cfs_throttled_ms, mem_oom_risk, io_wait_percent, alerts[{type, severity, message, current_value, limit_value}] }` |
| `/submissions/:id/leak-report` | GET | `{ leaks[{severity, address, size, alloc_time, source_file, source_line, description, fix_suggestion, growth_rate}], heaptrack_summary[{total_allocated, total_freed, still_allocated, peak_heap, alloc_count, free_count, alloc_rate_mbps, free_rate_mbps, net_growth_mbps, leak_probability}], heap_history[{timestamp, heap_size, peak_heap, alloc_count, free_count}], leak_summary[{definitely_lost, indirectly_lost, possibly_lost, still_reachable, total_leaks, has_critical}] }` |
| `/submissions/:id/alloc-flamegraph` | GET | `{ top_allocators[{function, source_file, source_line, total_bytes, alloc_count, percent}], summary }` |
| `/submissions/:id/memory-trend` | GET | `{ heap_timeline[{timestamp, heap_size, peak_heap, alloc_count, free_count, alloc_rate_mbps, free_rate_mbps}], summary[{trend_direction, growth_rate_mbps, peak_heap_bytes, peak_time, still_allocated}] }` |
| `/submissions/:id/race-report` | GET | `{ races[{address, thread1, thread2, epoch1, epoch2, source_file1, source_line1, source_file2, source_line2, description, has_hb, teaching_hint}], race_summary[{total_accesses, total_races, unique_addresses, threads_involved, races_per_thread, unprotected_addrs, confidence_score}], thread_count, address_count }` |
| `/submissions/:id/deadlock-evolution` | GET | `{ detected, steps[{order, timestamp, tid, action, lock_addr, holder_tid, description}], coffman_conditions[{mutual_exclusion, hold_and_wait, no_preemption, circular_wait}], cycle_info, cycle_nodes, teaching_narrative }` |
| `/submissions/:id/traces` | GET | `{ summary[{total_count, error_count, unique_syscalls, execution_time_ns, syscall_counts}], traces[{time, pid, syscall_name, return_value, duration_ns, error_name, args}] }` |

## 附录 B：文件结构

```
frontend/
├── types/
│   └── ebpf.ts                          # 扩展：新增所有 API 响应类型
├── hooks/
│   ├── useEbpfChartTheme.ts             # 新增：ECharts 主题映射
│   ├── useSandboxMetrics.ts             # 新增
│   ├── useLeakReport.ts                 # 新增
│   ├── useMemoryTrend.ts                # 新增
│   ├── useAllocFlamegraph.ts            # 新增
│   ├── useRaceReport.ts                 # 新增
│   ├── useDeadlockEvolution.ts          # 新增
│   └── useEbpfHealth.ts                 # 新增：聚合健康评分
├── stores/
│   └── ebpfStore.ts                     # 新增：跨 Tab 数据共享
├── components/
│   ├── ebpf/
│   │   ├── shared/
│   │   │   ├── HealthBadge.tsx           # 新增
│   │   │   ├── MetricCard.tsx            # 新增
│   │   │   ├── DetectionSummaryCard.tsx  # 新增
│   │   │   ├── AIAskButton.tsx           # 新增
│   │   │   ├── EmptyState.tsx            # 新增
│   │   │   ├── TabHeader.tsx             # 新增
│   │   │   └── GaugeCard.tsx             # 新增
│   │   └── tabs/
│   │       ├── HealthOverviewTab.tsx      # 新增
│   │       ├── ResourceMonitorTab.tsx     # 新增
│   │       ├── MemoryAnalysisTab.tsx      # 新增
│   │       ├── ConcurrencyAnalysisTab.tsx # 新增
│   │       └── SyscallAnalysisTab.tsx     # 重构
│   └── workspace/
│       └── panels/
│           └── EBPFTracePanel.tsx         # 重写：接入新 Tab 结构
```

## 附录 C：健康评分算法

```
总分 100 = 编译(20) + 资源(20) + 内存(20) + 并发(20) + 执行(20)

编译 (20):
  编译成功 → 20
  编译警告 → 15
  编译失败 → 0

资源 (20):
  基础分 20
  CPU > 90% → -5
  内存 > 80% → -5
  OOM 风险 > 0.8 → -5
  FD 接近上限 → -5
  CFS 被节流 → -5
  (最低 0)

内存 (20):
  基础分 20
  确定泄漏 > 0 → -10
  间接泄漏 > 0 → -5
  可能泄漏 > 0 → -3
  泄漏概率 > 50% → -5
  净增长 > 1MB → -5
  (最低 0)

并发 (20):
  基础分 20
  竞态 > 0 → -8
  死锁 → -12
  (最低 0)

执行 (20):
  基础分 20
  运行时错误 → -10
  syscall 错误率 > 10% → -5
  非零退出码 → -5
  (最低 0)
```