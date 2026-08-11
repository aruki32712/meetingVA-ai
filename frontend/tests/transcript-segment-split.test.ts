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
  assert.match(handler, /setSegmentSplitMessage\("Segment split saved"\)/);
  assert.ok(
    handler.indexOf("if (!response.ok)") <
      handler.indexOf('setSegmentSplitMessage("Segment split saved")')
  );
});

test("successful save closes before any secondary refetch and clears stale editor state", () => {
  const source = readFileSync(
    new URL("../components/meeting-detail.tsx", import.meta.url),
    "utf8"
  );
  const handler = source.slice(
    source.indexOf("async function saveSegmentSplit"),
    source.indexOf("if (isLoading)")
  );
  const refreshIndex = handler.indexOf("await refreshMeetingData()");
  const closeIndex = handler.indexOf('setSegmentSplitId("")');

  assert.ok(closeIndex > 0 && closeIndex < refreshIndex);
  assert.match(handler, /setSegmentSplitOffset\(null\)/);
  assert.match(handler, /setSegmentSplitAssignments\(\[\]\)/);
  assert.match(handler, /refreshed\.transcriptSegments\.some/);
  assert.match(handler, /scrollIntoView/);
  assert.match(handler, /firstCreatedSegment\?\.focus/);
  assert.match(handler, /Segment split saved, but the transcript could not refresh/);
});

test("saving state disables both actions and shows Saving text", () => {
  const source = readFileSync(
    new URL("../components/meeting-detail.tsx", import.meta.url),
    "utf8"
  );
  const modal = source.slice(
    source.indexOf("{segmentBeingSplit ?"),
    source.indexOf('<section\n        className="rounded-lg', source.indexOf("{segmentBeingSplit ?"))
  );

  assert.equal((modal.match(/disabled=\{isSplittingSegment\}/g) ?? []).length >= 1, true);
  assert.match(modal, /isSplittingSegment \|\|/);
  assert.match(modal, /isSplittingSegment \? "Saving…" : "Save Split"/);
});

test("failure keeps editor selections and does not show success", () => {
  const source = readFileSync(
    new URL("../components/meeting-detail.tsx", import.meta.url),
    "utf8"
  );
  const handler = source.slice(
    source.indexOf("async function saveSegmentSplit"),
    source.indexOf("if (isLoading)")
  );
  const catchBlock = handler.slice(handler.indexOf("} catch (splitError)"));

  assert.doesNotMatch(catchBlock, /setSegmentSplitId\(""\)/);
  assert.doesNotMatch(catchBlock, /setSegmentSplitAssignments\(\[\]\)/);
  assert.doesNotMatch(catchBlock, /Segment split saved/);
  assert.match(catchBlock, /setIsSplittingSegment\(false\)/);
});

test("split completion refetches every direct meeting-detail data dependency", () => {
  const source = readFileSync(
    new URL("../components/meeting-detail.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /const refreshed = await refreshMeetingData\(\)/);
  assert.match(source, /\.from\("meetings"\)/);
  assert.match(source, /\.from\("transcript_segments"\)/);
  assert.match(source, /\.from\("participants"\)/);
  assert.match(source, /transcriptSpeakerStats\(transcriptSegments\)/);
  assert.doesNotMatch(source, /useQuery|useSWR|queryClient/);
});

test("production split requests never fall back to browser localhost", () => {
  const source = readFileSync(
    new URL("../components/meeting-detail.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /process\.env\.NODE_ENV === "production"/);
  assert.match(source, /https:\/\/meetingva-backend-r2mw\.onrender\.com/);
  assert.match(source, /\[split\] response status/);
  assert.match(source, /\[split\] response ok/);
  assert.match(source, /\[split\] success branch entered/);
  assert.match(source, /\[split\] closing editor/);
});

test("successful manual transcript edits queue analysis without retranscribing", () => {
  const source = readFileSync(
    new URL("../components/meeting-detail.tsx", import.meta.url),
    "utf8"
  );
  const splitHandler = source.slice(
    source.indexOf("async function saveSegmentSplit"),
    source.indexOf("if (isLoading)")
  );

  assert.match(splitHandler, /transcriptReadyForAnalysis/);
  assert.match(splitHandler, /generateAnalysis\(true\)/);
  assert.doesNotMatch(splitHandler, /\/transcribe/);
  assert.match(source, /Updating analysis\.\.\./);
  assert.match(source, /Transcript saved, but analysis could not be refreshed/);
  assert.match(source, /transcript_updated: "Transcript Updated"/);
  assert.match(source, /"Analysis Queued"/);
});

test("every transcript row exposes Change Speaker and Split Segment", () => {
  const source = readFileSync(
    new URL("../components/meeting-detail.tsx", import.meta.url),
    "utf8"
  );
  const transcriptRow = source.slice(
    source.indexOf("{transcriptSegments.map((segment)"),
    source.indexOf("</article>", source.indexOf("{transcriptSegments.map((segment)"))
  );

  assert.match(transcriptRow, /Change Speaker/);
  assert.match(transcriptRow, /Split Segment/);
  assert.doesNotMatch(transcriptRow, /participants\.length > 1/);
});

test("whole-segment reassignment supports existing, unknown, and new speakers", () => {
  const source = readFileSync(
    new URL("../components/meeting-detail.tsx", import.meta.url),
    "utf8"
  );
  const handler = source.slice(
    source.indexOf("async function assignSegment"),
    source.indexOf("function openSpeakerSplit")
  );

  assert.match(source, /Unknown Speaker<\/option>/);
  assert.match(source, /Create a new speaker…<\/option>/);
  assert.match(source, /Add speaker/);
  assert.match(handler, /target_participant_id: assignment\.participantId \|\| null/);
  assert.match(handler, /display_name: assignment\.displayName\?\.trim\(\) \|\| null/);
  assert.match(handler, /setTranscriptSegments/);
  assert.match(handler, /setParticipants/);
  assert.ok(handler.indexOf("setTranscriptSegments") < handler.indexOf("await refreshMeetingData()"));
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
  assert.match(source, /Split Segment/);
  assert.match(source, /Choose a split boundary/);
  assert.match(source, /Speaker for part/);
  assert.match(source, /Save Split/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /Analysis may be outdated because the transcript was edited/);
  assert.match(source, /analysis_stale: returnedPayload\.analysis_stale/);
  assert.match(source, /transcript-segment-\$\{firstCreatedSegmentId\}/);
});
