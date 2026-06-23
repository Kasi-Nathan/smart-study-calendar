"""
Smart Study Calendar - Scheduling Engine
=========================================
Two intelligent components:

1. FocusModel  - a Bayesian user model. For every (day, time-slot) cell of the
   week it keeps a Beta(alpha, beta) distribution over the probability that the
   user successfully completes a study block placed there. Every "Completed" /
   "Skipped" feedback event is a Bernoulli observation that updates the model.
   (Same family of models as the Bayesian touch/typing models from the lecture.)

2. ScheduleOptimizer - turns tasks into 90-minute study blocks and assigns them
   to calendar slots by maximising a utility function (deadline pressure,
   learned focus probability, user preferences, workload balance, spacing) via
   greedy construction + stochastic local search (hill climbing with swaps).
"""

from __future__ import annotations

import json
import math
import os
import random
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
SLOTS = ["09:00-10:30", "10:30-12:00", "14:00-15:30", "16:00-17:30", "19:00-20:30"]
SLOT_PERIOD = {  # coarse time-of-day category per slot index
    0: "morning", 1: "morning", 2: "afternoon", 3: "afternoon", 4: "evening",
}
BLOCK_HOURS = 1.5
MODEL_PATH = os.path.join(os.path.dirname(__file__), "user_model.json")

DIFFICULTY = {"Easy": 1, "Medium": 2, "Hard": 3}
PRIORITY = {"Low": 1, "Medium": 2, "High": 3}
COURSE_WEIGHT = 0.25


# --------------------------------------------------------------------------
# 1. Bayesian user model
# --------------------------------------------------------------------------
class FocusModel:
    """Beta-Bernoulli model of per-slot completion probability.

    Prior: Beta(2, 2) everywhere (uninformative-ish, mean 0.5), with a small
    morning bias encoded as extra pseudo-counts so the cold-start behaviour
    matches the common-sense default from our Milestone 1 concept. Real
    feedback quickly dominates the prior.
    """

    def __init__(self, path: str = MODEL_PATH):
        self.path = path
        self.cells: dict[str, dict[str, float]] = {}
        self.events: list[dict] = []
        self.course_stats: dict[str, dict[str, int]] = {}
        self._init_prior()
        self.load()

    @staticmethod
    def key(day: str, slot: str) -> str:
        return f"{day}|{slot}"

    def _init_prior(self):
        for d in DAYS:
            for i, s in enumerate(SLOTS):
                a, b = 2.0, 2.0
                if SLOT_PERIOD[i] == "morning":
                    a += 1.0  # gentle morning prior
                if d in ("Sat", "Sun") and SLOT_PERIOD[i] == "evening":
                    b += 0.5  # weekend evenings slightly less reliable
                self.cells[self.key(d, s)] = {"alpha": a, "beta": b, "n": 0}

    # --- inference -------------------------------------------------------
    def p_complete(self, day: str, slot: str) -> float:
        c = self.cells[self.key(day, slot)]
        return c["alpha"] / (c["alpha"] + c["beta"])

    def uncertainty(self, day: str, slot: str) -> float:
        c = self.cells[self.key(day, slot)]
        a, b = c["alpha"], c["beta"]
        var = (a * b) / ((a + b) ** 2 * (a + b + 1))
        return math.sqrt(var)

    def observations(self, day: str, slot: str) -> int:
        return int(self.cells[self.key(day, slot)].get("n", 0))

    # --- learning --------------------------------------------------------
    def update(self, day: str, slot: str, completed: bool, course: str | None = None):
        c = self.cells[self.key(day, slot)]
        c["n"] = c.get("n", 0) + 1
        if completed:
            c["alpha"] += 1.0
        else:
            c["beta"] += 1.0
        self.events.append({
            "day": day, "slot": slot, "completed": completed,
            "t": datetime.now().isoformat(timespec="seconds"),
        })
        if course:
            self.update_course_stats(course, "completed" if completed else "skipped")
        self.save()

    def update_course_stats(self, course: str, action: str):
        course = (course or "").strip()
        if not course:
            return
        stats = self.course_stats.setdefault(course, {"success": 0, "failure": 0})
        if action == "completed":
            stats["success"] = int(stats.get("success", 0)) + 1
        elif action in {"skipped", "moved"}:
            stats["failure"] = int(stats.get("failure", 0)) + 1

    def get_course_score(self, course: str | None) -> float:
        if not course:
            return 0.5
        stats = self.course_stats.get(course)
        if not stats:
            return 0.5
        success = int(stats.get("success", 0))
        failure = int(stats.get("failure", 0))
        return (success + 1) / (success + failure + 2)

    # --- persistence -----------------------------------------------------
    def save(self):
        with open(self.path, "w") as f:
            json.dump(
                {
                    "cells": self.cells,
                    "events": self.events,
                    "course_stats": self.course_stats,
                },
                f,
                indent=1,
            )

    def load(self):
        if os.path.exists(self.path):
            try:
                data = json.load(open(self.path))
                self.cells.update(data.get("cells", {}))
                self.events = data.get("events", [])
                raw_course_stats = data.get("course_stats", {})
                self.course_stats = {
                    str(course): {
                        "success": int(stats.get("success", 0)),
                        "failure": int(stats.get("failure", 0)),
                    }
                    for course, stats in raw_course_stats.items()
                    if isinstance(stats, dict)
                }
            except (json.JSONDecodeError, OSError):
                pass

    def reset(self):
        self.events = []
        self.course_stats = {}
        self._init_prior()
        self.save()

    def heatmap(self) -> list[dict]:
        out = []
        for d in DAYS:
            for s in SLOTS:
                out.append({
                    "day": d, "slot": s,
                    "p": round(self.p_complete(d, s), 3),
                    "sd": round(self.uncertainty(d, s), 3),
                    "n": max(0, self.observations(d, s)),
                })
        return out


# --------------------------------------------------------------------------
# 2. Schedule optimisation
# --------------------------------------------------------------------------
@dataclass
class Block:
    task_id: int | str
    title: str
    course: str
    difficulty: str
    priority: str
    part: int
    parts: int
    deadline: str | None = None
    explanation: str = ""
    score_breakdown: dict = field(default_factory=dict)


def _days_until(deadline: str | None, week_monday: date) -> dict[str, int]:
    """Maps each weekday name to 'days remaining before deadline' (can be <0)."""
    res = {}
    for i, d in enumerate(DAYS):
        day_date = week_monday + timedelta(days=i)
        if deadline:
            try:
                dl = datetime.strptime(deadline, "%Y-%m-%d").date()
                res[d] = (dl - day_date).days
            except ValueError:
                res[d] = 99
        else:
            res[d] = 99
    return res


def _split(task: dict) -> list[Block]:
    n = max(1, math.ceil(float(task.get("estimatedHours", BLOCK_HOURS)) / BLOCK_HOURS))
    return [
        Block(
            task_id=task["id"], title=task["title"], course=task["course"],
            difficulty=task.get("difficulty", "Medium"),
            priority=task.get("priority", "Medium"),
            part=i + 1, parts=n, deadline=task.get("deadline"),
        )
        for i in range(n)
    ]


class ScheduleOptimizer:
    def __init__(self, model: FocusModel, prefs: dict | None = None):
        self.model = model
        prefs = prefs or {}
        self.focus_window = prefs.get("focusWindow", "morning")  # morning/afternoon/evening
        self.max_per_day = int(prefs.get("maxBlocksPerDay", 3))
        self.week_monday = self._monday(prefs.get("weekStart"))

    @staticmethod
    def _monday(week_start: str | None) -> date:
        if week_start:
            try:
                return datetime.strptime(week_start, "%Y-%m-%d").date()
            except ValueError:
                pass
        today = date.today()
        return today - timedelta(days=today.weekday())

    # --- utility of placing a block into (day, slot) ----------------------
    def utility(self, block: Block, day: str, slot: str,
                assignment: dict[tuple[str, str], Block]) -> float:
        slot_idx = SLOTS.index(slot)
        period = SLOT_PERIOD[slot_idx]
        days_left = _days_until(block.deadline, self.week_monday)[day]

        # Hard constraint: never schedule after the deadline.
        if days_left < 0:
            return -1e9

        # 1. learned focus probability, weighted by difficulty
        p = self.model.p_complete(day, slot)
        focus_term = p * (1.0 + 0.5 * (DIFFICULTY[block.difficulty] - 1))

        # 2. deadline pressure: earlier placement for urgent tasks
        urgency = PRIORITY[block.priority] * 2 + DIFFICULTY[block.difficulty]
        day_idx = DAYS.index(day)
        pressure_term = (urgency / 9.0) * (1.0 - day_idx / 7.0) * min(1.5, 3.0 / max(1, days_left))

        # 3. preference: hard tasks inside the user's focus window
        pref_term = 0.0
        if block.difficulty == "Hard":
            pref_term = 0.6 if period == self.focus_window else -0.2

        # 4. workload balance: penalise overloaded days
        load = sum(1 for (d, _s), b in assignment.items() if d == day and b is not None)
        balance_term = -0.45 * max(0, load - (self.max_per_day - 1))
        if load >= self.max_per_day:
            balance_term -= 2.0

        # 5. spacing: don't put two blocks of the same task on the same day
        same_task_today = sum(
            1 for (d, _s), b in assignment.items()
            if d == day and b is not None and b.task_id == block.task_id
        )
        spacing_term = -0.7 * same_task_today

        # 6. course-level Bayesian success score. Kept intentionally small so
        # the existing focus/deadline/preference behaviour remains dominant.
        course_score = self.model.get_course_score(block.course)
        course_term = COURSE_WEIGHT * course_score

        total = (1.4 * focus_term + 1.2 * pressure_term + pref_term
                 + balance_term + spacing_term + course_term)
        return total

    # --- construction + local search --------------------------------------
    def solve(self, tasks: list[dict], iters: int = 800, seed: int = 7):
        rng = random.Random(seed)
        blocks: list[Block] = []
        for t in tasks:
            if t.get("status") == "Completed":
                continue
            blocks.extend(_split(t))

        # most constrained / most urgent first
        def order_key(b: Block):
            dl = _days_until(b.deadline, self.week_monday)["Mon"]
            return (dl, -PRIORITY[b.priority], -DIFFICULTY[b.difficulty])
        blocks.sort(key=order_key)

        assignment: dict[tuple[str, str], Block | None] = {
            (d, s): None for d in DAYS for s in SLOTS
        }

        unplaced = []
        for b in blocks:
            best, best_u = None, -1e8
            for (d, s), occ in assignment.items():
                if occ is not None:
                    continue
                u = self.utility(b, d, s, assignment)
                if u > best_u:
                    best, best_u = (d, s), u
            if best and best_u > -1e8:
                assignment[best] = b
            else:
                unplaced.append(b)

        # stochastic local search: try swaps / moves, keep improvements
        def total_utility():
            tot = 0.0
            for (d, s), b in assignment.items():
                if b is not None:
                    ctx = {k: v for k, v in assignment.items() if k != (d, s)}
                    tot += self.utility(b, d, s, ctx)
            return tot

        current = total_utility()
        cells = list(assignment.keys())
        for _ in range(iters):
            c1, c2 = rng.sample(cells, 2)
            if assignment[c1] is None and assignment[c2] is None:
                continue
            assignment[c1], assignment[c2] = assignment[c2], assignment[c1]
            new = total_utility()
            if new >= current:
                current = new
            else:
                assignment[c1], assignment[c2] = assignment[c2], assignment[c1]

        # relabel session parts chronologically (local search may shuffle them)
        order = [(d, s) for d in DAYS for s in SLOTS]
        per_task: dict = {}
        for cell in order:
            b = assignment[cell]
            if b is not None:
                per_task.setdefault(b.task_id, []).append(b)
        for blocks_of_task in per_task.values():
            for i, b in enumerate(blocks_of_task, start=1):
                b.part = i

        # explanations
        for (d, s), b in assignment.items():
            if b is None:
                continue
            b.explanation, b.score_breakdown = self._explain(b, d, s, assignment)

        return assignment, unplaced, round(current, 2)

    def _explain(self, b: Block, day: str, slot: str, assignment):
        p = self.model.p_complete(day, slot)
        n = self.model.observations(day, slot)
        course_score = self.model.get_course_score(b.course)
        days_left = _days_until(b.deadline, self.week_monday)[day]
        period = SLOT_PERIOD[SLOTS.index(slot)]
        reasons = []
        if n > 0:
            reasons.append(
                f"you complete {int(round(p * 100))}% of blocks here (based on {n} past observations)")
        else:
            reasons.append(
                f"estimated {int(round(p * 100))}% completion chance here (no data yet - prior only)")
        if b.difficulty == "Hard" and period == self.focus_window:
            reasons.append(f"hard task placed in your preferred {self.focus_window} focus window")
        if b.deadline and days_left <= 3:
            reasons.append(f"deadline in {days_left} day{'s' if days_left != 1 else ''} ({b.deadline})")
        reasons.append(
            f"your past completion rate for {b.course} is {int(round(course_score * 100))}%")
        if b.parts > 1:
            reasons.append(f"session {b.part} of {b.parts} - spaced over the week for better retention")
        text = "Placed here because " + "; ".join(reasons) + "."
        return text, {
            "p_complete": round(p, 2),
            "observations": n,
            "days_to_deadline": days_left,
            "course_score": round(course_score, 2),
        }
