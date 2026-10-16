"""Phase 3-6 单元测试: OTel tracing, EvaluationGuard, SafetyFilter, ErrorKB, Progress, Stats."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Phase 3: Tracing
# ---------------------------------------------------------------------------
class TestTracing:
    def test_simple_span(self):
        from app.services.tracing import SimpleSpan
        span = SimpleSpan(name="test")
        span.set_attribute("key", "val")
        assert span.attributes["key"] == "val"
        span.end()
        assert span.duration_ms >= 0

    def test_tracing_service_starts_span(self):
        from app.services.tracing import get_tracing_service, SimpleSpan
        svc = get_tracing_service()
        span = svc.start_span("test_span")
        assert span.name == "test_span"
        svc.end_span(span, result="ok")
        assert span.end_time is not None

    def test_gen_ai_agent_span(self):
        from app.services.tracing import get_tracing_service
        svc = get_tracing_service()
        span = svc.gen_ai_agent_span("code_analyzer")
        assert "gen_ai.agent" in span.name
        assert "code_analyzer" in span.name

    @pytest.mark.asyncio
    async def test_trace_agent_context_manager(self):
        from app.services.tracing import trace_agent
        async with trace_agent("test_agent") as span:
            span.set_attribute("test", "value")
        assert span.end_time is not None


# ---------------------------------------------------------------------------
# Phase 5: EvaluationGuard
# ---------------------------------------------------------------------------
class TestEvaluationGuard:
    @pytest.fixture
    def mock_report(self):
        from app.diagnosis.agents.report_generator import DiagnosisReport
        return DiagnosisReport(
            submission_id="sub1", student_id="stu1", experiment_id="exp1",
            experiment_category="process",
            confidence=0.85, agent_agreement=0.9,
        )

    @pytest.fixture
    def mock_agent_results(self):
        from app.diagnosis.agents.base import AgentResult, AgentStatus
        return [
            AgentResult.success("a1", findings=[{"type": "code_quality"}], confidence=0.8),
            AgentResult.success("a2", findings=[{"type": "runtime"}], confidence=0.7),
        ]

    @pytest.mark.asyncio
    async def test_guard_passes_high_confidence(self, mock_report, mock_agent_results):
        from app.diagnosis.evaluation_guard import EvaluationGuard
        guard = EvaluationGuard()
        result = await guard.check(mock_report, mock_agent_results)
        assert result.confidence_ok is True
        assert result.passed is True

    @pytest.mark.asyncio
    async def test_guard_fails_low_confidence(self, mock_report, mock_agent_results):
        from app.diagnosis.evaluation_guard import EvaluationGuard
        mock_report.confidence = 0.3
        guard = EvaluationGuard()
        result = await guard.check(mock_report, mock_agent_results)
        assert result.confidence_ok is False
        assert result.passed is False
        assert result.review_required is True
        assert result.degraded is True


# ---------------------------------------------------------------------------
# Phase 5: SafetyFilter
# ---------------------------------------------------------------------------
class TestSafetyFilter:
    def test_clean_text_passes(self):
        from app.diagnosis.evaluation_guard import SafetyFilter
        sf = SafetyFilter()
        from app.diagnosis.agents.report_generator import DiagnosisReport
        report = DiagnosisReport(summary="代码有一些问题需要改进", suggested_fixes=[])
        result = sf.check_report(report)
        assert result["safe"] is True

    def test_solution_code_detected(self):
        from app.diagnosis.evaluation_guard import SafetyFilter
        from app.diagnosis.agents.report_generator import DiagnosisReport
        sf = SafetyFilter()
        report = DiagnosisReport(
            summary="完整解答如下: int main(int argc, char **argv) {\n    fork();\n    wait(NULL);\n    close(pipe_fd);\n    execvp(\"ls\", argv);\n    return 0;\n}",
            suggested_fixes=[],
            agent_results=[],
        )
        result = sf.check_report(report)
        assert result["safe"] is False
        assert len(result["warnings"]) > 0

    def test_truncate_code(self):
        from app.diagnosis.evaluation_guard import SafetyFilter
        sf = SafetyFilter()
        code = "line1\nline2\nline3\nline4\nline5"
        truncated = sf.truncate_code(code, max_lines=2)
        assert "已截断" in truncated
        assert "line3" not in truncated


# ---------------------------------------------------------------------------
# Phase 5: FallbackChain
# ---------------------------------------------------------------------------
class TestFallbackChain:
    @pytest.mark.asyncio
    async def test_rule_engine_fallback(self):
        from app.diagnosis.evaluation_guard import FallbackChain
        from app.diagnosis.context_package import ContextPackage
        ctx = ContextPackage(
            submission_id="s1", student_id="u1", experiment_id="e1",
            experiment_category="process",
            compile_error="syntax error",
            score_breakdown={"passed_cases": 2, "total_cases": 5, "status": "compile_error"},
        )
        chain = FallbackChain()
        result, level = await chain.get_diagnosis(ctx, llm_diagnosis=None)
        assert level == FallbackChain.LEVEL_RULE or level == FallbackChain.LEVEL_TEMPLATE


# ---------------------------------------------------------------------------
# Phase 6: ErrorPatternKB
# ---------------------------------------------------------------------------
class TestErrorKB:
    def test_make_pattern_name(self):
        from app.diagnosis.error_kb import ErrorPatternKB
        kb = ErrorPatternKB()
        name = kb._make_pattern_name({"type": "fd_leak", "title": "fd 泄漏"}, "code_analyzer")
        assert "fd_leak" in name
        assert "fd 泄漏" in name


# ---------------------------------------------------------------------------
# Phase 6: StudentProgressTracker (mock DB)
# ---------------------------------------------------------------------------
class TestStudentProgress:
    @pytest.mark.asyncio
    async def test_progress_no_data(self):
        from app.diagnosis.student_progress import StudentProgressTracker
        tracker = StudentProgressTracker()
        with patch("app.db.connection.get_pool") as mock_pool:
            mock_pool.return_value.fetchrow = AsyncMock(return_value=None)
            mock_pool.return_value.fetch = AsyncMock(return_value=[])
            result = await tracker.get_progress_history("nonexistent")
        assert result["submissions"] == []
        assert result["trend"] == "no_data"


# ---------------------------------------------------------------------------
# Phase 6: ClassStatsService (mock DB)
# ---------------------------------------------------------------------------
class TestClassStats:
    @pytest.mark.asyncio
    async def test_class_stats_no_data(self):
        from app.diagnosis.class_stats import ClassStatsService
        svc = ClassStatsService()
        with patch("app.db.connection.get_pool") as mock_pool:
            mock_pool.return_value.fetchrow = AsyncMock(return_value={"count": 0})
            mock_pool.return_value.fetch = AsyncMock(return_value=[])
            result = await svc.get_class_stats("nonexistent")
        assert result["submission_count"] == 0


# ---------------------------------------------------------------------------
# Phase 4: Data enricher (已删除 — data_enricher 不再存在)
# ---------------------------------------------------------------------------
