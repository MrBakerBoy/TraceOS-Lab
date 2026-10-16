"""ObsContext Injector — deserializes ObsContext and injects into diagnosis/chat agents.

Design principles:
  - Context Firewall: each agent receives only its domain slice
  - Progressive disclosure: Tier 1 always, Tier 2/3 on demand
  - 40% token budget (Anthropic Context Anxiety threshold)
  - OTel GenAI semantic convention alignment
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

MAX_DIAGNOSIS_TOKENS = 40000
MAX_CHAT_TOKENS = 8000
CHARS_PER_TOKEN = 4

AGENT_DOMAINS = {
    "code_analyzer": ["submission_id", "experiment_type", "language", "health_score", "source_annotations", "concept_tags"],
    "test_evaluator": ["submission_id", "experiment_type", "health_score", "red_metrics", "use_metrics", "anomaly_summary"],
    "syscall_analyzer": ["submission_id", "experiment_type", "syscall_traces", "process_graph", "event_annotations", "risk_indicators", "lock_events"],
    "concept_rubric": ["submission_id", "experiment_type", "source_annotations", "health_score", "concept_tags"],
    "evaluator": ["submission_id", "experiment_type", "health_score", "risk_indicators", "anomaly_summary", "diff_vs_baseline"],
    "diagnosis_orchestrator": ["*"],
    "chat_agent": ["submission_id", "experiment_type", "language", "health_score", "anomaly_summary", "syscall_traces", "flamegraph", "memory_snapshots", "lock_events", "event_annotations", "risk_indicators", "concept_tags"],
}

def estimate_tokens(text):
    if not text:
        return 0
    return max(1, len(text) // CHARS_PER_TOKEN)

@dataclass
class ObsContext:
    submission_id: str = ""
    experiment_id: str = ""
    student_id: str = ""
    experiment_type: str = ""
    language: str = ""
    timeline_start: str = ""
    timeline_end: str = ""
    health_score: dict = field(default_factory=dict)
    red_metrics: dict = field(default_factory=dict)
    use_metrics: dict = field(default_factory=dict)
    anomaly_summary: list = field(default_factory=list)
    diff_vs_baseline: Optional[dict] = None
    process_graph: Optional[dict] = None
    syscall_traces: list = field(default_factory=list)
    flamegraph: Optional[dict] = None
    memory_snapshots: list = field(default_factory=list)
    lock_events: list = field(default_factory=list)
    resource_metrics: list = field(default_factory=list)
    perf_events: list = field(default_factory=list)
    flamegraph_diff2: Optional[dict] = None
    flamegraph_diff1: Optional[dict] = None
    call_chains: list = field(default_factory=list)
    source_annotations: list = field(default_factory=list)
    io_flamegraph: Optional[dict] = None
    mem_alloc_flamegraph: Optional[dict] = None
    lock_contention_fg: Optional[dict] = None
    sched_events: list = field(default_factory=list)
    race_reports: list = field(default_factory=list)
    deadlock_evolution: Optional[dict] = None
    leak_reports: list = field(default_factory=list)
    span_tree: Optional[dict] = None
    event_annotations: list = field(default_factory=list)
    filter_facets: list = field(default_factory=list)
    risk_indicators: Optional[dict] = None
    ai_annotations: list = field(default_factory=list)
    concept_tags: list = field(default_factory=list)

    @classmethod
    def from_json(cls, data):
        if isinstance(data, str):
            raw = json.loads(data)
        else:
            raw = data
        return cls(**{k: v for k, v in raw.items() if hasattr(cls, k)})

    def to_dict(self):
        return {f.name: getattr(self, f.name) for f in self.__dataclass_fields__.values()}

class ObsContextInjector:
    def __init__(self):
        self._context = None

    def load(self, ctx):
        self._context = ctx

    def load_json(self, data):
        self._context = ObsContext.from_json(data)

    def inject_for_diagnosis(self, agent_name):
        if self._context is None:
            return ""
        domain = AGENT_DOMAINS.get(agent_name)
        if domain is None:
            return json.dumps(self._context.to_dict(), ensure_ascii=False, indent=2)
        if "*" in domain:
            ctx_dict = self._context.to_dict()
        else:
            ctx_dict = {k: self._context.to_dict().get(k) for k in domain if k in self._context.to_dict()}
        enriched = self._enrich_with_semantics(ctx_dict, agent_name)
        tokens = estimate_tokens(enriched)
        if tokens > MAX_DIAGNOSIS_TOKENS:
            enriched = self._truncate_to_budget(enriched, MAX_DIAGNOSIS_TOKENS)
        return enriched

    def inject_for_diagnosis_json(self, agent_name):
        if self._context is None:
            return "{}"
        domain = AGENT_DOMAINS.get(agent_name, [])
        ctx_dict = self._context.to_dict()
        if "*" in domain:
            sliced = ctx_dict
        else:
            sliced = {k: ctx_dict.get(k) for k in domain if k in ctx_dict}
        return json.dumps(sliced, ensure_ascii=False)

    def inject_for_chat(self, tier=1):
        if self._context is None:
            return ""
        parts = []
        parts.append(self._format_tier1_compact())
        if tier >= 2 or self._context.health_score.get('active_anomalies', 0) > 0:
            parts.append(self._format_tier2_compact())
        if tier >= 3:
            parts.append(self._format_tier3_compact())
        result = "\n\n".join(parts)
        tokens = estimate_tokens(result)
        if tokens > MAX_CHAT_TOKENS:
            result = self._truncate_to_budget(result, MAX_CHAT_TOKENS)
        return result

    def _enrich_with_semantics(self, ctx_dict, agent_name):
        lines = []
        lines.append("# TraceOS 观测诊断上下文")
        lines.append(f"**实验类型**: {ctx_dict.get('experiment_type', 'N/A')} | **提交ID**: {ctx_dict.get('submission_id', 'N/A')}")
        lines.append("")
        hs = ctx_dict.get("health_score", {})
        if hs:
            lines.append("## 健康概览")
            lines.append(f"- 评分: {hs.get('score', 'N/A')}/100 ({hs.get('trend_direction', 'N/A')})")
            lines.append(f"- 活跃异常: {hs.get('active_anomalies', 0)}")
            lines.append("")
        anomalies = ctx_dict.get("anomaly_summary", [])
        if anomalies:
            lines.append("### 检测到的问题")
            for a in anomalies[:5]:
                lines.append(f"- [{a.get('severity', '?')}] {a.get('type', '?')}: {a.get('summary', '')}")
            lines.append("")
        traces = ctx_dict.get("syscall_traces", [])
        if traces:
            by_label = {}
            for t in traces:
                label = t.get('semantic_label') or t.get('syscall', 'unknown')
                by_label[label] = by_label.get(label, 0) + 1
            lines.append("### 系统调用语义标注")
            for label, count in sorted(by_label.items(), key=lambda x: -x[1])[:10]:
                lines.append(f"- **{label}**: {count} 次")
            lines.append("")
        risk = ctx_dict.get('risk_indicators')
        if risk:
            lines.append("### 复合风险指标")
            lines.append(f"- 饱和度: {risk.get('saturation_index', 0):.2f}")
            lines.append(f"- 依赖风险: {risk.get('dependency_risk', 0):.2f}")
            lines.append(f"- OOM风险: {risk.get('oom_risk_rate', 0):.2f}")
            lines.append("")
        lines.append("## 原始结构化数据 (JSON)")
        lines.append("")
        return "\n".join(lines)

    def _format_tier1_compact(self):
        ctx = self._context
        if ctx is None:
            return ""
        hs = ctx.health_score
        red = ctx.red_metrics
        use = ctx.use_metrics
        lines = ["## 运行概览"]
        lines.append(f"健康评分: {hs.get('score', '?')}/100 | 趋势: {hs.get('trend_direction', '?')} | 异常: {hs.get('active_anomalies', 0)}")
        lines.append(f"错误率: {red.get('error_rate', 0):.1f}% | P95延迟: {red.get('duration_p95', 0):.1f}ms | CPU: {use.get('cpu_utilization', 0):.1f}% | 内存: {use.get('mem_utilization', 0):.1f}%")
        anomalies = ctx.anomaly_summary
        if anomalies:
            lines.append("检测到的问题:")
            for a in anomalies[:5]:
                lines.append(f"  - [{a.get('severity', '?')}] {a.get('type', '?')}: {a.get('summary', '')}")
        return "\n".join(lines)

    def _format_tier2_compact(self):
        ctx = self._context
        if ctx is None:
            return ""
        lines = ["## 进程分析"]
        traces = ctx.syscall_traces
        locks = ctx.lock_events
        mem = ctx.memory_snapshots
        fg = ctx.flamegraph
        pg = ctx.process_graph
        lines.append(f"系统调用: {len(traces)} | 锁事件: {len(locks)} | 内存快照: {len(mem)}")
        if fg:
            hot = fg.get("hot_functions", [])
            lines.append(f"火焰图: {fg.get('total_samples', 0)} 样本 | 热点: {len(hot)}")
            if hot:
                lines.append("Top 3 热点:")
                for h in hot[:3]:
                    lines.append(f"  - {h.get('name', '?')} ({h.get('percentage', 0):.1f}%)")
        if pg:
            meta = pg.get("metadata", {})
            lines.append(f"进程拓扑: {meta.get('total_processes', 0)} 进程, {meta.get('total_threads', 0)} 线程")
        return "\n".join(lines)

    def _format_tier3_compact(self):
        ctx = self._context
        if ctx is None:
            return ""
        lines = ["## 函数级分析"]
        if ctx.call_chains:
            lines.append(f"调用链: {len(ctx.call_chains)} 条")
        if ctx.source_annotations:
            lines.append(f"源码标注: {len(ctx.source_annotations)} 处")
        if ctx.race_reports:
            lines.append(f"数据竞争: {len(ctx.race_reports)} 处")
        if ctx.leak_reports:
            lines.append(f"内存泄漏: {len(ctx.leak_reports)} 处")
        if ctx.deadlock_evolution:
            steps = ctx.deadlock_evolution.get("steps", [])
            if steps:
                lines.append(f"死锁演化: {len(steps)} 步")
        return "\n".join(lines)

    @staticmethod
    def _truncate_to_budget(text, max_tokens):
        max_chars = max_tokens * CHARS_PER_TOKEN
        if len(text) <= max_chars:
            return text
        head = max_chars * 3 // 4
        tail = max_chars // 4
        result = text[:head]
        result += f"\n\n... [上下文已截断 — 超出 {max_tokens} token 预算] ...\n\n"
        if tail > 0:
            tail_start = len(text) - tail
            if tail_start > head:
                result += "---\n"
                result += text[tail_start:]
        return result

obs_injector = ObsContextInjector()
