import { useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import "./CalendarView.css";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIME_SLOTS = [
  "09:00-10:30",
  "10:30-12:00",
  "14:00-15:30",
  "16:00-17:30",
  "19:00-20:30",
];

function getWeekMonday(value = new Date()) {
  const monday = new Date(value);
  monday.setHours(0, 0, 0, 0);
  const weekday = monday.getDay();
  monday.setDate(monday.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return monday;
}

function addDays(value, amount) {
  const result = new Date(value);
  result.setDate(result.getDate() + amount);
  return result;
}

function formatLocalDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function scheduleToCalendarEvents(schedule, weekStart) {
  if (!schedule) return [];

  return DAYS.flatMap((day, dayOffset) =>
    TIME_SLOTS.flatMap((slot) => {
      const block = schedule[day]?.[slot];
      if (!block) return [];

      const [startTime, endTime] = slot.split("-");
      const date = formatLocalDate(addDays(weekStart, dayOffset));
      const statusClass =
        block.status === "Completed"
          ? "study-completed"
          : block.status === "Skipped"
            ? "study-skipped"
            : "";

      return [{
        id: String(block.id),
        title: `${block.course}: ${block.title}`,
        start: `${date}T${startTime}:00`,
        end: `${date}T${endTime}:00`,
        classNames: [
          `study-${block.difficulty.toLowerCase()}`,
          statusClass,
        ].filter(Boolean),
        extendedProps: {
          block,
          taskId: block.taskId,
          status: block.status,
          difficulty: block.difficulty,
          reason: block.reason,
          scoreBreakdown: block.scoreBreakdown,
        },
      }];
    })
  );
}

function calendarDateToCell(value, weekStart) {
  const date = new Date(value);
  if (formatLocalDate(getWeekMonday(date)) !== formatLocalDate(weekStart)) {
    return null;
  }

  const day = DAYS[(date.getDay() + 6) % 7];
  const start = `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
  const slot = TIME_SLOTS.find((candidate) => candidate.startsWith(`${start}-`));
  return slot ? { day, slot } : null;
}

function SparklesIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M12 3l1.15 3.85L17 8l-3.85 1.15L12 13l-1.15-3.85L7 8l3.85-1.15L12 3Z" />
      <path d="M18.5 13l.72 2.28L21.5 16l-2.28.72L18.5 19l-.72-2.28L15.5 16l2.28-.72L18.5 13Z" />
    </svg>
  );
}

export default function CalendarView({
  schedule,
  generating,
  expanded,
  onToggleExpanded,
  onRegenerate,
  onMoveBlock,
  onOpenBlock,
  onExplainBlock,
}) {
  const weekStart = useMemo(() => getWeekMonday(), []);
  const events = useMemo(
    () => scheduleToCalendarEvents(schedule, weekStart),
    [schedule, weekStart]
  );

  function handleEventDrop(info) {
    const block = info.oldEvent.extendedProps.block;
    const target = calendarDateToCell(info.event.start, weekStart);
    if (!block || !target || !info.event.end) {
      info.revert();
      return;
    }

    const moved = onMoveBlock(block.id, info.event.start, info.event.end);
    if (moved === false) info.revert();
  }

  function renderEvent(info) {
    const block = info.event.extendedProps.block;
    return (
      <div className="calendar-event-content">
        <strong>{block.course}</strong>
        <span className="calendar-event-title">{block.title}</span>
        <div className="calendar-event-footer">
          <span>{block.parts > 1 ? `${block.part}/${block.parts}` : ""}</span>
          <button
            type="button"
            className="calendar-event-ai"
            onClick={(event) => {
              event.stopPropagation();
              onExplainBlock(block);
            }}
            aria-label={`Explain ${block.title}`}
          >
            <SparklesIcon />
            AI
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className={`calendar-panel ${expanded ? "calendar-panel-expanded" : ""}`}>
      <div className="calendar-panel-header">
        <div>
          <h3>Weekly Calendar</h3>
          <p>
            Drag blocks between study slots. Click an event for details,
            completion controls, and explanations.
          </p>
        </div>
        <div className="calendar-panel-actions">
          <button type="button" className="calendar-secondary-button" onClick={onToggleExpanded}>
            {expanded ? "Collapse View" : "Expand Calendar"}
          </button>
          <button
            type="button"
            className="calendar-primary-button"
            onClick={onRegenerate}
            disabled={generating}
          >
            {generating ? "Optimizing..." : "Regenerate Plan"}
          </button>
        </div>
      </div>

      {!schedule ? (
        <div className="calendar-empty">
          Generate a weekly plan to display your scheduled study blocks.
        </div>
      ) : (
        <div className="calendar-shell">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialDate={weekStart}
            initialView="timeGridWeek"
            firstDay={1}
            height="100%"
            contentHeight="100%"
            expandRows
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
            dayMaxEvents
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay",
            }}
            events={events}
            eventContent={renderEvent}
            eventClick={(info) => {
              onOpenBlock(info.event.extendedProps.block);
            }}
            eventDrop={handleEventDrop}
          />
        </div>
      )}
    </section>
  );
}
