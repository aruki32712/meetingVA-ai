import assert from "node:assert/strict";
import test from "node:test";

import {
  completeMeetingDeletion,
  isMeetingDeletionConfirmed,
  MEETING_DELETED_NOTICE
} from "../components/meeting-deletion-state.ts";

test("meeting deletion requires the exact second confirmation", () => {
  assert.equal(isMeetingDeletionConfirmed(""), false);
  assert.equal(isMeetingDeletionConfirmed("delete"), false);
  assert.equal(isMeetingDeletionConfirmed("DELETE meeting"), false);
  assert.equal(isMeetingDeletionConfirmed(" DELETE "), true);
});

test("successful meeting deletion clears state, stores notice, and redirects", () => {
  const events: string[] = [];

  completeMeetingDeletion({
    clearLocalState: () => events.push("cleared"),
    storeNotice: (message) => events.push(`notice:${message}`),
    navigate: (path) => events.push(`navigate:${path}`)
  });

  assert.deepEqual(events, [
    "cleared",
    `notice:${MEETING_DELETED_NOTICE}`,
    "navigate:/dashboard"
  ]);
});
