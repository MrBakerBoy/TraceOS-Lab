"""Tests for code_audit router endpoints."""

import json
import pytest
from unittest.mock import AsyncMock, patch


class TestDeepAudit:

    def test_deep_audit_returns_audit_response_structure(self, client):
        payload = {
            "code": "int main() { return 0; }",
            "annotations": [
                {"line": 1, "tag": "func_def", "detail": "main"},
            ],
            "issues": [{"line": 2, "severity": "warning", "title": "unused"}],
            "experiment_type": "thread",
        }
        with patch(
            "app.routers.code_audit.code_auditor_agent.audit",
            new_callable=AsyncMock,
        ) as mock_agent_audit, patch(
            "app.routers.code_audit.code_audit_service.deep_audit",
            new_callable=AsyncMock,
        ) as mock_svc_deep:
            mock_agent_audit.return_value = {
                "pattern_matches": [{"type": "missing_unlock", "severity": "error"}],
                "resource_analysis": {},
                "teaching_hints": {"L1": "h1", "L2": "h2", "L3": "h3"},
                "llm_analysis": "ok",
            }
            mock_svc_deep.return_value = {
                "ai_issues": [],
                "explanation": "ok",
                "teaching_hints": {"L1": "H1", "L2": "H2", "L3": "H3"},
            }
            response = client.post("/api/ai/code-audit/deep", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "pattern_matches" in data
        assert "ai_issues" in data

    def test_deep_audit_handles_agent_error(self, client):
        payload = {"code": "int main(){}", "annotations": [], "issues": [], "experiment_type": "process"}
        with patch(
            "app.routers.code_audit.code_auditor_agent.audit",
            new_callable=AsyncMock,
        ) as mock_agent_audit:
            mock_agent_audit.side_effect = RuntimeError("Agent crashed")
            response = client.post("/api/ai/code-audit/deep", json=payload)
        assert response.status_code == 500


class TestQuickAudit:

    def test_quick_audit_returns_response(self, client):
        payload = {"code": "int main(){}", "annotations": [], "issues": [], "experiment_type": "memory"}
        with patch(
            "app.routers.code_audit.code_auditor_agent.audit",
            new_callable=AsyncMock,
        ) as mock_agent_audit:
            mock_agent_audit.return_value = {
                "pattern_matches": [],
                "resource_analysis": {},
                "teaching_hints": {"L1": "L1 hint", "L2": "", "L3": ""},
            }
            response = client.post("/api/ai/code-audit/quick", json=payload)
        assert response.status_code == 200

    def test_quick_audit_handles_error(self, client):
        payload = {"code": "x", "annotations": [], "issues": [], "experiment_type": "process"}
        with patch(
            "app.routers.code_audit.code_auditor_agent.audit",
            new_callable=AsyncMock,
        ) as mock_agent_audit:
            mock_agent_audit.side_effect = RuntimeError("fail")
            response = client.post("/api/ai/code-audit/quick", json=payload)
        assert response.status_code == 500
