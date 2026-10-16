"""DiagnosisOrchestrator — 确定性 Planner → 并行 Generators → ReportGenerator.

红线: 诊断不产出分数。流程:
  Phase 1: 确定性 Planner 分析评测结果, 决定激活哪些 Agent (不用 LLM)
  Phase 2: 诊断 Agent 通过 asyncio.gather 并行执行
  Phase 3: ReportGenerator 聚合教学建议 (无 Evaluator, 无六维评分)
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Awaitable

from app.diagnosis.agents.base import AgentResult, AgentStatus
from app.diagnosis.agents.code_analyzer import CodeAnalyzerAgent
from app.diagnosis.agents.concept_rubric import ConceptRubricAgent
from app.diagnosis.agents.report_generator import DiagnosisReport, ReportGeneratorAgent
from app.diagnosis.agents.syscall_analyzer import SyscallAnalyzerAgent
from app.diagnosis.agents.test_evaluator import TestEvaluatorAgent
from app.diagnosis.agents.resource_analyzer import ResourceAnalyzerAgent
from app.diagnosis.context_package import ContextPackage
from app.diagnosis.deterministic import extract_observations
from app.services.tracing import get_tracing_service
from app.diagnosis.evaluation_guard import EvaluationGuard
from app.diagnosis.error_kb import get_error_kb

logger = logging.getLogger(__name__)

# 进度回调类型
ProgressCb = Callable[[str, str, int, str], Awaitable[None]]


class DiagnosisOrchestrator:
    """多 Agent 诊断编排器 (确定性 Planner, 无评分)."""

    def __init__(self) -> None:
        self.code_analyzer = CodeAnalyzerAgent()
        self.test_evaluator = TestEvaluatorAgent()
        self.syscall_analyzer = SyscallAnalyzerAgent()
        self.concept_rubric = ConceptRubricAgent()
        self.resource_analyzer = ResourceAnalyzerAgent()
        self.report_generator = ReportGeneratorAgent()
        self.guard = EvaluationGuard()
        self.error_kb = get_error_kb()
        self.enable_phase5 = True
        self.enable_phase6 = True

    async def run(
        self,
        ctx: ContextPackage,
        progress_cb: ProgressCb | None = None,
    ) -> DiagnosisReport:
        """完整诊断流程: Planner → 并行 Generators → Report."""
        report = DiagnosisReport(
            submission_id=ctx.submission_id,
            student_id=ctx.student_id,
            experiment_id=ctx.experiment_id,
            experiment_category=ctx.experiment_category,
            status="in_progress",
        )

        # Root span for the entire diagnosis
        tracing = get_tracing_service()
        root_span = tracing.start_span(
            "gen_ai.agent.diagnosis_orchestrator",
            **{"traceos.submission_id": ctx.submission_id,
               "traceos.experiment_id": ctx.experiment_id},
        )
        report.trace_id = root_span.trace_id

        # --- Phase 1: 确定性 Planner + 观测事实提取 ---
        active_agents = self._plan(ctx)
        observations = extract_observations(ctx)
        if progress_cb:
            await progress_cb("planning", "Planner", 10, f"激活 {len(active_agents)} 个诊断 Agent")

        # --- Phase 2: 并行 Generators ---
        gen_tasks = []
        if "code_analyzer" in active_agents:
            gen_tasks.append(self._run_agent(self.code_analyzer, ctx, progress_cb, root_span))
        if "test_evaluator" in active_agents:
            gen_tasks.append(self._run_agent(self.test_evaluator, ctx, progress_cb, root_span))
        if "syscall_analyzer" in active_agents:
            gen_tasks.append(self._run_agent(self.syscall_analyzer, ctx, progress_cb, root_span))
        if "concept_rubric" in active_agents:
            gen_tasks.append(self._run_agent(self.concept_rubric, ctx, progress_cb, root_span))
        if "resource_analyzer" in active_agents:
            gen_tasks.append(self._run_agent(self.resource_analyzer, ctx, progress_cb, root_span))

        if progress_cb:
            await progress_cb("diagnosis", "Generators", 20, f"并行执行 {len(gen_tasks)} 个诊断 Agent")

        agent_results: list[AgentResult] = await asyncio.gather(*gen_tasks, return_exceptions=False)

        if progress_cb:
            completed = sum(1 for r in agent_results if r.status == AgentStatus.COMPLETED.value)
            await progress_cb("diagnosis", "Generators", 60, f"诊断完成: {completed}/{len(agent_results)} Agent")

        # --- Phase 3: ReportGenerator (无 Evaluator) ---
        if progress_cb:
            await progress_cb("reporting", "ReportGenerator", 85, "生成教学诊断报告...")

        report = await self.report_generator.generate(agent_results, observations, ctx)

        if progress_cb:
            await progress_cb("reporting", "ReportGenerator", 100,
                                f"诊断完成: 合格判定 {'达标' if report.is_qualified else '未达标'}")

        # Phase 5: 治理校验
        if self.enable_phase5:
            try:
                guard_result = await self.guard.check(report, agent_results)
                root_span.set_attribute("traceos.guard.passed", guard_result.passed)
                if guard_result.degraded:
                    report.degraded = True
                    report.degradation_reason = guard_result.degradation_reason
                if guard_result.review_required:
                    report.requires_review = True
                    if not report.review_reason:
                        report.review_reason = guard_result.review_reason
            except Exception as e:
                logger.warning("EvaluationGuard check failed: %s", e)

        # Phase 6: 错误模式自动入库
        if self.enable_phase6 and not report.degraded:
            try:
                asyncio.create_task(self.error_kb.extract_and_ingest(report, agent_results))
            except Exception as e:
                logger.debug("Error KB ingest skipped: %s", e)

        tracing.end_span(root_span,
            **{"traceos.is_qualified": report.is_qualified,
               "traceos.confidence": report.confidence})
        return report

    def _plan(self, ctx: ContextPackage) -> list[str]:
        """确定性 Planner: 分析评测结果决定激活哪些 Agent (不用 LLM)."""
        active = ["code_analyzer", "concept_rubric"]

        # 有测试数据或编译错误 → TestEvaluator
        if ctx.test_results or ctx.compile_error:
            active.append("test_evaluator")

        # 有 strace 数据 → SyscallAnalyzer
        if ctx.strace_summary:
            active.append("syscall_analyzer")

        # 有内核观测事实 → ResourceAnalyzer
        if ctx.ebpf_metrics:
            active.append("resource_analyzer")

        # 编译失败场景: 缩减 Agent (仅需 test_evaluator + code_analyzer)
        if ctx.compile_error and len(ctx.compile_error) > 10:
            active = ["code_analyzer", "test_evaluator"]

        return active

    async def _run_agent(
        self,
        agent: "Any",
        ctx: ContextPackage,
        progress_cb: ProgressCb | None = None,
        root_span: "Any" = None,
    ) -> AgentResult:
        """运行单个 Agent, 传入其专用 context slice."""
        if progress_cb:
            await progress_cb("diagnosis", agent.name, 30, f"{agent.name} 启动...")

        ctx_slice = ctx.slice_for(agent.name)
        if root_span is not None:
            ctx_slice["_trace_span"] = root_span
        result = await agent.analyze(ctx_slice)

        if progress_cb:
            status_label = {
                AgentStatus.COMPLETED.value: "完成",
                AgentStatus.FAILED.value: "失败",
                AgentStatus.SKIPPED.value: "跳过",
            }.get(result.status, result.status)
            await progress_cb("diagnosis", agent.name, 50,
                                f"{agent.name} {status_label}")

        return result