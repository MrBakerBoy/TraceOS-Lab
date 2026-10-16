"""可观测层 (Observability)

三大能力:
  1. OpenTelemetry Tracing — gen_ai.client / gen_ai.agent / gen_ai.tool spans
  2. Langfuse 集成 — 全链路可视化 + Token 成本归因
  3. Token 成本归因 — 每次诊断的 token / 成本汇总

设计原则:
  - 零侵入插桩: 通过 monkey-patch 或装饰器注入, 不修改核心逻辑
  - 优雅降级: OTel SDK 未安装时回退到 logging 模式
  - Lifecycle Hooks: before_llm_call / after_llm_call 注入点 (Harness 组件8)
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from functools import wraps
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# ============================================================================
# OTel 可用性检测 (优雅降级)
# ============================================================================

OTEL_AVAILABLE = False
try:
    from opentelemetry import trace
    from opentelemetry.trace import Span, SpanKind, Status, StatusCode
    OTEL_AVAILABLE = True
except ImportError:
    class _NoopSpan:
        def set_attribute(self, *a, **kw): pass
        def set_status(self, *a, **kw): pass
        def add_event(self, *a, **kw): pass
        def end(self, *a, **kw): pass
    class _NoopTracer:
        def start_as_current_span(self, *a, **kw):
            return _NoopSpan()
        def start_span(self, *a, **kw):
            return _NoopSpan()
    trace = type("obj", (), {"get_tracer": lambda *a, **kw: _NoopTracer()})()
    SpanKind = type("obj", (), {"INTERNAL": "INTERNAL", "CLIENT": "CLIENT"})()
    StatusCode = type("obj", (), {"OK": "OK", "ERROR": "ERROR"})()

LANGFUSE_AVAILABLE = os.environ.get("LANGFUSE_PUBLIC_KEY") is not None

# ============================================================================
# Tracer 单例
# ============================================================================

_TRACER_NAME = "traceos.ai-service"
tracer = trace.get_tracer(_TRACER_NAME)

# Langfuse 客户端 (lazy init)
_langfuse_client = None


def get_langfuse_client():
    global _langfuse_client
    if _langfuse_client is None and LANGFUSE_AVAILABLE:
        try:
            from langfuse import Langfuse
            _langfuse_client = Langfuse(
                public_key=os.environ.get("LANGFUSE_PUBLIC_KEY", ""),
                secret_key=os.environ.get("LANGFUSE_SECRET_KEY", ""),
                host=os.environ.get("LANGFUSE_HOST", "https://cloud.langfuse.com"),
            )
            logger.info("Langfuse client initialized")
        except ImportError:
            logger.info("langfuse package not installed, tracing via OTel only")
        except Exception as e:
            logger.warning("Langfuse init failed: %s", e)
    return _langfuse_client


# ============================================================================
# Span 类型定义 (对齐 gen_ai 语义约定)
# ============================================================================

@dataclass
class TraceContext:
    """一次诊断的 Tracing 上下文."""
    trace_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    submission_id: str = ""
    experiment_id: str = ""
    student_id: str = ""
    start_time: float = 0.0
    spans: list[dict[str, Any]] = field(default_factory=list)


# ============================================================================
# Lifecycle Hooks (组件8)
# ============================================================================

@contextmanager
def trace_agent_call(
    agent_name: str,
    trace_ctx: TraceContext | None = None,
    attributes: dict[str, Any] | None = None,
):
    """Agent 调用 Span: gen_ai.agent.

    Usage:
        with trace_agent_call("code_analyzer", trace_ctx, {"model": "deepseek-v4"}):
            result = await agent.analyze(ctx_slice)
    """
    span_name = f"gen_ai.agent.{agent_name}"
    span = tracer.start_span(span_name, kind=SpanKind.INTERNAL)
    span.set_attribute("gen_ai.agent.name", agent_name)
    span.set_attribute("gen_ai.system", "traceos.diagnosis")

    if trace_ctx:
        span.set_attribute("traceos.trace_id", trace_ctx.trace_id)
        span.set_attribute("traceos.submission_id", trace_ctx.submission_id)

    if attributes:
        for k, v in attributes.items():
            span.set_attribute(f"gen_ai.agent.{k}", v)

    start = time.monotonic()
    try:
        yield span
        span.set_status(Status(StatusCode.OK))
    except Exception as e:
        span.set_status(Status(StatusCode.ERROR, str(e)))
        span.record_exception(e)
        raise
    finally:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        span.set_attribute("gen_ai.agent.duration_ms", elapsed_ms)
        span.end()


@contextmanager
def trace_llm_call(
    agent_name: str,
    model: str = "unknown",
    trace_ctx: TraceContext | None = None,
):
    """LLM 调用 Span: gen_ai.client.

    Usage:
        with trace_llm_call("evaluator", "deepseek-v4") as llm_span:
            resp = await llm.chat_completion(...)
            llm_span.set_attribute("gen_ai.usage.prompt_tokens", resp.prompt_tokens)
    """
    span = tracer.start_span("gen_ai.client", kind=SpanKind.CLIENT)
    span.set_attribute("gen_ai.system", "traceos.llm")
    span.set_attribute("gen_ai.request.model", model)
    span.set_attribute("gen_ai.agent.name", agent_name)

    if trace_ctx:
        span.set_attribute("traceos.trace_id", trace_ctx.trace_id)

    start = time.monotonic()
    try:
        yield span
        span.set_status(Status(StatusCode.OK))
    except Exception as e:
        span.set_status(Status(StatusCode.ERROR, str(e)))
        span.record_exception(e)
        raise
    finally:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        span.set_attribute("gen_ai.usage.latency_ms", elapsed_ms)
        span.end()


@contextmanager
def trace_tool_call(
    tool_name: str,
    agent_name: str,
    trace_ctx: TraceContext | None = None,
):
    """Tool 调用 Span: gen_ai.tool."""
    span = tracer.start_span(f"gen_ai.tool.{tool_name}", kind=SpanKind.INTERNAL)
    span.set_attribute("gen_ai.tool.name", tool_name)
    span.set_attribute("gen_ai.agent.name", agent_name)
    if trace_ctx:
        span.set_attribute("traceos.trace_id", trace_ctx.trace_id)

    start = time.monotonic()
    try:
        yield span
        span.set_status(Status(StatusCode.OK))
    except Exception as e:
        span.set_status(Status(StatusCode.ERROR, str(e)))
        span.record_exception(e)
        raise
    finally:
        span.set_attribute("gen_ai.tool.duration_ms", int((time.monotonic() - start) * 1000))
        span.end()


# ============================================================================
# 诊断级 Span (顶层)
# ============================================================================

@contextmanager
def trace_diagnosis(
    submission_id: str,
    experiment_id: str,
    student_id: str,
) -> TraceContext:
    """一次完整诊断的根 Span + TraceContext."""
    ctx = TraceContext(
        submission_id=submission_id,
        experiment_id=experiment_id,
        student_id=student_id,
        start_time=time.monotonic(),
    )

    span = tracer.start_span(
        "diagnosis.full_pipeline",
        kind=SpanKind.INTERNAL,
        attributes={
            "traceos.trace_id": ctx.trace_id,
            "traceos.submission_id": submission_id,
            "traceos.experiment_id": experiment_id,
            "traceos.student_id": student_id,
        },
    )
    ctx._root_span = span

    try:
        yield ctx
        span.set_status(Status(StatusCode.OK))
    except Exception as e:
        span.set_status(Status(StatusCode.ERROR, str(e)))
        span.record_exception(e)
        raise
    finally:
        total_ms = int((time.monotonic() - ctx.start_time) * 1000)
        span.set_attribute("diagnosis.total_duration_ms", total_ms)
        span.end()


# ============================================================================
# Token 成本归因 (Langfuse / Console)
# ============================================================================

@dataclass
class TokenUsage:
    agent_name: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_cents: float = 0.0
    duration_ms: int = 0


# 成本模型 (USD/1M tokens, 2026年参考价)
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "deepseek-chat": (0.14, 0.28),
    "deepseek-v4-pro": (0.28, 0.55),
    "mimo-v2.5": (0.50, 1.10),
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
}
DEFAULT_PRICING = (1.00, 2.00)


def estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """估算 LLM 调用成本 (USD cents)."""
    input_price, output_price = MODEL_PRICING.get(model, DEFAULT_PRICING)
    input_cost = prompt_tokens / 1_000_000 * input_price
    output_cost = completion_tokens / 1_000_000 * output_price
    return round((input_cost + output_cost) * 100, 4)  # cents


class CostTracker:
    """一次诊断的 Token 成本追踪器."""

    def __init__(self, trace_ctx: TraceContext | None = None):
        self.usages: list[TokenUsage] = []
        self.trace_ctx = trace_ctx

    def record(
        self,
        agent_name: str,
        model: str,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        total_tokens: int = 0,
        duration_ms: int = 0,
    ) -> TokenUsage:
        usage = TokenUsage(
            agent_name=agent_name,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens or (prompt_tokens + completion_tokens),
            cost_cents=estimate_cost(model, prompt_tokens, completion_tokens),
            duration_ms=duration_ms,
        )
        self.usages.append(usage)

        # 写入 Langfuse (if available)
        lf = get_langfuse_client()
        if lf and self.trace_ctx:
            try:
                lf.generation(
                    name=f"{agent_name}_llm_call",
                    model=model,
                    usage={
                        "input": prompt_tokens,
                        "output": completion_tokens,
                        "total": usage.total_tokens,
                    },
                    metadata={
                        "agent": agent_name,
                        "trace_id": self.trace_ctx.trace_id,
                        "cost_cents": usage.cost_cents,
                    },
                )
            except Exception:
                pass

        return usage

    def total_cost_cents(self) -> float:
        return round(sum(u.cost_cents for u in self.usages), 4)

    def total_tokens(self) -> int:
        return sum(u.total_tokens for u in self.usages)

    def summary(self) -> dict[str, Any]:
        return {
            "agents": [{
                "name": u.agent_name,
                "model": u.model,
                "tokens": u.total_tokens,
                "cost_cents": u.cost_cents,
                "duration_ms": u.duration_ms,
            } for u in self.usages],
            "total_cost_cents": self.total_cost_cents(),
            "total_tokens": self.total_tokens(),
        }
