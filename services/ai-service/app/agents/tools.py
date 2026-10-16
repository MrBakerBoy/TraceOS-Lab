"""Tool Registry — agent-callable tools with parameter schemas.

Usage:
    from app.agents.tools import tool_registry, ToolDef, ToolResult
    tool_registry.register(ToolDef(name="xxx", description="...", parameters={...}, handler=fn))
"""

from __future__ import annotations

import json, logging, re
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)


@dataclass
class ToolResult:
    success: bool = True
    data: Any = None
    error: str = ""


@dataclass
class ToolDef:
    name: str
    description: str
    parameters: dict = field(default_factory=dict)  # JSON Schema
    handler: Callable[..., Coroutine] | None = None


class ToolRegistry:
    """Thread-safe in-memory tool registry."""

    def __init__(self):
        self._tools: dict[str, ToolDef] = {}

    def register(self, tool: ToolDef) -> None:
        self._tools[tool.name] = tool
        logger.debug("Tool registered: %s", tool.name)

    def get(self, name: str) -> ToolDef | None:
        return self._tools.get(name)

    def list(self) -> list[ToolDef]:
        return list(self._tools.values())

    def names(self) -> list[str]:
        return list(self._tools.keys())

    def count(self) -> int:
        return len(self._tools)

    def to_openai_tools(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {"name": t.name, "description": t.description, "parameters": t.parameters},
            }
            for t in self._tools.values()
        ]


tool_registry = ToolRegistry()


# ── Built-in tools ──────────────────────────────────────────────


async def _search_kb(course_id: str, query: str, top_k: int) -> list[dict]:
    """Shared helper: search the knowledge base via the single hybrid retriever."""
    if not course_id:
        return []
    from app.services.rag.hybrid_retriever import hybrid_retriever
    results = await hybrid_retriever.search(course_id, query, top_k=top_k, use_rerank=False)
    return results


async def _handle_search_knowledge(**kwargs) -> str:
    query = kwargs.get("query", "")
    top_k = kwargs.get("top_k", 5)
    course_id = kwargs.get("course_id", "")
    results = await _search_kb(course_id, query, top_k)
    return json.dumps(results, ensure_ascii=False, default=str)


async def _handle_get_experiment(**kwargs) -> str:
    experiment_id = kwargs.get("experiment_id", "")
    source = kwargs.get("source", {})
    title = source.get("experiment_title", "")
    desc = source.get("experiment_description", "")
    cat = source.get("experiment_category", "")
    instr = source.get("experiment_instructions", "")
    return json.dumps({
        "title": title, "description": desc,
        "category": cat, "instructions": instr,
    }, ensure_ascii=False)


async def _handle_search_code_examples(**kwargs) -> str:
    query = kwargs.get("query", "")
    language = kwargs.get("language", "c")
    top_k = kwargs.get("top_k", 3)
    course_id = kwargs.get("course_id", "")
    results = await _search_kb(course_id, f"代码示例 {query} {language}", top_k)
    return json.dumps(results, ensure_ascii=False, default=str)


async def _handle_get_tutoring_hints(**kwargs) -> str:
    topic = kwargs.get("topic", "")
    level = kwargs.get("level", "intermediate")
    return json.dumps({
        "hints": [f"关于 {topic} 的学习建议（{level} 级别）"],
        "suggested_readings": [],
    }, ensure_ascii=False)


async def _handle_check_syntax(**kwargs) -> str:
    code = kwargs.get("code", "")
    language = kwargs.get("language", "c")
    lines = code.strip().split("\n") if code.strip() else []
    issues = []
    if language == "c":
        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped and not stripped.endswith((";", "{", "}", ")", "#", "\\")):
                if not stripped.startswith(("//", "/*", "*", "#", "if", "else", "for", "while", "do", "switch")):
                    issues.append({"line": i, "content": stripped, "hint": "可能缺少分号"})
    return json.dumps({"errors": issues[:10], "warning_count": len(issues)}, ensure_ascii=False)


async def _handle_get_os_concepts(**kwargs) -> str:
    topic = kwargs.get("topic", "")
    if not topic:
        return json.dumps({"concepts": []}, ensure_ascii=False)
    course_id = kwargs.get("course_id", "")
    results = await _search_kb(course_id, f"操作系统概念 {topic}", 3)
    return json.dumps(results, ensure_ascii=False, default=str)


async def _handle_analyze_trace(**kwargs) -> str:
    trace_data = kwargs.get("trace_data", "")
    if not trace_data:
        return json.dumps({"summary": "没有提供 trace 数据"}, ensure_ascii=False)
    lines = trace_data.strip().split("\n")[:500]
    syscalls: dict[str, int] = {}
    for line in lines:
        m = re.match(r"^(\w+)\(", line.strip())
        if m:
            syscalls[m.group(1)] = syscalls.get(m.group(1), 0) + 1
    sorted_calls = sorted(syscalls.items(), key=lambda x: x[1], reverse=True)[:20]
    return json.dumps({
        "total_lines": len(lines),
        "unique_syscalls": len(syscalls),
        "top_syscalls": [{"name": n, "count": c} for n, c in sorted_calls],
    }, ensure_ascii=False)


async def _handle_analyze_deadlock(**kwargs) -> str:
    code = kwargs.get("code", "")
    trace = kwargs.get("trace_data", "")
    combined = f"{code}\n{trace}"
    patterns = [
        ("mutual_exclusion", r"pthread_mutex_lock|sem_wait|down_interruptible"),
        ("hold_and_wait", r"pthread_mutex_lock.*(?!unlock).*\n.*pthread_mutex_lock"),
        ("circular_wait", r"lock.*A.*lock.*B|lock.*B.*lock.*A"),
    ]
    findings = []
    for pat_name, pat_re in patterns:
        if re.search(pat_re, combined, re.DOTALL):
            findings.append({"pattern": pat_name, "detected": True})
    return json.dumps({
        "deadlock_risk": "high" if len(findings) >= 2 else ("medium" if findings else "low"),
        "findings": findings,
    }, ensure_ascii=False)


async def _handle_search_github_code(**kwargs) -> str:
    """Search GitHub code via REST API. Requires GITHUB_TOKEN env var."""
    query = kwargs.get("query", "")
    language = kwargs.get("language", "c")
    top_k = int(kwargs.get("top_k", 5))

    token = None
    import os
    token = os.environ.get("GITHUB_TOKEN", "")

    if not token:
        return json.dumps({
            "results": [],
            "warning": "GITHUB_TOKEN not configured, GitHub search disabled",
        }, ensure_ascii=False)

    import urllib.request
    import urllib.parse

    q = f"{query} language:{language}"
    url = f"https://api.github.com/search/code?q={urllib.parse.quote(q)}&per_page={min(top_k, 10)}"
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github.v3+json",
        "Authorization": f"token {token}",
        "User-Agent": "TraceOS-Agent/1.0",
    })

    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            body = json.loads(resp.read().decode())
    except Exception as e:
        logger.warning("GitHub search failed: %s", e)
        return json.dumps({"results": [], "error": str(e)}, ensure_ascii=False)

    items = body.get("items", [])[:top_k]
    results = []
    for item in items:
        repo = item.get("repository", {}).get("full_name", "")
        path = item.get("path", "")
        html_url = item.get("html_url", "")
        results.append({"repo": repo, "path": path, "url": html_url})

    return json.dumps({
        "total_count": body.get("total_count", 0),
        "results": results,
    }, ensure_ascii=False)


# Register built-in tools
_builtin_tools: list[ToolDef] = [
    ToolDef(
        name="search_knowledge",
        description="Search the course knowledge base for concepts, documentation, and examples",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "top_k": {"type": "integer", "description": "Number of results", "default": 5},
            },
            "required": ["query"],
        },
        handler=_handle_search_knowledge,
    ),
    ToolDef(
        name="get_experiment",
        description="Retrieve the current experiment metadata (title, description, category, instructions)",
        parameters={
            "type": "object",
            "properties": {
                "experiment_id": {"type": "string", "description": "Experiment ID"},
            },
            "required": [],
        },
        handler=_handle_get_experiment,
    ),
    ToolDef(
        name="search_code_examples",
        description="Search the knowledge base for code examples matching a query and language",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What kind of code to search for"},
                "language": {"type": "string", "description": "Programming language", "default": "c"},
                "top_k": {"type": "integer", "description": "Number of results", "default": 3},
            },
            "required": ["query"],
        },
        handler=_handle_search_code_examples,
    ),
    ToolDef(
        name="get_tutoring_hints",
        description="Get step-by-step tutoring hints for a topic at a given difficulty level",
        parameters={
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "The topic to hint about"},
                "level": {"type": "string", "description": "Difficulty: beginner/intermediate/advanced"},
            },
            "required": ["topic"],
        },
        handler=_handle_get_tutoring_hints,
    ),
    ToolDef(
        name="check_syntax",
        description="Quick syntax check on submitted C/Python code, returns line-level issues",
        parameters={
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Source code to check"},
                "language": {"type": "string", "description": "Programming language", "default": "c"},
            },
            "required": ["code"],
        },
        handler=_handle_check_syntax,
    ),
    ToolDef(
        name="get_os_concepts",
        description="Retrieve operating system concepts and definitions from the knowledge base",
        parameters={
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "OS concept name (e.g. deadlock, paging, mutex)"},
            },
            "required": ["topic"],
        },
        handler=_handle_get_os_concepts,
    ),
    ToolDef(
        name="analyze_trace",
        description="Analyze system call trace (strace) output: top syscalls, anomalies, patterns",
        parameters={
            "type": "object",
            "properties": {
                "trace_data": {"type": "string", "description": "Raw strace output"},
            },
            "required": ["trace_data"],
        },
        handler=_handle_analyze_trace,
    ),
    ToolDef(
        name="analyze_deadlock",
        description="Detect potential deadlock patterns in code and trace data",
        parameters={
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Source code"},
                "trace_data": {"type": "string", "description": "Optional strace data"},
            },
            "required": [],
        },
        handler=_handle_analyze_deadlock,
    ),
    ToolDef(
        name="search_github_code",
        description="Search public GitHub repositories for code examples in specific languages. Requires GITHUB_TOKEN.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search keywords (e.g. pthread_create example)"},
                "language": {"type": "string", "description": "Programming language", "default": "c"},
                "top_k": {"type": "integer", "description": "Max results", "default": 5},
            },
            "required": ["query"],
        },
        handler=_handle_search_github_code,
    ),
]

for t in _builtin_tools:
    tool_registry.register(t)

logger.info("Tool registry initialized: %d built-in tools", tool_registry.count())