"""Import progress tracker using Redis."""

import json
import logging
from app.config import settings

logger = logging.getLogger(__name__)

try:
    import redis.asyncio as redis
    _redis: redis.Redis | None = None

    async def _get_redis():
        global _redis
        if _redis is None:
            _redis = redis.Redis(host=settings.redis_host, port=settings.redis_port, decode_responses=True)
        return _redis
except ImportError:
    logger.warning("redis not installed, progress tracking disabled")
    _redis = None

    async def _get_redis():
        return None


class ImportProgress:
    def __init__(self, task_id: str):
        self.task_id = task_id
        self._key = f"rag:import:{task_id}"

    async def set(self, status: str, current: int, total: int, message: str = ""):
        r = await _get_redis()
        if r is None:
            return
        data = {"status": status, "current": current, "total": total, "message": message}
        await r.set(self._key, json.dumps(data), ex=3600)

    async def get(self) -> dict:
        r = await _get_redis()
        if r is None:
            return {"status": "unknown", "current": 0, "total": 0, "message": "Redis not available"}
        raw = await r.get(self._key)
        if raw is None:
            return {"status": "not_found", "current": 0, "total": 0, "message": ""}
        return json.loads(raw)

    async def complete(self):
        await self.set("completed", 1, 1, "Import completed")

    async def fail(self, error: str):
        await self.set("failed", 0, 0, error)
