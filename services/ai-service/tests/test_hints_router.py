"""Tests for hints router."""

from fastapi.testclient import TestClient


def test_get_hint_invalid_level(client: TestClient) -> None:
    resp = client.get("/api/ai/hints/some-id/5")
    assert resp.status_code == 400


def test_get_hint_not_found(client: TestClient) -> None:
    resp = client.get("/api/ai/hints/nonexistent/1")
    assert resp.status_code == 404
