"""Trace Timeline AI Analysis Router — LLM-powered plain-language interpretation."""

import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.llm_client import get_llm_provider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/trace", tags=["trace-analysis"])


# ── Request / Response Models ──────────────────────────────────────────────

class TraceSyscallItem(BaseModel):
    name: str
    count: int
    total_duration_ns: int
    avg_duration_ns: int
    percent: float


class TraceErrorItem(BaseModel):
    syscall: str
    error: str
    count: int
    phase: str = ""  # "startup" | "main" | "cleanup"


class PhaseStats(BaseModel):
    phase: str       # "startup" | "main" | "cleanup"
    call_count: int
    error_count: int
    unique_syscalls: int
    dominant_syscall: str = ""


class TraceAnalysisRequest(BaseModel):
    submission_id: str
    code: str = ""
    language: str = "c"
    total_calls: int = 0
    unique_syscalls: int = 0
    error_count: int = 0
    total_duration_ns: int = 0
    top_syscalls: list[TraceSyscallItem] = Field(default_factory=list)
    error_syscalls: list[TraceErrorItem] = Field(default_factory=list)
    phases: list[PhaseStats] = Field(default_factory=list)


class SyscallExplanation(BaseModel):
    name: str
    plain_meaning: str
    why_program_uses_it: str


class ErrorExplanation(BaseModel):
    syscall: str
    error: str
    plain_reason: str
    fix_hint: str


class PhaseExplanation(BaseModel):
    phase: str
    phase_label: str  # "程序启动阶段" | "主体运行阶段" | "收尾阶段"
    summary: str


class PatternItem(BaseModel):
    type: str   # "io_heavy" | "compute_heavy" | "error_prone" | "multi_process" | "memory_intensive" | "normal"
    explanation: str


class PerformanceInsight(BaseModel):
    severity: str  # "high" | "medium" | "low" | "info"
    title: str
    explanation: str
    suggestion: str


class TraceAnalysisResponse(BaseModel):
    plain_summary: str
    syscall_explanations: list[SyscallExplanation] = Field(default_factory=list)
    error_explanations: list[ErrorExplanation] = Field(default_factory=list)
    phase_analysis: list[PhaseExplanation] = Field(default_factory=list)
    patterns: list[PatternItem] = Field(default_factory=list)
    performance_insights: list[PerformanceInsight] = Field(default_factory=list)
    raw_error: Optional[str] = None


# ── System Prompt ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """你是一个操作系统实验教学平台的 AI 分析助手。你的受众是完全零基础的计算机系学生和老师。
你的任务是解读程序运行过程中采集的系统调用时间线追踪数据，用通俗的大白话告诉用户：程序从启动到结束的整个过程中做了什么、分为几个阶段、有没有出错、哪里可能慢。

## 核心规则
1. 用通俗中文，绝对避免使用技术术语。"系统调用"可以说成"程序向操作系统请求服务"。
2. 按照程序运行的时间阶段（启动阶段、主体运行阶段、收尾阶段）来解释程序的行为。
3. 面向完全没有操作系统知识的师生。
4. 如果有错误（如打开不存在的文件），要清楚解释错误原因和修复方向。
5. 关注耗时：如果一个操作耗时特别长，要指出并给出优化建议。

## 输出格式
必须返回严格的 JSON，不要包含任何 JSON 之外的内容：
{
  "plain_summary": "一段 2-3 句的大白话总结，说明程序整体做了什么，有没有出错，运行是否正常",
  "syscall_explanations": [
    {
      "name": "系统调用名",
      "plain_meaning": "这个操作是干什么的（大白话，不超过20字）",
      "why_program_uses_it": "你的程序为什么需要它（大白话，不超过50字）"
    }
  ],
  "error_explanations": [
    {
      "syscall": "出错的系统调用名",
      "error": "错误类型",
      "plain_reason": "为什么会出这个错（大白话）",
      "fix_hint": "怎么修复（大白话建议）"
    }
  ],
  "phase_analysis": [
    {
      "phase": "startup / main / cleanup",
      "phase_label": "程序启动阶段 / 主体运行阶段 / 收尾阶段",
      "summary": "这个阶段程序主要做了什么（大白话，1-2句）"
    }
  ],
  "patterns": [
    {
      "type": "io_heavy / compute_heavy / error_prone / multi_process / memory_intensive / normal",
      "explanation": "对整体模式的大白话解释"
    }
  ],
  "performance_insights": [
    {
      "severity": "high / medium / low / info",
      "title": "简短标题",
      "explanation": "大白话解释",
      "suggestion": "优化建议"
    }
  ]
}

## 常见系统调用的大白话解释参考
- read/write: 读写文件或终端（读取文件内容、打印输出）
- open/openat: 打开文件
- close: 关闭文件
- mmap/munmap: 分配或释放内存
- brk: 调整程序使用的内存大小
- futex: 线程之间的等待和唤醒
- clone: 创建新线程
- execve: 运行另一个程序
- fork: 创建新进程（复制自己）
- stat/fstat: 查看文件信息
- nanosleep: 程序主动暂停等待

## 阶段识别指南
- 启动阶段（startup）：程序刚开始运行，通常会有大量 open/stat/mmap 操作（加载动态库、打开配置文件）
- 主体运行阶段（main）：程序的核心业务逻辑，读写、计算、进程/线程操作集中出现
- 收尾阶段（cleanup）：程序快结束时，通常 close/munmap/exit 操作较多

## 模式识别指南
- 大量 read/write/open/close → io_heavy（程序在做大量文件读写）
- 大量 mmap/brk/munmap → memory_intensive（程序在频繁分配释放内存）
- 大量 clone/fork/futex → multi_process（多进程/多线程程序）
- 错误调用占总调用超过 10% → error_prone
- futex/nanosleep 占比高 → 程序有大量等待，可能是多线程或主动休眠
- 分布均匀、无明显特征 → normal
"""


# ── Route ───────────────────────────────────────────────────────────────────

@router.post("/analyze", response_model=TraceAnalysisResponse)
async def analyze_trace(req: TraceAnalysisRequest):
    """Analyze trace timeline data and return plain-language interpretation."""

    if req.total_calls == 0:
        return TraceAnalysisResponse(
            plain_summary="没有采集到系统调用追踪数据。可能程序运行时间太短或没有触发任何系统操作。",
            raw_error="no_trace_data",
        )

    # Build user prompt
    top_lines = []
    for sc in req.top_syscalls[:10]:
        avg_us = sc.avg_duration_ns / 1000 if sc.avg_duration_ns else 0
        top_lines.append(f"- {sc.name}: {sc.count} 次（占 {sc.percent}%，平均耗时 {avg_us:.1f}μs）")

    error_lines = []
    for es in req.error_syscalls[:10]:
        phase_tag = f" [{es.phase}]" if es.phase else ""
        error_lines.append(f"- {es.syscall} 出错: {es.error}（{es.count} 次）{phase_tag}")

    phase_lines = []
    for ps in req.phases[:3]:
        phase_labels = {"startup": "启动阶段", "main": "主体运行阶段", "cleanup": "收尾阶段"}
        label = phase_labels.get(ps.phase, ps.phase)
        dom = f"，最常用操作：{ps.dominant_syscall}" if ps.dominant_syscall else ""
        phase_lines.append(f"- [{label}] {ps.call_count} 次调用，{ps.error_count} 次出错，{ps.unique_syscalls} 种操作{dom}")

    total_ms = req.total_duration_ns / 1e6 if req.total_duration_ns else 0

    user_prompt = f"""请分析以下程序运行的系统调用时间线追踪数据：

程序总共发起了 {req.total_calls} 次系统操作，使用了 {req.unique_syscalls} 种不同的操作类型。
其中 {req.error_count} 次操作出错。
程序总运行时间约 {total_ms:.1f} 毫秒。

最频繁的系统操作 Top 10：
{chr(10).join(top_lines)}

{"出错的系统操作：" if error_lines else "（本次运行没有出错的操作）"}
{chr(10).join(error_lines) if error_lines else ""}

{"运行阶段分析：" if phase_lines else "（无阶段划分数据）"}
{chr(10).join(phase_lines) if phase_lines else ""}

{"学生代码片段（供参考）：" if req.code else ""}
{"```" + req.language if req.code else ""}
{req.code[:3000] if req.code else ""}
{"```" if req.code else ""}

请用大白话解释以上数据。重点分析：
1. 程序启动、运行、收尾各阶段做了什么
2. 有没有出错、在哪个阶段出错
3. 有没有性能问题（某个操作耗时特别长）
4. 整体程序行为是否正常"""

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
        return TraceAnalysisResponse(**data)

    except json.JSONDecodeError as e:
        logger.warning(f"LLM returned invalid JSON for trace analysis: {e}")
        fallback_text = content[:300].strip() if content and len(content) > 10 else ""
        return TraceAnalysisResponse(
            plain_summary=fallback_text if fallback_text else "AI 分析遇到技术问题，请稍后重试。如果持续出现，可以尝试刷新页面后重新分析。",
            raw_error=f"json_parse_error: {str(e)[:200]}",
        )
    except Exception as e:
        logger.error(f"Trace analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")
