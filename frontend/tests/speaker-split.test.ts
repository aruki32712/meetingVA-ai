import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calculateSpeakerStatistics,
  nextAvailableSpeakerName,
  selectedSpeakerTurns
} from "../components/speaker-split-state.ts";

test("next speaker label uses the next available number", () => {
  assert.equal(
    nextAvailableSpeakerName([
      { display_name: "Speaker 1" },
      { display_name: "Jordan" },
      { display_name: "Speaker 3" }
    ]),
    "Speaker 2"
  );
});

test("split selection preserves transcript order and unselected turns", () => {
  const segments = [
    { id: "third", participant_id: "source", start_ms: 2000, end_ms: 3000, segment_index: 2, translated_text: "tres" },
    { id: "first", participant_id: "source", start_ms: 0, end_ms: 1000, segment_index: 0, translated_text: "uno" },
    { id: "second", participant_id: "source", start_ms: 1000, end_ms: 2000, segment_index: 1, translated_text: "dos" }
  ];
  assert.deepEqual(
    selectedSpeakerTurns(segments, "source").map((segment) => segment.id),
    ["first", "second", "third"]
  );

  const selected = new Set(["second"]);
  const reassigned = segments.map((segment) =>
    selected.has(segment.id)
      ? { ...segment, participant_id: "new-speaker" }
      : segment
  );
  assert.deepEqual(
    reassigned.filter((segment) => segment.participant_id === "source").map((segment) => segment.id).sort(),
    ["first", "third"]
  );
  assert.equal(reassigned[1].translated_text, "uno");
  assert.deepEqual(
    [...reassigned].sort((left, right) => left.segment_index - right.segment_index).map((segment) => segment.id),
    ["first", "second", "third"]
  );
});

test("speaker statistics recalculate after selected turns move", () => {
  const statistics = calculateSpeakerStatistics(
    [
      { id: "one", participant_id: "source", start_ms: 0, end_ms: 3000, segment_index: 0 },
      { id: "two", participant_id: "new", start_ms: 3000, end_ms: 4000, segment_index: 1 }
    ],
    ["source", "new"]
  );
  assert.deepEqual(statistics.source, {
    segmentCount: 1,
    speakingMs: 3000,
    percentage: 75
  });
  assert.deepEqual(statistics.new, {
    segmentCount: 1,
    speakingMs: 1000,
    percentage: 25
  });
});

test("meeting detail exposes split action, guidance, selection, and undo", () => {
  const source = readFileSync(
    new URL("../components/meeting-detail.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /Split speaker/);
  assert.match(
    source,
    /Use Split speaker when multiple people were grouped under one detected speaker\./
  );
  assert.match(source, /segment_ids: \[\.\.\.splitSegmentIds\]/);
  assert.match(source, />\s*Undo\s*</);
});
