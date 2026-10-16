"""Tests for code_audit_service module."""

import json
import pytest
from unittest.mock import AsyncMock

from app.services.code_audit_service import CodeAuditService


class TestRuleBasedResult:
    """_rule_based_result: 各实验类型返回不同hints"""

    def test_thread_hints(self) -> None:
        service = CodeAuditService()
        result = service._rule_based_result([], [], "thread")
        hints = result["teaching_hints"]
        assert "mutex" in hints["L1"]
        assert "lock" in hints["L2"]
        assert "pthread_mutex_unlock" in hints["L3"]

    def test_memory_hints(self) -> None:
        service = CodeAuditService()
        result = service._rule_based_result([], [], "memory")
        hints = result["teaching_hints"]
        assert "malloc" in hints["L1"]
        assert "free" in hints["L2"]
        assert "free" in hints["L3"]

    def test_process_hints(self) -> None:
        service = CodeAuditService()
        result = service._rule_based_result([], [], "process")
        hints = result["teaching_hints"]
        assert "fork" in hints["L1"]
        assert "waitpid" in hints["L3"]

    def test_fs_hints(self) -> None:
        service = CodeAuditService()
        result = service._rule_based_result([], [], "fs")
        hints = result["teaching_hints"]
        assert "文件描述符" in hints["L1"]
        assert "close" in hints["L2"]

    def test_scheduler_hints(self) -> None:
        service = CodeAuditService()
        result = service._rule_based_result([], [], "scheduler")
        hints = result["teaching_hints"]
        assert "调度算法" in hints["L1"]

    def test_deadlock_hints(self) -> None:
        service = CodeAuditService()
        result = service._rule_based_result([], [], "deadlock")
        hints = result["teaching_hints"]
        assert "资源" in hints["L1"]
        assert "循环等待" in hints["L2"]

    def test_unknown_type_defaults_to_process(self) -> None:
        service = CodeAuditService()
        result = service._rule_based_result([], [], "unknown_type")
        hints = result["teaching_hints"]
        assert "fork" in hints["L1"]

    def test_includes_passed_issues(self) -> None:
        service = CodeAuditService()
        issues = [{"line": 10, "title": "leak"}]
        result = service._rule_based_result(issues, [], "memory")
        assert result["ai_issues"] == issues

    def test_explanation_includes_issue_count(self) -> None:
        service = CodeAuditService()
        issues = [{"line": 1}, {"line": 2}, {"line": 3}]
        result = service._rule_based_result(issues, [], "process")
        assert "3" in result["explanation"]


class TestParseLLMResponse:
    """_parse_llm_response: JSON解析; 非JSON fallback"""

    def test_parse_valid_json(self) -> None:
        service = CodeAuditService()
        data = {
            "ai_issues": [{"line": 5, "severity": "error", "title": "null ptr"}],
            "explanation": "代码有潜在空指针问题",
            "teaching_hints": {"L1": "提示1", "L2": "提示2", "L3": "提示3"},
        }
        result = service._parse_llm_response(json.dumps(data, ensure_ascii=False))
        assert result["ai_issues"][0]["line"] == 5
        assert result["explanation"] == "代码有潜在空指针问题"

    def test_parse_json_block_with_extra_text(self) -> None:
        service = CodeAuditService()
        data = {"ai_issues": [], "explanation": "ok", "teaching_hints": {"L1": "", "L2": "", "L3": ""}}
        raw = f"Here is my analysis:\n```json\n{json.dumps(data)}\n```\nHope this helps!"
        result = service._parse_llm_response(raw)
        assert result["explanation"] == "ok"

    def test_parse_non_json_fallback(self) -> None:
        service = CodeAuditService()
        raw = "This is just a plain text response from the model, no JSON here."
        result = service._parse_llm_response(raw)
        assert result["ai_issues"] == []
        assert result["explanation"][:200] == raw[:200]
        assert result["teaching_hints"]["L1"] == "请检查你的代码逻辑"

    def test_parse_broken_json_with_recoverable_block(self) -> None:
        service = CodeAuditService()
        valid = {"ai_issues": [], "explanation": "recovered", "teaching_hints": {"L1": "A", "L2": "B", "L3": "C"}}
        raw = f"prefix text {{ \"ai_issues\": [], \"explanation\": \"recovered\", \"teaching_hints\": {{\"L1\": \"A\", \"L2\": \"B\", \"L3\": \"C\"}} }} suffix text"
        result = service._parse_llm_response(raw)
        assert result["explanation"] == "recovered"


class TestBuildPrompt:
    """_build_prompt: 验证prompt包含code、annotations、experiment_type"""

    def test_prompt_contains_code(self) -> None:
        service = CodeAuditService()
        prompt = service._build_prompt(
            code="int main() { return 0; }",
            annotation_lines=["  行1: [func_def] main"],
            issues=[{"line": 5, "severity": "warning", "title": "test", "description": "desc"}],
            experiment_type="thread",
        )
        assert "int main() { return 0; }" in prompt

    def test_prompt_contains_annotations(self) -> None:
        service = CodeAuditService()
        prompt = service._build_prompt("code", ["  行1: [mutex_lock] lock", "  行3: [mutex_unlock] unlock"], [], "thread")
        assert "mutex_lock" in prompt
        assert "mutex_unlock" in prompt

    def test_prompt_contains_experiment_type(self) -> None:
        service = CodeAuditService()
        for etype in ["thread", "memory", "process", "fs", "scheduler", "deadlock"]:
            prompt = service._build_prompt("code", [], [], etype)
            assert etype in prompt

    def test_prompt_contains_issue_details(self) -> None:
        service = CodeAuditService()
        issues = [{"line": 10, "severity": "error", "title": "null deref", "description": "指针未初始化"}]
        prompt = service._build_prompt("code", [], issues, "memory")
        assert "null deref" in prompt
        assert "指针未初始化" in prompt

    def test_prompt_handles_empty_annotations(self) -> None:
        service = CodeAuditService()
        prompt = service._build_prompt("code", [], [], "process")
        assert "无标注" in prompt
        assert "无预检问题" in prompt

    def test_prompt_handles_issues_missing_keys(self) -> None:
        service = CodeAuditService()
        issues = [{}]
        prompt = service._build_prompt("code", [], issues, "thread")
        # should not crash
        assert "行?" in prompt
        assert "?" in prompt


@pytest.mark.asyncio
async def test_deep_audit_no_llm_uses_rule_based() -> None:
    """无LLM客户端时使用规则引擎"""
    service = CodeAuditService()
    result = await service.deep_audit(
        code="int main(){}",
        annotations=[],
        issues=[{"line": 1, "title": "test"}],
        experiment_type="memory",
    )
    assert result["teaching_hints"]["L1"] != ""
    assert "malloc" in result["teaching_hints"]["L1"]


@pytest.mark.asyncio
async def test_deep_audit_with_llm_success() -> None:
    """LLM返回有效JSON"""
    mock_llm = AsyncMock()
    mock_llm.generate.return_value = json.dumps({
        "ai_issues": [{"line": 10, "severity": "error", "title": "use-after-free", "description": "desc", "suggestion": "check"}],
        "explanation": "代码质量良好",
        "teaching_hints": {"L1": "H1", "L2": "H2", "L3": "H3"},
    })
    service = CodeAuditService(llm_client=mock_llm)
    result = await service.deep_audit("code", [], [], "memory")
    assert result["explanation"] == "代码质量良好"
    assert result["ai_issues"][0]["title"] == "use-after-free"


@pytest.mark.asyncio
async def test_deep_audit_llm_failure_graceful() -> None:
    """LLM抛出异常时优雅降级"""
    mock_llm = AsyncMock()
    mock_llm.generate.side_effect = RuntimeError("LLM unavailable")
    service = CodeAuditService(llm_client=mock_llm)
    result = await service.deep_audit("code", [], [], "process")
    assert "AI分析暂时不可用" in result["explanation"]
    assert result["ai_issues"] == []
    assert result["teaching_hints"]["L1"] == ""
