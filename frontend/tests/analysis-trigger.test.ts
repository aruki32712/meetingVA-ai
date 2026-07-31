import assert from "node:assert/strict";
import test from "node:test";

import {
  analysisJobBlocksRequest,
  requestAnalysisJob,
  shouldAutomaticallyStartAnalysis,
  shouldShowAnalyzing
} from "../components/analysis-job-state.ts";

test("a transcribed meeting automatically qualifies to start analysis", () => {
  assert.equal(shouldAutomaticallyStartAnalysis("transcribed", null), true);
  assert.equal(shouldAutomaticallyStartAnalysis("transcribing", null), false);
});

test("active or completed analysis jobs prevent duplicate requests", () => {
  for (const status of ["queued", "analyzing", "analyzed", "completed"]) {
    assert.equal(analysisJobBlocksRequest(status), true);
    assert.equal(
      shouldAutomaticallyStartAnalysis("transcribed", status),
      false
    );
  }

  assert.equal(analysisJobBlocksRequest("failed"), false);
  assert.equal(
    shouldAutomaticallyStartAnalysis("transcribed", "failed"),
    false
  );
});

test("a failed analyze request exposes the backend safe error", async () => {
  await assert.rejects(
    requestAnalysisJob({
      apiBaseUrl: "https://api.example.test",
      meetingId: "meeting-id",
      accessToken: "session-token",
      isDevelopment: false,
      fetcher: async () =>
        new Response(JSON.stringify({ detail: "Analysis is unavailable." }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        })
    }),
    /Analysis is unavailable\./
  );
});

test("the UI does not show analyzing without a job or accepted request", () => {
  assert.equal(shouldShowAnalyzing(null, false), false);
  assert.equal(shouldShowAnalyzing("failed", false), false);
  assert.equal(shouldShowAnalyzing("queued", false), true);
  assert.equal(shouldShowAnalyzing(null, true), true);
});
