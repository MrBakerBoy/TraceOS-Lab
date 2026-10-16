# TraceOS 内存 3D 地图与资源监控升级方案

> **对标产品**：Heaptrack · Valgrind Massif · AddressSanitizer · cAdvisor · Grafana Dashboards · Datadog · Netdata
> **核心目标**：从「静态 3D 内存布局 + 宿主机资源仪表盘」升级为「动态内存全生命周期追踪 + 泄漏自动检测 + 沙箱内细粒度资源监控 + 跨事件关联」的内存与资源统一观测体系。

---

## 行业最佳实践参考

在制定升级方案之前，我们深入研究了以下行业标杆产品的最佳实践，将其核心理念融入 TraceOS 的教学可视化体系中。

### Heaptrack + Massif + Valgrind 分层内存分析策略

业界对内存分析工具的选型遵循"先轻后重"的分层策略，即在保证分析精度的前提下，优先使用开销最低的工具。TraceOS 将此分层理念映射为教学场景下的多级分析管线：

**Tier 1 — Heaptrack 优先（日常开发与长时运行服务）**：Heaptrack 通过 `LD_PRELOAD` 拦截 `malloc`/`calloc`/`realloc`/`free`，记录调用栈、分配大小和时间戳，输出压缩的 `.zst` 文件。其运行时开销仅约 2 倍减速（远低于 Valgrind 的 10-100 倍），保留多线程并行性（Massif 会将多线程串行化执行），支持运行时附着（attach）到已运行进程、时间差分（time-diffing）分析特定阶段的内存增量。**关键能力**：Heaptrack 可在无头服务器上采集数据，`.zst` 文件可传输到开发者笔记本上用 GUI 分析。TraceOS 借鉴此模式——学生在沙箱中运行实验时，TraceOS 后台自动采集 Heaptrack 格式的内存事件，实验结束后生成可传播的分析报告。

**Tier 2 — Valgrind Memcheck 确认泄漏（泄漏取证定论）**：当 Heaptrack 报告疑似泄漏后，使用 Valgrind Memcheck (`--leak-check=full`) 进行确定性判定。Memcheck 将泄漏分为四类：definitely lost（确认泄漏 — 无可达指针）、indirectly lost（间接泄漏 — 父块泄漏导致子块不可达）、possibly lost（疑似泄漏 — 指针指向块内部而非起始位置）、still reachable（程序结束时仍有可达指针）。这四分类体系是泄漏教学的黄金标准。TraceOS 的泄漏检测器直接映射此分类体系。

**Tier 3 — Massif 堆峰值分析**：Valgrind Massif 专精于堆内存随时间变化的精确图表，`ms_print` 工具可生成文本格式的归档报告，非常适合 CI Runner 自动化归档。Massif 的 `--depth`、`--detailed-freq`、`--max-snapshots`、`--threshold` 参数支持精细调控分析粒度。TraceOS 的内存趋势仪表盘直接对标 Massif Visualizer 的堆趋势图。

**Tier 4 — ASan/LSan CI/CD 集成**：AddressSanitizer (ASan) 和 LeakSanitizer (LSan) 作为编译器插桩方案，运行时开销约 2 倍，适合集成到 CI/CD 管线中实现自动化回归检测。每次学生提交代码后，CI Runner 自动运行 ASan/LSan 编译的二进制，捕获内存错误并归档。

### Grafana 复合风险指标

Grafana 仪表盘最佳实践强调"可行动的指标"（actionable metrics），即指标的呈现应直接指向行动方向。单一的原始值（如 CPU=58%）信息密度不足，复合风险指标通过加权组合多个信号，提供更高维度的决策依据：

**Saturation Index（饱和度指数）**：加权组合 CPU 使用率 + 内存使用率 + 连接等待队列长度。单个指标接近极限可能是正常波动，但多个资源同时趋近饱和则意味着系统即将进入降级状态。计算公式：`SatIndex = w1×(CPU%) + w2×(Mem%) + w3×(ConnWait/maxConn)`。

**Dependency Risk Score（依赖风险评分）**：组合上游依赖的 5xx 错误率 + 延迟飙升幅度。评分越高，表示本服务受下游故障影响的风险越大。在 TraceOS 语境中，映射为沙箱内进程的依赖健康度——例如文件系统响应延迟 + 系统调用错误率。

**Backlog Growth Rate（积压增长率）**：队列深度的导数（`deriv(queue_depth[10m])`）。绝对队列深度可能因短时波动而触警，但增长率（斜率）是更具前瞻性的信号——`deriv(lag[10m]) > 0 AND lag > threshold` 的双条件报警比单一阈值报警更有意义。

**TraceOS 应用**：将这三个复合指标引入资源监控仪表盘顶层，作为学生实验的"健康评分"——健康评分 = 100 - (SatIndex × 40 + DepRiskScore × 30 + BacklogGrowth × 30)。当健康评分低于 70 时自动触发告警，引导学生检查资源使用情况。

### Datadog 事件关联标注

Datadog 的时间序列小部件支持 Event Overlay 功能，允许在指标趋势图上叠加业务事件标注，直接回答"什么操作导致了资源尖峰"这一核心问题：

**事件标注查询语法**：使用 `sources:jenkins,github` 和 `tags:env:production` 格式的过滤条件，在时间序列上以竖线标记事件发生时刻。Filter Bar 使用 Field:Value 格式的"活性标签片"（active chips）进行交互式筛选。

**TraceOS 应用**：在资源趋势图上自动标注实验事件——fork() 进程创建、malloc() 大内存分配、线程创建、文件打开等操作以竖线标记，点击标注可跳转到 Trace 时间轴的对应时刻。Filter Bar 支持按事件类型（进程/内存/IO/锁）筛选，以可移除的 Chip 形式展示激活的过滤条件。

### cAdvisor 容器资源监控

Google cAdvisor 是容器资源监控的事实标准，其设计哲学直接指导 TraceOS 的沙箱进程级监控：

**Per-Container 细粒度指标**：cAdvisor 通过直接读取 `/sys/fs/cgroup` 下的 cgroup 文件系统伪文件，暴露 90+ 个 `container_*` 前缀的 Prometheus 指标。关键指标超越传统的 CPU/Memory 二元组，包括：`container_cpu_cfs_throttled_seconds_total`（CPU 节流时间）、`container_memory_working_set_bytes`（工作集内存 — OOM Killer 实际判定的基准值）、`container_memory_rss`（匿名内存/堆栈）、`container_oom_events_total`（OOM Kill 事件计数）、`container_tasks_state`（各状态的线程数）、`container_network_receive_packets_dropped_total`（网络丢包数）。

**Cgroup 限制可视化**：cAdvisor 同时暴露资源的实际使用值和 cgroup 配置的限制值。例如 `container_memory_working_set_bytes`（实际使用）vs `container_spec_memory_limit_bytes`（硬限制），两者之比即为 OOM 风险率（`ratio > 0.9` 时触发预警）。`container_cpu_cfs_throttled_seconds_total` 直接揭示 CPU 配额耗尽导致的性能退化。

**OOM 事件时间线关联**：cAdvisor 通过 `container_oom_events_total`（OOM Kill 事件计数）和 `container_memory_failures_total`（内存分配失败计数）追踪 OOM 事件。TraceOS 将此映射为沙箱内进程的 OOM 时间线——当学生程序被 OOM Killer 终止时，在资源趋势图上标注精确的 Kill 时间点，同时关联被杀前的内存增长曲线，让学生理解"为什么会 OOM"。

**TraceOS 应用**：将沙箱（nsjail）内进程的 cgroup 指标映射为 cAdvisor 风格的精细监控面板，覆盖 Page Faults（主缺页/次缺页）、FD 数量、线程数、cgroup 限制 vs 实际使用的仪表盘。

### Netdata ML 实时异常检测与预测

Netdata 的 ML 引擎代表了 2025 年监控领域的前沿方向——在数据采集时实时进行异常检测，无需云端依赖：

**核心算法**：使用无监督 k-means 聚类（k=2, dlib 实现），为每个指标维护 18 个模型（6 小时窗口 × 3 小时滚动间隔，约 54 小时的滚动行为模式）。只有当全部 18 个模型达成共识时才标记异常，消除约 99% 的误报。异常检测在采集时完成，检出延迟 <1 秒。资源效率极高：每指标 ~18KB RAM，10000 个指标仅消耗单核的 2-4%。

**检测类型**：Point Anomalies（单点异常值）、Contextual Anomalies（上下文序列偏离）、Collective Anomalies（多指标组合异常）、Concept Drifts（基线缓慢漂移）、Change Points（基线突然跳变）。

**预测趋势线**：基于历史模式的容量规划趋势线，预测资源何时触达限制。

**TraceOS 应用**：将 Netdata 的 ML 理念简化映射为教学场景——在资源仪表盘中提供"异常概率指示器"，当学生程序的内存/CPU 模式偏离正常实验的基线行为模式时，以概率值（如 "89% 概率存在内存泄漏"）替代二元告警。预测趋势线帮助学生理解"如果继续这样分配内存，堆将在 X 秒后达到 cgroup 限制"。

---

## 一、内存 3D 地图模块现状与升级目标

### 1.1 现状分析

**当前能力**：
- Three.js 3D 渲染 — 视觉表现力强
- 6 段布局 (Text/Data/BSS/Heap/mmap/Stack) — 结构完整
- 堆增长动画 (react-spring) — 动态感好
- mmap 出现/消失动画 — 细节好
- 回放控制条 — 可手动/自动播放

**关键缺失**：

| 缺失项 | 严重度 | 对标差距 |
|--------|--------|---------|
| **无内存泄漏自动检测** — 纯可视化，需要学生自己判断 | 🔴 致命 | Valgrind/ASan 自动报告 |
| **无分配调用栈回溯** — 看不到是哪行代码分配的内存 | 🔴 致命 | Massif/Heaptrack 核心能力 |
| **无内存趋势分析** — 看不到"堆在持续增长→泄漏"的预警 | 🔴 致命 | Massif Visualizer 有趋势图 |
| **无语义化标注** — mmap 区域不区分文件映射 vs 匿名映射 | 🟡 重要 | /proc/pid/maps 有完整信息 |
| **无内存碎片可视化** — 看不到内存碎片化程度 | 🟡 重要 | 高级内存分析器有 |
| **无快照对比** — 不能并排对比两个时刻的内存状态 | 🟡 重要 | Massif Visualizer 有 |
| **3D 交互受限** — 不能点击区域查看详情 | 🟢 增强 | — |
| **无内存热力图** — 无访问频率的颜色映射 | 🟢 增强 | — |

### 1.2 升级愿景

```
当前:  精美 3D 积木 + 回放滑块
          ↓
目标:  内存泄漏自动报警 + 分配调用栈回溯 + 内存趋势仪表盘 + 快照对比 + 点击即源码
```

---

## 二、内存 3D 地图核心升级

### 2.1 内存泄漏自动检测引擎

借鉴 **Valgrind Memcheck** 的四分类体系和 **Heaptrack** 的实时追踪能力：

```
┌──────────────────────────────────────────────────────────────┐
│  🔍 内存泄漏检测报告 (Valgrind Memcheck 四分类 + Heaptrack)  │
│                                                              │
│  ⚠️ 检测到 2 处疑似内存泄漏                                  │
│                                                              │
│  ┌─ Leak #1: Definitely Lost (确认泄漏) ────────────────┐   │
│  │ 📍 位置: main.c:45 → load_data()                     │   │
│  │ 📦 泄漏大小: 128 bytes (1 × 128 bytes)               │   │
│  │ 📝 分配: malloc(128) @ T+320ms                        │   │
│  │ 🔴 状态: 确认泄漏 — 分配后无 free，无可达指针         │   │
│  │         (Valgrind 分类: definitely lost)               │   │
│  │                                                       │   │
│  │ 📊 调用栈 (Heaptrack 格式):                           │   │
│  │   main() @ main.c:42                                  │   │
│  │     → load_data() @ main.c:45 ← 🔴 泄漏点             │   │
│  │       → malloc(128) @ libc                            │   │
│  │         → brk() @ kernel                              │   │
│  │                                                       │   │
│  │ 💡 修复: 在 load_data() 返回前或使用完毕后调用        │   │
│  │          free(ptr) 释放分配的内存                     │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ Leak #2: Possibly Lost (疑似泄漏) ──────────────────┐   │
│  │ 📍 位置: worker.c:23 → process_chunk()               │   │
│  │ 📦 泄漏大小: 4096 bytes (累计 4 次分配)              │   │
│  │ 🟡 状态: 疑似泄漏 — 指针指向块内部，非起始位置        │   │
│  │         (Valgrind 分类: possibly lost)                 │   │
│  │ 📈 Heaptrack 趋势: 分配斜率 > 0 MB/s, 释放斜率 ≈ 0   │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  📊 分层检测管道:                                            │
│  Tier 1 (Heaptrack) → 实时追踪, 标记疑似泄漏                 │
│  Tier 2 (Memcheck) → 确认泄漏, 四分类定论                    │
│  Tier 3 (Massif)   → 堆峰值分析, 堆趋势图                    │
│  Tier 4 (ASan/LSan) → CI/CD 自动化回归                       │
└──────────────────────────────────────────────────────────────┘
```

**检测算法**：

```go
// core/services/leak_detector.go
// 基于 Valgrind Memcheck 四分类体系 + Heaptrack 实时追踪理念
type LeakDetector struct {
    allocations map[uint64]*AllocRecord  // ptr → 分配记录
    heapGrowth  []HeapSnapshot           // 堆大小历史
    // Heaptrack 风格的实时追踪
    allocRate   float64                  // 分配速率 (MB/s)
    freeRate    float64                  // 释放速率 (MB/s)
}

type AllocRecord struct {
    Address    uint64
    Size       uint64
    AllocTime  time.Time
    CallStack  []StackFrame
    Freed      bool
    FreedAt    *time.Time
}

type LeakSeverity string

const (
    DefinitelyLost LeakSeverity = "definitely"   // 确认泄漏: 无 free, 无可达指针
    IndirectlyLost LeakSeverity = "indirectly"   // 间接泄漏: 父块泄漏, 子块不可达
    PossiblyLost   LeakSeverity = "possibly"     // 疑似泄漏: 指针指向块内部
    StillReachable LeakSeverity = "reachable"    // 可到达: 程序结束时仍有指针
)

func (ld *LeakDetector) Analyze() []LeakReport {
    reports := []LeakReport{}

    // 规则 1: 确认泄漏 (Valgrind: definitely lost)
    // 分配了但从未释放，且指向该内存的指针已丢失
    for _, rec := range ld.allocations {
        if !rec.Freed && ld.isPointerLost(rec.Address) {
            reports = append(reports, LeakReport{
                Severity: DefinitelyLost,
                Record:   rec,
            })
        }
    }

    // 规则 2: 疑似泄漏 (Valgrind: possibly lost)
    // 指针指向块内部非起始位置 — 无法正确 free
    for _, rec := range ld.allocations {
        if !rec.Freed && ld.isInteriorPointer(rec.Address) {
            reports = append(reports, LeakReport{
                Severity: PossiblyLost,
                Record:   rec,
            })
        }
    }

    // 规则 3: Heaptrack 实时趋势异常
    // 分配速率持续 > 释放速率，且差值扩大
    growthRate := ld.calculateGrowthRate()
    if growthRate > 1024*1024 { // > 1MB/s 净增长
        reports = append(reports, LeakReport{
            Severity:    PossiblyLost,
            GrowthRate:  growthRate,
            Description: fmt.Sprintf("堆持续增长 %.2f MB/s, 释放速率仅 %.2f MB/s",
                ld.allocRate, ld.freeRate),
        })
    }

    // 规则 4: brk/mmap 不匹配 — 分配远大于释放
    if ld.allocRate > 10*ld.freeRate {
        // ...
    }

    return reports
}
```

### 2.2 分配调用栈回溯 (Allocation Call Stack)

借鉴 **Heaptrack** 的核心能力——把每次内存分配关联到调用栈：

```
┌──────────────────────────────────────────────────────────────┐
│  内存分配火焰图 (Allocation Flame Graph — Heaptrack 风格)      │
│  (宽度 = 分配的总字节数)                                     │
│                                                              │
│  main()                                                     │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
│  init()          process()              cleanup()           │
│  ░░░░░░░░        ░░░░░░░░░░░░░░░░░░░░   ░░░                 │
│                  load_data()   compute()                     │
│                  ░░░░░░░░░░   ░░░░░░░░░   ← 分配热点!        │
│                  malloc(10MB) malloc(8MB)                    │
│                                                              │
│  📊 Heaptrack 风格统计:                                      │
│  • Peak Heap (峰值堆): 14.2 MB @ T+4.5s                     │
│  • Temporary Allocations (临时分配/分配流失): 3.1 MB         │
│  • Total Allocated (总分配): 21.2 MB                         │
│  • Top Allocator: load_data() — 10MB (47%)                   │
│                                                              │
│  🔍 点击 load_data() → 查看源码中分配位置                    │
│  📈 load_data() 趋势: [═══平稳═══] → 正常，一次性分配       │
│  📈 compute() 趋势: [═══持续增长═══] → ⚠️ 注意! 是否泄漏?   │
│                                                              │
│  💡 Heaptrack 提示: Temporary Allocations 高说明存在          │
│     频繁的"分配→释放→再分配"循环，考虑对象池复用。           │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 内存趋势仪表盘 (Memory Trend Dashboard)

借鉴 **Massif Visualizer** 的设计和 **Massif ms_print** 的文本归档能力：

```
┌──────────────────────────────────────────────────────────────┐
│  内存使用趋势 (Massif Visualizer 风格)                       │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 堆大小                                                │   │
│  │ 15MB ┤                           ╭──────             │   │
│  │ 10MB ┤              ╭────────────╯                    │   │
│  │  5MB ┤    ╭─────────╯                                 │   │
│  │  1MB ┤──╮╯                                            │   │
│  │    0 ┼──┴────┬────┬────┬────┬────┬────┬────           │   │
│  │         0s   1s   2s   3s   4s   5s   6s              │   │
│  └──────────────────────────────────────────────────────┘   │
│                           ⬆  ⬆                ⬆             │
│                     load_data  compute          ⚠️ leak?     │
│                                                              │
│  Key Metrics (Massif ms_print 风格):                         │
│  • 峰值内存: 14.2 MB @ T+4.5s                               │
│  • 平均增长速率: 2.3 MB/s                                   │
│  • 最终未释放: 0.5 MB (3.5% of peak) — ✅ 可接受             │
│  • brk 调用: 12 次 | mmap 调用: 3 次 | munmap 调用: 3 次    │
│  • 碎片化指数: 12% (空闲块分散程度)                          │
│                                                              │
│  📄 Massif ms_print 文本归档报告:                             │
│  [导出 ms_print] — 生成 CI Runner 友好的文本格式报告         │
│  [导出 Heaptrack .zst] — 生成可传输到开发机的压缩数据        │
└──────────────────────────────────────────────────────────────┘
```

### 2.4 3D 视图交互增强

```
增强一: 点击区域查看详情
┌────────────────────────────────────────────┐
│  点击 Heap 区域 →                          │
│                                            │
│  📦 堆 (Heap)                              │
│  ├─ 起始地址: 0x405000                     │
│  ├─ 当前大小: 4.2 MB (brk)                │
│  ├─ 增长次数: 8 次                         │
│  ├─ 分配来源 (Heaptrack Top Allocators):   │
│  │   ├─ load_data() → malloc(10MB) @ main.c:45
│  │   ├─ compute() → malloc(8MB) @ worker.c:23
│  │   └─ init() → malloc(2MB) @ main.c:12
│  └─ 泄漏风险: 🟢 低 (最终释放率 96.5%)       │
│                                            │
│  [📝 查看源码]  [📊 查看分配火焰图]         │
│  [📄 导出 ms_print]  [📦 导出 .zst]        │
└────────────────────────────────────────────┘

增强二: 快照对比模式 (Massif Visualizer 风格)
┌────────────────────┬────────────────────┐
│  时刻 T=1.0s       │  时刻 T=5.0s       │
│  ┌──────────────┐  │  ┌──────────────┐  │
│  │   Stack      │  │  │   Stack      │  │
│  │   Heap ▓▓    │  │  │   Heap ▓▓▓▓▓ │  │  ← 堆增长!
│  │   BSS        │  │  │   mmap ▓▓    │  │  ← 新增映射
│  │   Data       │  │  │   BSS        │  │
│  │   Text       │  │  │   Data       │  │
│  └──────────────┘  │  │   Text       │  │
│                     │  └──────────────┘  │
├────────────────────┴────────────────────┤
│  📊 差异: Heap +2.5MB, mmap +1MB        │
│  ⚠️ mmap 区域在程序结束前未释放          │
└─────────────────────────────────────────┘

增强三: 内存热力图 (访问频率)
颜色从冷色→暖色表示该内存区域的访问频率:
  蓝色(冷) = 很少访问 → 可能是浪费的内存
  红色(热) = 频繁访问 → 热点数据

增强四: 虚拟地址空间全景
不只显示 6 段简化布局，显示完整的 /proc/pid/maps:
  [vsyscall] [vdso] [stack] [mmap:libc.so] ...
  所有映射区域都展示，更像真实的地址空间
```

### 2.5 内存分配源关联 (Source-Level Annotation)

直接在代码编辑器中显示内存分配信息：

```
源码视图 (带内存标注):
┌──────────────────────────────────────────────────────┐
│  main.c                                              │
│                                                      │
│  42 │  void process() {                              │
│  43 │      // ...                                    │
│  44 │      data = malloc(10 * 1024 * 1024);          │
│      │      └─ 💾 堆 +10MB | 分配 #3 | T+1.2s       │
│      │      └─ 📍 Heaptrack: main.c:44 → process()   │
│  45 │                                                │
│  46 │      result = compute(data);                   │
│  47 │                                                │
│  48 │      free(data);                               │
│      │      └─ 💾 堆 -10MB | 释放 #1 | T+4.8s       │
│  49 │  }                                             │
│                                                      │
│  左侧边栏 — 内存标注条:                              │
│  ▓▓▓▓▓░░░░░  ← 绿色=分配, 红色=未释放, 灰色=无操作   │
└──────────────────────────────────────────────────────┘
```

---

## 三、资源监控模块现状与升级目标

### 3.1 现状分析

**当前能力**：
- CPU/Memory 仪表盘 (ECharts gauge) — 基础好
- 历史趋势折线图 — 时序展示
- 磁盘 IOPS / 上下文切换 / 网络吞吐 — 指标相对全面
- 实时 WebSocket 数据 — 实时性好

**关键缺失**：

| 缺失项 | 严重度 | 对标差距 |
|--------|--------|---------|
| **仅监控宿主机** — 不监控沙箱内的进程资源 | 🔴 致命 | 教育场景需要进程级 |
| **无事件关联** — 资源尖峰不知道是什么操作引起的 | 🔴 致命 | Datadog 有事件标注 |
| **无告警/通知** — 资源异常不会提示 | 🟡 重要 | 所有监控系统都有 |
| **无沙箱限制可视化** — 看不到 cgroup 限制和实际使用的关系 | 🟡 重要 | cAdvisor 有容器资源 |
| **指标太少** — 缺少 page faults, fd count, thread count, OOM events | 🟡 重要 | cAdvisor/htop 都有这些 |
| **无复合风险指标** — 单一阈值告警, 无饱和度/依赖/积压等复合判断 | 🟡 重要 | Grafana 复合指标最佳实践 |
| **无异常预测** — 看不到资源使用的未来趋势和异常概率 | 🟢 增强 | Netdata 有 ML 预测 |
| **无历史对比** — 不能对比两次运行的资源消耗 | 🟢 增强 | — |

### 3.2 升级愿景

```
当前:  宿主机 CPU/Memory 仪表盘 + 基础指标
          ↓
目标:  沙箱内进程细粒度监控 + 事件关联标注 + cgroup 资源限制可视化 +
       复合风险指标 + 异常预测 + 多运行对比
```

---

## 四、资源监控核心升级

### 4.1 沙箱内进程级细粒度监控 (cAdvisor 风格)

借鉴 **cAdvisor** 的 per-container 细粒度设计和 **Netdata** 的实时指标广度：

```
当前: 监控的是 TraceOS 宿主机的 CPU/内存
         (不知道学生程序到底用了多少资源)

升级: 监控沙箱 (nsjail) 内进程的精确资源 (cAdvisor 风格 90+ 指标):

┌──────────────────────────────────────────────────────────┐
│  🖥️ 沙箱资源监控 (cAdvisor 风格 per-process)              │
│                                                          │
│  ┌── 进程概览 ────────────────────────────────────────┐ │
│  │ PID: 12345  |  命令: ./student_program              │ │
│  │ 线程数: 3   |  文件描述符: 5/1024                    │ │
│  │ FD 分配/释放: 15 alloc / 10 close (差值: +5)        │ │
│  │ 运行时间: 4.2s  |  Start Time: T+0.0s               │ │
│  │ 任务状态: running=2, sleeping=1, zombie=0            │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌── CPU (cAdvisor: cpu_usage + cfs_throttled) ───────┐ │
│  │  CPU 使用率: [████████████░░░░░░░░░░] 58%          │ │
│  │  用户态: 35%  |  内核态: 23%  |  I/O等待: 2%       │ │
│  │  CFS 节流时间: 0ms (未被限流)                        │ │
│  │  CPU 运行队列延迟: 1.2ms avg                        │ │
│  │  限制: cgroup cpu.max = 100% (1 core)               │ │
│  │  使用/限制比: 58% → 🟢 正常余量                      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌── 内存 (cAdvisor: usage + working_set + rss) ──────┐ │
│  │  内存使用: [█████████░░░░░░░░░░░] 45%              │ │
│  │  Working Set (OOM 判定基准): 42MB                    │ │
│  │  RSS (匿名内存/堆栈): 38MB  |  Page Cache: 7MB       │ │
│  │  VSS (虚拟地址空间): 120MB                           │ │
│  │  Swap 使用: 0MB                                      │ │
│  │  Page Faults: 1,245 (maj: 3, min: 1,242)            │ │
│  │  限制: cgroup memory.max = 256MB                     │ │
│  │  OOM 风险率: 42/256 = 16.4% → 🟢 安全                │ │
│  │  OOM Kill 事件: 0 次                                  │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌── I/O (cAdvisor: fs_reads/writes + blkio) ─────────┐ │
│  │  磁盘读取: 2.3MB  |  磁盘写入: 1.1MB               │ │
│  │  IOPS: 读 45/s, 写 12/s                             │ │
│  │  I/O 等待时间: 8ms avg                               │ │
│  │  FS 使用/限制: 15MB / 500MB (3%) — 🟢                │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌── 网络 (cAdvisor: net_rx/tx + dropped) ────────────┐ │
│  │  (如果实验允许网络)                                  │ │
│  │  接收: 0.5MB  |  发送: 0.2MB                       │ │
│  │  接收丢包: 0  |  发送丢包: 0                       │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌── cgroup 限制概览 ─────────────────────────────────┐ │
│  │  CPU 限制: 1 core (CFS quota=100000, period=100000) │ │
│  │  内存硬限制: 256MB | Swap 限制: 0MB                 │ │
│  │  PID 限制: 64 | 当前: 3                              │ │
│  │  FS 限制: 500MB | 当前: 15MB                        │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**实现方案**：
- 通过 `/proc/<pid>/stat`, `/proc/<pid>/status`, `/proc/<pid>/io`, `/proc/<pid>/fd` 采集进程级指标
- 通过 cgroup v2 接口 (`/sys/fs/cgroup/<sandbox>/`) 获取限制值和节流统计
- 后端新增 `core/services/sandbox_metrics.go`（cAdvisor 风格指标采集器）
- 监控 OOM Kill 事件：解析 `/proc/<pid>/oom_score`、`/proc/vmstat` 的 `oom_kill` 计数器，当检测到进程被 SIGKILL 且内存接近限制时，自动标注 OOM 事件

### 4.2 事件关联标注 (Event Correlation — Datadog 风格)

借鉴 **Datadog** 的 Event Overlay 功能和 Filter Bar 的 Field:Value Chip 交互：

```
资源趋势图 (Datadog 风格 Event Overlay + Filter Bar):

┌──────────────────────────────────────────────────────────┐
│  Filter Bar: [× 进程事件] [× 内存事件] [× 锁事件] [+]  │
│              └─ active chips, 可点击移除                  │
│                                                          │
│  CPU:  ▂▂▃▄▅▇█████▇▆▄▃▂▂▁                              │
│        ⬆        ⬆        ⬆                               │
│      fork()   read()   compute()  ← Event Overlay 标注   │
│      来源: 进程  来源: I/O  来源: 进程                    │
│                                                          │
│  内存: ▂▂▃▃▃▄▄▅▅▅▅▅▅▅▄▄▄▃▃                            │
│        ⬆              ⬆                                   │
│      malloc(10MB)   free(10MB)   ← 标注分配/释放事件     │
│      来源: 内存      来源: 内存                            │
│                                                          │
│  上下文切换: ▂▁▃▂▂▂▁▁▄▅▆█▇▅▃                           │
│               ⬆        ⬆                                  │
│          线程创建   锁竞争开始    ← 标注并发事件           │
│          来源: 进程  来源: 锁                              │
│                                                          │
│  ━━━━ 点击标注 → 跳转到 Trace 时间轴的对应时刻 ━━━━     │
│  ━━━━ 悬停标注 → 弹出事件详情 (来源/类型/相关进程) ━━━━  │
└──────────────────────────────────────────────────────────┘
```

**实现要点**：
- 事件标注以 Datadog Event Overlay 风格在时间轴上绘制竖线标记
- Filter Bar 使用 Field:Value 格式的 Chip 组件（如 `source:memory`, `type:allocation`），支持多选和快捷移除
- 每个事件标注携带元数据：来源（进程/内存/IO/锁）、严重程度、关联线程 ID
- 点击标注触发跨模块导航：跳转到 Trace 时间线对应时刻

### 4.3 复合风险指标 (Grafana 风格 Composite Risk Indicators)

借鉴 **Grafana** 的 USE 方法论和四金信号理念，在传统 CPU/Memory 仪表盘之上新增复合风险指标层：

```
┌──────────────────────────────────────────────────────────┐
│  📊 复合风险仪表盘 (Grafana 风格 Composite Indicators)    │
│                                                          │
│  ┌────────────┬──────────────┬──────────────┐           │
│  │ 健康评分   │ 饱和度指数   │ 依赖风险     │           │
│  │   92/100   │  0.48 (中)   │  0.12 (低)   │           │
│  │   🟢       │  🟡          │  🟢          │           │
│  └────────────┴──────────────┴──────────────┘           │
│                                                          │
│  Saturation Index (饱和度指数 — 加权复合):                │
│  ┌──────────────────────────────────────────────────┐   │
│  │ SatIndex = 0.40×(CPU 58%) + 0.35×(Mem 45%)      │   │
│  │          + 0.25×(ConnWait 15%) = 0.48            │   │
│  │                                                   │   │
│  │ CPU   [████████████░░░░░░░░░░] 58% 权重 0.40     │   │
│  │ 内存  [█████████░░░░░░░░░░░░░] 45% 权重 0.35     │   │
│  │ 连接等待 [███░░░░░░░░░░░░░░░] 15% 权重 0.25     │   │
│  │                                                   │   │
│  │ 💡 三个资源同时趋近饱和 → 复合风险急剧上升         │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  Dependency Risk Score (依赖风险评分):                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │ DepRisk = (syscall_error_rate × 0.5)             │   │
│  │         + (I/O_latency_spike × 0.3)              │   │
│  │         + (signal_delivery_delay × 0.2)           │   │
│  │ = 0.12 → 🟢 依赖健康                              │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  Backlog Growth Rate (积压增长率):                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │ deiv(queue_depth[10s]) = +2.1 items/s            │   │
│  │ 当前队列深度: 18 → 20 → 22 → 24 (线性增长中)     │   │
│  │ ⚠️ 积压增长速率 > 0 且 队列深度 > 10 → 🟡 注意    │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

**实现要点**：
- 健康评分公式：`HealthScore = 100 - (SatIndex × 40 + DepRiskScore × 30 + BacklogGrowth × 30)`
- 当 HealthScore < 70 时触发 Warning，< 50 时触发 Critical
- 复合指标计算在后端完成（`core/services/risk_indicator.go`），前端仅负责渲染

### 4.4 资源对比 (Resource Diff)

```
┌──────────────────────────────────────────────────────────┐
│  资源消耗对比: 提交 #7 vs 提交 #1 (参考)                 │
│                                                          │
│  CPU:     58% → 35%  📉 -23% ✅ 性能改善!               │
│  内存峰值: 45MB → 12MB 📉 -73% ✅ 大幅优化!              │
│  上下文切换: 120/s → 45/s 📉 -62% ✅ 调度压力减轻        │
│  磁盘I/O:  2.3MB → 0.5MB 📉 -78% ✅ I/O 大幅减少        │
│  Page Fault (min): 1245 → 342 📉 -72% ✅ 内存访问更高效  │
│  Page Fault (maj): 3 → 0 📉 -100% ✅ 无主缺页            │
│  CFS Throttled: 0ms → 0ms ✅ 无 CPU 节流                 │
│  OOM Events: 0 → 0 ✅ 无 OOM Kill                        │
│                                                          │
│  整体评分: 资源效率提升 67% 🌟🌟🌟🌟🌟                    │
│                                                          │
│  ⚠️ 注意: FD 使用从 5→12 (增加了 7 个文件描述符)        │
│     但程序结束时全部正确关闭                               │
└──────────────────────────────────────────────────────────┘
```

### 4.5 资源异常检测与教学告警 (Netdata ML + 规则引擎)

借鉴 **Netdata** 的 ML 异常检测理念，结合确定性规则引擎：

```
实时告警规则 (教学导向, 规则引擎 + Netdata 风格异常概率):

规则 1: 内存持续增长 (Heaptrack 风格趋势检测)
  条件: 堆大小连续 3 秒增长且无释放
  异常概率: 89% (基于: 分配斜率持续 > 释放斜率 × 10)
  触发: 🟡 警告 — "堆内存持续增长 (89% 概率泄漏)，检查是否忘记 free()"

规则 2: CPU 异常高
  条件: CPU > 90% 持续 2 秒
  异常概率: 95% (基于: CPU 模式偏离正常实验基线)
  触发: 🟡 警告 — "CPU 使用率异常高 (95% 置信度)，可能是死循环或密集计算"

规则 3: FD 泄漏 (cAdvisor 风格)
  条件: 文件描述符数量持续增长不下降
  触发: 🔴 严重 — "文件描述符持续增长 (5→8→12→...)，检查是否忘记 close()!"

规则 4: 接近资源限制 (cAdvisor cgroup 风格)
  条件: Working Set > 80% memory.max (cgroup 限制)
  OOM 风险率: 82%
  触发: 🟡 警告 — "内存使用 205MB/256MB (80%)，接近 cgroup 限制，程序可能即将被 OOM Kill"

规则 5: CFS 节流 (cAdvisor 风格)
  条件: cpu_cfs_throttled_seconds > 0
  触发: 🟡 警告 — "CPU 配额耗尽，程序被 CFS 调度器节流!"
  💡 教学提示: 这意味着程序的 CPU 使用超过了 cgroup 配额，性能被人为降低。

规则 6: 异常退出 (cAdvisor OOM + 信号检测)
  条件: 进程被 SIGKILL/SIGSEGV 终止
  OOM Kill 检测: 检查 container_oom_events_total 是否增加
  触发: 🔴 严重 — 显示终止原因 + OOM 判定 + 关联被杀前的内存增长曲线
  💡 教学提示: 如果是 OOM Kill，说明程序内存使用超过了 cgroup 的 memory.max 限制。

规则 7: Netdata 风格异常概率
  条件: 多指标基线偏离 (CPU + 内存 + I/O 模式同时偏离正常实验的基线)
  异常概率: 基于历史实验数据构建的 k-means 模式库
  触发: 🟠 综合异常 — "多指标模式偏离 (置信度 XX%)，建议检查程序逻辑"
```

---

## 五、数据可视化升级

### 5.1 Grafana 风格仪表盘重构 (含复合风险 + 事件标注)

参考 **Grafana Dashboard 最佳实践**和 **Datadog Event Overlay**，重新设计资源监控面板布局：

```
┌─────────────────────────────────────────────────────────┐
│  📊 资源全景仪表盘 (Grafana 风格: 大数字 → 趋势 → 详情) │
│                                                         │
│  Row 1 — 关键风险摘要 (Big Numbers / Stat Panels)       │
│  ┌──────────┬──────────┬──────────┬──────────┐         │
│  │ 健康评分 │ 饱和度   │ 依赖风险 │ 积压增长 │         │
│  │   92 🟢  │  0.48 🟡 │  0.12 🟢 │ +2.1/s  │         │
│  └──────────┴──────────┴──────────┴──────────┘         │
│                                                         │
│  Row 2 — 资源饱和度趋势 (Time Series + Event Overlay)   │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Filter: [× malloc] [× fork] [× lock] [× signal]  │  │
│  │                                                  │  │
│  │  CPU ▂▃▅▇▆▄▂▁▂▃▅▇▆▄▂▁  │ ◆fork ◆compute        │  │
│  │  MEM ▂▂▃▃▄▄▅▅▅▅▄▄▃▃▂▂  │ ◆malloc ◆free         │  │
│  │  I/O ▁▁▁▂▃▃▃▃▂▂▁▁▁▁▁▁  │                        │  │
│  │                                                  │  │
│  │  时间: 0s ──── 2s ──── 4s ──── 6s             │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  Row 3 — 细粒度指标面板 (cAdvisor 风格 Stat Cards)      │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────┐  │
│  │ 线程数  │ FD 数   │ PageFlt │ CtxSw   │ OOM     │  │
│  │   3 🧵   │  5/1024 │ 1245   │ 45/s   │ 0 🔴    │  │
│  │          │        │ min:1242│ vol:13 │ safe    │  │
│  │          │        │ maj:3   │ invol:32│        │  │
│  └─────────┴─────────┴─────────┴─────────┴─────────┘  │
│                                                         │
│  Row 4 — cgroup 限制仪表盘                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ CPU 限制: [████████████░░░░░░░░░░] 58%/100%      │  │
│  │ Mem 限制: [█████████░░░░░░░░░░░░░] 42MB/256MB    │  │
│  │ FS  限制: [██░░░░░░░░░░░░░░░░░░░] 15MB/500MB     │  │
│  │ PID 限制: [░░░░░░░░░░░░░░░░░░░░░] 3/64           │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  Row 5 — 告警面板 (Alerts)                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ⚠️ 告警                                  [展开]   │  │
│  │ 🟡 T+4.2s: 内存增长至峰值 45MB (OOM 风险率 17%)    │  │
│  │ 🟠 T+5.0s: Netdata ML 检测到多指标模式偏离 (82%)  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 5.2 三时间维度视图

```
[实时] [本次运行] [历史对比] [班级统计]

实时 (1s 刷新):
  → 当前瞬时值 + sparkline 趋势 + 异常概率指示器

本次运行 (完整):
  → 从程序启动到退出的完整资源曲线

历史对比:
  → 选择多次提交，并排对比资源曲线

班级统计 (教师视图):
  → 全班学生的资源效率排行榜
  → 常见资源问题分布
```

---

## 六、技术实现方案

### 6.1 后端新增/修改

| 文件 | 功能 |
|------|------|
| `core/services/leak_detector.go` | 内存泄漏自动检测（Valgrind 四分类: Def/Indirect/Possible/Reachable） |
| `core/services/alloc_tracker.go` | 内存分配追踪 + 调用栈记录（Heaptrack 风格, .zst 导出） |
| `core/services/sandbox_metrics.go` | 沙箱内进程资源采集（cAdvisor 风格: CPU/Mem/IO/Net + cgroup 限制 + OOM） |
| `core/services/memory_trend_analyzer.go` | 内存趋势分析（Massif 风格堆趋势 + ms_print 归档导出） |
| `core/services/resource_alert.go` | 资源异常检测规则引擎（规则 + Netdata 风格异常概率） |
| `core/services/risk_indicator.go` | 复合风险指标计算（Grafana 风格: Saturation Index / DepRisk / BacklogGrowth） |
| `core/services/event_correlator.go` | 事件关联标注引擎（Datadog 风格: Event Overlay + Filter Bar） |
| `core/ebpf/loader.go` | 新增 uprobe on malloc/free 探针 |
| `core/handler/memory.go` | 新增 API: leak-report, alloc-flamegraph, memory-trend, ms_print-export, heaptrack-export |

### 6.2 前端新增/修改

| 文件 | 功能 |
|------|------|
| `panels/LeakDetectionPanel.tsx` | 内存泄漏检测报告面板（Valgrind 四分类 + Heaptrack 趋势） |
| `panels/AllocFlameGraph.tsx` | 内存分配火焰图（Heaptrack 风格: Peak Heap + Temporary + Top Allocators） |
| `panels/MemoryTrendDashboard.tsx` | 内存趋势仪表盘（Massif 风格堆趋势图 + ms_print 导出） |
| `panels/MemorySnapshotDiff.tsx` | 快照对比视图 |
| `panels/SandboxResourceMonitor.tsx` | 沙箱进程资源监控（cAdvisor 风格 90+ 指标: FD/PageFault/OOM/cgroup） |
| `panels/ResourceAlertPanel.tsx` | 资源异常告警面板（规则 + Netdata ML 异常概率） |
| `panels/CompositeRiskDashboard.tsx` | 复合风险仪表盘（Saturation Index + DepRisk + BacklogGrowth + HealthScore） |
| `panels/EventOverlayBar.tsx` | Datadog 风格事件标注 Filter Bar (Field:Value Chip 组件) |
| `panels/MemoryLayout3D.tsx` | 大幅升级：交互增强 + 泄漏高亮 + Heaptrack 分配源标注 |
| `panels/ResourceMonitorCard.tsx` | Grafana 风格重构（大数字摘要 → 趋势 → 详情分层） |
| `stores/workspace.ts` | 新增 sandboxMetrics, alertEvents, riskIndicators, eventAnnotations 状态 |

---

## 七、实施优先级

### 🔴 P0 — 核心安全与教学能力

| 任务 | 工时 | 价值 |
|------|------|------|
| 内存泄漏自动检测（Valgrind 四分类 + Heaptrack 风格趋势） | 3天 | 从被动看 → 主动发现 |
| 沙箱进程资源监控（cAdvisor 风格: 细粒度 + cgroup 限制 + OOM） | 3天 | 精准定位学生程序 |
| 事件关联标注（Datadog 风格 Event Overlay + Filter Bar） | 2天 | 理解资源变化的"为什么" |
| 复合风险指标 + 健康评分（Grafana 风格 Saturation Index 等） | 1天 | 超越单一阈值, 复合判断 |
| 资源异常告警（规则 + Netdata 风格异常概率） | 1天 | 即时反馈 |

### 🟡 P1 — 深度分析

| 任务 | 工时 | 价值 |
|------|------|------|
| 分配调用栈回溯（Heaptrack 风格 + .zst 导出） | 3天 | 精确定位分配代码 |
| 内存趋势仪表盘（Massif 风格 + ms_print 导出） | 2天 | 宏观趋势 view |
| 源码级内存标注 | 2天 | 代码+数据联动 |
| 资源对比 | 1天 | 对比优化效果 |

### 🟢 P2 — 视觉增强

| 任务 | 工时 | 价值 |
|------|------|------|
| Grafana 风格仪表盘重构（大数字 → 趋势 → 详情） | 2天 | 专业级体验 |
| 3D 交互增强（Heaptrack 分配源标注联动） | 2天 | 沉浸式探索 |
| 内存热力图 | 1天 | 直观理解访问模式 |
| 虚拟地址全景 | 1天 | 更真实的地址空间 |
| 分层分析管道（Tier 1-4: Heaptrack → Memcheck → Massif → ASan/LSan） | 1天 | 完整的工具链教学 |

---

*文档版本 v2.0 | 最后更新 2026-08-06*
*关联文档: master-observability-upgrade-plan.md*
*参考来源: Heaptrack + Valgrind Massif 分层内存分析策略 · Grafana 复合风险指标 · Datadog 事件关联标注 · cAdvisor 容器资源监控 · Netdata ML 异常检测*
