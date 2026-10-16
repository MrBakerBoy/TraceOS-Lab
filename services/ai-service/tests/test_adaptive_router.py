"""Tests for adaptive router endpoints."""

import pytest
from unittest.mock import AsyncMock, patch


class TestAdaptiveProfile:
    """GET /api/ai/adaptive/profile/{student_id}"""

    def test_get_profile_returns_student_id(self, client) -> None:
        response = client.get("/api/ai/adaptive/profile/stu-123")
        assert response.status_code == 200
        data = response.json()
        assert data["student_id"] == "stu-123"
        assert "message" in data


class TestAnalyzeLearningCurve:
    """POST /api/ai/adaptive/analyze-learning-curve"""

    def test_analyze_learning_curve_success(self, client) -> None:
        with patch(
            "app.routers.adaptive.adaptive_service.analyze_learning_curve",
            new_callable=AsyncMock,
        ) as mock_analyze:
            mock_analyze.return_value = {
                "trend": "improving",
                "suggestion": "连续3次高分，建议提升难度",
                "recommended_action": "upgrade",
                "confidence": 0.85,
                "explanation": "最近5次提交得分: [95, 92, 98]",
            }

            response = client.post(
                "/api/ai/adaptive/analyze-learning-curve"
                "?student_id=stu-1"
                "&experiment_type=thread"
            )

        assert response.status_code == 200
        data = response.json()
        assert data["trend"] == "improving"
        assert data["recommended_action"] == "upgrade"
        assert data["confidence"] == 0.85

    def test_analyze_learning_curve_insufficient_data(self, client) -> None:
        with patch(
            "app.routers.adaptive.adaptive_service.analyze_learning_curve",
            new_callable=AsyncMock,
        ) as mock_analyze:
            mock_analyze.return_value = {
                "trend": "insufficient_data",
                "suggestion": "数据不足，保持当前难度",
                "recommended_action": "maintain",
                "confidence": 0.5,
                "explanation": "提交次数不足3次，无法判断趋势",
            }

            response = client.post(
                "/api/ai/adaptive/analyze-learning-curve"
                "?student_id=stu-new"
            )

        assert response.status_code == 200
        data = response.json()
        assert data["trend"] == "insufficient_data"
        assert data["recommended_action"] == "maintain"

    def test_analyze_learning_curve_service_error(self, client) -> None:
        with patch(
            "app.routers.adaptive.adaptive_service.analyze_learning_curve",
            new_callable=AsyncMock,
        ) as mock_analyze:
            mock_analyze.side_effect = RuntimeError("Service down")

            response = client.post(
                "/api/ai/adaptive/analyze-learning-curve"
                "?student_id=stu-err"
            )

        assert response.status_code == 500


class TestSuggestVariant:
    """POST /api/ai/adaptive/suggest-variant"""

    def test_suggest_variant_success(self, client) -> None:
        with patch(
            "app.routers.adaptive.adaptive_service.generate_variant_suggestion",
            new_callable=AsyncMock,
        ) as mock_suggest:
            mock_suggest.return_value = {
                "experiment_type": "thread",
                "student_elo": 1500.0,
                "suggested_difficulty": "medium",
                "focus_concepts": ["mutex", "deadlock"],
                "custom_params": {"highlight_mutex": True},
            }

            response = client.post(
                "/api/ai/adaptive/suggest-variant"
                "?student_id=stu-1"
                "&experiment_type=thread"
                "&student_elo=1500"
            )

        assert response.status_code == 200
        data = response.json()
        assert data["suggested_difficulty"] == "medium"
        assert data["student_elo"] == 1500.0
        assert "focus_concepts" in data

    def test_suggest_variant_different_elo(self, client) -> None:
        with patch(
            "app.routers.adaptive.adaptive_service.generate_variant_suggestion",
            new_callable=AsyncMock,
        ) as mock_suggest:
            mock_suggest.return_value = {
                "experiment_type": "memory",
                "student_elo": 800.0,
                "suggested_difficulty": "easy",
                "focus_concepts": [],
                "custom_params": {},
            }

            response = client.post(
                "/api/ai/adaptive/suggest-variant"
                "?student_id=stu-low"
                "&experiment_type=memory"
                "&student_elo=800"
            )

        assert response.status_code == 200
        data = response.json()
        assert data["suggested_difficulty"] == "easy"
        assert data["student_elo"] == 800.0

    def test_suggest_variant_service_error(self, client) -> None:
        with patch(
            "app.routers.adaptive.adaptive_service.generate_variant_suggestion",
            new_callable=AsyncMock,
        ) as mock_suggest:
            mock_suggest.side_effect = RuntimeError("Generation failed")

            response = client.post(
                "/api/ai/adaptive/suggest-variant"
                "?student_id=stu-err"
            )

        assert response.status_code == 500
