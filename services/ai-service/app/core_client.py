"""Core Service HTTP 客户端 — 获取 submission/experiment 数据"""

import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class CoreServiceClient:
    """调用 Core Service REST API 获取数据"""

    def __init__(self) -> None:
        self.base_url = settings.core_service_url
        self.timeout = 10.0

    async def get_submission(self, submission_id: str) -> dict[str, Any] | None:
        """获取提交详情（含 code, language, compile_error 等）"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(f"{self.base_url}/api/v1/internal/submissions/{submission_id}")
                if resp.status_code == 200:
                    return resp.json()
                logger.warning("Core get_submission %s returned %d", submission_id, resp.status_code)
                return None
        except Exception as e:
            logger.warning("Core get_submission failed: %s", e)
            return None

    async def get_experiment(self, experiment_id: str) -> dict[str, Any] | None:
        """获取实验详情。

        Core Service 返回格式为:
            {"experiment": {...}, "test_cases": [...], "can_view_answer": bool}

        本方法自动解包，返回 experiment 字典。
        如需 test_cases，请使用 get_experiment_full()。
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(f"{self.base_url}/api/v1/internal/experiments/{experiment_id}")
                if resp.status_code == 200:
                    data = resp.json()
                    # 解包嵌套响应，提取 experiment 对象
                    if isinstance(data, dict) and "experiment" in data:
                        return data["experiment"]
                    # 向后兼容：如果已经是扁平的 experiment 对象，直接返回
                    return data
                logger.warning("Core get_experiment %s returned %d", experiment_id, resp.status_code)
                return None
        except Exception as e:
            logger.warning("Core get_experiment failed: %s", e)
            return None

    async def get_submission_test_results(self, submission_id: str) -> list[dict[str, Any]] | None:
        """获取提交的测试用例执行结果（含期望/实际输出对比）"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{self.base_url}/api/v1/internal/submissions/{submission_id}/test-results"
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, list):
                        return data
                    # Some APIs wrap in {test_results: [...]}
                    if isinstance(data, dict) and "test_results" in data:
                        return data["test_results"]
                    return None
                logger.warning("Core get_submission_test_results %s returned %d", submission_id, resp.status_code)
                return None
        except Exception as e:
            logger.warning("Core get_submission_test_results failed: %s", e)
            return None

    async def get_experiment_full(self, experiment_id: str) -> dict[str, Any] | None:
        """获取实验完整信息（含 test_cases）"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(f"{self.base_url}/api/v1/internal/experiments/{experiment_id}")
                if resp.status_code == 200:
                    return resp.json()
                return None
        except Exception as e:
            logger.warning("Core get_experiment_full failed: %s", e)
            return None

    async def get_submission_traces(self, submission_id: str, limit: int = 500, errors_only: bool = False) -> dict[str, Any] | None:
        """获取提交的 strace 系统调用追踪数据。"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                params = f"?limit={limit}"
                if errors_only:
                    params += "&errors_only=true"
                resp = await client.get(
                    f"{self.base_url}/api/v1/internal/submissions/{submission_id}/traces{params}"
                )
                if resp.status_code == 200:
                    return resp.json()
                logger.debug("Core get_submission_traces %s returned %d", submission_id, resp.status_code)
                return None
        except Exception as e:
            logger.warning("Core get_submission_traces failed for %s: %s", submission_id, e)
            return None


core_client = CoreServiceClient()
