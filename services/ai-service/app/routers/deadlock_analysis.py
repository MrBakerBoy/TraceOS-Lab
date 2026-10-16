"""Deadlock Analysis Router — LLM-powered interpretation of eBPF deadlock detection results.

Consumes the DeadlockReport produced by core-service's eBPF deadlock probe
(bpftrace futex tracepoints + Wait-For Graph cycle detection) and asks the LLM
to explain the deadlock in plain language, map it to the four Coffman conditions,
and produce Socratic teaching hints.
"""

import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.llm_client import get_llm_provider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/deadlock", tags=["deadlock-analysis"])


# ── Request / Response Models ──────────────────────────────────────────────

class LockNodeData(BaseModel):
    uaddr: str = ""
    holder: Optional[int] = None
    waiters: list[int] = Field(default_factory=list)


class DeadlockAnalysisRequest(BaseModel):
    submission_id: str = ""
    code: str = ""
    language: str = "c"
    detected: bool = False
    cycle: list[int] = Field(default_factory=list)
    details: list[str] = Field(default_factory=list)
    fix: str = ""
    threads: list[int] = Field(default_factory=list)
    locks: list[LockNodeData] = Field(default_factory=list)
    experiment_title: str = ""
    experiment_category: str = ""


class CoffmanCondition(BaseModel):
    name: str  # 互斥 / 占有并等待 / 不可抢占 / 循环等待
    satisfied: bool
    evidence: str


class DeadlockAnalysisResponse(BaseModel):
    plain_summary: str
    detected: bool = False
    coffman_conditions: list[CoffmanCondition] = Field(default_factory=list)
    root_cause: str = ""
    fix_suggestion: str = ""
    socratic_hint: str = ""
    severity: str = "info"  # info | warning | critical
    raw_error: Optional[str] = None


# ── System Prompt ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """你是一个操作系统实验教学平台的 AI 分析助手，专门解读 eBPF 死锁检测结果。你的受众是完全零基础的计算机系学生和老师。

你的输入是 eBPF (bpftrace futex tracepoint) 实时采集的锁等待图 (Wait-For Graph) 和死锁检测结果。你需要用通俗的大白话解释：程序里发生了什么、为什么这是死锁、怎么修。

## 死锁的四个必要条件（Coffman 条件）
1. 互斥 (Mutual Exclusion)：资源同一时刻只能被一个线程占用
2. 占有并等待 (Hold and Wait)：线程拿着一个锁的同时去等另一个锁
3. 不可抢占 (No Preemption)：锁不能被强制夺走，只能等持有者主动释放
4. 循环等待 (Circular Wait)：存在一个线程间互相等待的环

只要发生死锁，这四个条件一定同时成立。打破任意一个就能消除死锁。

## 核心规则
1. 用通俗中文，避免堆砌术语。必须用术语时在括号里加白话解释。
2. 如果检测到死锁：明确指出是哪种锁序问题（例如 AB-BA 反序），并结合代码推测哪里写反了。
3. 如果没检测到死锁：告诉用户线程正常完成，并简要解释为什么这次安全。
4. 修复建议要给方向，但不要直接写出完整的可运行答案代码（教学平台原则）。可给极简的结构示意（1-2 行）。
5. socratic_hint 是留给学生的一个引导式提问，帮他们自己想到答案。

## 输出格式
必须返回严格的 JSON，不要包含任何 JSON 之外的内容：
{
  "plain_summary": "2-3 句大白话总结发生了什么",
  "detected": true或false,
  "coffman_conditions": [
    {"name": "互斥", "satisfied": true, "evidence": "为什么满足/不满足（大白话）"},
    {"name": "占有并等待", "satisfied": true, "evidence": "..."},
    {"name": "不可抢占", "satisfied": true, "evidence": "..."},
    {"name": "循环等待", "satisfied": true, "evidence": "..."}
  ],
  "root_cause": "系统层面的根本原因，关联操作系统概念",
  "fix_suggestion": "修复方向（大白话），可含1-2行结构示意",
  "socratic_hint": "一个引导学生思考的提问",
  "severity": "critical或warning或info"
}

## 参考
- 两个线程互相持有对方想要的锁 → 循环等待 + 占有并等待，建议统一锁顺序
- 只有一个线程在等锁、没有环 → 不是死锁，可能只是正常同步等待
- 没有任何线程在等待 → 完全安全
"""


# ── Route ───────────────────────────────────────────────────────────────────

@router.post("/analyze", response_model=DeadlockAnalysisResponse)
async def analyze_deadlock(req: DeadlockAnalysisRequest):
    """Analyze eBPF deadlock detection results and return plain-language interpretation."""

    # No observation data at all
    if not req.threads and not req.locks and not req.detected:
        return DeadlockAnalysisResponse(
            plain_summary="没有采集到锁等待数据。可能程序没有使用互斥锁，或者运行时间太短未触发任何锁操作。",
            severity="info",
            raw_error="no_lock_data",
        )

    # Build user prompt with structured detection data
    cycle_str = " ↔ ".join(str(t) for t in req.cycle) if req.cycle else "无"
    details_str = "\n".join(f"- {d}" for d in req.details) if req.details else "（无详细信息）"
    locks_str = "\n".join(
        f"- 锁 {l.uaddr}：持有者 TID={l.holder if l.holder is not None else '无'}，等待者 TID={l.waiters or '无'}"
        for l in req.locks
    ) if req.locks else "（无锁信息）"

    code_block_open = "```" + req.language if req.code else ""
    code_block_close = "```" if req.code else ""
    code_section = f"学生代码片段（供参考，用于推测锁顺序问题）：\n{code_block_open}\n{req.code[:3000]}\n{code_block_close}" if req.code else ""

    user_prompt = f"""请分析以下 eBPF 死锁检测结果：

实验：{req.experiment_title or '未知'}（分类：{req.experiment_category or '未知'}）
检测结果：{'🔴 检测到死锁' if req.detected else '✅ 未检测到死锁'}
死锁环（线程 TID）：{cycle_str}
涉及线程：{req.threads or '无'}

锁等待图详情：
{locks_str}

死锁详情：
{details_str}

core 端初步修复建议：{req.fix or '无'}

{code_section}

请用大白话解释这次检测结果。如果检测到死锁，请指出四个 Coffman 条件中哪些成立、并给出修复方向和一个引导式提问。"""

    content = ""
    try:
        llm = get_llm_provider()
        resp = await llm.chat_completion(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.3,
            max_tokens=3072,
        )

        content = resp.content.strip()
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        data = json.loads(content)
        # Ensure detected reflects the actual detection result even if LLM drifts
        data["detected"] = req.detected
        return DeadlockAnalysisResponse(**data)

    except json.JSONDecodeError as e:
        logger.warning(f"LLM returned invalid JSON for deadlock analysis: {e}")
        fallback_text = content[:300].strip() if content and len(content) > 10 else ""
        return DeadlockAnalysisResponse(
            plain_summary=fallback_text if fallback_text else "AI 分析遇到技术问题，请稍后重试。",
            detected=req.detected,
            severity="critical" if req.detected else "info",
            raw_error=f"json_parse_error: {str(e)[:200]}",
        )
    except Exception as e:
        logger.error(f"Deadlock analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")
