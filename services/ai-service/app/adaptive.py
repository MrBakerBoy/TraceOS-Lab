"""Adaptive difficulty API router."""

import logging
from fastapi import APIRouter, HTTPException, Query

from app.services.adaptive_service import adaptive_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai/adaptive", tags=["adaptive"])


@router.get("/profile/{student_id}")
async def get_adaptive_profile(student_id: str):
    try:
        return {"student_id": student_id, "message": "Profile endpoint ready"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze-learning-curve")
async def analyze_learning_curve(
    student_id: str = Query(...),
    experiment_type: str = Query("process"),
):
    try:
        result = await adaptive_service.analyze_learning_curve(
            student_id=student_id, category_scores={}, recent_submissions=[]
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/suggest-variant")
async def suggest_variant(
    student_id: str = Query(...),
    experiment_type: str = Query("process"),
    student_elo: float = Query(1500.0),
):
    try:
        result = await adaptive_service.generate_variant_suggestion(
            experiment_type=experiment_type,
            student_elo=student_elo,
            weak_concepts=[],
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
