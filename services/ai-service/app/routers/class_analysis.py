"""班级 AI 分析路由 — 汇总诊断数据，调用 LLM 生成教学建议"""

import logging
from fastapi import APIRouter
from pydantic import BaseModel

from app.services.llm_client import llm_provider

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analyze-class", tags=["class-analysis"])


class DiagnosisItem(BaseModel):
    error_type: str | None = None
    severity: str | None = None
    root_cause: str | None = None
    experiment_title: str = ""
    student_name: str = ""


class ClassAnalysisRequest(BaseModel):
    diagnoses: list[DiagnosisItem]
    total_students: int = 0
    total_submissions: int = 0
    average_score: float = 0.0


class ClassAnalysisResponse(BaseModel):
    summary: str
    error_patterns: list[str]
    teaching_suggestions: list[str]
    challenging_experiments: list[str]


@router.post("", response_model=ClassAnalysisResponse)
async def analyze_class(req: ClassAnalysisRequest) -> ClassAnalysisResponse:
    if not req.diagnoses:
        return ClassAnalysisResponse(
            summary="暂无诊断数据，学生提交代码后即可生成 AI 分析。",
            error_patterns=[],
            teaching_suggestions=["建议先让学生完成一些实验，积累诊断数据后再查看分析。"],
            challenging_experiments=[],
        )

    diag_summary_lines = []
    for d in req.diagnoses[:50]:
        line = f"- 实验: {d.experiment_title or 未知}"
        if d.student_name:
            line += f" | 学生: {d.student_name}"
        if d.error_type:
            line += f" | 错误类型: {d.error_type}"
        if d.severity:
            line += f" | 严重程度: {d.severity}"
        if d.root_cause:
            line += f" | 原因: {d.root_cause}"
        diag_summary_lines.append(line)

    diag_text = "\n".join(diag_summary_lines)

    system_prompt = """你是一位经验丰富的操作系统课程助教。请根据以下学生代码诊断数据，为教师提供教学分析报告。

请用中文回答，并按以下格式输出（严格使用 JSON）：
{
  "summary": "一段 2-3 句话的整体概况",
  "error_patterns": ["常见错误模式1", "常见错误模式2", ...],
  "teaching_suggestions": ["教学建议1", "教学建议2", ...],
  "challenging_experiments": ["最具挑战的实验1", "最具挑战的实验2", ...]
}

要求：
- error_patterns 列出 3-5 个最常见错误模式
- teaching_suggestions 给出 3-5 条具体可操作的教学建议
- challenging_experiments 列出学生犯错最多的 2-3 个实验"""

    user_prompt = f"""班级概况：
- 学生总数: {req.total_students}
- 提交总数: {req.total_submissions}
- 平均分: {req.average_score:.1f}

诊断记录（共 {len(req.diagnoses)} 条）：
{diag_text}"""

    try:
        raw = await llm_provider.chat_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.4,
            max_tokens=2048,
        )

        import json
        # Try to extract JSON from response
        text = raw.content.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        data = json.loads(text)
        return ClassAnalysisResponse(
            summary=data.get("summary", ""),
            error_patterns=data.get("error_patterns", []),
            teaching_suggestions=data.get("teaching_suggestions", []),
            challenging_experiments=data.get("challenging_experiments", []),
        )
    except Exception as e:
        logger.error("Class analysis failed: %s", e, exc_info=True)
        # Fallback: simple statistics
        from collections import Counter
        error_counts = Counter(d.error_type for d in req.diagnoses if d.error_type)
        exp_counts = Counter(d.experiment_title for d in req.diagnoses if d.experiment_title)

        error_patterns = [f"{t} ({c}次)" for t, c in error_counts.most_common(5)]
        challenging = [f"{t} ({c}次错误)" for t, c in exp_counts.most_common(3)]

        return ClassAnalysisResponse(
            summary=f"共 {len(req.diagnoses)} 条诊断记录，AI 摘要暂时不可用，已展示统计数据。",
            error_patterns=error_patterns,
            teaching_suggestions=["建议重点关注高频错误类型，针对性地进行课堂讲解。"],
            challenging_experiments=challenging,
        )
