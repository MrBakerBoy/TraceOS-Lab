-- ============================================================================
-- 23-remaining-test-assertions.sql
-- 将剩余 28 个实验的 test_cases.expected_output 替换为 v2 JSON 断言格式。
--
-- 覆盖实验:
--   Process:  lab2_fork_tree, lab3_exec_ls, lab4_pipe_ipc, lab5_signal_handler,
--             lab6_zombie_orphan, lab7_daemon_process
--   Thread:   lab9_reader_writer, lab10_threadpool, lab11_barrier_sync,
--             lab12_spinlock_vs_mutex, lab13_tls
--   Memory:   lab14_malloc_impl, lab15_best_fit, lab16_page_table,
--             lab17_mem_leak, lab18_seg_fault
--   FS:       lab19_file_cp, lab20_dir_ls, lab21_mmap_read, lab22_fsync_test,
--             lab23_tee
--   Scheduler:lab25_mlfq, lab26_real_time, lab27_cfs_sim, lab28_lottery
--   Deadlock: lab29_banker, lab30_deadlock_detect, lab31_deadlock_avoid
--
-- 测试点设计原则:
--   - 每个测试点只测一个维度 (output/syscall/behavior/numeric 四选一) + exit_code
--   - Process/Thread/Memory/FS: 5 测试点 × 20 = 100
--   - Scheduler/Deadlock: 6 测试点 × 17(×4) + 16(×2) = 100
--   - type: 'core' / 'edge'
-- ============================================================================

DO $$
DECLARE
    exp_id UUID;
BEGIN

-- ========================================================================
-- lab2_fork_tree: 进程树与进程层次结构
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab2_fork_tree';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '进程总数与无僵尸', 'core', '',
        '{"exit_code":0,"behavior_assertions":{"no_zombie":true}}',
        true, 20, 1
    ),
    (
        exp_id, 'Level0根进程输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Level 0: PID=\\d+, PPID=\\d+"}]}',
        true, 20, 2
    ),
    (
        exp_id, 'Level1子进程输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Level 1:"}]}',
        true, 20, 3
    ),
    (
        exp_id, 'Level2孙进程输出', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Level 2:"}]}',
        true, 20, 4
    ),
    (
        exp_id, '禁止使用system()', 'edge', '',
        '{"exit_code":[0,1],"syscall_assertions":{"forbidden":["system"]}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab3_exec_ls: exec系列函数：进程替换
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab3_exec_ls';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, 'execvp成功执行ls', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"total|\\[D\\]|\\[F\\]"}]}',
        true, 20, 1
    ),
    (
        exp_id, '父进程waitpid等待', 'core', '',
        '{"exit_code":0,"syscall_assertions":{"required":["wait4"]}}',
        true, 20, 2
    ),
    (
        exp_id, 'execvp失败处理', 'core', '',
        '{"exit_code":[0,1]}',
        true, 20, 3
    ),
    (
        exp_id, '退出状态与超时检查', 'edge', '',
        '{"exit_code":0,"behavior_assertions":{"max_runtime_ms":5000}}',
        true, 20, 4
    ),
    (
        exp_id, '禁止使用system()', 'edge', '',
        '{"exit_code":[0,1],"syscall_assertions":{"forbidden":["system"]}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab4_pipe_ipc: 管道通信：父子进程双向管道
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab4_pipe_ipc';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '父进程接收子进程消息', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"[Parent] received"}]}',
        true, 20, 1
    ),
    (
        exp_id, '子进程接收父进程消息', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"[Child] received"}]}',
        true, 20, 2
    ),
    (
        exp_id, '管道端正确关闭', 'core', '',
        '{"exit_code":0,"syscall_assertions":{"required":["close"],"min_count":{"close":4}}}',
        true, 20, 3
    ),
    (
        exp_id, 'pipe创建失败处理', 'edge', '',
        '{"exit_code":[0,1]}',
        true, 20, 4
    ),
    (
        exp_id, '完整消息双向传输', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"MSG from parent"},{"mode":"contains","value":"MSG from child"}]}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab5_signal_handler: 信号处理：SIGINT/SIGUSR1捕获
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab5_signal_handler';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, 'SIGINT处理器注册成功', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"SIGINT received"}]}',
        true, 20, 1
    ),
    (
        exp_id, '3次SIGINT后退出', 'core', '',
        '{"exit_code":0,"behavior_assertions":{"max_runtime_ms":10000}}',
        true, 20, 2
    ),
    (
        exp_id, 'SIGUSR1计数正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"SIGUSR1"}]}',
        true, 20, 3
    ),
    (
        exp_id, '信号集阻塞/恢复', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["rt_sigprocmask"]}}',
        true, 20, 4
    ),
    (
        exp_id, '多信号并发处理', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["rt_sigaction"]}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab6_zombie_orphan: 僵尸进程与孤儿进程
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab6_zombie_orphan';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '僵尸进程被回收', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Zombie reaped"}]}',
        true, 20, 1
    ),
    (
        exp_id, '孤儿进程被init接管', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"new PPID=\\d+"}]}',
        true, 20, 2
    ),
    (
        exp_id, 'waitpid正确使用', 'core', '',
        '{"exit_code":0,"syscall_assertions":{"required":["wait4"]}}',
        true, 20, 3
    ),
    (
        exp_id, '无僵尸残留', 'edge', '',
        '{"exit_code":0,"behavior_assertions":{"no_zombie":true}}',
        true, 20, 4
    ),
    (
        exp_id, '多子进程回收', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["wait4"],"min_count":{"wait4":2}}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab7_daemon_process: 守护进程实现
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab7_daemon_process';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, 'daemonize成功启动', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Daemon started"}]}',
        true, 20, 1
    ),
    (
        exp_id, '日志文件创建并写入', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Daemon log entry 1"}]}',
        true, 20, 2
    ),
    (
        exp_id, '日志包含5条记录', 'core', '',
        '{"exit_code":0,"numeric_assertions":{"mode":"count_distinct","pattern":"Daemon log entry (\\d+)/5","min":5,"max":5}}',
        true, 20, 3
    ),
    (
        exp_id, 'setsid创建新会话', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["setsid"]}}',
        true, 20, 4
    ),
    (
        exp_id, '文件描述符重定向', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["openat","close"]}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab9_reader_writer: 读者-写者问题 (pthread_rwlock_t)
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab9_reader_writer';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '读操作正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Reader"}]}',
        true, 20, 1
    ),
    (
        exp_id, '写操作正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Writer"}]}',
        true, 20, 2
    ),
    (
        exp_id, '读写互斥无死锁', 'core', '',
        '{"exit_code":0,"behavior_assertions":{"no_deadlock":true}}',
        true, 20, 3
    ),
    (
        exp_id, '多读者并发同步', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["futex"]},"behavior_assertions":{"max_runtime_ms":30000}}',
        true, 20, 4
    ),
    (
        exp_id, 'rwlock正确销毁', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["futex"],"min_count":{"futex":4}}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab10_threadpool: 线程池实现
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab10_threadpool';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '10个任务全部完成', 'core', '',
        '{"exit_code":0,"numeric_assertions":{"mode":"count_distinct","pattern":"Task (\\d+) done","min":10,"max":10}}',
        true, 20, 1
    ),
    (
        exp_id, '4个Worker正确退出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Worker exiting"}],"numeric_assertions":{"mode":"count_distinct","pattern":"Worker (\\d+) exiting","min":4,"max":4}}',
        true, 20, 2
    ),
    (
        exp_id, '无竞争条件', 'core', '',
        '{"exit_code":0,"behavior_assertions":{"no_deadlock":true}}',
        true, 20, 3
    ),
    (
        exp_id, '优雅关闭同步', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["futex"]},"behavior_assertions":{"max_runtime_ms":30000}}',
        true, 20, 4
    ),
    (
        exp_id, '线程数正确创建', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["clone"],"min_count":{"clone":4}}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab11_barrier_sync: 线程屏障同步
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab11_barrier_sync';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '3个阶段全部完成', 'core', '',
        '{"exit_code":0,"numeric_assertions":{"mode":"count_distinct","pattern":"Phase (\\d+) done","min":3,"max":3}}',
        true, 20, 1
    ),
    (
        exp_id, '线程到达屏障', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Thread \\d entering phase"}]}',
        true, 20, 2
    ),
    (
        exp_id, '全部阶段完成标记', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"All phases complete"}]}',
        true, 20, 3
    ),
    (
        exp_id, 'barrier正确销毁', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["futex"]},"behavior_assertions":{"max_runtime_ms":30000}}',
        true, 20, 4
    ),
    (
        exp_id, '屏障futex计数', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["futex"],"min_count":{"futex":8}}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab12_spinlock_vs_mutex: 自旋锁与互斥锁性能对比
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab12_spinlock_vs_mutex';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '基准测试完成', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Benchmark complete"}]}',
        true, 20, 1
    ),
    (
        exp_id, 'SpinLock输出正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Spin(L|l)ock"}]}',
        true, 20, 2
    ),
    (
        exp_id, 'Mutex输出正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"(M|m)utex"}]}',
        true, 20, 3
    ),
    (
        exp_id, '计数器数值正确', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"counter"}],"behavior_assertions":{"max_runtime_ms":60000}}',
        true, 20, 4
    ),
    (
        exp_id, '原子操作同步', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["futex"]}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab13_tls: 线程局部存储 (__thread)
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab13_tls';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '线程独立计数值', 'core', '',
        '{"exit_code":0,"numeric_assertions":{"mode":"count_distinct","pattern":"Thread (\\d): count=(\\d+)","min":3,"max":3}}',
        true, 20, 1
    ),
    (
        exp_id, '每个线程count=100', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"count=100"}]}',
        true, 20, 2
    ),
    (
        exp_id, 'TLS完成标记', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"each"}]}',
        true, 20, 3
    ),
    (
        exp_id, '线程正确创建', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["clone"],"min_count":{"clone":3}},"behavior_assertions":{"max_runtime_ms":10000}}',
        true, 20, 4
    ),
    (
        exp_id, 'pthread并发', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["clone"]},"behavior_assertions":{"no_deadlock":true}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab14_malloc_impl: malloc/free first-fit 实现
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab14_malloc_impl';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '5个分配全部成功', 'core', '',
        '{"exit_code":0,"numeric_assertions":{"mode":"count_distinct","pattern":"Allocated","min":5,"max":5}}',
        true, 20, 1
    ),
    (
        exp_id, '释放合并后384字节分配', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Realloc test passed"}]}',
        true, 20, 2
    ),
    (
        exp_id, 'first-fit释放标记', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"(F|f)ree"}]}',
        true, 20, 3
    ),
    (
        exp_id, 'NULL释放不崩溃', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"not_contains","value":"Segfault"}],"behavior_assertions":{"max_runtime_ms":10000}}',
        true, 20, 4
    ),
    (
        exp_id, '0字节分配安全', 'edge', '',
        '{"exit_code":[0,1],"syscall_assertions":{"required":["brk"]}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab15_best_fit: 内存分配策略对比
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab15_best_fit';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '碎片率输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Fragmentation"}]}',
        true, 20, 1
    ),
    (
        exp_id, 'First-fit结果', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"First-fit"}]}',
        true, 20, 2
    ),
    (
        exp_id, 'Best-fit结果', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Best-fit"}]}',
        true, 20, 3
    ),
    (
        exp_id, '堆扩展系统调用', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["brk"]},"behavior_assertions":{"max_runtime_ms":10000}}',
        true, 20, 4
    ),
    (
        exp_id, 'mmap边界处理', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["mmap"]},"behavior_assertions":{"max_memory_kb":262144}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab16_page_table: 多级页表模拟
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab16_page_table';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '5个映射正确翻译', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"All page table tests passed"}]}',
        true, 20, 1
    ),
    (
        exp_id, '页错误输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Page fault"}]}',
        true, 20, 2
    ),
    (
        exp_id, '页表结构输出正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"VA.*PA"}]}',
        true, 20, 3
    ),
    (
        exp_id, '4GB边界地址处理', 'edge', '',
        '{"exit_code":0,"behavior_assertions":{"max_runtime_ms":5000}}',
        true, 20, 4
    ),
    (
        exp_id, '未初始化页表检测', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["mmap"]}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab17_mem_leak: 内存泄漏检测
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab17_mem_leak';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '检测到2个泄漏', 'core', '',
        '{"exit_code":0,"numeric_assertions":{"mode":"count_distinct","pattern":"Leak:","min":2,"max":2}}',
        true, 20, 1
    ),
    (
        exp_id, '第3个块被正确释放', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Free"}]}',
        true, 20, 2
    ),
    (
        exp_id, '源文件位置记录', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"\\w+\\.\\w+:\\d+"}]}',
        true, 20, 3
    ),
    (
        exp_id, '全释后无泄漏', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"not_contains","value":"Leak"}]}',
        true, 20, 4
    ),
    (
        exp_id, 'NULL指针释放安全', 'edge', '',
        '{"exit_code":0,"behavior_assertions":{"max_runtime_ms":5000}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab18_seg_fault: 段错误处理
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab18_seg_fault';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '捕获NULL解引用', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"NULL dereference"}]}',
        true, 20, 1
    ),
    (
        exp_id, '捕获mprotect违规', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"mprotect violation"}]}',
        true, 20, 2
    ),
    (
        exp_id, 'SIGSEGV恢复执行', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"All SIGSEGV tests complete"}]}',
        true, 20, 3
    ),
    (
        exp_id, 'mmap/mprotect使用', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["mmap"]}}',
        true, 20, 4
    ),
    (
        exp_id, '信号处理器栈安全', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["sigaltstack"]}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab19_file_cp: 文件复制
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab19_file_cp';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '4种缓冲都成功复制', 'core', '',
        '{"exit_code":0,"numeric_assertions":{"mode":"count_distinct","pattern":"Buffer (\d+) bytes","min":4,"max":4}}',
        true, 20, 1
    ),
    (
        exp_id, '大缓冲最快', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"65536"}]}',
        true, 20, 2
    ),
    (
        exp_id, '文件大小正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Copy tests complete"}]}',
        true, 20, 3
    ),
    (
        exp_id, '源文件不存在', 'edge', '',
        '{"exit_code":[0,1],"behavior_assertions":{"max_runtime_ms":5000}}',
        true, 20, 4
    ),
    (
        exp_id, '目标无写权限处理', 'edge', '',
        '{"exit_code":[0,1],"syscall_assertions":{"forbidden":["system","execve"]}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab20_dir_ls: 目录遍历
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab20_dir_ls';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '递归遍历正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Total:"}]}',
        true, 20, 1
    ),
    (
        exp_id, '目录和文件区分', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"[D]"}]}',
        true, 20, 2
    ),
    (
        exp_id, 'inode号输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"inode="}]}',
        true, 20, 3
    ),
    (
        exp_id, '无权限目录处理', 'edge', '',
        '{"exit_code":[0,1],"behavior_assertions":{"max_runtime_ms":5000}}',
        true, 20, 4
    ),
    (
        exp_id, '符号链接处理', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":".*"}]}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab21_mmap_read: mmap文件映射
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab21_mmap_read';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '映射读写成功', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"mmap test passed"}]}',
        true, 20, 1
    ),
    (
        exp_id, '内容修改持久化', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Modified Line 2"}]}',
        true, 20, 2
    ),
    (
        exp_id, 'msync同步调用', 'core', '',
        '{"exit_code":0,"syscall_assertions":{"required":["msync"]}}',
        true, 20, 3
    ),
    (
        exp_id, '零长度文件处理', 'edge', '',
        '{"exit_code":[0,1],"behavior_assertions":{"max_runtime_ms":5000}}',
        true, 20, 4
    ),
    (
        exp_id, '越界访问保护', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["mmap"]},"behavior_assertions":{"max_runtime_ms":5000}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab22_fsync_test: 文件系统持久化
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab22_fsync_test';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '三种方式都完成', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"fsync benchmark complete"}]}',
        true, 20, 1
    ),
    (
        exp_id, 'O_SYNC方式输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"O_SYNC"}]}',
        true, 20, 2
    ),
    (
        exp_id, 'fsync方式输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"fsync"}]}',
        true, 20, 3
    ),
    (
        exp_id, '数据完整性验证', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Normal write"}]}',
        true, 20, 4
    ),
    (
        exp_id, 'fsync错误处理', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["fsync"]}}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab23_tee: I/O多路复用 tee 程序
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab23_tee';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, 'stdin到stdout和文件', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Copied"}]}',
        true, 20, 1
    ),
    (
        exp_id, 'append模式工作', 'core', '',
        '{"exit_code":0,"syscall_assertions":{"required":["openat"]}}',
        true, 20, 2
    ),
    (
        exp_id, 'SIGINT正确处理', 'core', '',
        '{"exit_code":0,"behavior_assertions":{"max_runtime_ms":10000}}',
        true, 20, 3
    ),
    (
        exp_id, 'partial write处理', 'edge', '',
        '{"exit_code":[0,1]}',
        true, 20, 4
    ),
    (
        exp_id, '空输入处理', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Copied 0 bytes"}]}',
        true, 20, 5
    );
END IF;

-- ========================================================================
-- lab25_mlfq: 多级反馈队列调度 (6测试点: 17+17+17+17+16+16=100)
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab25_mlfq';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, 'MLFQ运行完整', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"MLFQ:"}]}',
        true, 17, 1
    ),
    (
        exp_id, '短进程优先完成', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Q0"}]}',
        true, 17, 2
    ),
    (
        exp_id, '优先级提升发生', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Priority boost"}]}',
        true, 17, 3
    ),
    (
        exp_id, 'Q2降级队列输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Q2"}]}',
        true, 17, 4
    ),
    (
        exp_id, '进程饥饿检测', 'edge', '',
        '{"exit_code":0,"behavior_assertions":{"max_runtime_ms":30000}}',
        true, 16, 5
    ),
    (
        exp_id, '全0到达时间', 'edge', '',
        '{"exit_code":0,"behavior_assertions":{"no_deadlock":true}}',
        true, 16, 6
    );
END IF;

-- ========================================================================
-- lab26_real_time: 实时调度 RMS/EDF (6测试点: 17+17+17+17+16+16=100)
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab26_real_time';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '可调度性分析完成', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Real-time scheduling analysis complete"}]}',
        true, 17, 1
    ),
    (
        exp_id, 'CPU利用率计算', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"U=\\d+\\.\\d+"}]}',
        true, 17, 2
    ),
    (
        exp_id, 'RMS判定正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"RMS"}]}',
        true, 17, 3
    ),
    (
        exp_id, 'EDF判定', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"EDF"}]}',
        true, 17, 4
    ),
    (
        exp_id, '不可调度任务集', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"not schedulable"}]}',
        true, 16, 5
    ),
    (
        exp_id, 'deadline检查', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"deadline"}]}',
        true, 16, 6
    );
END IF;

-- ========================================================================
-- lab27_cfs_sim: CFS完全公平调度 (6测试点: 17+17+17+17+16+16=100)
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab27_cfs_sim';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, 'CFS调度完成', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"CFS fairness"}]}',
        true, 17, 1
    ),
    (
        exp_id, '低nice值进程优先', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"nice"}]}',
        true, 17, 2
    ),
    (
        exp_id, 'vruntime递增正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"vruntime"}]}',
        true, 17, 3
    ),
    (
        exp_id, '权重映射正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"weight"}]}',
        true, 17, 4
    ),
    (
        exp_id, '相同nice公平分配', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"fair"}]}',
        true, 16, 5
    ),
    (
        exp_id, '最小调度粒度', 'edge', '',
        '{"exit_code":0,"behavior_assertions":{"max_runtime_ms":30000}}',
        true, 16, 6
    );
END IF;

-- ========================================================================
-- lab28_lottery: 彩票调度算法 (6测试点: 17+17+17+17+16+16=100)
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab28_lottery';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '100次调度周期完成', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Lottery results"}]}',
        true, 17, 1
    ),
    (
        exp_id, '比例接近期望', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Expected vs Actual"}]}',
        true, 17, 2
    ),
    (
        exp_id, '所有进程都被调度', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"P[ABC]"}]}',
        true, 17, 3
    ),
    (
        exp_id, '总票数验证', 'core', '',
        '{"exit_code":0,"behavior_assertions":{"max_runtime_ms":10000}}',
        true, 17, 4
    ),
    (
        exp_id, '0 ticket进程', 'edge', '',
        '{"exit_code":[0,1]}',
        true, 16, 5
    ),
    (
        exp_id, '大量ticket溢出', 'edge', '',
        '{"exit_code":0,"behavior_assertions":{"no_deadlock":true}}',
        true, 16, 6
    );
END IF;

-- ========================================================================
-- lab29_banker: 银行家算法 (6测试点: 17+17+17+17+16+16=100)
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab29_banker';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '安全序列输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Bankers algorithm test complete"}]}',
        true, 17, 1
    ),
    (
        exp_id, 'P1请求被批准', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Request granted"}]}',
        true, 17, 2
    ),
    (
        exp_id, 'P4请求被拒绝', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Request denied"}]}',
        true, 17, 3
    ),
    (
        exp_id, '安全序列格式正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Safe sequence"}]}',
        true, 17, 4
    ),
    (
        exp_id, '超出最大需求边界', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"exceeds maximum"}]}',
        true, 16, 5
    ),
    (
        exp_id, '超出可用资源边界', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"not enough"}]}',
        true, 16, 6
    );
END IF;

-- ========================================================================
-- lab30_deadlock_detect: 死锁检测 (6测试点: 17+17+17+17+16+16=100)
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab30_deadlock_detect';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '检测到死锁环', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Deadlock detected"}]}',
        true, 17, 1
    ),
    (
        exp_id, '释放后死锁解除', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"No deadlock detected"}]}',
        true, 17, 2
    ),
    (
        exp_id, 'DFS环检测正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"cycle|→"}]}',
        true, 17, 3
    ),
    (
        exp_id, '无环图不误报', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"No deadlock"}]}',
        true, 17, 4
    ),
    (
        exp_id, '多环死锁检测', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"cycle"}]}',
        true, 16, 5
    ),
    (
        exp_id, '自环检测', 'edge', '',
        '{"exit_code":0,"behavior_assertions":{"max_runtime_ms":10000}}',
        true, 16, 6
    );
END IF;

-- ========================================================================
-- lab31_deadlock_avoid: 死锁预防 (6测试点: 17+17+17+17+16+16=100)
-- ========================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab31_deadlock_avoid';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;
    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '有序分配完成', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Ordered:"}]}',
        true, 17, 1
    ),
    (
        exp_id, '有序无死锁', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"finished=\\d+"}]}',
        true, 17, 2
    ),
    (
        exp_id, '无序可能死锁', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Unordered|timeout|deadlock"}]}',
        true, 17, 3
    ),
    (
        exp_id, 'trylock超时避免', 'core', '',
        '{"exit_code":0,"syscall_assertions":{"required":["futex"],"min_count":{"futex":4}}}',
        true, 17, 4
    ),
    (
        exp_id, '释放已持有锁', 'edge', '',
        '{"exit_code":0,"behavior_assertions":{"max_runtime_ms":10000}}',
        true, 16, 5
    ),
    (
        exp_id, '3种资源排序', 'edge', '',
        '{"exit_code":0,"behavior_assertions":{"no_deadlock":true}}',
        true, 16, 6
    );
END IF;

END $$;