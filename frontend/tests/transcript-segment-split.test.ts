import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildTranscriptSplitParts,
  replaceTranscriptSegment,
  splitCanBeSaved,
  transcriptSpeakerStats,
  transcriptWordBoundaries
} from "../components/transcript-segment-split-state.ts";

const original = "I think that is a good idea. Yes, I can handle that.";

test("word boundary selection builds the expected two-part preview", () => {
  const boundary = transcriptWordBoundaries(original).find(
    (item) => item.beforeWord === "Yes,"
  );
  assert.ok(boundary);
  assert.deepEqual(buildTranscriptSplitParts(original, [boundary.offset]), [
    "I think that is a good idea.",
    "Yes, I can handle that."
  ]);
});

test("multiple word boundaries build three non-empty parts", () => {
  const boundaries = transcriptWordBoundaries(original);
  const first = boundaries.find((item) => item.beforeWord === "that");
  const second = boundaries.find((item) => item.beforeWord === "Yes,");
  assert.ok(first && second);
  assert.deepEqual(
    buildTranscriptSplitParts(original, [first.offset, second.offset]),
    ["I think", "that is a good idea.", "Yes, I can handle that."]
  );
});

test("save validation requires a split and speaker for every part", () => {
  const parts = ["First part", "Second part"];
  assert.equal(splitCanBeSaved(parts, []), false);
  assert.equal(
    splitCanBeSaved(parts, [
      { participantId: "speaker-1", displayName: "" },
      { participantId: "", displayName: "" }
    ]),
    false
  );
  assert.equal(
    splitCanBeSaved(parts, [
      { participantId: "speaker-1", displayName: "" },
      { participantId: "", displayName: "Speaker 2" }
    ]),
    true
  );
});

test("failed requests preserve the original segment because updates occur after success", () => {
  const source = readFileSync(
    new URL("../components/meeting-detail.tsx", import.meta.url),
    "utf8"
  );
  const handler = source.slice(
    source.indexOf("async function saveSegmentSplit"),
    source.indexOf("if (isLoading)")
  );
  assert.ok(handler.indexOf("if (!response.ok)") < handler.indexOf("await refreshMeetingData()"));
  assert.doesNotMatch(handler.slice(0, handler.indexOf("if (!response.ok)")), /setTranscriptSegments/);
  assert.match(handler, /setSegmentSplitMessage\("Segment split saved\."\)/);
  assert.ok(
    handler.indexOf("if (!response.ok)") <
      handler.indexOf('setSegmentSplitMessage("Segment split saved.")')
  );
});

test("successful split immediately replaces the original in segment order", () => {
  const originalSegment = {
    id: "original",
    participant_id: "speaker-1",
    segment_index: 4,
    start_ms: 12000,
    end_ms: 22000
  };
  const before = [
    { ...originalSegment, id: "before", segment_index: 3, start_ms: 8000, end_ms: 12000 },
    originalSegment,
    { ...originalSegment, id: "after", segment_index: 6, start_ms: 22000, end_ms: 26000 }
  ];
  const replacements = [
    { ...originalSegment, id: "part-2", participant_id: "speaker-2", segment_index: 5, start_ms: 17500, end_ms: 22000 },
    { ...originalSegment, id: "part-1", segment_index: 4, start_ms: 12000, end_ms: 17500 }
  ];
  const after = replaceTranscriptSegment(before, "original", replacements);

  assert.deepEqual(after.map((segment) => segment.id), ["before", "part-1", "part-2", "after"]);
  assert.equal(after.length, before.length + 1);
  assert.equal(after.some((segment) => segment.id === "original"), false);
});

test("speaker statistics recalculate from the replaced transcript", () => {
  const stats = transcriptSpeakerStats([
    { id: "part-1", participant_id: "speaker-1", segment_index: 4, start_ms: 12000, end_ms: 17500 },
    { id: "part-2", participant_id: "speaker-2", segment_index: 5, start_ms: 17500, end_ms: 22000 },
    { id: "later", participant_id: "speaker-2", segment_index: 6, start_ms: 23000, end_ms: 25000 }
  ]);

  assert.deepEqual(stats["speaker-1"], { segmentCount: 1, speakingMs: 5500 });
  assert.deepEqual(stats["speaker-2"], { segmentCount: 2, speakingMs: 6500 });
});

test("split editor exposes preview, speaker controls, and keyboard navigation", () => {
  const source = readFileSync(
    new URL("../components/meeting-detail.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /Split segment/);
  assert.match(source, /Choose a split boundary/);
  assert.match(source, /Speaker for part/);
  assert.match(source, /Save Split/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /Analysis may be outdated because the transcript was edited/);
  assert.match(source, /analysis_stale: payload\.analysis_stale/);
  assert.match(source, /transcript-segment-\$\{firstCreatedSegmentId\}/);
});
