"""Code audit service — AI-powered deep code analysis."""

import json
import logging

logger = logging.getLogger(__name__)


class CodeAuditService:
    """Deep code analysis using LLM."""

    def __init__(self):
        # LLM provider imported at call-time (same pattern as diagnosis_service)
        pass

    async def deep_audit(
        self,
        code: str,
        annotations: list,
        issues: list,
        experiment_type: str,
    ) -> dict:
        """Perform deep code audit with LLM."""
        # Build prompt with structured annotations
        annotation_lines = []
        for a in annotations:
            annotation_lines.append(f"  行{a.get('line', '?')}: [{a.get('tag', '?')}] {a.get('detail', '')}")

        # Late import to avoid circular dependency at module load time
        from app.services.llm_client import llm_provider

        result = {
            "ai_issues": [],
            "explanation": "",
            "teaching_hints": {"L1": "", "L2": "", "L3": ""},
        }

        if not llm_provider:
            return self._rule_based_result(issues, annotations, experiment_type)

        try:
            system_prompt, user_prompt = self._build_prompt(code, annotation_lines, issues, experiment_type)
            llm_resp = await llm_provider.chat_completion(system_prompt, user_prompt)
            parsed = self._parse_llm_response(llm_resp.content)
            result.update(parsed)
        except Exception as e:
            logger.error(f"LLM deep audit failed: {e}")
            result["explanation"] = f"AI分析暂时不可用: {str(e)}"

        return result

    def _build_prompt(self, code: str, annotation_lines: list, issues: list, experiment_type: str) -> tuple[str, str]:
        issue_descriptions = []
        for issue in issues:
            issue_descriptions.append(
                f"  - 行{issue.get('line', '?')}: [{issue.get('severity', '?')}] "
                f"{issue.get('title', '')} - {issue.get('description', '')}"
            )

        concept_map = {
            "thread": "线程同步、mutex、条件变量、死锁",
            "process": "进程创建、fork、exec、wait、信号",
            "memory": "内存分配、malloc/free、虚拟内存、mmap",
            "fs": "文件操作、open/close、read/write、文件描述符",
            "scheduler": "进程调度、优先级、时间片轮转",
            "deadlock": "死锁条件、资源分配图、死锁避免",
        }
        concepts = concept_map.get(experiment_type, "操作系统概念")

        system_prompt = "你是操作系统实验教学专家，正在审查学生的C语言代码。请严格按JSON格式回复。"

        user_prompt = f"""**实验类型**: {experiment_type} ({concepts})

**代码结构标注**（来自静态分析器）:
{chr(10).join(annotation_lines) if annotation_lines else '（无标注）'}

**已检测的问题**:
{chr(10).join(issue_descriptions) if issue_descriptions else '（无预检问题）'}

**学生代码**:
```c
{code[:3000]}
```

请进行深度代码审查，重点关注：
1. 资源管理（锁、内存、fd的正确获取和释放）
2. 并发安全（竞态条件、死锁风险）
3. 错误处理（系统调用返回值检查）
4. 与实验{experiment_type}相关的操作系统概念

**重要**：不要直接给答案或完整代码！用教学引导方式。

请严格按JSON格式回复：
{{
  "ai_issues": [
    {{"line": 行号, "severity": "error/warning/info", "title": "问题简述", "description": "详细说明（不直接给答案）", "suggestion": "引导性建议"}}
  ],
  "explanation": "整体代码评价（100字以内，教学导向）",
  "teaching_hints": {{
    "L1": "第一层提示：最温和的引导（20字以内）",
    "L2": "第二层提示：更具体的排查方向（30字以内）",
    "L3": "第三层提示：接近答案但仍是引导（40字以内）"
  }}
}}
"""
        return system_prompt, user_prompt

    def _parse_llm_response(self, response: str) -> dict:
        """Parse LLM JSON response, with fallback for non-JSON output."""
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        import re
        match = re.search(r'\{[\s\S]*\}', response)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass

        return {
            "ai_issues": [],
            "explanation": response[:200],
            "teaching_hints": {"L1": "请检查你的代码逻辑", "L2": "", "L3": ""},
        }

    def _rule_based_result(self, issues: list, annotations: list, experiment_type: str) -> dict:
        """Generate result without LLM."""
        hint_map = {
            "thread": {
                "L1": "检查一下你的mutex lock和unlock是否成对出现",
                "L2": "看看是否有某个执行路径只lock了但没有unlock",
                "L3": "在return之前是否忘记调用pthread_mutex_unlock？",
            },
            "memory": {
                "L1": "确认每次malloc都有对应的free",
                "L2": "排查是否有在循环中不断malloc但没free的情况",
                "L3": "考虑在函数的所有退出路径上都加上free调用",
            },
            "process": {
                "L1": "检查fork/exec/wait的调用顺序是否正确",
                "L2": "确认子进程的退出状态是否被正确回收",
                "L3": "考虑waitpid的options参数是否设置正确",
            },
            "fs": {
                "L1": "检查文件描述符是否在使用后正确关闭",
                "L2": "排查是否存在open后没有匹配的close",
                "L3": "在错误处理路径中也别忘了close文件描述符",
            },
            "scheduler": {
                "L1": "确认调度算法的实现是否符合题目要求",
                "L2": "检查优先级排序和就绪队列的维护逻辑",
                "L3": "考虑边界情况：所有进程同时到达时如何调度",
            },
            "deadlock": {
                "L1": "检查资源的申请和释放顺序是否一致",
                "L2": "排查是否存在循环等待的条件",
                "L3": "尝试用资源分配图分析锁的依赖关系",
            },
        }

        hints = hint_map.get(experiment_type, hint_map["process"])
        return {
            "ai_issues": issues,
            "explanation": f"静态分析发现{len(issues)}个潜在问题，建议逐行排查",
            "teaching_hints": hints,
        }


code_audit_service = CodeAuditService()
