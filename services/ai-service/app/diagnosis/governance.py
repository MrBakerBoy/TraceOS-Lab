"""治理层 (Governance)

四大职责:
  1. 输入护栏 — 代码注入检测 / 实验范围校验 / PII 检测
  2. 输出护栏 — 完整解答泄漏检测 / 幻觉检测 / 格式校验
  3. 降级策略 — LLM 失败 → 规则引擎 → 预置诊断模板
  4. Ratchet 规则积累 — 每次 Agent 犯错 → 永久规则/检查/门禁

设计原则:
  - 机械执行 > Prompt 指令 (Stripe Blueprint)
  - Harness 只会收紧，不会放松 (Mitchell Hashimoto Ratchet)
  - 每个规则可追溯到具体失败事件 + 日期
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


# ============================================================================
# 输入护栏 — Input Guard
# ============================================================================

# 代码注入模式 (检测常见注入/恶意代码)
INJECTION_PATTERNS: list[tuple[str, str]] = [
    (r"\bsystem\s*\(.*rm\s+-rf", "危险系统调用: rm -rf"),
    (r"\bsystem\s*\(.*curl", "危险系统调用: curl 下载"),
    (r"\bsystem\s*\(.*wget", "危险系统调用: wget 下载"),
    (r"\bsystem\s*\(.*nc\s+-[el]", "网络滥用: netcat 反向shell"),
    (r"\bsystem\s*\(.*/dev/tcp", "网络滥用: /dev/tcp 反向shell"),
    (r"while\s*\(\s*1\s*\).*fork", "fork bomb 检测"),
    (r":\s*\(\s*\)\s*\{\s*:\|:&\s*\}\s*;\s*:", "fork bomb shell"),
    (r"for\s*\(.*;.*;.*\).*malloc\(.*1024\*1024\*", "内存耗尽攻击"),
    (r"while\s*\(.*\).*write\s*\(.*\).*while", "无限写入攻击"),
]

PII_PATTERNS: list[tuple[str, str]] = [
    (r"\b\d{17}[\dXx]\b", "身份证号"),
    (r"\b1[3-9]\d{9}\b", "手机号"),
    (r"\b[\w.-]+@[\w.-]+\.\w+\b", "邮箱 (硬编码)"),
]


@dataclass
class InputGuardResult:
    passed: bool = True
    violations: list[dict[str, str]] = field(default_factory=list)
    warnings: list[dict[str, str]] = field(default_factory=list)
    code_truncated: bool = False
    truncated_code: str = ""


@dataclass
class OutputGuardResult:
    passed: bool = True
    violations: list[dict[str, str]] = field(default_factory=list)
    filtered_output: str = ""
    safety_warning_triggered: bool = False
    full_answer_leaked: bool = False
    hallucination_score: float = 1.0


def check_code_injection(code: str) -> InputGuardResult:
    result = InputGuardResult()
    if not code:
        return result
    if len(code) > 50_000:
        result.violations.append({
            "rule": "code_size_limit", "severity": "warning",
            "description": f"代码过长 ({len(code)} bytes), 超过 50KB 限制, 将截断",
        })
        result.code_truncated = True
        result.truncated_code = code[:50_000]
        code = result.truncated_code
    for pattern, desc in INJECTION_PATTERNS:
        matches = re.findall(pattern, code, re.IGNORECASE)
        if matches:
            result.violations.append({
                "rule": "code_injection", "severity": "critical",
                "pattern": pattern, "description": desc,
                "matches": len(matches),
            })
            result.passed = False
    for pattern, desc in PII_PATTERNS:
        matches = re.findall(pattern, code)
        if matches:
            result.warnings.append({
                "rule": "pii_detection", "severity": "warning",
                "pattern": desc,
                "description": f"代码中可能包含{desc}, 已标记",
                "matches": len(matches),
            })
    return result


def check_experiment_scope(code: str, category: str) -> list[dict[str, str]]:
    ALLOWED_SYSCALLS = {
        "scheduler": ["fork", "exec", "wait", "kill", "signal", "getpid", "sleep", "usleep"],
        "process": ["fork", "exec", "wait", "waitpid", "getpid", "getppid", "pipe", "dup", "dup2"],
        "thread": ["pthread_create", "pthread_join", "pthread_mutex", "pthread_cond", "pthread_barrier"],
        "memory": ["malloc", "free", "calloc", "realloc", "mmap", "munmap", "brk", "sbrk", "mprotect"],
        "fs": ["open", "close", "read", "write", "lseek", "stat", "fstat", "fcntl", "unlink", "mkdir"],
        "deadlock": ["pthread_mutex_lock", "pthread_mutex_unlock", "pthread_mutex_trylock"],
    }
    allowed = ALLOWED_SYSCALLS.get(category, [])
    if not allowed:
        return []
    violations = []
    for name in ALLOWED_SYSCALLS.values():
        for sc in name:
            if sc not in allowed and sc in code:
                violations.append({
                    "rule": "scope_violation", "severity": "info",
                    "syscall": sc,
                    "description": f"{sc} 不在 {category} 实验的预期系统调用范围内",
                })
    return violations


# ============================================================================
# 输出护栏 — Output Guard
# ============================================================================

FULL_ANSWER_PATTERNS: list[tuple[str, str]] = [
    (r"```\w*\n[\s\S]{200,}\n```", "完整代码块 (>200字符)"),
    (r"#include\s*<.*>\s*\n.*\bint\s+main\s*\(.*\).*\{[\s\S]{100,}\}", "完整可编译 main 函数"),
    (r"替换[为成]以下代码", "直接给出替换代码"),
    (r"正确的代码[是如]", "直接给答案的句式"),
    (r"完整[的解]?[答方]?案", "完整解答关键词"),
]

LEGIT_GUIDANCE_PATTERNS: list[str] = [
    r"(?i)(检查|排查|思考|考虑|尝试|建议|提示)",
    r"(?i)(你可能?遗漏了|忘记|忽略)",
    r"(?i)(参考|复习|回顾).*[知概]念",
    r"(?i)(问[题为].*在哪|为什么.*错误|怎么.*改进)",
]


def check_answer_leak(output: str) -> OutputGuardResult:
    result = OutputGuardResult()
    if not output:
        return result
    for pattern, desc in FULL_ANSWER_PATTERNS:
        matches = re.findall(pattern, output, re.DOTALL)
        if matches:
            result.violations.append({
                "rule": "answer_leak", "severity": "critical",
                "pattern": desc,
                "description": f"诊断可能泄露了完整解答: {desc}",
            })
            result.passed = False
            result.full_answer_leaked = True
    guidance_score = 0
    for pattern in LEGIT_GUIDANCE_PATTERNS:
        if re.search(pattern, output):
            guidance_score += 1
    code_blocks = re.findall(r"```[\s\S]*?```", output)
    if len(code_blocks) > 2 and guidance_score < 2:
        result.warnings.append({
            "rule": "excessive_code", "severity": "warning",
            "description": f"诊断包含 {len(code_blocks)} 个代码块但引导语不足, 可能存在过度泄露",
        })
    if result.full_answer_leaked:
        filtered = re.sub(r"```[\s\S]*?```", "[代码已截断 - 防止完整解答泄露]", output)
        result.filtered_output = filtered
        result.safety_warning_triggered = True
        logger.warning("Answer leak detected and filtered: %d violations", len(result.violations))
    else:
        result.filtered_output = output
    return result


def check_hallucination(output: str, reference_data: dict[str, Any] | None = None) -> float:
    if not output:
        return 1.0
    REAL_SYSCALLS = {
        "read", "write", "open", "openat", "close", "stat", "fstat", "lstat",
        "lseek", "mmap", "munmap", "mprotect", "brk", "sbrk",
        "fork", "vfork", "execve", "execveat", "wait4", "waitpid",
        "kill", "signal", "sigaction", "sigreturn",
        "clone", "exit", "exit_group",
        "socket", "bind", "listen", "accept", "connect",
        "pipe", "pipe2", "dup", "dup2", "dup3",
        "ioctl", "fcntl", "poll", "select", "epoll_create", "epoll_ctl", "epoll_wait",
        "futex", "nanosleep", "clock_gettime",
        "gettid", "getpid", "getppid", "getuid", "getgid",
        "pthread_create", "pthread_join", "pthread_mutex_lock", "pthread_mutex_unlock",
        "malloc", "free", "calloc", "realloc",
    }
    score = 1.0
    quoted = re.findall(r"\"([a-z_][a-z0-9_]*(?:\s*\(\))?)\"", output)
    backtick = re.findall(r"`([a-z_][a-z0-9_]*(?:\s*\(\))?)`", output)
    all_quoted = set(quoted + backtick)
    fake_count = 0
    for term in all_quoted:
        term_clean = term.replace("()", "").strip()
        if (len(term_clean) > 3 and "_" in term_clean and
            term_clean not in REAL_SYSCALLS and
            re.match(r"^[a-z_][a-z0-9_]*$", term_clean)):
            fake_count += 1
    if fake_count > 0:
        score -= min(0.5, fake_count * 0.1)
    overconfidence = re.findall(
        r"(一定是|绝对[是存在]|100%|毫无疑问|显然|明显是)", output,
    )
    if len(overconfidence) > 2:
        score -= 0.15
    return max(0.0, round(score, 2))


# ============================================================================
# 降级策略 — Degradation
# ============================================================================

class DegradationLevel:
    FULL_AGENT = "full_agent"
    SINGLE_LLM = "single_llm"
    RULE_ENGINE = "rule_engine"
    TEMPLATE = "template"


@dataclass
class DegradationDecision:
    level: str
    reason: str
    triggered_by: str
    template_name: str = ""
    rule_scores: dict[str, Any] = field(default_factory=dict)


def decide_degradation(
    llm_error: Exception | None = None,
    injection_violation: bool = False,
    timeout: bool = False,
    agent_confidence: float = 0.0,
    total_elapsed_ms: int = 0,
) -> DegradationDecision:
    if injection_violation:
        return DegradationDecision(
            level=DegradationLevel.TEMPLATE,
            reason="代码注入检测触发, 拒绝 LLM 分析",
            triggered_by="injection",
            template_name="injection_blocked",
        )
    if timeout or total_elapsed_ms > 30_000:
        return DegradationDecision(
            level=DegradationLevel.RULE_ENGINE,
            reason=f"诊断超时 ({total_elapsed_ms}ms), 降级到规则引擎",
            triggered_by="timeout",
        )
    if llm_error:
        return DegradationDecision(
            level=DegradationLevel.RULE_ENGINE,
            reason=f"LLM 调用失败: {llm_error}",
            triggered_by="llm_failure",
        )
    if agent_confidence < 0.4:
        return DegradationDecision(
            level=DegradationLevel.RULE_ENGINE,
            reason=f"Agent 置信度过低 ({agent_confidence:.2f}), 降级到规则引擎",
            triggered_by="low_confidence",
        )
    return DegradationDecision(
        level=DegradationLevel.FULL_AGENT, reason="正常流程", triggered_by="none",
    )


TEMPLATE_LIBRARY: dict[str, dict[str, Any]] = {
    "injection_blocked": {
        "summary": "检测到代码中包含不安全内容，诊断已中止。请提交规范的实验代码。",
        "strength_points": [], "weakness_points": ["代码包含不安全内容"],
        "suggested_fixes": [], "confidence": 1.0,
        "requires_review": True, "review_reason": "注入触发",
        "scores": {"correctness": 0, "completeness": 0, "concept": 0,
                   "code_quality": 0, "runtime_behavior": 0, "performance": 0},
    },
    "compile_error_default": {
        "summary": "代码编译失败，请检查语法错误后重新提交。",
        "strength_points": [], "weakness_points": ["编译失败 - 请检查语法和头文件"],
        "suggested_fixes": [
            {"title": "检查编译错误信息", "description": "根据编译器输出的错误信息逐条排查语法问题。", "priority": "high"},
        ],
        "confidence": 0.9, "requires_review": False,
    },
    "llm_failure_default": {
        "summary": "AI 诊断服务暂时不可用，请稍后重试。以下是基于规则引擎的自动检查结果。",
        "strength_points": [], "weakness_points": ["AI 诊断暂停 - 请稍后重试"],
        "suggested_fixes": [], "confidence": 0.3,
        "requires_review": True, "review_reason": "LLM 降级",
    },
}


def apply_template(template_name: str) -> dict[str, Any]:
    return TEMPLATE_LIBRARY.get(template_name, TEMPLATE_LIBRARY["llm_failure_default"])


# ============================================================================
# Ratchet 规则积累
# ============================================================================

@dataclass
class RatchetRule:
    rule_id: str
    category: str
    description: str
    check_function: str
    severity: str
    source_failure: str
    source_date: str
    source_diagnosis_id: str | None = None


_RATCHET_REGISTRY: list[RatchetRule] = []


def register_ratchet_rule(
    category: str, description: str, check_function: str,
    severity: str, source_failure: str,
    source_diagnosis_id: str | None = None,
) -> RatchetRule:
    now = datetime.now(timezone.utc).isoformat()
    rule = RatchetRule(
        rule_id=f"ratchet_{len(_RATCHET_REGISTRY):04d}",
        category=category, description=description,
        check_function=check_function, severity=severity,
        source_failure=source_failure, source_date=now,
        source_diagnosis_id=source_diagnosis_id,
    )
    _RATCHET_REGISTRY.append(rule)
    logger.info("Ratchet rule registered: %s [%s] <- %s",
                 rule.rule_id, rule.category, source_failure[:80])
    return rule


def get_active_ratchet_rules(category: str | None = None) -> list[RatchetRule]:
    if category:
        return [r for r in _RATCHET_REGISTRY if r.category == category]
    return list(_RATCHET_REGISTRY)


def _register_seed_rules() -> None:
    register_ratchet_rule(
        category="output_guard",
        description="诊断不得包含超过 200 字符的完整代码块",
        check_function="check_answer_leak", severity="critical",
        source_failure="2025-Q3 诊断中 LLM 直接输出完整可编译解答, 学生无需思考即获得答案",
    )
    register_ratchet_rule(
        category="output_guard",
        description="诊断中的确定性断言不得超过 2 处",
        check_function="check_hallucination", severity="warning",
        source_failure="2025-Q4 诊断将无限循环误判为死锁并以确定性口吻输出",
    )
    register_ratchet_rule(
        category="input_guard",
        description="单个提交代码不得超过 50KB",
        check_function="check_code_injection", severity="warning",
        source_failure="2025-Q3 学生提交 200KB 混淆代码导致 OOM",
    )
    register_ratchet_rule(
        category="evaluation",
        description="Evaluator 置信度 < 0.4 时必须触发人工复审",
        check_function="decide_degradation", severity="critical",
        source_failure="2026-Q1 回顾分析: confidence<0.4 的诊断中有 60% 包含显著错误",
    )


_register_seed_rules()
