"""TraceOS AI Agent 模块。

提问侧：单 Agent（teaching_assistant）—— 输入守卫 → 确定性意图判断 → RAG → DiagnosisTutorAgent。
诊断侧：多 Agent（app.diagnosis.orchestrator）—— 四维并行分析。

保留的基础设施：
  - guardrails: 输入/输出守卫
  - observability: 追踪与观测
  - tools / context_builder / memory / code_auditor: 通用能力
"""

from app.agents.diagnosis_tutor import DiagnosisTutorAgent
from app.agents.rag_agent import RAGAgent
from app.agents.tools import tool_registry, ToolRegistry, ToolDef, ToolResult
from app.agents.context_builder import context_assembler, ContextAssembler, AgentContext
from app.agents.memory import memory_manager, MemoryManager, StudentMemory
from app.agents.code_auditor import code_auditor_agent, CodeAuditorAgent

from app.agents.tool_sandbox import (
    ToolSandbox, NsjailSandbox, SandboxedToolExecutor,
    SandboxConfig, SandboxResult, get_tool_sandbox,
)
from app.agents.mcp_client import (
    MCPClient, MCPToolRegistry, MCPServerConfig, MCPTool,
    get_mcp_client,
)
from app.agents.guardrails import (
    InputGuardPipeline, OutputGuardPipeline, RatchetErrorKB,
    DeterministicGuards, ClassifierGuards,
    GuardCheck, GuardResult, get_input_guard, get_output_guard, get_ratchet_kb,
)
from app.agents.observability import (
    ObservabilityManager, TraceSpan, TraceSession,
    SpanKind, get_observability,
)

__all__ = [
    "DiagnosisTutorAgent",
    "RAGAgent",
    "tool_registry", "ToolRegistry", "ToolDef", "ToolResult",
    "context_assembler", "ContextAssembler", "AgentContext",
    "memory_manager", "MemoryManager", "StudentMemory",
    "code_auditor_agent", "CodeAuditorAgent",
    "ToolSandbox", "NsjailSandbox", "SandboxedToolExecutor",
    "SandboxConfig", "SandboxResult", "get_tool_sandbox",
    "MCPClient", "MCPToolRegistry", "MCPServerConfig", "MCPTool",
    "get_mcp_client",
    "InputGuardPipeline", "OutputGuardPipeline", "RatchetErrorKB",
    "DeterministicGuards", "ClassifierGuards",
    "GuardCheck", "GuardResult", "get_input_guard", "get_output_guard", "get_ratchet_kb",
    "ObservabilityManager", "TraceSpan", "TraceSession",
    "SpanKind", "get_observability",
]