import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProgressTrackerSeed,
  CURRENT_WORKFLOW_LABELS
} from "../components/progress-tracker-seed.ts";

test("completed progress seed matches the production workflow", () => {
  const phases = buildProgressTrackerSeed(
    null,
    new Date("2026-08-01T14:00:00.000Z")
  );

  assert.deepEqual(
    phases.map((phase) => phase.title),
    [...CURRENT_WORKFLOW_LABELS]
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
    "Transcribing",
    new Date("2026-08-01T14:00:00.000Z")
  );
  const currentIndex = phases.findIndex(
    (phase) => phase.status === "in_progress"
  );

  assert.equal(currentIndex, 3);
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

test("analysis completion seed contains current Meeting Intelligence fields", () => {
  const analysis = buildProgressTrackerSeed().at(-1);

  assert.equal(analysis?.title, "Analysis Complete");
  assert.deepEqual(
    analysis?.checklistItems.map((item) => item.label),
    [
      "Executive Summary",
      "Meeting Brief",
      "Action Items",
      "Decisions",
      "Questions"
    ]
  );
});
