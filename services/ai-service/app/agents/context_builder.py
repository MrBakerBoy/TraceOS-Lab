"""Context Assembler — builds prompts from structured agent context."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentContext:
    experiment_id: str = ""
    course_id: str = ""
    user_id: str = ""
    conversation_id: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


class ContextAssembler:
    """Assembles prompt context from AgentContext + RAG + history."""

    def build(
        self,
        ctx: AgentContext,
        rag_text: str = "",
        history: list[dict] | None = None,
    ) -> str:
        parts: list[str] = []
        if ctx.experiment_id:
            parts.append(f"[Experiment: {ctx.experiment_id}]")
        if rag_text:
            parts.append(f"[Knowledge Base Results]\n{rag_text}")
        return "\n".join(parts)


context_assembler = ContextAssembler()