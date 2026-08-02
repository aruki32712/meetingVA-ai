import assert from "node:assert/strict";
import test from "node:test";

import {
  completeMeetingDeletion,
  isMeetingDeletionConfirmed,
  MEETING_DELETED_NOTICE,
  removeDeletedMeetingFromList,
  requestMeetingDeletion,
  tryBeginMeetingDeletion
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
    closeModal: () => events.push("modal:closed"),
    clearLoading: () => events.push("loading:cleared"),
    clearLocalState: () => events.push("cleared"),
    removeFromMeetingLists: () => events.push("cache:removed"),
    storeNotice: (message) => events.push(`notice:${message}`),
    navigate: (path) => events.push(`replace:${path}`)
  });

  assert.deepEqual(events, [
    "modal:closed",
    "loading:cleared",
    "cleared",
    "cache:removed",
    `notice:${MEETING_DELETED_NOTICE}`,
    "replace:/dashboard"
  ]);
});

test("successful 200 deletion redirects without parsing the response body", async () => {
  let textCalls = 0;
  const result = await requestMeetingDeletion(async () => ({
    ok: true,
    status: 200,
    text: async () => {
      textCalls += 1;
      return JSON.stringify({ deleted: true, meeting_id: "meeting-1" });
    }
  }));

  assert.deepEqual(result, { status: "success", httpStatus: 200 });
  assert.equal(textCalls, 0);
});

test("successful 204 deletion redirects without parsing an empty body", async () => {
  let textCalls = 0;
  const result = await requestMeetingDeletion(async () => ({
    ok: true,
    status: 204,
    text: async () => {
      textCalls += 1;
      return "";
    }
  }));

  assert.deepEqual(result, { status: "success", httpStatus: 204 });
  assert.equal(textCalls, 0);
});

test("delete request guard prevents a double-click", () => {
  const guard = { current: false };

  assert.equal(tryBeginMeetingDeletion(guard), true);
  assert.equal(tryBeginMeetingDeletion(guard), false);
});

test("deleted meeting is removed from cached meeting lists", () => {
  assert.deepEqual(
    removeDeletedMeetingFromList(
      [{ id: "meeting-1" }, { id: "meeting-2" }],
      "meeting-1"
    ),
    [{ id: "meeting-2" }]
  );
});

test("real backend failure preserves the safe HTTP error", async () => {
  const result = await requestMeetingDeletion(async () => ({
    ok: false,
    status: 409,
    text: async () => JSON.stringify({ detail: "Active processing must finish first." })
  }));

  assert.deepEqual(result, {
    status: "http-error",
    httpStatus: 409,
    message: "Active processing must finish first."
  });
});

test("actual fetch rejection is distinguished as a network failure", async () => {
  const failure = new TypeError("Failed to fetch");
  const result = await requestMeetingDeletion(async () => {
    throw failure;
  });

  assert.equal(result.status, "network-error");
  assert.equal(result.status === "network-error" ? result.error : null, failure);
});
