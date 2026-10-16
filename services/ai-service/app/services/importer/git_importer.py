"""Git repository importer - clones a repo and imports all text/code files."""

import os
import shutil
import tempfile
import uuid
import logging
from pathlib import Path
from app.services.importer.progress import ImportProgress
from app.services.ingestion.parser import document_parser
from app.services.ingestion.chunker import chunker
from app.services.ingestion.embedder import embedder
from app.db.knowledge_repo import knowledge_repo
from app.config import settings

logger = logging.getLogger(__name__)

CODE_EXTENSIONS = {".c", ".h", ".py", ".cpp", ".hpp", ".java", ".go", ".rs", ".js", ".ts",
                   ".md", ".txt", ".rst", ".json", ".yaml", ".yml", ".toml", ".cfg", ".ini"}
SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv", ".idea", ".vscode", "target", "build", "dist"}


class GitImporter:
    MAX_REPO_SIZE_MB = 500

    async def import_repo(self, repo_url: str, branch: str | None, course_id: str,
                          user_id: str, user_role: str) -> dict:
        task_id = str(uuid.uuid4())
        progress = ImportProgress(task_id)
        await progress.set("cloning", 0, 0, f"Cloning {repo_url}")

        tmpdir = tempfile.mkdtemp(prefix="rag_git_")

        try:
            # Clone
            import git
            clone_args = {"depth": 1}
            if branch:
                clone_args["branch"] = branch

            loop = __import__("asyncio").get_event_loop()
            await loop.run_in_executor(
                None, lambda: git.Repo.clone_from(repo_url, tmpdir, **clone_args)
            )

            # Check size
            total_size = sum(
                os.path.getsize(os.path.join(dirpath, f))
                for dirpath, _, filenames in os.walk(tmpdir)
                for f in filenames
            )
            if total_size > self.MAX_REPO_SIZE_MB * 1024 * 1024:
                await progress.fail(f"Repo too large: {total_size / 1024 / 1024:.0f}MB > {self.MAX_REPO_SIZE_MB}MB")
                shutil.rmtree(tmpdir, ignore_errors=True)
                return {"task_id": task_id, "status": "failed", "error": "Repo too large"}

            # Gather files
            files = []
            for dirpath, dirnames, filenames in os.walk(tmpdir):
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                for f in filenames:
                    ext = Path(f).suffix.lower()
                    if ext in CODE_EXTENSIONS:
                        files.append(os.path.join(dirpath, f))

            if len(files) > 1000:
                await progress.fail(f"Too many files: {len(files)} > 1000")
                shutil.rmtree(tmpdir, ignore_errors=True)
                return {"task_id": task_id, "status": "failed", "error": f"Too many files: {len(files)}"}

            total = len(files)
            imported = 0
            failed = 0
            entry_ids = []

            status = "approved" if user_role == "teacher" else "pending_review"
            repo_name = repo_url.rstrip("/").split("/")[-1].replace(".git", "")

            for i, filepath in enumerate(files):
                try:
                    rel_path = os.path.relpath(filepath, tmpdir)
                    await progress.set("importing", i + 1, total, f"Processing {rel_path}")

                    with open(filepath, "rb") as fh:
                        content = fh.read()

                    if len(content) > settings.rag_max_file_size_mb * 1024 * 1024:
                        failed += 1
                        continue

                    filename = f"[{repo_name}] {rel_path}"
                    doc = document_parser.parse(content, filename, "git")
                    chunks = chunker.chunk(doc)
                    texts = [c.content for c in chunks]
                    embeddings = embedder.embed(texts)

                    entry_id = await knowledge_repo.create_entry(
                        course_id=course_id, title=doc.title,
                        source_type="git", submitted_by=user_id,
                        content_raw=doc.content_raw, status=status,
                    )
                    chunk_records = [
                        {"index": j, "content": c.content,
                         "embedding": embeddings[j] if j < len(embeddings) else None,
                         "metadata": {**c.metadata, "repo": repo_url, "path": rel_path}}
                        for j, c in enumerate(chunks)
                    ]
                    await knowledge_repo.insert_chunks(entry_id, chunk_records)
                    entry_ids.append(entry_id)
                    imported += 1
                except Exception as e:
                    logger.warning("Failed to import %s: %s", filepath, e)
                    failed += 1

            await progress.complete()
            shutil.rmtree(tmpdir, ignore_errors=True)
            return {
                "task_id": task_id,
                "status": "completed",
                "imported": imported,
                "failed": failed,
                "total": total,
                "entry_ids": entry_ids,
            }
        except Exception as e:
            logger.error("Git import failed: %s", e)
            await progress.fail(str(e))
            shutil.rmtree(tmpdir, ignore_errors=True)
            return {"task_id": task_id, "status": "failed", "error": str(e)}


git_importer = GitImporter()
