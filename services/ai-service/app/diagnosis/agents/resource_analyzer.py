"""ResourceAnalyzerAgent — 内核资源观测解读 (Phase 2)

消费 Core 确定性抽取的 `ebpf_metrics` (resource / syscall / process_thread),
把内核级观测事实 (fd 泄漏、内存不平衡、僵尸进程、死锁) 翻译成学生能动手
修改的教学建议。规则优先 + LLM 补充; 不产出分数。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.diagnosis.agents.base import AgentConfig, AgentResult, BaseSpecialistAgent

logger = logging.getLogger(__name__)

RESOURCE_ANALYZER_SYSTEM = """你是 TraceOS 内核资源观测专家 (ResourceAnalyzer).

## 职责
基于 Core 确定性抽取的 `ebpf_metrics` (内核级观测事实) 分析学生程序的资源管理行为:
- fd_leak (open - close) → 文件描述符是否全部关闭
- memory_imbalance (alloc - free) → 内存分配/释放是否配对
- zombie (fork - wait) → 子进程是否被正确回收
- deadlock → 是否存在锁等待环

## Context Firewall 约束
你只能基于下方输入数据进行分析。不要编造未列出的数据。
如果某项指标为 0 或缺失, 视为「该维度未发现异常」, 不要臆造问题。

## 安全红线
绝不输出完整的可运行解答代码。以引导式提示为主。

## 输出 JSON schema
{"findings": [{"category": "fd_leak|memory_leak|zombie|deadlock", "severity": "critical|warning|info", "title": "内核级观测发现", "description": "面向学生的解读 (为什么这是问题、如何定位)", "related_concepts": ["文件描述符", "进程回收", ...], "evidence": "具体计数"}], "confidence": 0.8}

只输出 findings 与 confidence, 不输出任何分数。
"""


class ResourceAnalyzerAgent(BaseSpecialistAgent):
    name = "resource_analyzer"
    required_context = ["ebpf_metrics", "code", "experiment_meta"]

    def __init__(self) -> None:
        super().__init__(AgentConfig(name=self.name, temperature=0.2, max_tokens=4096))

    def _build_prompt(self, ctx_slice: dict[str, Any]) -> tuple[str, str]:
        user = self._format_context_block(ctx_slice)
        if not ctx_slice.get("ebpf_metrics"):
            user += "\n\n### ebpf_metrics\n[无内核观测数据]"
        return RESOURCE_ANALYZER_SYSTEM, user

    def _parse_result(self, raw: str, ctx_slice: dict[str, Any]) -> AgentResult:
        metrics = self._safe_json(ctx_slice.get("ebpf_metrics", "{}"))
        resource = metrics.get("resource", {}) or {}

        if not resource:
            return AgentResult.skipped(self.name, "无内核观测数据")

        data = self._parse_json(raw)

        # 规则优先: 确定性观测事实 (非分数)
        findings: list[dict[str, Any]] = list(data.get("findings", []))

        fd_leak = int(resource.get("fd_leak") or 0)
        mem_imbalance = int(resource.get("memory_imbalance") or 0)
        zombie = int(resource.get("zombie") or 0)
        deadlock = bool(resource.get("deadlock", False))

        if fd_leak > 0:
            findings.insert(0, {
                "category": "fd_leak",
                "severity": "warning",
                "title": "文件描述符泄漏 (内核观测)",
                "description": f"open 与 close 计数相差 {fd_leak}, 存在未关闭的文件描述符。请检查每个 open/openat/socket 是否有配对的 close。",
                "related_concepts": ["文件描述符", "资源释放"],
                "evidence": f"fd_leak={fd_leak}",
            })
        if mem_imbalance > 0:
            findings.insert(0, {
                "category": "memory_leak",
                "severity": "warning",
                "title": "内存分配未完全释放 (内核观测)",
                "description": f"内存分配与释放计数相差 {mem_imbalance}, 请检查 malloc/mmap 是否有配对的 free/munmap。",
                "related_concepts": ["内存管理", "内存泄漏"],
                "evidence": f"memory_imbalance={mem_imbalance}",
            })
        if zombie > 0:
            findings.insert(0, {
                "category": "zombie",
                "severity": "critical",
                "title": "子进程未回收 (僵尸进程风险)",
                "description": f"fork 与 wait 计数相差 {zombie}, 子进程退出后可能成为僵尸进程。请为每个 fork 的进程添加 wait/waitpid 回收。",
                "related_concepts": ["进程创建", "进程回收"],
                "evidence": f"zombie={zombie}",
            })
        if deadlock:
            findings.insert(0, {
                "category": "deadlock",
                "severity": "critical",
                "title": "检测到死锁 (锁等待环)",
                "description": "内核观测到锁等待环, 请检查加锁顺序与互斥锁配对。",
                "related_concepts": ["死锁", "互斥锁"],
                "evidence": "deadlock=true",
            })

        if not findings:
            return AgentResult.success(
                self.name,
                findings=[{
                    "category": "resource",
                    "severity": "info",
                    "title": "资源管理正常",
                    "description": "未发现文件描述符泄漏、内存不平衡、僵尸进程或死锁。",
                    "evidence": str(resource),
                }],
                evidence=[{"source": "ebpf_metrics"}],
                confidence=float(data.get("confidence", 0.8)),
            )

        return AgentResult.success(
            self.name,
            findings=findings,
            evidence=[{"source": "ebpf_metrics", "resource": resource}],
            confidence=float(data.get("confidence", 0.8)),
        )

    @staticmethod
    def _safe_json(s: str | Any) -> dict:
        if not s or s == "None":
            return {}
        if isinstance(s, dict):
            return s
        try:
            return json.loads(s) if isinstance(s, str) else (s or {})
        except (json.JSONDecodeError, TypeError):
            return {}