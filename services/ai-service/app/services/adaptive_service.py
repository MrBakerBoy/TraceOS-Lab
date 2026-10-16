"""Adaptive difficulty service — AI-enhanced difficulty adjustment."""

import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class AdaptiveService:
    """AI-powered adaptive difficulty suggestions."""

    def __init__(self, llm_client=None):
        self.llm = llm_client

    async def analyze_learning_curve(
        self,
        student_id: str,
        category_scores: dict,
        recent_submissions: list,
    ) -> dict:
        """Analyze student learning curve and suggest adjustments.

        Returns:
            {
                "trend": "improving" | "plateau" | "declining",
                "suggestion": "难度调整建议",
                "recommended_action": "upgrade" | "downgrade" | "maintain",
                "confidence": 0.0-1.0,
                "explanation": "详细分析",
            }
        """
        # Rule-based fallback (works without LLM)
        if len(recent_submissions) < 3:
            return {
                "trend": "insufficient_data",
                "suggestion": "数据不足，保持当前难度",
                "recommended_action": "maintain",
                "confidence": 0.5,
                "explanation": "提交次数不足3次，无法判断趋势",
            }

        recent_scores = [s.get("score", 0) for s in recent_submissions[-5:]]
        if not recent_scores:
            return {
                "trend": "no_data",
                "suggestion": "无评分数据",
                "recommended_action": "maintain",
                "confidence": 0.3,
                "explanation": "",
            }

        # Simple trend detection
        if len(recent_scores) >= 3:
            last3 = recent_scores[-3:]
            if all(s >= 90 for s in last3):
                trend = "improving"
                action = "upgrade"
                suggestion = "连续3次高分，建议提升难度"
                confidence = 0.85
            elif all(s < 50 for s in last3):
                trend = "declining"
                action = "downgrade"
                suggestion = "连续3次低分，建议降低难度以巩固基础"
                confidence = 0.85
            elif last3[0] < last3[-1]:
                trend = "improving"
                action = "maintain"
                suggestion = "成绩呈上升趋势，保持当前难度"
                confidence = 0.6
            elif last3[0] > last3[-1]:
                trend = "declining"
                action = "maintain"
                suggestion = "成绩呈下降趋势，建议回顾基础知识后再尝试"
                confidence = 0.6
            else:
                trend = "plateau"
                action = "maintain"
                suggestion = "成绩稳定，可以继续练习或尝试更高难度"
                confidence = 0.5
        else:
            trend = "insufficient_data"
            action = "maintain"
            suggestion = ""
            confidence = 0.3

        result = {
            "trend": trend,
            "suggestion": suggestion,
            "recommended_action": action,
            "confidence": confidence,
            "explanation": f"最近5次提交得分: {recent_scores}",
        }

        # If LLM available, enhance with AI analysis
        if self.llm:
            result = await self._ai_enhance(result, student_id, category_scores, recent_submissions)

        return result

    async def _ai_enhance(self, base_result: dict, student_id: str, scores: dict, submissions: list) -> dict:
        """Use LLM to enrich the analysis."""
        try:
            prompt = f"""你是操作系统教学专家。分析以下学生数据并给出教学建议：

学生能力分: {json.dumps(scores, ensure_ascii=False)}
最近提交得分: {[s.get('score') for s in submissions[-5:]]}
当前趋势判断: {base_result['trend']}

请给出：
1. 更详细的学习分析（50字以内）
2. 具体的教学建议（50字以内）
请用JSON格式回复：{{"analysis": "...", "advice": "..."}}
"""
            response = await self.llm.generate(prompt)
            try:
                ai_data = json.loads(response)
                base_result["analysis"] = ai_data.get("analysis", "")
                base_result["advice"] = ai_data.get("advice", "")
            except json.JSONDecodeError:
                base_result["analysis"] = response[:100]
        except Exception as e:
            logger.warning(f"AI enhance failed: {e}")

        return base_result

    async def generate_variant_suggestion(
        self,
        experiment_type: str,
        student_elo: float,
        weak_concepts: list,
    ) -> dict:
        """Generate a suggestion for difficulty variant parameters."""
        suggestion = {
            "experiment_type": experiment_type,
            "student_elo": student_elo,
            "suggested_difficulty": self._elo_to_difficulty(student_elo),
            "focus_concepts": weak_concepts[:3] if weak_concepts else [],
            "custom_params": {},
        }

        # Customize parameters based on weakness
        if "mutex" in weak_concepts or "lock" in weak_concepts:
            suggestion["custom_params"]["highlight_mutex"] = True

        if self.llm:
            prompt = f"""根据学生弱项概念 {weak_concepts}，为{experiment_type}实验生成合适的难度参数。

ELO: {student_elo}
建议难度: {suggestion['suggested_difficulty']}

请用JSON回复，包含 parameter_hint 字段（教学提示，30字以内）:"""
            try:
                response = await self.llm.generate(prompt)
                data = json.loads(response)
                suggestion["parameter_hint"] = data.get("parameter_hint", "")
            except Exception:
                pass

        return suggestion

    @staticmethod
    def _elo_to_difficulty(elo: float) -> str:
        if elo < 1200:
            return "easy"
        elif elo < 1700:
            return "medium"
        return "hard"


adaptive_service = AdaptiveService()
