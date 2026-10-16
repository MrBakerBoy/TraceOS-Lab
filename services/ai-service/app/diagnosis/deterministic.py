"""确定性观测提取器 — 纯规则计算, 无 LLM, 无评分.

红线: AI 不碰评分。本模块只从 Core 评测事件中提取确定性「观测事实」,
作为诊断 Agent 的输入证据, 不产出任何分数 (不产出 total_score / six_dim_scores)。

观测事实 (用户确认范围):
  - fd 泄漏计数 (open - close)
  - mmap/munmap 差值
  - fork/wait 差值 (僵尸进程风险)
  - 执行时间
  - 测试通过数 / 总数
  - Core 真值: is_qualified / core_score / edge_score
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class Observations:
    """确定性观测事实 (非分数)."""

    # 测试观测
    passed_cases: int = 0
    total_cases: int = 0
    test_pass_rate: float = 0.0

    # 执行观测
    execution_time_ms: float | None = None
    status: str = ""
    compile_error: str = ""

    # 资源观测 (内核级确定性事实)
    fd_open_count: int = 0
    fd_close_count: int = 0
    fd_leak: int = 0            # open - close, 正值 = 泄漏
    mmap_count: int = 0
    munmap_count: int = 0
    mmap_munmap_diff: int = 0   # 正值 = 内存分配未释放
    fork_count: int = 0
    wait_count: int = 0
    fork_wait_diff: int = 0     # 正值 = 子进程未回收 (僵尸风险)
    deadlock: bool = False      # 内核观测锁等待环

    # Core 唯一真值 (透传, 非 AI 产出)
    is_qualified: bool = False
    core_score: float = 0.0
    edge_score: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed_cases": self.passed_cases,
            "total_cases": self.total_cases,
            "test_pass_rate": round(self.test_pass_rate, 4),
            "execution_time_ms": self.execution_time_ms,
            "status": self.status,
            "compile_error": self.compile_error[:500],
            "fd_open_count": self.fd_open_count,
            "fd_close_count": self.fd_close_count,
            "fd_leak": self.fd_leak,
            "mmap_count": self.mmap_count,
            "munmap_count": self.munmap_count,
            "mmap_munmap_diff": self.mmap_munmap_diff,
            "fork_count": self.fork_count,
            "wait_count": self.wait_count,
            "fork_wait_diff": self.fork_wait_diff,
            "deadlock": self.deadlock,
            "is_qualified": self.is_qualified,
            "core_score": self.core_score,
            "edge_score": self.edge_score,
        }


# ---------------------------------------------------------------------------
# 资源观测检测 (供 syscall_analyzer 等构造 findings)
# ---------------------------------------------------------------------------
def detect_fd_leak(fd_balance: dict | None) -> tuple[int, dict]:
    """返回 (泄漏数, 明细). 泄漏数 = open - close, 负值按 0 处理.

    兼容两类数据源:
      - ebpf_metrics.resource 风格: {"fd_leak": n}
      - strace_summary.fd_balance 风格: {"opens": n, "closes": n, "has_leak": bool}
    """
    if not fd_balance:
        return 0, {}
    if "fd_leak" in fd_balance:
        leak = max(0, int(fd_balance.get("fd_leak") or 0))
        return leak, {"fd_leak": leak}
    open_count = int(fd_balance.get("opens", fd_balance.get("open", 0)) or 0)
    close_count = int(fd_balance.get("closes", fd_balance.get("close", 0)) or 0)
    leak = max(0, open_count - close_count)
    return leak, {"open": open_count, "close": close_count, "leak": leak}


def detect_memory_imbalance(memory_balance: dict | None) -> tuple[int, dict]:
    """返回 (分配-释放差值, 明细). 正值 = 分配未释放.

    兼容:
      - ebpf_metrics.resource: {"memory_imbalance": n}
      - strace_summary.memory_balance: {"alloc_calls": n, "free_calls": n}
    """
    if not memory_balance:
        return 0, {}
    if "memory_imbalance" in memory_balance:
        diff = max(0, int(memory_balance.get("memory_imbalance") or 0))
        return diff, {"memory_imbalance": diff}
    alloc = int(memory_balance.get("alloc_calls", memory_balance.get("mmap", 0)) or 0)
    free = int(memory_balance.get("free_calls", memory_balance.get("munmap", 0)) or 0)
    diff = max(0, alloc - free)
    return diff, {"alloc": alloc, "free": free, "diff": diff}


def detect_process_zombie(process_balance: dict | None) -> tuple[int, dict]:
    """返回 (fork-wait 差值, 明细). 正值 = 子进程未回收.

    兼容:
      - ebpf_metrics.resource: {"zombie": n}
      - strace_summary.process_balance: {"fork_calls": n, "wait_calls": n}
    """
    if not process_balance:
        return 0, {}
    if "zombie" in process_balance:
        diff = max(0, int(process_balance.get("zombie") or 0))
        return diff, {"zombie": diff}
    fork_count = int(process_balance.get("fork_calls", process_balance.get("fork", 0)) or 0)
    wait_count = int(process_balance.get("wait_calls", process_balance.get("wait", 0)) or 0)
    diff = max(0, fork_count - wait_count)
    return diff, {"fork": fork_count, "wait": wait_count, "diff": diff}


# ---------------------------------------------------------------------------
# 从 ContextPackage 提取观测事实
# ---------------------------------------------------------------------------
def extract_observations(ctx: Any) -> Observations:
    """从 ContextPackage 提取确定性观测事实 (非分数).

    资源观测优先取 Core 抽取的 `ebpf_metrics.resource` (fd_leak / memory_imbalance /
    zombie / deadlock), 回退到 strace_summary 的 balance 字典 (opens/closes 等)。
    """
    sb = ctx.score_breakdown or {}
    resource = (ctx.ebpf_metrics or {}).get("resource", {}) or {}

    # 派生观测 (ebpf_metrics 优先, 回退到 balance 检测)
    fd_leak, _ = detect_fd_leak(resource) if "fd_leak" in resource else detect_fd_leak(ctx.fd_balance or None)
    mem_diff, _ = detect_memory_imbalance(resource) if "memory_imbalance" in resource else detect_memory_imbalance(ctx.memory_balance or None)
    proc_diff, _ = detect_process_zombie(resource) if "zombie" in resource else detect_process_zombie(ctx.process_balance or None)
    deadlock = bool(resource.get("deadlock", False))

    fd_bal = ctx.fd_balance or {}
    mem_bal = ctx.memory_balance or {}
    proc_bal = ctx.process_balance or {}

    passed = int(sb.get("passed_cases") or 0)
    total = int(sb.get("total_cases") or 0)
    rate = (passed / total) if total > 0 else 0.0

    obs = Observations(
        passed_cases=passed,
        total_cases=total,
        test_pass_rate=rate,
        execution_time_ms=sb.get("execution_time"),
        status=str(sb.get("status") or ""),
        compile_error=str(ctx.compile_error or ""),
        fd_open_count=int(fd_bal.get("opens", fd_bal.get("open", 0)) or 0),
        fd_close_count=int(fd_bal.get("closes", fd_bal.get("close", 0)) or 0),
        fd_leak=fd_leak,
        mmap_count=int(mem_bal.get("alloc_calls", mem_bal.get("mmap", 0)) or 0),
        munmap_count=int(mem_bal.get("free_calls", mem_bal.get("munmap", 0)) or 0),
        mmap_munmap_diff=mem_diff,
        fork_count=int(proc_bal.get("fork_calls", proc_bal.get("fork", 0)) or 0),
        wait_count=int(proc_bal.get("wait_calls", proc_bal.get("wait", 0)) or 0),
        fork_wait_diff=proc_diff,
        deadlock=deadlock,
        is_qualified=bool(sb.get("is_qualified", False)),
        core_score=float(sb.get("core_score") or 0),
        edge_score=float(sb.get("edge_score") or 0),
    )
    logger.info(
        "Observations: qualified=%s, core=%.1f, tests=%d/%d, fd_leak=%d, mem_diff=%d, fork_wait_diff=%d, deadlock=%s",
        obs.is_qualified, obs.core_score, obs.passed_cases, obs.total_cases,
        obs.fd_leak, obs.mmap_munmap_diff, obs.fork_wait_diff, obs.deadlock,
    )
    return obs


# ---------------------------------------------------------------------------
# 严重度判定 — 以 Core is_qualified 为唯一合格真值
# ---------------------------------------------------------------------------
def derive_severity(is_qualified: bool, obs: Observations | None = None) -> str:
    """根据 Core 合格判定 + 确定性观测事实推导严重度 (不再依据 AI 分数).

    - is_qualified=True  → low (合格, 问题轻微)
    - 未达标且有资源泄漏/僵尸进程/编译错误 → high
    - 其余未达标 → medium
    """
    if is_qualified:
        return "low"

    if obs is None:
        return "medium"

    # 严重缺陷信号 (内核级观测事实)
    if obs.fd_leak > 0 or obs.fork_wait_diff > 0 or obs.mmap_munmap_diff > 0 or obs.deadlock:
        return "high"
    if obs.compile_error:
        return "high"
    return "medium"


# ---------------------------------------------------------------------------
# 确定性概念映射 (降级后的 concept_rubric, 无 LLM)
# ---------------------------------------------------------------------------
CONCEPT_LIBRARY: dict[str, list[str]] = {
    "process": ["进程创建 (fork)", "进程回收 (wait/waitpid)", "进程状态转换"],
    "thread": ["线程创建", "线程同步 (互斥/join)", "线程退出"],
    "memory": ["内存分配 (malloc/mmap)", "内存释放 (free/munmap)", "内存泄漏识别"],
    "io": ["文件描述符管理", "文件读写 (read/write)", "I/O 重定向"],
    "ipc": ["管道通信 (pipe)", "信号处理 (signal)", "共享内存/消息队列"],
    "deadlock": ["互斥锁 (mutex)", "死锁四条件", "锁顺序与资源竞争"],
    "file": ["文件描述符管理", "文件读写 (read/write)", "文件关闭 (close)"],
}

DEFAULT_CONCEPTS = ["OS 系统调用", "进程与资源管理"]


def map_concepts(category: str, is_qualified: bool) -> tuple[list[str], dict[str, int]]:
    """实验 category → 概念库 + 确定性达成度 (非 LLM 评分).

    达成度为粗粒度确定性映射: 合格 → 2 (达标), 未达标 → 1 (待加强)。
    不伪造每个概念的细粒度分数。
    """
    category = (category or "").strip().lower()
    concepts = CONCEPT_LIBRARY.get(category, DEFAULT_CONCEPTS)
    level = 2 if is_qualified else 1
    radar = {c: level for c in concepts}
    return concepts, radar