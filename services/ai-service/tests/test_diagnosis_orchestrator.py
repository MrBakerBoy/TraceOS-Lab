"""多 Agent 诊断 Harness 单元测试 — mock LLM, 验证完整流程 (无评分)."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture
def mock_llm_response():
    """统一的 mock LLM 响应 (findings + confidence, 无分数)."""
    resp = MagicMock()
    resp.content = json.dumps({
        "findings": [{"type": "error_handling", "severity": "warning",
                       "description": "fork 返回值未检查", "location": "line 10"}],
        "confidence": 0.8,
    }, ensure_ascii=False)
    resp.total_tokens = 500
    resp.model = "mock-model"
    return resp


@pytest.fixture
def context_package():
    """构造含 strace + test_results + ebpf_metrics 的 ContextPackage."""
    from app.diagnosis.context_package import ContextPackage
    return ContextPackage(
        submission_id="sub-001",
        experiment_id="exp-001",
        student_id="stu-001",
        experiment_category="process",
        experiment_meta={
            "title": "进程创建",
            "description": "fork()练习",
            "category": "process",
        },
        code="#include <unistd.h>\nint main(){ fork(); return 0; }",
        language="c",
        compile_error="",
        runtime_error="",
        test_results=[
            {"name": "test1", "passed": True},
            {"name": "test2", "passed": False},
        ],
        strace_summary="总计 10 次系统调用, 1 次出错\n  fork() → 0\n",
        patterns=[{"pattern": "fork_no_wait", "severity": "warning"}],
        fd_balance={"opens": 2, "closes": 1},
        memory_balance={"alloc_calls": 1, "free_calls": 1},
        process_balance={"fork_calls": 1, "wait_calls": 0},
        score_breakdown={
            "passed_cases": 1,
            "total_cases": 2,
            "status": "runtime_error",
            "execution_time": 100,
            "is_qualified": False,
            "core_score": 50,
            "edge_score": 0,
        },
        ebpf_metrics={
            "resource": {
                "fd_leak": 1,
                "memory_imbalance": 0,
                "zombie": 1,
                "deadlock": False,
            },
            "syscall": {"stats": {}, "errors": []},
            "process_thread": {"thread_count": 1},
        },
    )


class TestDeterministic:
    """确定性观测提取器测试 (非评分)."""

    def test_detect_fd_leak(self):
        from app.diagnosis.deterministic import detect_fd_leak
        leak, _ = detect_fd_leak({"opens": 3, "closes": 3})
        assert leak == 0
        leak, _ = detect_fd_leak({"opens": 5, "closes": 2})
        assert leak == 3
        # ebpf_metrics 风格
        leak, _ = detect_fd_leak({"fd_leak": 2})
        assert leak == 2

    def test_detect_memory_imbalance(self):
        from app.diagnosis.deterministic import detect_memory_imbalance
        diff, _ = detect_memory_imbalance({"alloc_calls": 2, "free_calls": 2})
        assert diff == 0
        diff, _ = detect_memory_imbalance({"memory_imbalance": 4})
        assert diff == 4

    def test_detect_process_zombie(self):
        from app.diagnosis.deterministic import detect_process_zombie
        diff, _ = detect_process_zombie({"fork_calls": 2, "wait_calls": 1})
        assert diff == 1
        diff, _ = detect_process_zombie({"zombie": 3})
        assert diff == 3

    def test_extract_observations(self, context_package):
        from app.diagnosis.deterministic import extract_observations
        obs = extract_observations(context_package)
        assert obs.passed_cases == 1
        assert obs.total_cases == 2
        assert obs.fd_leak == 1
        assert obs.fork_wait_diff == 1
        assert obs.is_qualified is False
        assert obs.core_score == 50

    def test_derive_severity(self):
        from app.diagnosis.deterministic import derive_severity, Observations
        assert derive_severity(True) == "low"
        assert derive_severity(False, Observations(fd_leak=1)) == "high"
        assert derive_severity(False, Observations()) == "medium"

    def test_map_concepts(self):
        from app.diagnosis.deterministic import map_concepts
        concepts, radar = map_concepts("process", True)
        assert len(concepts) >= 1
        assert radar[concepts[0]] == 2
        _, radar = map_concepts("process", False)
        assert radar[concepts[0]] == 1


class TestContextMenu:
    """Context Firewall 测试."""

    def test_slice_for_code_analyzer_no_strace(self, context_package):
        ctx = context_package
        slice_data = ctx.slice_for("code_analyzer")
        assert "code" in slice_data
        assert "experiment_meta" in slice_data
        assert "compile_error" in slice_data
        # code_analyzer 不应拿到 strace_summary
        assert "strace_summary" not in slice_data
        assert "test_results" not in slice_data

    def test_slice_for_syscall_analyzer_has_strace(self, context_package):
        ctx = context_package
        slice_data = ctx.slice_for("syscall_analyzer")
        assert "strace_summary" in slice_data
        assert "fd_balance" in slice_data
        assert "code" in slice_data
        # syscall_analyzer 不应拿到 test_results
        assert "test_results" not in slice_data

    def test_slice_for_resource_analyzer_has_ebpf(self, context_package):
        ctx = context_package
        slice_data = ctx.slice_for("resource_analyzer")
        assert "ebpf_metrics" in slice_data
        assert "code" in slice_data

    def test_token_budget_truncation(self):
        from app.diagnosis.context_package import ContextPackage
        ctx = ContextPackage(
            code="x" * 300000,  # ~75000 tokens, 远超 40% 预算
        )
        slice_data = ctx.slice_for("code_analyzer")
        # 应触发截断
        assert len(slice_data.get("code", "")) < 300000


class TestAgentBase:
    """Agent 基类功能测试."""

    def test_agent_result_success_factory(self):
        from app.diagnosis.agents.base import AgentResult, AgentStatus
        r = AgentResult.success("test", [{"x": 1}], [{"source": "rule"}], confidence=0.9)
        assert r.status == AgentStatus.COMPLETED.value
        assert r.confidence == 0.9
        assert r.evidence == [{"source": "rule"}]

    def test_agent_result_failed_factory(self):
        from app.diagnosis.agents.base import AgentResult, AgentStatus
        r = AgentResult.failed("test", "some error")
        assert r.status == AgentStatus.FAILED.value
        assert r.error == "some error"
        assert r.confidence == 0.0

    def test_agent_result_skipped_factory(self):
        from app.diagnosis.agents.base import AgentResult, AgentStatus
        r = AgentResult.skipped("test", "no data")
        assert r.status == AgentStatus.SKIPPED.value


class TestOrchestrator:
    """Orchestrator 完整流程测试 (mock LLM, 无评分)."""

    @pytest.mark.asyncio
    async def test_orchestrator_full_run(self, context_package, mock_llm_response):
        """验证完整多 Agent 诊断流程 (不产出分数)."""
        from app.diagnosis.orchestrator import DiagnosisOrchestrator
        from app.diagnosis.agents.base import AgentStatus

        mock_provider = AsyncMock()

        async def mock_chat(system_prompt, user_prompt, **kwargs):
            return mock_llm_response

        with patch("app.services.llm_client.get_llm_provider", return_value=mock_provider):
            mock_provider.chat_completion = mock_chat

            orch = DiagnosisOrchestrator()
            report = await orch.run(context_package)

        assert report.status == "completed"
        assert report.is_qualified is False
        assert report.core_score == 50
        # 观测事实已提取
        assert report.observations["fd_leak"] == 1
        assert report.observations["fork_wait_diff"] == 1
        # 多 Agent 已执行
        assert len(report.agent_results) >= 2
        completed = [
            ar for ar in report.agent_results
            if ar.status == AgentStatus.COMPLETED.value
        ]
        assert len(completed) >= 1
        # 置信度已聚合 (非 0)
        assert report.confidence > 0
        # 无评分字段
        assert not hasattr(report, "total_score")
        assert not hasattr(report, "scores")
        assert not hasattr(report, "radar_data")


class TestFallback:
    """降级策略测试."""

    @pytest.mark.asyncio
    async def test_fallback_on_exception(self, context_package):
        """Orchestrator 异常时降级到 legacy."""
        from app.diagnosis.fallback import run_diagnosis_with_fallback

        legacy_called = [False]

        async def mock_legacy(ctx):
            legacy_called[0] = True
            r = MagicMock()
            r.root_cause = "legacy diagnosis"
            r.confidence_score = 0.7
            r.related_concepts = []
            r.suggested_fixes = []
            r.feedback = MagicMock(level_1="L1", level_2="L2", level_3="L3")
            return r

        with patch("app.diagnosis.fallback.get_orchestrator") as mock_get:
            mock_orch = MagicMock()

            async def _fail(ctx, cb):
                raise RuntimeError("simulated failure")

            mock_orch.run = _fail
            mock_get.return_value = mock_orch

            report = await run_diagnosis_with_fallback(
                context_package, progress_cb=None, legacy_callback=mock_legacy,
            )

        assert report.degraded is True
        assert "simulated failure" in report.degradation_reason
        assert legacy_called[0] is True