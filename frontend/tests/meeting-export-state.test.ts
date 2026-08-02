import assert from "node:assert/strict";
import test from "node:test";
import { canSubmitExport, DEFAULT_EXPORT_SELECTIONS, requestMeetingExport, setAllAvailableSections, tryBeginExport } from "../components/meeting-export-state.ts";

test("default export sections match the product contract", () => {
  assert.equal(DEFAULT_EXPORT_SELECTIONS.meeting_details, true); assert.equal(DEFAULT_EXPORT_SELECTIONS.executive_summary, true); assert.equal(DEFAULT_EXPORT_SELECTIONS.transcript, true); assert.equal(DEFAULT_EXPORT_SELECTIONS.processing_timeline, false);
});
test("Select All respects unavailable sections and Clear All clears content", () => {
  const all = setAllAvailableSections({ transcript: false, speakers: false }, true); assert.equal(all.transcript, false); assert.equal(all.speakers, false); assert.equal(all.meeting_details, true);
  assert.equal(Object.values(setAllAvailableSections({}, false)).some(Boolean), false);
});
test("export validation requires content, format, and no active request", () => {
  assert.equal(canSubmitExport("pdf", DEFAULT_EXPORT_SELECTIONS, false), true); assert.equal(canSubmitExport("", DEFAULT_EXPORT_SELECTIONS, false), false); assert.equal(canSubmitExport("pdf", setAllAvailableSections({}, false), false), false); assert.equal(canSubmitExport("pdf", DEFAULT_EXPORT_SELECTIONS, true), false);
});

test("successful export returns the download blob and safe response filename", async () => {
  const result = await requestMeetingExport({ url: "/export", token: "token", body: {}, fetcher: async () => new Response("file", { status: 200, headers: { "Content-Disposition": 'attachment; filename="meeting.pdf"' } }) });
  assert.equal(result.filename, "meeting.pdf"); assert.equal(await result.blob.text(), "file");
});

test("failed export exposes the backend safe error", async () => {
  await assert.rejects(() => requestMeetingExport({ url: "/export", token: "token", body: {}, fetcher: async () => new Response(JSON.stringify({ detail: "Export unavailable." }), { status: 500, headers: { "Content-Type": "application/json" } }) }), /Export unavailable/);
});

test("duplicate export submission is prevented", () => {
  const guard = { current: false }; assert.equal(tryBeginExport(guard), true); assert.equal(tryBeginExport(guard), false);
});
