"""实验报告 AI 自动评分路由"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import json, logging

logger = logging.getLogger(__name__)
router = APIRouter(tags=["report-eval"])

class ReportEvalRequest(BaseModel):
    report_content: str
    submission_code: str = ""
    experiment_title: str = ""
    experiment_category: str = ""

class ReportEvalResponse(BaseModel):
    total_score: int
    dimension_scores: dict
    feedback: str
    suggestions: list[str]

REPORT_EVAL_PROMPT = """你是操作系统课程的助教，请评估学生的实验报告。评分维度（满分100）：原理解释(0-25)、实验过程清晰度(0-25)、结果分析深度(0-20)、代码与描述一致性(0-15)、格式规范性(0-15)。返回JSON：{"total_score": 85, "dimension_scores": {"原理解释": 22, "过程描述": 20, "结果分析": 18, "代码一致性": 13, "格式规范": 12}, "feedback": "...", "suggestions": ["..."]}"""

@router.post("/evaluate")
async def evaluate_report(req: ReportEvalRequest):
    from app.services.llm_client import get_llm_provider
    try:
        llm = get_llm_provider()
        user_msg = f"实验: {req.experiment_title}\n类别: {req.experiment_category}\n代码:\n```c\n{req.submission_code[:2000]}\n```\n\n报告:\n{req.report_content[:3000]}"
        messages = [{"role": "system", "content": REPORT_EVAL_PROMPT}, {"role": "user", "content": user_msg}]
        resp = await llm.chat_completion_with_messages(messages, temperature=0.3, max_tokens=800)
        result = json.loads(resp.content) if isinstance(resp.content, str) else resp.content
        return ReportEvalResponse(**result)
    except Exception as e:
        logger.error("Report eval failed: %s", e)
        return ReportEvalResponse(
            total_score=70,
            dimension_scores={"原理解释": 18, "过程描述": 17, "结果分析": 14, "代码一致性": 11, "格式规范": 10},
            feedback="AI评分服务暂不可用，已给出默认评分",
            suggestions=["请稍后重试"]
        )

@router.post("/evaluate-fallback")
async def evaluate_report_fallback(req: ReportEvalRequest):
    """无LLM的规则评分（基于报告长度和结构）"""
    score = 60
    content = req.report_content
    if len(content) > 200: score += 10
    if len(content) > 500: score += 10
    if "实验目的" in content or "实验原理" in content: score += 5
    if "实验结果" in content or "运行结果" in content: score += 5
    if "总结" in content or "心得" in content: score += 5
    if "代码" in content: score += 5
    score = min(score, 100)
    return ReportEvalResponse(
        total_score=score,
        dimension_scores={"内容完整性": int(score*0.3), "结构规范性": int(score*0.3), "分析深度": int(score*0.2), "代码对应": int(score*0.2)},
        feedback="规则评分完成（AI不可用时使用）",
        suggestions=["建议补充更多分析细节"]
    )
