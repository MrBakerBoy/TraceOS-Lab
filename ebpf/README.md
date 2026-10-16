# TraceOS Lab eBPF 观测引擎

基于 eBPF + LD_PRELOAD 的操作系统实验全维度观测工具集。

## 环境

- **内核**: 5.15.0+ (需要 BTF, kprobe, uprobe, tracepoint)
- **工具链**: bpftrace 0.14+, Python 3.10+, FlameGraph
- **权限**: root / CAP_BPF + CAP_SYS_ADMIN

## 脚本清单

| 脚本 | 功能 | 状态 |
|------|------|------|
| `syscall_trace.bt` | 系统调用追踪(频率+延迟分布直方图) | ✅ 已验证 |
| `sched_trace.bt` | 进程调度追踪(上下文切换/迁移/唤醒) | ✅ 已验证 |
| `flamegraph.sh` | 火焰图生成(用户态+内核态 SVG) | ✅ 已验证 |
| `deadlock_demo.sh` | 一键死锁演示(含行号定位) | ✅ 已验证 |
| `deadlock_analyzer.py` | 死锁分析引擎(Wait-For Graph) | ✅ 已验证 |
| `mutex_trace.c` | LD_PRELOAD 互斥追踪库 | ✅ 已验证 |
| `deadlock_detector.py` | BCC futex 死锁检测器(备选方案) | ✅ 已部署 |

## 快速开始

### 1. 死锁检测演示（推荐首发）

```bash
cd /root/traceos-lab/ebpf/scripts
bash deadlock_demo.sh
```

输出示例：
```
╔══════════════════════════════════════════╗
║     TraceOS — eBPF Deadlock Detector    ║
╚══════════════════════════════════════════╝
[BUILD] ✓ mutex_trace.so ready
[RUN]   Starting deadlock demo...

=============================================
  DEADLOCK DETECTED! (2 threads in cycle)
=============================================
  Deadlock cycle:
    TID=2711088 --waits--> mtx=0x...040 --held--> TID=2711087
    TID=2711087 --waits--> mtx=0x...080 --held--> TID=2711088
  Fix: Reverse lock order.
=============================================
Detection time: 5009ms
```

### 2. 追踪学生程序

```bash
# 方式A: 带死锁检测
LD_PRELOAD=./mutex_trace.so ./student_program 2>&1 | python3 deadlock_analyzer.py

# 方式B: 系统调用追踪
bpftrace syscall_trace.bt -c ./student_program

# 方式C: 调度追踪
bpftrace sched_trace.bt -p $(pgrep student_program)
```

### 3. 教师端火焰图

```bash
./flamegraph.sh <pid> 30 lab_analysis
# 输出: ../output/lab_analysis_user.svg / lab_analysis_kernel.svg
```

## 死锁检测原理

```
pthread_mutex_lock(&A)          ← LD_PRELOAD 拦截
  → mutex_trace.so emit("LOCK", &A)
  → 调用原始 pthread_mutex_lock

pthread_mutex_lock(&B)          ← 被 T2 持有
  → mutex_trace.so emit("LOCK", &B)
  → deadlock_analyzer.py: 建图
  → DFS 检测环 → 发现 T1→T2→T1
  → 输出死锁报告 + 修复建议
```

对比纯 futex tracepoint 方案：LD_PRELOAD 能捕获 fastpath 锁获取（无 futex），是教学场景最可靠方案。

## nsjail 沙箱集成

在沙箱中运行学生代码时：
```bash
# 确保 mutex_trace.so 在沙箱内可访问
nsjail --bindmount /root/traceos-lab/ebpf/scripts/mutex_trace.so:/lib/mutex_trace.so \
       --env LD_PRELOAD=/lib/mutex_trace.so \
       -- /path/to/student_binary 2>&1 | python3 deadlock_analyzer.py
```

## 文件结构

```
ebpf/
├── collectors/ebpf_collector.go   # Go 集成模块(NATS推送)
├── scripts/
│   ├── syscall_trace.bt           # 系统调用追踪
│   ├── sched_trace.bt             # 调度追踪
│   ├── flamegraph.sh              # 火焰图生成
│   ├── deadlock_demo.sh           # 一键死锁演示 ★
│   ├── deadlock_analyzer.py       # 死锁分析引擎
│   ├── mutex_trace.c              # LD_PRELOAD 追踪库
│   └── deadlock_detector.py       # BCC 方案(备选)
├── tools/FlameGraph/              # Brendan Gregg FlameGraph
├── output/                        # 采集输出 + SVG
└── README.md
```
