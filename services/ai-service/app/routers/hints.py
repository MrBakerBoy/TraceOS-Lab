"""渐进式提示路由 — 从 DB 读取诊断结果"""

import json
import logging

from fastapi import APIRouter, HTTPException

from app.core_client import core_client
from app.db import get_diagnosis_from_db
from app.models import HintResponse, Concept
from app.services.diagnosis_service import diagnosis_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/hints", tags=["hints"])


@router.get("/{diagnosis_id}/{level}", response_model=HintResponse)
async def get_hint(diagnosis_id: str, level: int) -> HintResponse:
    """获取渐进式提示（level: 1=轻量, 2=引导, 3=详细）"""
    if level not in (1, 2, 3, 4):
        raise HTTPException(status_code=400, detail="Level must be 1, 2, 3, or 4")

    row = await get_diagnosis_from_db(diagnosis_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Diagnosis not found")

    # 构造诊断字典（M2 列名）
    diagnosis_dict = {
        "error_type": row.get("error_type") or "unknown",
        "root_cause": row.get("root_cause") or "",
    }

    # 尝试从 Core Service 获取 submission 的 code
    code = ""
    language = "c"
    submission = await core_client.get_submission(str(row["submission_id"]))
    if submission:
        code = submission.get("code", "")
        language = submission.get("language", "c")

    try:
        result = await diagnosis_service.generate_hints(
            diagnosis=diagnosis_dict,
            code=code,
            language=language,
            level=level,
        )

        # 解析 related_concepts（M2 列名）
        concepts = []
        raw_concepts = row.get("related_concepts") or "[]"
        if isinstance(raw_concepts, str):
            raw_concepts = json.loads(raw_concepts)
        for c in raw_concepts[:2]:
            concepts.append(Concept(**c))

        return HintResponse(
            hint=result["hint"],
            explanation=result["explanation"],
            related_concepts=concepts,
            code_locations=[],
        )
    except Exception as e:
        logger.warning("LLM hint generation failed, using fallback: %s", e)
        # Fallback to stored feedback levels（M2 列名）
        hint = ""
        if level == 1:
            hint = row.get("hint_level_1") or ""
        elif level == 2:
            hint = row.get("hint_level_2") or ""
        elif level == 3:
            hint = row.get("hint_level_3") or ""
        elif level == 4:
            hint = row.get("hint_level_4") or ""

        return HintResponse(
            hint=hint or "请仔细检查你的代码",
            explanation=row.get("root_cause") or "",
            related_concepts=[],
            code_locations=[],
        )
