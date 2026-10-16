"""Import Router - Git repository and URL import endpoints."""

from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from pydantic import BaseModel
from app.middleware.auth import get_current_user, require_role, UserContext
from app.services.importer.git_importer import git_importer
from app.services.importer.progress import ImportProgress

router = APIRouter(prefix="/api/v1/courses/{course_id}/import", tags=["import"])


class GitImportRequest(BaseModel):
    repo_url: str
    branch: str | None = None


@router.post("/git")
async def import_git_repo(
    course_id: str,
    body: GitImportRequest,
    background_tasks: BackgroundTasks,
    user: UserContext = Depends(require_role("teacher")),
):
    result = await git_importer.import_repo(
        repo_url=body.repo_url,
        branch=body.branch,
        course_id=course_id,
        user_id=user.user_id,
        user_role=user.role,
    )
    if result["status"] == "failed":
        raise HTTPException(status_code=400, detail=result.get("error", "Import failed"))
    return result


@router.get("/progress/{task_id}")
async def get_import_progress(
    course_id: str,
    task_id: str,
    user: UserContext = Depends(get_current_user),
):
    progress = ImportProgress(task_id)
    data = await progress.get()
    return data
