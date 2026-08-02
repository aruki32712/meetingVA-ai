import assert from "node:assert/strict";
import test from "node:test";

import {
  getCompletionPercentage,
  getProgressTrackerView,
  resolveProgressLoad
} from "../components/progress-tracker-state.ts";

test("successful progress load returns roadmap data", async () => {
  const result = await resolveProgressLoad(async () => [{ id: "phase-1" }]);

  assert.equal(result.status, "success");
  assert.deepEqual(result.status === "success" ? result.data : [], [
    { id: "phase-1" }
  ]);
});

test("failed progress load preserves the Supabase error message", async () => {
  const result = await resolveProgressLoad(async () => {
    throw { message: "relation project_progress_phases does not exist" };
  });

  assert.equal(result.status, "error");
  assert.equal(
    result.status === "error" ? result.message : "",
    "relation project_progress_phases does not exist"
  );
  assert.equal(getProgressTrackerView(false, "load failed", 0), "error");
});

test("retry can recover after an initial load failure", async () => {
  let attempts = 0;
  const load = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("temporary failure");
    }
    return [{ id: "phase-1" }];
  };

  assert.equal((await resolveProgressLoad(load)).status, "error");
  assert.equal((await resolveProgressLoad(load)).status, "success");
  assert.equal(attempts, 2);
});

test("an error never presents a false zero-percent ready state", () => {
  assert.equal(getProgressTrackerView(false, "load failed", 0), "error");
  assert.notEqual(getProgressTrackerView(false, "load failed", 0), "ready");
});

test("completion percentage is calculated from checklist items", () => {
  assert.equal(
    getCompletionPercentage([
      {
        checklistItems: [
          { is_complete: true },
          { is_complete: true },
          { is_complete: false }
        ]
      }
    ]),
    67
  );
});

test("an empty roadmap has a dedicated empty state", () => {
  assert.equal(getProgressTrackerView(false, "", 0), "empty");
});
