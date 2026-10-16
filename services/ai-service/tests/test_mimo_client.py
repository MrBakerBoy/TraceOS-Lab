"""Tests for mimo_client module."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
import httpx

from app.services.mimo_client import MimoClient


def _make_client() -> MimoClient:
    c = MimoClient()
    c.base_url = "https://test.api/v1"
    c.api_key = "test-key"
    c.model = "test-model"
    c.timeout = 5
    c.max_retries = 3
    return c


@pytest.mark.asyncio
async def test_chat_completion_success() -> None:
    client = _make_client()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": "诊断结果: 编译错误"}}]
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(return_value=mock_resp)
        MockClient.return_value = instance

        result = await client.chat_completion("sys", "user")
        assert result == "诊断结果: 编译错误"


@pytest.mark.asyncio
async def test_chat_completion_retry_then_success() -> None:
    client = _make_client()
    client.max_retries = 3

    success_resp = MagicMock()
    success_resp.status_code = 200
    success_resp.json.return_value = {"choices": [{"message": {"content": "ok"}}]}
    success_resp.raise_for_status = MagicMock()

    fail_resp = httpx.Response(status_code=500, request=httpx.Request("POST", "https://test"))

    call_count = 0

    async def mock_post(*args, **kwargs):  # type: ignore[no-untyped-def]
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            raise httpx.HTTPStatusError("error", request=fail_resp.request, response=fail_resp)
        return success_resp

    with patch("httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(side_effect=mock_post)
        MockClient.return_value = instance

        result = await client.chat_completion("sys", "user")
        assert result == "ok"
        assert call_count == 3


@pytest.mark.asyncio
async def test_chat_completion_all_retries_fail() -> None:
    client = _make_client()
    client.max_retries = 2

    fail_resp = httpx.Response(status_code=500, request=httpx.Request("POST", "https://test"))

    async def mock_post(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise httpx.HTTPStatusError("error", request=fail_resp.request, response=fail_resp)

    with patch("httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(side_effect=mock_post)
        MockClient.return_value = instance

        with pytest.raises(RuntimeError, match="failed after 2 retries"):
            await client.chat_completion("sys", "user")


@pytest.mark.asyncio
async def test_chat_completion_timeout() -> None:
    client = _make_client()
    client.max_retries = 1

    async def mock_post(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise httpx.TimeoutException("timeout")

    with patch("httpx.AsyncClient") as MockClient:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.post = AsyncMock(side_effect=mock_post)
        MockClient.return_value = instance

        with pytest.raises(RuntimeError, match="failed after 1 retries"):
            await client.chat_completion("sys", "user")
