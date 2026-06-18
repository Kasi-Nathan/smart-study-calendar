from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from services.gemini_service import generate_study_explanation

router = APIRouter(prefix="/ai", tags=["AI"])

class ExplainRequest(BaseModel):
    task: str
    course: str
    difficulty: str
    priority: str
    existing_explanation: str
    scoreBreakdown: dict[str, Any] = Field(default_factory=dict)

@router.post("/explain")
def explain_schedule(data: ExplainRequest):
    try:
        explanation = generate_study_explanation(
            task=data.task,
            course=data.course,
            difficulty=data.difficulty,
            priority=data.priority,
            existing_explanation=data.existing_explanation,
            score_breakdown=data.scoreBreakdown,
        )
        if not explanation:
            raise ValueError("Gemini returned an empty explanation")
        return {"explanation": explanation, "fallback": False}
    except Exception:
        return {
            "explanation": data.existing_explanation,
            "fallback": True,
        }
