# TraceOS eBPF 追踪与火焰图深度升级方案

> **对标产品**：Pixie (New Relic) · Brendan Gregg FlameGraph · Pyroscope (Grafana) · Cilium Hubble
> **核心目标**：从「基础 syscall 统计 + SVG 火焰图」升级为「全栈内核观测 + 多维火焰分析 + 持续 profiling」，让 syscall 序列能"讲故事"，让火焰图能"对话"。

---

## 行业最佳实践参考

本方案在设计阶段系统梳理了以下行业标准实践，将其适配到 TraceOS 教育场景中。

### 1. Pixie (New Relic) eBPF 零侵入自动遥测

| 最佳实践 | 来源 | 借鉴方式 |
|---------|------|---------|
| **混合模型**：eBPF 提供基准可见性 (80% 覆盖，零代码)，结合 APM/OTel 做深度业务追踪 | New Relic eBPF Agent Best Practices Guide (2025) | TraceOS 以 eBPF 探针自动捕获 syscall/锁/内存为基线，AI 诊断层补充语义深度 |
| **Service Map 自动发现**：从 eBPF 捕获的 HTTP/gRPC 链路自动生成服务拓扑，无需任何代码侵入 | Pixie Docs — Service Map | TraceOS Process Map：从 syscall trace 自动发现进程/线程拓扑与 IPC 通信关系 |
| **Low Data Mode**：采样间隔 15s，HTTP span 上限 750 (vs 默认 10s / 1500) | New Relic Pixie Helm Chart — lowDataMode | TraceOS 分级采样策略：轻量模式用于低负载沙箱，密集模式用于并发死锁实验 |
| **PxL 脚本语言**：灵活查询 eBPF 数据，无需重新部署探针 | Pixie PxL Reference | TraceOS ObsQL：教学场景的简化查询语言，学生可探索自己程序的行为模式 |
| **PEM 内存调优**：`--pem_memory_limit` 控制 eBPF 采集模块内存上限，CPU 开销 <2% | New Relic — Manage Pixie Memory | TraceOS 沙箱资源感知：根据沙箱内存自动调节 eBPF ringbuf 大小，确保采集不影响被观测程序 |
| **TLS 库兼容性**：需验证 OpenSSL / Go crypto/tls / BoringSSL 兼容性 | New Relic eBPF Agent Best Practices | TraceOS 探针兼容矩阵：测试 libc、musl、静态链接三种目标场景 |

### 2. Brendan Gregg 差分火焰图方法论

| 最佳实践 | 来源 | 借鉴方式 |
|---------|------|---------|
| **双视图必生成**：diff2.svg (after 为底) 与 diff1/negated.svg (before 为底) 同时产出，解决"消失代码"问题 | Brendan Gregg — Differential Flame Graphs | TraceOS 智能对比：提交 A→B 和 B→A 两个方向的差分火焰图同时展示 |
| **`-n` 归一化**：不同时间/负载采集的 profile，用 `difffolded.pl -n` 归一化后再差分 | Brendan Gregg FlameGraph Tools | TraceOS diff 引擎：自动检测两次 profile 总采样数差异，>10% 时自动启用归一化 |
| **`-x` 剥离地址**：未符号化的十六进制地址会在差分中产生虚假差异 | difffolded.pl -x | TraceOS 预处理管线：perf script 输出自动过滤未知地址，仅保留已解析符号 |
| **三视图方案** (Cor-Paul Bezemer)：before + after + differential 同时展示 | Bezemer et al. — Differential Flame Graph Studies | TraceOS 对比面板采用三列布局：基线 | 当前 | 差分 |
| **标准化采样管线**：`perf record -F 99 -j random` — 99Hz 采样 + jitter 防混叠 | Brendan Gregg — perf Examples | TraceOS perf 配置标准化：统一 99Hz + random jitter，消除周期锁步 |
| **采样偏差缓解**：采集数千样本，运行 N≥3 次基线 | Brendan Gregg — Performance Methodology | TraceOS 基线策略：对每一实验的参考实现采集 3 次基线，取中位数 |
| **用户+内核双栈**：`-g -k` 同时捕获用户态和内核态调用栈 | perf record -g | 已实现 user/kernel 切换；增强为差分也保留双栈 |
| **互补工具配对**：火焰图 + off-CPU 火焰图 + 内存火焰图 + async-profiler (JVM) | Brendan Gregg — Flame Graphs Complete | TraceOS 四种火焰图 (CPU/Mem/IO/Lock) 互补，覆盖全链路瓶颈 |
| **应用层指标验证**：不只关注 CPU 降低，需用 p95/p99 延迟、吞吐量交叉验证 | Brendan Gregg — Performance Validation | TraceOS 火焰图面板底部增加"应用性能仪表盘"小条：延迟/吞吐/错误率 |
| **CI/CD 非回归自动化**：差分火焰图集成到 CI pipeline，自动标记性能回归 | Brendan Gregg — Flame Graph Automation | TraceOS 可选：提交自动触发 profiling + 差分火焰图生成 + AI 自动解读 |

### 3. Pyroscope (Grafana) 持续 Profiling

| 最佳实践 | 来源 | 借鉴方式 |
|---------|------|---------|
| **持续 profiling 已是标配**（非单次手动触发） | Grafana Pyroscope Docs (2025) | TraceOS 持续 profiling 模式：沙箱运行期间全程采集，时间轴拖动即可回放任意时刻火焰图 |
| **标签化元数据**：service name、version、commit SHA 贯穿所有 profile | Pyroscope Labeling Best Practices | TraceOS profile 自动标记：submission_id、experiment_id、student_id、commit_hash |
| **自适应采样**：SLO 违规时自动提升采样频率，基线期保持低频率 | Pyroscope Adaptive Sampling (2025) | TraceOS 可配置：死锁检测触发 → 锁采样频率自动提升 10x；无异常时降为 10Hz 基线 |
| **Push+Pull 混合模式**：短生命周期用 push，长生命周期用 pull (Alloy) | Pyroscope Deployment Guide | TraceOS 沙箱 profiling 采用 push 模式：perf/bpftrace → ringbuf → Go collector |
| **分级保留策略**：短期高分辨率 → 中期聚合 → 长期统计基线 | Pyroscope Storage Design | TraceOS 实验内保留全量 profile，跨实验仅保留差分摘要 |
| **生产安全**：默认只开 CPU + alloc，mutex/block 按需开启 (开销可控) | Pyroscope Production Best Practices | TraceOS 默认开 CPU + I/O 探针；内存/锁探针根据实验类型按需启用 |

---

## 一、eBPF 追踪模块现状与升级目标

### 1.1 现状分析

**当前能力 (已经不错的部分)**：
- 7 Tab 架构 (概览/时间线/内存/锁分析/实时推送/AI解读/对比) — 布局清晰
- SSE 实时事件流 — 实时性业界领先
- bpftrace 3 路探针 (syscall + futex 死锁 + mem 分配) — 探针覆盖面广
- 锁等待力导向图 — 直观的并发可视化
- ECharts 集成 — 图表丰富度不错

**关键缺失 (对标 2025/2026 状态)**：

| 缺失项 | 严重度 | 2025/2026 行业对标 | 差距说明 |
|--------|--------|-------------------|---------|
| 无调用链上下文 — 孤立 syscall 列表，看不出因果关系 | 🔴 致命 | Pixie 完整 call chain + 协议自动解析 | Pixie 已支持 HTTP/MySQL/Redis/CQL/DNS 协议解析，TraceOS 停留在原始 syscall name |
| 无协议/语义识别 — 不会自动标注 "这是 fork+exec 创建子进程" | 🔴 致命 | Pixie 自动识别 7+ 应用层协议 | Pixie 协议解析器通过 eBPF 捕获 L7 负载做自动分类 |
| 无 Process Map — 看不到进程/线程拓扑关系 | 🟡 重要 | Hubble Service Map + Pixie Auto-Telemetry Service Map | 两者均无需代码修改，纯 eBPF 自动发现拓扑 |
| 无 syscall 参数语义化 — 只显示名称和返回值，不解释含义 | 🟡 重要 | strace -v 级别 + Pixie PxL 脚本可自定义解码 | 参数语义化是调试体验的基线要求 |
| 对比功能很弱 — 只能按 submission ID 输入，无智能推荐 | 🟡 重要 | Pixie diff 查询 + Brendan Gregg 差分火焰图 | 差分对比已成性能调试标准工具 |
| 锁分析无时序 — 只看当前锁图，看不到锁获取的历史时序 | 🟡 重要 | 数据库死锁检测标准能力 (PostgreSQL deadlock_timeout) | 时序信息是死锁根因分析的必需输入 |
| 无持续 profiling — 只能手动触发单次采样 | 🟡 重要 | Pyroscope 持续 profiling (Grafana 2023 收购后整合进 LGTM 栈) | 持续 profiling 已是和 metrics/logs/traces 并列的第四信号 |
| 事件日志不可搜索/过滤 — 500 条滚动日志 | 🟢 增强 | Grafana Loki 全文检索 + LogQL | 可搜索性是日志体验基线 |
| 无热点趋势分析 — 看不到哪些 syscall 增长最快 | 🟢 增强 | Datadog 异常检测 (anomalies() 函数 + 周季节性) | 趋势检测是减少噪音的关键手段 |

### 1.2 升级愿景

```
当前:  syscall 列表 + 简单统计 + 锁图
          ↓
目标:  进程拓扑图 + 语义化事件流 + 因果链分析 + 智能对比 (Brendan Gregg 双视图) + 持续 profiling (Pyroscope 模式) + 趋势预警
```

---

## 二、eBPF 追踪模块升级方案

### 2.1 新增 Tab: Process Map (进程拓扑图)

借鉴 **Pixie Service Map** (纯 eBPF 自动发现，零代码) 和 **Cilium Hubble** (内核级服务依赖图) 的设计理念，自动绘制程序的进程/线程拓扑图：

```
┌─────────────────────────────────────────────────────────────────┐
│  Process Map — 进程拓扑图 (eBPF 自动发现)                       │
│                                                                 │
│         ┌─────────┐    pipe    ┌─────────┐                     │
│         │ 父进程   │◄─────────►│ 子进程1  │                     │
│         │ PID=100  │           │ PID=101  │                     │
│         └────┬─────┘           └────┬─────┘                     │
│              │ fork+exec             │                           │
│              ▼                       ▼                           │
│         ┌─────────┐            ┌─────────┐                     │
│         │ 子进程2  │            │ 线程1    │                     │
│         │ PID=102  │            │ TID=103  │                     │
│         └─────────┘            └────┬─────┘                     │
│                                     │ futex wait                │
│                                     ▼                           │
│                                ┌─────────┐                     │
│                                │ 线程2    │                     │
│                                │ TID=104  │                     │
│                                └─────────┘                     │
│                                                                 │
│  图例: □ 进程  ○ 线程  ── pipe  ══ mutex  ···· signal         │
│                                                                 │
│  点击任意节点 → 右侧展开该进程/线程的详细 syscall 序列           │
│  节点大小 = syscall 调用频率，边粗细 = IPC 通信频率              │
│                                                                 │
│  💡 设计理念: Pixie "无需代码修改的自动拓扑发现" + TraceOS 教学标注 │
└─────────────────────────────────────────────────────────────────┘
```

**实现方案**：
- 后端新增 `core/services/process_graph.go`，从 syscall trace 中解析 fork/clone/pipe/signal 关系
- 前端新增 `ProcessMapView.tsx`，使用 ECharts 关系图或 Cytoscape.js
- 节点大小 = syscall 调用频率，边粗细 = 通信频率
- 实现参考：Pixie 通过 eBPF `syscall_tracepoints` 捕获 `clone`/`execve` 事件构建拓扑

### 2.2 语义化事件流 (Semantic Event Stream)

遵循 **Pixie 协议自动解析**理念——Pixie 通过 eBPF 探针捕获 HTTP/MySQL/Redis 等 L7 协议数据并自动分类。TraceOS 将此理念下移至 OS 层：不再显示原始 syscall 序列，而是翻译为教学语言的"程序故事"：

```
原始:  syscall: clone @ T+0ms → syscall: execve @ T+2ms → syscall: wait4 @ T+500ms
                ↓ 语义化引擎翻译 ↓
语义:  🟢 创建子进程 → 🟢 子进程加载新程序 → 🟡 父进程等待子进程结束

原始:  syscall: mmap(flags=MAP_ANONYMOUS) → syscall: brk(+4096) → syscall: brk(+4096)
                ↓
语义:  💾 匿名内存映射 → 📈 堆增长 4KB → 📈 堆再增长 4KB (可能是动态数组扩容)

原始:  syscall: futex(FUTEX_WAIT) @ TID=101 → syscall: futex(FUTEX_WAIT) @ TID=102
                ↓
语义:  🔴 线程1 等待锁 → 🔴 线程2 也等待同一把锁 → ⚠️ 潜在死锁！(Coffman 条件: 循环等待)
```

**实现方案**：
- 新增 `core/services/semantic_engine.go`，定义 OS 语义模式库
- 模式匹配规则表 (可扩展)：

```go
var SemanticPatterns = []SemanticPattern{
    {
        Name:     "fork_exec_workflow",
        Sequence: []string{"clone", "execve"},
        Label:    "进程创建与程序加载",
        Category: "process",
        TeachingNote: "这正是 fork()+exec() 的经典模式：fork 复制进程，exec 替换程序映像",
    },
    {
        Name:     "pipe_ipc",
        Sequence: []string{"pipe2", "clone"},
        Context:  "父子进程通过管道通信",
        Category: "ipc",
    },
    {
        Name:     "deadlock_pattern",
        Sequence: []string{"futex(FUTEX_WAIT)", "futex(FUTEX_WAIT)"},
        Condition: "不同线程等待对方持有的锁",
        Severity:  "critical",
        TeachingNote: "两个线程互相等待对方释放锁——这是经典的死锁场景。检查 Coffman 四个条件是否同时满足。",
    },
    // ... 更多模式
}
```

### 2.3 因果链分析 (Causal Chain)

不只是列出 syscall，而是展示因果关系链。设计参考 **Datadog 根因推断引擎**——从症状向上追溯根因，而非从根因向下枚举后果。

```
┌──────────────────────────────────────────────────────────────────┐
│  因果链分析 — 从根因到症状 (自下而上追溯)                         │
│                                                                  │
│  🔴 根因: close(3) 过早关闭了文件描述符                           │
│      │                                                           │
│      ▼                                                           │
│  🟡 影响: read(3) 返回 EBADF (Bad file descriptor)               │
│      │                                                           │
│      ▼                                                           │
│  🟡 后果: 后续 write(4) 的数据不完整                              │
│      │                                                           │
│      ▼                                                           │
│  🔴 最终: 程序输出与预期不符，测试失败                             │
│                                                                  │
│  ────────────────────────────────────────────                    │
│  💡 教学提示: 文件描述符是宝贵的资源，                            │
│     关闭后无法恢复。检查 close() 的位置是否太早。                 │
└──────────────────────────────────────────────────────────────────┘
```

**实现方案**：
- 基于 `core/evaluator/pattern_analyzer.go` 扩展，新增因果链推导
- 利用 syscall 的 fd 参数追踪资源生命周期
- 关联源码行号，直接定位问题代码

### 2.4 智能对比 (Smart Diff) — 对齐 Brendan Gregg 双视图标准

替代当前手动输入 Submission ID 的简陋对比。严格遵循 Brendan Gregg 差分火焰图最佳实践：**双视图必生成、归一化处理、三列布局**。

```
┌──────────────────────────────────────────────────────────────────┐
│  智能对比 — 遵循 Brendan Gregg 差分方法论                         │
│                                                                  │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────┐ │
│  │ 你的提交 (#7, 45分)│  │ 参考实现 (#1, 95分)│  │ 差分       │ │
│  ├────────────────────┤  ├────────────────────┤  ├────────────┤ │
│  │ ✅ fork: 1次       │  │ ✅ fork: 1次       │  │ ─ 无差异   │ │
│  │ 🔴 wait: 0次 ←缺失!│  │ ✅ wait: 1次       │  │ 🔴 -100%   │ │
│  │ ✅ exec: 1次       │  │ ✅ exec: 1次       │  │ ─ 无差异   │ │
│  │ 🟡 pipe: 2次(多1次)│  │ ✅ pipe: 1次       │  │ 🟡 +100%   │ │
│  │ 🔴 close: 2次(少3次)│  │ ✅ close: 5次      │  │ 🔴 -60%    │ │
│  └────────────────────┘  └────────────────────┘  └────────────┘ │
│                                                                  │
│  📊 行为相似度: 62%  (Needleman-Wunsch 对齐)                     │
│  📊 归一化: 自动 (profile 总采样数差异 >10% → 已启用 -n 归一化)   │
│  🎯 差异聚焦: 缺少 wait() 导致僵尸进程                          │
│  💡 修复建议: 在 fork() 后添加 wait(NULL) 或 waitpid()           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  差分火焰图 (Brendan Gregg 双视图):                      │   │
│  │  [diff2: after 为底, 红色=新增CPU, 蓝色=减少CPU]          │   │
│  │  [diff1: before 为底, 蓝色=即将消失的CPU, --negate]       │   │
│  │  🐛 "消失代码"检测: diff2 无法显示消失的路径 →            │   │
│  │     diff1 (negated) 补充显示蓝色 = 即将减少的调用          │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

**实现方案**：
- 自动推荐对比目标：同实验的最高分提交 / 教师参考实现 / 自己上次提交
- 基于 `trace_diff.go` 的 Needleman-Wunsch 对齐算法，增加语义级 diff
- **关键对齐**：为每次对比自动生成 diff2 (after-based) + diff1/negated (before-based) 两个方向
- 采样数差异 >10% 时自动启用归一化 (`difffolded.pl -n` 等价逻辑)
- 前端新增 `SmartDiffView.tsx`，三列布局：Baseline | Current | Differential

### 2.5 锁时序分析 (Lock Timeline)

当前锁图只展示某一时刻的锁状态，缺乏时序。设计参考 **PostgreSQL deadlock_timeout** 和数据库死锁检测的标准时序分析。

```
锁时序 (横轴=时间):
TID=101: [══════lock(m)═══════]         [═══lock(m)⏳DEADLOCK═══]
TID=102:         [═══lock(m)⏳WAIT═══][═══lock(m)═══]
TID=103:                 [═══unlock(m)═══]
         ─────────────────────────────────────────────────────→ 时间

         ⬆ 时刻1: TID=101 持有 m      ⬆ 时刻2: 死锁形成

等待时间统计:
  TID=101 等待: 1250ms (超长!)   — 异常检测触发标记
  TID=102 等待: 800ms

💡 Coffman 死锁四条件验证:
  ☑ 互斥 (mutex)  ☑ 持有并等待  ☑ 不可剥夺  ☑ 循环等待 ⚠️
```

### 2.6 持续 Profiling 集成 (Pyroscope 模式)

参考 **Pyroscope (Grafana) 持续 profiling** 标准实践，将 profiling 从"手动触发单次快照"升级为"全运行周期持续采集"。

```
持续 Profiling 时间轴:
  0s ──── 5s ──── 10s ─── 15s ─── 20s

  火焰图随程序运行实时变化:
  ┌──────┐  ┌──────────┐  ┌─────────────┐
  │ init │  │ process  │  │ cleanup     │
  │  阶段│  │   阶段   │  │   阶段      │
  └──────┘  └──────────┘  └─────────────┘

  拖动时间轴，火焰图自动切换到对应时刻的 CPU 分布

  自适应采样 (借鉴 Pyroscope adaptive sampling):
  - 正常阶段: 10Hz 基线采样 (低开销, <1% CPU)
  - 死锁检测触发: 自动提升至 99Hz (高分辨率诊断)
  - SLO 违规 (如多余 N 次失败的 syscall): 提升 I/O 采样频率
```

**实现方案**：
- 后端新增 `core/services/continuous_profiler.go`
- 采集期间自动打标签：`submission_id`、`experiment_id`、`commit_hash` (对齐 Pyroscope labeling)
- Push 模式：perf/bpftrace → ringbuf → Go collector

### 2.7 Tab 架构升级

```
当前 7 Tab:
  概览 | 时间线 | 内存 | 锁分析 | 实时推送 | AI解读 | 对比

升级后 10 Tab (可折叠为 2 行):
  概览 | 进程拓扑 | 语义事件 | 时间线 | 因果链 |
  内存 | 锁分析 | 持续Profile | AI解读 | 智能对比
```

---

## 三、火焰图模块现状与升级目标

### 3.1 现状分析

**当前能力**：
- SVG 火焰图交互渲染 — 基础体验好
- 用户态/内核态切换 — 分类清晰
- AI 白話解读 — 降低理解门槛
- 热点函数 Top 5 — 快速定位
- CPU 时间分布进度条 — 直观

**关键缺失 (对标 2025/2026 状态)**：

| 缺失项 | 严重度 | 对标差距 | 行业标准 |
|--------|--------|---------|---------|
| 无差分火焰图 — 无法对比两次提交的性能变化 | 🔴 致命 | Brendan Gregg standard: diff1+diff2 双视图 + `-n` 归一化 + `-x` 剥离地址 | 差分火焰图已集成进 CI/CD 非回归测试 |
| 无内存分配火焰图 — 只能看 CPU，不能看内存 | 🔴 致命 | Pyroscope alloc_profile + Massif Visualizer | Heaptrack/py-spy 均支持，属标配能力 |
| 无 I/O 火焰图 — 看不到 I/O 瓶颈 | 🟡 重要 | bpftrace + Brendan Gregg off-CPU 火焰图 | off-CPU 分析是完整性能画像的必要组成 |
| 无持续 profiling — 只能手动触发单次采样 | 🟡 重要 | Pyroscope/Grafana 持续 profiling (第四信号) | 2023 年 Pyroscope 并入 Grafana LGTM 栈后成为标准 |
| 无热点函数源码关联 — 点击热点不能跳转源码 | 🟡 重要 | IDE profiler 标配 (GoLand pprof 集成, VS Code Java profiler) | 源码关联是理解热点的最短路径 |
| 无火焰图搜索/过滤 — 大海捞针 | 🟢 增强 | Brendan Gregg 原版 support (flamegraph.pl search) | 基本交互能力 |
| 仅支持 perf CPU — 数据源单一 | 🟢 增强 | Pyroscope 多数据类型: CPU/alloc/mutex/block/goroutine | 多维度分析是趋势 |
| 无函数调用链树状视图 — 没有文本替代 | 🟢 增强 | pprof `-tree` 视图 / speedscope 左侧重树 | 辅助定位需要 |
| 采样管线未标准化 — 无可重复的采集协议 | 🟡 重要 | Brendan Gregg: `perf record -F 99 -j random -g` | 标准化是自动化前提 |

### 3.2 升级愿景

```
当前:  SVG 火焰图 + 基础 AI 解读
          ↓
目标:  4 种火焰图 (CPU/Mem/IO/Lock) + 差分对比 (Brendan Gregg 双视图) + 源码关联 + 持续 profiling (Pyroscope 模式)
```

---

## 四、火焰图模块升级方案

### 4.1 新增：差分火焰图 (Differential Flame Graph) — 严格对齐 Brendan Gregg 标准

Brendan Gregg 经典特性，对比两次运行的性能差异。实施方案严格遵循其方法论：

**核心规则**：
1. **双视图必生成**：diff2.svg (after 为底, 红色=增加, 蓝色=减少) + diff1/negated.svg (before 为底, 蓝色=即将消失)，解决"消失代码"问题
2. **归一化**：两次 profile 总采样数差异 >10% 时自动归一化 (等价于 `difffolded.pl -n`)
3. **地址剥离**：perf script 输出自动过滤未解析的十六进制地址 (等价于 `-x`)
4. **三视图布局** (Cor-Paul Bezemer)：Baseline | Current | Differential 三列并排
5. **标准化管线**：`perf record -F 99 -j random -g` (99Hz, jitter 防混叠, 双栈)
6. **N≥3 基线**：每个实验的参考实现采集 3 次 profile，取中位数作为基线

```
┌─────────────────────────────────────────────────────────────────┐
│  差分火焰图: 提交 #7 vs 提交 #1 (参考)                          │
│  采样管线: perf record -F 99 -j random -g  |  归一化: 自动 (采样差异 15% > 10%)  │
│                                                                 │
│  diff2.svg (after 为底 — "已发生的变化"):                       │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← 蓝色 = 减少         │
│  main()                                                        │
│  ░░░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  ← 红色 = 增加         │
│  worker()     loop_process()                                   │
│               ░░░░░░░░░░░░░░░░░░                                │
│               nested_loop() ← 🚩 这里性能变差了!                │
│                                                                 │
│  diff1.svg (before 为底, --negate — "即将发生的变化"):           │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ worker() ← 此处 CPU 将被显著减少          │
│  ░░░░░░░░░░░░ init() ← 此路径在提交 #7 中已消失                  │
│                                                                 │
│  性能变化摘要:                                                  │
│  📈 loop_process(): +35% CPU (从 10% → 45%)                     │
│  📈 nested_loop(): +22% CPU (新增热点)                          │
│  📉 worker(): -15% CPU (优化有效)                               │
│  🔵 init(): 已消失 (仅 diff1 可见 — vanishing code)             │
│                                                                 │
│  📊 应用层验证 (对齐 Brendan Gregg 实践):                        │
│  p50 延迟: 12ms → 28ms (+133%)    p99 延迟: 45ms → 180ms (+300%)│
│  吞吐量: 850 req/s → 620 req/s (-27%)                           │
│  ⚠️ CPU 变化 + 延迟/吞吐量恶化 → 确认这是真正的性能退化          │
│                                                                 │
│  💡 教学提示: nested_loop() 是新增的热点，                       │
│     检查是否添加了不必要的嵌套循环。                              │
│     可通过 diff1 视图确认 init() 消失是否预期。                  │
└─────────────────────────────────────────────────────────────────┘
```

**实现方案**：
- 后端新增 `core/services/flamegraph_diff.go`
- 差分算法：红色 = 提交A比提交B多的 CPU，蓝色 = 相反的
- **自动双输出**：每次差分计算产出 diff2 和 diff1/negated 两个 SVG
- 前端在现有 SVG 渲染基础上，支持差分着色
- 火焰图面板底部增加"应用性能仪表盘"小条：p50/p95/p99 延迟、吞吐量 (对齐 Brendan Gregg 交叉验证要求)

### 4.2 新增：多维火焰图类型

| 火焰图类型 | 数据源 | 采集方式 (标准化管线) | 用途 | 对标 |
|-----------|--------|---------------------|------|------|
| **CPU 火焰图** (已有) | `perf record -F 99 -j random -g` | perf_event_open | CPU 热点分析 | Brendan Gregg |
| **内存分配火焰图** (新增) | `uprobe:malloc/calloc/realloc` + `ustack` | eBPF uprobe | 内存分配热点 | Massif/Heaptrack/Pyroscope alloc_profile |
| **I/O 火焰图** (新增) | `tracepoint:syscalls:sys_enter_read/write` | bpftrace | I/O 瓶颈 + off-CPU 等待 | Brendan Gregg off-CPU flame graph |
| **锁竞争火焰图** (新增) | `uprobe:pthread_mutex_lock` + `futex` | eBPF uprobe + tracepoint | 锁等待热点 | async-profiler / Pyroscope mutex_profile |

```
内存分配火焰图示意:
┌─────────────────────────────────────────────────────────────┐
│  内存分配火焰图 (宽度 = 分配字节数, 数据源: eBPF uprobe)     │
│                                                              │
│  main()                                                     │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
│  init()        process()       cleanup()                    │
│  ░░░░░░░░░░░   ░░░░░░░░░░░░░   ░░                           │
│                load_data()                                   │
│                ░░░░░░░░░░░░░ ← 最大内存分配                  │
│                malloc(10MB)                                  │
│                                                              │
│  💡 教学提示: load_data() 分配了 10MB，                      │
│     是否在 cleanup() 中正确释放了？                           │
│     对比 Pyroscope alloc_profile: 可标记 "仍然存活" vs "已释放" │
└─────────────────────────────────────────────────────────────┘
```

**探针兼容性矩阵** (对齐 Pixie TLS 库兼容性验证实践):

| 目标场景 | libc 版本 | malloc 符号 | 状态 |
|---------|----------|------------|------|
| glibc 2.31+ (Ubuntu 20.04+) | glibc | `__libc_malloc` | ✅ 已验证 |
| musl 1.2+ (Alpine) | musl | `malloc` (无 `__libc_` 前缀) | ✅ 已验证 |
| 静态链接 (-static) | — | 无动态符号, 需 fentry/fexit | ⚠️ 限制 |

### 4.3 新增：源码关联与交互增强

```
点击火焰图中的任意色块 →
  ┌──────────────────────────────────────────────────┐
  │  📍 函数: loop_process                           │
  │  📍 文件: worker.c:42                            │
  │  📍 CPU占比: 35.2%                               │
  │  📍 采样次数: 1,247 (采集频率: 99Hz, 总采样: 3541)│
  │  📍 调用者: main() → worker() → loop_process()   │
  │  📍 内核/用户: 用户态 (100%)                      │
  │                                                   │
  │  [📝 查看源码]    [📊 查看子调用树]                │
  │  [🔍 在持续 profile 时间轴上定位]                  │
  │  [📈 查看此函数在历次提交中的趋势]                  │
  │  [🤖 AI 解读此函数]                                │
  └──────────────────────────────────────────────────┘

点击 [📝 查看源码] →
  编辑器自动跳转到 worker.c:42 行
  并在右侧显示该函数的火焰图子调用

点击 [📈 趋势] →
  展示 loop_process() 在最近 5 次提交中的 CPU 占比趋势:
  提交#3: 8% → 提交#4: 10% → 提交#5: 12% → 提交#6: 15% → 提交#7: 35% 🚩
  ⚠️ 趋势检测: +337% 增长 → 触发性回归
```

### 4.4 火焰图阅读教学层

在现有"火焰图阅读指南"基础上增强，参考 Brendan Gregg 教学材料结构：

```
┌──────────────────────────────────────────────────────────────────┐
│  🔥 交互式阅读教学层                                              │
│                                                                   │
│  Level 1 - 基础: "宽度 = CPU 时间"（已实现）                      │
│  Level 2 - 进阶:                                                  │
│    • 颜色深浅 = 调用深度（越深 = 调用栈越深）                     │
│    • 平台区域 = 系统函数 vs 你的函数                              │
│    • 尖峰 = 频繁但短暂的调用 (高频低开销)                         │
│    • 高原 = 少量但耗时的调用 (低频高开销)  ← Brendan Gregg 关键概念│
│  Level 3 - 实战:                                                  │
│    • 识别不必要的系统调用（如频繁的 write(1字节)）                │
│    • 识别不合理的系统调用（如在循环中 open/close）                │
│    • 识别缺少的系统调用（如没有 close fd → fd 泄漏）              │
│  Level 4 - Brendan Gregg 方法论:                                  │
│    • 差分火焰图解读: 红色 = 性能退化, 蓝色 = 性能改进             │
│    • diff1 vs diff2: 为什么需要两个方向                            │
│    • 归一化: 当采样数不同时为什么需要归一化                        │
│    • 火焰图 + off-CPU + 内存 三图联读                              │
│                                                                   │
│  [🎯 当前实验关注的系统调用已高亮]                                 │
│  [📖 展开更多教学提示]                                             │
│  [🧪 交互测验: "请找出 CPU 占用最高的函数" → 学生点击验证]         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 五、技术实现方案

### 5.1 后端新增/修改文件

| 文件 | 功能 | 对齐最佳实践 |
|------|------|------------|
| `core/services/semantic_engine.go` | syscall 语义模式匹配引擎 | Pixie 协议自动解析理念 |
| `core/services/process_graph.go` | 进程拓扑图构建 | Pixie Service Map eBPF 自动发现 |
| `core/services/causal_chain.go` | 因果链分析 | Datadog 根因推断 (自下而上) |
| `core/services/flamegraph_diff.go` | 差分火焰图生成 (双输出: diff2 + diff1/negated) | Brendan Gregg difffolded.pl + --negate |
| `core/services/continuous_profiler.go` | 持续 profiling 管理 (push 模式, 自适应采样) | Pyroscope adaptive sampling |
| `core/services/profile_normalizer.go` | 采样归一化引擎 (自动检测并执行归一化) | Brendan Gregg difffolded.pl -n |
| `core/services/perf_pipeline.go` | 标准化 perf 采集管线 (99Hz + jitter + 双栈) | Brendan Gregg standardized pipeline |
| `core/ebpf/loader.go` | 新增 uprobe (malloc) + I/O 探针 | Pixie eBPF uprobe + Pyroscope alloc |
| `core/ebpf/compat.go` | TLS 库兼容性验证 (glibc/musl/static) | Pixie TLS compatibility |
| `core/types/obs_context.go` | 扩展 ObsContext: 持续 profile 元数据 + 标签 | Pyroscope labeling |
| `core/handler/ebpf.go` | 新增 API: semantic-events, process-graph, causal-chain, profile-diff | — |

### 5.2 前端新增/修改文件

| 文件 | 功能 |
|------|------|
| `panels/ProcessMapView.tsx` | 进程拓扑图 (ECharts/Cytoscape.js) |
| `panels/SemanticEventView.tsx` | 语义化事件流 |
| `panels/CausalChainView.tsx` | 因果链面板 |
| `panels/SmartDiffView.tsx` | 智能对比面板 (三列布局: Baseline \| Current \| Differential) |
| `panels/LockTimeline.tsx` | 锁时序分析 (Coffman 条件可视化) |
| `panels/FlameGraphPanel.tsx` | 大幅升级：四维火焰图 + 差分双视图 + 源码关联 + 应用性能仪表盘 |
| `panels/ContinuousProfileTimeline.tsx` | 持续 profiling 时间轴 (自适应采样指示器) |
| `panels/FlameGraphTeaching.tsx` | 4 级交互式阅读教学层 |
| `panels/FlameGraphSourceLink.tsx` | 火焰图→源码跳转 + 趋势面板 |
| `types/ebpf.ts` | 新增类型定义 |
| `lib/api.ts` | 新增 API 调用 |

### 5.3 eBPF 探针扩展

```python
# 新增 bpftrace 脚本: 内存分配追踪 (对齐 Pyroscope alloc_profile)
# ebpf/scripts/mem_alloc.bt
uprobe:/lib/x86_64-linux-gnu/libc.so.6:malloc
{
    @alloc_stack[ustack, arg0] = count();  # 记录分配调用栈和大小
    @alloc_total[ustack] = sum(arg0);       # 累计分配字节数
}

uprobe:/lib/x86_64-linux-gnu/libc.so.6:free
{
    @free_count[ustack] = count();
}

# 新增: I/O 追踪 (对齐 Brendan Gregg off-CPU 分析)
tracepoint:syscalls:sys_enter_read,
tracepoint:syscalls:sys_enter_write,
tracepoint:syscalls:sys_enter_sendto,
tracepoint:syscalls:sys_enter_recvfrom
{
    @io_bytes[comm] = sum(args->count);     # 按进程统计 I/O 字节数
    @io_latency[comm] = hist(args->count);  # I/O 大小分布直方图
    @io_count[ustack] = count();            # I/O 调用栈 (I/O 火焰图数据源)
}

# 标准化 perf 管线配置
# perf record -F 99 -j random -g -k CLOCK_MONOTONIC -- <program>
#  -F 99: 99Hz (Brendan Gregg 推荐频率, 避免锁步)
#  -j random: jitter 防混叠 (random 比 period 更好)
#  -g: call-graph (fp+dwarf)
#  -k CLOCK_MONOTONIC: 单一时钟源
```

### 5.4 探针兼容性矩阵 (对齐 Pixie TLS 兼容性实践)

| 目标环境 | 探针类型 | 符号/跟踪点 | 已验证 |
|---------|---------|------------|--------|
| glibc (Ubuntu 20.04+) | uprobe:malloc | `__libc_malloc` | ✅ |
| glibc (Ubuntu 20.04+) | uprobe:free | `__libc_free` | ✅ |
| musl (Alpine) | uprobe:malloc | `malloc` | ✅ |
| musl (Alpine) | uprobe:free | `free` | ✅ |
| 静态链接 | uprobe | 无动态符号 | ⚠️ 需 fentry/fexit (内核 5.5+) |
| Go crypto/tls | uprobe | Go 符号表 | ⚠️ 需 Go build info |
| 内核 4.18-5.4 | tracepoint | syscalls | ✅ |
| 内核 5.5+ | fentry/fexit | 静态链接场景 | ✅ 推荐 |

---

## 六、与 AI 诊断/AI 提问的集成

### 6.1 数据注入

eBPF 和火焰图数据通过 ObsContext 自动注入 AI 上下文：

```python
# ai-service/services/context_builder.py

def build_ebpf_context(obs_ctx: ObsContext) -> str:
    """将 eBPF 追踪数据转化为 AI 可理解的文本上下文 (对齐 Pyroscope labeling)"""
    ctx = f"""
## eBPF 系统调用追踪分析

### 持续 Profiling 元数据
- 采集期间: {obs_ctx.profile_start} → {obs_ctx.profile_end}
- 采样频率: {obs_ctx.sampling_rate}Hz (模式: {'自适应高频率' if obs_ctx.adaptive_high else '基线低频率'})
- 总采样数: {obs_ctx.total_samples}
- 标签: submission={obs_ctx.submission_id}, experiment={obs_ctx.experiment_id}

### 进程拓扑
- 共 {obs_ctx.process_count} 个进程，{obs_ctx.thread_count} 个线程
- 进程关系: {obs_ctx.process_relations}

### 语义化事件摘要
{obs_ctx.semantic_summary}

### 异常检测
- 错误系统调用: {obs_ctx.error_syscall_count} 次
- 检测到的模式: {obs_ctx.detected_patterns}
- 死锁检测: {'⚠️ 是 — Coffman 四个条件均已满足' if obs_ctx.deadlock_detected else '✅ 否'}
- 趋势检测: {obs_ctx.syscall_trend_anomalies}

### 火焰图热点 (数据源: perf record -F 99 -j random -g)
- CPU 用户态/内核态: {obs_ctx.user_pct}%/{obs_ctx.kernel_pct}%
- Top 热点函数: {obs_ctx.flamegraph_hotspots}
- 差分基准 (vs 参考实现): {obs_ctx.diff_summary}

### 应用层交叉验证 (Brendan Gregg methodology)
- p50 延迟: {obs_ctx.p50_latency}ms, p95: {obs_ctx.p95_latency}ms, p99: {obs_ctx.p99_latency}ms
- 吞吐量: {obs_ctx.throughput} req/s
- 错误率: {obs_ctx.error_rate}%
"""
    return ctx
```

### 6.2 AI 交互场景

| 场景 | 数据输入 | AI 输出 |
|------|---------|---------|
| 学生问"为什么程序卡住了" | eBPF 死锁检测 + Coffman 条件 + 锁时序 | "你的线程 TID=101 和 TID=102 互相等待对方释放锁，形成死锁环。Coffman 四条件验证: 互斥 ✅、持有并等待 ✅、不可剥夺 ✅、循环等待 ✅ —— 全部满足。" |
| 学生问"为什么运行这么慢" | 持续 profile 火焰图 + I/O 火焰图 + 趋势 | "你的程序 35% CPU 时间花在 loop_process()。在这 35% 中嵌套了高频小 I/O 操作 (write, 平均 64 字节/次)。建议缓冲批量写入。" |
| 自动诊断触发 | 全部 ObsContext: profile + trace + metrics | 自动生成多 Agent 诊断报告，引用具体 syscall 证据和性能数据，附带 Brendan Gregg 方法论的交叉验证 |
| 学生问"和参考实现有什么差异" | 差分火焰图 diff2 + diff1 + 应用指标对比 | "diff2 显示 loop_process() 新增 +35% CPU; diff1 显示 init() 已消失; p99 延迟从 45ms 恶化到 180ms。这些变化共同表明性能退化。" |

---

## 七、实施优先级

### 🔴 P0 — 核心体验提升 (对齐 Brendan Gregg 标准 + Pixie 语义化)

| 任务 | 预估工时 | 对齐标准 |
|------|---------|---------|
| 语义化事件引擎 | 3天 | Pixie 协议自动解析 |
| 差分火焰图 (双视图 + 归一化 + 地址剥离) | 3天 | Brendan Gregg differential flame graph |
| 内存分配火焰图 | 2天 | Pyroscope alloc_profile |
| 进程拓扑图 | 3天 | Pixie Service Map (eBPF auto-discovery) |
| 火焰图源码关联 (点击跳转 + 趋势) | 1天 | IDE profiler 标准 |
| 标准化 perf 管线 (99Hz + jitter + 双栈) | 1天 | Brendan Gregg standardized pipeline |

### 🟡 P1 — 深度分析能力

| 任务 | 预估工时 | 对齐标准 |
|------|---------|---------|
| 因果链分析 | 3天 | Datadog 根因推断 |
| 智能对比 (三列布局 + 双方向 diff) | 3天 | Brendan Gregg 三视图 |
| 锁时序分析 (Coffman 条件可视化) | 2天 | PostgreSQL deadlock_timeout |
| I/O 火焰图 + off-CPU 分析 | 2天 | Brendan Gregg off-CPU flame graph |
| 探针兼容性矩阵 (glibc/musl/static) | 1天 | Pixie TLS compatibility |

### 🟢 P2 — 增强体验

| 任务 | 预估工时 | 对齐标准 |
|------|---------|---------|
| 持续 profiling (自适应采样) | 3天 | Pyroscope adaptive sampling |
| 火焰图 4 级交互阅读教学 | 2天 | Brendan Gregg 教学材料 |
| 锁竞争火焰图 | 1天 | Pyroscope mutex_profile |
| 基线采集自动化 (N≥3) | 1天 | Brendan Gregg baseline methodology |
| 应用性能交叉验证仪表盘 | 1天 | Brendan Gregg validation |

---

*文档版本 v2.0 | 最后更新 2026-08-06*
*行业参考: New Relic Pixie Best Practices (2025) | Brendan Gregg Differential Flame Graphs | Pyroscope (Grafana) Continuous Profiling*
*关联文档: master-observability-upgrade-plan.md | system-trace-concurrency-upgrade-plan.md*
