# eBPF 主链路迁移方案（定稿 v2）

> 评审后的修正版：修正了"每任务独立BPF对象+全局tracepoint重复挂载（性能线性爆炸）"、"非CO-RE与BPF_CORE_READ自相矛盾"、"Pipeline时序倒置（丢失初始syscall）"、"降级检测逻辑自相矛盾"、"PID复用未彻底解决"、"futex/mem子模块遗漏"、"nsjail父进程噪音"、"缺少sched_process_exec"、"raw_syscalls参数解析误解"等9项问题。

**目标环境**：阿里云 Ubuntu 22.04, 内核 5.15。

---

## 1. 现状分析与评审修正说明

### 1.0 原方案致命缺陷与修正对照

| 原方案 | 问题 | 修正后 |
|--------|------|--------|
| 每任务独立BPF对象，每个对象各自attach全局tracepoint | N个任务=N倍tracepoint执行次数，性能线性爆炸 | 全局单套BPF程序，tracepoint只attach一次 |
| 方案写"非CO-RE路径"但代码用BPF_CORE_READ | 逻辑自相矛盾，非CO-RE下BPF_CORE_READ不可用 | 优先CO-RE（建议安装BTF内核），非CO-RE为兼容分支 |
| Sandbox.Execute → TraceSession.Start | 先启动二进制再加载BPF，丢失初始syscall | BPF常驻，先注入PID再放行二进制 |
| IsEBPFAvailable()首行检查BTF但方案又说BTF不作为降级条件 | 无BTF环境永远降级，eBPF主链路白做 | 拆分CO-RE/非CO-RE检测分支 |
| tracked_pids key是纯u32 TID | PID复用碰撞风险 | 复合key: {TID, start_time} |
| 方案未提futex/mem模块适配 | 这些模块也没有PID过滤 | 共用同一套HASH_OF_MAPS追踪集 |
| 直接把nsjail PID注入追踪 | 采集到nsjail自身syscall噪音 | 通过/proc遍历精准定位学生二进制PID |
| 缺少sched_process_exec | exec事件丢失，进程树不完整 | 新增sched_process_exec tracepoint |

### 1.1 当前架构

```
评测 Pipeline
  ├── nsjail(exec_bin=strace -tt -k -o strace.log /binary)
  ├── parseStraceLine() 正则解析文本输出
  ├── AnalyzeStraceTraces() 语义模式识别
  ├── ScoreBehavior() 行为评分
  └── NATS → AI 诊断

eBPF (已存在但未接入评测 Pipeline)
  ├── ebpf/bpf/syscall_trace.bpf.c    CO-RE raw_syscalls tracepoint
  ├── ebpf/bpf/futex_deadlock.bpf.c   CO-RE futex tracepoint
  ├── ebpf/bpf/mem_trace.bpf.c        CO-RE brk/mmap/munmap tracepoint
  └── services/core-service/internal/ebpf/loader.go  编译标签: ebpf_native
```

### 1.2 为什么迁移到 eBPF

| 维度 | strace | eBPF |
|------|--------|------|
| 开销 | ptrace 暂停-恢复，每次 syscall ~1-5μs | 内核态 hook，每次 ~100-500ns |
| 信号干扰 | 改变进程信号行为（SIGSTOP/SIGCONT） | 无信号副作用 |
| 数据格式 | 文本行，需正则解析，脆弱 | 结构化二进制 ring buffer |
| 精确度 | 时间戳受 ptrace 上下文切换影响 | ktime_get_ns() 纳秒级精度 |
| 参数捕获 | 文本格式化，有截断风险 | 直接读取寄存器，完整 6 参数 |
| 线程支持 | `-f` follow forks，额外开销 | 内核态 TGID/TID 区分，无额外开销 |
| 并发性能 | 无重复执行问题（各自独立文本文件） | 需全局单实例避免tracepoint重复执行 |

### 1.3 现存 BPF 代码的关键问题

**问题一：PID 过滤仅匹配 TGID，多进程实验子进程丢失**

```c
// syscall_trace.bpf.c:93-94
u32 pid = (u32)(bpf_get_current_pid_tgid() >> 32);  // 取 TGID
if (target_pid != 0 && pid != target_pid) return 0;
```

`bpf_get_current_pid_tgid() >> 32` 取的是 TGID。fork 产生的子进程具有不同的 TGID，其系统调用完全不会被捕获。

**问题二：缺少进程/线程生命周期追踪**

现有 BPF 程序只有 `raw_syscalls/sys_enter` 和 `raw_syscalls/sys_exit`，没有 clone/exec/exit 相关 tracepoint。无法自动发现子进程/线程。

**问题三：全局 HASH map 无任务隔离**

`syscall_stats` 是全局 HASH，所有并发任务共享。任务完成后无法精确清理。

**问题四：编译标签门控，实际未参与编译**

`loader.go` 首行 `//go:build ebpf_native`，不加此 tag 编译时整个文件被跳过。

---

## 2. 目标架构（定稿 v2）

```
core-service 启动
  │
  ├── [一次性] 加载全局单套 BPF 程序（常驻内存）
  │     ├── tracepoint: raw_syscalls/sys_enter, raw_syscalls/sys_exit
  │     ├── tracepoint: sched/sched_clone, sched/sched_process_exec, sched/sched_process_exit
  │     ├── BPF_MAP_TYPE_HASH_OF_MAPS: sandbox_pids (外层key=sandbox_id, 内层=TID→start_time)
  │     └── ringbuf: syscall_events (全局共享，事件带 sandbox_id 标签)
  │
  ├── [每次评测] TraceSession 生命周期（无新BPF加载，仅map操作）
  │     1. 分配 sandbox_id，创建内层 map，插入 HASH_OF_MAPS
  │     2. 启动 nsjail → 等待 exec → 定位学生二进制 PID → 注入内层 map
  │     3. 消费 ringbuf 事件（按 sandbox_id 过滤）
  │     4. 评测结束 → 删除 HASH_OF_MAPS 外层 key → 内核自动回收内层 map
  │
  ├── [FALLBACK] strace（仅在 eBPF 不可用时自动降级）
  │
  └── [AUXILIARY] strace -k 教学辅助（独立补跑，不参与评分）
```

**降级触发条件（按优先级）：**
1. 内核版本 < 5.4
2. eBPF 编译产物 `.bpf.o` 文件缺失
3. BPF 程序加载失败（verifier 拒绝、权限不足）
4. ring buffer 读取异常（连续丢包 > 阈值）

**关键架构决策：**
- **全局单套 BPF**：tracepoint 只挂载一次，无论多少并发，每次 syscall 只执行 1 遍过滤逻辑，性能恒定
- **HASH_OF_MAPS 任务隔离**：外层 key = sandbox_id，内层 map = 该任务的 TID→start_time 追踪集。任务结束删除外层 key，内核自动回收，无残留、无泄漏
- **futex/mem 子模块统一改造**：共用同一套 HASH_OF_MAPS 追踪集，也走全局单实例 + sandbox_id 过滤，不再每个任务独立加载

---

## 3. 编译策略：CO-RE 优先 + 非CO-RE 兼容

### 3.1 CO-RE 优先（推荐）

阿里云 Ubuntu 22.04 **完全可以通过安装官方 generic 内核开启 BTF**：

```bash
# 检查当前内核
uname -r
# 安装 generic 内核（带 BTF）
apt-get install linux-image-generic linux-headers-generic
# 重启后验证
ls /sys/kernel/btf/vmlinux  # 应存在
```

开启 BTF 后走标准 CO-RE 路径，一劳永逸解决跨内核版本兼容问题。

### 3.2 eBPF 目录结构

```
ebpf/bpf/
├── vmlinux.h                    # bpftool btf dump 生成（CO-RE 用）
├── syscall_trace_v2.bpf.c       # CO-RE 版本：#include "vmlinux.h" + BPF_CORE_READ
├── syscall_trace_v2_nocore.bpf.c # 非CO-RE 兼容：硬编码结构体 + 直接字段访问
├── futex_deadlock_v2.bpf.c      # CO-RE 版本（共享追踪map）
├── mem_trace_v2.bpf.c           # CO-RE 版本（共享追踪map）
└── Makefile                     # 多 target
```

### 3.3 Makefile

```makefile
BPF_CFLAGS := -O2 -g -target bpf -D__TARGET_ARCH_x86

# CO-RE（生产优先）
vmlinux.h:
	bpftool btf dump file /sys/kernel/btf/vmlinux format c > vmlinux.h

ebpf-v2-core: vmlinux.h
	clang $(BPF_CFLAGS) -I. -c syscall_trace_v2.bpf.c -o syscall_trace_v2.bpf.o
	clang $(BPF_CFLAGS) -I. -c futex_deadlock_v2.bpf.c -o futex_deadlock_v2.bpf.o
	clang $(BPF_CFLAGS) -I. -c mem_trace_v2.bpf.c -o mem_trace_v2.bpf.o

# 非CO-RE（无BTF环境兼容，强绑定当前内核版本）
ebpf-v2-nocore:
	clang $(BPF_CFLAGS) \
	  -I/usr/include/x86_64-linux-gnu \
	  -c syscall_trace_v2_nocore.bpf.c -o syscall_trace_v2_nocore.bpf.o
```

### 3.4 Go 侧检测逻辑（修正原方案的自相矛盾）

```go
func IsEBPFAvailable() (mode string, ok bool) {
    // 1. 检查内核版本 >= 5.4
    // 2. 检查 CAP_BPF / CAP_SYS_ADMIN
    // 3. CO-RE 模式：BTF 存在 + _core.bpf.o 存在 → 返回 "core"
    // 4. 非CO-RE 模式：_nocore.bpf.o 存在 → 返回 "nocore"
    //    （不检查 BTF！原方案在这里自相矛盾）
    // 5. 都不可用 → 返回 "", false → 降级 strace
    
    hasBTF := fileExists("/sys/kernel/btf/vmlinux")
    hasCoreObj := fileExists("ebpf/bpf/syscall_trace_v2.bpf.o")
    hasNoCoreObj := fileExists("ebpf/bpf/syscall_trace_v2_nocore.bpf.o")
    
    if hasBTF && hasCoreObj {
        return "core", true
    }
    if hasNoCoreObj {
        return "nocore", true  // 不检查BTF！
    }
    return "", false
}
```

---

## 4. BPF 程序设计

### 4.1 核心数据结构

```c
// ── 追踪集：HASH_OF_MAPS ──
// 外层 key = sandbox_id (u64)，内层 map 类型 = BPF_MAP_TYPE_HASH
// 内层 key = pid_key (TID + start_time 复合键)，value = 加入时间戳

struct pid_key {
    u32 tid;
    u64 start_time;   // 进程启动时间 /proc/pid/stat[22]，防PID复用
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH_OF_MAPS);
    __uint(max_entries, 64);         // 最多64个并发沙箱
    __type(key, u64);                // sandbox_id
    __array(values, struct {
        __uint(type, BPF_MAP_TYPE_HASH);
        __uint(max_entries, 1024);   // 每个沙箱最多1024个进程/线程
        __type(key, struct pid_key);
        __type(value, u64);
    });
} sandbox_pids SEC(".maps");

// ── 全局 ringbuf（所有沙箱共享，带 sandbox_id 标记）───
struct syscall_event {
    u32 pid;            // TGID
    u32 tid;
    u32 syscall_nr;
    u64 sandbox_id;     // 标记事件所属沙箱
    u64 args[6];
    s64 ret;
    u64 duration_ns;
    u64 timestamp_ns;
    u8  is_thread;
};
```

### 4.2 Tracepoint 清单

| Tracepoint | 用途 | 关键操作 |
|------------|------|----------|
| `raw_syscalls/sys_enter` | 系统调用入口 | 查 sandbox_pids 判断是否追踪，记录参数 |
| `raw_syscalls/sys_exit` | 系统调用出口 | 计算延时，发射 ringbuf 事件（带 sandbox_id） |
| `sched/sched_clone` | 进程/线程创建 | 发现子 TID，写入所属沙箱的内层 map |
| `sched/sched_process_exec` | execve 执行 | 更新 PID→comm 映射，发射 exec 事件 |
| `sched/sched_process_exit` | 进程退出 | 清理内层 map 对应条目，发射 exit 事件 |

### 4.3 关于 raw_syscalls 参数：无需从 pt_regs 手动解析

**纠正原评审的一个误解**：`trace_event_raw_sys_enter` 结构体已直接暴露 `args[6]` 数组：

```c
struct trace_event_raw_sys_enter {
    unsigned short common_type;
    unsigned char common_flags;
    unsigned char common_preempt_count;
    int common_pid;
    long id;                    // 系统调用号
    unsigned long args[6];      // 直接可用！无需手动解析寄存器
};
```

这是 `raw_syscalls` tracepoint 的特性——内核在触发 tracepoint 时已经把系统调用参数从寄存器拷贝到 `args[]`。**不需要**手动从 `pt_regs` 解析 rdi/rsi/rdx/r10/r8/r9。现有代码 `ctx->args[0]` 的用法是正确的。

### 4.4 过滤逻辑（sys_enter 侧）

```c
SEC("tracepoint/raw_syscalls/sys_enter")
int trace_syscall_enter(struct trace_event_raw_sys_enter *ctx) {
    u32 tid = (u32)bpf_get_current_pid_tgid();

    // 获取当前进程的 start_time（从 task_struct）
    struct task_struct *task = (void *)bpf_get_current_task();
    u64 start_time = BPF_CORE_READ(task, start_time);

    struct pid_key key = { .tid = tid, .start_time = start_time };

    // 遍历所有活跃 sandbox，找到包含此 pid 的沙箱
    // （HASH_OF_MAPS 需要遍历外层，这里有一个性能 trade-off）
    // 优化：外层 sandbox 数量少（<=5并发），遍历开销可接受
    u64 sandbox_id;
    for (sandbox_id = 0; sandbox_id < 64; sandbox_id++) {
        void *inner = bpf_map_lookup_elem(&sandbox_pids, &sandbox_id);
        if (!inner) continue;
        u64 *found = bpf_map_lookup_elem(inner, &key);
        if (found) {
            // 记录参数
            // ... (同原来逻辑)
            return 0;
        }
    }
    return 0;  // 不在任何追踪集中
}
```

**优化分析**：外层遍历最多 64 个 sandbox（实际并发 <= 5），每次 `bpf_map_lookup_elem` 是 O(1) hash 查找，总开销 5-64 次 hash 查找 ≈ 远小于 strace 的 ptrace 暂停-恢复开销。

### 4.5 sched_clone 追踪（CO-RE 安全）

```c
SEC("tracepoint/sched/sched_clone")
int trace_sched_clone(struct trace_event_raw_sched_clone *ctx) {
    // CO-RE 安全读取 child_pid（处理不同内核版本的字段偏移差异）
    u32 child_tid = BPF_CORE_READ(ctx, child_pid);
    if (child_tid == 0) return 0;

    // 获取父进程信息，确定所属 sandbox
    u32 parent_tid = (u32)bpf_get_current_pid_tgid();

    // 获取子进程的 start_time（从 /proc 预注入，或使用 BPF helper）
    // start_time 在 Go 侧通过 /proc/<child_tid>/stat 获取后注入

    // ... 将 child_tid + start_time 写入对应 sandbox 的内层 map
}
```

### 4.6 sched_process_exec 追踪

```c
SEC("tracepoint/sched/sched_process_exec")
int trace_sched_exec(struct trace_event_raw_sched_process_exec *ctx) {
    u32 tid = (u32)bpf_get_current_pid_tgid();

    // 更新该 TID 的 comm（进程名变了）
    // 发射 exec 生命周期事件到 ringbuf
    struct lifecycle_event evt = {
        .event_type = 2,  // exec
        .tid = tid,
        .timestamp_ns = bpf_ktime_get_ns(),
    };
    bpf_get_current_comm(&evt.comm, sizeof(evt.comm));
    // ... 提交到 ringbuf
}
```

### 4.7 futex_deadlock / mem_trace 子模块适配

两个子模块**统一改造为全局单实例 + 共用 sandbox_pids 过滤**：

```c
// futex_deadlock_v2.bpf.c
SEC("tracepoint/syscalls/sys_enter_futex")
int trace_futex_enter(struct trace_event_raw_sys_enter *ctx) {
    // 同样的过滤逻辑：查 sandbox_pids 判断当前 TID 是否在被追踪
    // 同样的遍历逻辑（可提取为 static inline 函数复用）
    // ...
}

// mem_trace_v2.bpf.c
SEC("tracepoint/syscalls/sys_enter_brk")
int trace_enter_brk(struct trace_event_raw_sys_enter *ctx) {
    // 同样的过滤逻辑
}
```

三个 BPF 程序**各自独立编译为 `.bpf.o`**，但共用 Go 侧的同一个 Loader 管理，一起 attach，一起卸载。均为全局单实例。

---

## 5. Pipeline 集成（修正时序）

### 5.1 修正后的正确时序

**原方案（错误）**：
```
Compile → Sandbox.Execute → TraceSession.Start → 丢失初始syscall
```

**修正后（正确）**：
```
1. [服务启动时] eBPF 全局单套程序已加载，tracepoint 已挂载（常驻）
2. [评测开始] 
   a. 编译学生代码
   b. 分配 sandbox_id，创建内层 map，插入 HASH_OF_MAPS
   c. 启动 nsjail（此时沙箱做 namespace/cgroup 初始化，还没 exec 学生二进制）
   d. 轮询 /proc/<nsjail_pid>/task/ 获取学生二进制的宿主机 TID
   e. 获取学生进程 start_time，写入 sandbox_pids 的内层 map
   f. nsjail 自然完成初始化 → exec 学生二进制 → BPF 已就绪，零丢失
3. [评测结束]
   a. 从 ringbuf 消费该 sandbox_id 的事件
   b. 删除 HASH_OF_MAPS 外层 key → 内核自动回收内层 map
```

### 5.2 精准定位学生二进制 PID（排除 nsjail 噪音）

```go
func locateStudentPID(nsjailPID int, binaryName string) (int, error) {
    // nsjail 自身是宿主机进程，它会 fork 子进程再 exec 学生二进制
    // 需要定位到 exec 了学生二进制的那个进程，而不是 nsjail 本身
    
    for i := 0; i < 50; i++ {  // 最多等待 5 秒（50*100ms）
        time.Sleep(100 * time.Millisecond)
        
        // 遍历 nsjail 的所有子进程
        children, _ := findChildProcesses(nsjailPID)
        for _, childPID := range children {
            comm, _ := os.ReadFile(fmt.Sprintf("/proc/%d/comm", childPID))
            if strings.TrimSpace(string(comm)) == binaryName {
                return childPID, nil  // 找到了学生二进制
            }
        }
    }
    return 0, fmt.Errorf("student binary PID not found")
}
```

### 5.3 修改 `pipeline.go`

```go
func (p *Pipeline) Run(ctx context.Context, ...) error {
    // 1. 编译
    compileResult, _ := p.compiler.Compile(...)
    
    // 2. 选择追踪模式（eBPF 优先）
    traceMode := ebpf.SelectMode()  // "ebpf_core", "ebpf_nocore", "strace"
    
    // 3. 分配 sandbox_id + 创建内层 map
    sandboxID := ebpf.AllocSandboxID()
    defer ebpf.FreeSandboxID(sandboxID)
    
    // 4. 启动 nsjail（此时还没 exec 学生二进制）
    si, _ := p.sandboxMgr.Acquire(ctx, ...)
    resultCh := make(chan *ExecResult, 1)
    go func() {
        result, _ := p.sandboxMgr.ExecuteEBPF(ctx, si, compileResult.BinaryPath, ...)
        resultCh <- result
    }()
    
    // 5. 等待学生二进制 exec 并定位其宿主机 PID
    studentPID, err := locateStudentPID(si.HostPID, filepath.Base(compileResult.BinaryPath))
    if err != nil { /* 降级 */ }
    
    // 6. 注入追踪（BPF 已就绪，不会丢失初始 syscall）
    ebpf.InjectPID(sandboxID, studentPID)
    
    // 7. 等待执行完成 + 消费 ringbuf 事件
    result := <-resultCh
    traces := ebpf.CollectTraces(sandboxID)
    
    // 8. 后续分析不变
    analysis := AnalyzeStraceTraces(toTraceRecords(traces))
    score := ScoreBehavior(analysis, ...)
}
```

### 5.4 修改 `nsjail_manager.go`

增加 eBPF 模式，nsjail 直接运行二进制而不包装 strace：

```go
func writeNsjailConfigEBPF(path, binary string, lim nsjailLimits, timeout time.Duration) error {
    timeSec := int(timeout.Seconds()) + lim.timeExtra
    cfg := "mode: ONCE\nmount_proc: true\n"
    cfg += fmt.Sprintf("mount { src: \"%s\" dst: \"/binary\" is_bind: true mandatory: true }\n", binary)
    cfg += "mount { src: \"none\" dst: \"/tmp\" is_bind: false fstype: \"tmpfs\" rw: true }\n"
    cfg += "clone_newuser: true\nclone_newpid: true\n"
    cfg += "clone_newuts: true\nclone_newipc: true\n"
    cfg += fmt.Sprintf("cgroup_mem_max: %d\ncgroup_pids_max: %d\ntime_limit: %d\n",
        lim.memLimitMB*1024*1024, lim.pidMax, timeSec)
    // 关键：不包装 strace，直接运行二进制
    cfg += "exec_bin: \"/binary\"\nexec_cwd: \"/tmp\"\n"
    return os.WriteFile(path, []byte(cfg), 0o644)
}
```

### 5.5 统一 TraceRecord

```go
type SyscallTraceRecord struct {
    Time         time.Time
    SubmissionID string
    PID          int          // TGID
    TID          int          // eBPF 可区分线程
    SyscallName  string
    Args         map[string]interface{}
    ReturnValue  int64
    ErrorName    string
    DurationNs   int64
    SourceLine   *int
    IsThread     bool         // eBPF 新增
    Source       string       // "ebpf" 或 "strace"
}
```

上层 `pattern_analyzer.go`、`behavior_scorer.go`、AI 诊断、评分链路**零改动**。

---

## 6. strace 降级 + 教学辅助

### 6.1 降级触发

```go
func (p *Pipeline) selectTraceMode() (string, error) {
    mode, ok := ebpf.IsEBPFAvailable()
    if !ok {
        log.Printf("[Pipeline] eBPF unavailable, fallback to strace")
        return "strace", nil
    }
    // 健康检查：验证 ringbuf 可读
    if err := ebpf.HealthCheck(); err != nil {
        log.Printf("[Pipeline] eBPF health check failed: %v", err)
        return "strace", nil
    }
    return "ebpf_" + mode, nil
}
```

### 6.2 strace -k 教学辅助

eBPF 链路不做栈回溯、不做行号解析。保留独立补跑 `strace -k` 作为**可选教学辅助信息**，不作为评分依据：

```go
// 异步补跑，非阻塞
go func() {
    cmd := exec.Command("nsjail", "--config", straceKConfig)
    // 配置 exec_bin: strace -k ...
    output, _ := cmd.CombinedOutput()
    // 解析源码行号，存入 seperate table: submission_source_lines
    // 前端可选的"查看源码行号"按钮使用
}()
```

### 6.3 Prometheus 指标

```
traceos_ebpf_mode{type="core|nocore|strace"}
traceos_ebpf_sandbox_active
traceos_ebpf_events_total
traceos_ebpf_ringbuf_drops_total
traceos_ebpf_fallback_total{reason="kernel_version|load_failed|ringbuf_error|no_btf"}
```

---

## 7. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| BPF verifier 拒绝复杂程序 | 中 | 降级 strace | 控制指令数 < 1000000；拆分 BPF 程序 |
| `sched_clone` tracepoint 在不同内核版本字段偏移不同（CO-RE解决） | 低 | 读错 child_pid | 优先 CO-RE + BPF_CORE_READ |
| 非CO-RE 强绑定内核版本，升级后可能加载失败 | 中 | 降级或重新编译 | Makefile 提供 `ebpf-v2-nocore` target + 版本校验 |
| ring buffer 丢事件（高负载） | 低 | 丢失少量 syscall | ringbuf 256KB，监控 drops |
| HASH_OF_MAPS 外层遍历开销 | 低 | 每次 syscall 多几次 hash 查找 | 实际并发 <=5，开销 < 1μs，远低于 strace |
| `sched_process_exit` 丢事件导致过期 TID 残留 | 中 | PID 复用后误追踪 | 复合 key (TID+start_time) 从根本上避免 |
| nsjail PID namespace 映射定位不准 | 低 | 注入错误 PID | 使用宿主机侧 /proc 遍历，不依赖 namespace 内 PID |

---

## 8. 实施步骤

### Phase 1：BPF 程序编写（1.5 天）

- [ ] 编写 `syscall_trace_v2.bpf.c`（CO-RE + HASH_OF_MAPS + 5个tracepoint）
- [ ] 编写 `syscall_trace_v2_nocore.bpf.c`（非CO-RE兼容版本）
- [ ] 编写 `futex_deadlock_v2.bpf.c`（共用 sandbox_pids 过滤）
- [ ] 编写 `mem_trace_v2.bpf.c`（共用 sandbox_pids 过滤）
- [ ] 编写 Makefile：`ebpf-v2-core`、`ebpf-v2-nocore`、`vmlinux.h`
- [ ] Verifier 验证：加载 → 卸载，确认无 reject

### Phase 2：Go Loader 改造（1 天）

- [ ] 删除 `ebpf_native` 编译标签
- [ ] 实现 `IsEBPFAvailable()` 拆分 CO-RE/非CO-RE 检测
- [ ] 实现全局 Loader（服务启动时 attach，常驻）
- [ ] 实现 `AllocSandboxID()` / `FreeSandboxID()` HASH_OF_MAPS 管理
- [ ] 实现 `InjectPID(sandbox_id, tid, start_time)` 
- [ ] 实现 ringbuf consumer（按 sandbox_id 过滤事件）
- [ ] 实现 `locateStudentPID()` 精准定位学生二进制 PID
- [ ] 实现 `discoverExistingThreads()` 兜底

### Phase 3：Pipeline 集成（1 天）

- [ ] `nsjail_manager.go` 增加 eBPF 模式（不包装 strace）
- [ ] `pipeline.go` 修正时序：先注入 PID 再放行二进制
- [ ] 统一 `SyscallTraceRecord`，标记 Source 字段
- [ ] `pattern_analyzer.go`：零改动
- [ ] `behavior_scorer.go`：零改动
- [ ] 降级逻辑：异常自动切 strace

### Phase 4：降级与监控（0.5 天）

- [ ] 健康检查模块 `ebpf.HealthCheck()`
- [ ] Prometheus 指标
- [ ] 降级触发日志

### Phase 5：旧代码清理（0.5 天）

- [ ] 删除 `ebpf/bpf/syscall_trace.bpf.c`
- [ ] 删除 `services/core-service/internal/ebpf/loader.go`
- [ ] 删除 `services/core-service/internal/handler/ebpf_handler.go` 中 bpftrace fallback 逻辑
- [ ] 清理对应的 bpftrace `.bt` 脚本引用

### Phase 6：集成测试（1 天）

- [ ] 单进程 syscall 完整性（对比 strace 产出）
- [ ] fork + wait 多进程完整性
- [ ] pthread_create 多线程完整性
- [ ] deadlock 实验：futex 事件覆盖
- [ ] memory 实验：brk/mmap/munmap 事件覆盖
- [ ] 并发 3-5 个沙箱：验证 HASH_OF_MAPS 隔离
- [ ] 降级测试：内核 4.x 环境下降级到 strace
- [ ] 非CO-RE 环境测试

---

## 9. 调研参考

| 项目 | 用途 | 技术特征 |
|------|------|----------|
| Cilium Tetragon | 运行时安全可观测性 | raw_syscalls + kprobe + per-namespace 过滤 |
| Aqua Tracee | 系统调用追踪 | raw_tracepoint + ring buffer + PID 树 |
| Falco | CNCF 运行时安全 | sys_enter/sys_exit tracepoint + fillers 模式 |
| bpftrace | 动态追踪脚本 | kprobe/tracepoint + BPF map + 聚合输出 |
| libbpf-bootstrap | BPF 程序脚手架 | CO-RE + vmlinux.h + ringbuf 标准模板 |

上述项目均采用纯 eBPF 链路（无 strace 降级），验证了 eBPF syscall tracing 在生产级的可行性。本方案借鉴 Tetragon 的 namespace 隔离（映射为 sandbox 隔离）和 Tracee 的 PID 树追踪（映射为 HASH_OF_MAPS + sched_clone）。

---

## 10. 最终架构总结（定稿 v2）

```
高性能主链路：eBPF 全局单实例（tracepoint 只挂载一次）
              ├── HASH_OF_MAPS 按 sandbox 隔离 PID 集合
              ├── sched_clone 全进程线程追踪（fork/vfork/clone/pthread）
              ├── sched_process_exec + sched_process_exit 完整生命周期
              ├── 复合 key (TID+start_time) 彻底解决 PID 复用
              └── futex/mem 子模块共用追踪集，统一过滤

稳定兜底链路：自动降级 strace
              ├── 内核版本 / BPF 加载 / ringbuf 异常 → 自动回退
              └── strace -k 教学辅助（独立补跑，不参与评分）

上层业务零改动：pattern_analyzer / behavior_scorer / AI 诊断 / 评分链路
              所有采集层差异统一封装为标准 SyscallTraceRecord

资源安全：tracepoint 只挂载一次（性能恒定，不随并发膨胀）
          任务结束删除 HASH_OF_MAPS 外层 key → 内核自动回收
          无全局 map 泄漏、无 PID 误追踪、无进程/线程丢失

编译策略：CO-RE 优先（推荐安装 BTF 内核），非CO-RE 兼容分支
          明确标注非CO-RE 内核绑定属性，推荐升级路径
```