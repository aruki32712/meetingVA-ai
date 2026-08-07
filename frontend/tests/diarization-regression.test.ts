import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { calculateSpeakerStatistics } from "../components/speaker-split-state.ts";

type FixtureTurn = {
  id: string;
  participant_id: string;
  speaker_label: string;
  start_ms: number;
  end_ms: number;
  segment_index: number;
  text: string;
};

const fixture = JSON.parse(
  readFileSync(
    new URL("../../shared/test-fixtures/four-speaker-transcript.json", import.meta.url),
    "utf8"
  )
) as {
  participants: Array<{ id: string; display_name: string; speaker_label: string }>;
  expected_turns: FixtureTurn[];
};

test("four detected speakers and Unknown remain distinct in the realistic fixture", () => {
  const detected = new Set(
    fixture.expected_turns
      .map((turn) => turn.speaker_label)
      .filter((label) => label !== "Unknown Speaker")
  );

  assert.deepEqual(detected, new Set(["deepgram:0", "deepgram:1", "deepgram:2", "deepgram:3"]));
  assert.equal(
    fixture.expected_turns.some((turn) => turn.speaker_label === "Unknown Speaker"),
    true
  );
});

test("speaker duration and percentages recalculate after Unknown reassignment", () => {
  const participantIds = [...fixture.participants.map((participant) => participant.id), "new-speaker"];
  const before = calculateSpeakerStatistics(fixture.expected_turns, participantIds);
  const reassigned = fixture.expected_turns.map((turn) =>
    turn.participant_id === "unknown"
      ? { ...turn, participant_id: "new-speaker", speaker_label: "Jordan" }
      : turn
  );
  const after = calculateSpeakerStatistics(reassigned, participantIds);

  assert.deepEqual(before.unknown, {
    segmentCount: 1,
    speakingMs: 2100,
    percentage: 11
  });
  assert.deepEqual(after.unknown, {
    segmentCount: 0,
    speakingMs: 0,
    percentage: 0
  });
  assert.deepEqual(after["new-speaker"], {
    segmentCount: 1,
    speakingMs: 2100,
    percentage: 11
  });
  assert.equal(
    Object.values(after).reduce((total, stats) => total + stats.speakingMs, 0),
    Object.values(before).reduce((total, stats) => total + stats.speakingMs, 0)
  );
});

test("speaker reassignment preserves every transcript turn exactly once", () => {
  const beforeText = fixture.expected_turns.map((turn) => turn.text);
  const edited = fixture.expected_turns.map((turn) =>
    turn.participant_id === "unknown"
      ? { ...turn, participant_id: "new-speaker", speaker_label: "Jordan" }
      : turn
  );

  assert.deepEqual(edited.map((turn) => turn.text), beforeText);
  assert.equal(new Set(edited.map((turn) => turn.id)).size, edited.length);
});

test("Split Segment remains available as a manual correction escape hatch", () => {
  const source = readFileSync(
    new URL("../components/meeting-detail.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, />\s*Split Segment\s*</);
  assert.match(source, /openSegmentSplit\(segment\)/);
});
