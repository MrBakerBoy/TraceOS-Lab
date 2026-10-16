"""
Observability — OpenTelemetry + Langfuse full-stack tracing.

Aligns with OpenTelemetry gen_ai semantic conventions for:
  - gen_ai.client span: LLM API calls (latency, tokens, model, finish_reason)
  - gen_ai.tool span: Tool executions (name, arguments redacted, success, latency)
  - gen_ai.agent span: Agent task lifecycle (total_tokens, duration, handoff)

Langfuse is used as the tracing backend with OTel-native integration.
When Langfuse is not configured, falls back to structured JSON logging.
"""

import json
import logging
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator

logger = logging.getLogger(__name__)


# ============================================================================
# Span Types (aligns with OpenTelemetry gen_ai convention)
# ============================================================================

class SpanKind(str, Enum):
    CLIENT = "gen_ai.client"     # LLM API call
    TOOL = "gen_ai.tool"        # Tool execution
    AGENT = "gen_ai.agent"      # Agent task lifecycle
    SESSION = "gen_ai.session"  # Full conversation session


# ============================================================================
# Trace Data Models
# ============================================================================

@dataclass
class TraceSpan:
    """Single trace span aligned with OTel gen_ai conventions."""
    span_id: str
    parent_id: str = ""
    kind: SpanKind = SpanKind.AGENT
    name: str = ""
    start_time: float = 0.0
    end_time: float = 0.0
    duration_ms: float = 0.0
    status: str = "ok"  # ok | error

    # gen_ai.client attributes
    model: str = ""
    provider: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    finish_reason: str = ""
    temperature: float = 0.0

    # gen_ai.tool attributes
    tool_name: str = ""
    tool_arguments: str = ""       # Redacted
    tool_success: bool = False
    tool_retry_count: int = 0

    # gen_ai.agent attributes
    agent_name: str = ""
    task: str = ""
    task_completion: str = ""     # success | partial | failed
    handoff_target: str = ""

    # Metadata
    error_message: str = ""
    tags: dict = field(default_factory=dict)
    custom_attributes: dict = field(default_factory=dict)


@dataclass
class TraceSession:
    """Top-level trace for a complete conversation session."""
    session_id: str
    user_id: str = ""
    spans: list = field(default_factory=list)
    start_time: float = 0.0
    total_tokens: int = 0
    total_cost_estimate: float = 0.0
    task_resolution: str = ""     # resolved | escalated | abandoned


# ============================================================================
# Trace Exporter Interface
# ============================================================================

class TraceExporter:
    """Abstract trace exporter. Implementations: Langfuse, Console, File."""

    async def export_span(self, span: TraceSpan):
        pass

    async def export_session(self, session: TraceSession):
        pass

    async def flush(self):
        pass


class ConsoleTraceExporter(TraceExporter):
    """Fallback: log spans as structured JSON to the logger."""

    async def export_span(self, span: TraceSpan):
        data = {
            "trace_id": span.span_id,
            "parent_id": span.parent_id,
            "kind": span.kind,
            "name": span.name,
            "duration_ms": span.duration_ms,
            "status": span.status,
            "model": span.model,
            "total_tokens": span.total_tokens,
            "tool_name": span.tool_name,
            "tool_success": span.tool_success,
            "agent_name": span.agent_name,
            "task_completion": span.task_completion,
        }
        if span.error_message:
            data["error"] = span.error_message
        logger.info("TRACE: %s", json.dumps(data, ensure_ascii=False, default=str))

    async def export_session(self, session: TraceSession):
        logger.info("SESSION: %s spans=%d tokens=%d resolution=%s",
                    session.session_id, len(session.spans),
                    session.total_tokens, session.task_resolution)


class LangfuseExporter(TraceExporter):
    """Langfuse-based trace exporter using OTel bridge.

    Requires: pip install langfuse openinference-instrumentation-langchain
    When Langfuse is properly configured, spans are sent to the Langfuse
    dashboard for visualization and analysis.
    """

    def __init__(self, public_key: str = "", secret_key: str = "", host: str = ""):
        self._configured = bool(public_key and secret_key)
        self._public_key = public_key
        self._secret_key = secret_key
        self._host = host or "https://cloud.langfuse.com"
        self._client = None

    @property
    def available(self) -> bool:
        return self._configured

    async def _ensure_client(self):
        if self._client is None and self._configured:
            try:
                from langfuse import Langfuse
                self._client = Langfuse(
                    public_key=self._public_key,
                    secret_key=self._secret_key,
                    host=self._host,
                )
                logger.info("Langfuse client initialized")
            except ImportError:
                logger.warning("langfuse package not installed — using console fallback")
                self._configured = False
            except Exception as e:
                logger.warning("Langfuse init failed: %s", e)
                self._configured = False

    async def export_span(self, span: TraceSpan):
        await self._ensure_client()
        if not self._client:
            return
        try:
            trace = self._client.trace(
                id=span.span_id,
                name=span.name,
                metadata={
                    "kind": span.kind,
                    "model": span.model,
                    "total_tokens": span.total_tokens,
                    "duration_ms": span.duration_ms,
                },
            )
            if span.kind == SpanKind.CLIENT:
                trace.generation(
                    name=span.name,
                    model=span.model,
                    usage={"prompt_tokens": span.prompt_tokens, "completion_tokens": span.completion_tokens},
                    metadata={"finish_reason": span.finish_reason, "temperature": span.temperature},
                )
            elif span.kind == SpanKind.TOOL:
                trace.span(
                    name=span.name,
                    metadata={"tool_name": span.tool_name, "success": span.tool_success, "retry_count": span.tool_retry_count},
                )
        except Exception as e:
            logger.warning("Langfuse export failed: %s", e)


# ============================================================================
# Observability Manager
# ============================================================================

class ObservabilityManager:
    """Central observability controller.

    Manages trace sessions, spans, and exporters. Provides context managers
    for automatic span timing and error handling.
    """

    def __init__(self):
        self._exporters: list[TraceExporter] = [ConsoleTraceExporter()]
        self._active_sessions: dict[str, TraceSession] = {}
        self._span_counter: int = 0

    def add_exporter(self, exporter: TraceExporter):
        self._exporters.append(exporter)

    def configure_langfuse(self, public_key: str, secret_key: str, host: str = ""):
        """Configure Langfuse as the primary trace backend."""
        lf = LangfuseExporter(public_key, secret_key, host)
        if lf.available:
            self._exporters.insert(0, lf)
            logger.info("Langfuse tracing enabled")

    def start_session(self, session_id: str, user_id: str = "") -> TraceSession:
        """Start a new trace session."""
        session = TraceSession(
            session_id=session_id,
            user_id=user_id,
            start_time=time.monotonic(),
        )
        self._active_sessions[session_id] = session
        logger.debug("Trace session started: %s", session_id)
        return session

    async def end_session(self, session_id: str, resolution: str = "resolved"):
        """End a trace session and export."""
        session = self._active_sessions.pop(session_id, None)
        if session is None:
            return
        session.task_resolution = resolution
        # Sum tokens across all spans
        session.total_tokens = sum(s.total_tokens for s in session.spans)
        for exporter in self._exporters:
            await exporter.export_session(session)

    def _next_span_id(self) -> str:
        self._span_counter += 1
        return f"span_{self._span_counter}_{int(time.time() * 1000)}"

    async def record_llm_call(
        self,
        session_id: str,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        latency_ms: float,
        finish_reason: str = "stop",
        error: str = "",
        temperature: float = 0.3,
    ):
        """Record a gen_ai.client span (LLM API call)."""
        span = TraceSpan(
            span_id=self._next_span_id(),
            kind=SpanKind.CLIENT,
            name=f"llm.{model}",
            start_time=time.monotonic() - latency_ms / 1000,
            end_time=time.monotonic(),
            duration_ms=latency_ms,
            status="error" if error else "ok",
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
            finish_reason=finish_reason,
            temperature=temperature,
            error_message=error,
        )
        await self._export_span(session_id, span)

    async def record_tool_call(
        self,
        session_id: str,
        tool_name: str,
        success: bool,
        latency_ms: float,
        retry_count: int = 0,
        error: str = "",
    ):
        """Record a gen_ai.tool span (tool execution)."""
        span = TraceSpan(
            span_id=self._next_span_id(),
            kind=SpanKind.TOOL,
            name=f"tool.{tool_name}",
            start_time=time.monotonic() - latency_ms / 1000,
            end_time=time.monotonic(),
            duration_ms=latency_ms,
            status="error" if error else "ok",
            tool_name=tool_name,
            tool_success=success,
            tool_retry_count=retry_count,
            error_message=error,
        )
        await self._export_span(session_id, span)

    async def record_agent_task(
        self,
        session_id: str,
        agent_name: str,
        task: str,
        completion: str,
        latency_ms: float,
        total_tokens: int = 0,
        handoff_target: str = "",
        error: str = "",
    ):
        """Record a gen_ai.agent span (agent task lifecycle)."""
        span = TraceSpan(
            span_id=self._next_span_id(),
            kind=SpanKind.AGENT,
            name=f"agent.{agent_name}",
            start_time=time.monotonic() - latency_ms / 1000,
            end_time=time.monotonic(),
            duration_ms=latency_ms,
            status="error" if error else "ok",
            agent_name=agent_name,
            task=task,
            task_completion=completion,
            handoff_target=handoff_target,
            total_tokens=total_tokens,
            error_message=error,
        )
        await self._export_span(session_id, span)

    async def _export_span(self, session_id: str, span: TraceSpan):
        """Export a span to all configured exporters."""
        session = self._active_sessions.get(session_id)
        if session:
            session.spans.append(span)
        for exporter in self._exporters:
            await exporter.export_span(span)

    @asynccontextmanager
    async def trace_llm_call(self, session_id: str, model: str, temperature: float = 0.3):
        """Context manager for tracing an LLM call."""
        start = time.monotonic()
        error = ""
        try:
            yield
        except Exception as e:
            error = str(e)
            raise
        finally:
            latency_ms = (time.monotonic() - start) * 1000
            await self.record_llm_call(
                session_id=session_id,
                model=model,
                prompt_tokens=0,  # Will be updated by caller
                completion_tokens=0,
                latency_ms=latency_ms,
                error=error,
                temperature=temperature,
            )

    @asynccontextmanager
    async def trace_tool_call(self, session_id: str, tool_name: str):
        """Context manager for tracing a tool call."""
        start = time.monotonic()
        success = True
        error = ""
        try:
            yield
        except Exception as e:
            success = False
            error = str(e)
            raise
        finally:
            latency_ms = (time.monotonic() - start) * 1000
            await self.record_tool_call(
                session_id=session_id,
                tool_name=tool_name,
                success=success,
                latency_ms=latency_ms,
                error=error,
            )

    async def flush(self):
        """Flush all pending trace data."""
        for exporter in self._exporters:
            await exporter.flush()

    def get_status(self) -> dict:
        """Get observability status for health checks."""
        return {
            "active_sessions": len(self._active_sessions),
            "total_spans": self._span_counter,
            "exporters": [type(e).__name__ for e in self._exporters],
        }


# ============================================================================
# Alert Rules
# ============================================================================

class AlertRule:
    """Observability alert rule."""

    def __init__(self, name: str, condition: str, threshold: float):
        self.name = name
        self.condition = condition
        self.threshold = threshold

    def check(self, metrics: dict) -> bool:
        """Return True if alert should fire."""
        value = metrics.get(self.condition, 0)
        return value > self.threshold


DEFAULT_ALERTS = [
    AlertRule("tool_failure_rate", "tool_failure_pct", 10.0),
    AlertRule("latency_p95", "latency_p95_ms", 5000.0),
    AlertRule("cost_anomaly", "session_cost_usd", 2.0),
]


# ============================================================================
# Singleton
# ============================================================================

_obs_manager: ObservabilityManager | None = None


def get_observability() -> ObservabilityManager:
    global _obs_manager
    if _obs_manager is None:
        _obs_manager = ObservabilityManager()
    return _obs_manager
