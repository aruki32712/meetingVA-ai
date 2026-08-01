import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTimelineVisualStates,
  sortTimelineEventsChronologically,
  timelineStatusPresentation
} from "../components/processing-timeline-state.ts";

test("timeline events remain in created_at order across transcription and analysis", () => {
  const ordered = sortTimelineEventsChronologically([
    { event_type: "analysis_started", created_at: "2026-08-01T10:04:00Z", event_order: 1 },
    { event_type: "transcription_completed", created_at: "2026-08-01T10:03:00Z", event_order: 99 },
    { event_type: "transcription_started", created_at: "2026-08-01T10:02:00Z", event_order: 20 },
    { event_type: "queued", created_at: "2026-08-01T10:01:00Z", event_order: 10 },
    { event_type: "audio_uploaded", created_at: "2026-08-01T10:00:30Z", event_order: 2 },
    { event_type: "meeting_created", created_at: "2026-08-01T10:00:00Z", event_order: 1 },
    { event_type: "analysis_completed", created_at: "2026-08-01T10:05:00Z", event_order: 2 }
  ]);

  assert.deepEqual(
    ordered.map((event) => event.event_type),
    [
      "meeting_created",
      "audio_uploaded",
      "queued",
      "transcription_started",
      "transcription_completed",
      "analysis_started",
      "analysis_completed"
    ]
  );
});

test("event_order is used only as a same-timestamp tie-breaker", () => {
  const ordered = sortTimelineEventsChronologically([
    { name: "second", created_at: "2026-08-01T10:00:00Z", event_order: 2 },
    { name: "first", created_at: "2026-08-01T10:00:00Z", event_order: 1 }
  ]);

  assert.deepEqual(ordered.map((event) => event.name), ["first", "second"]);
});

test("completed transcription and analysis stages no longer remain current", () => {
  const normalized = normalizeTimelineVisualStates([
    { name: "transcription queued", status: "current" as const, created_at: "2026-08-01T10:01:00Z", event_order: 1 },
    { name: "transcribing", status: "current" as const, created_at: "2026-08-01T10:02:00Z", event_order: 2 },
    { name: "transcript complete", status: "completed" as const, created_at: "2026-08-01T10:03:00Z", event_order: 3 },
    { name: "analysis queued", status: "current" as const, created_at: "2026-08-01T10:04:00Z", event_order: 4 },
    { name: "analyzing", status: "current" as const, created_at: "2026-08-01T10:05:00Z", event_order: 5 },
    { name: "analysis complete", status: "completed" as const, created_at: "2026-08-01T10:06:00Z", event_order: 6 }
  ]);

  assert.deepEqual(
    normalized.map((event) => event.status),
    ["completed", "completed", "completed", "completed", "completed", "completed"]
  );
});

test("only the latest active stage is current while future stages stay pending", () => {
  const normalized = normalizeTimelineVisualStates([
    { name: "queued", status: "current" as const, created_at: "2026-08-01T10:01:00Z", event_order: 1 },
    { name: "transcribing", status: "current" as const, created_at: "2026-08-01T10:02:00Z", event_order: 2 },
    { name: "transcript complete", status: "pending" as const, created_at: null, event_order: 3 },
    { name: "analysis queued", status: "pending" as const, created_at: null, event_order: 4 }
  ]);

  assert.deepEqual(
    normalized.map((event) => event.status),
    ["completed", "current", "pending", "pending"]
  );
  assert.equal(
    normalized.filter((event) => event.status === "current").length,
    1
  );
});

test("terminal failure and cancellation clear previous current states", () => {
  const failed = normalizeTimelineVisualStates([
    { status: "current" as const, created_at: "2026-08-01T10:01:00Z", event_order: 1 },
    { status: "failed" as const, created_at: "2026-08-01T10:02:00Z", event_order: 2 }
  ]);
  const cancelled = normalizeTimelineVisualStates([
    { status: "current" as const, created_at: "2026-08-01T10:01:00Z", event_order: 1 },
    { status: "cancelled" as const, created_at: "2026-08-01T10:02:00Z", event_order: 2 }
  ]);

  assert.deepEqual(failed.map((event) => event.status), ["completed", "failed"]);
  assert.deepEqual(cancelled.map((event) => event.status), ["completed", "cancelled"]);
});

test("timeline visual-state presentation snapshot", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(timelineStatusPresentation).map(([status, presentation]) => [
        status,
        {
          label: presentation.label,
          marker: presentation.marker,
          markerClass: presentation.markerClass,
          cardClass: presentation.cardClass
        }
      ])
    ),
    {
      pending: { label: "Pending", marker: null, markerClass: "border-slate-300 bg-white text-slate-400", cardClass: "border-slate-200 bg-slate-50" },
      current: { label: "Current", marker: null, markerClass: "border-blue-500 bg-blue-100 text-blue-700", cardClass: "border-blue-200 bg-blue-50" },
      completed: { label: "Completed", marker: "✓", markerClass: "border-emerald-500 bg-emerald-100 text-emerald-700", cardClass: "border-emerald-200 bg-emerald-50" },
      failed: { label: "Failed", marker: "!", markerClass: "border-red-500 bg-red-100 text-red-700", cardClass: "border-red-200 bg-red-50" },
      cancelled: { label: "Cancelled", marker: "×", markerClass: "border-amber-500 bg-amber-100 text-amber-800", cardClass: "border-amber-200 bg-amber-50" }
    }
  );
});
