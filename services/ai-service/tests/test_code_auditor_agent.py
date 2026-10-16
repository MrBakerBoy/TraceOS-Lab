"""Tests for code_auditor agent module."""

import pytest
from unittest.mock import AsyncMock

from app.agents.code_auditor import CodeAuditorAgent, AuditState


def make_annotation(line: int, tag: str, detail: str = "") -> dict:
    return {"line": line, "tag": tag, "detail": detail}


class TestPatternMatch:
    """_pattern_match: mutex lock>unlock→missing_unlock; unlock>lock→extra_unlock"""

    def test_lock_more_than_unlock_missing_unlock(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [
                make_annotation(1, "mutex_lock"),
                make_annotation(3, "mutex_lock"),
                make_annotation(5, "mutex_unlock"),
            ],
            "issues": [],
            "experiment_type": "thread",
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._pattern_match(state)
        types = [p["type"] for p in result["pattern_matches"]]
        assert "missing_unlock" in types

    def test_unlock_more_than_lock_extra_unlock(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [
                make_annotation(1, "mutex_lock"),
                make_annotation(3, "mutex_unlock"),
                make_annotation(5, "mutex_unlock"),
            ],
            "issues": [],
            "experiment_type": "thread",
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._pattern_match(state)
        types = [p["type"] for p in result["pattern_matches"]]
        assert "extra_unlock" in types

    def test_balanced_lock_unlock_no_pattern(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [
                make_annotation(1, "mutex_lock"),
                make_annotation(3, "mutex_unlock"),
            ],
            "issues": [],
            "experiment_type": "thread",
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._pattern_match(state)
        types = [p["type"] for p in result["pattern_matches"]]
        assert "missing_unlock" not in types
        assert "extra_unlock" not in types

    def test_early_return_pattern(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [
                make_annotation(10, "early_return"),
            ],
            "issues": [],
            "experiment_type": "thread",
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._pattern_match(state)
        types = [p["type"] for p in result["pattern_matches"]]
        assert "early_return" in types

    def test_no_patterns_on_empty_annotations(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [],
            "issues": [],
            "experiment_type": "thread",
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._pattern_match(state)
        assert result["pattern_matches"] == []


class TestResourceAnalysis:
    """_resource_analysis: malloc>free→warning; open>close→warning"""

    def test_malloc_more_than_free_warning(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [
                make_annotation(1, "mem_malloc"),
                make_annotation(3, "mem_malloc"),
                make_annotation(5, "mem_free"),
            ],
            "issues": [],
            "experiment_type": "memory",
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._resource_analysis(state)
        ra = result["resource_analysis"]
        assert ra["malloc_count"] == 2
        assert ra["free_count"] == 1
        assert any("内存泄漏" in w for w in ra["warnings"])

    def test_open_more_than_close_warning(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [
                make_annotation(1, "fd_op", "open"),
                make_annotation(3, "fd_op", "open"),
                make_annotation(5, "fd_op", "close"),
            ],
            "issues": [],
            "experiment_type": "fs",
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._resource_analysis(state)
        ra = result["resource_analysis"]
        assert ra["fd_open_count"] == 2
        assert ra["fd_close_count"] == 1
        assert any("fd泄漏" in w for w in ra["warnings"])

    def test_balanced_resources_no_warning(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [
                make_annotation(1, "mem_malloc"),
                make_annotation(2, "mem_free"),
                make_annotation(5, "fd_op", "open"),
                make_annotation(6, "fd_op", "close"),
            ],
            "issues": [],
            "experiment_type": "memory",
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._resource_analysis(state)
        ra = result["resource_analysis"]
        assert ra["malloc_count"] == 1
        assert ra["free_count"] == 1
        assert ra["warnings"] == []

    def test_count_mutex_annotations(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [
                make_annotation(1, "mutex_lock"),
                make_annotation(3, "mutex_unlock"),
                make_annotation(5, "mutex_trylock"),
            ],
            "issues": [],
            "experiment_type": "thread",
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._resource_analysis(state)
        assert result["resource_analysis"]["mutex_count"] == 3


class TestGradingHelper:
    """_grading_helper: 生成L1/L2/L3分层提示"""

    def test_generates_l1_l2_l3_when_missing_unlock(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [],
            "issues": [],
            "experiment_type": "thread",
            "pattern_matches": [
                {"type": "missing_unlock", "severity": "error", "message": "missing"}
            ],
            "resource_analysis": {"warnings": ["内存泄漏"]},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._grading_helper(state)
        th = result["result"]["teaching_hints"]
        assert th["L1"] != ""
        assert "unlock" in th["L2"]
        assert th["L3"] != ""

    def test_generates_l1_l2_l3_when_early_return(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [],
            "issues": [],
            "experiment_type": "thread",
            "pattern_matches": [
                {"type": "early_return", "severity": "warning", "message": "early"}
            ],
            "resource_analysis": {"warnings": []},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._grading_helper(state)
        th = result["result"]["teaching_hints"]
        assert "return" in th["L2"]
        assert "资源释放" in th["L3"]

    def test_no_patterns_uses_resource_warnings_for_l2(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [],
            "issues": [],
            "experiment_type": "memory",
            "pattern_matches": [],
            "resource_analysis": {"warnings": ["malloc(2) > free(1) — 可能内存泄漏"]},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._grading_helper(state)
        th = result["result"]["teaching_hints"]
        assert "内存泄漏" in th["L2"]

    def test_no_patterns_no_warnings_default_hints(self) -> None:
        agent = CodeAuditorAgent()
        state: AuditState = {
            "code": "",
            "annotations": [],
            "issues": [],
            "experiment_type": "process",
            "pattern_matches": [],
            "resource_analysis": {"warnings": []},
            "llm_analysis": "",
            "result": {},
            "error": None,
        }
        result = agent._grading_helper(state)
        th = result["result"]["teaching_hints"]
        assert "运行测试" in th["L1"]
        assert "L1" in th
        assert "L2" in th
        assert "L3" in th


class TestRunSimplePipeline:
    """_run_simple: full pipeline."""

    @pytest.mark.asyncio
    async def test_run_simple_without_llm(self) -> None:
        agent = CodeAuditorAgent()
        annotations = [
            make_annotation(1, "mutex_lock"),
            make_annotation(3, "mutex_unlock"),
            make_annotation(5, "mem_malloc"),
            make_annotation(7, "mem_free"),
        ]
        result = await agent._run_simple({
            "code": "int main(){ return 0; }",
            "annotations": annotations,
            "issues": [],
            "experiment_type": "thread",
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        })
        assert "pattern_matches" in result
        assert "resource_analysis" in result
        assert "teaching_hints" in result

    @pytest.mark.asyncio
    async def test_run_simple_with_llm(self) -> None:
        mock_llm = AsyncMock()
        mock_llm.generate.return_value = '{"issues": [], "overall": "looks good"}'
        agent = CodeAuditorAgent(llm_client=mock_llm)
        result = await agent._run_simple({
            "code": "int main(){ return 0; }",
            "annotations": [],
            "issues": [],
            "experiment_type": "process",
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        })
        assert result["llm_analysis"] == '{"issues": [], "overall": "looks good"}'

    @pytest.mark.asyncio
    async def test_run_simple_llm_failure_graceful(self) -> None:
        mock_llm = AsyncMock()
        mock_llm.generate.side_effect = RuntimeError("boom")
        agent = CodeAuditorAgent(llm_client=mock_llm)
        result = await agent._run_simple({
            "code": "",
            "annotations": [],
            "issues": [],
            "experiment_type": "thread",
            "pattern_matches": [],
            "resource_analysis": {},
            "llm_analysis": "",
            "result": {},
            "error": None,
        })
        assert "LLM分析失败" in result["llm_analysis"]
        assert result["error"] == "boom"


@pytest.mark.asyncio
async def test_audit_entry_point() -> None:
    """audit() runs the sequential pipeline."""
    agent = CodeAuditorAgent()
    result = await agent.audit(
        code="int main(){ return 0; }",
        annotations=[
            make_annotation(1, "mutex_lock"),
            make_annotation(2, "mutex_unlock"),
        ],
        issues=[],
        experiment_type="thread",
    )
    assert "pattern_matches" in result
    assert "teaching_hints" in result
