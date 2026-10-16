"""Diagnosis + Tutor Agent — Combined system diagnosis and pedagogical tutoring.

Uses unified BASE_TEACHING_PERSONA + intent-specific prefixes.
Output: Markdown body + optional JSON metadata tail.
"""

import json
import logging
import re
from typing import Any

from app.services.llm_client import get_llm_provider
from app.agents.prompts.base_teaching_persona import BASE_TEACHING_PERSONA
from app.agents.prompts.intent_prefixes import get_intent_prefix

logger = logging.getLogger(__name__)


def _extract_json_tail(text: str) -> tuple[str, dict[str, Any] | None]:
    """Extract JSON metadata tail from markdown response.

    Looks for ```json ... ``` block at the end of the text.
    Returns (body_text, json_dict_or_None).
    """
    # Pattern: ```json\n{...}\n``` at end of text (allow trailing whitespace)
    m = re.search(r"```json\s*\n(\{.*?\})\s*\n```\s*$", text, re.DOTALL)
    if m:
        try:
            body = text[: m.start()].rstrip()
            meta = json.loads(m.group(1))
            return body, meta
        except json.JSONDecodeError:
            return text, None
    return text, None


def _build_hybrid_result(raw_response: str, intent: str) -> dict[str, Any]:
    """Convert model response to structured result.

    Case 1: Has JSON tail → extract body + metadata, return structured dict.
    Case 2: Pure text (general_chat) → return as tutoring text.
    Case 3: Pure JSON (legacy models) → parse and wrap.
    """
    # Try to extract JSON tail first
    body, meta = _extract_json_tail(raw_response)

    if meta:
        # Hybrid output: body is the natural language reply, meta has JSON metadata
        return {
            "reply": body,
            "metadata": meta,
            "hybrid": True,
            "raw": raw_response,
        }

    # Try pure JSON (legacy fallback for models that ignore new prompt)
    try:
        result = json.loads(raw_response)
        if isinstance(result, dict):
            # Detect if this looks like a diagnosis response
            if "diagnosis" in result or "error_type" in result:
                return result  # Legacy format
            result["_legacy_json"] = True
            return result
    except json.JSONDecodeError:
        pass

    # Pure text response
    return {
        "reply": raw_response,
        "hybrid": False,
        "raw": raw_response,
    }


class DiagnosisTutorAgent:
    """Combined agent that diagnoses system errors and generates Socratic tutoring hints."""

    def __init__(self):
        self._llm = None

    @property
    def llm(self):
        if self._llm is None:
            self._llm = get_llm_provider()
        return self._llm

    async def analyze(
        self,
        code: str,
        experiment_title: str = "",
        experiment_description: str = "",
        language: str = "c",
        compile_error: str | None = None,
        runtime_error: str | None = None,
        test_results: list[dict[str, Any]] | None = None,
        strace_summary: str | None = None,
        experiment_category: str = "",
        experiment_instructions: str = "",
        rag_context: str = "",
        intent: str = "diagnosis",
        student_profile_context: str = "",
        conversation_summary: str = "",
        detection_data_context: str = "",
        theme: str = "ocean",
    ) -> dict[str, Any]:
        """Run full diagnosis + tutoring analysis with unified teaching persona.

        Key changes from old version:
        - Uses BASE_TEACHING_PERSONA + intent_prefix instead of two contradictory prompts
        - Accepts intent parameter for strategy selection
        - Accepts student_profile_context / conversation_summary / detection_data_context for L0 injection
        - Temperature raised to 0.7 for more detailed teaching responses
        - Handles hybrid output (Markdown body + JSON tail)
        - theme: visual theme (ocean/forest/sunset/lavender/midnight)
        """

        # Build the base system + user prompts from prompt_builder
        # (SYSTEM_PROMPT_BASE is now a lightweight output format guide, not the full persona)
        from app.services.prompt_builder import build_diagnosis_prompt
        legacy_system, user_prompt = build_diagnosis_prompt(
            code=code,
            experiment_title=experiment_title,
            experiment_description=experiment_description,
            language=language,
            compile_error=compile_error,
            runtime_error=runtime_error,
            test_results=test_results,
            strace_summary=strace_summary,
            experiment_category=experiment_category,
            experiment_instructions=experiment_instructions,
            intent=intent,
            theme=theme,
        )

        # Inject RAG context if available
        if rag_context:
            user_prompt += f"\n\n## Knowledge Base References\n{rag_context}"

        # ── Assemble the unified system prompt ──
        # Order: intent_prefix → BASE_TEACHING_PERSONA → output format guide
        intent_prefix = get_intent_prefix(intent)
        system_prompt = intent_prefix + "\n\n" + BASE_TEACHING_PERSONA + "\n\n" + legacy_system

        # Inject student profile and detection data if available
        if student_profile_context or conversation_summary or detection_data_context:
            teaching_guide = (
                "\n\n## 学生上下文 (内部参考)\n"
            )
            if student_profile_context:
                teaching_guide += f"### 学生画像\n{student_profile_context}\n\n"
            if conversation_summary:
                teaching_guide += f"### 对话摘要\n{conversation_summary}\n\n"
            if detection_data_context:
                teaching_guide += f"### 检测数据\n{detection_data_context}\n"
            system_prompt += teaching_guide

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        try:
            resp = await self.llm.chat_completion_with_messages(messages, temperature=0.7, max_tokens=4096)
            raw_content = resp.content

            # Handle hybrid output
            result = _build_hybrid_result(raw_content, intent)

            # For backward compatibility: if the result is a legacy JSON diagnosis,
            # return it as-is (existing harness_adapter handles this)
            if "diagnosis" in result or "error_type" in result:
                return result

            # New hybrid format: wrap in backwards-compatible structure
            return result

        except json.JSONDecodeError:
            logger.warning("Failed to parse DiagnosisTutor JSON response, returning raw")
            return {
                "diagnosis": {"error_type": "unknown", "root_cause": resp.content[:500]},
                "tutoring": {"l1_direction": resp.content[:200]},
                "code_quality": {"issues": [], "suggestions": []},
            }
        except Exception as e:
            logger.error("DiagnosisTutor analysis failed: %s", e)
            return {
                "diagnosis": {"error_type": "error", "root_cause": f"Analysis failed: {e}"},
                "tutoring": {"l1_direction": "Analysis service temporarily unavailable"},
                "code_quality": {"issues": [], "suggestions": []},
            }