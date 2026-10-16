"""结果解析器 - 解析 Mimo AI 返回的 JSON 为结构化数据"""

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

_FALLBACK_TEMPLATE: dict[str, Any] = {
    "error_type": "unknown",
    "severity": "medium",
    "root_cause": "",
    "feedback": {
        "level_1": "AI 分析完成，请查看详细反馈",
        "level_2": "",
        "level_3": "",
    },
    "related_concepts": [],
    "related_syscalls": [],
    "suggested_fixes": [],
    "confidence_score": 0.5,
}


def parse_diagnosis_response(raw: str) -> dict[str, Any]:
    """从 AI 返回文本中提取结构化诊断结果。

    支持:
    - ```json ... ``` 代码块
    - ``` ... ``` 通用代码块
    - 裸 JSON 字符串
    - 解析失败时返回兜底结构
    """
    json_str = _extract_json_string(raw)

    if json_str is not None:
        try:
            data = json.loads(json_str)
            if isinstance(data, dict):
                return _fill_defaults(data, raw)
        except json.JSONDecodeError:
            logger.warning("Failed to parse extracted JSON string")

    # Fallback: return template with raw text
    fallback = dict(_FALLBACK_TEMPLATE)
    fallback["root_cause"] = raw[:500] if len(raw) > 500 else raw
    fallback["feedback"]["level_3"] = raw
    return fallback


def _extract_json_string(raw: str) -> str | None:
    """Try to extract JSON from various formats.
    
    Handles leading whitespace, markdown code blocks,
    embedded code blocks and truncated responses.
    """
    stripped = raw.strip()

    # Try finding and parsing a JSON object anywhere in the text
    try:
        # Find first { and last }
        start = stripped.index("{")
        end = stripped.rindex("}") + 1
        candidate = stripped[start:end]
        json.loads(candidate)
        return candidate
    except (ValueError, json.JSONDecodeError):
        pass

    # Try stripping markdown code block markers
    if "```json" in stripped:
        try:
            start = stripped.index("```json") + 7
            # Skip newline after ```json
            nl = stripped.find("\n", start)
            if nl >= 0 and nl - start < 20:
                start = nl + 1
            # Find last ``` (if present)
            end = stripped.rfind("```")
            if end > start:
                candidate = stripped[start:end].strip()
                json.loads(candidate)
                return candidate
            # No closing ``` - try to parse to end
            candidate = stripped[start:]
            # Find the last complete JSON object
            try:
                end = candidate.rindex("}") + 1
                json.loads(candidate[:end])
                return candidate[:end]
            except:
                pass
        except (ValueError, json.JSONDecodeError):
            pass

    if "```" in stripped:
        try:
            first = stripped.index("```")
            start = first + 3
            nl = stripped.find("\n", start)
            if nl >= 0 and nl - start < 20:
                start = nl + 1
            end = stripped.rfind("```")
            if end > start:
                candidate = stripped[start:end].strip()
                json.loads(candidate)
                return candidate
            # No closing - try to end
            candidate = stripped[start:]
            try:
                end = candidate.rindex("}") + 1
                json.loads(candidate[:end])
                return candidate[:end]
            except:
                pass
        except (ValueError, json.JSONDecodeError):
            pass

    return None

def _fill_defaults(data: dict[str, Any], raw: str) -> dict[str, Any]:
    """Fill missing fields with defaults."""
    result = dict(_FALLBACK_TEMPLATE)
    result.update(data)

    # Ensure feedback has all levels
    if "feedback" in data and isinstance(data["feedback"], dict):
        fb = dict(_FALLBACK_TEMPLATE["feedback"])
        fb.update(data["feedback"])
        result["feedback"] = fb

    # Ensure lists exist
    for key in ("related_concepts", "related_syscalls", "suggested_fixes"):
        if not isinstance(result.get(key), list):
            result[key] = []

    return result
