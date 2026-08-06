import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildTranscriptSplitParts,
  splitCanBeSaved,
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
});
