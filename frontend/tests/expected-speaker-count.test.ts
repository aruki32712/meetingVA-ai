import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  countDetectedSpeakers,
  parseExpectedSpeakerCount
} from "../components/meeting-utils.ts";

test("expected speaker count accepts auto and values from 1 through 20", () => {
  assert.equal(parseExpectedSpeakerCount("auto"), null);
  assert.equal(parseExpectedSpeakerCount("2"), 2);
  assert.equal(parseExpectedSpeakerCount("10"), 10);
  assert.equal(parseExpectedSpeakerCount("20"), 20);
});

test("expected speaker count rejects invalid values", () => {
  for (const value of ["0", "21", "2.5", "not-a-number"]) {
    assert.throws(() => parseExpectedSpeakerCount(value), /between 1 and 20/);
  }
});

test("expected speaker count migration enforces the same database range", () => {
  const sql = readFileSync(
    "../scripts/supabase/migrations/0026_expected_speaker_count.sql",
    "utf8"
  );
  assert.match(sql, /add column if not exists expected_speaker_count smallint/i);
  assert.match(sql, /expected_speaker_count between 1 and 20/i);
  assert.match(sql, /not sent to Deepgram/i);
});

test("Unknown Speaker is excluded from the detected speaker count", () => {
  assert.equal(
    countDetectedSpeakers(["deepgram:0", "Unknown Speaker", "deepgram:1"]),
    2
  );
});
