"""
DEPRECATED: Legacy MimoClient compatibility module.

All new code should use `from app.services.llm_client import llm_provider` directly.
This module is kept only for backward compatibility with existing importers.
"""

from app.services.llm_client import (
    llm_provider,
    LLMResponse,
    MimoResponse,  # DEPRECATED alias for LLMResponse
    MimoClient as _LLMClient,
)

# Module-level singleton (DEPRECATED - use llm_provider instead)
mimo_client = _LLMClient()
