"""Code audit API router — receives Go annotations, returns AI deep audit."""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.services.code_audit_service import code_audit_service
from app.agents.code_auditor import code_auditor_agent

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai/code-audit", tags=["code-audit"])


class DeepAuditRequest(BaseModel):
    code: str
    annotations: list = []
    issues: list = []
    experiment_id: Optional[str] = None
    experiment_type: str = "process"
    submission_id: Optional[str] = None
    student_id: Optional[str] = None


class AuditResponse(BaseModel):
    pattern_matches: list = []
    resource_analysis: dict = {}
    teaching_hints: dict = {}
    ai_issues: list = []
    explanation: str = ""
    llm_analysis: str = ""
    error: Optional[str] = None


@router.post("/deep", response_model=AuditResponse)
async def deep_audit(request: DeepAuditRequest):
    """Deep code audit using LangGraph agent pipeline.

    Receives code + annotations from Go AST parser,
    runs multi-step analysis and returns structured results.
    """
    try:
        # Step 1: Run the agent pipeline (pattern match + resource analysis + LLM)
        agent_result = await code_auditor_agent.audit(
            code=request.code,
            annotations=request.annotations,
            issues=request.issues,
            experiment_type=request.experiment_type,
        )

        # Step 2: Additional LLM deep audit if configured
        llm_result = await code_audit_service.deep_audit(
            code=request.code,
            annotations=request.annotations,
            issues=request.issues,
            experiment_type=request.experiment_type,
        )

        return AuditResponse(
            pattern_matches=agent_result.get("pattern_matches", []),
            resource_analysis=agent_result.get("resource_analysis", {}),
            teaching_hints=agent_result.get("teaching_hints", llm_result.get("teaching_hints", {})),
            ai_issues=llm_result.get("ai_issues", []),
            explanation=llm_result.get("explanation", ""),
            llm_analysis=agent_result.get("llm_analysis", ""),
            error=agent_result.get("error"),
        )

    except Exception as e:
        logger.error(f"Code audit failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/quick")
async def quick_audit(request: DeepAuditRequest):
    """Quick audit — rule-based only, no LLM."""
    try:
        agent_result = await code_auditor_agent.audit(
            code=request.code,
            annotations=request.annotations,
            issues=request.issues,
            experiment_type=request.experiment_type,
        )
        return AuditResponse(
            pattern_matches=agent_result.get("pattern_matches", []),
            resource_analysis=agent_result.get("resource_analysis", {}),
            teaching_hints=agent_result.get("teaching_hints", {}),
            explanation="快速模式 — 仅规则引擎分析",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
