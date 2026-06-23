import { useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import "./CalendarView.css";

function getWeekMonday(value = new Date()) {
  const monday = new Date(value);
  monday.setHours(0, 0, 0, 0);
  const weekday = monday.getDay();
  monday.setDate(monday.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return monday;
}

function blocksToCalendarEvents(blocks) {
  return blocks.map((block) => {
    const statusClass =
      block.status === "Completed"
        ? "study-completed"
        : block.status === "Skipped"
          ? "study-skipped"
          : "";

    return {
      id: String(block.id),
      title: `${block.course}: ${block.title}`,
      start: block.start,
      end: block.end,
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
    };
  });
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
  scheduledBlocks,
  generating,
  expanded,
  onToggleExpanded,
  onRegenerate,
  onEventDrop,
  onEventResize,
  onSelectBlock,
  onExplainBlock,
}) {
  const weekStart = useMemo(() => getWeekMonday(), []);
  const events = useMemo(
    () => blocksToCalendarEvents(scheduledBlocks),
    [scheduledBlocks]
  );

  function handleEventDrop(info) {
    const block = info.oldEvent.extendedProps.block;
    if (!block || !info.event.start || !info.event.end) {
      info.revert();
      return;
    }

    const moved = onEventDrop(block.id, info.event.start, info.event.end);
    if (moved === false) info.revert();
  }

  function handleEventResize(info) {
    const block = info.oldEvent.extendedProps.block;
    if (!block || !info.event.start || !info.event.end) {
      info.revert();
      return;
    }

    const resized = onEventResize(block.id, info.event.start, info.event.end);
    if (resized === false) info.revert();
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

      {!scheduledBlocks.length ? (
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
            eventDurationEditable
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
            eventDidMount={(info) => {
              info.el.title = info.event.title;
            }}
            eventClick={(info) => {
              onSelectBlock(info.event.extendedProps.block);
            }}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
          />
        </div>
      )}
    </section>
  );
}
