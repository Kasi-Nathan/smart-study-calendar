"""
Smart Study Calendar - API server (FastAPI)
Run with:  uvicorn main:app --reload --port 8000   (from the backend/ folder)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from engine import DAYS, SLOTS, FocusModel, ScheduleOptimizer
from routes.ai_routes import router as ai_router

app = FastAPI(title="Smart Study Calendar API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register AI routes
app.include_router(ai_router)

model = FocusModel()


class Task(BaseModel):
    id: int | str
    title: str
    course: str
    deadline: str | None = None
    estimatedHours: float = 1.5
    difficulty: str = "Medium"
    priority: str = "Medium"
    status: str = "Not started"


class Preferences(BaseModel):
    focusWindow: str = "morning"          # morning | afternoon | evening
    maxBlocksPerDay: int = 3
    weekStart: str | None = None          # ISO date of Monday (optional)


class ScheduleRequest(BaseModel):
    tasks: list[Task]
    preferences: Preferences = Field(default_factory=Preferences)


class FeedbackEvent(BaseModel):
    day: str
    slot: str
    completed: bool


@app.get("/api/health")
def health():
    return {"status": "ok", "engine": "bayesian-optimizer-0.3"}


@app.post("/api/schedule")
def schedule(req: ScheduleRequest):
    opt = ScheduleOptimizer(model, req.preferences.model_dump())
    assignment, unplaced, score = opt.solve([t.model_dump() for t in req.tasks])

    grid = {d: {s: None for s in SLOTS} for d in DAYS}
    for (d, s), b in assignment.items():
        if b is None:
            continue
        grid[d][s] = {
            "taskId": b.task_id,
            "title": b.title,
            "course": b.course,
            "difficulty": b.difficulty,
            "priority": b.priority,
            "part": b.part,
            "parts": b.parts,
            "status": "Planned",
            "explanation": b.explanation,
            "scoreBreakdown": b.score_breakdown,
        }

    return {
        "schedule": grid,
        "unplacedBlocks": len(unplaced),
        "objectiveScore": score,
        "message": (
            "Plan optimized with your learned focus profile, deadlines and preferences."
            if not unplaced else
            f"Plan generated, but {len(unplaced)} block(s) did not fit this week - consider reducing workload."
        ),
    }


@app.post("/api/feedback")
def feedback(ev: FeedbackEvent):
    model.update(ev.day, ev.slot, ev.completed)
    p = model.p_complete(ev.day, ev.slot)
    msg = (
        f"Nice! Updated your focus profile: {ev.day} {ev.slot} -> {int(p*100)}% expected completion."
        if ev.completed else
        f"Noted. {ev.day} {ev.slot} now has {int(p*100)}% expected completion - I'll avoid it for hard tasks."
    )
    return {"message": msg, "p": p}


@app.get("/api/model")
def get_model():
    return {"heatmap": model.heatmap(), "events": len(model.events)}


@app.post("/api/model/reset")
def reset_model():
    model.reset()
    return {"message": "Focus profile reset to prior."}