"""Teaching Assistant — 提问侧单 Agent 入口。

提问链路收敛后的唯一路径：
  Input guard → 确定性意图判断 → RAG 检索 → DiagnosisTutorAgent 单次调用 → Output guard（仅诊断）。

不再引入 LangGraph 图结构、意图分类 LLM、token 水位防火墙或 LLM-as-Judge 评估。
诊断（多 Agent）走 app/diagnosis/orchestrator，与本模块互不依赖。
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from app.agents.diagnosis_tutor import DiagnosisTutorAgent
from app.agents.rag_agent import RAGAgent
from app.agents.guardrails import get_input_guard, get_output_guard

logger = logging.getLogger(__name__)


@dataclass
class TeachingState:
    """单 Agent 提问流程的状态容器，字段对齐 harness_adapter 的读取约定。"""

    user_message: str = ""
    user_id: str = ""
    conversation_id: str = ""
    context: dict[str, Any] = field(default_factory=dict)

    intent: str = ""
    intent_confidence: float = 0.0

    rag_context: str = ""
    rag_sources: list[dict[str, Any]] = field(default_factory=list)
    diagnosis_result: dict[str, Any] | None = None
    error: str = ""

    input_guard_checks: list = field(default_factory=list)
    output_guard_checks: list = field(default_factory=list)
    eval_result: dict[str, Any] | None = None
    firewall_reports: dict[str, dict] = field(default_factory=dict)

    done: bool = False


# ============================================================================
# 确定性意图判断（替代 LLM 意图分类）
# ============================================================================

def _rule_intent(ctx: dict[str, Any]) -> str:
    """根据提交数据确定意图，不使用 LLM。"""
    has_code = bool(ctx.get("code"))
    has_detection = bool(
        ctx.get("compile_error")
        or ctx.get("runtime_error")
        or ctx.get("test_results")
        or ctx.get("strace_summary")
        or ctx.get("deadlock")
    )
    if has_code and has_detection:
        return "diagnosis"
    if has_code:
        return "code_review"
    return "knowledge_qa"


def _build_detection_context(ctx: dict[str, Any]) -> str:
    """把提交的检测数据整理成可读上下文。"""
    parts = []

    if ctx.get("compile_error"):
        parts.append(f"编译错误:\n```\n{str(ctx['compile_error'])[:1000]}\n```")
    if ctx.get("runtime_error"):
        parts.append(f"运行时错误:\n```\n{str(ctx['runtime_error'])[:1000]}\n```")

    test_results = ctx.get("test_results") or []
    if test_results:
        passed = sum(1 for t in test_results if t.get("passed"))
        failed = len(test_results) - passed
        lines = [f"测试结果: {len(test_results)} 个用例, 通过 {passed}, 失败 {failed}"]
        for t in test_results[:5]:
            status = "PASS" if t.get("passed") else "FAIL"
            name = t.get("name") or t.get("test_case_id") or "?"
            lines.append(f"  [{status}] {name}")
            if not t.get("passed") and t.get("expected_output"):
                lines.append(f"    期望: {str(t['expected_output'])[:200]}")
            if not t.get("passed") and t.get("actual_output"):
                lines.append(f"    实际: {str(t['actual_output'])[:200]}")
        parts.append("\n".join(lines))

    strace = ctx.get("strace_summary")
    if strace and isinstance(strace, dict):
        slines = ["系统调用分析 (strace):"]
        if strace.get("total_syscalls"):
            slines.append(f"  总调用: {strace['total_syscalls']}")
        if strace.get("top_syscalls"):
            tops = strace["top_syscalls"][:5]
            tops_str = ", ".join(f"{s.get('name','?')}({s.get('count',0)})" for s in tops)
            slines.append(f"  高频: {tops_str}")
        if strace.get("fd_balance"):
            fb = strace["fd_balance"]
            if fb.get("has_leak"):
                slines.append(f"  FD泄漏: open={fb.get('opens',0)}, close={fb.get('closes',0)}, leaked={fb.get('leaked',0)}")
        if strace.get("memory_balance"):
            mb = strace["memory_balance"]
            if mb.get("has_imbalance"):
                slines.append(f"  内存泄漏: alloc={mb.get('alloc_calls',0)}, free={mb.get('free_calls',0)}")
        if strace.get("patterns"):
            slines.append(f"  模式: {', '.join(p.get('pattern','?') for p in strace['patterns'][:3])}")
        parts.append("\n".join(slines))

    deadlock = ctx.get("deadlock")
    if deadlock and isinstance(deadlock, dict) and deadlock.get("detected"):
        parts.append(f"死锁检测: 检测到死锁! {deadlock.get('details','')[:500]}")

    last_diag = ctx.get("last_diagnosis")
    if last_diag and isinstance(last_diag, dict):
        parts.append(f"上轮诊断: {last_diag.get('error_type','?')} | {last_diag.get('root_cause','')[:300]}")

    return "\n\n".join(parts) if parts else ""


def _build_student_context(ctx: dict[str, Any]) -> str:
    """构建学生画像与记忆上下文。"""
    parts = []
    profile = ctx.get("student_profile")
    if profile and isinstance(profile, dict):
        if profile.get("weak_concepts"):
            parts.append(f"弱项: {', '.join(profile['weak_concepts'][:5])}")
        if profile.get("strong_concepts"):
            parts.append(f"强项: {', '.join(profile['strong_concepts'][:5])}")
        if profile.get("preferred_hint_level"):
            parts.append(f"偏好提示级别: {profile['preferred_hint_level']}")
        if profile.get("learning_pace"):
            parts.append(f"学习节奏: {profile['learning_pace']}")

    summary = ctx.get("conversation_summary")
    if summary:
        parts.append(f"对话摘要: {summary[:500]}")

    return "\n".join(parts) if parts else ""


def _resolve_theme(ctx: dict[str, Any]) -> str:
    """从实验分类映射到视觉主题。"""
    cat = ctx.get("experiment_category", "")
    if not cat:
        return "ocean"
    try:
        from app.agents.skills.code_polish import get_theme_for_category
        return get_theme_for_category(cat).value
    except Exception:
        return "ocean"


async def _run_single_agent(state: TeachingState) -> None:
    """按意图构造参数，调用唯一的 DiagnosisTutorAgent。"""
    dt = DiagnosisTutorAgent()
    ctx = state.context
    intent = state.intent
    theme = _resolve_theme(ctx)

    if intent == "diagnosis":
        kwargs = dict(
            code=ctx.get("code", ""),
            experiment_title=ctx.get("experiment_title", ""),
            experiment_description=ctx.get("experiment_description", ""),
            language=ctx.get("language", "c"),
            compile_error=ctx.get("compile_error"),
            runtime_error=ctx.get("runtime_error"),
            test_results=ctx.get("test_results"),
            strace_summary=ctx.get("strace_summary"),
            experiment_category=ctx.get("experiment_category", ""),
            experiment_instructions=ctx.get("experiment_instructions", ""),
            rag_context=state.rag_context,
            intent="diagnosis",
            detection_data_context=_build_detection_context(ctx),
            student_profile_context=_build_student_context(ctx),
            conversation_summary=ctx.get("conversation_summary", ""),
            theme=theme,
        )
    elif intent == "code_review":
        kwargs = dict(
            code=ctx.get("code", ""),
            experiment_title=ctx.get("experiment_title", "Code Review"),
            experiment_description=state.user_message,
            language=ctx.get("language", "c"),
            experiment_category="code_review",
            experiment_instructions=ctx.get("experiment_instructions", ""),
            rag_context=state.rag_context,
            intent="code_review",
            theme=theme,
        )
    else:  # knowledge_qa
        kwargs = dict(
            code="",
            experiment_title=ctx.get("experiment_title", "General OS Question"),
            experiment_description=state.user_message,
            language="",
            experiment_category="knowledge_qa",
            experiment_instructions="",
            rag_context=state.rag_context,
            intent="knowledge_qa",
            theme=theme,
        )

    state.diagnosis_result = await dt.analyze(**kwargs)

    # 仅诊断意图做输出守卫（防答案泄露），避免非诊断场景的额外 LLM 调用
    if intent == "diagnosis":
        output_guard = get_output_guard()
        result = state.diagnosis_result or {}
        response_text = (
            result.get("reply", "")
            or result.get("raw", "")
            or json.dumps(result, ensure_ascii=False)
        )
        out_checks = await output_guard.check(response_text)
        state.output_guard_checks = [
            {"guard_name": c.guard_name, "tier": c.tier, "result": c.result.value, "reason": c.reason}
            for c in out_checks
        ]
        if not output_guard.is_allowed():
            logger.warning("Output guard blocked diagnosis response")
            fallback = "让我们一步一步来分析。你能先告诉我：你观察到程序的哪个行为不符合预期？"
            if isinstance(state.diagnosis_result, dict):
                state.diagnosis_result["reply"] = fallback
                state.diagnosis_result["metadata"] = state.diagnosis_result.get("metadata", {})


async def run_agent_pipeline(
    user_message: str,
    context: dict[str, Any],
) -> TeachingState:
    """单 Agent 提问主流程，返回兼容 harness_adapter 的状态对象。"""
    state = TeachingState(
        user_message=user_message,
        user_id=context.get("user_id", ""),
        conversation_id=context.get("conversation_id", ""),
        context=context,
    )

    # 1. 输入守卫
    input_guard = get_input_guard()
    checks = await input_guard.check(user_message)
    state.input_guard_checks = [
        {"guard_name": c.guard_name, "tier": c.tier, "result": c.result.value, "reason": c.reason}
        for c in checks
    ]
    if not input_guard.is_allowed():
        state.error = input_guard.blocked_reason()
        state.intent = "general_chat"
        state.intent_confidence = 1.0
        state.diagnosis_result = {"reply": "抱歉，你的消息包含不允许的内容，请调整后重试。", "hybrid": False}
        state.done = True
        return state

    # 2. 确定性意图判断
    state.intent = _rule_intent(context)
    state.intent_confidence = 1.0

    # 3. RAG 检索
    if context.get("use_rag", True):
        course_id = context.get("course_id", "")
        if course_id:
            try:
                query = user_message
                if state.intent == "diagnosis":
                    query = (
                        f"{context.get('experiment_title','')} "
                        f"{context.get('experiment_category','')} {user_message[:200]}"
                    )
                agent = RAGAgent()
                state.rag_sources = await agent.retrieve(course_id, query)
                state.rag_context = agent.to_context(state.rag_sources)
            except Exception as e:
                logger.warning("RAG retrieval failed: %s", e)

    # 4. 单 Agent 调用
    try:
        await _run_single_agent(state)
    except Exception as e:
        logger.error("Teaching assistant failed: %s", e)
        state.error = str(e)
        state.diagnosis_result = {
            "diagnosis": {"error_type": "error", "root_cause": str(e)},
            "tutoring": {"l1_direction": "Analysis temporarily unavailable, please try again"},
        }

    state.done = True
    return state