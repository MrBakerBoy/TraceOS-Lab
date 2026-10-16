"""Insert OS knowledge base seed data for RAG testing."""
import asyncio, json, sys, os
sys.path.insert(0, '/app')
from app.db.knowledge_repo import knowledge_repo
from app.db.connection import get_pool, init_db

COURSE_ID = "5fdf8081-5565-406c-a52a-499d7aa6db8f"
USER_ID = "00000000-0000-0000-0000-000000000001"

OS_KNOWLEDGE = [
    {
        "title": "进程管理 - Process Management",
        "content": """进程是操作系统中最基本的资源分配单元。每个进程拥有独立的地址空间、文件描述符表和信号处理器。
关键概念：
- PCB（进程控制块）：内核维护的数据结构，包含进程状态、PID、寄存器上下文、内存映射等
- 进程状态：就绪(Ready)、运行(Running)、阻塞(Blocked)、终止(Terminated)
- fork()系统调用：创建子进程，子进程复制父进程地址空间（COW优化）
- exec()系列：加载新程序替换当前进程映像
- wait()/waitpid()：父进程等待子进程结束，获取退出状态
- 孤儿进程与僵尸进程：父进程先于子进程退出 vs 子进程退出但父进程未回收
常见错误：忘记调用wait()导致僵尸进程；fork()后父子进程共享文件描述符可能导致竞争条件"""
    },
    {
        "title": "内存管理 - Memory Management",
        "content": """操作系统内存管理的核心是为每个进程提供独立、受保护的虚拟地址空间。
关键概念：
- 虚拟内存：每个进程有独立的虚拟地址空间，通过页表映射到物理内存
- 分页(Paging)：固定大小的内存块（通常4KB），通过页表实现地址转换
- 分段(Segmentation)：按逻辑段划分内存，如代码段、数据段、栈段
- malloc/free：C标准库的堆内存分配，底层通过brk()或mmap()系统调用实现
- brk()：调整程序断点（program break），改变数据段大小
- mmap()：映射文件或匿名内存到进程地址空间
- 内存泄漏：分配后未释放的内存，导致进程内存持续增长
- SIGSEGV：访问无效内存地址时产生的段错误信号
常见错误：malloc/free不配对导致内存泄漏；野指针访问已释放的内存；栈溢出；双重释放(double free)"""
    },
    {
        "title": "文件I/O - File I/O",
        "content": """文件I/O是操作系统提供的核心服务之一，进程通过文件描述符访问文件和设备。
关键概念：
- 文件描述符(File Descriptor)：非负整数，标识打开的文件或设备
- open()：打开文件，返回文件描述符。标志：O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_TRUNC
- read()/write()：从文件描述符读取/写入数据
- close()：关闭文件描述符，释放内核资源
- lseek()：移动文件偏移量
- 标准文件描述符：0(stdin), 1(stdout), 2(stderr)
- 文件权限：rwx（读/写/执行），用八进制表示（如0644）
- dup()/dup2()：复制文件描述符
- 缓冲区：用户态缓冲（FILE*）vs 内核态缓冲（page cache）
常见错误：忘记close()导致文件描述符泄漏；使用未初始化的文件描述符；open()失败未检查返回值"""
    },
    {
        "title": "线程与同步 - Threads and Synchronization",
        "content": """线程是CPU调度的基本单位，同一进程的线程共享地址空间和文件描述符表。
关键概念：
- 线程 vs 进程：线程共享地址空间，进程独立地址空间
- pthread_create()：创建新线程
- pthread_join()：等待线程结束
- 临界区(Critical Section)：访问共享资源的代码段
- 互斥锁(Mutex)：保证同一时间只有一个线程访问临界区
- 条件变量(Condition Variable)：线程等待某个条件成立的同步机制
- 信号量(Semaphore)：计数器，控制对共享资源的访问数量
- 死锁(Deadlock)：两个或多个线程互相等待对方释放资源
- 死锁四个必要条件：互斥、持有并等待、不可抢占、循环等待
常见错误：忘记unlock导致死锁；共享变量未加锁导致竞态条件；锁粒度不当影响性能"""
    },
    {
        "title": "死锁 - Deadlock",
        "content": """死锁是多线程/多进程编程中最危险的并发问题之一。
关键概念：
- 定义：两个或多个线程无限期地互相等待对方持有的资源
- Coffman条件（四个必要条件）：
  1. 互斥(Mutual Exclusion)：资源不能被共享
  2. 持有并等待(Hold and Wait)：持有资源的同时等待其他资源
  3. 不可抢占(No Preemption)：资源不能被强制释放
  4. 循环等待(Circular Wait)：存在进程-资源的循环等待链
- 死锁预防：破坏四个必要条件之一
- 死锁避免：银行家算法(Banker's Algorithm)
- 死锁检测：资源分配图，检测循环
- 死锁恢复：终止进程或抢占资源
常见错误：嵌套加锁顺序不一致（线程A: lock(m1)->lock(m2)，线程B: lock(m2)->lock(m1)）"""
    },
    {
        "title": "信号处理 - Signal Handling",
        "content": """信号是UNIX/Linux系统中进程间异步通信的基本机制。
关键概念：
- 信号类型：SIGINT(中断), SIGSEGV(段错误), SIGKILL(强制终止), SIGTERM(终止), SIGCHLD(子进程状态变化)
- signal()/sigaction()：注册信号处理器
- 信号处理器限制：应使用异步信号安全函数（如write()而非printf()）
- 信号屏蔽：sigprocmask()阻塞/解除阻塞信号
- 信号发送：kill()向进程发送信号，raise()向自身发送信号
- SIGSEGV处理：可以捕获段错误但通常不能完全恢复
- SIGCHLD：子进程退出时父进程收到的信号，可用于避免僵尸进程
常见错误：在信号处理器中使用非异步安全的函数；忘记恢复信号处理器"""
    },
    {
        "title": "CPU调度 - CPU Scheduling",
        "content": """CPU调度决定了哪个进程/线程在CPU上运行，是操作系统性能的关键。
关键概念：
- 调度算法：
  - FCFS(先来先服务)：简单但可能导致护航效应
  - SJF(最短作业优先)：最优平均等待时间但需要预知执行时间
  - RR(时间片轮转)：公平但时间片选择影响性能
  - 优先级调度：高优先级先运行，可能导致饥饿
  - 多级反馈队列：综合多种策略，现代OS常用
- 上下文切换：保存/恢复进程状态的开销
- 抢占式 vs 非抢占式调度
- nice值：影响进程优先级（-20到19，越低优先级越高）
- CFS(完全公平调度器)：Linux 2.6+使用的调度器
常见问题：优先级反转；调度延迟导致实时任务错过截止时间"""
    },
    {
        "title": "strace系统调用追踪",
        "content": """strace是Linux下强大的系统调用追踪工具，用于调试和诊断程序行为。
关键概念：
- strace <command>：追踪命令的所有系统调用
- strace -p <pid>：追踪运行中的进程
- strace -e trace=<syscall>：只追踪特定系统调用（如-e trace=open,read,write）
- strace -c：统计系统调用次数和时间
- strace -tt：显示微秒级时间戳
- 输出格式：syscall(args) = return_value
- 错误返回：syscall(args) = -1 EERROR (错误描述)
- 常见追踪场景：
  - 文件操作：open, read, write, close, lseek
  - 进程管理：fork, execve, wait4, exit_group
  - 内存管理：brk, mmap, munmap, mprotect
  - 信号：rt_sigaction, kill, tgkill
  - 同步：futex
常见诊断用例：-1 ENOENT表示文件不存在；-1 EACCES表示权限不足；-1 ENOMEM表示内存不足"""
    },
    {
        "title": "编译错误调试指南",
        "content": """C语言编译错误是学习操作系统编程中的常见障碍。理解编译器错误信息是成为合格系统程序员的基础。
常见编译错误类型：
1. 语法错误(Syntax Error)：
   - 缺少分号(expected ';' before...)
   - 括号不匹配
   - 拼写错误的关键字或函数名
2. 未声明标识符(Undeclared Identifier)：
   - 忘记#include头文件
   - 函数使用前未声明或定义
   - 变量名拼写错误
3. 类型错误(Type Error)：
   - 指针与整数混用
   - 赋值类型不兼容
   - 函数参数类型不匹配
4. 链接错误(Linker Error)：
   - undefined reference to 'function'
   - 忘记链接库（-lpthread, -lm）
   - 多个定义(multiple definition)
5. 段错误(Segmentation Fault)运行时错误：
   - NULL指针解引用
   - 访问已释放的内存
   - 数组越界
   - 栈溢出
调试方法：使用gdb调试器；valgrind检测内存错误；编译时加-Wall -Wextra获取更多警告"""
    },
] * 3  # Triplicate for more search results

async def seed():
    await init_db()
    print("DB initialized, inserting knowledge entries...")
    
    for item in OS_KNOWLEDGE:
        entry_id = await knowledge_repo.create_entry(
            course_id=COURSE_ID,
            title=item["title"],
            source_type="file",
            submitted_by=USER_ID,
            content_raw=item["content"],
            status="approved"
        )
        # Create chunks (simple: one chunk = full content)
        await knowledge_repo.insert_chunks(entry_id, [{
            "index": 0,
            "content": item["content"],
            "embedding": None,  # Will be vectorized later
            "metadata": {"source": "seed_data"}
        }])
        print(f"  Inserted: {item['title']}")
    
    print(f"Done! Inserted {len(OS_KNOWLEDGE)} entries.")

    # Test BM25 search
    print("\nTesting BM25 search for 'deadlock'...")
    results = await knowledge_repo.search_by_text(COURSE_ID, "deadlock", 5)
    print(f"  Found {len(results)} results:")
    for r in results[:3]:
        print(f"    - {r['title']} (score: {r.get('score', 0):.2f})")

if __name__ == "__main__":
    asyncio.run(seed())
