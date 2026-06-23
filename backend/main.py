"""
Smart Study Calendar - API server (FastAPI)
Run with:  uvicorn main:app --reload --port 8000   (from the backend/ folder)
"""

import json
import os
from datetime import datetime, date

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
app.include_router(ai_router, prefix="/api")

model = FocusModel()
FEEDBACK_LOG_PATH = os.path.join(os.path.dirname(__file__), "feedback_log.json")


DIFFICULTY_NUMERIC = {"Easy": 1, "Medium": 2, "Hard": 3}
PRIORITY_NUMERIC = {"Low": 1, "Medium": 2, "High": 3}


def safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def numeric_level(value, mapping, default=1):
    if isinstance(value, (int, float)):
        return int(value)
    return mapping.get(str(value), default)


def day_number(day: str | None) -> int:
    if day in DAYS:
        return DAYS.index(day) + 1
    return 0


def slot_hour(slot: str | None) -> int:
    if not slot:
        return 0
    try:
        start = slot.split("-")[0]
        return int(start.split(":")[0])
    except (IndexError, ValueError):
        return 0


def deadline_days_left(deadline: str | None) -> int:
    if not deadline:
        return 0
    try:
        deadline_date = datetime.strptime(deadline, "%Y-%m-%d").date()
        return (deadline_date - date.today()).days
    except ValueError:
        return 0


def load_feedback_log() -> list[dict]:
    if not os.path.exists(FEEDBACK_LOG_PATH):
        return []
    try:
        with open(FEEDBACK_LOG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def append_feedback_record(record: dict):
    try:
        history = load_feedback_log()
        history.append(record)
        with open(FEEDBACK_LOG_PATH, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2)
    except OSError:
        # Feedback logging should never make scheduling/feedback fail.
        pass


def feedback_record_from_event(ev, action: str) -> dict:
    return {
        "taskId": ev.taskId,
        "course": ev.course,
        "difficulty": numeric_level(ev.difficulty, DIFFICULTY_NUMERIC),
        "priority": numeric_level(ev.priority, PRIORITY_NUMERIC),
        "estimatedHours": safe_float(ev.estimatedHours, 1.5),
        "deadlineDaysLeft": safe_int(
            ev.deadlineDaysLeft,
            deadline_days_left(ev.deadline),
        ),
        "scheduledDay": safe_int(ev.scheduledDay, day_number(ev.day)),
        "scheduledHour": safe_int(ev.scheduledHour, slot_hour(ev.slot)),
        "action": action,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
    }


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
    taskId: int | str | None = None
    course: str | None = None
    difficulty: int | str | None = None
    priority: int | str | None = None
    estimatedHours: float | None = None
    deadline: str | None = None
    deadlineDaysLeft: int | None = None
    scheduledDay: int | None = None
    scheduledHour: int | None = None


class MoveEvent(BaseModel):
    taskId: int | str | None = None
    course: str | None = None
    difficulty: int | str | None = None
    priority: int | str | None = None
    estimatedHours: float | None = None
    deadline: str | None = None
    deadlineDaysLeft: int | None = None
    scheduledDay: int | None = None
    scheduledHour: int | None = None
    day: str | None = None
    slot: str | None = None


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
    model.update(ev.day, ev.slot, ev.completed, ev.course)
    action = "completed" if ev.completed else "skipped"
    append_feedback_record(feedback_record_from_event(ev, action))
    p = model.p_complete(ev.day, ev.slot)
    msg = (
        f"Nice! Updated your focus profile: {ev.day} {ev.slot} -> {int(p*100)}% expected completion."
        if ev.completed else
        f"Noted. {ev.day} {ev.slot} now has {int(p*100)}% expected completion - I'll avoid it for hard tasks."
    )
    return {"message": msg, "p": p}


@app.post("/api/learning/move")
def moved(ev: MoveEvent):
    model.update_course_stats(ev.course or "", "moved")
    model.save()
    append_feedback_record(feedback_record_from_event(ev, "moved"))
    return {"message": "Move logged.", "courseScore": model.get_course_score(ev.course)}


@app.get("/api/model")
def get_model():
    return {"heatmap": model.heatmap(), "events": len(model.events)}


@app.get("/api/learning/analytics")
def learning_analytics():
    course_stats = {}
    for course, stats in model.course_stats.items():
        success = safe_int(stats.get("success", 0))
        failure = safe_int(stats.get("failure", 0))
        course_stats[course] = {
            "success": success,
            "failure": failure,
            "score": round(model.get_course_score(course), 3),
        }
    return {
        "totalFeedbackRecords": len(load_feedback_log()),
        "courseStats": course_stats,
    }


@app.post("/api/model/reset")
def reset_model():
    model.reset()
    return {"message": "Focus profile reset to prior."}
