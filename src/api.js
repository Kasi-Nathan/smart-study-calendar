// Thin client for the Python scheduling engine.
// Every call fails gracefully so the UI can fall back to the local heuristic.

const BASE = "/api";
const AI_BASE =
  import.meta.env.VITE_AI_API_BASE ?? "http://localhost:8000/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

export async function checkHealth() {
  try {
    await request("/health");
    return true;
  } catch {
    return false;
  }
}

export function fetchSchedule(tasks, preferences) {
  return request("/schedule", {
    method: "POST",
    body: JSON.stringify({ tasks, preferences }),
  });
}

export function sendFeedback(day, slot, completed) {
  return request("/feedback", {
    method: "POST",
    body: JSON.stringify({ day, slot, completed }),
  });
}

export function fetchModel() {
  return request("/model");
}

export function resetModel() {
  return request("/model/reset", { method: "POST" });
}

export async function fetchAIExplanation(block) {
  const res = await fetch(`${AI_BASE}/ai/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: block.title,
      course: block.course,
      difficulty: block.difficulty,
      priority: block.priority,
      existing_explanation: block.explanation ?? "",
      scoreBreakdown: block.scoreBreakdown ?? {},
    }),
  });

  if (!res.ok) throw new Error(`AI explanation failed: ${res.status}`);
  return res.json();
}
