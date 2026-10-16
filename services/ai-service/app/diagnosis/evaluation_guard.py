"""评估治理校验 (Phase 5)

EvaluationGuard: 置信度/一致性/安全约束检查
SafetyFilter: 完整解答泄漏检测 + 截断
CalibrationMonitor: 校准漂移监控 (κ 季度跟踪)
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from typing import Any

from app.diagnosis.agents.base import AgentResult
from app.diagnosis.agents.report_generator import DiagnosisReport

logger = logging.getLogger(__name__)


@dataclass
class GuardResult:
    """治理校验结果."""
    passed: bool
    confidence_ok: bool
    agreement_ok: bool
    safety_ok: bool
    degraded: bool = False
    degradation_reason: str = ""
    review_required: bool = False
    review_reason: str = ""
    safety_warnings: list[str] = None

    def __post_init__(self):
        if self.safety_warnings is None:
            self.safety_warnings = []


class EvaluationGuard:
    """评估治理校验器 — 检查报告质量 (置信度 + 安全, 无评分偏差)."""

    CONFIDENCE_THRESHOLD = 0.6
    SAFETY_SOLUTION_CODE_RATIO = 0.8  # 解答代码占比阈值

    async def check(
        self,
        report: DiagnosisReport,
        agent_results: list[AgentResult],
    ) -> GuardResult:
        """执行全部治理检查."""
        warnings = []
        confidence_ok = True
        safety_ok = True

        # 1. 置信度检查
        if report.confidence < self.CONFIDENCE_THRESHOLD:
            confidence_ok = False
            warnings.append(f"置信度过低 ({report.confidence:.2f} < {self.CONFIDENCE_THRESHOLD})")

        # 2. 安全约束: 完整解答泄漏检测
        safety_result = SafetyFilter().check_report(report)
        if not safety_result["safe"]:
            safety_ok = False
            warnings.extend(safety_result["warnings"])
            # 截断泄漏内容
            if safety_result.get("truncated_fields"):
                _truncate_safety_violations(report, safety_result["truncated_fields"])

        # 3. 综合判断
        passed = confidence_ok and safety_ok
        review_required = not confidence_ok or not safety_ok
        review_reason = "; ".join(warnings) if warnings else ""

        # 4. 极低置信度 → 降级
        degraded = report.confidence < 0.4
        degradation_reason = ""
        if degraded:
            degradation_reason = f"置信度过低 ({report.confidence:.2f}), 建议人工复审"

        result = GuardResult(
            passed=passed,
            confidence_ok=confidence_ok,
            agreement_ok=True,
            safety_ok=safety_ok,
            degraded=degraded,
            degradation_reason=degradation_reason,
            review_required=review_required,
            review_reason=review_reason,
            safety_warnings=safety_result.get("warnings", []),
        )

        if not passed:
            logger.warning("EvaluationGuard check FAILED: %s", review_reason)

        return result


# ---------------------------------------------------------------------------
# SafetyFilter — 完整解答泄漏检测 + 截断
# ---------------------------------------------------------------------------
class SafetyFilter:
    """检测诊断报告中是否泄露了完整解答代码."""

    # 解答代码的典型信号: 多行连续的 C 代码 (含 main 函数)
    SOLUTION_CODE_PATTERN = re.compile(
        r"(int\s+main\s*\([^)]*\)\s*\{.*?return\s+0?\s*;)",
        re.DOTALL,
    )
    # 解答代码的简短信号: 完整函数定义 (非片段提示)
    FULL_FUNCTION_PATTERN = re.compile(
        r"(?:void|int|char|struct\s+\w+|size_t)\s+\w+\s*\([^)]*\)\s*\{[^}]{100,}\}",
        re.DOTALL,
    )

    def check_report(self, report: DiagnosisReport) -> dict:
        """检查报告所有文本字段中是否含完整解答."""
        warnings = []
        truncated_fields = []

        # 检查 summary
        if self._contains_solution_code(report.summary):
            warnings.append("summary 含完整解答代码信号")
            truncated_fields.append(("summary", report.summary))

        # 检查 suggested_fixes 中的 code_snippet
        for fix in report.suggested_fixes:
            if isinstance(fix, dict):
                desc = fix.get("description", "")
                ev = fix.get("evidence", "")
                if self._contains_solution_code(desc):
                    warnings.append("suggested_fixes 描述含完整解答代码")
                    truncated_fields.append(("suggested_fix", fix))
                if self._contains_solution_code(ev):
                    warnings.append("suggested_fixes 证据含完整解答代码")
                    truncated_fields.append(("suggested_fix_evidence", fix))

        # 检查 findings 中的 description
        for ar in report.agent_results:
            for finding in ar.findings:
                desc = finding.get("description", "") if isinstance(finding, dict) else ""
                if self._contains_solution_code(desc):
                    warnings.append(f"{ar.agent_name} finding 含完整解答代码")
                    truncated_fields.append(("agent_finding", finding))

        safe = len(warnings) == 0
        return {"safe": safe, "warnings": warnings, "truncated_fields": truncated_fields}

    def _contains_solution_code(self, text: str) -> bool:
        """检测文本中是否含完整解答代码."""
        if not text or len(text) < 50:
            return False
        # 检测 main 函数 + return 0 的完整模式
        if self.SOLUTION_CODE_PATTERN.search(text):
            # 额外检查: 代码长度 > 100 字符 (排除 1-2 行提示)
            match = self.SOLUTION_CODE_PATTERN.search(text)
            if match and len(match.group(1)) > 100:
                return True
        # 检测完整函数定义 (> 100 字符)
        if self.FULL_FUNCTION_PATTERN.search(text):
            return True
        return False

    def truncate_code(self, text: str, max_lines: int = 3) -> str:
        """截断过长代码为提示片段."""
        if not text:
            return text
        lines = text.strip().split("\n")
        if len(lines) <= max_lines:
            return text
        return "\n".join(lines[:max_lines]) + "\n// ... (已截断, 完整解答不可展示)"


def _truncate_safety_violations(report: DiagnosisReport, violations: list) -> None:
    """截断报告中的安全违规内容."""
    sf = SafetyFilter()
    for field_name, field_data in violations:
        if field_name == "summary":
            report.summary = sf.truncate_code(report.summary, max_lines=3)
        elif field_name in ("suggested_fix", "suggested_fix_evidence"):
            if isinstance(field_data, dict):
                if "description" in field_data:
                    field_data["description"] = sf.truncate_code(field_data["description"], max_lines=3)
                if "evidence" in field_data:
                    field_data["evidence"] = sf.truncate_code(field_data["evidence"], max_lines=3)
        elif field_name == "agent_finding":
            if isinstance(field_data, dict) and "description" in field_data:
                field_data["description"] = sf.truncate_code(field_data["description"], max_lines=3)


# ---------------------------------------------------------------------------
# CalibrationMonitor — 校准漂移监控
# ---------------------------------------------------------------------------
class CalibrationMonitor:
    """监控 Rubric 校准 drift (κ 季度跟踪)."""

    DRIFT_THRESHOLD = 0.05  # 季度 κ 波动超过 0.05 → 标记需修订

    async def check_drift(
        self,
        experiment_id: str,
        current_kappa: float,
    ) -> dict:
        """比较当前 κ 与历史 κ, 检测漂移."""
        try:
            from app.db.connection import get_pool
            pool = get_pool()

            # 获取历史 κ 值
            rows = await pool.fetch(
                "SELECT calibration_kappa, calibrated_at FROM experiment_rubrics "
                "WHERE experiment_id = $1 ORDER BY created_at DESC LIMIT 4",
                experiment_id,
            )

            if len(rows) < 2:
                return {"drift_detected": False, "reason": "历史数据不足"}

            historical_kappas = [float(r["calibration_kappa"]) for r in rows if r["calibration_kappa"]]
            if not historical_kappas:
                return {"drift_detected": False, "reason": "无历史 κ 值"}

            baseline_kappa = historical_kappas[-1]  # 最早的 κ 作为基线
            drift = abs(current_kappa - baseline_kappa)

            drift_detected = drift > self.DRIFT_THRESHOLD
            needs_revision = current_kappa < 0.41

            result = {
                "drift_detected": drift_detected,
                "drift_value": round(drift, 4),
                "baseline_kappa": baseline_kappa,
                "current_kappa": current_kappa,
                "needs_revision": needs_revision,
                "threshold": self.DRIFT_THRESHOLD,
            }

            if drift_detected:
                logger.warning(
                    "Calibration drift detected for %s: drift=%.4f > %.2f",
                    experiment_id, drift, self.DRIFT_THRESHOLD,
                )
                # 标记 rubric 需修订
                await self._mark_for_revision(experiment_id, drift)

            return result

        except Exception as e:
            logger.error("Calibration drift check failed: %s", e)
            return {"drift_detected": False, "error": str(e)}

    async def _mark_for_revision(self, experiment_id: str, drift: float) -> None:
        """在 DB 中标记 rubric 需修订."""
        try:
            from app.db.connection import get_pool
            pool = get_pool()
            await pool.execute(
                "UPDATE experiment_rubrics SET calibration_kappa = -1 "
                "WHERE experiment_id = $1 AND is_active = TRUE",
                experiment_id,
            )
        except Exception as e:
            logger.error("Failed to mark rubric for revision: %s", e)


# ---------------------------------------------------------------------------
# Fallback Chain — 降级策略链 (LLM → 规则引擎 → 模板诊断)
# ---------------------------------------------------------------------------
class FallbackChain:
    """三级降级策略: LLM → 规则引擎 → 模板诊断."""

    LEVEL_LLM = 0
    LEVEL_RULE = 1
    LEVEL_TEMPLATE = 2

    async def get_diagnosis(
        self,
        ctx: "Any",
        llm_diagnosis: "Any" = None,
    ) -> tuple[Any, int]:
        """按优先级返回诊断结果及其降级等级.

        Returns:
            (diagnosis_result, fallback_level)
        """
        # Level 0: LLM 诊断 (如有且有效)
        if llm_diagnosis and llm_diagnosis.confidence >= 0.4:
            return llm_diagnosis, self.LEVEL_LLM

        # Level 1: 规则引擎诊断
        rule_result = self._rule_engine_diagnosis(ctx)
        if rule_result.confidence >= 0.5:
            return rule_result, self.LEVEL_RULE

        # Level 2: 模板诊断
        template_result = self._template_diagnosis(ctx)
        return template_result, self.LEVEL_TEMPLATE

    def _rule_engine_diagnosis(self, ctx) -> Any:
        """基于确定性观测事实生成诊断报告 (无分数)."""
        from app.diagnosis.agents.report_generator import DiagnosisReport
        from app.diagnosis.deterministic import extract_observations, derive_severity

        obs = extract_observations(ctx)

        report = DiagnosisReport(
            submission_id=ctx.submission_id,
            student_id=ctx.student_id,
            experiment_id=ctx.experiment_id,
            experiment_category=ctx.experiment_category,
            degraded=True,
            degradation_reason="降级到规则引擎诊断",
        )
        report.is_qualified = obs.is_qualified
        report.core_score = obs.core_score
        report.edge_score = obs.edge_score
        report.severity = derive_severity(obs.is_qualified, obs)
        report.observations = obs.to_dict()
        report.confidence = 0.5

        # 规则引擎生成弱点 (基于观测事实)
        if obs.fd_leak > 0:
            report.weakness_points.append(f"文件描述符泄漏 {obs.fd_leak} 个 (规则引擎检测)")
        if obs.mmap_munmap_diff > 0:
            report.weakness_points.append("内存分配未完全释放 (规则引擎检测)")
        if obs.fork_wait_diff > 0:
            report.weakness_points.append(f"{obs.fork_wait_diff} 个子进程未回收 (规则引擎检测)")
        if obs.compile_error:
            report.weakness_points.append(f"编译错误: {obs.compile_error[:200]}")

        qualified = "达标" if obs.is_qualified else "未达标"
        report.summary = f"规则引擎诊断: 合格判定 {qualified} (降级模式)"
        report.feedback_levels = {
            "level_1": report.summary,
            "level_2": "；".join(report.weakness_points) or "未发现明显运行时观测异常",
            "level_3": "请对照实验要求检查关键功能实现。",
        }
        report.status = "degraded"

        return report

    def _template_diagnosis(self, ctx) -> Any:
        """最终兜底: 模板诊断."""
        from app.diagnosis.agents.report_generator import DiagnosisReport

        report = DiagnosisReport(
            submission_id=ctx.submission_id,
            student_id=ctx.student_id,
            experiment_id=ctx.experiment_id,
            experiment_category=ctx.experiment_category,
            degraded=True,
            degradation_reason="降级到模板诊断",
        )

        status = ctx.score_breakdown.get("status", "")
        if ctx.compile_error:
            report.summary = "您的代码存在编译错误,请检查语法和头文件引用后重新提交。"
            report.weakness_points = ["编译错误", "请检查语法"]
        elif status in ("runtime_error", "timeout"):
            report.summary = "您的代码在运行时出现错误,请检查内存使用和边界条件。"
            report.weakness_points = ["运行时错误", "请检查边界条件"]
        else:
            report.summary = "诊断服务暂时不可用,请稍后重试或联系助教。"
            report.weakness_points = ["诊断不可用"]

        report.confidence = 0.3
        report.status = "degraded"
        report.is_qualified = bool(ctx.score_breakdown.get("is_qualified", False))

        return report
