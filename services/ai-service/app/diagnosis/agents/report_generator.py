"""ReportGeneratorAgent — 聚合各 Agent 产出 → 教学诊断报告.

无独立 LLM 调用 (纯聚合 + 模板); findings 不充分时调一次轻量 LLM 生成 summary。

红线: 不产出分数。报告只有诊断结论 + 教学建议 + 置信度 + Core 观测事实。
严重度与合格判定以 Core is_qualified 为唯一真值。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from app.diagnosis.agents.base import AgentResult, AgentStatus
from app.diagnosis.deterministic import Observations, derive_severity

logger = logging.getLogger(__name__)

AGENT_SOURCE_LABELS = {
    "code_analyzer": "代码分析（LLM+规则）",
    "test_evaluator": "测试结果分析（LLM）",
    "syscall_analyzer": "strace 观测（规则+LLM）",
    "resource_analyzer": "内核资源观测（eBPF）",
    "concept_rubric": "概念映射（规则）",
    "report_generator": "报告聚合",
}

AGENT_SOURCE_KIND = {
    "code_analyzer": "LLM+规则",
    "test_evaluator": "LLM",
    "syscall_analyzer": "观测+LLM",
    "resource_analyzer": "eBPF 观测",
    "concept_rubric": "规则",
    "report_generator": "聚合",
}

CATEGORY_ZH = {
    "structure": "代码结构不完整，核心功能实现缺失",
    "compile": "存在编译错误",
    "leak": "存在文件描述符/内存泄漏风险",
    "error_handling": "缺少必要的错误处理",
    "syscall": "系统调用使用不正确",
    "fd_leak": "文件描述符未正确释放",
    "memory_leak": "内存分配与释放不配对",
    "zombie": "子进程未正确回收",
    "race": "存在并发竞态风险",
    "unexpected_syscall": "出现不符合预期的系统调用",
    "order_issue": "系统调用顺序不正确",
    "runtime": "程序运行时行为异常",
    "output_match": "输出与预期不符",
    "coverage": "实验要求覆盖不完整",
    "concept": "OS 概念理解不足",
    "evaluation": "综合评分较低",
}


@dataclass
class DiagnosisReport:
    """最终诊断报告 (无分数)."""

    submission_id: str = ""
    student_id: str = ""
    experiment_id: str = ""
    experiment_category: str = ""
    status: str = "completed"
    trace_id: str = ""

    # Core 唯一真值 (透传, 非 AI 产出)
    is_qualified: bool = False
    core_score: float = 0.0
    edge_score: float = 0.0
    severity: str = "medium"

    # 确定性观测事实 (AI 诊断输入证据)
    observations: dict[str, Any] = field(default_factory=dict)

    # 诊断内容 (教学建议)
    summary: str = ""
    strength_points: list[str] = field(default_factory=list)
    weakness_points: list[str] = field(default_factory=list)
    related_concepts: list[str] = field(default_factory=list)
    related_syscalls: list[str] = field(default_factory=list)
    suggested_fixes: list[dict[str, Any]] = field(default_factory=list)
    feedback_levels: dict[str, str] = field(default_factory=dict)

    # 可视化 (仅概念达成度, 非分数)
    concept_radar: dict[str, Any] = field(default_factory=dict)

    # 校验元数据
    confidence: float = 0.0
    agent_agreement: float = 0.0
    requires_review: bool = False
    review_reason: str = ""

    # 成本
    llm_model: str = ""
    llm_tokens_used: int = 0

    # 各 Agent 结果
    agent_results: list[AgentResult] = field(default_factory=list)

    # 降级标记
    degraded: bool = False
    degradation_reason: str = ""

    def to_db_dict(self) -> dict[str, Any]:
        """用于 DB 仓储保存 (六维分数列与 total_score 已废弃, 写 0)."""
        return {
            "submission_id": self.submission_id,
            "student_id": self.student_id,
            "experiment_id": self.experiment_id,
            "trace_id": self.trace_id,
            "status": self.status,
            # 六维分数与总分已废弃, 不再产出
            "total_score": 0.0,
            "summary": self.summary,
            "strength_points": self.strength_points,
            "weakness_points": self.weakness_points,
            "related_concepts": self.related_concepts,
            "related_syscalls": self.related_syscalls,
            "suggested_fixes": self.suggested_fixes,
            "feedback_levels": self.feedback_levels,
            # 观测事实 + Core 真值复用 radar_data 列持久化
            "radar_data": {
                "observations": self.observations,
                "is_qualified": self.is_qualified,
                "core_score": self.core_score,
                "edge_score": self.edge_score,
                "severity": self.severity,
            },
            "concept_radar": self.concept_radar,
            "confidence_score": self.confidence,
            "agent_agreement_score": self.agent_agreement,
            "requires_review": self.requires_review,
            "review_reason": self.review_reason,
            "llm_model": self.llm_model,
            "llm_tokens_used": self.llm_tokens_used,
            "degraded": self.degraded,
            "degradation_reason": self.degradation_reason,
        }


class ReportGeneratorAgent:
    """无 LLM 调用的纯聚合报告生成器 (不产出分数)."""

    name = "report_generator"

    async def generate(
        self,
        agent_results: list[AgentResult],
        observations: Observations,
        ctx: Any,
        llm_summary: bool = False,
    ) -> DiagnosisReport:
        """聚合各 Agent 产出为最终教学诊断报告."""
        report = DiagnosisReport(
            submission_id=ctx.submission_id,
            student_id=ctx.student_id,
            experiment_id=ctx.experiment_id,
            experiment_category=ctx.experiment_category,
            agent_results=agent_results,
        )

        # Core 真值透传
        report.is_qualified = observations.is_qualified
        report.core_score = observations.core_score
        report.edge_score = observations.edge_score
        report.severity = derive_severity(observations.is_qualified, observations)
        report.observations = observations.to_dict()

        # 汇总 findings (strengths/weaknesses/fixes)
        all_findings = []
        for ar in agent_results:
            if ar.status != AgentStatus.COMPLETED.value:
                continue
            for f in ar.findings:
                f_with_agent = {**f, "_agent": ar.agent_name}
                all_findings.append(f_with_agent)

        report.strength_points = self._extract_strengths(observations)
        report.weakness_points = self._extract_weaknesses(all_findings)
        report.suggested_fixes = self._extract_fixes(all_findings)
        report.related_concepts = self._extract_concepts(all_findings, agent_results)
        report.related_syscalls = self._extract_syscalls(all_findings)
        report.concept_radar = self._extract_concept_radar(agent_results)

        # 三级反馈 (基于观测事实 + findings)
        report.feedback_levels = self._build_feedback_levels(report, observations, all_findings)

        # Summary
        report.summary = self._build_summary(report, observations)
        if (llm_summary and not report.summary) or len(report.summary) < 20:
            report.summary = await self._llm_fallback_summary(report, observations)

        # Token 统计
        report.llm_tokens_used = sum(ar.tokens_used for ar in agent_results)

        # 置信度/一致性聚合 (替代已删除的 EvaluatorAgent, 不产出分数)
        completed = [ar for ar in agent_results if ar.status == AgentStatus.COMPLETED.value]
        if completed:
            confidences = [ar.confidence for ar in completed]
            report.confidence = sum(confidences) / len(confidences)
            report.agent_agreement = (
                1.0 - (max(confidences) - min(confidences))
                if len(confidences) > 1 else 1.0
            )

        report.status = "completed"
        return report

    @staticmethod
    def _extract_strengths(obs: Observations) -> list[str]:
        """从确定性观测事实提取亮点 (非分数)."""
        strengths = []
        if obs.is_qualified:
            strengths.append("代码通过全部测试用例，达到实验要求。")
        elif obs.test_pass_rate >= 0.8:
            strengths.append(f"通过了 {obs.passed_cases}/{obs.total_cases} 个测试用例，完成度较高。")
        if obs.total_cases > 0 and obs.fd_leak == 0 and obs.fork_wait_diff == 0 and obs.mmap_munmap_diff == 0:
            strengths.append("未发现文件描述符泄漏、内存不平衡或僵尸进程，资源管理正确。")
        return strengths

    @staticmethod
    def _extract_concept_radar(agent_results: list[AgentResult]) -> dict[str, Any]:
        for ar in agent_results:
            if ar.agent_name == "concept_rubric" and ar.evidence:
                return ar.evidence[0].get("concept_radar", {})
        return {}

    @staticmethod
    def _agent_label(agent: str) -> str:
        return AGENT_SOURCE_LABELS.get(agent, agent or "unknown")

    @staticmethod
    def _source_kind(agent: str) -> str:
        return AGENT_SOURCE_KIND.get(agent, "unknown")

    @staticmethod
    def _has_chinese(text: str) -> bool:
        return any("\u4e00" <= ch <= "\u9fff" for ch in text or "")

    @staticmethod
    def _clean(text: str, limit: int = 160) -> str:
        if not text:
            return ""
        return str(text).replace("\r", " ").replace("\n", " ").strip()[:limit]

    @classmethod
    def _zh_title(cls, f: dict) -> str:
        title = f.get("title") or ""
        desc = f.get("description") or ""
        if title and cls._has_chinese(title):
            return cls._clean(title, 90)
        if desc and cls._has_chinese(desc):
            return cls._clean(desc, 90)
        category = f.get("category") or f.get("type") or "structure"
        return CATEGORY_ZH.get(category, "存在需要修复的问题")

    @classmethod
    def _zh_description(cls, f: dict) -> str:
        desc = f.get("description") or ""
        if desc and cls._has_chinese(desc):
            return cls._clean(desc, 300)
        title = f.get("title") or ""
        if title and cls._has_chinese(title):
            return cls._clean(title, 300)
        category = f.get("category") or f.get("type") or "structure"
        base = CATEGORY_ZH.get(category, "该项存在缺陷，建议对照实验要求检查实现。")
        evidence = f.get("evidence") or ""
        if evidence and cls._has_chinese(evidence):
            return f"{base}。证据：{cls._clean(evidence, 220)}"
        return f"{base}。请根据实验要求补充或修正对应实现。"

    def _extract_weaknesses(self, findings: list[dict]) -> list[str]:
        weaknesses = []
        for f in findings:
            sev = f.get("severity", "info")
            if sev in ("critical", "warning", "high"):
                agent = f.get("_agent", "")
                label = self._agent_label(agent)
                weaknesses.append(f"{label}：{self._zh_title(f)}")
        return weaknesses[:8]

    def _extract_fixes(self, findings: list[dict]) -> list[dict]:
        fixes = []
        priority_map = {"critical": "high", "high": "high", "warning": "medium", "info": "low"}
        for f in findings:
            sev = f.get("severity", "info")
            agent = f.get("_agent", "")
            fixes.append({
                "title": self._zh_title(f),
                "description": self._zh_description(f),
                "priority": priority_map.get(sev, "medium"),
                "evidence": self._clean(f.get("evidence", ""), 300),
                "source": agent,
                "source_label": self._agent_label(agent),
                "source_kind": self._source_kind(agent),
            })
        order = {"high": 0, "medium": 1, "low": 2}
        fixes.sort(key=lambda x: order.get(x["priority"], 3))
        return fixes[:10]

    def _extract_concepts(self, findings: list[dict], agent_results: list) -> list[str]:
        concepts = set()
        for f in findings:
            rc = f.get("related_concepts", [])
            if isinstance(rc, list):
                concepts.update(rc)
        for ar in agent_results:
            if ar.agent_name == "concept_rubric":
                for f in ar.findings:
                    for cs in f.get("concept_scores", []):
                        concepts.add(cs.get("concept", ""))
        return list(filter(None, concepts))

    def _extract_syscalls(self, findings: list[dict]) -> list[str]:
        syscalls = set()
        for f in findings:
            rs = f.get("related_syscalls", [])
            if isinstance(rs, list):
                syscalls.update(rs)
        return list(syscalls)

    def _findings_by_source(self, all_findings: list[dict]) -> dict[str, list[dict]]:
        observed = []
        semantic = []
        for f in all_findings:
            agent = f.get("_agent", "")
            if agent in ("syscall_analyzer", "resource_analyzer"):
                observed.append(f)
            else:
                semantic.append(f)
        return {"observed": observed, "semantic": semantic}

    def _build_feedback_levels(
        self,
        report: DiagnosisReport,
        obs: Observations,
        all_findings: list[dict],
    ) -> dict[str, str]:
        by_source = self._findings_by_source(all_findings)
        observed = by_source["observed"]
        semantic = by_source["semantic"]

        # L1: 基于 Core 合格判定 + 观测事实
        if obs.is_qualified:
            l1 = "代码已通过全部测试用例，达到实验要求。可以尝试更深入的理解，例如思考边界条件与内核态真实行为。"
        else:
            weak_parts = []
            if obs.fd_leak > 0:
                weak_parts.append(f"文件描述符泄漏 {obs.fd_leak} 个")
            if obs.fork_wait_diff > 0:
                weak_parts.append(f"{obs.fork_wait_diff} 个子进程未回收")
            if obs.mmap_munmap_diff > 0:
                weak_parts.append("内存分配未完全释放")
            if obs.compile_error:
                weak_parts.append("存在编译错误")
            if weak_parts:
                l1 = "本次提交未达标，重点问题：" + "、".join(weak_parts) + "。建议对照实验要求逐项修正。"
            else:
                l1 = "本次提交未达标，建议对照实验要求逐项补齐功能清单，并检查关键系统调用的正确性。"

        # L2: 观测证据
        if observed:
            obs_labels = []
            for f in observed[:2]:
                agent = f.get("_agent", "")
                obs_labels.append(f"{self._agent_label(agent)}：{self._zh_title(f)}")
            l2 = "观测证据（" + "；".join(obs_labels) + "）。"
        else:
            l2 = "当前没有发现明显的运行时观测异常，问题主要集中在代码逻辑与功能实现完整性。"

        # L3: 语义分析
        if semantic:
            sem_items = []
            for f in semantic[:3]:
                agent = f.get("_agent", "")
                sem_items.append(f"{self._agent_label(agent)}：{self._zh_title(f)}")
            l3 = "语义分析（" + "；".join(sem_items) + "）。"
        else:
            l3 = "请结合实验要求，检查关键函数是否真正实现，而不是只保留 TODO 或空实现。"

        # L4: 修复方向
        fix_titles = [self._zh_title(f) for f in report.suggested_fixes[:3]] or ["优先修复核心功能"]
        l4 = "修复方向：优先处理 " + "、".join(fix_titles[:3]) + "。"
        return {"level_1": l1, "level_2": l2, "level_3": l3, "level_4": l4}

    def _build_summary(self, report: DiagnosisReport, obs: Observations) -> str:
        if obs.is_qualified:
            parts = ["代码已通过全部测试用例，达到实验要求。"]
        else:
            parts = [f"本次提交未达标（通过 {obs.passed_cases}/{obs.total_cases} 个测试用例）。"]
        parts.append(f"置信度 {report.confidence:.0%}。")
        if report.weakness_points:
            parts.append("待改进：" + "；".join(report.weakness_points[:3]) + "。")
        if report.strength_points:
            parts.append("亮点：" + "；".join(report.strength_points[:2]) + "。")
        if report.requires_review:
            parts.append(f"注意：{report.review_reason}。")
        return " ".join(parts)

    async def _llm_fallback_summary(self, report: DiagnosisReport, obs: Observations) -> str:
        """轻量 LLM 生成 summary (兜底)."""
        try:
            from app.services.llm_client import get_llm_provider
            llm = get_llm_provider()
            qualified = "已达标" if obs.is_qualified else "未达标"
            user = (
                f"合格判定={qualified}, "
                f"测试通过={obs.passed_cases}/{obs.total_cases}, "
                f"观测={report.observations}, "
                f"弱点={report.weakness_points[:3]}, "
                f"建议={report.suggested_fixes[:3]}. "
                f"用中文写一句 50 字以内的诊断总结。"
            )
            resp = await llm.chat_completion(
                system_prompt="你是操作系统课程助教,用中文生成简短诊断总结(50字内)。",
                user_prompt=user,
                temperature=0.3,
                max_tokens=200,
            )
            return resp.content.strip() if resp.content else self._build_summary(report, obs)
        except Exception as e:
            logger.warning("LLM summary fallback failed: %s", e)
            return self._build_summary(report, obs)