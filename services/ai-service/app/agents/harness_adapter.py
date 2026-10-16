"""Harness Response Adapter — Converts AgentState (dict or object) → frontend-compatible response formats."""

import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def _g(st: Any, key: str, default=None):
    if isinstance(st, dict):
        return st.get(key, default)
    return getattr(st, key, default)


def _minimal_harness(st: Any) -> dict:
    return {
        "intent": _g(st, "intent", "unknown"),
        "intent_confidence": _g(st, "intent_confidence", 0.0),
        "watermark": "normal",
        "utilization_pct": 0,
        "eval_score": None,
        "guards_passed": True,
        "guards_blocked_reason": "",
        "diagnosis": None,
        "tutoring": None,
        "related_concepts": [],
        "firewall_reports": {},
    }


def _resolve_watermark(fw_reports: dict) -> str:
    if not fw_reports:
        return "normal"
    wms = [r.get("watermark", "normal") for r in fw_reports.values() if isinstance(r, dict)]
    if "emergency" in wms:
        return "emergency"
    elif "summary" in wms:
        return "summary"
    elif "slide" in wms:
        return "slide"
    elif "micro" in wms:
        return "micro"
    return "normal"


def _max_utilization(fw_reports: dict) -> float:
    if not fw_reports:
        return 0.0
    utils = [r.get("utilization_pct", 0) for r in fw_reports.values() if isinstance(r, dict)]
    return round(max(utils), 1) if utils else 0.0


def _extract_text_reply(st: Any) -> str:
    result = _g(st, "diagnosis_result")
    if not result:
        return _g(st, "error", "") or "No response generated."
    if isinstance(result, dict):
        # ── New hybrid format: {reply, metadata, hybrid: true} ──
        if result.get("hybrid") and result.get("reply"):
            return result["reply"]

        # ── Raw text with optional JSON tail ──
        if result.get("reply") and not result.get("hybrid"):
            return result["reply"]

        # ── Legacy formats below ──
        diag = result.get("diagnosis", {}) if isinstance(result.get("diagnosis"), dict) else {}
        tut = result.get("tutoring", {}) if isinstance(result.get("tutoring"), dict) else {}
        fb = result.get("feedback", {}) if isinstance(result.get("feedback"), dict) else {}

        if not diag and not tut:
            diag = {
                "error_type": result.get("error_type", ""),
                "root_cause": result.get("root_cause", ""),
                "severity": result.get("severity", ""),
            }
            tut = {
                "l1_direction": fb.get("level_1", ""),
                "l2_strategy": fb.get("level_2", ""),
                "l3_insight": fb.get("level_3", ""),
                "follow_up_question": fb.get("level_4", ""),
            }
        if not tut.get("l1_direction"):
            tut["l1_direction"] = fb.get("level_1", "")
        if not tut.get("l2_strategy"):
            tut["l2_strategy"] = fb.get("level_2", "")
        if not tut.get("l3_insight"):
            tut["l3_insight"] = fb.get("level_3", "")
        if not tut.get("follow_up_question"):
            tut["follow_up_question"] = fb.get("level_4", "")

        et = diag.get("error_type", "") or result.get("error_type", "")
        sv = diag.get("severity", "") or result.get("severity", "")
        rc = diag.get("root_cause", "") or result.get("root_cause", "")
        l1 = tut.get("l1_direction", "")
        l2 = tut.get("l2_strategy", "")
        l3 = tut.get("l3_insight", "")
        l4 = tut.get("follow_up_question", "")

        # Detect: is this a real diagnosis or casual chat?
        no_code_msgs = [
            "没有提交", "没有发现代码", "未提交", "还没把代码",
            "没有代码", "暂无代码", "没贴代码", "代码还没",
        ]
        is_casual = (
            not et or et.strip() in ("", "none", "无", "info", "general") or
            sv in ("info", "") or
            any(m in rc for m in no_code_msgs) or
            any(m in l1 for m in no_code_msgs)
        )

        if is_casual:
            # Just flow naturally: concatenate what the LLM said, no structure
            parts = [p for p in [rc, l1, l2, l3, l4] if p and p.strip()]
            if parts:
                return "\n\n".join(parts)
            return json.dumps(result, ensure_ascii=False, indent=2)[:3000]

        # Real diagnosis: conversational with gentle emoji hints
        lines = []

        # Opening
        if et and "\u7f16\u8bd1" in et:
            lines.append("\u55e8\uff0c\u4f60\u7684\u4ee3\u7801\u5728\u7f16\u8bd1\u9636\u6bb5\u78b0\u5230\u4e86\u70b9\u95ee\u9898\uff0c\u6211\u5e2e\u4f60\u770b\u770b\uff5e")
        elif sv in ("critical", "error"):
            lines.append("\u522b\u7740\u6025\uff0c\u6211\u770b\u5230\u4e86\u4e00\u4e2a\u9700\u8981\u5173\u6ce8\u7684\u5730\u65b9\uff5e")
        else:
            lines.append("\u55ef\uff0c\u770b\u4e86\u4e0b\u4f60\u7684\u60c5\u51b5\uff5e")

        if rc:
            lines.append(f"\n{rc}")

        if l1:
            lines.append(f"\n\U0001f4a1 {l1}")
        if l2:
            lines.append(f"\n\U0001f50d {l2}")
        if l3:
            lines.append(f"\n\U0001f511 {l3}")
        if l4:
            lines.append(f"\n\U0001f914 {l4}")

        closings = [
            "\u6162\u6162\u6765\uff0c\u6709\u8fdb\u5c55\u4e86\u968f\u65f6\u627e\u6211\uff5e",
            "\u522b\u6015\u72af\u9519\uff0c\u6bcf\u4e2a bug \u90fd\u662f\u6210\u957f\u7684\u673a\u4f1a \U0001f4aa",
            "\u8bd5\u8bd5\u770b\uff0c\u56f0\u60d1\u7684\u8bdd\u6211\u4eec\u518d\u4e00\u8d77\u5206\u6790\uff5e",
        ]
        lines.append(f"\n{closings[hash(et or '') % len(closings)]}")

        return "\n".join(lines).strip()
    return str(result)[:3000]


def _extract_harness_block(st: Any) -> dict:
    try:
        result = _g(st, "diagnosis_result") or {}
        if not isinstance(result, dict):
            return _minimal_harness(st)

        # ── New hybrid format ──
        if result.get("hybrid") and result.get("metadata"):
            meta = result["metadata"]
            fw_reports = _g(st, "firewall_reports") or {}
            return {
                "intent": meta.get("intent", _g(st, "intent", "unknown")),
                "intent_confidence": round(float(_g(st, "intent_confidence", 0.0)), 3),
                "watermark": _resolve_watermark(fw_reports),
                "utilization_pct": _max_utilization(fw_reports),
                "eval_score": None,
                "guards_passed": True,
                "guards_blocked_reason": "",
                "diagnosis": None,
                "tutoring": {
                    "hint_level": meta.get("hint_level", ""),
                    "bloom_level": meta.get("bloom_level", ""),
                    "next_bloom_level": meta.get("next_bloom_level", ""),
                },
                "related_concepts": meta.get("concepts", []),
                "firewall_reports": fw_reports if fw_reports else {},
            }

        # ── Legacy formats below ──
        diag = result.get("diagnosis", {}) if isinstance(result.get("diagnosis"), dict) else {}
        tut = result.get("tutoring", {}) if isinstance(result.get("tutoring"), dict) else {}
        fb = result.get("feedback", {}) if isinstance(result.get("feedback"), dict) else {}

        # Normalize flat format to nested
        if not diag and not tut:
            diag = {
                "error_type": result.get("error_type", ""),
                "root_cause": result.get("root_cause", ""),
                "severity": result.get("severity", ""),
                "related_concepts": [c.get("name", c) if isinstance(c, dict) else c for c in result.get("related_concepts", [])],
            }
            tut = {
                "l1_direction": fb.get("level_1", ""),
                "l2_strategy": fb.get("level_2", ""),
                "l3_insight": fb.get("level_3", ""),
                "follow_up_question": fb.get("level_4", ""),
            }

        fw_reports = _g(st, "firewall_reports") or {}
        watermark = _resolve_watermark(fw_reports)
        util_pct = _max_utilization(fw_reports)

        eval_result = _g(st, "eval_result")
        eval_score = None
        if eval_result and isinstance(eval_result, dict):
            eval_score = eval_result.get("overall_score")

        input_guards = _g(st, "input_guard_checks") or []
        guards_passed = True
        blocked_reason = ""
        for g in input_guards:
            if isinstance(g, dict) and g.get("result") == "block":
                guards_passed = False
                blocked_reason = g.get("reason", "Input blocked")
                break

        return {
            "intent": _g(st, "intent", "unknown"),
            "intent_confidence": round(float(_g(st, "intent_confidence", 0.0)), 3),
            "watermark": watermark,
            "utilization_pct": util_pct,
            "eval_score": eval_score,
            "guards_passed": guards_passed,
            "guards_blocked_reason": blocked_reason,
            "diagnosis": diag if diag else None,
            "tutoring": tut if tut else None,
            "related_concepts": diag.get("related_concepts", []) if diag else [],
            "firewall_reports": fw_reports if fw_reports else {},
        }
    except Exception as e:
        logger.warning("Failed to build harness block: %s", e)
        return _minimal_harness(st)


def to_chat_reply(st: Any) -> dict:
    reply = _extract_text_reply(st)
    if not reply:
        reply = "抱歉，处理请求时出现问题：" + str(_g(st, "error", ""))
    response = {
        "reply": reply,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    harness = _extract_harness_block(st)
    if harness:
        response["harness"] = harness
    err = _g(st, "error", "")
    if err:
        response["error"] = err
    return response


def to_ask_reply(st: Any) -> dict:
    reply = _extract_text_reply(st)
    if not reply:
        reply = "抱歉，处理请求时出现问题：" + str(_g(st, "error", ""))
    response = {"reply": reply, "sources": _build_references(_g(st, "rag_sources"))}
    harness = _extract_harness_block(st)
    if harness:
        response["harness"] = harness
    return response


def _build_references(sources: Any) -> list[dict]:
    """Normalize structured retrieval rows into the frontend reference contract."""
    if not sources:
        return []
    refs = []
    for i, s in enumerate(sources):
        if not isinstance(s, dict):
            continue
        refs.append({
            "id": str(s.get("id") or s.get("chunk_id") or ""),
            "entry_id": str(s.get("entry_id") or ""),
            "title": s.get("title") or "未命名文档",
            "knowledge_type": s.get("knowledge_type") or "course_notes",
            "tags": s.get("tags") or [],
            "chunk_index": int(s.get("chunk_index") or 0),
            "content": s.get("content") or "",
            "similarity": round(float(s.get("similarity") or 0.0), 4),
            "index": i + 1,
        })
    return refs


def to_rag_answer(st: Any) -> dict:
    answer = _extract_text_reply(st)
    if not answer:
        answer = "抱歉，处理请求时出现问题：" + str(_g(st, "error", ""))
    references = _build_references(_g(st, "rag_sources"))
    response = {
        "answer": answer,
        "sources": references,
        "references": references,
        "context_used": bool(_g(st, "rag_context")),
    }
    harness = _extract_harness_block(st)
    if harness:
        response["harness"] = harness
    return response
