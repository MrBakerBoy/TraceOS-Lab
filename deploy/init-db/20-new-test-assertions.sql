-- ============================================================================
-- 20-new-test-assertions.sql
-- 将 3 个样板实验的 test_cases.expected_output 字段从旧格式字符串替换为
-- v2 JSON 断言格式。
--
-- 样板实验:
--   lab1_fork_basic     — 进程创建与父子关系 (Process)
--   lab8_producer_consumer — 生产者-消费者 (Thread/并发)
--   lab24_sched_sim     — 调度算法模拟 (Scheduler)
--
-- 注意:
--   - test_cases.type 已迁移为 "core"/"edge" (schema CHECK 约束已于 22/25 号迁移中更新)
--     new_scorer.go 中 normalizeType() 做向后兼容映射
-- ============================================================================

DO $$
DECLARE
    exp_id UUID;
BEGIN

-- ============================================================================
-- lab1_fork_basic: 进程创建与父子关系
-- ============================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab1_fork_basic';
IF exp_id IS NOT NULL THEN
    -- 先删除旧数据，再插入新数据（确保测试点数量/名称与 plan 一致）
    DELETE FROM test_cases WHERE experiment_id = exp_id;

    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, 'fork创建成功', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Parent:.*PID=\\d+"}],"syscall_assertions":{"required":["clone"]},"behavior_assertions":{"max_runtime_ms":5000}}',
        true, 25, 1
    ),
    (
        exp_id, '父子输出正确', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Child:.*PID=\\d+"},{"mode":"contains","value":"PPID="}]}',
        true, 25, 2
    ),
    (
        exp_id, 'waitpid回收子进程', 'core', '',
        '{"exit_code":0,"syscall_assertions":{"required":["wait4"]},"behavior_assertions":{"no_zombie":true}}',
        true, 20, 3
    ),
    (
        exp_id, 'fork返回值正确使用', 'edge', '',
        '{"exit_code":0,"behavior_assertions":{"max_runtime_ms":5000}}',
        true, 15, 4
    ),
    (
        exp_id, '错误处理', 'edge', '',
        '{"exit_code":[0,1],"syscall_assertions":{"forbidden":["system","execve"]}}',
        true, 15, 5
    );
END IF;

-- ============================================================================
-- lab8_producer_consumer: 生产者-消费者 (多线程同步)
-- ============================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab8_producer_consumer';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;

    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, '多线程创建正确', 'core', '',
        '{"exit_code":0,"syscall_assertions":{"required":["clone"],"min_count":{"clone":4}},"behavior_assertions":{"max_runtime_ms":10000}}',
        true, 25, 1
    ),
    (
        exp_id, '所有数据正确消费', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"All items processed"}],"numeric_assertions":{"mode":"count_distinct","pattern":"Consumed: (\\d+)","min":20,"max":20}}',
        true, 30, 2
    ),
    (
        exp_id, '死锁检测', 'core', '',
        '{"exit_code":0,"behavior_assertions":{"no_deadlock":true}}',
        true, 15, 3
    ),
    (
        exp_id, '缓冲区边界正确', 'edge', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Consumed: 1"},{"mode":"contains","value":"Consumed: 20"}]}',
        true, 15, 4
    ),
    (
        exp_id, '条件变量使用正确', 'edge', '',
        '{"exit_code":0,"syscall_assertions":{"required":["futex"],"min_count":{"futex":4}}}',
        true, 15, 5
    );
END IF;

-- ============================================================================
-- lab24_sched_sim: 调度算法模拟
--   (注意: 原 seed 有 6 个测试点, weight=16; 新方案 5 个测试点, weight=20)
-- ============================================================================
SELECT id INTO exp_id FROM experiments WHERE name = 'lab24_sched_sim';
IF exp_id IS NOT NULL THEN
    DELETE FROM test_cases WHERE experiment_id = exp_id;

    INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
    (
        exp_id, 'FCFS正确输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"FCFS:.*avg.*wait"},{"mode":"contains","value":"avg turnaround"}]}',
        true, 20, 1
    ),
    (
        exp_id, 'SJF正确输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"SJF:"}]}',
        true, 20, 2
    ),
    (
        exp_id, 'RR正确输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"RR:"}]}',
        true, 20, 3
    ),
    (
        exp_id, 'Priority正确输出', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Priority:"}]}',
        true, 20, 4
    ),
    (
        exp_id, '全部完成标记', 'core', '',
        '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Scheduler simulation complete"}]}',
        true, 20, 5
    );
END IF;

END $$;