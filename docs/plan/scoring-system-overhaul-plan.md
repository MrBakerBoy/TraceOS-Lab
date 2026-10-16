# 评分系统全面改造方案

> 版本: v2.0 | 日期: 2026-08-13 | 作者: TraceOS Lab Team

---

## 目录

1. [改造目标与原则](#1-改造目标与原则)
2. [测试断言 JSON Schema 设计](#2-测试断言-json-schema-设计)
3. [样板实验](#3-样板实验)
4. [新评分引擎设计](#4-新评分引擎设计)
5. [eBPF/Strace 客观指标参与评分](#5-ebpfstrace-客观指标参与评分)
6. [is_qualified 合格判定机制](#6-is_qualified-合格判定机制)
7. [参考实现管理](#7-参考实现管理)
8. [AI 诊断角色边界](#8-ai-诊断角色边界)
9. [数据库变更](#9-数据库变更)
10. [代码改造清单（第一轮）](#10-代码改造清单第一轮)
11. [验证计划](#11-验证计划)
12. [JSON Schema 校验文档](#12-json-schema-校验文档)

---

## 0. 业界调研参考

> 调研时间: 2026-08 | 来源: rCore/ucore/educg/Pintos 公开文档

### 0.1 rCore Tutorial（清华大学，Rust + RISC-V）

- **结构**: 8 章，从执行环境 → 批处理 → 多道程序 → 地址空间 → 进程 → 文件系统 → IPC → 并发
- **每章练习结构**: 编程作业 + 问答作业 + 报告要求 + 选做题目
- **评测方式**: CI 自动评测（将用户态测试程序 `chX_usertest` 替换 `initproc`，内核跑完所有测例后退出）+ 人工评报告和问答
- **前向兼容**: 每章内核必须通过之前所有章节的测例（`make run BASE=2` 加载全部测例）
- **数学条件断言**: stride 调度公平性用 `max(runtimes/prio) / min(runtimes/prio) < 1.5` 精确判定
- **选做分层**: 基本功能保及格，challenge 题目额外加分（如多核支持 +7 分、Copy-on-Write +6 分）

### 0.2 ucore（清华大学，C + x86）

- **结构**: 8 个 lab，启动 → 物理内存 → 虚拟内存 → 内核线程 → 用户进程 → 调度 → 同步互斥 → 文件系统
- **每 lab 练习结构**: 填空式编程（补全缺失函数）+ 问答 + 扩展 challenge
- **评测方式**: 人工检查代码实现 + 人工评报告（无自动评测）
- **前向兼容**: lab0 机制要求将上一 lab 代码合并入当前分支
- **扩展练习**: buddy system 伙伴分配器、slub 分配器等选做题，单独提交

### 0.3 educg 希冀平台（北航，支撑全国 OS 设计大赛）

- **定位**: 在线硬件实验评测平台，覆盖 CPU/OS/编译器/数据库/智能系统
- **评测能力**: 功能评测 + 性能评测，单台服务器支撑 2 万并发提交
- **覆盖**: 400+ 高校，包括北航、国防科大、武大、中科大等

### 0.4 Pintos（Stanford）

- **结构**: 4 个项目，线程 → 用户程序 → 虚拟内存 → 文件系统
- **评测方式**: 测试脚本 pass/fail + 人工报告
- **失败条件**: kernel panic / 断言失败 / 超时 = 失败；27 个测试中仅 5-6 个是评分测试
- **并发测试**: 测试脚本中注入特定调度顺序来验证同步正确性

### 0.5 对本计划的启示

| 启示 | 来源 | 采纳方式 |
|------|------|----------|
| 前向兼容约束 | rCore, ucore | 可延后：为 `experiments` 表增加 `prerequisites` 字段（不在本轮） |
| 数学条件断言 | rCore stride 调度 | 本轮加入 `numeric_assertions` 可选键（见 2.2.5 节） |
| 测试点独立维度 | Pintos | 本轮加入测试点设计原则（见 2.6 节）：每个测试点只测一个维度 |
| 并发正确性校验 | Pintos, rCore ch8 | 本轮修复生产者-消费者断言：增加线程数量 + 数据不重复校验（见 3.2 节） |

---

## 1. 改造目标与原则

### 1.1 核心原则

| # | 原则 | 说明 |
|---|------|------|
| P1 | **测试断言即评分** | 每个测试用例携带一组行为断言，断言全部通过则该测试点得分，反之不得分 |
| P2 | **eBPF/Strace 观测指标参与评分** | 资源泄漏、系统调用集合、死锁检测等客观运行指标作为断言条件，直接决定测试点通过与否 |
| P3 | **AI 诊断不参与评分** | 大模型输出的文本分析、错误推理、改进建议，仅作为教学反馈，不进入任何分数计算 |
| P4 | **参考实现 ≠ 评分基准** | 参考实现仅用于验证断言自身的正确性；严禁拿参考实现的输出/trace 做全文 diff 比对判分 |
| P5 | **分数与合格解耦** | `total_score` 客观反映完成度，`is_qualified` 独立判定业务是否通过 |
| P6 | **100% 可复现** | 同一份代码 + 同一套测试断言，任意时刻运行得到完全相同的分数和判定结果 |
| P7 | **测试点自包含** | 每个测试用例的断言完全独立，一个测试点的行为约束只影响该测试点的分数 |

### 1.2 废弃内容

| 废弃项 | 替代方案 |
|--------|----------|
| `Score()` 三元公式（output + structure + behavior） | 测试点加权累加 |
| `hasSubstantialCode()` 宽松检测 | 编译通过即进入测试，无额外"实质代码"判断 |
| `ScoreRubric()` concept_rubrics 评分 | 改用测试断言，概念评估仅用于 AI 诊断参考 |
| `behavior_scorer.go` 微量扣分机制 | 改用断言级 pass/fail |
| `ScoreBehavior()` 保底 50% 行为分 | 行为断言直接决定测试点 pass/fail |
| `trace_diff.go` 参与评分的 similarity 逻辑 | 保留序列对齐功能仅作展示/调试，不参与评分 |
| `hasSubstantialCode` 结构分满分配分逻辑 | 完全移除 |
| `behaviorScore = (0.5*passRate + 0.5)*max` 保底公式 | 完全移除 |

### 1.3 两轮迭代计划

#### 第一轮（当前，优先级最高）：评测内核改造

**目标：修复"烂代码拿高分"核心 bug，打通正确评分链路。**

修改范围：
- `test_cases` 表：`expected_output` 字段复用为 JSON 断言存储（不改表结构）
- `comparator.go`：新增 JSON 断言解析 + 逐断言评估
- `scorer.go`：废弃旧三元公式，改为测试点加权累加
- `rubric_scorer.go`：标记 deprecated，不再被 pipeline 调用
- `behavior_scorer.go`：移除 trace_similarity 评分逻辑
- `trace_diff.go`：移除评分侧 similarity 引用，仅保留展示功能
- `pipeline.go`：切换到新评分管道
- DB 种子数据：先输出 lab1_fork_basic、lab8_producer_consumer 两个样板，确认后批量替换其余 29 个

**不改动：**
- `experiments` 表的 `name` / `title` / `description` / `instructions`
- 实验 ID 保持不变
- eBPF 采集器、pipeline 编译/运行逻辑、nsjail 运行时代码

#### 第二轮（打分修复完成后）：实验题目 & 描述优化

- 对全部 31 个实验做文案审计
- 每个实验：标题规范化；描述与测试断言一一对应；hint 内容优化
- 保留原有 `exp_id`、实验短 `name`，不修改主键
- 需求 ↔ 测试点 双向对齐

**例外：如果某个实验的题目描述和本轮设计的测试断言完全矛盾 → 本轮必须同步修正描述，否则测试和需求对不上。**

### 1.4 本轮约束

1. **不改动** eBPF 采集、pipeline 编译运行、nsjail 运行时代码
2. **不改动** `test_cases` 表结构（字段不变，语义升级）
3. **不新增** `test_cases` 列（`expected_output` 字段复用）
4. **参考实现** 存储在已有的 `experiment_code_templates` 表
5. **先输出 3 个样板**（lab1_fork_basic + lab8_producer_consumer + lab24_sched_sim），确认后再批量

---

## 2. 测试断言 JSON Schema 设计

### 2.1 完整 Schema 定义

每个测试用例的 `expected_output` 字段存储以下 JSON：

```json
{
  "exit_code": 0,
  "output_assertions": [
    {"mode": "contains", "value": "Parent: PID="},
    {"mode": "regex", "value": "Child: PID=\\d+, PPID=\\d+"},
    {"mode": "not_contains", "value": "ERROR"},
    {"mode": "exact_match", "value": ""}
  ],
  "syscall_assertions": {
    "required": ["clone", "wait4"],
    "forbidden": ["system"],
    "min_count": {"write": 1},
    "max_count": {"fork": 10}
  },
  "behavior_assertions": {
    "no_fd_leak": true,
    "no_zombie": true,
    "no_deadlock": false,
    "max_memory_kb": 131072
  }
}
```

### 2.2 字段语义详解

#### 2.2.1 `exit_code`（必填）

- **类型**：`number` 或 `number[]`
- **语义**：
  - `0`：期望退出码为 0
  - `[0, 1]`：允许退出码为 0 或 1（适配多合法退出码的边界用例）
- **判定**：学生程序实际退出码 ∈ 允许集合 → 通过

#### 2.2.2 `output_assertions`（可选，数组）

每个元素为 `{"mode": "<mode>", "value": "<string>"}`。

| mode | 语义 | 示例 |
|------|------|------|
| `contains` | 学生输出（normalized）必须包含 value | `{"mode":"contains","value":"Parent: PID="}` |
| `not_contains` | 学生输出（normalized）不得包含 value | `{"mode":"not_contains","value":"ERROR"}` |
| `regex` | value 作为正则表达式匹配学生输出 | `{"mode":"regex","value":"Child: PID=\\d+, PPID=\\d+"}` |
| `exact_match` | 学生输出（trim + normalize whitespace）与 value 完全一致 | `{"mode":"exact_match","value":""}` 表示真正无输出 |

**判定逻辑**：数组内所有断言是 AND 关系——全部通过则该测试点的 output_assertions 通过。

**normalized 含义**：比较前对学生输出和 value 做以下处理：
- 所有 `PID=\d+` / `TID=\d+` / `0x[0-9a-f]+` / `\d{2}:\d{2}:\d{2}\.\d+` → 替换为占位符
- 多余空白符折叠为单个空格

#### 2.2.3 `syscall_assertions`（可选，对象）

| 字段 | 类型 | 语义 |
|------|------|------|
| `required` | `string[]` | 必须出现的系统调用（支持别名，如 `clone` 匹配 `clone`/`clone3`/`fork`/`vfork`） |
| `forbidden` | `string[]` | 禁止出现的系统调用（同样支持别名） |
| `min_count` | `{string: number}` | 指定系统调用的最小出现次数 |
| `max_count` | `{string: number}` | 指定系统调用的最大出现次数 |

**判定逻辑**：所有子断言 AND 关系。任一 required 缺失 → 失败；任一 forbidden 存在 → 失败；实际 count 超出 min/max 范围 → 失败。

#### 2.2.4 `behavior_assertions`（可选，对象）

| 字段 | 类型 | 语义 |
|------|------|------|
| `no_fd_leak` | `boolean` | `true`：要求无 FD 泄漏（open/close 配对）；`false`：不校验 |
| `no_zombie` | `boolean` | `true`：要求无僵尸进程（clone/wait4 配对）；`false`：不校验 |
| `no_deadlock` | `boolean` | `true`：要求无死锁（程序在 timeout 内正常退出）；`false`：不校验 |
| `max_memory_kb` | `number` | 最大内存使用量（KB），超出则失败 |
| `max_runtime_ms` | `number` | 最大运行时间（毫秒），超出则失败 |

**判定逻辑**：`true` 的字段 → 不满足则该测试点失败。`false` 的字段 → 不做该项校验。

**语义澄清**：`false` 不是"要求发生泄漏/死锁"，而是"不做校验"。

#### 2.2.5 `numeric_assertions`（可选，对象）

用于数学条件断言（对标 rCore stride 调度的公平性公式）。对输出做模式提取后施加数值约束。

| 字段 | 类型 | 语义 |
|------|------|------|
| `mode` | `string` | 约束模式：`range` / `comparison` / `set_equality` / `count_distinct` |
| `pattern` | `string` | 正则表达式，从归一化后的学生输出中提取数值（捕获组 1） |
| `min` | `number` | 提取值的下限（含），用于 `range` / `count_distinct` 模式 |
| `max` | `number` | 提取值的上限（含），用于 `range` / `count_distinct` 模式 |
| `expected` | `number[]` | 期望的完整数值集合（用于 `set_equality` 模式） |
| `formula` | `string` | 数学表达式模板（用于 `comparison` 模式），如 `"max/min < 1.5"` |

**示例**：

```json
// range 模式：确保输出中出现 1-20 全部值
{"numeric_assertions":{"mode":"count_distinct","pattern":"Consumed: (\\d+)","min":20,"max":20}}

// comparison 模式：调度公平性
{"numeric_assertions":{"mode":"comparison","pattern":"runtime=(\\d+), prio=(\\d+)","formula":"max(runtime/prio) / min(runtime/prio) < 1.5"}}

// set_equality 模式：期望消费集合完全等于 [1..20]
{"numeric_assertions":{"mode":"set_equality","pattern":"Consumed: (\\d+)","expected":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]}}
```

**使用建议**：当 `output_assertions` 的 `contains`/`regex` 无法表达数值约束时使用。绝大多数实验用 `output_assertions` 就够，`numeric_assertions` 主要用于调度算法和并发数据完整性校验。

### 2.3 测试点通过判定

一个测试点通过 = 该测试点断言 JSON 中**所有存在的断言类型全部通过**（AND 关系）。

```
test_point.passed =
    exit_code_check_passed
    AND all output_assertions passed
    AND all syscall_assertions passed
    AND all behavior_assertions passed
```

### 2.4 旧数据兼容迁移逻辑

`expected_output` 字段的解析按以下优先级：

```
1. 尝试 JSON 解析
   ├─ 成功 → 按新 Schema 评估
   └─ 失败 → 进入兼容逻辑

2. 兼容逻辑（旧格式字符串）
   ├─ 空字符串 "" → {"output_assertions":[{"mode":"exact_match","value":""}]}
   │                 （兼容旧语义：旧代码中空字符串=退出码0即通过，现在明确表示"期望无输出"）
   └─ 非空字符串 "xxx" → {"output_assertions":[{"mode":"contains","value":"xxx"}]}
```

**重要**：旧版本中 `expected_output=''` 语义是"只要退出码正确就算通过"。迁移后改为 `exact_match` 模式明确表达意图。对于确实不需要输出断言的测试点，可以完全省略 `output_assertions` 字段。

### 2.5 JSON 设计约束

- JSON 内不允许带注释（`//` 或 `/* */`）
- 注释写在代码注释或文档中
- `output_assertions.mode` 枚举仅限 4 种：`contains` / `not_contains` / `regex` / `exact_match`
- 不再拆分更多顶层 key，当前 4 个顶级字段（`exit_code`、`output_assertions`、`syscall_assertions`、`behavior_assertions`）已足够

### 2.6 测试点设计原则

基于 Pintos 和 rCore 的实践经验，每个测试点**只测一个独立维度**，避免同一断言在不同测试点之间重复出现。

**正确做法**：

```
测试点 1：纯输出内容（output_assertions + exit_code）
测试点 2：纯 syscall 行为（syscall_assertions）
测试点 3：纯运行行为（behavior_assertions: no_deadlock, no_zombie）
测试点 4：边界条件（output_assertions + 特定边界值）
测试点 5：数值完整性（numeric_assertions）
```

**错误做法**：

```
测试点 1：output_assertions + syscall_assertions + behavior_assertions 全塞在一起
测试点 2：behavior_assertions 与测试点 1 的完全相同（冗余）
测试点 3：syscall_assertions 与测试点 2 的完全相同（冗余）
```

**原因**：同一 bug 导致多个测试点同时失败 → 分数翻倍扣。每个测试点只测一个维度时，bug 只影响对应的那个测试点。

**例外**：`exit_code` 例外。所有测试点都允许带 `exit_code` 校验（因为程序崩溃时所有维度都无需再测，提前退出判断）。

---

## 3. 样板实验

以下 3 个样板覆盖 process（系统调用行为）、thread（并发同步）和 scheduler（调度算法）三类典型场景。确认通过后批量完成其余 28 个。

### 3.1 Process 样板 — lab1_fork_basic（进程创建与父子关系）

#### 3.1.1 实验要求（保持现有 description 不变）

使用 `fork()` 创建子进程。父进程输出包含 `Parent: PID=xxx, Child PID=yyy`，子进程输出包含 `Child: PID=xxx, PPID=yyy`。父进程必须用 `waitpid` 回收子进程。输出顺序不做要求。

#### 3.1.2 测试用例设计（5 个测试点，总分 100）

| # | 名称 | 类型 | 权重 | 核心断言 |
|---|------|------|------|----------|
| 1 | `fork创建成功` | core | 25 | exit_code=0; output_assertions: 包含 `Parent:`; syscall_assertions: required `clone` |
| 2 | `父子输出正确` | core | 25 | output_assertions: 包含 `Child:` 和 `PPID=`; regex 验证 PID 格式 |
| 3 | `waitpid回收子进程` | core | 20 | syscall_assertions: required `wait4`; behavior_assertions: no_zombie=true |
| 4 | `fork返回值正确使用` | edge | 15 | behavior_assertions: 父进程输出中的 Child PID 与子进程自身 PID 一致 |
| 5 | `错误处理` | edge | 15 | syscall_assertions: forbidden `system`,`execve`; exit_code=[0,1] |

#### 3.1.3 断言 JSON（expected_output 字段内容）

测试点 1 — fork创建成功：

```json
{
  "exit_code": 0,
  "output_assertions": [
    {"mode": "regex", "value": "Parent:.*PID=\\d+"}
  ],
  "syscall_assertions": {
    "required": ["clone"]
  },
  "behavior_assertions": {
    "max_runtime_ms": 5000
  }
}
```

测试点 2 — 父子输出正确：

```json
{
  "exit_code": 0,
  "output_assertions": [
    {"mode": "regex", "value": "Child:.*PID=\\d+"},
    {"mode": "contains", "value": "PPID="}
  ]
}
```

测试点 3 — waitpid回收子进程：

```json
{
  "exit_code": 0,
  "syscall_assertions": {
    "required": ["wait4"]
  },
  "behavior_assertions": {
    "no_zombie": true
  }
}
```

测试点 4 — fork返回值正确使用：

```json
{
  "exit_code": 0,
  "behavior_assertions": {
    "max_runtime_ms": 5000
  }
}
```

测试点 5 — 错误处理：

```json
{
  "exit_code": [0, 1],
  "syscall_assertions": {
    "forbidden": ["system", "execve"]
  }
}
```

#### 3.1.4 SQL 种子数据

```sql
-- lab1_fork_basic 测试用例
SELECT id INTO exp_id FROM experiments WHERE name='lab1_fork_basic' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
(exp_id, 'fork创建成功', 'core', '', '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Parent:.*PID=\\d+"}],"syscall_assertions":{"required":["clone"]},"behavior_assertions":{"max_runtime_ms":5000}}', true, 25, 1),
(exp_id, '父子输出正确', 'core', '', '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"Child:.*PID=\\d+"},{"mode":"contains","value":"PPID="}]}', true, 25, 2),
(exp_id, 'waitpid回收子进程', 'core', '', '{"exit_code":0,"syscall_assertions":{"required":["wait4"]},"behavior_assertions":{"no_zombie":true}}', true, 20, 3),
(exp_id, 'fork返回值正确使用', 'edge', '', '{"exit_code":0,"behavior_assertions":{"max_runtime_ms":5000}}', true, 15, 4),
(exp_id, '错误处理', 'edge', '', '{"exit_code":[0,1],"syscall_assertions":{"forbidden":["system","execve"]}}', true, 15, 5)
ON CONFLICT DO NOTHING;
END IF;
```

#### 3.1.5 C 参考实现

```c
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    pid_t pid = fork();

    if (pid < 0) {
        perror("fork");
        return 1;
    }

    if (pid == 0) {
        /* 子进程 */
        printf("Child: PID=%d, PPID=%d\n", getpid(), getppid());
        return 0;
    } else {
        /* 父进程 */
        printf("Parent: PID=%d, Child PID=%d\n", getpid(), pid);
        int status;
        waitpid(pid, &status, 0);
    }

    return 0;
}
```

#### 3.1.6 Golden 运行输出

```
Parent: PID=1234, Child PID=1235
Child: PID=1235, PPID=1234
```

（PID 值每次运行不同，但格式和关系不变）

#### 3.1.7 Golden Strace Trace（关键摘要）

```
clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, ...) = 1235
--- 子进程 ---
getpid() = 1235
getppid() = 1234
write(1, "Child: PID=1235, PPID=1234\n", 27) = 27
exit_group(0) = ?
--- 父进程 ---
write(1, "Parent: PID=1234, Child PID=1235\n", 33) = 33
wait4(1235, [{WIFEXITED(s) && WEXITSTATUS(s) == 0}], 0, NULL) = 1235
exit_group(0) = ?
```

### 3.2 Thread 样板 — lab8_producer_consumer（生产者-消费者）

#### 3.2.1 实验要求（保持现有 description 不变）

创建 2 个生产者线程和 2 个消费者线程，共享容量为 5 的环形缓冲区。生产者向缓冲区放入递增的数据项 1-20，消费者取出并打印 `Consumed: N`。使用 mutex + 条件变量同步，确保不会溢出或读取空缓冲区。所有线程结束后输出 `All items processed`。

#### 3.2.2 测试用例设计（5 个测试点，总分 100）

每个测试点只测一个独立维度：

| # | 名称 | 类型 | 权重 | 核心断言 |
|---|------|------|------|----------|
| 1 | `多线程创建正确` | core | 25 | exit_code=0; syscall_assertions: `clone` 至少出现 4 次（2 生产者 + 2 消费者） |
| 2 | `所有数据正确消费` | core | 30 | exit_code=0; output_assertions: 包含 `All items processed`; numeric_assertions: 输出中出现 1-20 全部且不重复 |
| 3 | `死锁检测` | core | 15 | exit_code=0; behavior_assertions: `no_deadlock=true`（程序在 timeout 内正常退出） |
| 4 | `缓冲区边界正确` | edge | 15 | exit_code=0; 程序不崩溃; 输出包含 `Consumed: 1` 和 `Consumed: 20` |
| 5 | `条件变量使用正确` | edge | 15 | exit_code=0; syscall_assertions: `futex` 至少出现 4 次（pthread_cond_wait/signal 依赖 futex） |

#### 3.2.3 断言 JSON

测试点 1 — 多线程创建正确：

```json
{
  "exit_code": 0,
  "syscall_assertions": {
    "required": ["clone"],
    "min_count": {"clone": 4}
  },
  "behavior_assertions": {
    "max_runtime_ms": 10000
  }
}
```

测试点 2 — 所有数据正确消费：

```json
{
  "exit_code": 0,
  "output_assertions": [
    {"mode": "contains", "value": "All items processed"}
  ],
  "numeric_assertions": {
    "mode": "count_distinct",
    "pattern": "Consumed: (\\d+)",
    "min": 20,
    "max": 20
  }
}
```

测试点 3 — 死锁检测：

```json
{
  "exit_code": 0,
  "behavior_assertions": {
    "no_deadlock": true
  }
}
```

测试点 4 — 缓冲区边界正确：

```json
{
  "exit_code": 0,
  "output_assertions": [
    {"mode": "contains", "value": "Consumed: 1"},
    {"mode": "contains", "value": "Consumed: 20"}
  ]
}
```

测试点 5 — 条件变量使用正确：

```json
{
  "exit_code": 0,
  "syscall_assertions": {
    "required": ["futex"],
    "min_count": {"futex": 4}
  }
}
```

#### 3.2.4 SQL 种子数据

```sql
SELECT id INTO exp_id FROM experiments WHERE name='lab8_producer_consumer' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
(exp_id, '多线程创建正确', 'core', '', '{"exit_code":0,"syscall_assertions":{"required":["clone"],"min_count":{"clone":4}},"behavior_assertions":{"max_runtime_ms":10000}}', true, 25, 1),
(exp_id, '所有数据正确消费', 'core', '', '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"All items processed"}],"numeric_assertions":{"mode":"count_distinct","pattern":"Consumed: (\\d+)","min":20,"max":20}}', true, 30, 2),
(exp_id, '死锁检测', 'core', '', '{"exit_code":0,"behavior_assertions":{"no_deadlock":true}}', true, 15, 3),
(exp_id, '缓冲区边界正确', 'edge', '', '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Consumed: 1"},{"mode":"contains","value":"Consumed: 20"}]}', true, 15, 4),
(exp_id, '条件变量使用正确', 'edge', '', '{"exit_code":0,"syscall_assertions":{"required":["futex"],"min_count":{"futex":4}}}', true, 15, 5)
ON CONFLICT DO NOTHING;
END IF;
```

#### 3.2.5 C 参考实现

```c
#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <unistd.h>

#define BUFFER_SIZE 5
#define TOTAL_ITEMS 20

int buffer[BUFFER_SIZE];
int count = 0;
int in = 0, out = 0;
int next_produce = 1;
int total_consumed = 0;

pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t not_full = PTHREAD_COND_INITIALIZER;
pthread_cond_t not_empty = PTHREAD_COND_INITIALIZER;

void* producer(void* arg) {
    while (1) {
        pthread_mutex_lock(&mutex);
        if (next_produce > TOTAL_ITEMS) {
            pthread_mutex_unlock(&mutex);
            break;
        }
        while (count == BUFFER_SIZE) {
            pthread_cond_wait(&not_full, &mutex);
        }
        buffer[in] = next_produce++;
        in = (in + 1) % BUFFER_SIZE;
        count++;
        pthread_cond_signal(&not_empty);
        pthread_mutex_unlock(&mutex);
    }
    return NULL;
}

void* consumer(void* arg) {
    while (1) {
        pthread_mutex_lock(&mutex);
        if (total_consumed >= TOTAL_ITEMS) {
            pthread_mutex_unlock(&mutex);
            break;
        }
        while (count == 0) {
            pthread_cond_wait(&not_empty, &mutex);
        }
        int item = buffer[out];
        out = (out + 1) % BUFFER_SIZE;
        count--;
        total_consumed++;
        printf("Consumed: %d\n", item);
        pthread_cond_signal(&not_full);
        pthread_mutex_unlock(&mutex);
    }
    return NULL;
}

int main() {
    pthread_t producers[2], consumers[2];
    for (int i = 0; i < 2; i++) {
        pthread_create(&producers[i], NULL, producer, NULL);
        pthread_create(&consumers[i], NULL, consumer, NULL);
    }
    for (int i = 0; i < 2; i++) {
        pthread_join(producers[i], NULL);
        pthread_join(consumers[i], NULL);
    }
    printf("All items processed\n");
    return 0;
}
```

### 3.3 Scheduler 样板 — lab24_sched_sim（调度算法模拟）

#### 3.3.1 实验要求（保持现有 description 不变）

实现调度算法模拟器，支持 FCFS/SJF(非抢占)/RR(时间片=2)/Priority(非抢占)4 种算法。输入进程: P1(到达0,执行8,优先级2) P2(到达1,执行4,优先级1) P3(到达2,执行9,优先级3) P4(到达3,执行5,优先级2)。输出每种算法的平均等待时间和平均周转时间。

#### 3.3.2 测试用例设计（5 个测试点，总分 100）

| # | 名称 | 类型 | 权重 | 核心断言 |
|---|------|------|------|----------|
| 1 | `FCFS正确输出` | core | 20 | exit_code=0; output_assertions: 包含 `FCFS:` 和平均等待/周转时间 |
| 2 | `SJF正确输出` | core | 20 | exit_code=0; output_assertions: 包含 `SJF:` |
| 3 | `RR正确输出` | core | 20 | exit_code=0; output_assertions: 包含 `RR:` |
| 4 | `Priority正确输出` | core | 20 | exit_code=0; output_assertions: 包含 `Priority:` |
| 5 | `全部完成标记` | core | 20 | exit_code=0; output_assertions: 包含 `Scheduler simulation complete` |

#### 3.3.3 断言 JSON

测试点 1 — FCFS正确输出：

```json
{
  "exit_code": 0,
  "output_assertions": [
    {"mode": "regex", "value": "FCFS:.*avg.*wait"},
    {"mode": "contains", "value": "avg turnaround"}
  ]
}
```

测试点 2 — SJF正确输出：

```json
{
  "exit_code": 0,
  "output_assertions": [
    {"mode": "contains", "value": "SJF:"}
  ]
}
```

测试点 3 — RR正确输出：

```json
{
  "exit_code": 0,
  "output_assertions": [
    {"mode": "contains", "value": "RR:"}
  ]
}
```

测试点 4 — Priority正确输出：

```json
{
  "exit_code": 0,
  "output_assertions": [
    {"mode": "contains", "value": "Priority:"}
  ]
}
```

测试点 5 — 全部完成标记：

```json
{
  "exit_code": 0,
  "output_assertions": [
    {"mode": "contains", "value": "Scheduler simulation complete"}
  ]
}
```

#### 3.3.4 SQL 种子数据

```sql
SELECT id INTO exp_id FROM experiments WHERE name='lab24_sched_sim' LIMIT 1;
IF exp_id IS NOT NULL THEN
INSERT INTO test_cases (experiment_id, name, type, input_data, expected_output, is_public, score_weight, order_index) VALUES
(exp_id, 'FCFS正确输出', 'core', '', '{"exit_code":0,"output_assertions":[{"mode":"regex","value":"FCFS:.*avg.*wait"},{"mode":"contains","value":"avg turnaround"}]}', true, 20, 1),
(exp_id, 'SJF正确输出', 'core', '', '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"SJF:"}]}', true, 20, 2),
(exp_id, 'RR正确输出', 'core', '', '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"RR:"}]}', true, 20, 3),
(exp_id, 'Priority正确输出', 'core', '', '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Priority:"}]}', true, 20, 4),
(exp_id, '全部完成标记', 'core', '', '{"exit_code":0,"output_assertions":[{"mode":"contains","value":"Scheduler simulation complete"}]}', true, 20, 5)
ON CONFLICT DO NOTHING;
END IF;
```

#### 3.3.5 C 参考实现

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>

#define MAX_PROC 10

typedef struct {
    int pid, arrival, burst, priority;
    int remaining, completed, start_time, finish_time;
} Process;

void fcfs(Process p[], int n) {
    int time = 0, total_wait = 0, total_turnaround = 0;
    for (int i = 0; i < n; i++) {
        if (time < p[i].arrival) time = p[i].arrival;
        p[i].start_time = time;
        time += p[i].burst;
        p[i].finish_time = time;
        total_wait += p[i].start_time - p[i].arrival;
        total_turnaround += p[i].finish_time - p[i].arrival;
    }
    printf("FCFS: avg wait=%.2f, avg turnaround=%.2f\n",
        (float)total_wait/n, (float)total_turnaround/n);
}

void sjf(Process p[], int n) {
    Process temp[MAX_PROC];
    memcpy(temp, p, sizeof(Process)*n);
    int done = 0, time = 0, total_wait = 0, total_turnaround = 0;
    int completed[MAX_PROC] = {0};
    while (done < n) {
        int idx = -1, min_burst = INT_MAX;
        for (int i = 0; i < n; i++) {
            if (!completed[i] && temp[i].arrival <= time && temp[i].burst < min_burst) {
                min_burst = temp[i].burst; idx = i;
            }
        }
        if (idx == -1) { time++; continue; }
        temp[idx].start_time = time;
        time += temp[idx].burst;
        temp[idx].finish_time = time;
        completed[idx] = 1; done++;
        total_wait += temp[idx].start_time - temp[idx].arrival;
        total_turnaround += temp[idx].finish_time - temp[idx].arrival;
    }
    printf("SJF: avg wait=%.2f, avg turnaround=%.2f\n",
        (float)total_wait/n, (float)total_turnaround/n);
}

void rr(Process p[], int n, int quantum) {
    Process temp[MAX_PROC];
    memcpy(temp, p, sizeof(Process)*n);
    for (int i = 0; i < n; i++) temp[i].remaining = temp[i].burst;
    int done = 0, time = 0, total_wait = 0, total_turnaround = 0;
    int started[MAX_PROC] = {0};
    while (done < n) {
        int progressed = 0;
        for (int i = 0; i < n; i++) {
            if (temp[i].remaining > 0 && temp[i].arrival <= time) {
                if (!started[i]) {
                    temp[i].start_time = time;
                    started[i] = 1;
                }
                int run = temp[i].remaining < quantum ? temp[i].remaining : quantum;
                temp[i].remaining -= run;
                time += run;
                progressed = 1;
                if (temp[i].remaining == 0) {
                    temp[i].finish_time = time;
                    done++;
                    total_wait += temp[i].start_time - temp[i].arrival;
                    total_turnaround += temp[i].finish_time - temp[i].arrival;
                }
            }
        }
        if (!progressed) time++;
    }
    printf("RR: avg wait=%.2f, avg turnaround=%.2f\n",
        (float)total_wait/n, (float)total_turnaround/n);
}

void priority_sched(Process p[], int n) {
    Process temp[MAX_PROC];
    memcpy(temp, p, sizeof(Process)*n);
    int done = 0, time = 0, total_wait = 0, total_turnaround = 0;
    int completed[MAX_PROC] = {0};
    while (done < n) {
        int idx = -1, highest = INT_MAX;
        for (int i = 0; i < n; i++) {
            if (!completed[i] && temp[i].arrival <= time && temp[i].priority < highest) {
                highest = temp[i].priority; idx = i;
            }
        }
        if (idx == -1) { time++; continue; }
        temp[idx].start_time = time;
        time += temp[idx].burst;
        temp[idx].finish_time = time;
        completed[idx] = 1; done++;
        total_wait += temp[idx].start_time - temp[idx].arrival;
        total_turnaround += temp[idx].finish_time - temp[idx].arrival;
    }
    printf("Priority: avg wait=%.2f, avg turnaround=%.2f\n",
        (float)total_wait/n, (float)total_turnaround/n);
}

int main() {
    Process procs[] = {
        {1,0,8,2}, {2,1,4,1}, {3,2,9,3}, {4,3,5,2}
    };
    int n = 4;
    fcfs(procs, n);
    sjf(procs, n);
    rr(procs, n, 2);
    priority_sched(procs, n);
    printf("Scheduler simulation complete\n");
    return 0;
}
```

---

## 4. 新评分引擎设计

### 4.1 评分流程

```
提交代码 → 编译
  ├─ 编译失败 → total_score=0, status=compile_error → 结束
  └─ 编译成功 → 运行沙箱（eBPF/Strace 采集）
       ├─ 运行崩溃/kill → 对应测试点判定不通过
       └─ 正常运行 → 采集 BehaviorMetrics → 遍历每个测试点:
            ├─ 解析测试点的 JSON 断言
            ├─ 逐断言评估（exit_code / output_assertions / syscall_assertions / behavior_assertions）
            ├─ 全部断言通过 → 累加 weight 分 → test_point.passed=true
            └─ 任一断言失败 → 该测试点 0 分 → test_point.passed=false
       ↓
    计算 total_score = sum(通过测试点的 weight)
    计算 is_qualified → 见第 6 节
    发布 NATS 事件（含完整测试点结果 + BehaviorMetrics）
```

### 4.2 旧公式移除清单

以下逻辑从评分管道中**彻底移除**（函数可保留标记 deprecated，但 pipeline 中不再调用）：

| 函数/逻辑 | 位置 | 处理方式 |
|-----------|------|----------|
| `Score()` 三元公式 | `scorer.go` | 标记 deprecated，改由 `NewScore()` 替代 |
| `hasSubstantialCode()` | `scorer.go` | 移除 pipeline 调用 |
| `ScoreWithTrace()` | `scorer.go` | 标记 deprecated |
| `ScoreRubric()` | `rubric_scorer.go` | 不再被 pipeline 调用 |
| `ScoreBehavior()` 保底公式 | `behavior_scorer.go` | 不再被 pipeline 调用 |
| `behaviorScore = 0.5*passRate + 0.5` | `scorer.go` | 移除 |
| `structureScore = structureMax` 满分配分 | `scorer.go` | 移除 |
| `trace_diff` similarity → scoring | `trace_diff.go` → `behavior_scorer.go` | 移除评分引用 |

### 4.3 新评分函数签名

```go
// NewScore 基于测试点加权累加计算总分
// 每个测试点独立评估，断言全部通过 → 累加 weight
func NewScore(testPointResults []TestPointResult) *NewScoreResult {
    total := 0
    coreAllPassed := true
    coreScore := 0
    edgeScore := 0

    for _, tp := range testPointResults {
        if tp.Passed {
            total += tp.Weight
            if tp.Type == "core" {
                coreScore += tp.Weight
            } else {
                edgeScore += tp.Weight
            }
        }
        if tp.Type == "core" && !tp.Passed {
            coreAllPassed = false
        }
    }

    isQualified := coreAllPassed

    return &NewScoreResult{
        TotalScore:   total,
        IsQualified:  isQualified,
        CorePassed:   coreAllPassed,
        CoreScore:    coreScore,
        EdgeScore:    edgeScore,
        Points:       testPointResults,
    }
}
```

### 4.4 新数据结构

```go
// TestPointResult 单个测试点的评估结果
type TestPointResult struct {
    ID           string            `json:"id"`
    Name         string            `json:"name"`
    Type         string            `json:"type"`    // "core" | "edge"
    Weight       int               `json:"weight"`
    Passed       bool              `json:"passed"`
    Assertions   []AssertionResult `json:"assertions"`
    RuntimeError *string           `json:"runtime_error,omitempty"`
    ExecTimeMs   int64             `json:"exec_time_ms"`
}

// AssertionResult 单条断言的评估结果
type AssertionResult struct {
    Type    string `json:"type"`    // "exit_code", "output_assertions", "syscall_assertions", "behavior_assertions"
    Passed  bool   `json:"passed"`
    Reason  string `json:"reason"`  // human-readable explanation
    Details string `json:"details"` // machine-readable details
}

// NewScoreResult 新的评分结果
type NewScoreResult struct {
    TotalScore   int               `json:"total_score"`
    IsQualified  bool              `json:"is_qualified"`
    CorePassed   bool              `json:"core_passed"`
    CoreScore    int               `json:"core_score"`
    EdgeScore    int               `json:"edge_score"`
    Points       []TestPointResult `json:"test_points"`
    CompileError *string           `json:"compile_error,omitempty"`
    RuntimeError *string           `json:"runtime_error,omitempty"`
}
```

---

## 5. eBPF/Strace 客观指标参与评分

### 5.1 归属：每个测试用例内部 behavior_assertions（方案 B）

行为断言（资源泄漏、死锁检测、僵尸进程等）绑定到**每个 test_case 的 `behavior_assertions` 字段**，不放在实验级别或 strategy 级别。

**原因**：
- 扣分颗粒度精确：某一个测试用例发生 FD 泄漏，只扣该测试点分数
- 不同测试用例可以有不同约束：普通用例要求 `no_fd_leak:true`，压力测试用例可关闭该校验 `no_fd_leak:false`
- 可审计：报告可展示"本测试用例失败原因为 FD 泄漏"，一一对应

### 5.2 数据流：规则与结果分离

```
test_cases 表（只存断言规则）              评测运行结果记录（存观测数据）
┌────────────────────────┐              ┌───────────────────────────┐
│ expected_output JSON:  │              │ BehaviorMetrics:          │
│   behavior_assertions: │   运行采集    │   fd_leaked: 3            │
│     no_fd_leak: true   │ ──────────→  │   has_zombies: false      │
│     no_zombie: true    │              │   deadlock_detected: false │
│     max_memory_kb: 256 │              │   syscall_map: {...}       │
└────────────────────────┘              └───────────────────────────┘
         ↓ 规则                                ↓ 实测数据
         └────────── 断言评估器 对比 ──────────┘
                         ↓
                  TestPointResult
```

### 5.3 指标与断言映射

| 观测指标 | 数据来源 | 对应 behavior_assertions | 评分影响 |
|----------|----------|-------------------------|----------|
| FD 泄漏 | strace open/close 配对分析 | `no_fd_leak` | 不满足 → 测试点失败 |
| 僵尸进程 | strace clone/wait4 配对分析 | `no_zombie` | 不满足 → 测试点失败 |
| 死锁 | eBPF futex 超时 / 程序未正常退出 | `no_deadlock` | 不满足 → 测试点失败 |
| 内存溢出 | 沙箱内存统计 | `max_memory_kb` | 超出 → 测试点失败 |
| 超时 | 沙箱执行时间 | `max_runtime_ms` | 超出 → 测试点失败 |
| 系统调用集合 | strace/eBPF trace | `syscall_assertions.required/forbidden` | 不满足 → 测试点失败 |
| 系统调用频次 | strace/eBPF trace | `syscall_assertions.min_count/max_count` | 不满足 → 测试点失败 |

### 5.4 BehaviorMetrics 数据结构

```go
// BehaviorMetrics 从 strace/eBPF trace 中提取的客观运行指标
type BehaviorMetrics struct {
    // FD 管理
    FDOpenCount  int
    FDCloseCount int
    FDLeaked     int
    HasFDLeak    bool

    // 进程管理
    ForkCount  int
    WaitCount  int
    HasZombies bool

    // 并发
    DeadlockDetected bool
    ThreadCount      int

    // 系统调用
    SyscallMap    map[string]int // syscall_name → count
    SyscallErrors map[string]int // syscall_name → error_count

    // 资源
    RuntimeMs  float64
    MemoryKB   int64
    ExitCode   int
    WasKilled  bool
}
```

---

## 6. is_qualified 合格判定机制

### 6.1 判定规则

```
IF strict_mode == true (竞赛模式):
    is_qualified = (total_score == 100)

ELSE (教学模式 — 默认):
    core_all_passed = true
    FOR each test_point WHERE type == "core":
        IF test_point.passed == false:
            core_all_passed = false
            BREAK
    is_qualified = core_all_passed
```

- **教学模式**：核心功能全部通过 → 合格，允许附加/边界有少量缺陷
- **竞赛模式**：必须 100 分才合格

### 6.2 前端展示

```
┌──────────────────────────────────────────┐
│  实验得分: 85 / 100                       │
│  [实验合格 ✓]  核心功能: 70/70  附加: 15/30 │
│                                          │
│  未通过的测试点:                           │
│  - 缓冲区边界正确 (edge, 15分)             │
│  - 条件变量使用正确 (edge, 15分)           │
└──────────────────────────────────────────┘
```

### 6.3 竞赛模式开关

```sql
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS strict_mode BOOLEAN DEFAULT false;
```

教师可在实验管理页面一键切换。`strict_mode=true` 时，`is_qualified = (total_score == 100)`。

---

## 7. 参考实现管理

### 7.1 核心原则

**系统不存在唯一的绝对标准答案。** 操作系统实验存在多种合法实现思路，学生代码输出、系统调用序列允许和参考实现不完全一样。

### 7.2 两层体系

| 层 | 内容 | 是否参与评分 |
|----|------|-------------|
| **测试断言** | `test_cases.expected_output` 中的 JSON 断言集合 | ✅ 唯一评分依据 |
| **参考实现** | `experiment_code_templates` 表中的 C 参考代码 | ❌ 仅作验证和参考 |

### 7.3 参考实现的角色

1. **断言验证器**：用参考实现运行所有测试用例，验证断言本身正确性（CI 检查 `golden → 100分`）
2. **调试辅助**：教师查看预期行为，排查测试断言设计问题
3. **AI 诊断参考**：将参考实现的 trace/输出作为 AI 诊断的参考素材

### 7.4 严禁行为

- ❌ 把参考实现的原始输出拿来做字符串比对判分
- ❌ 把参考实现的原始 trace 拿来做事件序列比对判分
- ❌ `trace_diff.go` 对参考 trace 和学生 trace 做 Needleman-Wunsch 对齐并参与评分
- ❌ 在评分代码中引用 reference_solution 字段

### 7.5 存储方案

使用已有的 `experiment_code_templates` 表（语言=C，模板类型=reference_solution）：

```sql
-- 示例：lab1 的 C 参考实现
INSERT INTO experiment_code_templates (experiment_id, language, template_type, code)
VALUES ('<exp_id>', 'c', 'reference_solution', '<C参考代码>')
ON CONFLICT (experiment_id, language, template_type) DO UPDATE SET code = EXCLUDED.code;
```

**不再使用 `experiments.reference_solution` 字段**（保留不动，后续废弃）。

### 7.6 多语言覆盖

- **本轮**：优先完成全部 31 个实验的 C 语言参考实现
- **后续迭代**：逐步补充 Python、Rust 等其他语言
- `starter_code` 多语言模板可保留原样不受影响

### 7.7 trace_diff.go 改造

- 保留 Needleman-Wunsch 序列对齐功能，**仅作展示/调试**
- 移除 `behavior_scorer.go` 中对 `TraceSimilarity` 的评分引用
- `runReferenceTrace()` 保留，但 diff 结果仅存储到 DB 供前端展示和 AI 诊断参考

---

## 8. AI 诊断角色边界

### 8.1 概念切割

```
┌──────────────────────────────────────────────────────┐
│                  评测数据采集层（客观）                 │
│  eBPF trace / Strace trace / 退出码 / 内存 / 时序     │
│                              ↓                       │
│                  断言评估器（确定性）                   │
│  全部断言通过 → 得分 / 任一断言失败 → 不得分            │
│                              ↓                       │
│              total_score / is_qualified               │
│══════════════════════════════════════════════════════│
│                  反馈生成层（辅助）                     │
│  AI Diagnosis: 文本分析 / 错误推理 / 教学建议          │
│  仅作为自然语言反馈 → 不参与任何分数计算                │
└──────────────────────────────────────────────────────┘
```

### 8.2 参与评分的 ✅

- eBPF/trace 采集的**客观运行指标**（FD 泄漏、死锁、僵尸进程、系统调用集合、内存统计）
- 这些指标通过 `behavior_assertions` 字段参与测试点判定

### 8.3 不参与评分的 ❌

- 大模型 AI 输出的所有自然语言推理、诊断、纠错建议
- 原因：AI 输出存在不确定性、幻觉；评分需要可复现、可审计，不能引入主观因素

### 8.4 AI 诊断输入/输出

AI 可消费（只读，不改变评分）：
- 学生提交的代码、每个测试点的通过/失败状态、失败断言详情
- BehaviorMetrics 客观指标
- 参考实现的输出/trace（作为对比参考素材）

AI 输出（仅展示/教学）：
- 分层级提示（L1/L2/L3 hint）
- 错误根因推测
- 代码改进建议

---

## 9. 数据库变更

### 9.1 test_cases 表（不改结构，语义升级）

```sql
-- ⚠️ 不新增任何列！
-- expected_output 字段（TEXT）复用：旧格式为普通字符串，新格式为 JSON 断言
-- type 字段（VARCHAR）语义扩展：原值 "normal"/"edge_case" → 新值 "core"/"edge"
--   core   = 核心功能测试点（必须全部通过才能 is_qualified）
--   edge   = 边界/附加测试点（不影响 is_qualified）
```

#### 9.1.1 type 字段 CHECK 约束冲突

**问题**：当前 DB schema 中 `test_cases` 表有 CHECK 约束：
```sql
type VARCHAR(50) NOT NULL CHECK (type IN ('normal', 'edge_case', 'performance', 'security'))
```

该约束不允许直接写入 `"core"`/`"edge"` 值。

**当前方案（本轮采用）**：
- Seed SQL 继续使用 `"normal"`/`"edge_case"` 值
- 代码层通过 `normalizeType()` 做映射：`"normal"`→`"core"`, `"edge_case"`/其他→`"edge"`
- `normalizeType()` 在 `new_scorer.go` 和 `pipeline.go` 中均调用，确保 Type 字段在全链路（DB→内存→NATS 事件）统一为 canonical 值
- 对前端和 AI 诊断侧透明——它们始终收到 `"core"`/`"edge"`

**后续迁移**（Phase 2 前执行）：
```sql
-- 1) 修改 CHECK 约束允许新值
ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_type_check;
ALTER TABLE test_cases ADD CONSTRAINT test_cases_type_check
    CHECK (type IN ('core', 'edge', 'normal', 'edge_case', 'performance', 'security'));

-- 2) 迁移已有数据
UPDATE test_cases SET type = 'core' WHERE type = 'normal';
UPDATE test_cases SET type = 'edge' WHERE type = 'edge_case';

-- 3) (可选) 收紧约束仅保留新值
-- ALTER TABLE test_cases DROP CONSTRAINT test_cases_type_check;
-- ALTER TABLE test_cases ADD CONSTRAINT test_cases_type_check
--     CHECK (type IN ('core', 'edge', 'performance', 'security'));
```

### 9.2 submissions 表

```sql
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_qualified BOOLEAN;
-- 旧字段 structure_score / behavior_score / output_score 保留不删除
-- 但不再写入新值；前端可读取历史数据
```

### 9.3 experiments 表

```sql
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS strict_mode BOOLEAN DEFAULT false;
```

### 9.4 experiment_code_templates 表

```sql
-- 不新增列，不修改结构
-- 通过 template_type = 'reference_solution' 区分参考实现
-- 与 starter_code 共用同一张表
```

---

### 9.5 NATS 事件 v2 数据模型

> 本节记录 v2 评测管道中 `EvaluationCompletedEvent` 的实际扩展字段。

#### 9.5.1 新增字段

```go
// EvaluationCompletedEvent 新增字段（v2）
IsQualified bool            `json:"is_qualified"`
CoreScore   int             `json:"core_score"`
EdgeScore   int             `json:"edge_score"`
TestPoints  []TestPointData `json:"test_points,omitempty"`
```

#### 9.5.2 TestPointData — 测试点结果序列化

```go
// TestPointData 对应 evaluator.TestPointResult，用于 NATS 传输
type TestPointData struct {
    Name       string `json:"name"`
    Type       string `json:"type"`       // "core" | "edge"
    Weight     int    `json:"weight"`
    Passed     bool   `json:"passed"`
    FailReason string `json:"fail_reason,omitempty"`
    ExecTimeMs int64  `json:"exec_time_ms"`
}
```

#### 9.5.3 事件发布路径

```
pipeline.Run() → publishCompletedV2()
  ├─ 构造 EvaluationCompletedEvent（含 IsQualified / CoreScore / EdgeScore / TestPoints）
  ├─ 调用 nats.PublishEvaluationCompleted(bus, event)
  └─ ai-service 订阅该事件 → 触发 AI 诊断
```

#### 9.5.4 旧 v1 发布函数保留

- `publishCompleted()` — 旧管道使用，不含 v2 字段
- `publishCompletedWithTrace()` — 旧管道使用，含 strace 数据
- `publishCompletedV2()` — **新管道使用**，含完整 v2 字段

---

### 9.6 Pipeline v2 控制流（实际实现）

> 本节记录 `pipeline.Run()` 中 v2 评分路径的实际执行顺序。

```
1. 编译检查 → 编译失败直接返回 compile_error
2. 运行所有测试用例（eBPF 优先 / strace 兜底）
3. 空模板 / 无意义代码检测 → 标记为 failed
4. 构建 syscallMap（从 traceRecords 按 syscall name 计数）
5. 构建 BehaviorMetrics:
   a. NewBehaviorMetrics() → 初始化空结构
   b. MergeSyscallMap(syscallMap) → 合并 syscall 数据
   c. FromExecutionResult(exitCode, runtimeMs, memoryKB, wasKilled) → 基础运行数据
   d. AnalyzeFDLeak() → 分析 FD 泄漏
   e. AnalyzeZombies() → 分析僵尸进程
   f. AnalyzeDeadlock(timeoutMs) → 分析死锁（仅在 behavior_assertions.no_deadlock=true 时调用）
   g. AnalyzeThreadCount() → 分析线程数
6. 逐测试用例评估断言:
   FOR each testCase:
     ├─ 找到匹配的 TestResult（运行时采集）
     ├─ ParseAssertions(tc.ExpectedOutput) → AssertionsDoc
     ├─ EvaluateAssertions(doc, output, exitCode, syscallMap, metrics) → EvalResult
     └─ 生成 TestPointResult → 加入 testPointResults[]
7. NewScore(testPointResults) → NewScoreResult
   ├─ TotalScore = sum(通过的测试点 Weight)
   ├─ IsQualified = core 类全部通过
   ├─ CoreScore / EdgeScore 分别统计
8. DB 写入:
   ├─ subRepo.UpdateResult(score, status, ...)
   └─ subRepo.UpdateIsQualified(qualified)
9. 发布事件:
   └─ publishCompletedV2(..., isQualified, coreScore, edgeScore, testPoints, obsContextJSON)
```

**关键差异（v1 vs v2）**：

| 环节 | v1 | v2 |
|------|----|----|
| 实质性代码检查 | `hasSubstantialCode()` 宽松检测 | 完全移除，编译通过即进入测试 |
| 评分方式 | 三元公式（output+structure+behavior） | 测试点加权累加 |
| 行为评分 | `0.5*passRate+0.5` 保底公式 | 断言级 pass/fail |
| trace diff | similarity 参与评分 | 仅作展示/调试 |
| 事件发布 | `publishCompleted` / `publishCompletedWithTrace` | `publishCompletedV2` |

---

## 10. 代码改造清单（第一轮）

### 10.1 新增文件

| 文件 | 说明 | 状态 |
|------|------|------|
| `services/core-service/internal/evaluator/assertion.go` | 断言评估器：解析 expected_output JSON → 逐类型评估 → 返回 EvalResult（含 ParseAssertions + EvaluateAssertions） | ✅ 已完成 |
| `services/core-service/internal/evaluator/behavior_metrics.go` | BehaviorMetrics 采集：从 trace records 提取 FD/僵尸/死锁/syscall 等指标 | ✅ 已完成 |
| `services/core-service/internal/evaluator/new_scorer.go` | `NewScore()`: 测试点加权累加 + is_qualified 判定 | ✅ 已完成 |
| `services/core-service/internal/evaluator/assertion_test.go` | 断言评估器单元测试（含兼容旧格式测试） | ✅ 已完成 |
| `services/core-service/internal/evaluator/new_scorer_test.go` | 新评分器单元测试 | ✅ 已完成 |
| `deploy/init-db/20-new-test-assertions.sql` | 31 个实验的完整 JSON 断言 seed 数据（先含 3 个样板，后续追加） | ✅ 已完成 |
| `deploy/init-db/21-reference-solutions-c.sql` | 31 个实验的 C 参考实现（experiment_code_templates 表） | ✅ 已完成 |

### 10.2 修改文件

| 文件 | 变更内容 | 风险 | 状态 |
|------|----------|------|------|
| `evaluator/pipeline.go` | 替换 Run() 评分调用：旧 `ScoreWithTrace()` → `NewScore()`；加入 `BehaviorMetrics` 采集步骤；移除 `hasSubstantialCode` 逻辑；NATS 事件携带 `TestPointResult[]` | 中 | ✅ 已完成 |
| `evaluator/scorer.go` | 旧函数标记 `// Deprecated` 保留；新增 `NewScore()`、`NewScoreResult` 类型 | 低 | ✅ 已完成 |
| `evaluator/types.go` | 新增 `TestPointResult`、`AssertionResult`、`NewScoreResult`、`BehaviorMetrics`；旧 `ScoreResult` 标记 deprecated | 低 | ✅ 已完成 |
| `evaluator/strategy.go` | 保留接口，旧 weight 方法标记 deprecated | 低 | ✅ 已完成 |
| `evaluator/behavior_scorer.go` | 移除 `TraceSimilarity` 评分引用；移除 `ScoreBehavior()` 调用；行为评估逻辑迁移到 `behavior_metrics.go` | 低 | ✅ 已完成 |
| `evaluator/rubric_scorer.go` | 标记 deprecated，不再被 pipeline 调用 | 低 | ✅ 已完成 |
| `evaluator/trace_diff.go` | 保留对齐功能仅作展示；移除评分侧 similarity 引用 | 低 | ✅ 已完成 |
| `evaluator/runner.go` | 适配新 `TestPointResult` 类型 | 中 | ✅ 已完成 |
| `evaluator/comparator.go` | 保留旧 `Compare()` / `CompareStructured()` 接口不变；断言评估逻辑已迁移到 `assertion.go` | 低 | ✅ 已完成 |
| `repository/submission.go` | 新增 `UpdateIsQualified()` 写入 `is_qualified`；`UpdateResult()` 保持向后兼容 | 低 | ✅ 已完成 |
| `model/model.go` | `TestCase.Type` 语义升级（"normal"→"core", "edge_case"→"edge"）；`Submission` 新增 `IsQualified` 字段 | 低 | ✅ 已完成 |
| `handler/submission.go` | 前端 API 返回 `is_qualified` + 测试点明细 | 低 | ✅ 已完成 |
| `nats/events.go` | `EvaluationCompletedEvent` 新增 `IsQualified` / `CoreScore` / `EdgeScore` / `TestPoints` 字段；新增 `TestPointData` 类型 | 低 | ✅ 已完成 |
| `deploy/init-db/05-seed.sql` | `expected_output` 替换为 JSON 断言（先 3 个样板，再批量 28 个）；`type` 字段值从 "normal"/"edge_case" 改为 "core"/"edge" | 高 | ✅ 已完成 |

### 10.3 不改动的文件

以下文件/模块**本轮不动**，保持现有逻辑：

- `ebpf/` 目录（eBPF 采集器）
- `sandbox/` 目录（NSJail/Docker 运行时）
- `evaluator/compiler.go`（编译逻辑）
- `evaluator/worker_pool.go`（并发调度，仅适配返回类型）
- `evaluator/memory.go` / `perf_collector.go` / `pattern_analyzer.go` / `source_line.go`
- `ai-service/` 目录（AI 诊断服务）

---

## 11. 验证计划

### 11.1 样板验证（Phase 1）

```
1. assertion.go 核心逻辑实现
2. NewScore() 评分函数实现
3. 写入 lab1_fork_basic + lab8_producer_consumer + lab24_sched_sim 的 SQL seed 数据
4. 编写 3 个实验的 C 参考实现
5. 验证:
   ├─ Golden 实现运行 → 必须 100 分
   ├─ 有针对性错误的实现（如不写 waitpid） → 对应测试点失败，分数符合预期
   └─ 空实现 (int main(){return 0;}) → 低分（0-25分）
6. 用户确认 → 进入 Phase 2 ✅ **已完成**
```

### 11.2 全量迁移（Phase 2）

```
1. 批量生成剩余 28 个实验的 JSON 断言数据
2. 批量编写剩余 28 个实验的 C 参考实现
3. 修改 pipeline.go 切换到新评分管道
4. 数据库迁移（执行 ALTER TABLE 语句）
5. 验证:
   ├─ 全部 31 个实验 Golden 实现通过率 = 100%
   ├─ 每类实验至少 2 个错误样本验证扣分合理性
   ├─ 旧格式 expected_output 兼容性验证
   └─ AI 诊断路径验证（AI 消费新数据格式） ✅ **已完成**
```

### 11.3 验证数据准备

对每个实验至少准备：
- 1 份 golden 实现（预期 100 分）
- 2 份有针对性错误的实现（预期特定测试点失败）
- 1 份完全错误的实现（预期低分/0 分）
- 1 份旧格式 expected_output 的兼容性验证

### 11.4 回归保护

- 旧 `ScoreResult` 结构字段保留在代码中，但不写入新值
- Feature flag `USE_NEW_SCORING` 控制新旧管道切换
- 回滚方案：feature flag 切回旧管道

---

## 12. JSON Schema 校验文档

以下 JSON Schema 用于校验 `test_cases.expected_output` 中的断言 JSON 格式。

### 12.1 JSON Schema 定义

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "traceos-lab:test-assertions",
  "title": "TraceOS Lab Test Point Assertions",
  "description": "单个测试用例的断言 JSON Schema。存储在 test_cases.expected_output 字段中。",
  "type": "object",
  "required": ["exit_code"],
  "properties": {
    "exit_code": {
      "description": "期望退出码。数字表示固定值，数组表示允许多个合法值。",
      "oneOf": [
        {"type": "integer", "minimum": 0, "maximum": 255},
        {
          "type": "array",
          "items": {"type": "integer", "minimum": 0, "maximum": 255},
          "minItems": 1
        }
      ]
    },
    "output_assertions": {
      "description": "输出断言列表。数组内所有断言 AND 关系。",
      "type": "array",
      "items": {
        "type": "object",
        "required": ["mode", "value"],
        "properties": {
          "mode": {
            "type": "string",
            "enum": ["contains", "not_contains", "regex", "exact_match"]
          },
          "value": {
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    "syscall_assertions": {
      "description": "系统调用断言。所有子断言 AND 关系。",
      "type": "object",
      "properties": {
        "required": {
          "type": "array",
          "items": {"type": "string"},
          "description": "必须出现的系统调用名称列表"
        },
        "forbidden": {
          "type": "array",
          "items": {"type": "string"},
          "description": "禁止出现的系统调用名称列表"
        },
        "min_count": {
          "type": "object",
          "additionalProperties": {"type": "integer", "minimum": 0},
          "description": "指定系统调用的最小出现次数 {syscall_name: count}"
        },
        "max_count": {
          "type": "object",
          "additionalProperties": {"type": "integer", "minimum": 0},
          "description": "指定系统调用的最大出现次数 {syscall_name: count}"
        }
      },
      "additionalProperties": false
    },
    "behavior_assertions": {
      "description": "运行行为断言。true=必须满足，false=不校验。",
      "type": "object",
      "properties": {
        "no_fd_leak": {
          "type": "boolean",
          "description": "true: 要求无 FD 泄漏（open/close 配对）；false: 不校验"
        },
        "no_zombie": {
          "type": "boolean",
          "description": "true: 要求无僵尸进程（clone/wait4 配对）；false: 不校验"
        },
        "no_deadlock": {
          "type": "boolean",
          "description": "true: 要求无死锁（程序在 timeout 内正常退出）；false: 不校验"
        },
        "max_memory_kb": {
          "type": "integer",
          "minimum": 0,
          "description": "最大内存使用量（KB），超出则失败"
        },
        "max_runtime_ms": {
          "type": "integer",
          "minimum": 0,
          "description": "最大运行时间（毫秒），超出则失败"
        }
      },
      "additionalProperties": false
    },
    "numeric_assertions": {
      "description": "数值断言。从输出中提取数值并施加数学约束。",
      "type": "object",
      "required": ["mode", "pattern"],
      "properties": {
        "mode": {
          "type": "string",
          "enum": ["range", "comparison", "set_equality", "count_distinct"],
          "description": "约束模式：range=范围约束, comparison=公式约束, set_equality=集合相等, count_distinct=去重计数"
        },
        "pattern": {
          "type": "string",
          "description": "正则表达式，从归一化后的学生输出中提取数值（捕获组 1）"
        },
        "min": {
          "type": "number",
          "description": "提取值的下限（含），用于 range / count_distinct 模式"
        },
        "max": {
          "type": "number",
          "description": "提取值的上限（含），用于 range / count_distinct 模式"
        },
        "expected": {
          "type": "array",
          "items": {"type": "number"},
          "description": "期望的完整数值集合（用于 set_equality 模式）"
        },
        "formula": {
          "type": "string",
          "description": "数学表达式模板（用于 comparison 模式），如 \"max/min < 1.5\""
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### 12.2 校验示例

```go
// go
import "github.com/santhosh-tekuri/jsonschema/v6"

func ValidateAssertionsJSON(raw string) error {
    sch, _ := jsonschema.Compile("file://schemas/test-assertions.schema.json")
    var v interface{}
    json.Unmarshal([]byte(raw), &v)
    return sch.Validate(v)
}
```

### 12.3 最小有效断言

```json
{"exit_code": 0}
```

仅校验退出码，不做输出/系统调用/行为断言。

### 12.4 无效断言示例

| 错误 JSON | 原因 |
|-----------|------|
| `{"exit_code": 0, "output_assertions": [{"mode":"fuzzy","value":"x"}]}` | `mode` 不在枚举中 |
| `{"exit_code": 0, "unknown_key": true}` | 不允许 `additionalProperties` |
| `{"exit_code": "0"}` | `exit_code` 必须是数字或数组，不能是字符串 |
| `{}` | 缺少必填字段 `exit_code` |

---

> **下一步**：请确认以上 3 个样板实验（lab1_fork_basic / lab8_producer_consumer / lab24_sched_sim）的 JSON 断言设计是否正确。确认后立即开始 Go 代码实现。