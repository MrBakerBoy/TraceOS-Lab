"""CodeAnalyzerAgent — 代码质量诊断 (AST 模式 + LLM 混合评分)."""

from __future__ import annotations

import re
from typing import Any

from app.diagnosis.agents.base import AgentConfig, AgentResult, BaseSpecialistAgent
from app.diagnosis.prompts import CODE_ANALYZER_SYSTEM


class CodeAnalyzerAgent(BaseSpecialistAgent):
    name = "code_analyzer"
    required_context = ["code", "experiment_meta", "compile_error", "language"]

    def __init__(self) -> None:
        super().__init__(AgentConfig(name=self.name, temperature=0.1, max_tokens=4096))

    def _build_prompt(self, ctx_slice: dict[str, Any]) -> tuple[str, str]:
        user_parts = [self._format_context_block(ctx_slice)]
        if ctx_slice.get("_budget_exceeded"):
            user_parts.append("\n注意: 部分数据因预算限制被截断, 请基于现有数据尽力分析。")
        user = "\n\n".join(user_parts)
        return CODE_ANALYZER_SYSTEM, user

    def _parse_result(self, raw: str, ctx_slice: dict[str, Any]) -> AgentResult:
        # 编译错误短路: 直接产出编译层 finding
        compile_error = ctx_slice.get("compile_error", "")
        if compile_error and not ctx_slice.get("code"):
            return AgentResult.success(
                self.name,
                findings=[{
                    "type": "compile",
                    "severity": "critical",
                    "description": f"编译错误: {compile_error[:500]}",
                    "location": "编译阶段",
                    "evidence": compile_error[:200],
                }],
                confidence=0.95,
            )

        data = self._parse_json(raw)

        # 规则补充: 检测 fd 泄漏模式 (open 无 close)
        code = ctx_slice.get("code", "")
        rule_findings = self._check_leak_rules(code)
        data.setdefault("findings", []).extend(rule_findings)

        return AgentResult.success(
            self.name,
            findings=data.get("findings", []),
            evidence=[{"source": "llm+rules", "rule_findings": rule_findings}],
            confidence=float(data.get("confidence", 0.7)),
        )

    @staticmethod
    def _check_leak_rules(code: str) -> list[dict]:
        """规则引擎: 检测明显的 fd 泄漏模式."""
        findings = []
        # open(...) 调用后无就近 close(fd)
        open_count = len(re.findall(r"\b(?:open|openat|fopen)\s*\(", code))
        close_count = len(re.findall(r"\b(?:close|fclose)\s*\(", code))
        if open_count > 0 and close_count < open_count:
            diff = open_count - close_count
            findings.append({
                "type": "leak",
                "severity": "warning",
                "description": f"检测到 {open_count} 次 open 调用但仅 {close_count} 次 close, 可能存在 fd 泄漏",
                "location": "全局",
                "evidence": f"open={open_count}, close={close_count}, diff={diff}",
            })
        return findings
