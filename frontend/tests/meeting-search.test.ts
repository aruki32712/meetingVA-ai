import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  meetingSearchResultHref,
  normalizeMeetingSearchTerm,
  validateMeetingSearchTerm,
  type MeetingSearchRpcResult
} from "../components/meeting-search-state.ts";

const migration = readFileSync(
  new URL(
    "../../scripts/supabase/migrations/0022_expand_meeting_search.sql",
    import.meta.url
  ),
  "utf8"
);

test("meeting search normalizes whitespace and enforces two characters", () => {
  assert.equal(normalizeMeetingSearchTerm("  roadmap  "), "roadmap");
  assert.equal(validateMeetingSearchTerm("x"), "Enter at least 2 characters to search meeting content.");
  assert.equal(validateMeetingSearchTerm("xy"), "");
});

test("search results deep-link to the matched meeting section", () => {
  const result = {
    meeting_id: "meeting-1",
    match_anchor: "#transcript-segment-segment-1"
  } as MeetingSearchRpcResult;

  assert.equal(
    meetingSearchResultHref(result),
    "/dashboard/meetings/meeting-1#transcript-segment-segment-1"
  );
});

test("RPC covers every required meeting search source", () => {
  for (const field of [
    "meeting.title",
    "meeting.description",
    "meeting.summary",
    "meeting.brief",
    "segment.text",
    "segment.original_text",
    "segment.translated_text",
    "segment.speaker_label",
    "participant.display_name",
    "participant.speaker_label",
    "participant.email",
    "item.title",
    "item.description",
    "assignee.display_name",
    "item.status::text",
    "decision.title",
    "decision.description",
    "question.question",
    "question.answer",
    "question.status::text",
    "tag.name"
  ]) {
    assert.ok(migration.includes(field), `missing search field: ${field}`);
  }
});

test("RPC prevents cross-user leakage and collapses duplicate child matches", () => {
  assert.ok(migration.includes("meeting.owner_id = current_owner_id"));
  assert.ok(migration.includes("partition by matches.meeting_id"));
  assert.ok(migration.includes("where best.meeting_match_rank = 1"));
});

test("RPC safely escapes wildcard characters", () => {
  assert.ok(migration.includes("input.escaped_query"));
  assert.ok(migration.includes("escape E'\\\\'"));
});
