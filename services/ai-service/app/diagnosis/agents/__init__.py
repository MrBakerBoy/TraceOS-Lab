"""诊断侧 Specialist Agents (真并行, 各自独立输入/Prompt/LLM 调用).

- CodeAnalyzerAgent: 代码质量 + 规则 + LLM
- TestEvaluatorAgent: 测试结果分析
- SyscallAnalyzerAgent: 系统调用行为 (规则优先 + LLM)
- ConceptRubricAgent: OS 概念达成度 (确定性映射, 无 LLM)
- ResourceAnalyzerAgent: 内核资源观测 (消费 ebpf_metrics)

红线: 各 Agent 只产出 findings (教学建议) + confidence, 不产出分数。
"""

from app.diagnosis.agents.base import AgentResult, AgentStatus, AgentConfig, BaseSpecialistAgent
from app.diagnosis.agents.code_analyzer import CodeAnalyzerAgent
from app.diagnosis.agents.concept_rubric import ConceptRubricAgent
from app.diagnosis.agents.resource_analyzer import ResourceAnalyzerAgent
from app.diagnosis.agents.report_generator import DiagnosisReport, ReportGeneratorAgent
from app.diagnosis.agents.syscall_analyzer import SyscallAnalyzerAgent
from app.diagnosis.agents.test_evaluator import TestEvaluatorAgent

__all__ = [
    "AgentResult", "AgentStatus", "AgentConfig", "BaseSpecialistAgent",
    "CodeAnalyzerAgent", "ConceptRubricAgent", "ResourceAnalyzerAgent",
    "DiagnosisReport", "ReportGeneratorAgent",
    "SyscallAnalyzerAgent", "TestEvaluatorAgent",
]