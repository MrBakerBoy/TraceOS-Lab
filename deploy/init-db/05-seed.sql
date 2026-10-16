-- TraceOS Lab 实验题库 v2
-- 31 experiments, 6 categories

INSERT INTO users (username, email, password_hash, full_name, role, is_active)
VALUES ('admin', 'admin@traceos.lab', '$2b$12$/HR/Lj17cWR0bTdevusPg.YPxMx5naWf/J96e011rZwy9t6vdErcO', '管理员', 'admin', true)
ON CONFLICT (username) DO NOTHING;

INSERT INTO courses (code, name, description, is_published)
VALUES ('OS101', '操作系统原理', '31个实验覆盖进程/线程/内存/文件IO/调度/死锁六大核心场景', true)
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE os101_id UUID; exp_id UUID;
BEGIN
SELECT id INTO os101_id FROM courses WHERE code='OS101' LIMIT 1;
IF os101_id IS NOT NULL THEN
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'process','lab1_fork_basic','进程创建与父子关系','使用fork()创建子进程，理解PID、PPID和进程关系','编写程序：使用fork()创建一个子进程。父进程输出Parent: PID=xxx, Child PID=yyy，子进程输出Child: PID=xxx, PPID=yyy。注意：输出顺序不做要求（父/子谁先输出均可）。','','','easy',10,67108864,1,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'process','lab2_fork_tree','进程树与进程层次结构','创建一个三级进程树，理解fork/fork的关系','编写程序创建三级进程树：根进程fork出2个子进程，每个子进程再fork出2个孙进程。每个进程需输出Level X: PID=xxx, PPID=yyy，Level 0为根进程。每层父进程必须用waitpid等待所有子进程结束。','','','medium',10,67108864,1,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'process','lab3_exec_ls','exec系列函数：进程替换','使用execl/execvp替换子进程映像','编写程序：父进程fork子进程，子进程使用execvp执行ls -l命令列出当前目录。要求：如果execvp失败，子进程必须输出Exec failed并exit(1)。父进程用waitpid等待子进程并检查退出状态。','','','easy',10,67108864,1,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'process','lab4_pipe_ipc','管道通信：父子进程双向管道','使用pipe()实现父子进程双向数据传递','编写程序：创建两条管道，实现父子进程双向通信。父进程通过pipe1发送MSG from parent给子进程，子进程接收后通过pipe2发送MSG from child给父进程。各自收到消息后输出[Parent/Child] received: xxx。要求关闭不再使用的管道端。','','','medium',10,67108864,1,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'process','lab5_signal_handler','信号处理：SIGINT/SIGUSR1捕获','注册信号处理器，理解信号的异步通信机制','编写程序：注册SIGINT和SIGUSR1的处理器。收到SIGINT时输出SIGINT received并继续运行（不退出），连续收到3次SIGINT才退出。收到SIGUSR1时输出SIGUSR1 received count=N（N为累计次数）。主循环使用pause()等待信号。','','','medium',10,67108864,1,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'process','lab6_zombie_orphan','僵尸进程与孤儿进程','演示并理解僵尸进程产生原因及wait回收机制，孤儿进程被init收养','编写程序：父进程fork子进程。子进程立即exit(0)，父进程sleep(1)后用waitpid回收。同时输出回收信息Zombie reaped: PID=xxx。然后创建孤儿进程场景：子进程sleep(2)，父进程立即exit(0)。子进程醒来后输出My PID=xxx, new PPID=yyy显示被init接管。','','','medium',10,67108864,1,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'process','lab7_daemon_process','守护进程实现','理解守护进程原理，实现daemonize并定时写入日志','写一个daemonize函数：fork+setsid+chdir / +重定向stdin/stdout/stderr到/dev/null。主进程daemonize后，每2秒向/tmp/traceos_daemon.log写入一条带时间戳的日志[HH:MM:SS] Daemon heartbeat，共写入5次后退出。要求父进程在子进程daemonize成功后输出Daemon started: PID=xxx。','','','hard',10,67108864,1,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'thread','lab8_producer_consumer','生产者-消费者问题','使用pthread_mutex+条件变量实现经典生产者-消费者','编写程序：创建2个生产者线程和2个消费者线程，共享一个容量为5的环形缓冲区。生产者向缓冲区放入递增的数据项1-20，消费者取出并打印Consumed: N。使用mutex+条件变量同步，确保不会溢出或读取空缓冲区。所有线程结束后输出All items processed。','','','medium',10,67108864,2,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'thread','lab9_reader_writer','读者-写者问题','用读写锁实现读者优先策略','编写程序模拟读者-写者问题：5个读者线程和2个写者线程共享一个计数器。读者输出Reader N reads: X，写者输出Writer N writes: X -> Y。要求：(1)多个读者可同时读，(2)写者写入时没有其他读者或写者。(3)读者优先：有读者在读时新读者可进入，写者等待。所有线程完成50次操作后输出All done。','','','hard',10,67108864,2,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'thread','lab10_threadpool','线程池实现','实现一个固定大小的线程池，包含任务队列和优雅关闭','实现一个包含4个工作线程的线程池。提供threadpool_submit(task_id)接口添加任务（共提交10个任务），每个任务执行sleep(1)模拟工作并输出Task N done。所有任务完成后调用threadpool_destroy优雅关闭线程池，每个线程退出前输出Worker N exiting。','','','hard',10,67108864,2,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'thread','lab11_barrier_sync','线程屏障同步','使用pthread_barrier实现阶段性同步','创建4个线程，每个线程执行3个阶段的工作。每阶段开始前所有线程必须先到达屏障(barrier)再同时开始。每个线程阶段N开始前输出Thread T entering phase N，通过屏障后输出Thread T phase N done。要求使用pthread_barrier_init/wait/destroy。最终输出All phases complete。','','','medium',10,67108864,2,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'thread','lab12_spinlock_vs_mutex','自旋锁与互斥锁性能对比','实现自旋锁，测量对比与互斥锁在不同竞争强度下的性能','使用pthread_spinlock和pthread_mutex对共享计数器加1千万次。创建1/2/4/8个线程分别测试。每个线程加锁前记录时间，解锁后计算耗时。输出格式Threads=N, SpinLock=XXXms, Mutex=XXXms。使用原子操作模拟自旋锁。最终输出Benchmark complete。','','','medium',10,67108864,2,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'thread','lab13_tls','线程局部存储 (TLS)','使用__thread关键字理解线程局部存储','创建3个线程，每个线程都有一个__thread变量计数器。每个线程循环100次，每次自增TLS计数器并mutext保护输出Thread N: count=M。所有线程结束后，主线程输出All threads: count=100 each。理解TLS变量每个线程独立。','','','easy',10,67108864,2,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'memory','lab14_malloc_impl','malloc/free 简单实现','基于sbrk实现first-fit内存分配器','编写一个简单的内存分配器 my_malloc(size) 和 my_free(ptr)。要求：1. 使用sbrk()扩展堆空间 2. 每个内存块有8字节头部 3. my_malloc使用first-fit算法搜索空闲块 4. my_free合并相邻空闲块 5. 测试：分配16/32/64/128/256字节，全部释放，再分配384字节验证合并 6. 输出Allocated/Freed信息，最终输出Realloc test passed。','','','hard',10,134217728,2,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'memory','lab15_best_fit','内存分配策略对比：first-fit vs best-fit','实现并比较两种内存分配策略的碎片率','在lab14基础上实现first-fit和best-fit。测试场景：分配A=64B B=128B C=32B D=256B，释放B D，分配E=100B F=200B。分别用两种策略运行，输出每次分配/释放的地址。最终输出碎片率：Fragmentation: first-fit=X%, best-fit=Y%。','','','medium',10,134217728,2,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'memory','lab16_page_table','多级页表模拟','模拟两级页表实现虚拟地址到物理地址翻译','模拟两级页表地址翻译（32位地址空间，4KB页面）: 虚拟地址格式 [10bit PD][10bit PT][12bit offset]。实现translate_vaddr和map_page。测试：映射5个页面并翻译，访问未映射地址输出Page fault at VADDR，最终输出All page table tests passed。','','','medium',10,134217728,2,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'memory','lab17_mem_leak','内存泄漏检测工具','实现简单的内存分配跟踪器，检测泄漏','实现带跟踪功能的内存分配器 proxy_malloc/proxy_free：维护分配记录链表。check_leaks()输出未释放的记录。测试：分配3个块，释放其中1个，调用check_leaks检查。要求使用__FILE__和__LINE__宏记录调用位置。','','','easy',10,134217728,2,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'memory','lab18_seg_fault','段错误与SIGSEGV信号处理','通过信号处理器捕获段错误理解内存保护机制','注册SIGSEGV信号处理器。实现4种内存访问场景：NULL解引用、写入只读内存、mprotect保护页写入。捕获SIGSEGV输出对应信息。所有测试完成后输出All SIGSEGV tests complete。','','','easy',10,134217728,2,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'fs','lab19_file_cp','文件复制：缓冲与非缓冲I/O对比','实现cp命令，对比不同缓冲区大小的性能','实现文件复制程序。使用open/read/write系统调用。测试4种缓冲区大小: 1B, 128B, 4096B, 65536B。分别复制同一个1MB测试文件。输出各缓冲区的耗时。最终输出Copy tests complete。','','','easy',10,67108864,1,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'fs','lab20_dir_ls','目录遍历模拟 ls -lR','递归遍历目录并显示文件属性，理解inode和目录项','实现递归目录遍历程序。使用opendir/readdir遍历目录，stat/lstat获取文件属性。输出格式: [D] dirname/ (inode=N) [F] filename (size=N, inode=N, perms=rwxrwxrwx)。最终输出Total: N files, M directories。','','','medium',10,67108864,1,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'fs','lab21_mmap_read','mmap文件映射读写','使用mmap将文件映射到内存进行读写','使用mmap实现文件读写：创建文件写入测试内容，mmap映射后通过内存直接修改，msync同步。重新mmap读取验证修改。输出mmap test passed。要求使用PROT_READ|PROT_WRITE和MAP_SHARED。','','','medium',10,67108864,1,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'fs','lab22_fsync_test','文件系统持久化：fsync与O_SYNC','理解文件系统缓存、fsync和O_SYNC的数据持久化语义','对比三种写入方式：普通write、write+fsync、O_SYNC。每种方式写入1000行Line N到文件。测量每种方式的耗时并输出。最终输出fsync benchmark complete。','','','medium',10,67108864,1,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'fs','lab23_tee','I/O多路复用：tee程序','实现tee命令：从stdin读取同时写入stdout和文件','实现类似Linux tee命令的程序。使用select/poll实现I/O多路复用。从stdin读取数据同时写入stdout和指定文件。支持-a追加模式。支持SIGINT信号捕获。最终输出Copied N bytes total。要求正确处理partial write。','','','hard',10,67108864,1,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'scheduler','lab24_sched_sim','调度算法模拟：FCFS/SJF/RR/Priority','模拟4种经典调度算法并计算平均等待时间和平均周转时间','实现调度算法模拟器，支持FCFS/SJF(非抢占)/RR(时间片=2)/Priority(非抢占)4种算法。输入进程: P1(0,8,2) P2(1,4,1) P3(2,9,3) P4(3,5,2)。输出每种算法的平均等待和周转时间。最终输出Scheduler simulation complete。','','','medium',30,67108864,3,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'scheduler','lab25_mlfq','多级反馈队列调度','模拟3级反馈队列调度算法，理解MLFQ规则','实现3级MLFQ调度：Q0时间片=2, Q1时间片=4, Q2时间片=8(FCFS)。用完时间片降级，每10单位优先级提升。输入P1(0,12) P2(2,6) P3(4,4) P4(8,8)。输出每个时间单位的调度进程。统计MLFQ: avg wait=X, Priority boosts: N。','','','hard',30,67108864,3,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'scheduler','lab26_real_time','实时调度：EDF与RMS','实现EDF和RMS实时调度算法，验证可调度性','实现RMS和EDF实时调度算法。输入周期任务: T1(4,1) T2(5,2) T3(20,5)。验证可调度性：RMS用Liu-Layland bound，EDF用利用率<=100%。如果可调度模拟20个时间单位。最终输出Real-time scheduling analysis complete。','','','hard',30,67108864,3,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'scheduler','lab27_cfs_sim','CFS (完全公平调度) 模拟','模拟Linux CFS的vruntime机制和红黑树调度','模拟Linux CFS调度器：维护vruntime，vruntime = 实际时间 * (1024/weight)。nice映射权重。输入P5(0,30) P6(5,20) P7(-5,25) P8(0,15)。每次选vruntime最小的进程运行1ms。统计完成时间和nice公平性。最终输出CFS fairness统计。','','','hard',30,67108864,3,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'scheduler','lab28_lottery','彩票调度算法','实现比例分享(lottery scheduling)调度算法','实现彩票调度算法：PA=50 tickets, PB=30, PC=20。运行100个周期，随机选进程。输出每个进程被调度的次数和比例。统计Expected vs Actual对比。','','','easy',30,67108864,3,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'deadlock','lab29_banker','银行家算法','实现银行家算法进行死锁避免和安全性检测','实现银行家算法：系统资源 A=10 B=5 C=7。5个进程(给定Max和Alloc矩阵)。实现is_safe_state()。输出安全序列。测试P1请求(1,0,2)应批准，P4请求(3,3,0)应拒绝。最终输出Bankers algorithm test complete。','','','medium',180,67108864,3,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'deadlock','lab30_deadlock_detect','死锁检测：资源分配图算法','实现基于资源分配图的死锁检测算法','实现资源分配图死锁检测：构建等待图，使用DFS检测环。输入5个进程的持有边和等待边。检测死锁输出Deadlock detected: P0 -> P1 -> P2 -> P0。释放资源后验证死锁解除输出No deadlock detected。','','','medium',180,67108864,3,100,true,NULL) ON CONFLICT (name) DO NOTHING;
INSERT INTO experiments (course_id,category,name,title,description,instructions,starter_code,reference_solution,difficulty,time_limit,memory_limit,sandbox_level,max_submissions,is_published,created_by) VALUES (os101_id,'deadlock','lab31_deadlock_avoid','死锁预防：资源有序分配','实现资源有序分配策略预防死锁，对比无序分配的死锁风险','对比无序分配和有序分配：创建4个线程，共享3个资源R0,R1,R2。场景A无序: T0 lock(R0)->R1, T1 lock(R1)->R0。场景B有序: T0 lock(R0)->R1, T1 lock(R0)->R1。使用pthread_mutex+trylock超时检测死锁。输出有序和无序的结果。','','','easy',180,67108864,3,100,true,NULL) ON CONFLICT (name) DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab1_fork_basic' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'父子进程均被创建'',core','','Parent: PID=',true,20,1),
(exp_id,'子进程输出子进程信息'',core','','Child: PID=',true,20,2),
(exp_id,'PID和PPID关系正确'',core','','',true,20,3),
(exp_id,'fork失败处理'',edge','','',true,20,4),
(exp_id,'wait回收子进程'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab2_fork_tree' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'总进程数=7'',core','','',true,20,1),
(exp_id,'Level 0输出'',core','','Level 0:',true,20,2),
(exp_id,'Level 1输出2个'',core','','',true,20,3),
(exp_id,'Level 2输出4个'',core','','',true,20,4),
(exp_id,'waitpid正确回收'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab3_exec_ls' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'execvp成功执行ls'',core','','',true,20,1),
(exp_id,'父进程正确等待'',core','','',true,20,2),
(exp_id,'execvp失败处理'',edge','','',true,20,3),
(exp_id,'退出状态检查'',edge','','',true,20,4),
(exp_id,'fork失败处理'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab4_pipe_ipc' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'父进程接收消息'',core','','Parent received:',true,20,1),
(exp_id,'子进程接收并回复'',core','','Child received:',true,20,2),
(exp_id,'管道端正确关闭'',edge','','',true,20,3),
(exp_id,'pipe创建失败处理'',edge','','',true,20,4),
(exp_id,'大消息传输4096字节'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab5_signal_handler' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'SIGINT处理器注册成功'',core','','',true,20,1),
(exp_id,'3次SIGINT后退出'',core','','',true,20,2),
(exp_id,'SIGUSR1计数正确'',core','','',true,20,3),
(exp_id,'信号集阻塞/恢复'',edge','','',true,20,4),
(exp_id,'多信号并发处理'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab6_zombie_orphan' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'僵尸进程被回收'',core','','Zombie reaped:',true,20,1),
(exp_id,'孤儿进程被init接管'',core','','new PPID=',true,20,2),
(exp_id,'waitpid正确使用'',core','','',true,20,3),
(exp_id,'sigchld信号处理'',edge','','',true,20,4),
(exp_id,'并行多子进程回收'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab7_daemon_process' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'daemonize成功'',core','','Daemon started:',true,20,1),
(exp_id,'日志文件创建'',core','','',true,20,2),
(exp_id,'日志包含5条记录'',core','','',true,20,3),
(exp_id,'setsid创建新会话'',core','','',true,20,4),
(exp_id,'文件描述符重定向'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab8_producer_consumer' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'20个数据全部消费'',core','','All items processed',true,20,1),
(exp_id,'数据无重复无丢失'',core','','',true,20,2),
(exp_id,'环形缓冲区边界'',edge','','',true,20,3),
(exp_id,'mutex正确配对lock/unlock'',edge','','',true,20,4),
(exp_id,'条件变量signal/broadcast'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab9_reader_writer' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'读写互斥正确'',core','','All done',true,20,1),
(exp_id,'多读者可并发'',core','','',true,20,2),
(exp_id,'写者独占写入'',core','','',true,20,3),
(exp_id,'读者优先策略'',edge','','',true,20,4),
(exp_id,'读写锁正确销毁'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab10_threadpool' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'10个任务全部完成'',core','','Worker exiting',true,20,1),
(exp_id,'4个worker并行工作'',core','','',true,20,2),
(exp_id,'任务队列无竞争条件'',edge','','',true,20,3),
(exp_id,'优雅关闭无崩溃'',edge','','',true,20,4),
(exp_id,'空队列销毁'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab11_barrier_sync' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'3个阶段全部完成'',core','','All phases complete',true,20,1),
(exp_id,'4个线程都到达屏障'',core','','',true,20,2),
(exp_id,'阶段顺序正确'',core','','',true,20,3),
(exp_id,'pthread_barrier_destroy'',edge','','',true,20,4),
(exp_id,'屏障计数精确'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab12_spinlock_vs_mutex' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'计数器值正确'',core','','Benchmark complete',true,20,1),
(exp_id,'spinlock/mutex都输出耗时'',core','','',true,20,2),
(exp_id,'多线程结果正确'',core','','',true,20,3),
(exp_id,'自旋锁原子操作'',edge','','',true,20,4),
(exp_id,'锁初始化/销毁'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab13_tls' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'每个线程计数到100'',core','','count=100 each',true,20,1),
(exp_id,'TLS变量独立'',core','','',true,20,2),
(exp_id,'3个线程都完成'',core','','',true,20,3),
(exp_id,'__thread正确声明'',edge','','',true,20,4),
(exp_id,'pthread_key_t对比'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab14_malloc_impl' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'5个分配成功'',core','','Allocated',true,20,1),
(exp_id,'释放并合并成功'',core','','Realloc test passed',true,20,2),
(exp_id,'first-fit算法'',core','','',true,20,3),
(exp_id,'NULL指针释放'',edge','','',true,20,4),
(exp_id,'分配0字节'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab15_best_fit' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'两种策略都能分配成功'',core','','Fragmentation:',true,20,1),
(exp_id,'first-fit找到第一个合适块'',core','','',true,20,2),
(exp_id,'best-fit找到最接近的块'',core','','',true,20,3),
(exp_id,'碎片率计算正确'',edge','','',true,20,4),
(exp_id,'边界精确匹配的块'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab16_page_table' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'5个映射正确翻译'',core','','All page table tests passed',true,20,1),
(exp_id,'页错误输出'',core','','Page fault',true,20,2),
(exp_id,'页目录和页表结构'',core','','',true,20,3),
(exp_id,'边界4GB边界地址'',edge','','',true,20,4),
(exp_id,'未初始化页表'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab17_mem_leak' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'检测到2个泄漏'',core','','Leak:',true,20,1),
(exp_id,'第3个块被正确释放'',core','','',true,20,2),
(exp_id,'源文件位置记录'',core','','',true,20,3),
(exp_id,'全释后无泄漏'',edge','','',true,20,4),
(exp_id,'NULL指针释放'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab18_seg_fault' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'捕获NULL解引用'',core','','NULL dereference',true,20,1),
(exp_id,'捕获写保护'',core','','mprotect violation',true,20,2),
(exp_id,'SIGSEGV恢复执行'',core','','All SIGSEGV tests complete',true,20,3),
(exp_id,'mmap/mprotect使用'',edge','','',true,20,4),
(exp_id,'信号处理器栈安全'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab19_file_cp' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'4种缓冲都成功复制'',core','','Copy tests complete',true,20,1),
(exp_id,'文件大小正确'',core','','',true,20,2),
(exp_id,'大缓冲最快'',core','','',true,20,3),
(exp_id,'源文件不存在'',edge','','',true,20,4),
(exp_id,'目标目录无写权限'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab20_dir_ls' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'递归遍历正确'',core','','Total:',true,20,1),
(exp_id,'目录和文件区分'',core','','[D]',true,20,2),
(exp_id,'inode号输出'',core','','',true,20,3),
(exp_id,'无权限目录处理'',edge','','',true,20,4),
(exp_id,'符号链接处理'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab21_mmap_read' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'映射读写成功'',core','','mmap test passed',true,20,1),
(exp_id,'内容被修改'',core','','Modified Line 2',true,20,2),
(exp_id,'msync同步'',core','','',true,20,3),
(exp_id,'零长度文件'',edge','','',true,20,4),
(exp_id,'超过文件大小的访问'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab22_fsync_test' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'三种方式都完成'',core','','fsync benchmark complete',true,20,1),
(exp_id,'O_SYNC最慢'',core','','',true,20,2),
(exp_id,'数据写入完整'',core','','',true,20,3),
(exp_id,'fsync错误处理'',edge','','',true,20,4),
(exp_id,'磁盘满的处理'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab23_tee' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'stdin到stdout和文件'',core','','Copied',true,20,1),
(exp_id,'append模式工作'',core','','',true,20,2),
(exp_id,'SIGINT正确处理'',core','','',true,20,3),
(exp_id,'partial write处理'',edge','','',true,20,4),
(exp_id,'空输入处理'',edge','','',true,20,5)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab24_sched_sim' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'4种算法都输出结果'',core','','Scheduler simulation complete',true,16,1),
(exp_id,'FCFS平均等待时间'',core','','FCFS:',true,16,2),
(exp_id,'SJF比FCFS平均等待更短'',core','','',true,16,3),
(exp_id,'RR时间片正确'',edge','','',true,16,4),
(exp_id,'空进程列表'',edge','','',true,16,5),
(exp_id,'所有进程同时到达'',edge','','',true,16,6)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab25_mlfq' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'MLFQ运行完整'',core','','MLFQ:',true,16,1),
(exp_id,'短进程优先完成'',core','','',true,16,2),
(exp_id,'优先级提升发生'',core','','Priority boosts:',true,16,3),
(exp_id,'Q0/Q1/Q2切换'',core','','',true,16,4),
(exp_id,'进程饥饿检测'',edge','','',true,16,5),
(exp_id,'全0到达时间'',edge','','',true,16,6)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab26_real_time' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'RMS/EDF可调度性分析'',core','','Real-time scheduling analysis complete',true,16,1),
(exp_id,'CPU利用率计算'',core','','U=',true,16,2),
(exp_id,'RMS bound判定正确'',core','','',true,16,3),
(exp_id,'EDF bound判定'',edge','','',true,16,4),
(exp_id,'不可调度任务集'',edge','','',true,16,5),
(exp_id,'死期限期检查'',edge','','',true,16,6)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab27_cfs_sim' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'CFS调度完成'',core','','CFS fairness:',true,16,1),
(exp_id,'低nice值进程优先'',core','','',true,16,2),
(exp_id,'vruntime递增正确'',core','','',true,16,3),
(exp_id,'权重映射正确'',core','','',true,16,4),
(exp_id,'相同nice公平分配'',edge','','',true,16,5),
(exp_id,'最小调度粒度'',edge','','',true,16,6)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab28_lottery' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'100次调度周期完成'',core','','Lottery results',true,16,1),
(exp_id,'比例接近期望'',core','','Expected vs Actual:',true,16,2),
(exp_id,'所有进程都被调度'',core','','',true,16,3),
(exp_id,'总票数验证'',edge','','',true,16,4),
(exp_id,'0 ticket进程'',edge','','',true,16,5),
(exp_id,'大量ticket溢出'',edge','','',true,16,6)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab29_banker' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'安全序列正确'',core','','Bankers algorithm test complete',true,16,1),
(exp_id,'P1请求被批准'',core','','Request granted',true,16,2),
(exp_id,'P4请求被拒绝'',core','','Request denied',true,16,3),
(exp_id,'安全状态检测算法'',core','','',true,16,4),
(exp_id,'边界超出最大需求'',edge','','',true,16,5),
(exp_id,'边界超出可用资源'',edge','','',true,16,6)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab30_deadlock_detect' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'死锁检测出环'',core','','Deadlock detected:',true,16,1),
(exp_id,'释放后死锁解除'',core','','No deadlock detected',true,16,2),
(exp_id,'DFS环检测正确'',core','','',true,16,3),
(exp_id,'无环图不误报'',edge','','',true,16,4),
(exp_id,'多环死锁'',edge','','',true,16,5),
(exp_id,'单个进程自环'',edge','','',true,16,6)
ON CONFLICT DO NOTHING;
END IF;
SELECT id INTO exp_id FROM experiments WHERE name='lab31_deadlock_avoid' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id,name,type,input_data,expected_output,is_public,score_weight,order_index) VALUES
(exp_id,'有序分配完成'',core','','Ordered:',true,16,1),
(exp_id,'有序无死锁'',core','','threads finished=2',true,16,2),
(exp_id,'无序检测到死锁'',core','','',true,16,3),
(exp_id,'trylock超时避免'',core','','',true,16,4),
(exp_id,'释放已持有锁'',edge','','',true,16,5),
(exp_id,'3种资源排序'',edge','','',true,16,6)
ON CONFLICT DO NOTHING;
END IF;
END $$;
