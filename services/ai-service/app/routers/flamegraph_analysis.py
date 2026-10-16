"""Flame Graph AI Analysis Router — LLM-powered plain-language interpretation."""

import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.llm_client import get_llm_provider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/flamegraph", tags=["flamegraph-analysis"])


# ── Request / Response Models ──────────────────────────────────────────────

class HotFunction(BaseModel):
    name: str
    percent: float
    module: str = "user"


class FlameGraphAnalysisRequest(BaseModel):
    submission_id: str
    code: str = ""
    language: str = "c"
    hot_functions: list[HotFunction] = Field(default_factory=list)
    user_percent: float = 0
    kernel_percent: float = 0
    elapsed_sec: float = 0


class HotspotItem(BaseModel):
    function: str
    what_it_means: str
    optimization_tip: str


class Issue(BaseModel):
    severity: str  # "high" | "medium" | "low" | "info"
    title: str
    explanation: str
    suggestion: str


class FlameGraphAnalysisResponse(BaseModel):
    plain_summary: str
    top_hotspots: list[HotspotItem] = Field(default_factory=list)
    issues: list[Issue] = Field(default_factory=list)
    kernel_insight: str = ""
    raw_error: Optional[str] = None


# ── System Prompt ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """你是一个操作系统实验教学平台的 AI 性能分析助手。你的受众是完全零基础的计算机系学生和老师。
你的任务是解读 perf 火焰图采样数据，用通俗的大白话告诉用户：程序在忙什么、哪里有问题、怎么优化。

## 核心规则
1. 用通俗中文，绝对避免使用技术术语（如"调用栈""采样频率""内核态""用户态"等），如果必须提，用括号里加白话解释。
2. 直接说结论，不要卖关子，不要用提问式引导。
3. 面向完全没有操作系统知识的师生，假设他们不知道什么是"系统调用""CPU时间""内存分配"。
4. 每一条解释都要关联到"这对你的程序意味着什么"。

## 输出格式
必须返回严格的 JSON，不要包含任何 JSON 之外的内容：
{
  "plain_summary": "一段 2-3 句的大白话总结，告诉用户程序的 CPU 时间主要花在哪",
  "top_hotspots": [
    {
      "function": "函数名",
      "what_it_means": "这个函数是干什么的（大白话）",
      "optimization_tip": "如果这个函数占比太高，可以怎么优化（大白话）"
    }
  ],
  "issues": [
    {
      "severity": "high/medium/low/info",
      "title": "问题标题",
      "explanation": "大白话解释这个问题为什么是问题",
      "suggestion": "大白话建议怎么改进"
    }
  ],
  "kernel_insight": "如果内核态占比超过10%，解释为什么程序频繁调用系统功能；低于10%则返回空字符串"
}

## 常见模式识别指南
- 如果某个函数占比超过 50%，这是一个明显的性能瓶颈
- 如果看到 printf/puts/write 等输出函数占比高，说明程序在做大量 I/O 输出
- 如果看到 malloc/free/mmap 等内存函数占比高，说明程序在频繁分配释放内存
- 如果内核态占比超过 20%，说明程序频繁进行系统调用（如读写文件、网络通信等）
- 如果看到 sleep/nanosleep 占比高，说明程序大部分时间在等待
- 如果热点集中在少数几个用户函数，这是正常的计算密集型程序
"""


# ── Route ───────────────────────────────────────────────────────────────────

@router.post("/analyze", response_model=FlameGraphAnalysisResponse)
async def analyze_flamegraph(req: FlameGraphAnalysisRequest):
    """Analyze flame graph profiling data and return plain-language interpretation."""

    if not req.hot_functions:
        return FlameGraphAnalysisResponse(
            plain_summary="采样数据不足，无法生成分析。可能是程序运行时间太短，建议增加采样时长。",
            raw_error="no_hotspot_data",
        )

    # Build user prompt with structured data
    hotspot_lines = []
    for hf in req.hot_functions[:10]:
        hotspot_lines.append(f"- {hf.name}: 占 {hf.percent}% CPU 时间（{hf.module}）")

    user_prompt = f"""请分析以下火焰图采样数据：

程序代码语言：{req.language}
采样时长：{req.elapsed_sec} 秒
用户态占比：{req.user_percent}%
内核态占比：{req.kernel_percent}%

CPU 时间热点函数 Top 10：
{chr(10).join(hotspot_lines)}

{"学生代码片段（供参考）：" if req.code else ""}
{"```" + req.language if req.code else ""}
{req.code[:3000] if req.code else ""}
{"```" if req.code else ""}

请根据以上数据，用大白话告诉学生/老师：
1. 程序的 CPU 时间主要花在哪里
2. 有没有明显的性能问题
3. 如果有，怎么改进"""

    content = ""
    try:
        llm = get_llm_provider()
        resp = await llm.chat_completion(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.3,
            max_tokens=3072,
        )

        # Parse JSON from LLM response
        content = resp.content.strip()
        # Remove markdown code fences if present
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        data = json.loads(content)
        return FlameGraphAnalysisResponse(**data)

    except json.JSONDecodeError as e:
        logger.warning(f"LLM returned invalid JSON for flamegraph analysis: {e}")
        fallback_text = content[:300].strip() if content and len(content) > 10 else ""
        return FlameGraphAnalysisResponse(
            plain_summary=fallback_text if fallback_text else "AI 分析遇到技术问题，请稍后重试。如果持续出现，可以尝试刷新页面后重新分析。",
            raw_error=f"json_parse_error: {str(e)[:200]}",
        )
    except Exception as e:
        logger.error(f"Flamegraph analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")
