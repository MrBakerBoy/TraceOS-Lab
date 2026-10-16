"""Tests for adaptive_service module."""

import pytest
from unittest.mock import AsyncMock, patch

from app.services.adaptive_service import AdaptiveService


@pytest.mark.asyncio
async def test_analyze_learning_curve_upgrade_on_consecutive_high() -> None:
    """连续3次高分(>=90) → recommended_action=upgrade"""
    service = AdaptiveService()
    submissions = [
        {"score": 95},
        {"score": 92},
        {"score": 98},
    ]
    result = await service.analyze_learning_curve(
        student_id="stu-1",
        category_scores={},
        recent_submissions=submissions,
    )
    assert result["trend"] == "improving"
    assert result["recommended_action"] == "upgrade"
    assert "连续3次高分" in result["suggestion"]


@pytest.mark.asyncio
async def test_analyze_learning_curve_downgrade_on_consecutive_low() -> None:
    """连续3次低分(<50) → recommended_action=downgrade"""
    service = AdaptiveService()
    submissions = [
        {"score": 30},
        {"score": 45},
        {"score": 20},
    ]
    result = await service.analyze_learning_curve(
        student_id="stu-1",
        category_scores={},
        recent_submissions=submissions,
    )
    assert result["trend"] == "declining"
    assert result["recommended_action"] == "downgrade"
    assert "连续3次低分" in result["suggestion"]


@pytest.mark.asyncio
async def test_analyze_learning_curve_insufficient_data_less_than_3() -> None:
    """少于3次提交 → trend=insufficient_data"""
    service = AdaptiveService()
    submissions = [
        {"score": 90},
        {"score": 85},
    ]
    result = await service.analyze_learning_curve(
        student_id="stu-1",
        category_scores={},
        recent_submissions=submissions,
    )
    assert result["trend"] == "insufficient_data"
    assert result["recommended_action"] == "maintain"
    assert "不足3次" in result["explanation"]


@pytest.mark.asyncio
async def test_analyze_learning_curve_improving_trend() -> None:
    """成绩上升趋势 → maintain + improving"""
    service = AdaptiveService()
    submissions = [
        {"score": 50},
        {"score": 60},
        {"score": 85},
        {"score": 95},
    ]
    result = await service.analyze_learning_curve(
        student_id="stu-1",
        category_scores={},
        recent_submissions=submissions,
    )
    assert result["trend"] == "improving"
    assert result["recommended_action"] == "maintain"


@pytest.mark.asyncio
async def test_analyze_learning_curve_declining_trend() -> None:
    """成绩下降趋势 → maintain + declining"""
    service = AdaptiveService()
    submissions = [
        {"score": 90},
        {"score": 80},
        {"score": 60},
        {"score": 40},
    ]
    result = await service.analyze_learning_curve(
        student_id="stu-1",
        category_scores={},
        recent_submissions=submissions,
    )
    assert result["trend"] == "declining"
    assert result["recommended_action"] == "maintain"


@pytest.mark.asyncio
async def test_analyze_learning_curve_plateau() -> None:
    """成绩稳定 → plateau"""
    service = AdaptiveService()
    submissions = [
        {"score": 75},
        {"score": 75},
        {"score": 75},
    ]
    result = await service.analyze_learning_curve(
        student_id="stu-1",
        category_scores={},
        recent_submissions=submissions,
    )
    assert result["trend"] == "plateau"
    assert result["recommended_action"] == "maintain"


@pytest.mark.asyncio
async def test_analyze_learning_curve_empty_scores() -> None:
    """无评分数据 → no_data"""
    service = AdaptiveService()
    result = await service.analyze_learning_curve(
        student_id="stu-1",
        category_scores={},
        recent_submissions=[{}, {}],
    )
    assert result["trend"] == "insufficient_data"
    assert result["recommended_action"] == "maintain"


def test_elo_to_difficulty_easy() -> None:
    """ELO < 1200 → easy"""
    assert AdaptiveService._elo_to_difficulty(800) == "easy"
    assert AdaptiveService._elo_to_difficulty(1199) == "easy"
    assert AdaptiveService._elo_to_difficulty(0) == "easy"


def test_elo_to_difficulty_medium() -> None:
    """1200 <= ELO < 1700 → medium"""
    assert AdaptiveService._elo_to_difficulty(1200) == "medium"
    assert AdaptiveService._elo_to_difficulty(1500) == "medium"
    assert AdaptiveService._elo_to_difficulty(1699) == "medium"


def test_elo_to_difficulty_hard() -> None:
    """ELO >= 1700 → hard"""
    assert AdaptiveService._elo_to_difficulty(1700) == "hard"
    assert AdaptiveService._elo_to_difficulty(2000) == "hard"
    assert AdaptiveService._elo_to_difficulty(3000) == "hard"


@pytest.mark.asyncio
async def test_generate_variant_suggestion_basic() -> None:
    """返回 suggested_difficulty + focus_concepts"""
    service = AdaptiveService()
    result = await service.generate_variant_suggestion(
        experiment_type="thread",
        student_elo=1100,
        weak_concepts=["mutex", "deadlock", "sync"],
    )
    assert result["experiment_type"] == "thread"
    assert result["suggested_difficulty"] == "easy"
    assert result["focus_concepts"] == ["mutex", "deadlock", "sync"]
    assert result["student_elo"] == 1100


@pytest.mark.asyncio
async def test_generate_variant_suggestion_empty_concepts() -> None:
    """空weak_concepts → focus_concepts为空列表"""
    service = AdaptiveService()
    result = await service.generate_variant_suggestion(
        experiment_type="memory",
        student_elo=1800,
        weak_concepts=[],
    )
    assert result["suggested_difficulty"] == "hard"
    assert result["focus_concepts"] == []


@pytest.mark.asyncio
async def test_generate_variant_suggestion_highlight_mutex() -> None:
    """weak_concepts包含mutex → custom_params.highlight_mutex=True"""
    service = AdaptiveService()
    result = await service.generate_variant_suggestion(
        experiment_type="thread",
        student_elo=1500,
        weak_concepts=["mutex", "lock"],
    )
    assert result["custom_params"]["highlight_mutex"] is True


@pytest.mark.asyncio
async def test_ai_enhance_with_llm() -> None:
    """LLM可用时增强分析结果"""
    mock_llm = AsyncMock()
    mock_llm.generate.return_value = '{"analysis": "学生进步明显", "advice": "建议继续练习"}'
    service = AdaptiveService(llm_client=mock_llm)

    base = {"trend": "improving", "action": "upgrade"}
    result = await service._ai_enhance(base, "stu-1", {}, [{"score": 95}])
    assert result["analysis"] == "学生进步明显"
    assert result["advice"] == "建议继续练习"


@pytest.mark.asyncio
async def test_ai_enhance_llm_failure_graceful() -> None:
    """LLM调用失败不抛异常"""
    mock_llm = AsyncMock()
    mock_llm.generate.side_effect = RuntimeError("LLM down")
    service = AdaptiveService(llm_client=mock_llm)

    base = {"trend": "declining"}
    result = await service._ai_enhance(base, "stu-1", {}, [{"score": 30}])
    assert result["trend"] == "declining"
