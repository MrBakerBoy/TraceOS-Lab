"""TraceOS Lab AI Service - Database Package"""

from app.db.connection import init_db, close_db, get_pool
from app.db.diagnosis_repo import (
    save_diagnosis,
    get_diagnosis_from_db,
    get_diagnoses_by_submission,
    get_latest_completed_diagnosis,
)
from app.db.diagnosis_harness_repo import (
    save_diagnosis_report,
    save_agent_result,
    save_full_report_with_agents,
    get_active_rubric,
    get_rubric_by_category,
    list_diagnosis_reports,
    get_diagnosis_report,
    upsert_error_pattern,
)
from app.db.knowledge_repo import knowledge_repo

__all__ = [
    "init_db", "close_db", "get_pool",
    "save_diagnosis", "get_diagnosis_from_db", "get_diagnoses_by_submission",
    "get_latest_completed_diagnosis",
    # Harness repo
    "save_diagnosis_report", "save_agent_result", "save_full_report_with_agents",
    "get_active_rubric", "get_rubric_by_category",
    "list_diagnosis_reports", "get_diagnosis_report",
    "upsert_error_pattern",
    "knowledge_repo",
]
