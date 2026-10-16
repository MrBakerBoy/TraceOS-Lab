"""
Unified LLM Adapter Layer - multi-provider support for TraceOS AI Service.

Supports: MiMo, DeepSeek, OpenAI, and any OpenAI-compatible API.
Switch provider via LLM_PROVIDER env var or config.
"""

import json
import logging
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Shared HTTP client reused across all LLM calls. A new httpx.AsyncClient per
# request would create a fresh connection pool and force a TLS handshake on
# every call; a long-lived client keeps connections alive and lets the parallel
# generator agents share pooled connections.
_shared_client: httpx.AsyncClient | None = None


def _get_shared_client() -> httpx.AsyncClient:
    """Return a process-wide httpx.AsyncClient with connection pooling."""
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(
            limits=httpx.Limits(
                max_connections=100,
                max_keepalive_connections=50,
                keepalive_expiry=30.0,
            ),
        )
    return _shared_client


# ---------------------------------------------------------------------------
# Response type (backward-compatible with MimoResponse)
# ---------------------------------------------------------------------------

@dataclass
class LLMResponse:
    content: str
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


# Alias for backward compatibility
MimoResponse = LLMResponse


# ---------------------------------------------------------------------------
# Provider registry
# ---------------------------------------------------------------------------

PROVIDER_PRESETS: dict[str, dict[str, str]] = {
    "mimo": {
        "base_url": "https://token-plan-cn.xiaomimimo.com/v1",
        "model": "mimo-v2.5",
        "description": "MiMo AI (Xiaomi)",
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
        "description": "DeepSeek V3/V4",
    },
    "deepseek-v4": {
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-v4-pro",
        "description": "DeepSeek V4 Pro",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o",
        "description": "OpenAI GPT-4o",
    },
    "custom": {
        "base_url": "",
        "model": "",
        "description": "Custom OpenAI-compatible endpoint",
    },
}


# ---------------------------------------------------------------------------
# Abstract provider
# ---------------------------------------------------------------------------

class BaseLLMProvider(ABC):
    """Abstract base for LLM providers."""

    @abstractmethod
    async def chat_completion(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        response_format: dict[str, str] | None = None,
    ) -> LLMResponse:
        ...

    @abstractmethod
    async def stream_completion(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        ...

    @abstractmethod
    async def chat_completion_with_messages(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.3,
        max_tokens: int = 4096,
        response_format: dict[str, str] | None = None,
    ) -> LLMResponse:
        ...

    @abstractmethod
    async def stream_completion_with_messages(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        ...


# ---------------------------------------------------------------------------
# OpenAI-compatible provider (MiMo / DeepSeek / OpenAI / custom)
# ---------------------------------------------------------------------------

class OpenAICompatibleProvider(BaseLLMProvider):
    """Provider for any OpenAI-compatible Chat Completions API."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout: int = 120,
        max_retries: int = 3,
        provider_name: str = "custom",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.max_retries = max_retries
        self.provider_name = provider_name

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _payload(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        stream: bool = False,
        response_format: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        }
        if response_format:
            payload["response_format"] = response_format
        return payload

    async def chat_completion(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        response_format: dict[str, str] | None = None,
    ) -> LLMResponse:
        last_error: Exception | None = None
        url = f"{self.base_url}/chat/completions"
        client = _get_shared_client()

        for attempt in range(self.max_retries):
            try:
                resp = await client.post(
                    url,
                    headers=self._headers(),
                    json=self._payload(
                        system_prompt, user_prompt, temperature,
                        max_tokens, response_format=response_format,
                    ),
                    timeout=self.timeout,
                )
                resp.raise_for_status()
                data = resp.json()
                message = data["choices"][0].get("message", {}) or {}
                content: str = message.get("content") or message.get("reasoning_content") or ""
                usage = data.get("usage", {})
                return LLMResponse(
                    content=content,
                    model=data.get("model", self.model),
                    prompt_tokens=usage.get("prompt_tokens", 0),
                    completion_tokens=usage.get("completion_tokens", 0),
                    total_tokens=usage.get("total_tokens", 0),
                )
            except httpx.TimeoutException as e:
                last_error = e
                logger.warning("%s timeout (attempt %d/%d)", self.provider_name, attempt + 1, self.max_retries)
            except httpx.HTTPStatusError as e:
                last_error = e
                logger.warning("%s HTTP %d (attempt %d/%d)", self.provider_name, e.response.status_code, attempt + 1, self.max_retries)
            except Exception as e:
                last_error = e
                logger.warning("%s error (attempt %d/%d): %s", self.provider_name, attempt + 1, self.max_retries, e)

        raise RuntimeError(f"{self.provider_name} failed after {self.max_retries} retries: {last_error}")

    async def stream_completion(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        url = f"{self.base_url}/chat/completions"
        client = _get_shared_client()
        async with client.stream(
            "POST", url,
            headers=self._headers(),
            json=self._payload(system_prompt, user_prompt, temperature, max_tokens, stream=True),
            timeout=self.timeout,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    chunk = line[6:]
                    if chunk.strip() == "[DONE]":
                        break
                    try:
                        data = json.loads(chunk)
                        delta = data["choices"][0].get("delta", {}) or {}
                        content = delta.get("content") or delta.get("reasoning_content") or ""
                        if content:
                            yield content
                        if data["choices"][0].get("finish_reason") == "length":
                            yield "\n\n[回答因长度限制被截断，请尝试更具体的提问]"
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue

    async def chat_completion_with_messages(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.3,
        max_tokens: int = 4096,
        response_format: dict[str, str] | None = None,
    ) -> LLMResponse:
        last_error: Exception | None = None
        url = f"{self.base_url}/chat/completions"
        client = _get_shared_client()

        for attempt in range(self.max_retries):
            try:
                payload: dict[str, Any] = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "stream": False,
                }
                if response_format:
                    payload["response_format"] = response_format
                resp = await client.post(
                    url, headers=self._headers(), json=payload, timeout=self.timeout,
                )
                resp.raise_for_status()
                data = resp.json()
                message = data["choices"][0].get("message", {}) or {}
                content = message.get("content") or message.get("reasoning_content") or ""
                usage = data.get("usage", {})
                return LLMResponse(
                    content=content,
                    model=data.get("model", self.model),
                    prompt_tokens=usage.get("prompt_tokens", 0),
                    completion_tokens=usage.get("completion_tokens", 0),
                    total_tokens=usage.get("total_tokens", 0),
                )
            except httpx.TimeoutException as e:
                last_error = e
                logger.warning("%s timeout (attempt %d/%d)", self.provider_name, attempt + 1, self.max_retries)
            except httpx.HTTPStatusError as e:
                last_error = e
                logger.warning("%s HTTP %d (attempt %d/%d)", self.provider_name, e.response.status_code, attempt + 1, self.max_retries)
            except Exception as e:
                last_error = e
                logger.warning("%s error (attempt %d/%d): %s", self.provider_name, attempt + 1, self.max_retries, e)

        raise RuntimeError(f"{self.provider_name} failed after {self.max_retries} retries: {last_error}")

    async def stream_completion_with_messages(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        url = f"{self.base_url}/chat/completions"
        client = _get_shared_client()
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        async with client.stream(
            "POST", url, headers=self._headers(), json=payload, timeout=self.timeout,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:]
                if chunk.strip() == "[DONE]":
                    break
                try:
                    data = json.loads(chunk)
                    delta = data["choices"][0].get("delta", {}) or {}
                    content = delta.get("content") or delta.get("reasoning_content") or ""
                    if content:
                        yield content
                    if data["choices"][0].get("finish_reason") == "length":
                        yield "\n\n[回答因长度限制被截断，请尝试更具体的提问]"
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_llm_provider() -> BaseLLMProvider:
    """Create LLM provider based on config settings."""
    provider_name = settings.llm_provider

    if provider_name in PROVIDER_PRESETS:
        preset = PROVIDER_PRESETS[provider_name]
        # Use explicit config if set, otherwise fall back to preset
        base_url = settings.llm_api_base_url or preset["base_url"]
        model = settings.llm_model or preset["model"]
        api_key = settings.llm_api_key
    else:
        # Custom provider: require explicit config
        base_url = settings.llm_api_base_url
        model = settings.llm_model
        api_key = settings.llm_api_key
        preset = {"description": "custom"}

    if not base_url:
        raise ValueError(f"LLM API base URL not configured for provider '{provider_name}'")
    if not api_key:
        raise ValueError(f"LLM API key not configured for provider '{provider_name}'")

    logger.info(
        "LLM provider: %s | model=%s | endpoint=%s",
        provider_name, model, base_url,
    )

    return OpenAICompatibleProvider(
        base_url=base_url,
        api_key=api_key,
        model=model,
        timeout=settings.llm_timeout,
        max_retries=settings.llm_max_retries,
        provider_name=provider_name,
    )


# ---------------------------------------------------------------------------
# Module-level singleton (lazy initialization — avoids crash on import
# when API key is not yet configured, e.g. during testing)
# ---------------------------------------------------------------------------

_llm_provider: BaseLLMProvider | None = None
_init_error: str | None = None


def get_llm_provider() -> BaseLLMProvider:
    """Get or lazily create the LLM provider singleton."""
    global _llm_provider, _init_error
    if _llm_provider is None:
        try:
            _llm_provider = create_llm_provider()
            _init_error = None
        except ValueError as e:
            _init_error = str(e)
            raise
    return _llm_provider


# For backward compatibility: import-time access returns None rather than crashing.
# All call sites should use get_llm_provider() for safety, or handle the None case.
try:
    llm_provider: BaseLLMProvider | None = create_llm_provider()
except ValueError as e:
    _init_error = str(e)
    logger.warning("LLM provider not initialized (API key not configured): %s", e)
    llm_provider = None  # type: ignore[assignment]


# Backward compatibility alias
class MimoClient:
    """Backward-compatible wrapper around the unified LLM provider."""
    def __init__(self):
        self._provider = llm_provider

    async def chat_completion(self, *args, **kwargs):
        return await self._provider.chat_completion(*args, **kwargs)

    async def stream_completion(self, *args, **kwargs):
        return await self._provider.stream_completion(*args, **kwargs)

    async def chat_completion_with_messages(self, *args, **kwargs):
        return await self._provider.chat_completion_with_messages(*args, **kwargs)

    async def stream_completion_with_messages(self, *args, **kwargs):
        return await self._provider.stream_completion_with_messages(*args, **kwargs)


mimo_client = MimoClient()
