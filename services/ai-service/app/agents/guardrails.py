"""
Guardrails — Deterministic input/output safety filtering.

Two tiers (no LLM in the hot path, per refactor plan):
  Tier 1 — Deterministic Checks: regex / rule engine
    < 1ms latency, near-zero cost, covers ~90% of filtering
  Tier 2 — Classifier Checks: keyword-based
    ~10ms latency, extremely low cost, covers ~9% of filtering

Input Guards:  PII detection / injection detection / scope validation
Output Guards: schema validation / toxicity keyword check
Degradation:   graceful fallback when all tools fail
Ratchet:       error pattern accumulation from production failures
"""

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


# ============================================================================
# Guard Result Types
# ============================================================================

class GuardResult(str, Enum):
    ALLOW = "allow"        # Pass through
    BLOCK = "block"        # Hard block — reject entirely
    SANITIZE = "sanitize"  # Remove offending content, pass rest
    FLAG = "flag"          # Allow but flag for review
    QUARANTINE = "quarantine"  # Hold for human review


@dataclass
class GuardCheck:
    guard_name: str
    tier: int               # 1=deterministic, 2=classifier, 3=LLM Judge
    result: GuardResult
    reason: str = ""
    latency_ms: float = 0.0
    metadata: dict = field(default_factory=dict)


# ============================================================================
# Tier 1: Deterministic Checks (regex, JSON Schema, rule engine)
# ============================================================================

class DeterministicGuards:
    """Regex-based, zero-LLM-cost safety checks. Covers ~90% of filtering."""

    # Chinese PII patterns
    PII_PATTERNS = {
        "cn_id_card": re.compile(r'\b[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b'),
        "cn_phone": re.compile(r'\b1[3-9]\d{9}\b'),
        "email": re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'),
        "ip_addr": re.compile(r'\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b'),
    }

    # Known prompt injection patterns
    INJECTION_PATTERNS = [
        re.compile(r'(ignore|forget|disregard)\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)', re.I),
        re.compile(r'(you\s+are|act\s+as|pretend\s+to\s+be|roleplay\s+as)\s+(now|from\s+now\s+on)', re.I),
        re.compile(r'(system\s*:\s*|system\s+prompt\s*:\s*|<\|im_start\|>)', re.I),
        re.compile(r'DAN\s+mode|jailbreak|developer\s+mode', re.I),
    ]

    @classmethod
    def check_pii(cls, text: str) -> GuardCheck:
        """Detect PII (personally identifiable information) in text."""
        findings = {}
        for name, pattern in cls.PII_PATTERNS.items():
            matches = pattern.findall(text)
            if matches:
                findings[name] = len(matches)

        if findings:
            return GuardCheck(
                guard_name="pii_detect", tier=1,
                result=GuardResult.SANITIZE,
                reason=f"PII detected: {', '.join(f'{k}({v})' for k, v in findings.items())}",
                metadata={"findings": findings},
            )
        return GuardCheck(guard_name="pii_detect", tier=1, result=GuardResult.ALLOW, reason="No PII detected")

    @classmethod
    def check_injection(cls, text: str) -> GuardCheck:
        """Detect prompt injection attempts."""
        findings = []
        for i, pattern in enumerate(cls.INJECTION_PATTERNS):
            if pattern.search(text):
                findings.append(f"pattern_{i}")

        if findings:
            return GuardCheck(
                guard_name="injection_detect", tier=1,
                result=GuardResult.BLOCK,
                reason=f"Prompt injection detected: {', '.join(findings)}",
                metadata={"patterns": findings},
            )
        return GuardCheck(guard_name="injection_detect", tier=1, result=GuardResult.ALLOW, reason="No injection detected")

    @classmethod
    def check_scope(cls, text: str, allowed_topics: list[str] | None = None) -> GuardCheck:
        """Check if the request is within the allowed topic scope.

        Default: allow OS-related queries; block obviously off-topic requests.
        """
        if allowed_topics is None:
            allowed_topics = [
                "process", "thread", "memory", "malloc", "free", "scheduling",
                "deadlock", "mutex", "semaphore", "file", "io", "pipe", "signal",
                "system call", "syscall", "strace", "compile", "gcc", "c语言",
                "操作系统", "os", "实验", "代码", "bug", "错误", "调试",
            ]

        text_lower = text.lower()
        for topic in allowed_topics:
            if topic.lower() in text_lower:
                return GuardCheck(guard_name="scope_check", tier=1, result=GuardResult.ALLOW, reason=f"Matched topic: {topic}")

        # Short messages (greetings) are fine
        if len(text) < 20:
            return GuardCheck(guard_name="scope_check", tier=1, result=GuardResult.ALLOW, reason="Short message — likely greeting")

        return GuardCheck(
            guard_name="scope_check", tier=1,
            result=GuardResult.FLAG,
            reason="No OS-related topic detected — flagged for review",
        )

    @classmethod
    def check_output_schema(cls, output: dict, schema: dict) -> GuardCheck:
        """Validate output against expected JSON Schema."""
        try:
            # Simple structural check — requires all top-level keys present
            required = schema.get("required", [])
            missing = [k for k in required if k not in output]
            if missing:
                return GuardCheck(guard_name="output_schema", tier=1,
                                  result=GuardResult.BLOCK,
                                  reason=f"Missing required fields: {missing}")
            return GuardCheck(guard_name="output_schema", tier=1, result=GuardResult.ALLOW, reason="Schema valid")
        except Exception as e:
            return GuardCheck(guard_name="output_schema", tier=1, result=GuardResult.BLOCK, reason=str(e))


# ============================================================================
# Tier 2: Classifier Checks (embedding distance, fine-tuned model)
# ============================================================================

class ClassifierGuards:
    """Lightweight classifier-based checks. Covers ~9% of filtering."""

    @classmethod
    def check_toxicity(cls, text: str) -> GuardCheck:
        """Simple keyword-based toxicity check (stand-in for fine-tuned model).

        Only unambiguous slurs / profanity are matched. Single-char Chinese
        keywords ("操", "滚") and tech-adjacent words ("kill", "垃圾") are
        intentionally excluded — they false-positive on "操作系统", "滚动",
        "kill 进程" and "垃圾回收" in an OS course.
        """
        toxic_keywords = [
            "fuck", "shit", "damn", "stupid", "idiot",
            "傻逼", "傻叉", "草泥马", "操你", "操蛋", "卧槽", "妈的", "他妈的",
        ]
        text_lower = text.lower()
        found = [kw for kw in toxic_keywords if kw in text_lower]
        if found:
            return GuardCheck(guard_name="toxicity", tier=2,
                            result=GuardResult.BLOCK,
                            reason=f"Toxic content: {found[:3]}")
        return GuardCheck(guard_name="toxicity", tier=2, result=GuardResult.ALLOW, reason="Clean")

    @classmethod
    def check_off_topic_embedding(cls, text: str, course_scope: str = "") -> GuardCheck:
        """Stub for embedding-distance-based off-topic detection."""
        return GuardCheck(guard_name="off_topic_embedding", tier=2, result=GuardResult.ALLOW, reason="Embedding check not configured")


# ============================================================================
# Input / Output Guardrail Pipelines
# ============================================================================

class InputGuardPipeline:
    """Three-tier cascaded input filtering."""

    def __init__(self):
        self.checks: list[GuardCheck] = []

    async def check(self, text: str) -> list[GuardCheck]:
        """确定性输入过滤 (Tier 1 规则 + Tier 2 关键词, 无 LLM).

        按整改方案去掉多层 cost-cascade: 提问热路径不再触发 LLM judge,
        避免 scope FLAG 引发的额外 LLM 往返放大延迟。
        """
        self.checks = []
        import time

        # Tier 1: Deterministic (regex/rule, < 1ms)
        t0 = time.monotonic()
        self.checks.append(DeterministicGuards.check_pii(text))
        self.checks.append(DeterministicGuards.check_injection(text))
        self.checks.append(DeterministicGuards.check_scope(text))
        t1 = time.monotonic()

        for c in self.checks:
            c.latency_ms = (t1 - t0) * 1000

        if any(c.result == GuardResult.BLOCK for c in self.checks):
            return self.checks

        # Tier 2: Keyword classifier (no LLM)
        self.checks.append(ClassifierGuards.check_toxicity(text))

        return self.checks

    def is_allowed(self) -> bool:
        """Check if the input passes all guards."""
        return not any(c.result == GuardResult.BLOCK for c in self.checks)

    def blocked_reason(self) -> str:
        """Get the blocking reason if not allowed."""
        for c in self.checks:
            if c.result == GuardResult.BLOCK:
                return c.reason
        return ""


class OutputGuardPipeline:
    """Three-tier cascaded output filtering."""

    def __init__(self):
        self.checks: list[GuardCheck] = []

    async def check(self, response_text: str, response_dict: dict | None = None) -> list[GuardCheck]:
        """确定性输出过滤 (Tier 1 规则 + Tier 2 关键词, 无 LLM)."""
        self.checks = []

        # Tier 1: Deterministic format check
        if response_dict:
            schema = {
                "required": ["diagnosis", "tutoring", "code_quality"]
            }
            self.checks.append(DeterministicGuards.check_output_schema(response_dict, schema))

        # Tier 2: Keyword classifier (no LLM)
        self.checks.append(ClassifierGuards.check_toxicity(response_text))

        return self.checks

    def is_allowed(self) -> bool:
        return not any(c.result == GuardResult.BLOCK for c in self.checks)


# ============================================================================
# Degradation Strategy
# ============================================================================

class DegradationStrategy:
    """Graceful degradation when all tools or LLM calls fail."""

    DEGRADATION_LEVELS = {
        0: "full_functionality",
        1: "no_tools_text_only",      # Tools unavailable → text-only response
        2: "cached_knowledge_only",    # LLM unavailable → cached knowledge
        3: "static_fallback",          # Everything unavailable → static message
    }

    @staticmethod
    def degrade(level: int, user_message: str = "") -> str:
        """Return appropriate degraded response based on severity level."""
        responses = {
            1: "I can provide general guidance based on OS concepts, but cannot run code analysis right now. " + \
               "Please try again later or check the experiment instructions for hints.",
            2: "I'm having trouble accessing my knowledge base right now. Here are some general OS debugging tips:\n" + \
               "- Check your system call return values\n- Use strace to trace syscall behavior\n- Verify resource cleanup (free/close)\n" + \
               "Please try asking again in a moment.",
            3: "I'm currently unavailable. Your experiment data is safe. Please refresh the page and try again, " + \
               "or contact your instructor if the issue persists.",
        }
        return responses.get(level, responses[3])


# ============================================================================
# Ratchet Error Pattern Library
# ============================================================================

@dataclass
class ErrorPattern:
    """A single error pattern in the Ratchet library.

    Each pattern was created because of a real production failure.
    Patterns are never removed — only deprecated when model capabilities
    have clearly obsoleted them.
    """
    pattern_id: str
    error_type: str
    description: str
    detection_rule: str  # regex or keyword
    resolution: str
    source_event: str    # link to the failure that created this pattern
    created_at: str
    deprecated: bool = False
    deprecation_reason: str = ""


class RatchetErrorKB:
    """Accumulating error pattern knowledge base.

    Grows over time through real failures. Each entry is traceable to the
    specific event that created it. Patterns are audited quarterly.
    """

    def __init__(self):
        self._patterns: dict[str, ErrorPattern] = {}
        self._initialize_defaults()

    def _initialize_defaults(self):
        """Seed with known error patterns from TraceOS history."""
        now = datetime.now(timezone.utc).isoformat()
        defaults = [
            ErrorPattern("E001", "deadlock", "Student code has unmatched lock/unlock pairs",
                        r"pthread_mutex_lock.*\n(?!.*pthread_mutex_unlock)", "Check all code paths for missing unlock",
                        "2026-04-02: student reported deadlock not detected", now,
                        deprecated=False),
            ErrorPattern("E002", "memory_leak", "malloc without corresponding free",
                        r"malloc\s*\(.*\)\s*;(?![.\n]*free\s*\()", "Use valgrind to trace allocations",
                        "2026-04-05: memory leak in process experiment", now),
            ErrorPattern("E003", "fd_leak", "open without close in error path",
                        r"open\s*\(.*\).*\n.*return\s+-1", "Check error handling paths for close()",
                        "2026-04-08: fd leak in file I/O experiment", now),
            ErrorPattern("E004", "race_condition", "Shared variable access without synchronization",
                        r"(?!pthread_mutex)\w+\s*=\s*\w+\s*\+", "Add mutex around shared variable access",
                        "2026-04-10: race condition in sync experiment", now),
        ]
        for p in defaults:
            self._patterns[p.pattern_id] = p

    def add_pattern(self, pattern: ErrorPattern):
        self._patterns[pattern.pattern_id] = pattern
        logger.info("Ratchet: added error pattern %s from %s", pattern.pattern_id, pattern.source_event)

    def match(self, code: str) -> list[ErrorPattern]:
        """Find matching error patterns in student code."""
        matches = []
        for p in self._patterns.values():
            if p.deprecated:
                continue
            if re.search(p.detection_rule, code):
                matches.append(p)
        return matches

    def get_all(self) -> list[ErrorPattern]:
        return [p for p in self._patterns.values() if not p.deprecated]

    def audit_deprecations(self):
        """Quarterly audit: mark stale patterns as deprecated."""
        pass  # Manual review process


# ============================================================================
# Singleton
# ============================================================================

_input_guard = InputGuardPipeline()
_output_guard = OutputGuardPipeline()
_ratchet_kb = RatchetErrorKB()


def get_input_guard() -> InputGuardPipeline:
    return _input_guard


def get_output_guard() -> OutputGuardPipeline:
    return _output_guard


def get_ratchet_kb() -> RatchetErrorKB:
    return _ratchet_kb
