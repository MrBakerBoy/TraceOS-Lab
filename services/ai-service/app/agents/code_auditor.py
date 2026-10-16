"""Code auditing agent — orchestrates multi-step analysis."""

import json
import logging
from typing import TypedDict, Optional

logger = logging.getLogger(__name__)


class AuditState(TypedDict, total=False):
    code: str
    annotations: list
    issues: list
    experiment_type: str
    # Intermediate
    pattern_matches: list
    resource_analysis: dict
    llm_analysis: str
    # Final
    result: dict
    error: Optional[str]


class CodeAuditorAgent:
    """Multi-step code audit agent.

    Pipeline:
      1. PatternMatcher → rule-based pattern detection
      2. ResourceAnalyzer → resource leak analysis
      3. LLMAuditor → LLM deep analysis
      4. GradingHelper → convert analysis to teaching hints
    """

    def __init__(self):
        # LLM provider imported at call-time (same pattern as diagnosis_service)
        pass

    async def audit(self, code: str, annotations: list, issues: list, experiment_type: str) -> dict:
        """Run the full audit pipeline."""
        state: AuditState = {
            "code": code,
            "annotations": annotations,
            "issues": issues,
            "experiment_type": experiment_type,
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }

        return await self._run_simple(state)

    async def _run_simple(self, state: AuditState) -> dict:
        """Simple sequential pipeline."""
        state = self._pattern_match(state)
        state = self._resource_analysis(state)
        state = await self._llm_deep_audit(state)
        state = self._grading_helper(state)
        return state.get("result", {})

    def _pattern_match(self, state: AuditState) -> AuditState:
        """Match known error patterns (rule-based, no LLM)."""
        patterns = []

        lock_lines = []
        unlock_lines = []
        for a in state["annotations"]:
            if a.get("tag") == "mutex_lock":
                lock_lines.append(a["line"])
            elif a.get("tag") == "mutex_unlock":
                unlock_lines.append(a["line"])

        if len(unlock_lines) > len(lock_lines):
            patterns.append({
                "type": "extra_unlock",
                "severity": "error",
                "message": "unlock次数多于lock，可能存在重复unlock",
            })

        if len(lock_lines) > len(unlock_lines):
            patterns.append({
                "type": "missing_unlock",
                "severity": "error",
                "message": "lock次数多于unlock，可能存在未释放的锁",
            })

        has_early_return = any(a.get("tag") == "early_return" for a in state["annotations"])
        if has_early_return:
            patterns.append({
                "type": "early_return",
                "severity": "warning",
                "message": "存在提前return可能跳过资源清理",
            })

        state["pattern_matches"] = patterns
        return state

    def _resource_analysis(self, state: AuditState) -> AuditState:
        """Analyze resource usage patterns."""
        analysis = {
            "mutex_count": sum(1 for a in state["annotations"] if "mutex" in str(a.get("tag", ""))),
            "malloc_count": sum(1 for a in state["annotations"] if "mem_malloc" in str(a.get("tag", ""))),
            "free_count": sum(1 for a in state["annotations"] if "mem_free" in str(a.get("tag", ""))),
            "fd_open_count": sum(1 for a in state["annotations"] if a.get("tag") == "fd_op" and a.get("detail") == "open"),
            "fd_close_count": sum(1 for a in state["annotations"] if a.get("tag") == "fd_op" and a.get("detail") == "close"),
        }

        warnings = []
        if analysis["malloc_count"] > analysis["free_count"]:
            warnings.append(f"malloc({analysis['malloc_count']}) > free({analysis['free_count']}) — 可能内存泄漏")
        if analysis["fd_open_count"] > analysis["fd_close_count"]:
            warnings.append(f"open({analysis['fd_open_count']}) > close({analysis['fd_close_count']}) — 可能fd泄漏")

        analysis["warnings"] = warnings
        state["resource_analysis"] = analysis
        return state

    async def _llm_deep_audit(self, state: AuditState) -> AuditState:
        """LLM-powered deep analysis."""
        # Late import to avoid circular dependency at module load time
        from app.services.llm_client import llm_provider

        if not llm_provider:
            state["llm_analysis"] = "LLM不可用，使用规则引擎分析"
            return state

        try:
            system_prompt, user_prompt = self._build_llm_prompt(state)
            llm_resp = await llm_provider.chat_completion(system_prompt, user_prompt)
            state["llm_analysis"] = llm_resp.content
        except Exception as e:
            state["llm_analysis"] = f"LLM分析失败: {e}"
            state["error"] = str(e)

        return state

    def _build_llm_prompt(self, state: AuditState) -> tuple[str, str]:
        system_prompt = "你是操作系统实验教学专家，正在审查学生的C语言代码。请给出JSON格式的分析结果。"
        user_prompt = f"""审查以下{state['experiment_type']}实验代码：

模式匹配结果: {json.dumps(state['pattern_matches'], ensure_ascii=False)}
资源分析: {json.dumps(state['resource_analysis'], ensure_ascii=False)}

代码:
```c
{state['code'][:2000]}
```

请给出JSON格式的分析: {{"issues": [], "overall": ""}}"""
        return system_prompt, user_prompt

    def _grading_helper(self, state: AuditState) -> AuditState:
        """Convert analysis to progressive teaching hints."""
        hints = {
            "L1": "",
            "L2": "",
            "L3": "",
        }

        if state["pattern_matches"]:
            hints["L1"] = "你的代码中存在一些可以改进的地方，仔细检查一下资源管理相关代码"
        else:
            hints["L1"] = "代码结构看起来不错，运行测试看看结果如何？"

        for p in state["pattern_matches"]:
            if p["type"] == "missing_unlock":
                hints["L2"] = "检查一下你的mutex操作：是否每个lock都有对应的unlock？"
                hints["L3"] = "在提前return的代码路径中，锁可能没有被释放。考虑使用统一的cleanup出口"
                break
            elif p["type"] == "early_return":
                hints["L2"] = "有些函数在return之前可能跳过了必要的清理步骤"
                hints["L3"] = "把所有资源释放操作放在函数末尾，确保所有路径都能到达"
                break

        if not hints["L2"]:
            ra = state.get("resource_analysis", {})
            if ra.get("warnings"):
                hints["L2"] = ra["warnings"][0]
                hints["L3"] = "使用valgrind等工具检查内存和资源使用情况"

        state["result"] = {
            "pattern_matches": state["pattern_matches"],
            "resource_analysis": state["resource_analysis"],
            "teaching_hints": hints,
            "llm_analysis": state.get("llm_analysis", ""),
            "error": state.get("error"),
        }
        return state


code_auditor_agent = CodeAuditorAgent()
