"""eBPF Syscall Analysis Router — LLM-powered plain-language interpretation."""

import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.llm_client import get_llm_provider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ebpf", tags=["ebpf-analysis"])


# ── Request / Response Models ──────────────────────────────────────────────

class SyscallItem(BaseModel):
    name: str
    count: int
    percent: float


class ErrorSyscall(BaseModel):
    name: str
    error: str
    count: int


class EBPFAnalysisRequest(BaseModel):
    submission_id: str
    code: str = ""
    language: str = "c"
    total_calls: int = 0
    unique_syscalls: int = 0
    error_count: int = 0
    top_syscalls: list[SyscallItem] = Field(default_factory=list)
    error_syscalls: list[ErrorSyscall] = Field(default_factory=list)
    execution_time_ms: float = 0


class SyscallExplanation(BaseModel):
    name: str
    plain_meaning: str
    why_program_uses_it: str


class ErrorExplanation(BaseModel):
    syscall: str
    error: str
    plain_reason: str
    fix_hint: str


class SyscallPattern(BaseModel):
    type: str  # "excessive_io" | "frequent_alloc" | "error_prone" | "normal"
    explanation: str


class EBPFAnalysisResponse(BaseModel):
    plain_summary: str
    syscall_explanations: list[SyscallExplanation] = Field(default_factory=list)
    error_explanations: list[ErrorExplanation] = Field(default_factory=list)
    patterns: list[SyscallPattern] = Field(default_factory=list)
    raw_error: Optional[str] = None


# ── System Prompt ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """你是一个操作系统实验教学平台的 AI 分析助手。你的受众是完全零基础的计算机系学生和老师。
你的任务是解读 eBPF 采集的系统调用数据，用通俗的大白话告诉用户：程序在运行时做了哪些系统操作、有没有出错、这些意味着什么。

## 核心规则
1. 用通俗中文，绝对避免使用技术术语。"系统调用"可以说成"程序向操作系统请求服务"。
2. 每条解释都要回答两个问题："这个调用是干什么的"和"你的程序为什么需要它"。
3. 面向完全没有操作系统知识的师生。
4. 如果有错误（如打开不存在的文件），要清楚解释错误原因和修复方向。

## 输出格式
必须返回严格的 JSON，不要包含任何 JSON 之外的内容：
{
  "plain_summary": "一段 2-3 句的大白话总结",
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
  "patterns": [
    {
      "type": "excessive_io / frequent_alloc / error_prone / normal",
      "explanation": "对整体模式的大白话解释"
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
- stat/fstat: 查看文件信息
- lseek: 在文件中移动读写位置
- mprotect: 修改内存保护权限
- nanosleep/clock_nanosleep: 程序主动暂停等待
- getpid/gettid: 获取进程/线程 ID
- rt_sigaction: 设置信号处理方式
- ioctl: 对设备进行控制操作

## 模式识别指南
- 大量 read/write/open/close → 程序在做大量 I/O 操作（读写文件或打印输出）
- 大量 mmap/brk/munmap → 程序在频繁分配释放内存
- 出现 ENOENT 错误 → 程序试图打开不存在的文件
- 出现 EACCES/EPERM 错误 → 权限不足
- futex 占比较高 → 多线程程序，线程间有大量同步等待
- nanosleep 占比高 → 程序有大量主动等待
"""


# ── Route ───────────────────────────────────────────────────────────────────

@router.post("/analyze", response_model=EBPFAnalysisResponse)
async def analyze_ebpf(req: EBPFAnalysisRequest):
    """Analyze eBPF syscall trace data and return plain-language interpretation."""

    if req.total_calls == 0:
        return EBPFAnalysisResponse(
            plain_summary="没有采集到系统调用数据。可能程序运行时间太短或没有触发任何系统操作。",
            raw_error="no_trace_data",
        )

    # Build user prompt
    top_lines = []
    for sc in req.top_syscalls[:10]:
        top_lines.append(f"- {sc.name}: {sc.count} 次（占 {sc.percent}%）")

    error_lines = []
    for es in req.error_syscalls[:10]:
        error_lines.append(f"- {es.name} 出错: {es.error}（{es.count} 次）")

    user_prompt = f"""请分析以下 eBPF 系统调用追踪数据：

程序总共发起了 {req.total_calls} 次系统操作，使用了 {req.unique_syscalls} 种不同的操作类型。
其中 {req.error_count} 次操作出错。
程序运行时间约 {req.execution_time_ms} 毫秒。

最频繁的系统操作 Top 10：
{chr(10).join(top_lines)}

{"出错的系统操作：" if error_lines else "（本次运行没有出错的操作）"}
{chr(10).join(error_lines) if error_lines else ""}

{"学生代码片段（供参考）：" if req.code else ""}
{"```" + req.language if req.code else ""}
{req.code[:3000] if req.code else ""}
{"```" if req.code else ""}

请用大白话解释以上数据。"""

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
        return EBPFAnalysisResponse(**data)

    except json.JSONDecodeError as e:
        logger.warning(f"LLM returned invalid JSON for ebpf analysis: {e}")
        # Try to extract useful text from partial response
        fallback_text = content[:300].strip() if content and len(content) > 10 else ""
        return EBPFAnalysisResponse(
            plain_summary=fallback_text if fallback_text else "AI 分析遇到技术问题，请稍后重试。如果持续出现，可以尝试刷新页面后重新分析。",
            raw_error=f"json_parse_error: {str(e)[:200]}",
        )
    except Exception as e:
        logger.error(f"eBPF analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")
