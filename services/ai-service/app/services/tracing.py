"""OpenTelemetry + Langfuse 插桩服务 (Phase 3)

提供 gen_ai.client / gen_ai.agent / gen_ai.tool span 统一封装。
降级: OTel/Langfuse 未安装时使用轻量内存 span (no-op)。
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

logger = logging.getLogger(__name__)


@dataclass
class SimpleSpan:
    name: str
    span_id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    trace_id: str = field(default_factory=lambda: uuid.uuid4().hex[:32])
    parent_id: str | None = None
    start_time: float = field(default_factory=time.time)
    end_time: float | None = None
    attributes: dict[str, Any] = field(default_factory=dict)
    status: str = "ok"
    events: list[dict] = field(default_factory=list)

    def set_attribute(self, key, value):
        self.attributes[key] = value

    def add_event(self, name, **kw):
        self.events.append({"name": name, "ts": time.time(), **kw})

    def set_error(self, error):
        self.status = "error"
        self.add_event("exception", message=error)

    def end(self):
        self.end_time = time.time()

    @property
    def duration_ms(self):
        return ((self.end_time or time.time()) - self.start_time) * 1000


class OTelSpanAdapter(SimpleSpan):
    def __init__(self, name, otel_span, parent=None):
        self.name = name
        self._otel = otel_span
        self.span_id = uuid.uuid4().hex[:16]
        self.trace_id = parent.trace_id if parent else uuid.uuid4().hex[:32]
        self.parent_id = parent.span_id if parent else None
        self.start_time = time.time()
        self.end_time = None
        self.attributes = {}
        self.status = "ok"
        self.events = []

    def set_attribute(self, key, value):
        self.attributes[key] = value
        try:
            self._otel.set_attribute(key, str(value))
        except Exception:
            pass

    def add_event(self, name, **kw):
        self.events.append({"name": name, "ts": time.time(), **kw})

    def set_error(self, error):
        self.status = "error"
        try:
            from opentelemetry.trace import Status, StatusCode
            self._otel.set_status(Status(StatusCode.ERROR, error))
        except Exception:
            pass

    def end(self):
        self.end_time = time.time()
        try:
            self._otel.end()
        except Exception:
            pass


class TracingService:
    def __init__(self):
        self._otel_tracer = None
        self._langfuse = None
        self._enabled = False
        self._spans: list[SimpleSpan] = []

        try:
            from opentelemetry import trace as otel_trace
            self._otel_tracer = otel_trace.get_tracer("traceos-ai-service")
            self._enabled = True
            logger.info("OTel tracer initialized")
        except ImportError:
            logger.info("opentelemetry not installed, using SimpleSpan fallback")

        try:
            import os
            if os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY"):
                from langfuse import Langfuse
                self._langfuse = Langfuse()
                logger.info("Langfuse client initialized")
        except ImportError:
            pass
        except Exception as e:
            logger.debug("Langfuse init skipped: %s", e)

    def start_span(self, name, parent=None, **attrs):
        if self._otel_tracer:
            try:
                otel_span = self._otel_tracer.start_as_current_span(name)
                for k, v in attrs.items():
                    otel_span.set_attribute(k, str(v))
                return OTelSpanAdapter(name, otel_span, parent)
            except Exception:
                pass
        span = SimpleSpan(
            name=name,
            parent_id=parent.span_id if parent else None,
            trace_id=parent.trace_id if parent else None,
            attributes=attrs,
        )
        self._spans.append(span)
        return span

    def gen_ai_agent_span(self, agent_name, parent=None):
        return self.start_span(f"gen_ai.agent.{agent_name}", parent,
                               **{"gen_ai.agent.name": agent_name})

    def gen_ai_client_span(self, model, parent=None):
        return self.start_span("gen_ai.client.chat", parent,
                               **{"gen_ai.request.model": model})

    def gen_ai_tool_span(self, tool_name, parent=None):
        return self.start_span(f"gen_ai.tool.{tool_name}", parent,
                               **{"gen_ai.tool.name": tool_name})

    def end_span(self, span, **result_attrs):
        for k, v in result_attrs.items():
            span.set_attribute(k, str(v))
        span.end()
        if self._langfuse and isinstance(span, SimpleSpan):
            try:
                self._langfuse.trace(
                    name=span.name, trace_id=span.trace_id,
                    span_id=span.span_id, parent_id=span.parent_id,
                    start_time=span.start_time,
                    end_time=span.end_time or time.time(),
                    metadata=span.attributes,
                )
            except Exception:
                pass

    @property
    def enabled(self):
        return self._enabled

    def get_recent_spans(self, limit=50):
        return [{"name": s.name, "span_id": s.span_id, "trace_id": s.trace_id,
                 "duration_ms": s.duration_ms, "status": s.status,
                 "attributes": s.attributes} for s in self._spans[-limit:]]


_tracing_service: TracingService | None = None


def get_tracing_service() -> TracingService:
    global _tracing_service
    if _tracing_service is None:
        _tracing_service = TracingService()
    return _tracing_service


@asynccontextmanager
async def trace_agent(agent_name, parent=None):
    svc = get_tracing_service()
    span = svc.gen_ai_agent_span(agent_name, parent)
    try:
        yield span
    except Exception as e:
        span.set_error(str(e))
        raise
    finally:
        svc.end_span(span, **{"gen_ai.agent.duration_ms": span.duration_ms})
