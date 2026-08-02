import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProgressTrackerSeed,
  CURRENT_ROADMAP_LABELS
} from "../components/progress-tracker-seed.ts";

test("completed progress seed matches the production workflow", () => {
  const phases = buildProgressTrackerSeed(
    null,
    new Date("2026-08-01T14:00:00.000Z")
  );

  assert.deepEqual(
    phases.map((phase) => phase.title),
    [...CURRENT_ROADMAP_LABELS]
  );
  assert.equal(new Set(phases.map((phase) => phase.title)).size, phases.length);
  assert.ok(phases.every((phase) => phase.status === "complete"));
  assert.ok(
    phases.every((phase) =>
      phase.checklistItems.every((item) => item.isComplete)
    )
  );

  const timestamps = phases.map((phase) => Date.parse(phase.createdAt));
  assert.ok(
    timestamps.every(
      (timestamp, index) => index === 0 || timestamp > timestamps[index - 1]
    )
  );
});

test("in-progress seed has one current stage with completed and pending neighbors", () => {
  const phases = buildProgressTrackerSeed(
    "Transcription Pipeline",
    new Date("2026-08-01T14:00:00.000Z")
  );
  const currentIndex = phases.findIndex(
    (phase) => phase.status === "in_progress"
  );

  assert.equal(currentIndex, 2);
  assert.equal(
    phases.filter((phase) => phase.status === "in_progress").length,
    1
  );
  assert.ok(
    phases.slice(0, currentIndex).every((phase) => phase.status === "complete")
  );
  assert.ok(
    phases
      .slice(currentIndex + 1)
      .every((phase) => phase.status === "not_started")
  );
});

test("roadmap seed contains the current MeetingVA production capabilities", () => {
  const checklistLabels = buildProgressTrackerSeed().flatMap((phase) =>
    phase.checklistItems.map((item) => item.label)
  );

  assert.deepEqual(checklistLabels, [
    "Authentication",
    "Meeting creation",
    "Audio upload",
    "Delete meeting",
    "Automatic transcription",
    "Processing timeline",
    "OpenAI transcription",
    "Analysis",
    "Executive summary",
    "Meeting brief",
    "Action items",
    "Decisions",
    "Questions",
    "Speaker handling",
    "Diarization",
    "UI polish"
  ]);
});
