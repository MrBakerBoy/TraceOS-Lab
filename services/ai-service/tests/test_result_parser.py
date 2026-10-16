"""Tests for result_parser module."""

import json

from app.services.result_parser import parse_diagnosis_response


def test_parse_json_code_block() -> None:
    data = {
        "error_type": "runtime_error",
        "severity": "medium",
        "root_cause": "fork 返回值未检查",
        "feedback": {"level_1": "提示1", "level_2": "提示2", "level_3": "提示3"},
        "confidence_score": 0.85,
    }
    raw = f"```json\n{json.dumps(data, ensure_ascii=False)}\n```"
    result = parse_diagnosis_response(raw)
    assert result["error_type"] == "runtime_error"
    assert result["confidence_score"] == 0.85


def test_parse_bare_json() -> None:
    data = {"error_type": "compile_error", "root_cause": "missing semicolon"}
    raw = json.dumps(data)
    result = parse_diagnosis_response(raw)
    assert result["error_type"] == "compile_error"


def test_parse_invalid_json_returns_fallback() -> None:
    raw = "This is not JSON at all, just some text from the AI."
    result = parse_diagnosis_response(raw)
    assert result["error_type"] == "unknown"
    assert "feedback" in result
    assert result["confidence_score"] == 0.5


def test_parse_partial_json_fills_defaults() -> None:
    raw = '{"error_type": "timeout"}'
    result = parse_diagnosis_response(raw)
    assert result["error_type"] == "timeout"
    assert "feedback" in result
    assert "level_1" in result["feedback"]
    assert isinstance(result["related_concepts"], list)


def test_parse_generic_code_block() -> None:
    data = {"error_type": "memory_exceeded", "root_cause": "OOM"}
    raw = f"```\n{json.dumps(data)}\n```"
    result = parse_diagnosis_response(raw)
    assert result["error_type"] == "memory_exceeded"


def test_parse_fallback_has_raw_text() -> None:
    raw = "Some long AI response that is not JSON " * 50
    result = parse_diagnosis_response(raw)
    assert result["error_type"] == "unknown"
    assert len(result["root_cause"]) <= 500
    assert result["feedback"]["level_3"] == raw
