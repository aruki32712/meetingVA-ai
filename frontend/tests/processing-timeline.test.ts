import assert from "node:assert/strict";
import test from "node:test";

import { sortTimelineEventsChronologically } from "../components/processing-timeline-state.ts";

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
