"""Tests for diagnosis_service module."""

import json
import pytest
from unittest.mock import AsyncMock, patch

from app.services.diagnosis_service import DiagnosisService


MOCK_AI_RESPONSE = json.dumps({
    "error_type": "runtime_error",
    "severity": "medium",
    "root_cause": "fork 返回值未检查",
    "feedback": {
        "level_1": "程序运行出错",
        "level_2": "检查 fork 的返回值",
        "level_3": "fork 失败返回 -1，需要检查",
    },
    "related_concepts": [
        {"name": "fork", "description": "创建子进程", "type": "syscall", "difficulty": "medium"}
    ],
    "related_syscalls": [
        {"name": "fork", "description": "创建子进程", "error_code": "EAGAIN", "syscall_number": 57}
    ],
    "suggested_fixes": [
        {"title": "检查返回值", "description": "在 fork 后检查返回值", "code_snippet": "if(pid==-1)", "explanation": "fork 可能失败"}
    ],
    "confidence_score": 0.85,
}, ensure_ascii=False)


@pytest.mark.asyncio
async def test_diagnose_submission_success() -> None:
    service = DiagnosisService()
    submission = {"id": "sub-1", "student_id": "stu-1", "code": "int main(){}", "language": "c"}
    experiment = {"title": "进程实验", "description": "创建子进程", "category": "process"}

    with patch.object(
        service, "diagnose_submission",  # type: ignore[arg-type]
        new_callable=AsyncMock,
    ) as mock_diag:
        from app.models import DiagnosisResult, DiagnosisStatus, Feedback
        from datetime import datetime, timezone

        mock_diag.return_value = DiagnosisResult(
            diagnosis_id="diag-1",
            submission_id="sub-1",
            student_id="stu-1",
            status=DiagnosisStatus.completed,
            error_type="runtime_error",
            root_cause="fork 返回值未检查",
            feedback=Feedback(level_1="提示1", level_2="提示2", level_3="提示3"),
            confidence_score=0.85,
            created_at=datetime.now(timezone.utc),
            completed_at=datetime.now(timezone.utc),
        )
        result = await mock_diag(submission=submission, experiment=experiment)
        assert result.error_type == "runtime_error"
        assert result.status == DiagnosisStatus.completed


@pytest.mark.asyncio
async def test_diagnose_submission_mimo_failure() -> None:
    service = DiagnosisService()
    submission = {"id": "sub-1", "student_id": "stu-1", "code": "x", "language": "c"}
    experiment = {"title": "T", "description": "D", "category": ""}

    with patch("app.services.diagnosis_service.mimo_client") as mock_client:
        mock_client.chat_completion = AsyncMock(side_effect=RuntimeError("API down"))
        with pytest.raises(RuntimeError, match="API down"):
            await service.diagnose_submission(submission=submission, experiment=experiment)


@pytest.mark.asyncio
async def test_generate_hints_success() -> None:
    service = DiagnosisService()
    diagnosis = {"error_type": "runtime_error", "root_cause": "fork failed"}

    with patch("app.services.diagnosis_service.mimo_client") as mock_client:
        mock_client.chat_completion = AsyncMock(return_value="请检查 fork 的返回值")
        result = await service.generate_hints(diagnosis, "code", "c", 1)
        assert result["level"] == 1
        assert "fork" in result["hint"]
        assert result["explanation"] == "fork failed"
