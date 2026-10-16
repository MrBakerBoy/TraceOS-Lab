#!/usr/bin/env python3
"""TraceOS Lab — RAG 知识库种子脚本 (生产级)
一次性导入 12 篇高质量操作系统知识文档, 涵盖 6 大实验类别。
"""

import asyncio, json, sys, os
import httpx

API_BASE = os.environ.get("API_BASE", "http://localhost:80")
# 可通过环境变量覆盖, 也可在 docker compose exec 中直连 ai-service
LOGIN_URL = f"{API_BASE}/api/v1/auth/login"
PASTE_URL = f"{API_BASE}/api/v1/courses/{{course_id}}/knowledge/paste"
SEARCH_URL = f"{API_BASE}/api/v1/courses/{{course_id}}/rag/search"
ENTRIES_URL = f"{API_BASE}/api/v1/courses/{{course_id}}/knowledge"
APPROVE_URL = f"{API_BASE}/api/v1/courses/{{course_id}}/knowledge/{{entry_id}}/approve"

USERNAME = "admin"
PASSWORD = "admin123"

# ═══════════════════════════════════════════════════════════════════════
# 知识文档定义
# ═══════════════════════════════════════════════════════════════════════

KNOWLEDGE_ENTRIES = [
    # ── 进程管理 ──
    {
        "title": "fork() 系统调用深度解析",
        "category": "process",
        "content": r"""
# fork() 系统调用深度解析

## 基本概念
fork() 是 Unix/Linux 中创建新进程的唯一方式（底层均通过 clone 实现）。调用一次，返回两次。

## 返回值语义
- **返回 0**：当前处于子进程中
- **返回 >0**：当前处于父进程中，返回值是子进程 PID
- **返回 -1**：fork 失败，常见原因：
  - EAGAIN：达到进程数上限 (RLIMIT_NPROC)
  - ENOMEM：内核内存不足

## 写时拷贝 (Copy-on-Write)
现代 Linux 中 fork 不会立即复制全部内存。父子进程共享同一物理页并标记为只读，
任一进程尝试写入时触发缺页异常，内核复制该页。这大幅降低了 fork 开销。

## 文件描述符继承
子进程继承父进程所有打开的文件描述符，共享同一文件表项（偏移量、状态标志）。
这意味着如果父子进程并发读写同一文件，会相互影响偏移量。
常见陷阱：socket 或 pipe 的写端被继承后未关闭，导致对端读阻塞等待 EOF。

## 常见错误模式
1. 不检查返回值：假设 fork 一定成功
2. 循环中无限制 fork：fork 炸弹
3. 混淆父子进程执行流：分支逻辑不清
4. 忘记 wait：产生僵尸进程
5. 多线程程序中使用 fork：只有调用线程在子进程中存活，可能导致死锁

## 调试工具
- strace -f -e trace=clone,execve ./program
- ps aux | grep defunct   # 查找僵尸进程
- top 观察进程数
""",
    },
    {
        "title": "僵尸进程与孤儿进程完全指南",
        "category": "process",
        "content": r"""
# 僵尸进程与孤儿进程完全指南

## 僵尸进程 (Zombie)
- 定义：子进程已终止，但父进程尚未调用 wait() 回收其退出状态
- 状态标识：ps 显示为 <defunct> 或 Z 状态
- 危害：占用 PID 资源（内核保留 PCB），大量僵尸可耗尽 PID 导致无法创建新进程
- 解决：父进程调用 wait()/waitpid()，或设置 SIGCHLD 处理函数为 SIG_IGN

## 孤儿进程 (Orphan)
- 定义：父进程先于子进程终止
- 处理：内核将孤儿进程的父进程改为 init (PID=1)
- init 会定期调用 wait() 回收其下的子进程
- 孤儿进程本身不是问题，是正常的系统行为

## wait() vs waitpid()
- wait(&status)：阻塞等待任意一个子进程终止
- waitpid(pid, &status, options)：可指定特定 PID 或 PID 组
  - pid=-1：等待任意子进程（同 wait）
  - pid=0：等待同进程组的任意子进程
  - WNOHANG：非阻塞，无终止子进程时返回 0
  - WUNTRACED：也报告已停止的子进程

## 状态解析宏
- WIFEXITED(status)：正常退出
- WEXITSTATUS(status)：获取退出码
- WIFSIGNALED(status)：被信号杀死
- WTERMSIG(status)：获取终止信号
- WIFSTOPPED(status)：被停止

## 双重 fork 技巧
父进程 fork 出子进程，子进程再 fork 出孙子进程后立即退出。
孙子进程成为孤儿被 init 接管，父进程只需 wait 子进程。
常用于创建守护进程。
""",
    },
    {
        "title": "exec 系列函数完全手册",
        "category": "process",
        "content": r"""
# exec 系列函数完全手册

## 核心概念
exec 用新程序完全替换当前进程的地址空间。成功后不返回，失败返回 -1。

## 函数族
- execl(path, arg0, ..., NULL)：列表形式，路径搜索
- execlp(file, arg0, ..., NULL)：使用 PATH 搜索
- execle(path, arg0, ..., NULL, envp)：指定环境变量
- execv(path, argv[])：数组形式
- execvp(file, argv[])：PATH 搜索 + 数组
- execvpe(file, argv[], envp[])：PATH + 数组 + 环境

## 常见错误
1. exec 成功后还写代码——永远不会执行到
2. 路径不存在或权限不足——不检查返回值
3. 参数列表未以 NULL 结束——导致未定义行为
4. 忘记设置 FD_CLOEXEC——子进程继承不必要的 fd

## 与 fork 的配合
经典模式：fork + exec
```c
pid_t pid = fork();
if (pid == 0) {
    // 子进程：关闭不需要的 fd，重定向，然后 exec
    close(pipe_fd[0]);
    dup2(pipe_fd[1], STDOUT_FILENO);
    execlp("ls", "ls", "-l", NULL);
    perror("exec failed");
    exit(127);
}
```

## fork+exec 中的竞态条件
fork 后子进程继承父进程的信号处理函数指针，但地址空间即将被 exec 替换。
如果信号在 fork 后、exec 前到达子进程，会执行父进程的处理函数，
此时可能访问未初始化的数据。解决方案：fork 后立即设置信号处理为默认，
或使用 signalfd 等机制。
""",
    },
    # ── 线程同步 ──
    {
        "title": "互斥锁 (Mutex) 与条件变量 (Condition Variable) 原理与实践",
        "category": "thread",
        "content": r"""
# 互斥锁与条件变量原理与实践

## 互斥锁 (pthread_mutex_t)
- 作用：保护临界区，保证同一时刻只有一个线程访问共享资源
- 类型：
  - PTHREAD_MUTEX_NORMAL：不检测死锁（重复加锁会死锁）
  - PTHREAD_MUTEX_ERRORCHECK：检测重复加锁，返回 EDEADLK
  - PTHREAD_MUTEX_RECURSIVE：同一线程可重复加锁，需同样次数解锁
- 关键函数：pthread_mutex_init, pthread_mutex_lock, pthread_mutex_unlock, pthread_mutex_destroy

## 条件变量 (pthread_cond_t)
- 作用：让线程在某个条件不满足时进入等待，条件满足时被唤醒
- 必须与互斥锁配合使用
- 关键函数：pthread_cond_wait, pthread_cond_signal, pthread_cond_broadcast

## 标准使用模式
```c
pthread_mutex_lock(&mutex);
while (!condition) {  // 必须用 while 而非 if！
    pthread_cond_wait(&cond, &mutex);
}
// 条件满足，执行操作
pthread_mutex_unlock(&mutex);
```

## 常见陷阱
1. **虚假唤醒 (Spurious Wakeup)**：pthread_cond_wait 可能在不满足条件时返回，
   必须用 while 循环检查而非 if
2. **丢失信号**：在 cond_wait 之前条件已满足，唤醒信号发出但无人等待
3. **死锁**：持锁 A 等锁 B，另一线程持锁 B 等锁 A
4. **忘记解锁**：异常路径中未释放锁

## futex 系统调用
Linux 中 pthread 锁和条件变量底层使用 futex 系统调用。
- FUTEX_WAIT：等待 futex 值变化
- FUTEX_WAKE：唤醒等待者
- strace 中看到大量 futex 调用是正常的
""",
    },
    {
        "title": "生产者-消费者问题与线程池实现",
        "category": "thread",
        "content": r"""
# 生产者-消费者问题与线程池实现

## 经典问题描述
- 生产者：生成数据放入缓冲区
- 消费者：从缓冲区取出数据处理
- 约束：缓冲区满时生产者等待，缓冲区空时消费者等待

## 解决方案
### 方案一：互斥锁 + 条件变量
- 一个 mutex 保护缓冲区
- 两个条件变量：not_full (生产者等待), not_empty (消费者等待)

### 方案二：信号量 (semaphore)
- empty_slots：初始为缓冲区大小，生产者 P 操作
- full_slots：初始为 0，消费者 P 操作
- mutex：保护缓冲区操作

## 线程池设计要点
1. **任务队列**：线程安全的 FIFO 队列
2. **工作线程**：循环取任务执行，无任务时阻塞
3. **优雅关闭**：发送终止信号，等待所有线程完成当前任务
4. **动态调整**：根据负载增减线程数（可选）

## 调试技巧
- helgrind (Valgrind)：检测竞态条件和锁顺序问题
- strace -f -e trace=futex：观察同步原语使用
- gdb 多线程调试：thread apply all bt 查看所有线程栈

## 常见错误
1. 忘记 join 线程：主线程退出导致整个进程终止
2. 共享变量未加锁：数据竞争 (data race)
3. 锁粒度过大：性能瓶颈
4. 锁粒度过小：增加复杂度和死锁风险
""",
    },
    # ── 内存管理 ──
    {
        "title": "malloc/free 内存管理原理与泄漏检测",
        "category": "memory",
        "content": r"""
# malloc/free 内存管理原理与泄漏检测

## malloc 实现原理
- 底层通过 brk/sbrk（小内存）或 mmap（大内存，通常 >128KB）向内核申请
- glibc 使用 ptmalloc 分配器，基于 Doug Lea 的 dlmalloc
- 维护空闲链表 (free list) 和 bin 结构管理已释放内存

## 常见分配失败原因
- ENOMEM：虚拟内存不足（不是物理内存！）
- 内存碎片化：大量小对象分配/释放导致碎片
- 未初始化指针：使用野指针

## 内存泄漏检测工具
### Valgrind
```bash
valgrind --leak-check=full --show-leak-kinds=all ./program
```
- definitely lost：确认泄漏，无法回收
- indirectly lost：间接泄漏
- possibly lost：可能泄漏
- still reachable：程序结束时仍可访问（通常无害）

### AddressSanitizer (ASan)
```bash
gcc -fsanitize=address -g -o program program.c
./program
```
- 检测越界访问、use-after-free、double-free
- 比 Valgrind 快得多

## 常见错误模式
1. **忘记 free**：malloc 后未配对 free
2. **Double free**：同一指针释放两次 → 段错误或堆损坏
3. **Use after free**：释放后继续使用指针
4. **越界访问**：写入超出分配大小的内存
5. **未检查返回值**：malloc 可能返回 NULL

## mmap 系统调用
- mmap(NULL, size, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0)
- 直接向内核申请匿名内存，不受 malloc 内部管理
- 大块内存 (>128KB) 时 glibc malloc 内部自动使用 mmap
""",
    },
    {
        "title": "mmap 内存映射与共享内存 IPC",
        "category": "memory",
        "content": r"""
# mmap 内存映射与共享内存 IPC

## mmap 基本用法
```c
void *mmap(void *addr, size_t length, int prot, int flags, int fd, off_t offset);
```
- prot：PROT_READ, PROT_WRITE, PROT_EXEC, PROT_NONE
- flags：MAP_SHARED, MAP_PRIVATE, MAP_ANONYMOUS, MAP_FIXED

## 文件映射 vs 匿名映射
- 文件映射：fd 指向打开的文件，修改可写回磁盘 (MAP_SHARED)
- 匿名映射：MAP_ANONYMOUS，fd 忽略，类似 malloc 但直接向内核申请

## 共享内存 IPC
- 步骤：
  1. shm_open() 创建/打开共享内存对象
  2. ftruncate() 设置大小
  3. mmap() 映射到进程地址空间
  4. 使用后 munmap() 解除映射
  5. shm_unlink() 删除

## 常见错误
1. **忘记 munmap**：导致虚拟地址空间泄漏
2. **MAP_SHARED vs MAP_PRIVATE 混淆**：修改不生效
3. **权限不足**：mmap 失败返回 MAP_FAILED (-1)
4. **文件大小不足**：访问超出映射范围导致 SIGBUS

## strace 观察
```bash
strace -e trace=mmap,munmap,mprotect,brk ./program
```
观察每个内存操作的系统调用参数和返回值。
SIGSEGV 通常出现在 mmap 返回 MAP_FAILED 后继续使用。
""",
    },
    # ── 文件 I/O ──
    {
        "title": "文件描述符管理与泄漏检测",
        "category": "fs",
        "content": r"""
# 文件描述符管理与泄漏检测

## 文件描述符基础
- 非负整数，内核维护的打开文件表索引
- 0=stdin, 1=stdout, 2=stderr（惯例）
- 进程级限制：ulimit -n（通常 1024 或更高）

## 常见泄漏场景
1. **open 后忘记 close**：每次循环打开文件但不关闭
2. **异常路径未关闭**：错误处理中跳过了 close
3. **dup/dup2 后未关闭原始 fd**：重定向时忘记清理
4. **fork 后继承 fd**：子进程继承但未使用/关闭

## 检测方法
### strace
```bash
strace -e trace=open,openat,close,dup,dup2 -c ./program
```
-c 参数统计每个系统调用的次数：
- open 次数 > close 次数 → 泄漏
- 对比每次 open 的返回值（fd 号），看是否持续增长

### /proc 文件系统
```bash
ls -la /proc/<PID>/fd/
```
查看进程当前打开的所有文件描述符

### lsof
```bash
lsof -p <PID>
```

## 最佳实践
1. 尽早关闭不需要的 fd
2. 使用 FD_CLOEXEC 标记 exec 时自动关闭
3. 考虑使用 RAII 模式（C++）或 goto cleanup（C）
""",
    },
    {
        "title": "I/O 重定向与管道实现原理",
        "category": "fs",
        "content": r"""
# I/O 重定向与管道实现原理

## 管道 (pipe)
```c
int pipe(int pipefd[2]);
// pipefd[0] = 读端, pipefd[1] = 写端
```
- 内核缓冲区：通常 64KB (可通过 fcntl F_SETPIPE_SZ 调整)
- 读端关闭时写端收到 SIGPIPE 或 EPIPE
- 写端关闭时读端读到 EOF (read 返回 0)

## 重定向
```c
close(pipefd[0]);                    // 关闭不需要的读端
dup2(pipefd[1], STDOUT_FILENO);      // 将写端复制到 stdout
close(pipefd[1]);                    // 关闭原始写端
```
或使用 dup2 后原来的 fd 和新的 fd 指向同一文件表项。

## dup vs dup2
- dup(oldfd)：分配最小的可用 fd 指向同一文件
- dup2(oldfd, newfd)：显式指定 newfd，如果已打开先关闭
- dup3(oldfd, newfd, flags)：可设置 O_CLOEXEC

## 实现 shell 管道
```c
int fd[2];
pipe(fd);
if (fork() == 0) {
    close(fd[0]);
    dup2(fd[1], STDOUT_FILENO);
    close(fd[1]);
    execlp("ls", "ls", NULL);
}
if (fork() == 0) {
    close(fd[1]);
    dup2(fd[0], STDIN_FILENO);
    close(fd[0]);
    execlp("wc", "wc", "-l", NULL);
}
close(fd[0]);
close(fd[1]);
wait(NULL); wait(NULL);
```

## 常见错误
1. 忘记关闭管道未使用的端口 → 读端永远不会收到 EOF
2. dup2 后忘记关闭原始 fd → 多了一个不期望的 fd
3. 管道缓冲区满 → 写端阻塞
""",
    },
    # ── 处理机调度 ──
    {
        "title": "Linux CFS 调度器与调度策略对比",
        "category": "scheduler",
        "content": r"""
# Linux CFS 调度器与调度策略对比

## 调度策略
- SCHED_OTHER (CFS)：默认，完全公平调度
  - nice 值：-20（最高优先级）到 +19（最低）
- SCHED_FIFO：实时先入先出，无时间片
- SCHED_RR：实时轮转，有时间片
- SCHED_BATCH：批处理，适合 CPU 密集型
- SCHED_IDLE：仅在系统空闲时运行

## 相关系统调用
- nice()：调整 nice 值
- sched_setscheduler()：设置调度策略
- sched_setaffinity()：设置 CPU 亲和性
- sched_yield()：主动让出 CPU

## strace 观察
```bash
strace -e trace=sched_setscheduler,sched_setaffinity,sched_yield ./program
```

## 常见实验错误
1. 设置实时优先级但忘记以 root 运行（需要 CAP_SYS_NICE）
2. 实时线程死循环 → 系统无响应
3. CPU 亲和性绑定错误导致性能下降
4. 频繁 sched_yield 导致不必要的上下文切换
""",
    },
    # ── 死锁 ──
    {
        "title": "死锁四必要条件与银行家算法",
        "category": "deadlock",
        "content": r"""
# 死锁四必要条件与银行家算法

## 死锁四大必要条件（全部满足才可能死锁）
1. **互斥 (Mutual Exclusion)**：资源不可共享
2. **持有并等待 (Hold and Wait)**：持有资源的同时等待其他资源
3. **不可抢占 (No Preemption)**：资源不能被强制释放
4. **循环等待 (Circular Wait)**：存在循环的资源等待链

## 银行家算法
- 安全状态：存在一个进程序列，使得每个进程都能获得所需资源并完成
- 数据结构：Available, Max, Allocation, Need
- 每次分配前检查是否仍处于安全状态

## 死锁检测
### Wait-For Graph
- 节点 = 线程
- 有向边 A → B = 线程 A 等待线程 B 持有的资源
- 如果图中存在环 → 死锁

### strace 检测
```bash
strace -e trace=futex -o trace.log ./program
```
多个线程长时间阻塞在 FUTEX_WAIT，且互相等待 → 疑似死锁

## 预防方法
1. 固定加锁顺序：所有线程按同一顺序获取锁
2. 使用 trylock + 回退：pthread_mutex_trylock 失败时释放已有锁重试
3. 减少锁持有时间：临界区尽量小
4. 使用无锁数据结构：atomic 操作替代锁

## 调试命令
```bash
gdb -p <PID>
(gdb) thread apply all bt  # 查看所有线程栈，定位等待位置
```
""",
    },
    {
        "title": "strace 系统调用追踪实战指南",
        "category": "process",
        "content": r"""
# strace 系统调用追踪实战指南

## 基本用法
```bash
strace ./program                          # 基础追踪
strace -c ./program                       # 统计摘要
strace -e trace=open,read,write ./program # 过滤特定调用
strace -f ./program                       # 追踪子进程
strace -p <PID>                           # 附加到运行中进程
strace -t -o trace.log ./program          # 带时间戳，输出到文件
strace -k ./program                       # 显示调用栈
```

## 输出解读
```
openat(AT_FDCWD, "file.txt", O_RDONLY) = 3
│      │          │           │            └─ 返回值 (fd=3)
│      │          │           └─ 标志
│      │          └─ 路径
│      └─ 目录 fd (AT_FDCWD = 当前目录)
└─ 系统调用名
```
- 返回值 = -1 → 错误，检查 errno (如 ENOENT, EACCES)
- 返回值 ≥ 0 → 成功

## 常用过滤器
```bash
# 文件操作
strace -e trace=file ./program

# 进程管理
strace -e trace=process ./program

# 网络
strace -e trace=network ./program

# 信号
strace -e trace=signal ./program

# 内存
strace -e trace=memory ./program
```

## 常见错误信号
- ENOENT：文件不存在
- EACCES：权限不足
- ENOMEM：内存不足
- EAGAIN：资源暂时不可用（非阻塞操作）
- EBADF：无效的文件描述符（fd 已关闭或未打开）
- EPIPE：管道破裂（写端关闭后继续写）

## 教学应用
在 TraceOS Lab 中，strace 输出用于：
1. 检查系统调用序列是否符合预期
2. 检测未关闭的文件描述符 (fd leak)
3. 检测内存泄漏 (brk/mmap 增长但无对应的 munmap)
4. 检测死锁 (多个 futex FUTEX_WAIT)
5. 验证调度策略 (sched_setscheduler 参数)
""",
    },
    # ── 新增：进程间通信 IPC ──
    {
        "title": "进程间通信 (IPC) 全解：管道、FIFO、消息队列、共享内存、信号量",
        "category": "ipc",
        "content": r"""
# 进程间通信 (IPC) 全解

## 管道 (Pipe)
- pipe(int fd[2]): 半双工，父子/兄弟进程间通信
- 无名管道：仅限父子进程，使用 pipe() 系统调用
- 命名管道 (FIFO)：mkfifo(path, mode)，无亲缘关系的进程也可通信

## 消息队列 (Message Queue)
- POSIX: mq_open, mq_send, mq_receive, mq_close, mq_unlink
- System V: msgget, msgsnd, msgrcv, msgctl
- 特点：按消息类型优先级投递，支持异步通信

## 共享内存 (Shared Memory)
- POSIX: shm_open + mmap，效率最高（零拷贝通信）
- System V: shmget, shmat, shmdt, shmctl
- 必须配合同步机制（信号量或互斥锁）
- 注意 SIZE 足够大，否则 SIGBUS

## 信号量 (Semaphore)
- POSIX 命名信号量：sem_open, sem_wait, sem_post, sem_close, sem_unlink
- 无名信号量（线程间）：sem_init, sem_destroy
- 值>0 表示可用资源数，值=0 表示无可用资源

## 套接字 (Socket)
- socketpair()：创建双向通信的 socket 对
- Unix Domain Socket：AF_UNIX, 本地进程通信，比 TCP 快
- 支持 SOCK_STREAM（流式）和 SOCK_DGRAM（数据报）

## 选择 IPC 方法指南
| 需求 | 推荐方法 | 原因 |
| 简单数据传递 | 管道/FIFO | 简单，内核支持 |
| 大量数据共享 | 共享内存 | 零拷贝，最快 |
| 异步通知 | 信号 | 轻量级 |
| 复杂消息 | 消息队列 | 支持优先级 |
| 网络通信 | Socket | 跨主机 |

调试：strace -e trace=pipe,shmget,shmat,msgget,msgsnd ./program
""",
    },
    {
        "title": "虚拟内存深度解析：页表、TLB、缺页异常",
        "category": "memory",
        "content": r"""
# 虚拟内存深度解析

## 核心概念
虚拟内存让每个进程拥有独立的地址空间，不受物理内存大小和布局的限制。
- MMU (Memory Management Unit)：硬件，负责虚拟地址到物理地址的转换
- 页表 (Page Table)：内核维护的数据结构，存储虚拟页→物理页映射

## 多级页表
- x86-64 使用 4 级页表：PGD → P4D → PMD → PTE
- 每页大小：4KB（标准）/ 2MB（大页）/ 1GB（巨页）
- 大页 (Huge Pages)：减少 TLB miss，提高性能
- /proc/<pid>/smaps：查看进程内存映射详情

## TLB (Translation Lookaside Buffer)
- 缓存最近使用的虚拟→物理地址映射
- TLB miss：硬件遍历页表，代价高（数百 CPU 周期）
- 上下文切换刷新 TLB → 性能开销
- PCID (Process Context IDentifier)：避免全量刷新 TLB

## 缺页异常 (Page Fault)
- Minor Fault：页在内存但未建立映射（如 COW 页）
- Major Fault：页不在内存，需从磁盘读取
- Invalid Fault：访问非法地址 → SIGSEGV
- /usr/bin/time -v ./program 查看 major/minor page faults

## 页回收 (Page Reclaim)
- kswapd：内核线程，内存不足时回收页
- LRU 算法：最近最少使用的页优先回收
- OOM Killer：内存耗尽时杀死进程
- vm.swappiness（0-100）：控制 swap 倾向

## 常见错误
1. mmap FAILED 后继续使用 → SIGSEGV
2. 栈溢出 → 访问 guard page 产生 SIGSEGV
3. 大数组在栈上分配 → 栈溢出
4. malloc 返回 NULL 不检查 → 后续访问 SIGSEGV
5. 忘记 munmap → 虚拟地址空间泄漏

调试：cat /proc/<pid>/maps | head -20
""",
    },
    {
        "title": "Linux 内核参数调优与性能分析(tuning)",
        "category": "scheduler",
        "content": r"""
# Linux 内核参数调优与性能分析

## /proc/sys 内核参数
- /proc/sys/kernel/pid_max：最大 PID 值（默认 32768，可调至 4194304）
- /proc/sys/kernel/threads-max：系统最大线程数
- /proc/sys/vm/swappiness：控制 swap 倾向（0-100）
- /proc/sys/vm/overcommit_memory：内存过度分配策略
  - 0: 启发式（默认）
  - 1: 始终过度分配
  - 2: 严格限制

## ulimit 资源限制
- ulimit -n: 最大文件描述符数（默认 1024）
- ulimit -u: 最大进程数 (RLIMIT_NPROC)
- ulimit -s: 栈大小（默认 8192KB）
- ulimit -c: core dump 文件大小
- getrlimit/setrlimit 系统调用可在程序中查询/设置

## 进程优先级与调度
- nice 范围：-20（最高优先级）到 19（最低优先级）
- 实时优先级 (SCHED_FIFO/RR)：1-99，数值越大优先级越高
- /proc/<pid>/sched：查看进程调度信息
- chrt 命令设置实时调度策略：chrt -f -p 50 <pid>
- 实时任务卡死可能导致系统无响应！

## 性能分析工具链
- perf：CPU 性能分析 (perf top, perf record, perf report)
- perf stat -e page-faults,context-switches,cpu-migrations ./program
- vmstat 1：实时查看系统内存和 I/O
- pidstat -p <pid> 1：逐秒查看进程统计
- /proc/<pid>/status：查看进程详细状态（包含 VmPeak, VmSize, Threads）

## strace 性能统计
- strace -c ./program：统计每个系统调用的次数、时间和错误
- strace -T：显示每个系统调用的耗时
- strace -e trace=read,write -T -c：分析读写性能

## 常见实验问题
1. fork() 失败返回 EAGAIN → 达进程数上限，检查 ulimit -u
2. mmap() 失败返回 ENOMEM → 虚拟地址空间不足或过度分配限制
3. pthread_create 失败返回 EAGAIN → 检查 threads-max 和 ulimit
4. open() 失败返回 EMFILE → 文件描述符达到上限
""",
    },
    {
        "title": "信号处理进阶：可靠信号、实时信号与 signalfd",
        "category": "process",
        "content": r"""
# 信号处理进阶

## 不可靠信号 vs 可靠信号
- 不可靠（标准信号）：1-31 (SIGHUP~SIGSYS)
  - 信号可能丢失：多个同类型信号到达时只投递一次
  - 不排队，无发送者信息
- 可靠（实时信号）：SIGRTMIN(34) ~ SIGRTMAX(64)
  - 信号排队：每个信号都投递
  - 携带附加数据：sigqueue() 可发送 sigval 联合体
  - sigaction + SA_SIGINFO：获取发送者 PID/UID 和附加数据

## sigaction vs signal()
- sigaction 是 signal 的超集，提供更多控制：
  - SA_SIGINFO：使用三参数处理函数 (int, siginfo_t*, void*)
  - SA_RESTART：自动重启被中断的系统调用
  - SA_NODEFER：处理信号时不自动屏蔽同类信号
  - SA_RESETHAND：执行一次后恢复默认处理
- signal() 行为在不同 UNIX 变体中不一致，应优先使用 sigaction

## 信号集操作
- sigemptyset/sigfillset：初始化信号集
- sigaddset/sigdelset：添加/删除信号
- sigprocmask：设置进程信号屏蔽字
- sigpending：查询未决信号集合

## signalfd
- Linux 特有，将信号以文件描述符形式读取
- signalfd = signalfd(-1, &mask, SFD_NONBLOCK)
- read(signalfd, &info, sizeof(info))：读取 signal 信息
- 可与 select/poll/epoll 集成，实现事件驱动风格信号处理

## 异步信号安全函数
信号处理器中只能安全调用 async-signal-safe 函数：
- 安全：write, read, close, dup2, _exit, signal, sigprocmask
- 不安全：printf, malloc, free, fopen, pthread_mutex_lock
- 使用 man 7 signal-safety 查看完整列表

## 常见错误
1. 在信号处理器中使用 printf → 可能导致死锁
2. 信号处理器中修改全局变量忘记声明 volatile sig_atomic_t
3. SIGKILL 和 SIGSTOP 无法被捕获/忽略
4. fork 后信号处理继承：子进程保留信号处理器但未决信号被清除
""",
    },
    {
        "title": "gdb 调试实战：栈帧、断点、多线程与 core dump",
        "category": "tools",
        "content": r"""
# gdb 调试实战

## 编译准备
- 必须加 -g 标志：gcc -g -O0 -o program program.c
- -O0 关闭优化（推荐调试时使用）避免变量被优化掉

## 基础命令
- gdb ./program：启动调试
- run (r)：运行程序（可带参数）
- break (b)：设置断点 b main, b source.c:42, b function_name
- continue (c)：继续运行到下一个断点
- step (s)：单步执行（进入函数）
- next (n)：单步跳过（不进入函数）
- finish：执行到当前函数返回
- print (p)：打印变量 p var, p *ptr, p/x var（十六进制）
- display：每次停止时自动显示变量
- watch：监控变量变化 watch var

## 栈帧检查
- backtrace (bt)：查看调用栈
- bt full：查看调用栈及其局部变量
- frame (f) N：切换到第 N 帧
- info locals：当前帧局部变量
- info args：当前帧参数

## 断点管理
- info breakpoints：查看所有断点
- disable/enable N：禁用/启用第 N 个断点
- delete N：删除断点
- condition N expression：条件断点
- commands N → ... end：断点触发后执行命令序列

## 多线程调试
- info threads：查看所有线程
- thread N：切换到第 N 个线程
- thread apply all bt：所有线程的调用栈
- thread apply 2-4 bt：第 2 到 4 号线程的调用栈
- break func thread 3：仅在特定线程触发断点
- set scheduler-locking on：单步时只运行当前线程

## Core Dump 分析
```bash
ulimit -c unlimited          # 允许生成 core
echo "core.%p" > /proc/sys/kernel/core_pattern
gdb ./program core.12345     # 分析 core dump
(gdb) bt                    # 查看崩溃时的调用栈
```
- Core dump 包含崩溃时的内存快照：寄存器、堆栈、变量值

## 检查死锁
```bash
gdb -p <PID>
(gdb) thread apply all bt   # 查看所有线程等待位置
```
多个线程在 pthread_mutex_lock 或 futex_wait → 疑似死锁

## 常用快捷操作
- Ctrl+L：清屏
- Enter：重复上一条命令
- set print pretty on：美化输出结构体
""",
    },
]

# ═══════════════════════════════════════════════════════════════════════
# 主流程
# ═══════════════════════════════════════════════════════════════════════

async def main():
    async with httpx.AsyncClient(timeout=60) as client:
        # 1. 登录
        print("=" * 60)
        print("🔑 登录中...")
        resp = await client.post(LOGIN_URL, json={
            "username": USERNAME,
            "password": PASSWORD,
        })
        resp.raise_for_status()
        token = resp.json()["access_token"]
        print(f"✅ 登录成功 (admin)")

        headers = {"Authorization": f"Bearer {token}"}

        # 2. 获取课程 ID
        print("\n📚 获取课程列表...")
        resp = await client.get(f"{API_BASE}/api/v1/courses", headers=headers)
        courses = resp.json()["data"]
        if not courses:
            print("❌ 没有找到课程，请先创建课程")
            return
        course_id = courses[0]["id"]
        print(f"✅ 使用课程: {courses[0]['name']} ({course_id})")

        paste_url = PASTE_URL.format(course_id=course_id)
        entries_url = ENTRIES_URL.format(course_id=course_id)
        approve_url_tpl = APPROVE_URL.format(course_id=course_id, entry_id="{entry_id}")

        # 3. 检查已有知识条目
        resp = await client.get(entries_url, headers=headers)
        existing = resp.json()
        existing_titles = {e["title"] for e in existing if isinstance(e, dict)}
        print(f"\n📋 现有知识条目: {len(existing)} 条")

        # 4. 导入知识
        imported = 0
        skipped = 0
        approved = 0
        entry_ids = []

        for i, entry in enumerate(KNOWLEDGE_ENTRIES, 1):
            if entry["title"] in existing_titles:
                print(f"  ⏭️  跳过 (已存在): {entry['title']}")
                skipped += 1
                continue

            print(f"  📝 [{i}/{len(KNOWLEDGE_ENTRIES)}] 导入: {entry['title']}...", end=" ")
            try:
                resp = await client.post(paste_url, json={
                    "title": entry["title"],
                    "content": entry["content"],
                }, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    entry_id = data.get("entry_id") or data.get("id", "")
                    entry_ids.append(entry_id)
                    imported += 1
                    print(f"✅ (entry_id={entry_id[:8]}...)")

                    # 教师/管理员自动审批
                    if entry_id:
                        try:
                            approve_url = approve_url_tpl.format(entry_id=entry_id)
                            await client.post(approve_url, headers=headers)
                            approved += 1
                        except Exception:
                            pass  # 审批非关键
                else:
                    print(f"⚠️ HTTP {resp.status_code}: {resp.text[:100]}")
            except Exception as e:
                print(f"❌ 失败: {e}")

        # 5. 检查最终状态
        resp = await client.get(entries_url, headers=headers)
        final = resp.json()
        approved_count = sum(1 for e in final if isinstance(e, dict) and e.get("status") == "approved")

        print(f"\n{'=' * 60}")
        print(f"📊 导入完成")
        print(f"  新增: {imported} 条")
        print(f"  跳过: {skipped} 条")
        print(f"  已审批: {approved_count} 条")
        print(f"  总计: {len(final)} 条")

        # 6. 快速验证搜索
        print(f"\n🔍 快速搜索验证...")
        search_url = SEARCH_URL.format(course_id=course_id)
        test_queries = ["fork 返回值", "死锁 条件", "文件描述符 泄漏", "mmap 用法"]
        for q in test_queries:
            try:
                resp = await client.get(search_url, params={"query": q})
                if resp.status_code == 200:
                    data = resp.json()
                    n = len(data.get("results", [])) if isinstance(data, dict) else 0
                    print(f"  '{q}' → {n} 条结果")
                else:
                    print(f"  '{q}' → ⚠️ HTTP {resp.status_code}")
            except Exception as e:
                print(f"  '{q}' → ❌ {e}")

        print(f"\n✨ 完成！RAG 知识库已就绪，可以测试搜索功能。")


if __name__ == "__main__":
    asyncio.run(main())
