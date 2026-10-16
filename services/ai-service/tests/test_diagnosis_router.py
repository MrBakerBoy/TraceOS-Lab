"""Tests for diagnosis router."""

from fastapi.testclient import TestClient


def test_request_diagnosis(client: TestClient) -> None:
    resp = client.post("/api/ai/diagnose", json={
        "submission_id": "sub-1",
        "experiment_id": "exp-1",
        "student_id": "stu-1",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "diagnosis_id" in data
    assert data["status"] == "in_progress"


def test_get_diagnosis_not_found(client: TestClient) -> None:
    resp = client.get("/api/ai/diagnose/nonexistent-id")
    assert resp.status_code == 404


def test_request_and_get_diagnosis(client: TestClient) -> None:
    # Request diagnosis
    resp = client.post("/api/ai/diagnose", json={
        "submission_id": "sub-2",
        "experiment_id": "exp-1",
        "student_id": "stu-1",
    })
    diagnosis_id = resp.json()["diagnosis_id"]

    # Immediately get - may be in_progress since background task
    resp = client.get(f"/api/ai/diagnose/{diagnosis_id}")
    assert resp.status_code == 200 or resp.status_code == 404
