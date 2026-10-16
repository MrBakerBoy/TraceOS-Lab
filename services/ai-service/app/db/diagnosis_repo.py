"""TraceOS Lab AI Service - Diagnosis Repository"""

from datetime import datetime, timezone
import logging
from app.db.connection import get_pool

logger = logging.getLogger(__name__)


async def save_diagnosis(
    diagnosis_id: str,
    submission_id: str,
    student_id: str,
    status: str,
    error_type: str | None = None,
    severity: str | None = None,
    root_cause: str | None = None,
    feedback_l1: str | None = None,
    feedback_l2: str | None = None,
    feedback_l3: str | None = None,
    related_concepts: str | None = None,
    related_syscalls: str | None = None,
    suggested_fixes: str | None = None,
    confidence_score: float | None = None,
    llm_model: str | None = None,
    llm_tokens_used: int | None = None,
) -> None:
    """Write diagnosis result to the diagnoses table."""
    pool = get_pool()
    completed_at = datetime.now(timezone.utc) if status == "completed" else None

    await pool.execute(
        """
        INSERT INTO diagnoses (
            id, submission_id, student_id, status,
            error_type, severity, root_cause,
            feedback_l1, feedback_l2, feedback_l3,
            related_concepts, related_syscalls, suggested_fixes,
            confidence_score,
            mimo_model, mimo_tokens_used,
            completed_at
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10,
            $11::jsonb, $12::jsonb, $13::jsonb,
            $14,
            $15, $16,
            $17
        )
        ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            error_type = EXCLUDED.error_type,
            severity = EXCLUDED.severity,
            root_cause = EXCLUDED.root_cause,
            feedback_l1 = EXCLUDED.feedback_l1,
            feedback_l2 = EXCLUDED.feedback_l2,
            feedback_l3 = EXCLUDED.feedback_l3,
            related_concepts = EXCLUDED.related_concepts,
            related_syscalls = EXCLUDED.related_syscalls,
            suggested_fixes = EXCLUDED.suggested_fixes,
            confidence_score = EXCLUDED.confidence_score,
            mimo_model = EXCLUDED.mimo_model,
            mimo_tokens_used = EXCLUDED.mimo_tokens_used,
            completed_at = CASE
                WHEN EXCLUDED.status = 'completed' THEN COALESCE(EXCLUDED.completed_at, NOW())
                ELSE diagnoses.completed_at
            END
        """,
        diagnosis_id, submission_id, student_id, status,
        error_type, severity, root_cause,
        feedback_l1, feedback_l2, feedback_l3,
        related_concepts, related_syscalls, suggested_fixes,
        confidence_score,
        llm_model, llm_tokens_used,
        completed_at,
    )
    logger.info("Diagnosis %s saved to DB (status=%s)", diagnosis_id, status)


async def get_diagnosis_from_db(diagnosis_id: str) -> dict | None:
    """Get a single diagnosis by ID."""
    pool = get_pool()
    row = await pool.fetchrow("SELECT * FROM diagnoses WHERE id = $1", diagnosis_id)
    if row is None:
        return None
    return dict(row)


async def get_diagnoses_by_submission(submission_id: str) -> list[dict]:
    """Get all diagnoses for a submission, ordered by creation time descending."""
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT * FROM diagnoses WHERE submission_id = $1 ORDER BY created_at DESC",
        submission_id,
    )
    return [dict(r) for r in rows]


async def get_latest_completed_diagnosis(submission_id: str) -> dict | None:
    """Get the most recent completed diagnosis for a submission."""
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM diagnoses WHERE submission_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1",
        submission_id,
    )
    if row is None:
        return None
    return dict(row)
