-- TraceOS Lab - Test Case Enrichment for Multi-Dimensional Scoring
-- Adds expected_patterns and expected_syscalls to key test cases

-- ============================================================================
-- Process: lab1_fork_basic (进程创建与父子关系)
-- ============================================================================
DO $$
DECLARE exp_id UUID;
BEGIN
SELECT id INTO exp_id FROM experiments WHERE name='lab1_fork_basic' LIMIT 1;
IF exp_id IS NOT NULL THEN
  UPDATE test_cases SET expected_patterns = '[{"mode":"regex","pattern":"Parent:\\\\s*PID=\\\\d+","required":true},{"mode":"regex","pattern":"Child:\\\\s*PID=\\\\d+","required":true}]' WHERE experiment_id=exp_id AND name='父子进程均被创建';
  UPDATE test_cases SET expected_patterns = '[{"mode":"regex","pattern":"Child:\\\\s*PID=\\\\d+","required":true}]' WHERE experiment_id=exp_id AND name='子进程输出子进程信息';
END IF;
END $$;

-- ============================================================================
-- Process: lab6_zombie_orphan (僵尸进程与孤儿进程)
-- ============================================================================
DO $$
DECLARE exp_id UUID;
BEGIN
SELECT id INTO exp_id FROM experiments WHERE name='lab6_zombie_orphan' LIMIT 1;
IF exp_id IS NOT NULL THEN
  UPDATE test_cases SET expected_patterns = '[{"mode":"regex","pattern":"Zombie\\\\s*reaped","required":true}]' WHERE experiment_id=exp_id AND name='僵尸进程被回收';
  UPDATE test_cases SET expected_patterns = '[{"mode":"regex","pattern":"new\\\\s*PPID","required":true}]' WHERE experiment_id=exp_id AND name='孤儿进程被init接管';
END IF;
END $$;

-- ============================================================================
-- Thread: lab8_producer_consumer (生产者-消费者)
-- ============================================================================
DO $$
DECLARE exp_id UUID;
BEGIN
SELECT id INTO exp_id FROM experiments WHERE name='lab8_producer_consumer' LIMIT 1;
IF exp_id IS NOT NULL THEN
  UPDATE test_cases SET expected_patterns = '[{"mode":"contains","pattern":"All items processed","required":true}]' WHERE experiment_id=exp_id AND name='20个数据全部消费';
END IF;
END $$;

-- ============================================================================
-- Thread: lab10_threadpool (线程池)
-- ============================================================================
DO $$
DECLARE exp_id UUID;
BEGIN
SELECT id INTO exp_id FROM experiments WHERE name='lab10_threadpool' LIMIT 1;
IF exp_id IS NOT NULL THEN
  UPDATE test_cases SET expected_patterns = '[{"mode":"regex","pattern":"Worker\\\\s+\\\\d+\\\\s+exiting","required":true}]' WHERE experiment_id=exp_id AND name='10个任务全部完成';
END IF;
END $$;

-- ============================================================================
-- Memory: lab14_malloc_impl (malloc/free)
-- ============================================================================
DO $$
DECLARE exp_id UUID;
BEGIN
SELECT id INTO exp_id FROM experiments WHERE name='lab14_malloc_impl' LIMIT 1;
IF exp_id IS NOT NULL THEN
  UPDATE test_cases SET expected_patterns = '[{"mode":"contains","pattern":"Allocated","required":true}]' WHERE experiment_id=exp_id AND name='5个分配成功';
  UPDATE test_cases SET expected_patterns = '[{"mode":"contains","pattern":"Realloc test passed","required":true}]' WHERE experiment_id=exp_id AND name='释放并合并成功';
END IF;
END $$;

-- ============================================================================
-- Deadlock: lab29_banker (银行家算法)
-- ============================================================================
DO $$
DECLARE exp_id UUID;
BEGIN
SELECT id INTO exp_id FROM experiments WHERE name='lab29_banker' LIMIT 1;
IF exp_id IS NOT NULL THEN
  UPDATE test_cases SET expected_patterns = '[{"mode":"contains","pattern":"Bankers algorithm test complete","required":true}]' WHERE experiment_id=exp_id AND name='安全序列正确';
  UPDATE test_cases SET expected_patterns = '[{"mode":"regex","pattern":"Request\\\\s+granted","required":true}]' WHERE experiment_id=exp_id AND name='P1请求被批准';
  UPDATE test_cases SET expected_patterns = '[{"mode":"regex","pattern":"Request\\\\s+denied","required":true}]' WHERE experiment_id=exp_id AND name='P4请求被拒绝';
END IF;
END $$;

-- ============================================================================
-- Deadlock: lab30_deadlock_detect (死锁检测)
-- ============================================================================
DO $$
DECLARE exp_id UUID;
BEGIN
SELECT id INTO exp_id FROM experiments WHERE name='lab30_deadlock_detect' LIMIT 1;
IF exp_id IS NOT NULL THEN
  UPDATE test_cases SET expected_patterns = '[{"mode":"regex","pattern":"Deadlock\\\\s+detected","required":true}]' WHERE experiment_id=exp_id AND name='死锁检测出环';
  UPDATE test_cases SET expected_patterns = '[{"mode":"regex","pattern":"No\\\\s+deadlock","required":true}]' WHERE experiment_id=exp_id AND name='释放后死锁解除';
END IF;
END $$;
