-- =============================================================================
-- TraceOS Lab - 概念 Rubric 种子数据 (6 类实验)
-- 每条以 exp_<category>_default 关联，Orchestrator 按实验 category 匹配
-- calibration_kappa = 0.0 (待 Gold Set 校准)
-- =============================================================================

-- process 类实验
INSERT INTO experiment_rubrics (experiment_id, version, category, rubric_json, calibration_kappa, is_active)
VALUES ('exp_process_default', '1.0', 'process', '{
  "category": "process",
  "concept_rubrics": [
    {
      "concept": "fork创建子进程",
      "weight": 20,
      "atomic_criteria": [
        "代码中存在 fork() 调用（二元判定）",
        "fork() 返回值被正确处理（区分父子进程）",
        "父子进程执行了不同逻辑分支"
      ],
      "evidence_mapping": {"primary": "strace 中 clone/fork 系统调用", "secondary": "代码中 fork() 调用点 + 控制流图"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未使用 fork 或完全错误", "1": "使用 fork 但返回值处理有缺陷", "2": "正确使用 fork 且父子逻辑清晰分离"}
    },
    {
      "concept": "wait/waitpid 回收子进程",
      "weight": 15,
      "atomic_criteria": [
        "代码中存在 wait/waitpid 调用",
        "wait 在 fork 之后被调用",
        "所有子进程都被回收"
      ],
      "evidence_mapping": {"primary": "strace 中 wait4/waitid 调用", "secondary": "代码中 wait() 调用点"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未使用 wait", "1": "使用 wait 但仅回收部分子进程", "2": "正确回收所有子进程"}
    },
    {
      "concept": "exec系列进程替换",
      "weight": 15,
      "atomic_criteria": [
        "exec 函数族被正确调用",
        "exec 失败时有错误处理",
        "exec 调用前的资源清理 (如关闭管道端)"
      ],
      "evidence_mapping": {"primary": "strace 中 execve 调用", "secondary": "代码中 exec 调用点"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未使用 exec 或调用完全错误", "1": "使用 exec 但缺少失败处理", "2": "正确使用 exec 且含错误处理"}
    },
    {
      "concept": "管道通信",
      "weight": 15,
      "atomic_criteria": [
        "pipe() 创建成功",
        "不使用的管道端被关闭",
        "数据通过管道正确传递"
      ],
      "evidence_mapping": {"primary": "strace 中 pipe/读写", "secondary": "代码中 pipe() 调用"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未使用管道或管道创建失败", "1": "管道创建成功但端未关闭", "2": "管道正确创建且端已关闭"}
    },
    {
      "concept": "信号处理",
      "weight": 15,
      "atomic_criteria": [
        "sigaction/signal 注册了信号处理器",
        "信号处理器不调用非异步信号安全函数",
        "主循环正确等待信号 (pause/sigsuspend)"
      ],
      "evidence_mapping": {"primary": "strace 中 rt_sigaction", "secondary": "代码中 signal/sigaction 调用"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未注册信号处理器", "1": "注册了但在处理器中调用不安全函数", "2": "正确注册且处理器安全"}
    },
    {
      "concept": "僵尸进程/孤儿进程理解",
      "weight": 10,
      "atomic_criteria": [
        "理解僵尸进程产生原因 (子进程退出但父进程未 wait)",
        "理解孤儿进程被 init 收养机制",
        "代码中正确处理了僵尸/孤儿场景"
      ],
      "evidence_mapping": {"primary": "strace 中 exit_group + wait4 时序", "secondary": "代码逻辑"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "概念理解完全错误", "1": "部分理解", "2": "完整理解且代码正确处理"}
    },
    {
      "concept": "守护进程创建",
      "weight": 10,
      "atomic_criteria": [
        "fork + setsid 实现 daemonize",
        "重定向 stdin/stdout/stderr 到 /dev/null",
        "chdir 到根目录"
      ],
      "evidence_mapping": {"primary": "strace 中 setsid + dup2 + chdir", "secondary": "代码中 daemonize 函数"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未实现 daemonize", "1": "部分实现 (缺 setsid 或重定向)", "2": "完整实现"}
    }
  ],
  "hard_fail_rules": [
    "子进程不存在 wait/waitpid 调用 → 标记严重缺陷",
    "管道创建后所有端均未关闭 → 标记资源泄漏",
    "信号处理器中调用 printf/malloc 等非异步信号安全函数 → 标记严重缺陷"
  ]
}'::jsonb, 0.0, TRUE)
ON CONFLICT (experiment_id, version) DO NOTHING;

-- memory 类实验
INSERT INTO experiment_rubrics (experiment_id, version, category, rubric_json, calibration_kappa, is_active)
VALUES ('exp_memory_default', '1.0', 'memory', '{
  "category": "memory",
  "concept_rubrics": [
    {
      "concept": "堆内存分配 (sbrk/mmap)",
      "weight": 20,
      "atomic_criteria": [
        "使用 sbrk/mmap 扩展堆空间",
        "分配大小计算正确",
        "分配失败时有错误处理"
      ],
      "evidence_mapping": {"primary": "strace 中 brk/mmap", "secondary": "代码中 sbrk/mmap 调用"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未正确分配内存", "1": "分配但缺错误处理", "2": "正确分配且含错误处理"}
    },
    {
      "concept": "内存释放 (free/munmap)",
      "weight": 20,
      "atomic_criteria": [
        "分配的内存被正确释放",
        "释放后不继续使用 (无 use-after-free)",
        "所有分配路径都有对应的释放"
      ],
      "evidence_mapping": {"primary": "strace 中 brk/munmap 配对", "secondary": "代码中 free 调用"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "内存泄漏严重", "1": "部分释放", "2": "全部正确释放"}
    },
    {
      "concept": "空闲块合并 (coalesce)",
      "weight": 15,
      "atomic_criteria": [
        "free 时检查相邻空闲块",
        "向前/向后合并逻辑正确",
        "合并后块头信息正确更新"
      ],
      "evidence_mapping": {"primary": "代码逻辑分析", "secondary": "输出中合并测试结果"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未实现合并", "1": "单方向合并", "2": "双向合并且头信息正确"}
    },
    {
      "concept": "first-fit/best-fit 分配策略",
      "weight": 15,
      "atomic_criteria": [
        "分配策略逻辑正确实现",
        "碎片率计算正确",
        "两种策略结果对比合理"
      ],
      "evidence_mapping": {"primary": "代码中分配算法", "secondary": "输出碎片率"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "策略逻辑错误", "1": "逻辑正确但碎片率计算错误", "2": "逻辑和计算均正确"}
    },
    {
      "concept": "多级页表模拟",
      "weight": 15,
      "atomic_criteria": [
        "虚拟地址正确分解为 PD/PT/offset",
        "页目录和页表查找逻辑正确",
        "未映射地址触发 page fault"
      ],
      "evidence_mapping": {"primary": "代码中翻译函数", "secondary": "输出翻译结果"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "翻译逻辑完全错误", "1": "部分正确 (缺 page fault)", "2": "完整正确"}
    },
    {
      "concept": "内存泄漏检测",
      "weight": 15,
      "atomic_criteria": [
        "分配跟踪链表正确维护",
        "check_leaks 正确报告未释放记录",
        "使用 __FILE__/__LINE__ 宏记录调用位置"
      ],
      "evidence_mapping": {"primary": "代码中链表管理", "secondary": "输出泄漏检测结果"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "检测功能缺失", "1": "检测但不记录位置", "2": "完整检测含位置信息"}
    }
  ],
  "hard_fail_rules": [
    "malloc 没有 free → 标记内存泄漏",
    "munmap 与 mmap 数量不平衡 → 标记资源泄漏",
    "页表翻译函数返回值不校验 → 标记严重缺陷"
  ]
}'::jsonb, 0.0, TRUE)
ON CONFLICT (experiment_id, version) DO NOTHING;

-- fs 类实验
INSERT INTO experiment_rubrics (experiment_id, version, category, rubric_json, calibration_kappa, is_active)
VALUES ('exp_fs_default', '1.0', 'fs', '{
  "category": "fs",
  "concept_rubrics": [
    {
      "concept": "文件 I/O 系统调用 (open/read/write/close)",
      "weight": 25,
      "atomic_criteria": [
        "open 返回值被检查 (fd >= 0)",
        "read/write 返回值被检查 (>0)",
        "所有打开的 fd 都被 close"
      ],
      "evidence_mapping": {"primary": "strace 中 openat/read/write/close", "secondary": "代码中文件操作调用"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "文件操作错误", "1": "操作正确但缺返回值检查", "2": "完整正确含错误处理"}
    },
    {
      "concept": "缓冲区大小对性能的影响",
      "weight": 20,
      "atomic_criteria": [
        "使用不同缓冲区大小进行测试",
        "耗时测量逻辑正确",
        "结果反映缓冲区大小趋势 (大缓冲区更快)"
      ],
      "evidence_mapping": {"primary": "代码中缓冲区循环", "secondary": "输出耗时数据"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未测试不同缓冲区", "1": "测试但缺耗时测量", "2": "完整测试含耗时对比"}
    },
    {
      "concept": "目录遍历 (opendir/readdir)",
      "weight": 20,
      "atomic_criteria": [
        "使用 opendir/readdir 遍历目录",
        "递归逻辑正确处理子目录",
        "stat/lstat 正确获取文件属性"
      ],
      "evidence_mapping": {"primary": "strace 中 getdents64/stat", "secondary": "代码中目录操作"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "遍历逻辑错误", "1": "遍历但缺属性获取", "2": "完整正确含属性"}
    },
    {
      "concept": "文件描述符管理",
      "weight": 15,
      "atomic_criteria": [
        "open 失败时有错误处理",
        "fd 泄漏检测 (open/close 配对)",
        "文件操作后 fd 被正确关闭"
      ],
      "evidence_mapping": {"primary": "strace 中 openat/close 配对", "secondary": "代码中 close 调用"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "fd 泄漏", "1": "部分 fd 未关闭", "2": "全部 fd 正确关闭"}
    },
    {
      "concept": "inode 与目录项理解",
      "weight": 10,
      "atomic_criteria": [
        "输出中包含 inode 号",
        "正确区分硬链接与符号链接",
        "文件类型判断正确 (d_type)"
      ],
      "evidence_mapping": {"primary": "输出中 inode 数据", "secondary": "代码中 stat 结构使用"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未理解 inode 概念", "1": "部分理解", "2": "完整理解含类型区分"}
    },
    {
      "concept": "文件权限与属性",
      "weight": 10,
      "atomic_criteria": [
        "正确读取文件权限位 (st_mode)",
        "权限字符串格式正确 (rwxrwxrwx)",
        "文件大小等属性输出正确"
      ],
      "evidence_mapping": {"primary": "输出中权限字符串", "secondary": "代码中 st_mode 处理"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "权限读取错误", "1": "读取但格式不正确", "2": "完整正确"}
    }
  ],
  "hard_fail_rules": [
    "open 返回值未检查 → 标记严重缺陷",
    "文件描述符泄漏 (open 后无 close) → 标记资源泄漏",
    "写入文件后未 close → 可能数据丢失，标记缺陷"
  ]
}'::jsonb, 0.0, TRUE)
ON CONFLICT (experiment_id, version) DO NOTHING;

-- sync 类实验
INSERT INTO experiment_rubrics (experiment_id, version, category, rubric_json, calibration_kappa, is_active)
VALUES ('exp_sync_default', '1.0', 'sync', '{
  "category": "sync",
  "concept_rubrics": [
    {
      "concept": "互斥锁 (pthread_mutex)",
      "weight": 25,
      "atomic_criteria": [
        "mutex 正确初始化",
        "临界区被 lock/unlock 保护",
        "unlock 在所有退出路径上被调用"
      ],
      "evidence_mapping": {"primary": "代码中 pthread_mutex 调用", "secondary": "strace 中 futex"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未使用 mutex", "1": "使用但部分路径缺 unlock", "2": "完整正确"}
    },
    {
      "concept": "条件变量 (pthread_cond)",
      "weight": 20,
      "atomic_criteria": [
        "cond_wait 在 mutex 保护下使用",
        "signal/broadcast 正确触发",
        "避免虚假唤醒 (while 循环检查)"
      ],
      "evidence_mapping": {"primary": "代码中 pthread_cond 调用", "secondary": "strace 中 futex"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未使用或使用错误", "1": "使用但无虚假唤醒防护", "2": "完整正确"}
    },
    {
      "concept": "信号量 (semaphore)",
      "weight": 15,
      "atomic_criteria": [
        "sem 值正确初始化",
        "wait/post 配对使用",
        "信号量使用后正确销毁"
      ],
      "evidence_mapping": {"primary": "代码中 sem 调用", "secondary": "strace 中 futex"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未使用或初始化错误", "1": "使用但配对不全", "2": "完整正确"}
    },
    {
      "concept": "生产者-消费者模式",
      "weight": 20,
      "atomic_criteria": [
        "生产者和消费者线程各执行正确逻辑",
        "共享缓冲区访问被同步保护",
        "缓冲区空/满条件正确处理"
      ],
      "evidence_mapping": {"primary": "代码逻辑", "secondary": "输出中生产消费数据"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "同步缺失导致竞争", "1": "有同步但缓冲区处理有缺陷", "2": "完整正确"}
    },
    {
      "concept": "读写锁 (rwlock)",
      "weight": 10,
      "atomic_criteria": [
        "读锁可共享获取",
        "写锁独占获取",
        "解锁正确"
      ],
      "evidence_mapping": {"primary": "代码中 pthread_rwlock 调用", "secondary": "strace 中 futex"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未使用 rwlock", "1": "使用但读写未分离", "2": "完整正确"}
    },
    {
      "concept": "屏障 (barrier)",
      "weight": 10,
      "atomic_criteria": [
        "barrier 正确初始化 (count 参数)",
        "所有线程到达后正确放行",
        "使用后销毁"
      ],
      "evidence_mapping": {"primary": "代码中 pthread_barrier 调用", "secondary": "输出同步结果"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未使用 barrier", "1": "使用但 count 参数错误", "2": "完整正确"}
    }
  ],
  "hard_fail_rules": [
    "mutex 未 unlock → 死锁风险，标记严重缺陷",
    "共享数据无同步保护 → 竞态条件，标记严重缺陷",
    "cond_wait 不在 mutex 保护下使用 → 标记严重缺陷"
  ]
}'::jsonb, 0.0, TRUE)
ON CONFLICT (experiment_id, version) DO NOTHING;

-- deadlock 类实验
INSERT INTO experiment_rubrics (experiment_id, version, category, rubric_json, calibration_kappa, is_active)
VALUES ('exp_deadlock_default', '1.0', 'deadlock', '{
  "category": "deadlock",
  "concept_rubrics": [
    {
      "concept": "死锁四条件理解",
      "weight": 25,
      "atomic_criteria": [
        "能识别互斥/持有并等待/不可剥夺/循环等待四条件",
        "分析中指出违反了哪些条件",
        "建议打破哪个条件来预防死锁"
      ],
      "evidence_mapping": {"primary": "输出分析文本", "secondary": "代码中锁获取顺序"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "四条件理解完全错误", "1": "部分理解", "2": "完整理解且能分析"}
    },
    {
      "concept": "锁顺序一致性",
      "weight": 20,
      "atomic_criteria": [
        "所有线程以相同顺序获取锁",
        "锁获取顺序在代码中明确",
        "没有反向获取锁的死锁路径"
      ],
      "evidence_mapping": {"primary": "代码中 lock 获取顺序", "secondary": "strace 中 futex 时序"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "锁顺序不一致导致死锁", "1": "顺序一致但分析缺失", "2": "顺序一致且分析完整"}
    },
    {
      "concept": "死锁检测方法",
      "weight": 20,
      "atomic_criteria": [
        "使用资源分配图或等待图检测",
        "能检测循环等待",
        "检测算法正确实现"
      ],
      "evidence_mapping": {"primary": "代码中检测算法", "secondary": "输出检测结果"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "无检测能力", "1": "有检测但算法有缺陷", "2": "完整正确检测"}
    },
    {
      "concept": "死锁预防策略",
      "weight": 15,
      "atomic_criteria": [
        "实现了至少一种预防策略 (如锁排序)",
        "策略在代码中正确应用",
        "能解释为何该策略有效"
      ],
      "evidence_mapping": {"primary": "代码中预防策略实现", "secondary": "输出说明"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未实现预防", "1": "实现但不完整", "2": "完整实现且说明"}
    },
    {
      "concept": "超时/trylock 避免死锁",
      "weight": 10,
      "atomic_criteria": [
        "使用 trylock 或超时机制",
        "获取失败时有回退逻辑",
        "回退后释放已持有的锁"
      ],
      "evidence_mapping": {"primary": "代码中 trylock 调用", "secondary": "strace 中 futex"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "无回退机制", "1": "有 trylock 但无回退", "2": "完整 trylock + 回退"}
    },
    {
      "concept": "死锁恢复",
      "weight": 10,
      "atomic_criteria": [
        "实现了死锁恢复机制 (如终止进程)",
        "恢复后系统可继续运行",
        "恢复机制安全 (不破坏数据一致性)"
      ],
      "evidence_mapping": {"primary": "代码中恢复逻辑", "secondary": "输出恢复结果"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "无恢复能力", "1": "有恢复但不安全", "2": "完整安全恢复"}
    }
  ],
  "hard_fail_rules": [
    "锁获取顺序在不同线程中不一致 → 标记死锁风险",
    "未分析四条件就下结论 → 标记分析不充分",
    "死锁检测算法有 vs 未检测到已知循环 → 标记算法缺陷"
  ]
}'::jsonb, 0.0, TRUE)
ON CONFLICT (experiment_id, version) DO NOTHING;

-- scheduling 类实验
INSERT INTO experiment_rubrics (experiment_id, version, category, rubric_json, calibration_kappa, is_active)
VALUES ('exp_scheduling_default', '1.0', 'scheduling', '{
  "category": "scheduling",
  "concept_rubrics": [
    {
      "concept": "调度算法实现 (FCFS/SJF/RR/优先级)",
      "weight": 25,
      "atomic_criteria": [
        "调度逻辑正确实现所选算法",
        "调度顺序输出与算法规则一致",
        "支持多种算法对比"
      ],
      "evidence_mapping": {"primary": "代码中调度函数", "secondary": "输出调度顺序"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "调度逻辑错误", "1": "部分算法正确", "2": "全部算法正确"}
    },
    {
      "concept": "CPU 调度指标计算 (周转时间/等待时间)",
      "weight": 20,
      "atomic_criteria": [
        "周转时间 = 完成时间 - 到达时间",
        "等待时间 = 周转时间 - 服务时间",
        "平均指标计算正确"
      ],
      "evidence_mapping": {"primary": "输出中指标数据", "secondary": "代码中计算函数"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "计算完全错误", "1": "部分正确", "2": "全部正确"}
    },
    {
      "concept": "甘特图可视化",
      "weight": 15,
      "atomic_criteria": [
        "甘特图输出格式正确",
        "时间片/切换点标注准确",
        "空转 CPU 时段正确显示"
      ],
      "evidence_mapping": {"primary": "输出甘特图", "secondary": "代码中绘制函数"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "无甘特图", "1": "有但格式/标注有误", "2": "完整正确"}
    },
    {
      "concept": "时间片轮转 (Round Robin) 量子",
      "weight": 15,
      "atomic_criteria": [
        "时间片量子大小正确设置",
        "量子用完后正确切换",
        "剩余时间不足一个量子时正确处理"
      ],
      "evidence_mapping": {"primary": "代码中 RR 逻辑", "secondary": "输出切换序列"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "时间片逻辑错误", "1": "部分正确", "2": "完整正确"}
    },
    {
      "concept": "优先级调度与饥饿",
      "weight": 10,
      "atomic_criteria": [
        "优先级比较逻辑正确",
        "能识别饥饿现象",
        "实现了老化 (aging) 机制 (如有)"
      ],
      "evidence_mapping": {"primary": "代码中优先级逻辑", "secondary": "输出分析"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "优先级逻辑错误", "1": "逻辑正确但未分析饥饿", "2": "完整含饥饿分析"}
    },
    {
      "concept": "多级反馈队列 (MLFQ)",
      "weight": 15,
      "atomic_criteria": [
        "多级队列优先级正确设置",
        "进程在队列间降级逻辑正确",
        "不同队列时间片大小递增"
      ],
      "evidence_mapping": {"primary": "代码中 MLFQ 逻辑", "secondary": "输出调度序列"},
      "scoring_scale": "3-point",
      "scale_anchors": {"0": "未实现 MLFQ", "1": "实现但降级逻辑有误", "2": "完整正确"}
    }
  ],
  "hard_fail_rules": [
    "调度顺序与算法规则不符 → 标记算法实现错误",
    "周转时间/等待时间计算出错 → 标记严重缺陷",
    "时间片量子大小为 0 或负数 → 标记严重缺陷"
  ]
}'::jsonb, 0.0, TRUE)
ON CONFLICT (experiment_id, version) DO NOTHING;
