"""SyscallAnalyzerAgent — 系统调用行为诊断 (规则优先 + LLM 补充)."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.diagnosis.agents.base import AgentConfig, AgentResult, BaseSpecialistAgent
from app.diagnosis.deterministic import (
    detect_fd_leak,
    detect_memory_imbalance,
    detect_process_zombie,
)
from app.diagnosis.prompts import SYSCALL_ANALYZER_SYSTEM

logger = logging.getLogger(__name__)


class SyscallAnalyzerAgent(BaseSpecialistAgent):
    name = "syscall_analyzer"
    required_context = ["strace_summary", "patterns", "fd_balance", "memory_balance",
                         "process_balance", "code"]

    def __init__(self) -> None:
        super().__init__(AgentConfig(name=self.name, temperature=0.1, max_tokens=4096))

    def _build_prompt(self, ctx_slice: dict[str, Any]) -> tuple[str, str]:
        user = self._format_context_block(ctx_slice)
        return SYSCALL_ANALYZER_SYSTEM, user

    def _parse_result(self, raw: str, ctx_slice: dict[str, Any]) -> AgentResult:
        # 无 strace 数据 → skip
        strace = ctx_slice.get("strace_summary", "")
        if not strace:
            return AgentResult.skipped(self.name, "无 strace 数据")

        data = self._parse_json(raw)

        # 规则补充: 确定性观测 (泄漏/僵尸检测, 非分数)
        fd_desc = ctx_slice.get("fd_balance", "{}")
        mem_desc = ctx_slice.get("memory_balance", "{}")
        proc_desc = ctx_slice.get("process_balance", "{}")

        fd_bal = self._safe_json(fd_desc)
        mem_bal = self._safe_json(mem_desc)
        proc_bal = self._safe_json(proc_desc)

        fd_leak, fd_detail = detect_fd_leak(fd_bal)
        mem_diff, _ = detect_memory_imbalance(mem_bal)
        proc_diff, _ = detect_process_zombie(proc_bal)

        # 若规则发现泄漏/僵尸, 补充 findings
        if fd_leak > 0:
            data.setdefault("findings", []).insert(0, {
                "category": "fd_leak",
                "title": "FD 泄漏 (规则引擎检测)",
                "description": f"open={fd_detail.get('open', 0)}, close={fd_detail.get('close', 0)}, 泄漏={fd_leak}",
                "related_syscalls": ["openat", "close"],
                "evidence": f"确定性观测: {fd_detail}",
            })
        if mem_diff > 0:
            data.setdefault("findings", []).append({
                "category": "memory_leak",
                "title": "内存泄漏 (规则引擎检测)",
                "description": "mmap 与 munmap 计数不平衡",
                "evidence": str(mem_bal),
            })
        if proc_diff > 0:
            data.setdefault("findings", []).append({
                "category": "zombie",
                "title": "子进程未回收 (规则引擎检测)",
                "description": "fork 与 wait 数量不平衡",
                "evidence": str(proc_bal),
            })

        return AgentResult.success(
            self.name,
            findings=data.get("findings", []),
            evidence=[{"source": "deterministic", "fd_leak": fd_leak, "mem_diff": mem_diff, "proc_diff": proc_diff}],
            confidence=float(data.get("confidence", 0.6)),
        )

    @staticmethod
    def _safe_json(s: str) -> dict:
        if not s or s == "None":
            return {}
        try:
            return json.loads(s) if isinstance(s, str) else (s or {})
        except (json.JSONDecodeError, TypeError):
            return {}
