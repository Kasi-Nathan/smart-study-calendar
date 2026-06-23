import { useEffect, useMemo, useState } from "react";
import CalendarView from "./components/CalendarView";
import {
  checkHealth,
  fetchAIExplanation,
  fetchModel,
  fetchSchedule,
  resetModel,
  sendFeedback,
} from "./api";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const timeSlots = [
  "09:00-10:30",
  "10:30-12:00",
  "14:00-15:30",
  "16:00-17:30",
  "19:00-20:30",
];

function blockId(block) {
  return block.id ?? `${block.taskId}-part-${block.part}`;
}

function normalizeBlock(block, day, slot) {
  return {
    ...block,
    id: blockId(block),
    day,
    slot,
    reason: block.reason ?? block.explanation ?? "",
  };
}

function findBlockCell(grid, id) {
  if (!grid) return null;
  for (const day of days) {
    for (const slot of timeSlots) {
      if (grid[day]?.[slot]?.id === id) return { day, slot };
    }
  }
  return null;
}

function dateToScheduleCell(value) {
  const date = new Date(value);
  const day = days[(date.getDay() + 6) % 7];
  const start = `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
  const slot = timeSlots.find((candidate) => candidate.startsWith(`${start}-`));
  return slot ? { day, slot } : null;
}

function isoDaysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const initialTasks = [
  {
    id: 1,
    title: "Data Modeling Exam Review",
    course: "Data Modeling",
    deadline: isoDaysFromNow(3),
    estimatedHours: 4.5,
    difficulty: "Hard",
    priority: "High",
    status: "Not started",
  },
  {
    id: 2,
    title: "Philosophy Reading: Kant, Ch. 4-6",
    course: "Philosophy",
    deadline: isoDaysFromNow(5),
    estimatedHours: 3,
    difficulty: "Medium",
    priority: "Medium",
    status: "Not started",
  },
  {
    id: 3,
    title: "German Vocabulary Practice",
    course: "German",
    deadline: isoDaysFromNow(7),
    estimatedHours: 2,
    difficulty: "Easy",
    priority: "Low",
    status: "Not started",
  },
  {
    id: 4,
    title: "IUI Milestone Presentation",
    course: "Intelligent User Interfaces",
    deadline: isoDaysFromNow(2),
    estimatedHours: 3,
    difficulty: "Hard",
    priority: "High",
    status: "Not started",
  },
];

/* ------------------------------------------------------------------ */
/* Local fallback heuristic (used only if the Python engine is offline) */
/* ------------------------------------------------------------------ */

function getPriorityScore(task) {
  const priorityScore = { High: 3, Medium: 2, Low: 1 };
  const difficultyScore = { Hard: 3, Medium: 2, Easy: 1 };
  const today = new Date();
  const deadline = new Date(task.deadline);
  const daysLeft = Math.max(
    1,
    Math.ceil((deadline - today) / (1000 * 60 * 60 * 24))
  );
  return (
    priorityScore[task.priority] * 2 +
    difficultyScore[task.difficulty] +
    10 / daysLeft
  );
}

function splitTaskIntoBlocks(task) {
  const blockCount = Math.ceil(task.estimatedHours / 1.5);
  return Array.from({ length: blockCount }, (_, index) => ({
    id: `${task.id}-part-${index + 1}`,
    taskId: task.id,
    title: task.title,
    course: task.course,
    difficulty: task.difficulty,
    priority: task.priority,
    part: index + 1,
    parts: blockCount,
    status: "Planned",
    explanation:
      "Placed by the local fallback heuristic (Python engine offline): sorted by urgency, hard tasks preferred in the morning.",
  }));
}

function generateLocalSchedule(tasks) {
  const sortedTasks = [...tasks]
    .filter((task) => task.status !== "Completed")
    .sort((a, b) => getPriorityScore(b) - getPriorityScore(a));

  const blocks = sortedTasks.flatMap(splitTaskIntoBlocks);
  const schedule = {};
  days.forEach((day) => {
    schedule[day] = {};
    timeSlots.forEach((slot) => (schedule[day][slot] = null));
  });

  for (const block of blocks) {
    let placed = false;
    for (const day of days) {
      for (const slot of timeSlots) {
        const isMorning = slot === "09:00-10:30" || slot === "10:30-12:00";
        if (block.difficulty === "Hard" && !isMorning) continue;
        if (!schedule[day][slot]) {
          schedule[day][slot] = normalizeBlock(block, day, slot);
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      outer: for (const day of days) {
        for (const slot of timeSlots) {
          if (!schedule[day][slot]) {
            schedule[day][slot] = normalizeBlock(block, day, slot);
            break outer;
          }
        }
      }
    }
  }
  return schedule;
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function Label({ children }) {
  return (
    <label className="block text-sm font-semibold tracking-wide text-slate-700 mb-2">
      {children}
    </label>
  );
}

function StatCard({ number, label }) {
  return (
    <div className="rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_45px_-30px_rgba(15,23,42,0.35)] p-5 text-center">
      <div className="text-3xl font-semibold text-slate-900">{number}</div>
      <div className="text-xs text-slate-500 mt-2 uppercase tracking-[0.2em]">
        {label}
      </div>
    </div>
  );
}

function EngineBadge({ online }) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
        online
          ? "bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-300/40"
          : "bg-rose-400/20 text-rose-200 ring-1 ring-rose-300/40"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          online ? "bg-emerald-400" : "bg-rose-400"
        }`}
      />
      Python engine {online ? "online" : "offline"}
    </div>
  );
}

function SparklesIcon({ className = "h-3.5 w-3.5" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
    >
      <path d="M12 3l1.15 3.85L17 8l-3.85 1.15L12 13l-1.15-3.85L7 8l3.85-1.15L12 3Z" />
      <path d="M18.5 13l.72 2.28L21.5 16l-2.28.72L18.5 19l-.72-2.28L15.5 16l2.28-.72L18.5 13Z" />
      <path d="M5.5 13l.55 1.45L7.5 15l-1.45.55L5.5 17l-.55-1.45L3.5 15l1.45-.55L5.5 13Z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [tasks, setTasks] = useState(initialTasks);
  const [schedule, setSchedule] = useState(null);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [aiExplanation, setAIExplanation] = useState("");
  const [aiLoading, setAILoading] = useState(false);
  const [aiUsedFallback, setAIUsedFallback] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);
  const [heatmap, setHeatmap] = useState(null);
  const [modelEvents, setModelEvents] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [recommendation, setRecommendation] = useState(
    "Add your tasks and generate a weekly study plan."
  );

  const [prefs, setPrefs] = useState({
    focusWindow: "morning",
    maxBlocksPerDay: 3,
  });

  const [form, setForm] = useState({
    title: "",
    course: "",
    deadline: "",
    estimatedHours: 1.5,
    difficulty: "Medium",
    priority: "Medium",
  });

  useEffect(() => {
    let active = true;
    async function init() {
      const ok = await checkHealth();
      if (!active) return;
      setBackendOnline(ok);
      if (ok) refreshModel();
    }
    init();
    const id = setInterval(init, 15000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  async function refreshModel() {
    try {
      const data = await fetchModel();
      setHeatmap(data.heatmap);
      setModelEvents(data.events);
    } catch {
      /* engine offline - heatmap stays stale */
    }
  }

  const analytics = useMemo(() => {
    let total = 0;
    let completed = 0;
    let skipped = 0;
    if (!schedule) return { total: 0, completed: 0, skipped: 0, completionRate: 0 };
    days.forEach((day) => {
      timeSlots.forEach((slot) => {
        const block = schedule[day][slot];
        if (block) {
          total++;
          if (block.status === "Completed") completed++;
          if (block.status === "Skipped") skipped++;
        }
      });
    });
    return {
      total,
      completed,
      skipped,
      completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
    };
  }, [schedule]);

  function handleAddTask(event) {
    event.preventDefault();
    if (!form.title || !form.course || !form.deadline) {
      setRecommendation("Please fill in the task title, course, and deadline.");
      return;
    }
    const newTask = {
      id: Date.now(),
      ...form,
      estimatedHours: Number(form.estimatedHours),
      status: "Not started",
    };
    setTasks((prev) => [...prev, newTask]);
    setForm({
      title: "",
      course: "",
      deadline: "",
      estimatedHours: 1.5,
      difficulty: "Medium",
      priority: "Medium",
    });
    setRecommendation("New task added. You can now regenerate your weekly plan.");
  }

  function handleDeleteTask(taskId) {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
    if (schedule) {
      setSchedule((prev) => {
        const updated = structuredClone(prev);
        days.forEach((day) => {
          timeSlots.forEach((slot) => {
            if (updated[day][slot]?.taskId === taskId) updated[day][slot] = null;
          });
        });
        return updated;
      });
    }
    setRecommendation("Task deleted. You can regenerate your weekly plan.");
  }

  async function handleGeneratePlan() {
    setGenerating(true);
    try {
      const data = await fetchSchedule(tasks, prefs);
      const grid = {};
      days.forEach((day) => {
        grid[day] = {};
        timeSlots.forEach((slot) => {
          const b = data.schedule[day][slot];
          grid[day][slot] = b ? normalizeBlock(b, day, slot) : null;
        });
      });
      setSchedule(grid);
      setBackendOnline(true);
      setRecommendation(data.message);
      refreshModel();
    } catch {
      setBackendOnline(false);
      setSchedule(generateLocalSchedule(tasks));
      setRecommendation(
        "Python engine not reachable - generated a plan with the local fallback heuristic instead."
      );
    } finally {
      setGenerating(false);
      setActivePage("Calendar");
    }
  }

  function handleMoveBlock(id, newStart, newEnd) {
    const target = dateToScheduleCell(newStart);
    const source = findBlockCell(schedule, id);
    if (!source || !target) return false;

    const { day: sourceDay, slot: sourceSlot } = source;
    const { day: targetDay, slot: targetSlot } = target;
    if (sourceDay === targetDay && sourceSlot === targetSlot) {
      return true;
    }

    setSchedule((prev) => {
      const currentSource = findBlockCell(prev, id);
      if (!currentSource) return prev;

      const updated = structuredClone(prev);
      const sourceBlock = updated[currentSource.day][currentSource.slot];
      const targetBlock = updated[targetDay][targetSlot];
      if (!sourceBlock) return prev;

      if (targetBlock) {
        updated[currentSource.day][currentSource.slot] = {
          ...targetBlock,
          day: currentSource.day,
          slot: currentSource.slot,
        };
      } else {
        updated[currentSource.day][currentSource.slot] = null;
      }

      const manualReason =
        "Manually moved by you - the optimizer respects your choice. (User control over AI initiative.)";
      updated[targetDay][targetSlot] = {
        ...sourceBlock,
        day: targetDay,
        slot: targetSlot,
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
        manuallyMoved: true,
        explanation: manualReason,
        reason: manualReason,
      };
      return updated;
    });

    setSelectedBlock((current) =>
      current?.id === id
        ? {
            ...current,
            day: targetDay,
            slot: targetSlot,
            start: newStart.toISOString(),
            end: newEnd.toISOString(),
            manuallyMoved: true,
          }
        : current
    );
    setRecommendation("Task moved. Your schedule now reflects the new placement.");
    return true;
  }

  async function handleFeedback(block, action) {
    const status = action === "complete" ? "Completed" : "Skipped";
    const cell = findBlockCell(schedule, block.id);
    if (!cell) return;

    setSchedule((prev) => {
      const currentCell = findBlockCell(prev, block.id);
      if (!currentCell) return prev;
      const updated = structuredClone(prev);
      updated[currentCell.day][currentCell.slot].status = status;
      return updated;
    });
    setSelectedBlock((current) =>
      current?.id === block.id ? { ...current, status } : current
    );

    if (backendOnline) {
      try {
        const res = await sendFeedback(
          cell.day,
          cell.slot,
          action === "complete"
        );
        setRecommendation(res.message);
        refreshModel();
        return;
      } catch {
        setBackendOnline(false);
      }
    }

    if (action === "complete") {
      setRecommendation("Good job. Your progress has been updated.");
    } else {
      setRecommendation(
        "You skipped this study block. Regenerate the plan and the engine will avoid this slot for hard tasks."
      );
    }
  }

  function openBlockDetails(block) {
    setAIExplanation("");
    setAILoading(false);
    setAIUsedFallback(false);
    setSelectedBlock(block);
  }

  async function handleAIExplain(block) {
    setSelectedBlock(block);
    setAIExplanation("");
    setAIUsedFallback(false);
    setAILoading(true);
    try {
      const data = await fetchAIExplanation(block);
      const useFallback = data.fallback || !data.explanation?.trim();
      setAIExplanation(
        useFallback ? block.explanation : data.explanation
      );
      setAIUsedFallback(useFallback);
    } catch {
      setAIExplanation(block.explanation);
      setAIUsedFallback(true);
    } finally {
      setAILoading(false);
    }
  }

  const navItems = ["Dashboard", "Calendar", "Tasks", "Analytics", "Settings"];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(34,197,94,0.16),_transparent_22%),linear-gradient(180deg,#f8fafc,#eaf5f4)] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col bg-gradient-to-br from-slate-950 via-cyan-900 to-emerald-700 p-6 text-white md:flex">
          <h1 className="text-3xl font-bold mb-1 tracking-tight">StudyPlan</h1>
          <p className="text-sm text-slate-200 mb-4 max-w-[12rem]">
            Smart Study Calendar
          </p>
          <div className="mb-8">
            <EngineBadge online={backendOnline} />
          </div>

          <nav className="space-y-3 text-sm">
            {navItems.map((item) => (
              <button
                key={item}
                onClick={() => setActivePage(item)}
                className={`w-full text-left rounded-xl px-4 py-3 transition ${
                  activePage === item
                    ? "bg-white/20 font-semibold"
                    : "hover:bg-white/10"
                }`}
              >
                {item}
              </button>
            ))}
          </nav>

          <div className="mt-auto text-xs text-slate-200 opacity-90">
            Bayesian focus model · schedule optimizer · explainable placements
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 md:px-8 lg:px-10">
          <header className="mb-10">
            <div className="inline-flex items-center rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200">
              Intelligent User Interfaces Project · Group 7
            </div>
            <h2 className="text-3xl md:text-5xl font-bold mt-6 tracking-tight text-slate-950">
              Smart Study Calendar
            </h2>
            <p className="text-slate-600 mt-4 max-w-3xl text-base leading-7">
              Your tasks, deadlines and habits go in. A Python engine learns
              when you actually study best and optimizes a weekly plan around
              it - and every placement can explain itself.
            </p>
          </header>

          {activePage === "Dashboard" && (
            <DashboardPage
              tasks={tasks}
              analytics={analytics}
              recommendation={recommendation}
              handleGeneratePlan={handleGeneratePlan}
              generating={generating}
              setActivePage={setActivePage}
            />
          )}

          {activePage === "Tasks" && (
            <TasksPage
              form={form}
              setForm={setForm}
              tasks={tasks}
              handleAddTask={handleAddTask}
              handleDeleteTask={handleDeleteTask}
              handleGeneratePlan={handleGeneratePlan}
              generating={generating}
            />
          )}

          {activePage === "Calendar" && (
            <>
              <CalendarView
                schedule={schedule}
                generating={generating}
                expanded={calendarExpanded}
                onToggleExpanded={() => setCalendarExpanded((value) => !value)}
                onRegenerate={handleGeneratePlan}
                onMoveBlock={handleMoveBlock}
                onOpenBlock={openBlockDetails}
                onExplainBlock={handleAIExplain}
              />
              {selectedBlock && (
                <TaskModal
                  block={selectedBlock}
                  aiExplanation={aiExplanation}
                  aiLoading={aiLoading}
                  aiUsedFallback={aiUsedFallback}
                  onAIExplain={() => handleAIExplain(selectedBlock)}
                  onClose={() => setSelectedBlock(null)}
                  onStatusChange={(action) =>
                    handleFeedback(selectedBlock, action)
                  }
                />
              )}
            </>
          )}

          {activePage === "Analytics" && (
            <AnalyticsPage
              analytics={analytics}
              tasks={tasks}
              heatmap={heatmap}
              modelEvents={modelEvents}
              backendOnline={backendOnline}
            />
          )}

          {activePage === "Settings" && (
            <SettingsPage
              prefs={prefs}
              setPrefs={setPrefs}
              backendOnline={backendOnline}
              onResetModel={async () => {
                try {
                  const res = await resetModel();
                  setRecommendation(res.message);
                  refreshModel();
                } catch {
                  setBackendOnline(false);
                }
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

function DashboardPage({
  tasks,
  analytics,
  recommendation,
  handleGeneratePlan,
  generating,
  setActivePage,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section className="lg:col-span-2 bg-white/95 border border-slate-200 rounded-[2rem] shadow-[0_20px_55px_-35px_rgba(15,23,42,0.25)] p-6">
        <h3 className="font-bold text-xl mb-4 text-slate-950">
          Dashboard Overview
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatCard number={analytics.completionRate + "%"} label="Completed" />
          <StatCard number={tasks.length} label="Tasks" />
          <StatCard number={analytics.skipped} label="Skipped Blocks" />
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-3xl p-5 mb-6 shadow-sm">
          <h4 className="font-bold mb-2 text-slate-900">Assistant</h4>
          <p className="text-sm leading-6 text-slate-600">{recommendation}</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => setActivePage("Tasks")}
            className="bg-slate-950 text-white rounded-2xl px-5 py-3 font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            Add or Manage Tasks
          </button>

          <button
            onClick={handleGeneratePlan}
            disabled={generating}
            className="bg-amber-400 text-slate-950 rounded-2xl px-5 py-3 font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60"
          >
            {generating ? "Optimizing..." : "Generate Weekly Plan"}
          </button>
        </div>
      </section>

      <section className="bg-white/95 border border-slate-200 rounded-[2rem] shadow-[0_20px_55px_-35px_rgba(15,23,42,0.15)] p-6">
        <h3 className="font-bold text-xl mb-4 text-slate-950">Upcoming Tasks</h3>
        <div className="space-y-3">
          {tasks.slice(0, 5).map((task) => (
            <div key={task.id} className="border rounded-2xl p-4 bg-slate-50">
              <div className="font-semibold">{task.title}</div>
              <div className="text-sm text-slate-600">
                {task.course} · {task.difficulty} · {task.priority}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Deadline: {task.deadline}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TasksPage({
  form,
  setForm,
  tasks,
  handleAddTask,
  handleDeleteTask,
  handleGeneratePlan,
  generating,
}) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="bg-white/95 border border-slate-200 rounded-[2rem] shadow-[0_20px_55px_-35px_rgba(15,23,42,0.25)] p-6">
        <h3 className="font-bold text-lg mb-4 text-slate-950">Add Study Task</h3>

        <form onSubmit={handleAddTask} className="space-y-4">
          <div>
            <Label>Task Title</Label>
            <input
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              placeholder="e.g. IUI Presentation Preparation"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div>
            <Label>Course</Label>
            <input
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              placeholder="e.g. Intelligent User Interfaces"
              value={form.course}
              onChange={(e) => setForm({ ...form, course: e.target.value })}
            />
          </div>

          <div>
            <Label>Deadline</Label>
            <input
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              type="date"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            />
          </div>

          <div>
            <Label>Estimated Study Hours</Label>
            <input
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              type="number"
              min="0.5"
              step="0.5"
              value={form.estimatedHours}
              onChange={(e) =>
                setForm({ ...form, estimatedHours: e.target.value })
              }
            />
          </div>

          <div>
            <Label>Difficulty</Label>
            <select
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              value={form.difficulty}
              onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
            >
              <option>Easy</option>
              <option>Medium</option>
              <option>Hard</option>
            </select>
          </div>

          <div>
            <Label>Priority</Label>
            <select
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
            </select>
          </div>

          <button className="w-full bg-slate-950 text-white rounded-2xl py-2 font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            Add Task
          </button>
        </form>
      </div>

      <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-950">Task List</h3>
          <button
            onClick={handleGeneratePlan}
            disabled={generating}
            className="bg-amber-400 text-slate-950 rounded-2xl px-5 py-2 font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60"
          >
            {generating ? "Optimizing..." : "Generate Weekly Plan"}
          </button>
        </div>

        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="border rounded-2xl p-4 bg-slate-50 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
            >
              <div>
                <div className="font-semibold">{task.title}</div>
                <div className="text-sm text-slate-600">
                  {task.course} · {task.difficulty} · {task.priority}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Deadline: {task.deadline} · {task.estimatedHours}h
                </div>
              </div>

              <button
                onClick={() => handleDeleteTask(task.id)}
                className="border border-red-300 text-red-600 rounded-2xl px-4 py-2 text-sm font-semibold transition hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TaskModal({
  block,
  aiExplanation,
  aiLoading,
  aiUsedFallback,
  onAIExplain,
  onClose,
  onStatusChange,
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-modal-title"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl"
      >
        <div className="modal-scroll min-h-0 flex-1 overflow-y-auto px-6 pt-6 sm:px-8 sm:pt-8">
          <h3 id="task-modal-title" className="mb-2 text-2xl font-bold text-slate-950">
            {block.course}
          </h3>
          <p className="mb-4 text-sm text-slate-600">
            {block.title}
            {block.parts > 1 && (
              <span className="ml-2 inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">
                Session {block.part}/{block.parts}
              </span>
            )}
          </p>

          <div className="mb-5 space-y-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
            <div className="flex justify-between">
              <span className="text-sm font-semibold text-slate-700">Priority:</span>
              <span className="text-sm font-medium text-slate-900">{block.priority}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-semibold text-slate-700">Difficulty:</span>
              <span className="text-sm font-medium text-slate-900">{block.difficulty}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-semibold text-slate-700">Status:</span>
              <span className="text-sm font-medium text-slate-900">{block.status}</span>
            </div>
          </div>

          {block.explanation && (
            <div className="mb-4 rounded-[1.25rem] border border-cyan-200 bg-cyan-50 p-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-800">
                Why this slot?
              </div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-cyan-950">
                {block.explanation}
              </p>
            </div>
          )}

          {(aiLoading || aiExplanation) && (
            <div className="mb-2 rounded-[1.25rem] border border-violet-200 bg-violet-50 p-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-violet-800">
                {aiUsedFallback ? "Engine explanation" : "Gemini explanation"}
              </div>
              <div className="modal-scroll max-h-[230px] overflow-y-auto pr-2">
                <p className="whitespace-pre-wrap text-sm leading-6 text-violet-950">
                  {aiLoading ? "Gemini is preparing an explanation..." : aiExplanation}
                </p>
              </div>
            </div>
          )}
          <div className="h-4" />
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white px-6 pb-6 pt-4 shadow-[0_-12px_30px_-24px_rgba(15,23,42,0.45)] sm:px-8">
          <button
            onClick={onAIExplain}
            disabled={aiLoading}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 font-semibold text-white transition hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60"
          >
            <SparklesIcon className="h-4 w-4" />
            {aiLoading ? "Explaining..." : "AI Explain"}
          </button>

          <div className="flex gap-3">
            <button
              onClick={() => onStatusChange("complete")}
              className="flex-1 rounded-2xl bg-slate-950 px-4 py-3 font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-md"
            >
              Mark Done
            </button>
            <button
              onClick={() => onStatusChange("skip")}
              className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-900 transition hover:bg-slate-50"
            >
              Skip
            </button>
          </div>

          <button
            onClick={onClose}
            className="mt-2 w-full py-2 text-sm text-slate-600 transition hover:text-slate-900"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/*
The former inline calendar grid was retired in favor of components/CalendarView.
It remains inside this migration comment only until the surrounding file is split
into page-level components.

function CalendarPage({
  schedule,
  handleGeneratePlan,
  generating,
  handleBlockDragStart,
  handleBlockDragEnd,
  moveBlockToSlot,
  dragOver,
  handleDragEnter,
  handleDragLeave,
  calendarExpanded,
  setCalendarExpanded,
  openBlockDetails,
  handleAIExplain,
}) {
  const weekStart = useMemo(() => getWeekMonday(), []);
  const calendarEvents = useMemo(
    () => scheduleToCalendarEvents(schedule, weekStart),
    [schedule, weekStart]
  );

  function handleCalendarDrop(info) {
    const source = {
      day: info.oldEvent.extendedProps.day,
      slot: info.oldEvent.extendedProps.slot,
    };
    const target = calendarDateToCell(info.event.start, weekStart);

    if (!target) {
      info.revert();
      return;
    }

    moveBlockToSlot(target.day, target.slot, source);
  }

  function renderCalendarEvent(info) {
    const block = info.event.extendedProps;
    return (
      <div className="study-event-content">
        <div className="study-event-course">{block.course}</div>
        <div className="study-event-title">{block.title}</div>
        <div className="study-event-footer">
          {block.parts > 1 ? (
            <span className="study-event-part">
              {block.part}/{block.parts}
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="study-event-ai"
            onClick={(event) => {
              event.stopPropagation();
              handleAIExplain(block);
            }}
          >
            <SparklesIcon />
            AI
          </button>
        </div>
      </div>
    );
  }

  const fullCalendarView = (
    <section
      className={`bg-white/95 border border-slate-200 rounded-[2rem] shadow-[0_20px_55px_-35px_rgba(15,23,42,0.25)] p-4 md:p-6 transition-all duration-300 w-full ${
        calendarExpanded ? "fixed inset-3 z-30 overflow-y-auto bg-white" : "relative"
      }`}
    >
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-bold text-slate-950">Weekly Calendar</h3>
          <p className="mt-1 text-sm text-slate-500">
            Drag blocks between supported study slots. Click one for details,
            completion controls, and its AI explanation.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <button
            onClick={() => setCalendarExpanded((value) => !value)}
            className="rounded-2xl bg-slate-950 px-5 py-2 font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            {calendarExpanded ? "Collapse View" : "Expand Calendar"}
          </button>
          <button
            onClick={handleGeneratePlan}
            disabled={generating}
            className="rounded-2xl bg-amber-400 px-5 py-2 font-semibold text-slate-950 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60"
          >
            {generating ? "Optimizing..." : "Regenerate Plan"}
          </button>
        </div>
      </div>

      {!schedule ? (
        <div className="py-16 text-center text-slate-500">
          Click “Generate Weekly Plan” to create your study calendar.
        </div>
      ) : (
        <div className="study-calendar-frame">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialDate={weekStart}
            initialView="timeGridWeek"
            firstDay={1}
            height="auto"
            nowIndicator
            navLinks
            editable
            eventStartEditable
            eventDurationEditable={false}
            allDaySlot={false}
            slotMinTime="08:00:00"
            slotMaxTime="22:00:00"
            slotDuration="00:30:00"
            snapDuration="00:30:00"
            slotLabelInterval="01:00:00"
            expandRows={false}
            dayMaxEvents
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay",
            }}
            events={calendarEvents}
            eventContent={renderCalendarEvent}
            eventClick={(info) => openBlockDetails(info.event.extendedProps)}
            eventDrop={handleCalendarDrop}
          />
        </div>
      )}
    </section>
  );

  Kept as an inert fallback while the FullCalendar migration settles.
  if (!FullCalendar) return (
    <section
      className={`bg-white/95 border border-slate-200 rounded-[2rem] shadow-[0_20px_55px_-35px_rgba(15,23,42,0.25)] p-4 md:p-6 transition-all duration-300 w-full ${
        calendarExpanded ? "fixed inset-3 z-30 overflow-y-auto bg-white" : "relative"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <h3 className="font-bold text-xl text-slate-950">Weekly Calendar</h3>
          <p className="text-sm text-slate-500 mt-1">
            Drag blocks to override the optimizer. Click a block to see why it
            was placed there.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end w-full sm:w-auto">
          <button
            onClick={() => setCalendarExpanded((value) => !value)}
            className="bg-slate-950 text-white rounded-2xl px-5 py-2 font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            {calendarExpanded ? "Collapse View" : "Expand Calendar"}
          </button>

          <button
            onClick={handleGeneratePlan}
            disabled={generating}
            className="bg-amber-400 text-slate-950 rounded-2xl px-5 py-2 font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60"
          >
            {generating ? "Optimizing..." : "Regenerate Plan"}
          </button>
        </div>
      </div>

      {!schedule ? (
        <div className="text-slate-500 text-center py-16">
          Click “Generate Weekly Plan” to create your study calendar.
        </div>
      ) : (
        <>
          <div className="block md:hidden space-y-4">
            {timeSlots.map((slot) => (
              <div
                key={slot}
                className="space-y-3 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="font-semibold text-slate-800">{slot}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {days.map((day) => {
                    const block = schedule[day][slot];
                    const isDragTarget =
                      dragOver?.day === day && dragOver?.slot === slot;
                    return (
                      <div
                        key={day}
                        className={`rounded-[1.5rem] border p-3 transition ${
                          isDragTarget
                            ? "border-cyan-400 bg-cyan-50"
                            : "border-slate-200 bg-slate-50"
                        }`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={() => moveBlockToSlot(day, slot)}
                        onDragEnter={() => handleDragEnter(day, slot)}
                        onDragLeave={handleDragLeave}
                      >
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {day}
                        </div>
                        {block ? (
                          <div
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", "drag");
                              e.dataTransfer.effectAllowed = "move";
                              handleBlockDragStart(day, slot);
                            }}
                            onDragEnd={handleBlockDragEnd}
                            onClick={() => openBlockDetails({ ...block, day, slot })}
                            className={`cursor-grab rounded-[1.5rem] border border-slate-200 bg-white p-4 text-sm shadow-sm ${getBlockTheme(
                              block
                            )} transform-gpu transition duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg group`}
                          >
                            <div className="font-semibold text-slate-900 truncate">
                              {block.course}
                            </div>
                            <div className="text-sm mt-2 leading-5 text-slate-600 line-clamp-3">
                              {block.title}
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2">
                              {block.parts > 1 ? (
                                <span className="inline-flex rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                                  {block.part}/{block.parts}
                                </span>
                              ) : (
                                <span />
                              )}
                              <button
                                type="button"
                                draggable={false}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleAIExplain({ ...block, day, slot });
                                }}
                                onMouseDown={(event) => event.stopPropagation()}
                                className="inline-flex items-center gap-1 rounded-lg border border-violet-400 bg-white/80 px-2.5 py-1 text-[11px] font-bold text-violet-700 shadow-sm transition hover:border-violet-600 hover:bg-violet-50"
                              >
                                <SparklesIcon />
                                AI
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-100 px-4 py-5 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 transition duration-200 ease-out hover:bg-slate-200 hover:text-slate-800">
                            Free slot
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto rounded-[1.75rem] border border-slate-200 bg-slate-50 shadow-sm">
            <table className="w-full min-w-[840px] lg:min-w-[980px] table-fixed border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="border-b border-slate-200 bg-slate-950 p-4 text-left text-sm uppercase tracking-[0.14em] text-white w-[140px]">
                    Time
                  </th>
                  {days.map((day) => (
                    <th
                      key={day}
                      className="border-b border-slate-200 bg-slate-950 p-4 text-sm uppercase tracking-[0.14em] text-white"
                    >
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {timeSlots.map((slot) => (
                  <tr key={slot} className="even:bg-slate-50 odd:bg-slate-100">
                    <td className="border-b border-slate-200 p-3 font-medium text-sm align-top bg-white">
                      {slot}
                    </td>

                    {days.map((day) => {
                      const block = schedule[day][slot];
                      const isDragTarget =
                        dragOver?.day === day && dragOver?.slot === slot;
                      return (
                        <td
                          key={day}
                          className={`border-b border-slate-200 p-2 align-top transition ${
                            isDragTarget
                              ? "bg-cyan-50 ring-2 ring-cyan-300"
                              : "bg-slate-50"
                          }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={() => moveBlockToSlot(day, slot)}
                          onDragEnter={() => handleDragEnter(day, slot)}
                          onDragLeave={handleDragLeave}
                        >
                          {block ? (
                            <div
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", "drag");
                                e.dataTransfer.effectAllowed = "move";
                                handleBlockDragStart(day, slot);
                              }}
                              onDragEnd={handleBlockDragEnd}
                              onClick={() => openBlockDetails({ ...block, day, slot })}
                              className={`cursor-grab relative w-full h-[10.5rem] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-4 text-sm shadow-sm ${getBlockTheme(
                                block
                              )} transform-gpu transition duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg group`}
                            >
                              <div className="pointer-events-none absolute inset-0 rounded-[1.5rem] bg-slate-950/5 opacity-0 transition duration-300 group-hover:opacity-100" />
                              <div className="relative z-10 flex h-full flex-col justify-between">
                                <div>
                                  <div className="font-semibold text-slate-900 truncate">
                                    {block.course}
                                  </div>
                                  <div className="text-sm mt-2 leading-5 text-slate-600 line-clamp-2">
                                    {block.title}
                                  </div>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    draggable={false}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleAIExplain({ ...block, day, slot });
                                    }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    className="inline-flex items-center gap-1 rounded-lg border border-violet-400 bg-white/80 px-2.5 py-1 text-[11px] font-bold text-violet-700 shadow-sm transition hover:border-violet-600 hover:bg-violet-50"
                                  >
                                    <SparklesIcon />
                                    AI
                                  </button>
                                  {block.parts > 1 && (
                                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200">
                                      {block.part}/{block.parts}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="h-[10.5rem] flex items-center justify-center rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-100 px-4 py-6 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 transition duration-200 ease-out hover:bg-slate-200 hover:text-slate-800">
                              Free slot
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );

  return fullCalendarView;
}
*/

/* ------------------------------------------------------------------ */
/* Analytics: learned focus profile                                    */
/* ------------------------------------------------------------------ */

function heatColor(p) {
  // 0.2 -> rose, 0.5 -> amber, 0.8 -> emerald
  if (p >= 0.66) return "bg-emerald-400/80";
  if (p >= 0.58) return "bg-emerald-300/70";
  if (p >= 0.5) return "bg-amber-200/80";
  if (p >= 0.42) return "bg-amber-300/80";
  if (p >= 0.34) return "bg-rose-300/80";
  return "bg-rose-400/80";
}

function FocusHeatmap({ heatmap }) {
  const lookup = {};
  (heatmap ?? []).forEach((c) => (lookup[`${c.day}|${c.slot}`] = c));
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 min-w-[640px]">
        <thead>
          <tr>
            <th className="text-left text-xs font-semibold text-slate-500 pr-2" />
            {days.map((d) => (
              <th key={d} className="text-xs font-semibold text-slate-500 px-1">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {timeSlots.map((s) => (
            <tr key={s}>
              <td className="text-xs font-medium text-slate-600 pr-2 whitespace-nowrap">
                {s}
              </td>
              {days.map((d) => {
                const cell = lookup[`${d}|${s}`];
                const p = cell?.p ?? 0.5;
                return (
                  <td key={d}>
                    <div
                      title={
                        cell
                          ? `${d} ${s}: ${Math.round(p * 100)}% expected completion (±${Math.round(
                              (cell.sd ?? 0) * 100
                            )}%, ${cell.n} obs.)`
                          : ""
                      }
                      className={`h-10 w-16 rounded-xl ${heatColor(
                        p
                      )} flex items-center justify-center text-[11px] font-bold text-slate-800/90 ring-1 ring-slate-900/5`}
                    >
                      {Math.round(p * 100)}%
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsPage({ analytics, tasks, heatmap, modelEvents, backendOnline }) {
  const hardTasks = tasks.filter((t) => t.difficulty === "Hard").length;
  const highPriorityTasks = tasks.filter((t) => t.priority === "High").length;

  return (
    <div className="space-y-6">
      <section className="bg-white/95 border border-slate-200 rounded-[2rem] shadow-[0_20px_55px_-35px_rgba(15,23,42,0.15)] p-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between mb-5">
          <div>
            <h3 className="font-bold text-xl text-slate-950">
              Your Focus Profile (learned)
            </h3>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Expected probability that you complete a study block in each
              slot. A Beta-Bernoulli model per cell, updated live from every
              “Done” / “Skip” you give. The optimizer reads this map when
              placing hard tasks.
            </p>
          </div>
          <div className="text-xs font-semibold text-slate-500">
            {backendOnline
              ? `${modelEvents} feedback events observed`
              : "Engine offline - showing last known profile"}
          </div>
        </div>
        <FocusHeatmap heatmap={heatmap} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white/95 border border-slate-200 rounded-[2rem] shadow-[0_20px_55px_-35px_rgba(15,23,42,0.15)] p-6">
          <h3 className="font-bold text-xl mb-4 text-slate-950">
            Schedule Performance
          </h3>
          <StatCard
            number={analytics.completionRate + "%"}
            label="Completion Rate"
          />
          <p className="text-sm text-slate-600 mt-5 leading-6">
            Share of scheduled blocks marked as completed this week. The
            engine uses this signal to keep plans realistic.
          </p>
        </div>

        <div className="bg-white/95 border border-slate-200 rounded-[2rem] shadow-[0_20px_55px_-35px_rgba(15,23,42,0.15)] p-6">
          <h3 className="font-bold text-xl mb-4 text-slate-950">
            Workload Summary
          </h3>
          <div className="space-y-3">
            <StatCard number={tasks.length} label="Total Tasks" />
            <StatCard number={hardTasks} label="Hard Tasks" />
            <StatCard number={highPriorityTasks} label="High Priority Tasks" />
          </div>
        </div>

        <div className="bg-white/95 border border-slate-200 rounded-[2rem] shadow-[0_20px_55px_-35px_rgba(15,23,42,0.15)] p-6">
          <h3 className="font-bold text-xl mb-4 text-slate-950">
            How the model works
          </h3>
          <div className="bg-slate-50 border border-slate-200 rounded-[1.75rem] p-5 text-sm leading-6 text-slate-600">
            Each cell keeps a Beta(α, β) belief over your completion
            probability. “Done” adds to α, “Skip” adds to β. With no data the
            model falls back to a gentle morning-focus prior - and the more
            feedback you give, the more the weekly plan bends around{" "}
            <span className="font-semibold text-slate-800">your</span> rhythm
            instead of a generic one.
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings: now actually wired into the optimizer                     */
/* ------------------------------------------------------------------ */

function SettingsPage({ prefs, setPrefs, backendOnline, onResetModel }) {
  return (
    <section className="bg-white/95 border border-slate-200 rounded-[2rem] shadow-[0_20px_55px_-35px_rgba(15,23,42,0.15)] p-6 max-w-3xl">
      <h3 className="font-bold text-xl mb-2 text-slate-950">
        Settings & Preferences
      </h3>
      <p className="text-sm text-slate-500 mb-6">
        These preferences are sent to the Python optimizer with every
        “Generate Weekly Plan”.
      </p>

      <div className="space-y-5">
        <div className="border border-slate-200 rounded-[1.75rem] p-5 bg-white shadow-sm">
          <h4 className="font-semibold text-slate-950 mb-3">
            Preferred Focus Window
          </h4>
          <div className="flex gap-2">
            {["morning", "afternoon", "evening"].map((w) => (
              <button
                key={w}
                onClick={() => setPrefs({ ...prefs, focusWindow: w })}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold capitalize transition ${
                  prefs.focusWindow === w
                    ? "bg-slate-950 text-white shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Hard tasks get a scoring bonus inside this window.
          </p>
        </div>

        <div className="border border-slate-200 rounded-[1.75rem] p-5 bg-white shadow-sm">
          <h4 className="font-semibold text-slate-950 mb-3">
            Maximum Study Blocks per Day
          </h4>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="1"
              max="5"
              value={prefs.maxBlocksPerDay}
              onChange={(e) =>
                setPrefs({ ...prefs, maxBlocksPerDay: Number(e.target.value) })
              }
              className="w-56 accent-cyan-600"
            />
            <span className="text-lg font-bold text-slate-900">
              {prefs.maxBlocksPerDay}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            The optimizer penalizes days that exceed this load.
          </p>
        </div>

        <div className="border border-slate-200 rounded-[1.75rem] p-5 bg-white shadow-sm">
          <h4 className="font-semibold text-slate-950 mb-2">Focus Profile</h4>
          <p className="text-sm text-slate-600 mb-4">
            Resets the learned Beta-Bernoulli model back to its prior.
          </p>
          <button
            onClick={onResetModel}
            disabled={!backendOnline}
            className="rounded-2xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
          >
            Reset learned profile
          </button>
        </div>
      </div>
    </section>
  );
}
