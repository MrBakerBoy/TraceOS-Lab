"""
Memory Engineering - Four-level memory system for agents.
L0: Working memory (current context window)
L1: Short-term memory (current conversation session)
L2: Long-term memory (student profile, past interactions)
L3: Global memory (error patterns, teaching strategies)
"""

import json, logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class StudentMemory:
    user_id: str = ""
    weak_topics: list[str] = field(default_factory=list)
    strong_topics: list[str] = field(default_factory=list)
    common_errors: list[str] = field(default_factory=list)
    total_interactions: int = 0
    avg_helpfulness: float = 0.0
    preferred_hint_level: str = "L2"
    learning_pace: str = "medium"
    last_active: str = ""


class MemoryManager:
    """Manages multi-level memory for personalized agent interactions."""

    def __init__(self):
        self._student_cache: dict[str, StudentMemory] = {}

    async def get_student_memory(self, user_id: str) -> StudentMemory:
        if user_id in self._student_cache:
            return self._student_cache[user_id]

        memory = StudentMemory(user_id=user_id)
        try:
            from app.db import get_pool
            pool = get_pool()
            row = await pool.fetchrow(
                """SELECT preferred_agent_mode, total_agent_interactions,
                          avg_helpfulness_score, common_misconceptions, learning_style
                   FROM student_profiles WHERE user_id = $1""",
                user_id,
            )
            if row:
                data = dict(row)
                memory.total_interactions = data.get("total_agent_interactions", 0)
                memory.avg_helpfulness = data.get("avg_helpfulness_score", 0.0)
                if data.get("common_misconceptions"):
                    memory.weak_topics = json.loads(data["common_misconceptions"])
                if data.get("learning_style"):
                    style = json.loads(data["learning_style"]) if isinstance(data["learning_style"], str) else data["learning_style"]
                    memory.preferred_hint_level = style.get("hint_level", "L2")
                    memory.learning_pace = style.get("pace", "medium")
        except Exception as e:
            logger.warning(f"Failed to load student memory: {e}")

        self._student_cache[user_id] = memory
        return memory

    async def update_student_memory(self, user_id: str, interaction: dict):
        """Learn from each interaction to improve future responses."""
        memory = await self.get_student_memory(user_id)
        memory.total_interactions += 1

        # Track topics from interaction
        topics = interaction.get("topics", [])
        if interaction.get("was_helpful"):
            for t in topics:
                if t not in memory.strong_topics:
                    memory.strong_topics.append(t)
        else:
            for t in topics:
                if t not in memory.weak_topics:
                    memory.weak_topics.append(t)

        # Update average helpfulness
        helpful = 1.0 if interaction.get("was_helpful") else 0.0
        memory.avg_helpfulness = (memory.avg_helpfulness * (memory.total_interactions - 1) + helpful) / memory.total_interactions
        memory.last_active = datetime.now(timezone.utc).isoformat()

        # Persist
        try:
            from app.db import get_pool
            pool = get_pool()
            await pool.execute(
                """UPDATE student_profiles SET
                   total_agent_interactions = $1,
                   avg_helpfulness_score = $2,
                   common_misconceptions = $3::jsonb,
                   learning_style = $4::jsonb
                   WHERE user_id = $5""",
                memory.total_interactions,
                memory.avg_helpfulness,
                json.dumps(memory.weak_topics),
                json.dumps({"hint_level": memory.preferred_hint_level, "pace": memory.learning_pace}),
                user_id,
            )
        except Exception as e:
            logger.warning(f"Failed to persist student memory: {e}")

    async def get_error_patterns(self, experiment_id: str) -> list[dict]:
        """Get common error patterns for an experiment."""
        try:
            from app.db import get_pool
            pool = get_pool()
            rows = await pool.fetch(
                """SELECT error_type, error_message, frequency, resolution_hint
                   FROM error_statistics
                   WHERE experiment_id = $1
                   ORDER BY frequency DESC LIMIT 10""",
                experiment_id,
            )
            return [dict(r) for r in rows]
        except Exception:
            return []

    def build_memory_context(self, memory: StudentMemory) -> str:
        """Convert memory to context string for the agent."""
        parts = []
        if memory.weak_topics:
            parts.append(f"Weak areas: {', '.join(memory.weak_topics[:5])}")
        if memory.total_interactions > 5:
            parts.append(f"Interactions: {memory.total_interactions}")
            parts.append(f"Preferred hint level: {memory.preferred_hint_level}")
            parts.append(f"Learning pace: {memory.learning_pace}")
        return "\n".join(parts) if parts else ""


# Singleton
memory_manager = MemoryManager()
