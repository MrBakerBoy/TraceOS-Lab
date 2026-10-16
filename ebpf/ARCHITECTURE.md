# TraceOS Lab — eBPF 双层观测架构

## 架构概览

```
                         ┌─────────────────────────────────┐
                         │       学生提交代码                │
                         └─────────────┬───────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    第一层：系统调用观测 (strace)                    │
│                                                                    │
│  strace -f -tt -k -o trace.log ./student_binary                   │
│  ┌─────────────┐   ┌──────────────────┐   ┌─────────────────┐   │
│  │ syscall 序列 │──▶│ pattern_analyzer │──▶│ AI 大白话解释    │   │
│  │ 延迟统计     │   │ (错误模式识别)    │   │ (ebpf_analysis)  │   │
│  └─────────────┘   └──────────────────┘   └─────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    第二层：内核深度观测 (eBPF)                      │
│                                                                    │
│  ┌───────────────────────┐  ┌───────────────────────────────┐    │
│  │ bpftrace 运行时       │  │ CO-RE libbpf (cilium/ebpf)    │    │
│  │ (已集成，当前主路径)    │  │ (编译时，Build tag: ebpf_native)│   │
│  ├───────────────────────┤  ├───────────────────────────────┤    │
│  │ futex_trace.bt        │  │ futex_deadlock.bpf.o          │    │
│  │   → tracepoint futex  │  │   → ringbuf → Go consumer     │    │
│  │                       │  │                               │    │
│  │ mem_trace.bt          │  │ mem_trace.bpf.o               │    │
│  │   → brk/mmap/munmap   │  │   → ringbuf → leak detection  │    │
│  │                       │  │                               │    │
│  │ sched_trace.bt        │  │ syscall_trace.bpf.o           │    │
│  │   → context switches  │  │   → hashmap → stats collector │    │
│  └───────────────────────┘  └───────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    第三层：CPU 火焰图 (perf + eBPF)                │
│                                                                    │
│  perf record -a -g -F 999 → FlameGraph → 用户态/内核态 SVG        │
│  bpftrace profile:hz:999 → FlameGraph → 内核态 SVG (fallback)    │
│  hotspot 提取 → AI 性能分析 (flamegraph_analysis)                 │
└──────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                        SSE 实时推送                                │
│                                                                    │
│  TraceEvent ──→ broadcast() ──→ SSE /api/v1/ebpf/stream/:pid     │
│                                  ├── graph (锁图实时更新)          │
│                                  ├── deadlock (死锁检测结果)       │
│                                  ├── syscall (系统调用计数)        │
│                                  ├── sched (调度统计)              │
│                                  └── mem (内存分配汇总)            │
└──────────────────────────────────────────────────────────────────┘
```

## 探针矩阵

| 探针类型 | strace 路径 | bpftrace eBPF 路径 | CO-RE libbpf 路径 | 输出 |
|---------|------------|-------------------|-------------------|------|
| **死锁检测** | `strace -e trace=futex` (fallback) | `futex_trace.bt` (主路径) | `futex_deadlock.bpf.o` | wait-for graph + cycle |
| **系统调用** | `strace -tt -p PID` | `syscall_trace.bt` | `syscall_trace.bpf.o` | count + latency |
| **调度追踪** | N/A | `sched_trace.bt` | 待实现 | context switch + migration |
| **内存追踪** | N/A | `mem_trace.bt` | `mem_trace.bpf.o` | brk/mmap/munmap + leak |
| **火焰图** | N/A | `perf record` + `bpftrace` | 待实现 | user/kernel SVG |

## 关键设计决策

### 1. 为什么死锁检测主路径用 bpftrace 而不是 strace？

| 维度 | strace | bpftrace eBPF |
|------|--------|---------------|
| 原理 | ptrace 系统调用，暂停目标进程 | 内核 tracepoint，不暂停目标 |
| 开销 | ~50-100% 性能下降 | <1% 性能下降 |
| 精度 | 丢失高并发下的快速事件 | 零丢失 (perf ring buffer) |
| 死锁检测可靠性 | ptrace 改变程序时序，可能 Heisenbug | 对程序时序无影响 |

### 2. 为什么 CO-RE libbpf 作为未来路径？

- **BCC** (deadlock_detector.py): 需要内核头文件 + clang 在运行时编译，不适合容器化部署
- **bpftrace** (当前主路径): 解释执行，灵活但性能不如编译型 BPF
- **cilium/ebpf + CO-RE** (未来路径): 纯 Go，编译一次到处运行，行业最佳实践

### 3. TraceEvent 统一数据模型

所有三个后端 (strace / bpftrace / cilium/ebpf) 都通过统一的 `TraceEvent` 结构传递数据：

```go
type TraceEvent struct {
    Source      string  // "syscall" | "futex" | "mem" | "sched"
    Op          string  // 操作名称
    Tid         uint32
    Pid         uint32
    Uaddr       uint64  // futex 地址
    Size        uint64  // 内存分配大小
    Count       uint64  // 聚合计数
    LatencyNs   uint64  // 延迟纳秒
    TimestampNs uint64
}
```

## 文件清单

```
ebpf/
├── bpf/                          # CO-RE BPF C 程序
│   ├── Makefile                  # 编译脚本
│   ├── syscall_trace.bpf.c       # 系统调用追踪
│   ├── futex_deadlock.bpf.c      # futex 死锁检测
│   └── mem_trace.bpf.c           # 内存分配追踪
├── scripts/                      # bpftrace 脚本 (当前主路径)
│   ├── futex_trace.bt            # futex tracepoint ← 死锁检测主路径
│   ├── sched_trace.bt            # 调度追踪
│   ├── mem_trace.bt              # 内存追踪
│   ├── syscall_trace.bt          # 系统调用追踪
│   └── lock_trace.bt             # uprobe pthread 追踪 (备用)
├── tools/FlameGraph/             # Brendan Gregg's FlameGraph
└── ARCHITECTURE.md               # 本文档

services/core-service/internal/
├── handler/ebpf_handler.go       # eBPF 观测处理器 (SSE + 探针编排)
├── handler/flamegraph.go         # 火焰图代理
└── ebpf/loader.go                # cilium/ebpf CO-RE loader (build: ebpf_native)

services/ai-service/app/routers/
├── ebpf_analysis.py              # 系统调用 AI 解读
└── flamegraph_analysis.py        # 火焰图 AI 解读

services/observability/           # 可观测性数据查询服务
└── internal/
    ├── collector/                # 特征提取 (FD泄漏/死锁/竞态)
    ├── handler/                  # API handlers
    └── repository/               # TimescaleDB 查询
```

## 部署要求

### 当前路径 (bpftrace)
```bash
# 容器必须挂载:
#   - /sys/kernel/debug (ro)
#   - capabilities: SYS_PTRACE, SYS_ADMIN, BPF, PERFMON
#   - privileged: true 或 memlock unlimited
```

### CO-RE 路径 (未来)
```bash
# 1. 编译 BPF 程序
cd ebpf/bpf && make all && make install

# 2. 构建时加 tag
go build -tags ebpf_native ./cmd/server/

# CO-RE 优势: 不需要 privileged，不需要 kernel headers
# 只需要 CAP_BPF + CAP_PERFMON (Linux 5.8+)
```
