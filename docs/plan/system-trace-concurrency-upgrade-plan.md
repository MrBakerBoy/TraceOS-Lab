# TraceOS 系统 Trace 与并发可视化升级方案

> **对标产品**：Jaeger · Grafana Tempo · Chrome DevTools Performance · ThreadSanitizer · VisualVM
> **核心目标**：从「单线程顺序 syscall 列表」升级为「多线程并发时间线 + 竞态检测 + 死锁深度分析 + 线程调度可视化」的全景并发观测体系。

---

## 行业最佳实践参考

在制定升级方案之前，我们深入研究了以下行业标杆产品的最佳实践，将其核心理念融入 TraceOS 的教学可视化体系中。

### Jaeger 分布式追踪最佳实践 (2025)

Jaeger 作为 CNCF 毕业的分布式追踪项目，其设计哲学对 TraceOS 的 Span 层级和 Trace 可视化有直接指导意义：

**Span 命名规范**：Jaeger 强调使用模式化的 Span 名称，而非直接嵌入变量值。例如，正确的 Span 名称应为 `GET /api/users/{id}` 而非 `GET /api/users/12345`。动态参数应放入 Span Attributes（标签）中，避免高基数（high cardinality）导致索引膨胀和查询性能下降。TraceOS 借鉴此理念，在 Span 构建器中自动提取系统调用模式（如 `read(fd={n})`）并剥离具体参数值存入标签。

**标签数量控制**：每个 Span 的标签数量建议控制在约 10 个以内，避免信息过载。敏感数据（密码、密钥、个人身份信息）严禁写入 Span 标签。TraceOS 的 Span 模板系统内置标签筛选机制，自动过滤高敏感性字段。

**四种核心可视化视图**：Jaeger 提供 Trace Graph（DAG 依赖图）、Trace Flamegraph（火焰图模式）、Trace Statistics（统计面板）、Spans Table（Span 列表）四种视图。TraceOS 借鉴此分层设计，在 Span 层级视图中提供树图 + 火焰图双模式，并在多线程泳道图中融合 DAG 依赖箭头。

**Trace 对比回归分析**：Jaeger 支持两条 Trace 的并排对比，红色表示耗时增加（回归），绿色表示优化（改善）。TraceOS 将此能力引入时间线视图，支持选中两段时间范围后自动计算差异统计，以红色/绿色编码展示各系统调用的性能变化。

**分层观测策略**："Dashboard for health, sampling for anomalies, drill-down for details"（仪表盘看健康、采样看异常、下钻看细节）。TraceOS 将此策略映射为三层视图：全景仪表盘（资源健康）→ 泳道时间线（异常标注）→ Span 详情面板（逐调用分析）。

**智能采样策略**：Jaeger 的 Tail Sampling（尾部采样）是推荐方案——在请求完成后决定是否保留，可确保 100% 的慢请求（>1s）和 100% 的错误 Trace 被保留，同时仅对正常流量采样 1%。TraceOS 将此逻辑应用于实验运行时的 Trace 数据筛选：自动保留所有含错误/异常的 syscall 序列，对正常执行的实验仅保留关键帧。

**日志与 Trace 关联**：Jaeger 最佳实践要求将 `trace_id` 和 `span_id` 注入结构化日志，实现 Trace 到日志的无缝跳转。TraceOS 在输出实验日志时自动注入 `traceos_trace_id` 和 `traceos_span_id` 字段，学生可从时间线直接跳转到对应时刻的日志输出。

**大量 Span 的虚拟化渲染**：对于包含 1000+ Span 的复杂 Trace，Jaeger 采用虚拟化渲染以避免 UI 卡顿。TraceOS 在时间轴组件中引入窗口化渲染（windowing），仅渲染可视时间范围内的 syscall 色块，支持万级系统调用量的流畅交互。

### Chrome DevTools Performance Panel 最佳实践

Chrome DevTools 的 Performance 面板是多线程泳道视图的标杆实现，其核心设计要素包括：

**多线程泳道布局**：每个线程（Main / Raster / Compositor / Worker）占据独立水平泳道，共享同一时间轴。泳道内以彩色色块表示活动类型，颜色编码遵循明确约定——黄色=脚本执行，紫色=渲染，绿色=绘制，蓝色=加载。TraceOS 借鉴此设计，以蓝色=I/O、绿色=进程管理、橙色=内存、红色=锁操作、紫色=信号的色彩体系编码 syscall 类别。

**跨线程异步箭头**：Chrome DevTools 使用跨泳道箭头表示主线程与 Worker 之间的异步通信。TraceOS 将此扩展为 IPC 可视化：pipe 通信、signal 发送、futex_wake 唤醒均以跨泳道虚线箭头标注，箭头上的时间差标注通信延迟。

**缩放与拖拽交互**：鼠标滚轮缩放时间轴，拖拽平移，拖拽选择时间范围进行聚焦分析。TraceOS 的统一时间轴工具栏完整实现此交互模式。

**User Timing Marks**：开发者可通过 `performance.mark()` 在关键事件点插入标记。TraceOS 将此概念引入为"实验事件标注"——fork()、exec()、futex_wait、死锁形成点等关键事件自动在时间轴上以菱形标记 + 文字标签展示。

### ThreadSanitizer (TSan) 竞态检测算法

ThreadSanitizer 是 LLVM/GCC 编译器中内置的数据竞争检测工具，其核心算法基于 **Happens-Before（HB）关系分析**，这是学术界公认的竞态检测金标准：

**TSan v2/v3 核心算法**：采用纯 Happens-Before 分析 + Shadow Memory（影子内存）机制。每个 8 字节应用内存单元被映射到 4 个 Shadow Cell，每个 Cell 编码线程 ID（TID）、逻辑时钟 Epoch、访问偏移及大小、访问类型（读/写/原子）。检测逻辑为：对于同一内存地址的两次访问，若来自不同线程、至少一次为写操作、两访问间无 HB 关系（当前线程的向量时钟不足以证明其已知晓另一线程的访问）、且非两原子读操作，则报告数据竞争。

**向量时钟机制**：每个线程维护 ThreadClock（向量时钟），每个同步对象（mutex 等）维护 SyncClock。Lock 获取时：`thread_clock.acquire(mutex_clock)`（线程继承锁的时钟），Lock 释放时：`mutex_clock.release(thread_clock)`（锁时钟被更新为线程时钟）。HB 关系通过比较向量时钟 Epoch 确定。

**TraceOS 简化版 HB 算法**：鉴于 TraceOS 是教育平台（非生产级竞态检测器），我们采用简化版 HB 算法，保留核心概念但降低实现复杂度：

1. **访问历史追踪**：按内存地址维护访问记录列表，每条记录包含时间戳、线程 ID、访问类型（读/写）、源文件行号、是否持有锁标志。
2. **竞态判定四条规则**：两次访问来自不同线程 + 至少一次是写 + 两次访问无锁保护 + 两次访问时间窗口重叠。
3. **教学化输出**：不直接输出原始 TSan 风格的晦涩报告，而是将每次检测到的竞态转化为"并发故事"——展示两条线程的时间线，标注冲突点和无保护的共享变量。

---

## 一、系统 Trace 模块现状与升级目标

### 1.1 现状分析

**当前能力**：
- 瀑布图 (WaterfallTimeline) — Gantt 式 syscall 展示
- 表格视图 — 传统列表，支持过滤
- AI 分析视图 — 阶段分析 + 性能洞察
- 执行回放 (ExecutionReplayBar) — 时间轴回放
- 错误过滤 — 仅显示错误调用

**关键缺失**：

| 缺失项 | 严重度 | 对标差距 |
|--------|--------|---------|
| **无多线程并发视图** — syscall 按全局时间排序，看不到线程间并发关系 | 🔴 致命 | Chrome DevTools 有多线程泳道 |
| **无 Span 层级** — 看不到高层语义 (如 "handle_request" 包含 3 个 syscall) | 🔴 致命 | Jaeger 有 Span 树 |
| **无线程状态标注** — 看不出线程何时在运行/等待/阻塞 | 🟡 重要 | VisualVM 线程状态面板 |
| **无竞态条件检测** — 无法发现 data race | 🟡 重要 | TSan 的核心能力 |
| **无事件标注** — 时间线上无关键事件标记 | 🟡 重要 | Chrome DevTools 有 User Timing |
| **无调度可视化** — 看不到 CPU 调度导致的上下文切换影响 | 🟡 重要 | Linux perf sched |
| **死锁图与时间线分离** — 各在各自 Tab，无联动 | 🟢 增强 | — |
| **无水瀑布图功能** — 无法缩放/拖拽/选择时间范围 | 🟢 增强 | Jaeger 交互丰富 |

### 1.2 升级愿景

```
当前:  单线程顺序 Gantt 图 + 表格 + AI 文字
          ↓
目标:  多线程泳道并发图 + Span 树 + 线程状态机 + 竞态高亮 + 死锁联动 + 调度可视化
```

---

## 二、系统 Trace 核心升级

### 2.1 多线程泳道视图 (Multi-Thread Lane View)

借鉴 **Chrome DevTools Performance Panel** 的多泳道设计和 **Jaeger** 的 Trace 可视化理念：

```
┌──────────────────────────────────────────────────────────────────┐
│  多线程并发视图 (Jaeger 风格 Trace Graph + 泳道)                 │
│                                                                  │
│  Thread 100 (main) │[init──][read──][fork────][wait──][exit]     │
│                    │  ░░░░░░  ░░░░░░  ░░░░░░░░  ░░░░░░  ░░░░   │
│                    │         ↕ (fork+exec, 延迟 0.3ms)          │
│  Thread 101 (child)│              [exec──][compute──][write][exit]│
│                    │               ░░░░░░  ░░░░░░░░░░  ░░░░░ ░░░ │
│                    │                        ↕ (futex_wake)       │
│  Thread 102 (worker)│             [lock(m)══][unlock──][lock(m)⏳]│
│                    │              ░░░░░░░░░░░  ░░░░░░░░  ░░░░░░░ │
│                    │                                             │
│  ═══ 运行中  ⏳ 阻塞等待  ⚡ 上下文切换  ☠ 死锁点                │
│  ↕ IPC/通信箭头 (pipe/signal/futex)                              │
│                                                                  │
│  事件标注: ◆ fork()  ◆ exec()  ◆ futex_wait  ◆ deadlock        │
│                                                                  │
│  时间轴: ├────────────┼────────────┼────────────┼────────────┤  │
│          0s          500ms        1s          1.5s         2s   │
│                                                                  │
│  🔍 选中范围 [1.2s - 1.6s]: 3 个 syscall, 2 个线程, 0 错误      │
│  对比模式: [🔴 本范围耗时 +15% vs 基线]                          │
└──────────────────────────────────────────────────────────────────┘
```

**核心设计要素（升级版）**：

| 要素 | 说明 | 对标 |
|------|------|------|
| **横向泳道** | 每个线程/进程独立一行，线程名采用模式化命名（如 `worker-{n}`），动态 ID 放入标签 | Chrome DevTools Main/Worker/Raster threads |
| **泳道内色块** | 宽度 = 耗时，颜色 = syscall 类别 (I/O=蓝, 进程=绿, 内存=橙, 锁=红, 信号=紫) | Jaeger Span color coding + Chrome DevTools 颜色约定 |
| **跨泳道箭头** | 显示进程间通信: pipe ↔, signal ↕, futex_wake ↕，箭头标注通信延迟 | Chrome DevTools async arrows |
| **事件标注 (User Timing)** | 在时间轴上以菱形 ◆ 标记关键事件：fork(), exec(), futex_wait, 死锁形成点 | Chrome DevTools performance.mark() |
| **时间轴缩放/平移** | 鼠标滚轮缩放，拖拽平移，支持窗口化渲染（可视范围内渲染，万级 syscall 顺畅交互） | Chrome DevTools timeline zoom + Jaeger 虚拟化 |
| **选择时间范围** | 拖拽选择 → 统计选中范围内的 syscall，支持 Trace 对比（红=耗时增加, 绿=优化） | Chrome DevTools flame chart selection + Jaeger Trace Compare |
| **虚拟化渲染** | 对于 1000+ Span/Syscall 的场景，仅渲染可视时间窗口内的元素 | Jaeger 大规模 Trace 渲染 |

### 2.2 Span 层级视图 (Hierarchical Span View)

借鉴 **Jaeger** 的 Span 树和 **Chrome DevTools** 的调用树：

```
当前:  扁平 syscall 列表
       clone → execve → openat → read → close → write → exit

升级:  Span 层级树（Jaeger 风格）
       ┌─ 🟢 fork_exec_workflow (450ms)
       │   ├─ clone (0.5ms)         [tags: flags=CLONE_VFORK]
       │   ├─ execve (2ms)           [tags: binary=/bin/child]
       │   └─ 🟢 init_child (447ms)  [tags: pid=101]
       │       ├─ openat (0.3ms)     [tags: fd=3, path=/data/input]
       │       ├─ read (300ms)       [tags: fd=3, bytes=4096] ← ⚠️ 耗时最长
       │       ├─ close (0.1ms)      [tags: fd=3]
       │       └─ write (5ms)        [tags: fd=1, bytes=128]
       └─ 🟢 parent_wait (500ms)
           ├─ wait4 (499ms)          [tags: target_pid=101] ← 等待子进程
           └─ exit (0.2ms)           [tags: code=0]

每个 Span 包含:
  • span_id / parent_span_id: Jaeger 兼容的层级关系
  • operation_name: 模式化名称（如 "read fd={n}"，具体 fd 值在 tags 中）
  • duration_ms: 持续时间（毫秒）
  • syscall_count: 包含的 syscall 数量
  • error_count: 错误数量（红色标注）
  • self_time_ms: 自身耗时（不含子 Span）
  • tags (≤10): 精选标签，不含敏感数据
  • traceos_trace_id: 与日志关联的 Trace ID

💡 设计理念：遵循 Jaeger 最佳实践——Span 名称使用模式而非具体值，
    变量参数存入 tags，每个 Span 标签数控制在 ~10 个以内。
```

**实现方案**：
- `core/services/span_builder.go`：根据 syscall 序列自动构建 Span 层级
- 利用实验概念 Rubric 预定义 Span 模板：

```go
// core/services/span_templates.go
var SpanTemplates = map[string]SpanTemplate{
    "process": {
        {
            Name: "fork_exec_workflow",
            Pattern: []string{"clone", "execve"},
            Tags: []string{"flags", "binary"},
            Parent: "",
        },
        {
            Name: "parent_wait",
            Pattern: []string{"wait4", "waitpid"},
            Tags: []string{"target_pid"},
            Parent: "",
        },
        {
            Name: "init_child",
            Pattern: []string{"openat", "read", "close"},
            Tags: []string{"fd", "path", "bytes"},
            Parent: "fork_exec_workflow",
        },
    },
    "thread": {
        {
            Name: "thread_create",
            Pattern: []string{"clone"},
            Tags: []string{"flags", "child_tid"},
            Parent: "",
        },
        {
            Name: "critical_section",
            Pattern: []string{"futex_wait", "futex_wake"},
            Tags: []string{"futex_addr"},
            Parent: "",
        },
    },
    "memory": {
        {
            Name: "malloc_workflow",
            Pattern: []string{"brk", "mmap"},
            Tags: []string{"size", "prot"},
            Parent: "",
        },
        {
            Name: "free_workflow",
            Pattern: []string{"munmap"},
            Tags: []string{"addr", "size"},
            Parent: "",
        },
    },
}
```

### 2.3 线程状态可视化 (Thread State Machine)

借鉴 **VisualVM** 的线程状态面板：

```
每个线程/进程以状态机方式展示:

Thread 101 (PID=12345):
  运行 ████████░░░░░░░░░░░░░░░░░░░░░░░░░ 25%
  就绪 ░░░░░░░░████░░░░░░░░░░░░░░░░░░░░░ 10%
  阻塞 ░░░░░░░░░░░░████████████░░░░░░░░░░ 35%  ← 等待 I/O
  等待 ░░░░░░░░░░░░░░░░░░░░░░░░████████░░ 25%  ← 等待锁
  死亡 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██  5%

状态切换图:
  就绪 ──(被调度)──▶ 运行 ──(时间片到)──▶ 就绪
                   运行 ──(等待I/O)──▶ 阻塞 ──(I/O完成)──▶ 就绪
                   运行 ──(获取锁)──▶ 等待 ──(锁释放)──▶ 就绪
                   运行 ──(退出)──▶ 死亡
```

### 2.4 竞态条件检测与可视化 (Race Detection)

这是**最重要的教学能力**——让学生"看见"并发 bug。本模块借鉴 **ThreadSanitizer (TSan) 的 Happens-Before 算法**，采用简化的教育版实现：

#### TSan 算法核心原理

TSan v2/v3 采用纯 Happens-Before 分析 + Shadow Memory 机制：

**Shadow Memory 映射**：TSan 将每个 8 字节应用内存映射到 4 个 Shadow Cell（每个 Cell 编码线程 ID、逻辑时钟 Epoch、访问偏移/大小、读/写类型）。通过 `MemToShadow(addr)` 函数进行地址转换，在 `MemoryAccessImpl1()` 中检查所有 4 个 Shadow Slot 以发现冲突访问。

**向量时钟（Vector Clock）**：每个线程维护 `ThreadClock`，每个同步对象维护 `SyncClock`。锁获取时执行 `thread_clock.acquire(mutex_clock)`（线程继承锁的时钟状态），锁释放时执行 `mutex_clock.release(thread_clock)`（锁时钟被更新）。Happens-Before 关系通过比较两个 Epoch 确定：若 `thread_clock[other_tid] >= other_epoch`，则当前线程已知晓另一线程的访问，存在 HB 关系，不报告竞态。

**竞态判定条件**（TSan 经典四条件）：(1) 两次访问来自不同线程；(2) 至少一次是写操作；(3) 两访问间无 Happens-Before 关系（无锁保护、无同步原语介入）；(4) 非两原子读操作。

#### TraceOS 简化版 HB 算法

作为教育平台，TraceOS 不追求 TSan 的生产级覆盖率和向量时钟精度，而是将核心概念透明化，让学生直观理解竞态检测原理：

```
┌──────────────────────────────────────────────────────────────┐
│  ⚡ 竞态条件检测 (Data Race Detection) — TSan 教育版         │
│                                                              │
│  📊 检测引擎: Happens-Before 关系分析 (TSan 简化算法)         │
│                                                              │
│  共享变量: int shared_counter (地址: 0x7fff...1234)          │
│  Shadow Cell: [TID=101, Epoch=42, W, offset=0, size=4]       │
│               [TID=102, Epoch=43, W, offset=0, size=4] ⊗ 冲突!│
│                                                              │
│  TID=101:  ... read(1234)  ... write(1234, 42)  ...        │
│            ░░░░░░░░░░░░░░░ ░░░░░░░░░░░░░░░░░░░░░░           │
│             Epoch=40         Epoch=42                        │
│                               🔴 ← 无锁保护!                  │
│                                                              │
│  TID=102:  ... read(1234)  ... write(1234, 99)  ...        │
│            ░░░░░░░░░░░░░░░ ░░░░░░░░░░░░░░░░░░░░░░           │
│             Epoch=41         Epoch=43                        │
│                               🔴 ← Epoch 42↔43 无 HB 关系!   │
│                                                              │
│  Happens-Before 分析:                                        │
│  ThreadClock[101] = [101:42, 102:0]                          │
│  ThreadClock[102] = [101:0,  102:43]                         │
│  ❌ 比较: clock[101][102]=0 < epoch(102)=43 → 无 HB 关系     │
│  ❌ 比较: clock[102][101]=0 < epoch(101)=42 → 无 HB 关系     │
│  ➡️ 结论: TID=101 和 TID=102 之间无线程同步 → 数据竞争!      │
│                                                              │
│  ═══════════ Race #1 ═══════════                             │
│  时间: T+1500ms                                              │
│  位置: worker.c:42 ← main.c:18                              │
│  描述: TID=101 和 TID=102 同时写入 shared_counter            │
│        Epoch 42 和 Epoch 43 之间不存在 Happens-Before 关系    │
│        无互斥锁保护 → 最终值不确定                            │
│                                                              │
│  💡 教学提示: 这是经典的数据竞争 (data race)。               │
│     TSan 通过 Happens-Before 关系判定: 如果线程 A 的时钟       │
│     向量无法证明它"已知晓"线程 B 的写入，则两操作之间         │
│     不存在同步关系 → 报告竞态。                               │
│     两个线程同时写入共享变量，没有任何同步保护。             │
│     修复方法: 在访问 shared_counter 前后加                   │
│     pthread_mutex_lock/unlock。                              │
│     这是你学习互斥锁最好的实践场景!                          │
└──────────────────────────────────────────────────────────────┘
```

**实现方案**：
- 基于 eBPF 探针采集的内存访问事件（uprobe on memory read/write）
- 后端新增 `core/services/race_detector.go`
- 检测算法: Happens-Before 关系分析（TSan 简化版，教育透明化）

```go
// core/services/race_detector.go
// 基于 TSan v2/v3 的 Happens-Before 算法简化版
type RaceDetector struct {
    // Shadow Memory: 地址 → 访问历史（模拟 TSan 的 Shadow Cell）
    shadowMemory map[uint64][]ShadowCell
    // 向量时钟: 每个线程的逻辑时钟
    threadClocks map[int]ThreadClock
    // 同步对象时钟: mutex 等同步原语的时钟
    syncClocks   map[uint64]SyncClock
}

// ShadowCell 模拟 TSan 的 Shadow Cell 结构
type ShadowCell struct {
    ThreadID   int       // 执行访问的线程 ID
    Epoch      int64     // 线程的逻辑时钟 Epoch（简化版标量时钟）
    AccessType string    // "read" or "write"
    Offset     uint32    // 地址偏移
    Size       uint32    // 访问大小
    Timestamp  time.Time // 物理时间戳（辅助展示）
    SourceLine int       // 源码行号
    Locked     bool      // 是否持有锁
}

// ThreadClock 简化版向量时钟（完整版需 []int，简化版用 map）
type ThreadClock struct {
    Epoch int64 // 当前线程的逻辑时钟
}

// SyncClock 同步对象的时钟（锁释放时记录，获取时继承）
type SyncClock struct {
    OwnerTID int   // 最后释放该锁的线程
    Epoch    int64 // 释放时的逻辑时钟
}

func (rd *RaceDetector) DetectRace() []RaceReport {
    reports := []RaceReport{}

    for addr, cells := range rd.shadowMemory {
        // TSan 核心检测逻辑:
        for i := 0; i < len(cells); i++ {
            for j := i + 1; j < len(cells); j++ {
                a, b := cells[i], cells[j]

                // 条件 1: 不同线程
                if a.ThreadID == b.ThreadID {
                    continue
                }
                // 条件 2: 至少一次是写
                if a.AccessType != "write" && b.AccessType != "write" {
                    continue
                }
                // 条件 3: 无锁保护
                if a.Locked && b.Locked {
                    continue
                }
                // 条件 4: 无 Happens-Before 关系
                // 检查: 线程 a 的时钟是否已知晓线程 b 的访问
                if rd.happensBefore(a, b) || rd.happensBefore(b, a) {
                    continue
                }
                // 条件 5: 时间窗口重叠
                if !rd.isOverlapping(a, b) {
                    continue
                }

                reports = append(reports, RaceReport{
                    Address:    addr,
                    Thread1:    a.ThreadID,
                    Thread2:    b.ThreadID,
                    Epoch1:     a.Epoch,
                    Epoch2:     b.Epoch,
                    Timestamp:  a.Timestamp,
                    SourceLine1: a.SourceLine,
                    SourceLine2: b.SourceLine,
                    Description: fmt.Sprintf(
                        "TID=%d (Epoch=%d) 和 TID=%d (Epoch=%d) 之间缺少 Happens-Before 关系",
                        a.ThreadID, a.Epoch, b.ThreadID, b.Epoch,
                    ),
                })
            }
        }
    }

    return reports
}

// happensBefore 判断访问 a 是否 happens-before 访问 b
// 简化版: 检查线程 b 的时钟是否"知晓"线程 a 的写入
// 完整 TSan 使用向量时钟比较，此处用 Epoch 链式比较作为教学简化
func (rd *RaceDetector) happensBefore(a, b ShadowCell) bool {
    // 简化判定: 如果访问 b 的线程在访问 b 时已通过锁获取
    // 继承了一个包含 a 的 Epoch 的时钟，则存在 HB 关系
    clockB, exists := rd.threadClocks[b.ThreadID]
    if !exists {
        return false
    }
    // 检查线程 b 的时钟是否达到了 a 发生时的逻辑时间
    return clockB.Epoch >= a.Epoch && b.Timestamp.After(a.Timestamp)
}
```

### 2.5 死锁可视化增强

当前 DeadlockGraph 已有力导向锁图，但需要增强：

```
增强一: 死锁演化回放
┌───────────────────────────────────────────────────────────┐
│  死锁演化过程 (5步回放)                                   │
│                                                           │
│  Step 1: T1 获取 Lock A  ✅                               │
│  Step 2: T2 获取 Lock B  ✅                               │
│  Step 3: T1 请求 Lock B → ⏳ 等待 (T2 持有 B)            │
│  Step 4: T2 请求 Lock A → ⏳ 等待 (T1 持有 A)            │
│  Step 5: 🔴 死锁形成! 循环等待: T1→A→T2→B→T1            │
│                                                           │
│  [▶ 自动播放]  [◀ 上一步]  [下一步 ▶]                    │
│                                                           │
│  Coffman 四条件检查:                                      │
│  ✅ 互斥: Lock A 和 Lock B 都是互斥锁                     │
│  ✅ 持有并等待: T1 持有 A 的同时等待 B                    │
│  ✅ 不可剥夺: 锁不能被强制释放                             │
│  ✅ 循环等待: T1→A→T2→B→T1 形成环路                      │
│  ➡️ 结论: 四个条件全部满足 → 必然死锁                     │
└───────────────────────────────────────────────────────────┘

增强二: 锁图联动时间轴
  在时间轴上拖动回放 → 死锁图实时更新到对应时刻的锁状态

增强三: 修复建议动画
  动画展示以下修复方案的代码变更:
  • 统一加锁顺序: 总是先锁 A 再锁 B
  • 使用 trylock: pthread_mutex_trylock()
  • 减小临界区: 只在必要时持有锁
```

### 2.6 上下文切换可视化 (Scheduler Visualization)

参考 Linux `perf sched` 的输出，可视化 CPU 调度行为：

```
┌───────────────────────────────────────────────────────────┐
│  CPU 调度时间线                                           │
│                                                           │
│  CPU0:  [──T101──][──T102──][─T101─][──T103──][──T101──] │
│  CPU1:  [──T104──────────────][──T105──][────]           │
│                                                           │
│  上下文切换事件 (switch):                                  │
│  ⚡ T+120ms: T101 → T102 (时间片到期)                     │
│  ⚡ T+350ms: T102 → T101 (T102 阻塞等待 I/O)              │
│  ⚡ T+500ms: T101 → T103 (T101 时间片到期)                │
│                                                           │
│  迁移事件 (migration):                                     │
│  🔄 T+800ms: T104 从 CPU1 迁移到 CPU0                     │
│                                                           │
│  📊 统计:                                                 │
│  • 总切换次数: 45                                         │
│  • 非自愿切换 (时间片): 32 (71%)                          │
│  • 自愿切换 (阻塞): 13 (29%)                              │
│  • CPU 迁移: 2                                            │
│                                                           │
│  💡 教学提示: 频繁的上下文切换会降低性能。                 │
│     这里的切换主要来自时间片到期，属于正常的调度行为。     │
│     如果是大量自愿切换，则说明程序经常阻塞等待。           │
└───────────────────────────────────────────────────────────┘
```

---

## 三、并发问题检测体系

### 3.1 并发问题全景矩阵

TraceOS 应当能检测以下并发问题，并给出教学引导：

```
                    检测能力矩阵
                静态分析   动态追踪   AI诊断
                  (AST)    (eBPF)   (LLM)
死锁 (Deadlock)    🟡       ✅       ✅
数据竞争 (Race)    🟡       🟡       ✅
活锁 (Livelock)    ❌       ❌       🟡
饥饿 (Starvation)  ❌       🟡       ✅
优先级反转        ❌       🟡       ✅
原子性违规        ❌       🟡       ✅
锁顺序违规        ✅       ✅       ✅
内存可见性问题     ❌       ❌       🟡

✅ = 可检测  🟡 = 部分可检测  ❌ = 无法检测

💡 检测策略分层:
   Layer 1 - 全景仪表盘: 健康评分 → 快速定位异常实验
   Layer 2 - 采样异常检测: 100% 保留错误/异常, 正常实验仅保留关键帧
   Layer 3 - 深度下钻: 点击异常 → Span 详情 → 源码定位 → 修复建议
```

### 3.2 教学化的问题叙事

每个检测到的问题，不是简单报错，而是"讲一个教学故事"：

```
🔴 检测到: 死锁 (Deadlock)

📖 这是什么?
死锁是两个或多个线程互相等待对方释放资源，导致所有线程都无法继续执行。

🎬 你的程序的"死锁故事":
1. 线程 A 获取了 mutex_1，准备打印第一段文字
2. 线程 B 获取了 mutex_2，准备打印第二段文字
3. 线程 A 想获取 mutex_2 继续打印 → 但 mutex_2 被 B 持有 → 等待...
4. 线程 B 想获取 mutex_1 继续打印 → 但 mutex_1 被 A 持有 → 等待...
5. 💀 两个线程永远等待对方——这就是死锁

📚 相关 OS 知识点:
• 死锁的四个必要条件 (Coffman, 1971)
• 资源分配图 (RAG)
• 死锁预防 vs 死锁避免 vs 死锁检测

🔧 修复方案 (按推荐顺序):
1. [推荐] 统一加锁顺序: 总是先锁 mutex_1 再锁 mutex_2
2. 使用 trylock + 回退
3. 使用更细粒度的锁或读写锁

❓ 思考题: 如果系统有 5 个线程和 5 个锁，如何避免死锁？
```

---

## 四、Trace 模块前端交互升级

### 4.1 统一时间轴交互

借鉴 Jaeger 和 Chrome DevTools 的交互模式：

```
┌──────────────────────────────────────────────────────────────┐
│  Timeline Toolbar                                            │
│  [◀◀] [▶] [▶▶] [⏸]  ├───●━━━━━━━━━━━━━○───┤  [🔍 -] [🔍 +] │
│  后退  播放 快进 暂停     0s ← 拖拽 → 2.5s      缩小    放大  │
│                                                              │
│  [选择范围: 1.2s - 1.8s]  [重置]  [聚焦错误]  [聚焦事件]    │
│  [对比基线]  [导出 Trace]                                    │
│                                                              │
│  视图模式: [🏊 泳道] [🌳 Span树] [📊 统计] [📋 表格]         │
│  对比显示: 🔴 +15% (慢于基线)  🟢 -8% (快于基线)             │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 多维度数据展示

```
当前 TraceViewer: 瀑布图 | 表格 | AI (3个视图)

升级后 TraceViewer: 泳道图 | Span树 | 线程状态 | 调度图 | 统计 | 表格 | AI (7个视图)

视图切换栏:
[🏊 泳道] [🌳 Span树] [📊 状态] [🔄 调度] [📈 统计] [📋 表格] [🤖 AI]
                                                └── 当前选中的视图高亮

Jaeger 四视图映射:
  Trace Graph (DAG)    → 泳道图 + 跨线程箭头
  Trace Flamegraph     → Span 树火焰图模式
  Trace Statistics     → 统计面板 (耗时分布 / P50 / P95 / P99)
  Spans Table          → 表格视图
```

### 4.3 跨模块联动

```
Trace 时间线 + 其他模块联动:

在 Trace 时间轴上点击某时刻:
  → 火焰图: 自动切换到该时刻的火焰图快照
  → 内存3D: 回放到该时刻的内存布局
  → 锁图: 显示该时刻的锁等待图
  → 资源监控: 高亮该时刻的资源状态
  → 源码: 如果该时刻有对应的源码行，编辑器跳转

跨模块数据关联: 通过统一的 traceos_trace_id 和 span_id
  在时间线、日志、资源图表间无缝跳转

实现: 通过 ObsContext 的事件总线 + Zustand Store 的 replayTimestamp
```

---

## 五、技术实现方案

### 5.1 后端新增/修改

| 文件 | 功能 |
|------|------|
| `core/services/span_builder.go` | syscall → Span 层级构建（遵循 Jaeger 命名规范: 模式化名称 + tags） |
| `core/services/thread_state_tracker.go` | 线程状态机追踪 |
| `core/services/race_detector.go` | 数据竞争检测（TSan 简化版 Happens-Before 算法 + Shadow Cell） |
| `core/services/deadlock_evolver.go` | 死锁演化步骤分析 |
| `core/services/sched_visualizer.go` | 调度可视化数据准备 |
| `core/services/trace_comparator.go` | Trace 对比分析（红色=回归, 绿色=优化） |
| `core/ebpf/loader.go` | 新增内存访问探针 (用于竞态检测) |
| `core/handler/trace.go` | 新增 API: span-tree, thread-states, race-report, trace-compare |

### 5.2 前端新增/修改

| 文件 | 功能 |
|------|------|
| `panels/MultiThreadLaneView.tsx` | 多线程泳道图（虚拟化渲染, 事件标注, 跨线程 IPC 箭头） |
| `panels/SpanTreeView.tsx` | Span 层级树（Jaeger 风格: 树图 + 火焰图双模式） |
| `panels/ThreadStateView.tsx` | 线程状态机可视化 |
| `panels/RaceDetectionView.tsx` | 竞态条件检测面板（TSan 教育版, 展示 HB 分析过程） |
| `panels/SchedVisualizer.tsx` | CPU 调度可视化 |
| `panels/DeadlockEvolution.tsx` | 死锁演化回放 |
| `panels/TraceCompareView.tsx` | Trace 对比视图（红绿差异编码） |
| `panels/WaterfallTimeline.tsx` | 大幅升级为统一时间轴（窗口化渲染） |
| `panels/TraceViewer.tsx` | 扩展为 7 视图切换 |
| `DeadlockGraph.tsx` | 增加联动 + 演化动画 |

---

## 六、实施优先级

### 🔴 P0 — 并发可视化基础

| 任务 | 工时 | 价值 |
|------|------|------|
| 多线程泳道视图（含虚拟化渲染 + IPC 箭头 + 事件标注） | 4天 | 并发理解的颠覆性提升 |
| Span 层级视图（Jaeger 命名规范 + 双模式） | 2天 | 从"看 syscall"到"看语义" |
| 死锁演化回放 | 2天 | 将抽象概念可视化 |
| 跨模块联动 (replayTimestamp + trace_id 注入) | 1天 | 统一体验的关键 |

### 🟡 P1 — 深度分析

| 任务 | 工时 | 价值 |
|------|------|------|
| 竞态条件检测 + 可视化（TSan 教育版 HB 算法） | 4天 | 填补教学空白 |
| 线程状态机 | 2天 | 理解线程生命周期 |
| 上下文切换可视化 | 2天 | 理解 CPU 调度 |
| Trace 对比分析 | 1天 | 性能回归检测 |
| 教学问题叙事模板 | 1天 | 每个问题都有故事 |

### 🟢 P2 — 体验增强

| 任务 | 工时 | 价值 |
|------|------|------|
| 时间轴高级交互 (缩放/选择/对比/导出) | 2天 | 专业级体验 |
| 并发问题检测矩阵 + 分层策略 | 1天 | 全景视野 |
| 修复建议动画 | 2天 | 教学可视化 |
| Jaeger 风格统计面板 (P50/P95/P99) | 1天 | 性能洞察 |

---

*文档版本 v2.0 | 最后更新 2026-08-06*
*关联文档: master-observability-upgrade-plan.md | ebpf-trace-flamegraph-upgrade-plan.md*
*参考来源: Jaeger Distributed Tracing Best Practices 2025 · Chrome DevTools Performance Panel · ThreadSanitizer Happens-Before Algorithm*
