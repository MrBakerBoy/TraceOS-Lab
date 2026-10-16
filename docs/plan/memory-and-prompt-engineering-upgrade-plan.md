# TraceOS AI 记忆系统与提示词工程升级方案

> **定位**：将当前单层 LIMIT 20 的对话历史 + 自相矛盾的提示词体系，升级为 **三层记忆架构 + 专业 OS 教学对话工程**，真正给学生有效的操作系统学习帮助。
>
> **核心问题**：AI 回复简陋、上下文丢失、检测数据浪费、提示词自己打自己。
>
> **设计理念**：记忆分层压缩（Hybrid Compression） + 检测数据全量注入 + Bloom 分类学对齐教学 Prompt。

---

## 一、现状诊断：四个关键缺陷

### 缺陷 1：单层粗暴截断，无记忆压缩

`conversation.go` 的 `SendMessage` 第 264 行：

```264:270:services/core-service/internal/handler/conversation.go
	rows, _ := h.db.Query(c,
		`SELECT role, content FROM messages WHERE conversation_id = $1
		 ORDER BY created_at DESC LIMIT 20`, convID)
```

固定取最近 20 条消息原样发送。200 轮对话后，第 1-180 轮的信息全部丢失。`ContextFirewall` 的四级水位压缩每次请求独立执行，不跨请求持久化。

### 缺陷 2：提示词自相矛盾，回复简陋

`diagnosis_tutor.py` 第 108 行：

```108:108:services/ai-service/app/agents/diagnosis_tutor.py
        system_prompt = DIAGNOSIS_TUTOR_SYSTEM_PROMPT + "\n\n" + system_prompt
```

- **上半部分** `DIAGNOSIS_TUTOR_SYSTEM_PROMPT`：像朋友聊天、纯粹闲聊不需要返回 JSON
- **下半部分** `SYSTEM_PROMPT_BASE`（来自 `prompt_builder.py`）：必须只输出一个完整的 JSON 对象，不要包含任何其他内容

JSON-only 指令压倒一切，产生机械 JSON。加上 "每段话不要太长"、"请简洁输出，避免冗余"、feedback 每层限制 1-5 句、temperature=0.3，四个原因叠加导致 AI 回复严重缺乏细节。

### 缺陷 3：检测数据完全不传给 AI

Evaluator Pipeline 产出丰富的运行时数据：

| 数据 | 存储位置 | 是否传给 Chat AI |
|------|---------|:---:|
| 编译错误 (compile_error) | `submissions` 表 | **否** |
| 运行时错误 (runtime_error) | `submissions` 表 | **否** |
| 测试用例结果 (test_results) | `test_results` 表 | **否** |
| 系统调用分析 (strace patterns) | `syscall_traces` + NATS 事件 | **否** |
| FD/内存/进程泄漏分析 | `StraceSummaryData` | **否** |
| 死锁检测 (deadlock) | `deadlock_reports` 表 | **否** |
| eBPF perf 事件 | `perf_events` 表 | **否** |
| 内存布局快照 | `memory_layouts` 表 | **否** |
| 已有诊断结果 | `diagnoses` / `diagnosis_reports` | **否** |

Go `SendMessage` 只查三张表：`conversations`、`experiments`、`messages`。检测数据只在独立的诊断管线（`/api/ai/diagnose`）中使用，**从不注入 Chat 管线**。学生提交代码后问 "为什么跑不过"，AI 完全不知道刚刚发生了什么。

### 缺陷 4：L2/L3 记忆已存在但未接入 Chat

Python `memory.py` 已实现 `MemoryManager`，维护 `StudentMemory`（weak_topics、strong_topics、preferred_hint_level、learning_pace），`build_memory_context()` 方法已就绪。但 `graph.py` 的 agent 管线从未调用它。

---

## 二、提示词工程：CS 教学最佳实践调研

### 2.1 理论基础

本次方案系统性吸收了以下教育学框架和 LLM 教学工程的最佳实践：

#### Bloom 分类学对齐 (Bloom's Taxonomy Alignment)

认知目标从低到高分为六层，教学 Agent 应逐层引导而非跨越：

| 层级 | 认知目标 | 对应教学策略 |
|------|---------|------------|
| **记忆** (Remember) | 回忆 OS 概念定义、系统调用名称 | 确认学生是否理解基础术语 |
| **理解** (Understand) | 用自己的话解释 fork/futex 是什么 | 要求学生对一个概念做类比 |
| **应用** (Apply) | 将知识点用于编写代码 | 给代码模板，让学生填入关键部分 |
| **分析** (Analyze) | 对比自己的代码和预期行为的差异 | 引导学生分析 strace 输出中的异常 |
| **评价** (Evaluate) | 评判不同实现方案的优劣 | "如果用管道 vs 共享内存，各有什么利弊？" |
| **创造** (Create) | 设计新的解决方案 | 让学生独立设计一个新的实验扩展 |

教学 Agent 应在每轮回复中**明确当前位于哪个 Bloom 层级**，并设计引导学生向上一级迈进的问题。

#### Vygotsky 最近发展区 (Zone of Proximal Development, ZPD)

学生能独立完成的任务 vs 需要帮助才能完成的任务之间的差距，是教学最有效的区域。Agent 需要在每个学生身上找到这个区域：

- **太简单**（学生觉得无聊）：升高 Bloom 层级，增加挑战
- **太难**（学生放弃或直接要答案）：降低 Bloom 层级，给出更具体的引导
- **正合适**（学生感到被挑战但能前进）：保持当前层级，给精准的脚手架

实现方式：通过 L2/L3 记忆中追踪学生的 "卡住时长" 和 "问题类型演变"，动态调整 Bloom 层级。

#### Socratic 反问法 (Socratic Questioning)

不给答案，用连续的反问引导学生自己发现答案。经典 Socratic 路径：

```
教师: "你认为 fork() 之后，子进程从哪一行开始执行？"
学生: "从 main 函数第一行？"
教师: "那父进程的输出会不会重复出现了？"
学生: "额... 好像会的"
教师: "如果两个进程都从 main 开始，它们各执行了什么？看看你的输出，子进程打印了什么？"
学生: "子进程打印了 'Parent'... 哦！我懂了，子进程也执行了 if-else 之外的所有代码！"
```

#### 认知学徒制 (Cognitive Apprenticeship)

导师不仅告诉学生 "该做什么"，还**展示自己的思维过程**：

- **建模 (Modeling)**：导师展示自己如何分析一段 strace 输出
- **辅导 (Coaching)**：学生自己尝试，导师在旁边观察并给提示
- **支架 (Scaffolding)**：导师给足够的支持让学生完成任务，然后逐步撤去
- **清晰表达 (Articulation)**：让学生解释自己的推理过程
- **反思 (Reflection)**：让学生对比自己的方法和高手的做法
- **探索 (Exploration)**：学生自主解决新问题

教学 Agent 应在回复中清晰展示自己的推理链路（"我是这样分析的..."），并邀请学生陈述他自己的思路。

#### 错误驱动的学习 (Mistake-Driven Learning)

OS 实验中最有效的学习往往来自调试错误的过程。Agent 应该：

- 不急于指出正确做法，先让学生观察错误现象
- 帮助学生建立 "错误 → 现象 → 根因 → OS 原理" 的映射
- 鼓励学生自己用 strace/gdb 观察，而不是直接看 Agent 给的结论
- 把常见的 OS 错误模式（FD 泄漏、死锁、fork 混淆）结构化为知识

### 2.2 OS 教学专用知识结构

针对操作系统教学，Agent 应理解以下 OS 核心概念的结构化知识图谱：

```
进程管理 (Process Management)
  ├── fork/exec/wait 行为
  ├── 僵尸进程 (init 收养 vs wait/waitpid)
  ├── 孤儿进程
  ├── 进程间通信: 管道(pipe), FIFO, 共享内存(shm), 消息队列(mq), 信号(signal)
  └── 信号处理: SIGCHLD, SIGPIPE, sigaction

内存管理 (Memory Management)
  ├── malloc/free 配对 (valgrind 分析)
  ├── mmap/brk/sbrk 行为
  ├── 页表与虚拟地址空间 (/proc/pid/maps)
  ├── 段错误原因: 空指针解引用, 栈溢出, 越界访问
  └── COW (Copy-on-Write) fork 内存共享

文件系统 (File System)
  ├── FD 生命周期: open → read/write → close
  ├── FD 泄漏检测: 用 strace 统计 open vs close
  ├── 缓冲区: fflush, fsync, O_SYNC
  ├── I/O 重定向: dup2, 管道配合 fork
  └── 文件权限与 inode

线程与并发 (Threads & Concurrency)
  ├── 竞态条件: 共享变量不加锁
  ├── 死锁: 四条件 + 资源分配图 + 银行家算法
  ├── 互斥锁: pthread_mutex_lock/unlock
  ├── 条件变量: pthread_cond_wait/signal
  ├── 信号量: sem_wait/sem_post
  └── futex: 内核态 futex 竞争分析 (eBPF)

调度 (Scheduling)
  ├── CFS: vruntime, nice 值, sched_yield
  ├── 实时调度: FIFO, RR
  ├── CPU 亲和性: sched_setaffinity
  └── 优先级反转及解决方案
```

### 2.3 按意图分类的教学策略

| 意图 | 教学内容占比 | 核心教学策略 |
|------|:---:|---|
| **diagnosis**（代码诊断） | 40% 错误分析 + 30% OS原理 + 30% 分层提示 | Socratic 反问 + 错误驱动学习 + 关联 OS 概念 |
| **knowledge_qa**（概念问答） | 30% 概念解释 + 25% 生活化比喻 + 25% 代码示例 + 20% OS 关联 | Bloom 分类学展开 + 最近发展区探测 |
| **code_review**（代码审查） | 30% 肯定好做法 + 40% 改进建议 + 30% OS 最佳实践 | 认知学徒制（展示更好的写法） + 分层反馈 |
| **general_chat**（闲聊/引导） | 60% 对话 + 40% 学习引导 | 建立信任 + 探测学习状态 + 自然引导回学习 |

### 2.4 教学深度控制

Agent 应能根据学生画像自适应调整教学深度：

| 参数 | 值域 | 含义 | 来源 |
|------|------|------|------|
| `learning_pace` | fast / medium / slow | 学生理解速度 | `student_profiles.learning_style` |
| `preferred_hint_level` | L1 / L2 / L3 | 偏好提示粒度 | `student_profiles.learning_style` |
| `concept_mastery` | 0.0 - 1.0 | 各 OS 概念掌握度 | ELO 评分 (已有 `student_profiles`) |
| `stuck_duration` | 0 - N | 当前问题卡住的轮数 | 实时追踪 |
| `attempt_count` | 0 - N | 当前实验提交次数 | `submissions` 表 |
| `last_score` | 0 - 100 | 最近一次提交分数 | `submissions` 表 |

---

## 三、三层记忆系统架构

### 3.1 分层定义

```
┌──────────────────────────────────────────────────────────────┐
│ L0 工作记忆 (Working Memory)                                  │
│ 范围: 当前请求的上下文窗口                                      │
│ 内容: system_prompt + L1注入 + L3注入 + 检测数据               │
│      + 当前用户消息 + 工具输出 + RAG结果                        │
│ 大小: ~3K-6K tokens (按 agent 类型)                            │
│ 管理: ContextFirewall (保留现有 4 级水位)                       │
├──────────────────────────────────────────────────────────────┤
│ L1 短期记忆 (Short-Term Memory)                                │
│ 范围: 当前对话的全部历史 (压缩后)                                │
│ 结构: 最近 8 轮全量原文 + 早期轮次混合摘要 + 关键事实列表        │
│ 持久化: conversation_memories 表 + messages.is_compressed       │
│ 注入量: ~500 tokens (full_summary + key_facts)                 │
├──────────────────────────────────────────────────────────────┤
│ L3 长期记忆 (Long-Term Memory / 用户画像)                       │
│ 范围: 跨实验、跨会话的持久知识                                  │
│ 类型: OS 概念掌握度、常见错误模式、有效教学策略、用户偏好         │
│ 持久化: long_term_memories 表 + student_profiles 表             │
│ 注入量: ~400 tokens (Top-5 记忆 + StudentMemory 摘要)           │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 L1 混合压缩策略

混合规则+LLM 压缩管道：

```
消息流进入 L1
  │
  ├── [规则层] 标记每轮 importance (0.0-1.0)
  │     ○ 用户提问 (以 ?/？/吗/呢/什么/怎么/为什么 结尾)    → importance 0.85
  │     ○ assistant 给出诊断结论 (JSON 含 root_cause)      → importance 0.90
  │     ○ assistant 给出代码修改建议                        → importance 0.80
  │     ○ 用户反馈 "我懂了"/"成功了"                        → importance 0.75
  │     ○ 用户反馈 "不行"/"还是不对"                        → importance 0.85
  │     ○ 包含编译错误或运行时错误                           → importance 0.80
  │     ○ 闲聊/打招呼                                       → importance 0.20
  │     ○ 其他                                              → importance 0.50
  │
  ├── [分组层] 按压缩状态分组
  │     ○ 未压缩轮次 (turn > compressed_until): 按 importance 排序
  │     ○ 最近 8 轮: 一律保留原文 (即使 importance 低)
  │     ○ 其余未压缩轮次:
  │         - importance ≥ 0.7: 保留原文
  │         - importance < 0.7: 改为 1-line 摘要
  │
  └── [LLM 层] 触发条件
        ○ 未压缩轮数 ≥ 12 且 非关键轮数 ≥ 8
        ○ 或 total_compressed_tokens > 2000
        → 调用轻量 LLM (temperature=0.1, max_tokens=512) 生成结构化增量摘要
        → 合并到 conversation_memories.full_summary
        → 更新 compressed_until_turn
        → 从 compressed 轮次中提取 key_facts (最多保留 10 条)
```

LLM 摘要 JSON 结构：

```json
{
  "user_goal": "学生在做进程创建实验，想要理解 fork() 后父子进程的执行顺序",
  "key_concepts": ["fork()", "进程调度不确定性", "wait()"],
  "diagnosis_conclusions": [
    "学生没有在 fork() 后区分父子进程的执行路径",
    "父进程和子进程都打印了 Parent，说明 if-else 分支覆盖不全"
  ],
  "code_issues_found": ["fork() 返回值的 if-else 分支只处理了 >0 和 =0，缺少 <0 的错误处理"],
  "hints_given": ["L2: 让用户在父子进程各加一行 printf"],
  "current_status": "学生表示 '有点懂了'，正在尝试修改代码"
}
```

### 3.3 L3 长期记忆 = 用户画像 + 跨会话知识

**不再区分 L2/L3**，统一为 Long-Term Memory 层，包含两类记忆：

#### 类型 A：用户画像 (StudentProfile)

来自 `student_profiles` 表 + `submissions` 聚合，每次请求时实时计算：

```json
{
  "weak_concepts": ["fork()", "file_descriptor"],
  "strong_concepts": ["compilation", "pipe"],
  "mastered_concepts": ["gcc_flags", "header_files"],
  "preferred_hint_level": "L2",
  "learning_pace": "slow",
  "total_submissions": 12,
  "avg_score": 68.5,
  "current_experiment_attempts": 3,
  "last_score": 65,
  "score_trend": "improving"  // improving / stable / declining
}
```

#### 类型 B：跨会话记忆 (LongTermMemory)

从 L1 被压缩丢弃但仍可能有长期价值的信息中，由 LLM 在会话结束时提取：

```sql
CREATE TABLE long_term_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    experiment_id UUID,
    memory_type TEXT NOT NULL,
    -- 类型: 'concept_mastered' | 'common_mistake' | 'effective_strategy' | 'user_preference'
    content TEXT NOT NULL,
    importance FLOAT DEFAULT 0.5,
    source_conversation_ids UUID[],
    hit_count INT DEFAULT 0,
    last_recalled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

记忆条目示例：

```
- "学生反复混淆 fork() 返回值的含义，在 3 次诊断中被指出同一个问题" (importance=0.85)
- "学生更喜欢用 strace 而非 gdb，提到 gdb 时会回避" (importance=0.70)
- "上次用了拍照比喻解释 COW，学生当天就提交了正确代码" (importance=0.90)
- "学生在文件 I/O 实验中表现出色 (3 次满分)，可以适当提高难度" (importance=0.60)
```

### 3.4 动态分层注入到上下文

每次请求构建 AI 上下文时，按以下优先级和大小限制注入：

```
L0 总预算: ~6K tokens (可配置)

分配:
  system_prompt (教学人格 + 教学策略指令)  ...  ~800 tokens
  L3 用户画像摘要                          ...  ~200 tokens
  L3 跨会话 Top-K 记忆                    ...  ~300 tokens  (按 importance DESC LIMIT 5)
  L1 full_summary                         ...  ~300 tokens
  L1 key_facts (最近 3 条)                 ...  ~100 tokens
  检测数据                                 ...  ~800 tokens  (strace + test + deadlock)
  最近 8 轮全量原文                         ...  ~2000 tokens (估计)
  当前用户消息                              ...  ~200 tokens
  RAG 结果                                 ...  ~1000 tokens (如果启用)
  ─────────────────────────────────────────
  合计                                     ...  ~5700 tokens
```

当 ContextFirewall 检测到 token 逼近水位线时，自动压缩非关键上下文（与现有四级水位逻辑兼容）。

---

## 四、检测数据全量注入

### 4.1 Go 端改造

在 `conversation.go` 的 `SendMessage` 中，构建 AI 请求前增加一次 `getLatestDetectionContext()` 查询：

```go
// 新增方法：查询最新提交的全量检测数据
func (h *ConversationHandler) getLatestDetectionContext(
    ctx context.Context,
    experimentID string,
    userID string,
) (*DetectionContext, error) {
    dc := &DetectionContext{}

    // 1. 最新提交
    h.db.QueryRow(ctx, `
        SELECT id, compile_error, runtime_error, score, total_score,
               passed_test_cases, total_test_cases,
               execution_time_ms, memory_usage_kb
        FROM submissions
        WHERE experiment_id=$1 AND student_id=$2
        ORDER BY created_at DESC LIMIT 1`,
        experimentID, userID).Scan(...)

    // 2. 测试用例结果
    rows, _ := h.db.Query(ctx, `
        SELECT test_name, passed, actual_output, expected_output,
               error_message, is_public
        FROM test_results WHERE submission_id=$1`, dc.SubmissionID)
    // → dc.TestResults

    // 3. strace 分析 (从 NATS 缓存或 syscall_traces 聚合)
    h.db.QueryRow(ctx, `
        SELECT strace_summary_json FROM evaluation_events
        WHERE submission_id=$1 ORDER BY created_at DESC LIMIT 1`,
        dc.SubmissionID).Scan(...)
    // → dc.StraceSummary

    // 4. 死锁检测
    h.db.QueryRow(ctx, `
        SELECT detected, cycle, details, fix_hint
        FROM deadlock_reports WHERE submission_id=$1`,
        dc.SubmissionID).Scan(...)

    // 5. 最近诊断结果
    h.db.QueryRow(ctx, `
        SELECT d.error_type, d.root_cause, d.severity
        FROM diagnoses d WHERE d.submission_id=$1
        ORDER BY d.created_at DESC LIMIT 1`,
        dc.SubmissionID).Scan(...)

    return dc, nil
}
```

### 4.2 Python ChatRequest 扩展

```python
class ChatRequest(BaseModel):
    # ... 现有字段 ...
    compile_error: Optional[str] = None
    runtime_error: Optional[str] = None
    test_results: Optional[list[dict]] = None
    strace_summary: Optional[dict] = None       # 结构化 strace 摘要
    deadlock: Optional[dict] = None             # 死锁检测结果
    last_diagnosis: Optional[dict] = None       # 上轮诊断结论
    student_profile: Optional[dict] = None      # 用户画像
    conversation_summary: Optional[str] = None  # L1 full_summary
    key_facts: Optional[list] = None            # L1 key_facts
    long_term_memories: Optional[list] = None   # L3 Top-K
```

### 4.3 注入后效果对比

| 场景 | 改造前 AI 知道的 | 改造后 AI 知道的 |
|------|----------------|----------------|
| "为什么我的程序跑不过" | 只有代码原文 | 代码 + strace 分析 (5000 次 write, FD 泄漏) + 测试结果 (3/5 失败) + 上次诊断 (fork 分支逻辑错误) |
| "什么是 fork 的 COW" | 仅基础模型知识 | 基础知识 + 用户画像 (该学生对 fork 理解弱) + L3 记忆 (上次用拍照比喻有效) |
| "帮我看看代码" | 只有当前消息的代码 | 代码 + 编译错误 + 运行输出 + 用户画像 (已经提交 5 次，分数在下降) |

---

## 五、提示词工程重构方案

### 5.1 核心改造：解除矛盾 + 混合输出

**改前**（`diagnosis_tutor.py:108`）：两个矛盾的 system prompt 暴力拼接。

**改后架构**：

```
system_prompt = BASE_TEACHING_PERSONA      # 教学人格 (800 tokens)
              + INTENT_PREFIX[intent]       # 意图前缀 (300 tokens)
              + STUDENT_PROFILE_CTX          # 学生画像上下文 (200 tokens)
              + DETECTION_DATA_CTX           # 检测数据上下文 (800 tokens)
              + L1_L3_MEMORY_CTX             # 记忆摘要 (400 tokens)

user_prompt   = USER_MESSAGE                # 用户当前消息
              + RAG_CONTEXT                 # RAG 知识 (可选)
              + OUTPUT_FORMAT_RULES         # 输出格式规则 (150 tokens)
```

**不再有** "必须只输出一个完整的 JSON 对象" 这种暴力覆盖指令。改为混合输出：

```
你是 TraceOS 的实验导师，学生叫你「小 T」。

## 身份与性格
你是一个耐心的、知识渊博的 OS 教学学长。你的对话风格:
- 像实验室里坐在学生旁边的导师，不是写论文
- 用生活化的比喻解释 OS 概念，但不牺牲准确性
- 先理解学生的困惑，再给引导，别上来就下诊断结论
- 用 "我们来看看"、"咱们分析一下" 这样一起探索的语气

## 核心教学原则
1. 不给完整答案: 给学生足够的提示让他自己找到答案，
   提示分为 L1(方向)、L2(具体)、L3(线索) 三级
2. 关联 OS 原理: 每个问题都关联到具体的操作系统概念，
   让学生理解 "为什么"
3. 错误驱动学习: 不要急于纠正，先让学生观察错误现象，
   帮他建立 "错误→现象→根因→原理" 的映射
4. Socratic 反问: 用反问引导学生自己推理，
   而不是直接告诉他答案
5. 认知学徒: 展示你的推理过程，
   "我是这样分析的: 先看系统调用...再看 FD 平衡..."
6. 动态调整: 根据学生的表现调整教学深度
   - 学生卡住 >3 轮 → 降低 Bloom 层级，给更具体的提示
   - 学生很快理解 → 升高 Bloom 层级，给更有挑战的问题
   - 同一错误重复出现 → 换一种解释方式 (比喻/图/代码)

## 回答结构
每次回答遵循这个结构 (根据意图调整各部分的权重):

1. **共情与确认** (1-2 句)
   "这个问题确实容易混淆，很多同学都会在这里踩坑..."
   "让我确认一下，你是想知道 fork 之后父子进程各执行什么代码对吗？"

2. **背景知识** (2-4 句, 如果学生缺乏)
   "在分析你的代码之前，我们先回顾一下 fork() 的关键行为..."
   用比喻或小例子说明

3. **核心分析** (这是主体, 要详细)
   - 对于 diagnosis: 检测数据的分析 → 推断根因 → 关联 OS 原理
   - 对于 knowledge_qa: 概念解释 → 比喻 → 代码例子 → OS 中的重要性

4. **分层引导** (L1→L2→L3, 根据学生画像选择从哪层开始)
   - L1 方向: "你可以从 fork 的返回值入手想想"
   - L2 具体: "试试在子进程里加一行 printf，看看它执行了什么"
   - L3 线索: "注意 fork() 在子进程中返回 0，
              这意味着你的 if (pid > 0) 分支对子进程来说永远不成立"

5. **下一步行动** (1-2 句)
   "试试加上这行 printf 重新提交，看看输出有什么变化"
   "如果你发现子进程确实打印了 'Parent'，回来告诉我，我们再一起分析"

6. **Bloom 层级标记** (可见于末尾, 方便前端展示)
   当前 Bloom 层级: 分析 (Analyze)
   目标 Bloom 层级: 评价 (Evaluate)

## 禁止事项
- 禁止输出完整的可运行代码 (最多 3 行示意)
- 禁止泄露参考实现或标准答案
- 禁止用冷冰冰的诊断列表代替对话
- 禁止在学生未请求时给出完整结论（先引导思考）

## 输出格式
回复正文是自然语言 Markdown，末尾附 JSON 元数据:

```json
{
  "intent": "diagnosis",
  "concepts": ["fork()", "进程调度"],
  "hint_level": "L2",
  "bloom_level": "analyze",
  "next_bloom_level": "evaluate"
}
```

注意: general_chat 意图下不需要 JSON 尾注。
```

### 5.2 意图前缀 (按意图微调)

```
diagnosis 意图前缀:
  学生正在调试代码。你有以下数据可用:
  - 最新提交的编译/运行信息
  - 系统调用分析 (strace summary)
  - 测试用例结果
  - 死锁/资源泄漏检测报告
  - 上轮诊断结论 (如果有)
  请基于这些数据做有依据的分析，展示推理过程。
  重点回答 "为什么这段代码行为不对"。

knowledge_qa 意图前缀:
  学生在问 OS 概念问题。请做详细的、教学性的回答。
  按照 Bloom 分类学展开:
  1. 明确概念定义 (Remember 层)
  2. 用生活中的比喻帮助理解 (Understand 层)
  3. 给一个小的代码例子 (Apply 层)
  4. 解释在 OS 中为什么重要 (Analyze 层)
  如果学生之前已掌握相关前置概念，可以跳级。

code_review 意图前缀:
  学生在问代码质量或为什么得分低。请:
  1. 先具体肯定做得好的地方 (不要空泛的 "代码不错")
  2. 按重要性排序指出改进点
  3. 每个改进点关联 OS 最佳实践
  4. 给出具体的改进方向 (不给出完整实现)

general_chat 意图前缀:
  学生在闲聊或问平台使用问题。友好回应，不强制输出 JSON。
  如果话题可以自然引回 OS 学习，尝试引导。
```

### 5.3 去掉的压制性指令

| 旧指令 | 位置 | 问题 | 新指令 |
|--------|------|------|--------|
| "每段话不要太长" | `diagnosis_tutor.py:26` | 主动压制细节 | 删除 (改为 "一个问题说清楚") |
| "请简洁输出，避免冗余" | `diagnosis/prompts.py:15` | 主动压制细节 | 删除 |
| feedback level_1: "1-2句话", level_2: "2-3句话" ... | `prompt_builder.py:91-94` | 句数硬限制 | 改为方向性描述 |
| "必须只输出一个完整的 JSON 对象" | `prompt_builder.py:80` | 与聊天人格冲突 | 改为 "正文 Markdown + 末尾 JSON 尾注" |
| temperature=0.3 | `diagnosis_tutor.py:115` | 过于保守 | 改为 0.7 (教学需要多样性) |
| ContextFirewall "请简洁输出" | `diagnosis/prompts.py:15` | 全局压制 | 仅保留 token 水平统计，删除 style 指令 |

### 5.4 详细的反馈结构 (替代 "1-2句" 的硬限制)

```
L1 (方向级提示):
  给一个大致方向，让学生自己决定往哪走。
  示例: "你的程序输出很奇怪——父子进程都打印了同一句话。
        想想 fork 之后，子进程和父进程看到的 pid 值有什么不同？"

L2 (策略级提示):
  给一个具体的调试路径，让学生自己执行。
  示例: "试试在 fork() 调用之后，在 if (pid > 0) 和 else if (pid == 0)
        两个分支里各加一行 printf 打印 pid 值。
        然后重新编译运行，看看两个分支哪个被执行了。"

L3 (线索级提示):
  给一个接近答案的线索，差一步就能想通。
  示例: "关键线索: fork() 在子进程中返回 0，在父进程中返回子进程的 PID。
        如果你的代码结构是 if (pid > 0) { printf('Parent\n'); }
        else { printf('Child\n'); }——现在想想，子进程看到的 pid 是多少？
        它进的是哪个分支？"
```

---

## 六、数据库变更

### 6.1 新建表

```sql
-- L1 会话记忆
CREATE TABLE conversation_memories (
    conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    full_summary TEXT,
    key_facts JSONB DEFAULT '[]',
    compressed_until_turn INT DEFAULT 0,
    last_compressed_at TIMESTAMPTZ,
    total_compressed_tokens INT DEFAULT 0,
    memory_version INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- L3 长期记忆
CREATE TABLE long_term_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    experiment_id UUID,
    memory_type TEXT NOT NULL,
    content TEXT NOT NULL,
    importance FLOAT DEFAULT 0.5,
    source_conversation_ids UUID[],
    hit_count INT DEFAULT 0,
    last_recalled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ltm_user_exp ON long_term_memories(user_id, experiment_id);
```

### 6.2 修改表

```sql
-- messages 表新增字段
ALTER TABLE messages ADD COLUMN importance FLOAT DEFAULT 0.5;
ALTER TABLE messages ADD COLUMN is_compressed BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN compressed_summary TEXT;
ALTER TABLE messages ADD COLUMN turn_index INT;
```

### 6.3 已有表利用

- `student_profiles` — 已有，需要 Go 端定期聚合 `submissions` 更新统计数据
- `submissions` — 已有，Go 端查询最新提交的检测数据
- `test_results` — 已有，Go 端查询测试用例结果
- `deadlock_reports` — 已有，Go 端查询死锁检测
- `syscall_traces` — 已有 (TimescaleDB)，Go 端聚合或利用已有的 `evaluation_events.strace_summary_json`

---

## 七、实施计划

### Phase 1: 提示词重构 (1-2 天)

**目标**：解决 AI 回复简陋的核心问题，不影响现有功能

1. 创建 `services/ai-service/app/agents/prompts/` 目录
2. 新建 `base_teaching_persona.py` — 统一教学人格 system prompt
3. 新建 `intent_prefixes.py` — 四种意图的教学策略前缀
4. 重写 `diagnosis_tutor.py` 的 `DIAGNOSIS_TUTOR_SYSTEM_PROMPT` 为新的 base persona
5. 修改 `prompt_builder.py`：
   - 删除 `SYSTEM_PROMPT_BASE` 中的 JSON-only 暴力指令
   - 删除 feedback 句数限制
   - 添加混合输出格式指令（"正文 Markdown + 末尾 JSON 尾注"）
   - 删除 `diagnosis/prompts.py` 中 `CONTEXT_FIREWALL_PREAMBLE` 的 "请简洁输出"
6. 修改 `diagnosis_tutor.py:115` temperature 从 0.3 → 0.7
7. 修改 `graph.py` 各 intent handler 使用对应的 intent prefix
8. 修改 `harness_adapter.py` 的输出解析支持混合格式

**验证**：用 `prompt_builder_test.py` 构造各类场景，观察输出长度和质量

### Phase 2: 检测数据注入 (1-2 天)

**目标**：Chat AI 能访问检测数据，解决 "为什么跑不过" 类问题

1. Go `conversation.go`: 实现 `getLatestDetectionContext()` 方法
2. Go `conversation.go`: `SendMessage` 中调用，拼入 AI 请求
3. Python `chat.py` `ChatRequest`: 新增 `test_results`、`strace_summary`、`deadlock`、`last_diagnosis` 字段
4. Python `graph.py`: 将检测数据格式化为 context string，注入 `run_diagnosis` 等节点
5. Python `prompt_builder.py`: `build_diagnosis_prompt` 中根据新字段生成更丰富的 user prompt
6. **前置确认**：如果 `evaluation_events` 表不存在，需先创建或在 Go 端从 `syscall_traces` 聚合

**验证**：提交一段有 bug 的代码 → 触发诊断 → 在聊天中问 "为什么跑不过" → 观察 AI 是否引用了 strace 数据

### Phase 3: L1 短期记忆 + 混合压缩 (2-3 天)

**目标**：对话超过 20 轮后不再丢失早期信息

1. 执行 6.1 和 6.2 的数据库变更
2. Go 端实现关键轮次标记（importance 规则）
3. Go 端实现 `compressConversation()` 异步方法：
   - 检查是否需要压缩
   - 执行规则层 + 分组层
   - 触发 LLM 摘要（调用 Python AI service 的专用 endpoint）
   - 更新 `conversation_memories` 和 `messages.is_compressed`
4. Python 端新增 `/api/ai/memory/compress` endpoint：
   - 接收待压缩消息列表
   - 调用 LLM 生成结构化增量摘要
   - 返回 `{incremental_summary, key_facts}`
5. Go `SendMessage` 改为分层检索替代 `LIMIT 20`
6. Python `chat.py` 接收并注入 L1 数据到 context

**验证**：mock 一个 50 轮的对话 → 检查压缩后的 `full_summary` + `key_facts` 是否覆盖关键信息

### Phase 4: L3 长期记忆 + 用户画像 (1-2 天)

**目标**：跨会话持久化知识，新会话自动注入相关历史

1. 执行 6.1 中 `long_term_memories` 建表
2. Python 端新增 `/api/ai/memory/extract-ltm` endpoint：
   - 会话关闭/归档时调用
   - 从 L1 `full_summary` + `key_facts` 提取 L3 记忆
   - 去重 + 更新 importance
3. Go 端会话关闭触发 L3 提取
4. Python `memory.py` `MemoryManager`：
   - `build_memory_context()` 改为返回 `StudentMemory + L3 Top-K`
   - 注入到 `graph.py` 的 context 中
5. Go `SendMessage` 中查询 `long_term_memories` Top-5
6. 前端 `MemoryTiers` store 改为对接真实 API

**验证**：一个学生在多个实验中反复犯同一错误 → 观察新会话开始时 AI 是否引用历史记忆

### Phase 5: 前端适配 (1 天)

**目标**：前端展示记忆层级和检测摘要

1. `MonitoringPanel.tsx` 展示三层记忆状态 (tokens used, summary, key facts)
2. 对话中可选展示 "检测数据摘要" 卡片（AI 引用的数据源）
3. `ConversationSidebar.tsx` 中会话列表显示 `compressed_until_turn / total_turns`

---

## 八、成功指标

| 指标 | 当前 | 目标 | 测量方式 |
|------|------|------|---------|
| AI 回复平均长度 | ~200 字 (机械 JSON) | ~500-800 字 (自然教学) | 抽样统计 |
| 20 轮后历史覆盖率 | 0% (LIMIT 20 之外全丢) | ~85% (压缩摘要保留关键信息) | 构造 50 轮对话，人工评估摘要准确度 |
| 检测数据引用率 | 0% (不传数据) | ~90% (diagnosis 场景应引用 strace/test) | 日志统计 |
| 学生画像准确率 | N/A (未使用) | 弱项/强项 与 教师评估 一致性 >70% | 抽样对比 |
| 意图识别准确率 | ~85% | ~90% | 统计 100 次对话的 intent 与人工标注 |

---

## 九、风险与回滚

### 风险 1：提示词改变后输出格式不稳定

- **缓解**：混合输出中 JSON 尾注是 ` ```json ``` ` 代码块而非纯 JSON，解析容错性强
- **回滚**：保留旧 `SYSTEM_PROMPT_BASE` 为 `SYSTEM_PROMPT_BASE_LEGACY`，开关控制

### 风险 2：LLM 摘要质量不稳定

- **缓解**：摘要只用轻量 prompt (temperature=0.1, max_tokens=512)，输出结构化 JSON，有 schema 校验
- **回滚**：摘要失败时降级为规则摘要（key facts 只取 importance≥0.8 的轮次原文）

### 风险 3：检测数据注入导致 token 爆预算

- **缓解**：Go 端注入前对检测数据做上限截断（strace_summary ≤800 chars, test_results ≤5 条）。ContextFirewall 已有的四级水位作为最后防线

### 风险 4：长期记忆写入了错误信息

- **缓解**：L3 记忆有 `importance` 衰减（30 天未 recall → *0.9）。用户可在对话中 explicit 地说 "这不是对的" 触发记忆失效。前端可选展示 "AI 正在参考的历史记忆" 列表

---

## 十、附录：OS 教学专用知识提示词模板

以下模板用于知识型回答（knowledge_qa 意图），展示 Bloom 分类学对齐的详细回答结构：

```markdown
## 概念: {concept_name}

### 定义 (Remember 层)
{1-2 句精确定义}

### 生活化理解 (Understand 层)
{一个具体的生活场景比喻，让零基础学生也能理解}

### 最小代码例子 (Apply 层)
​```c
// 刻意最简，3-5 行
{核心演示代码}
​```
{解释这段代码中发生了什么}

### 在 OS 中的作用 (Analyze 层)
{这个概念为什么对操作系统重要？
没有它会发生什么？
OS 内核用了它做什么事？}

### 常见错误与陷阱
{学生在此概念上最常犯的 1-2 个错误，以及如何避免}

### 试试看 (Evaluate/Create 层)
{一个引导学生自己探索的小挑战}
```