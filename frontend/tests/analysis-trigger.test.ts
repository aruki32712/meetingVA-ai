import assert from "node:assert/strict";
import test from "node:test";

import {
  analysisJobBlocksRequest,
  canStartAnalysis,
  requestAnalysisJob,
  shouldAutomaticallyStartAnalysis,
  shouldShowAnalyzing
} from "../components/analysis-job-state.ts";

test("a transcribed meeting creates an analysis job", async () => {
  assert.equal(shouldAutomaticallyStartAnalysis("transcribed", null), true);

  let requestUrl = "";
  let authorization = "";
  const job = await requestAnalysisJob({
    apiBaseUrl: "https://api.example.test",
    meetingId: "meeting-id",
    accessToken: "session-token",
    isDevelopment: false,
    fetcher: async (input, init) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json({
        meeting_id: "meeting-id",
        job_id: "analysis-job-id",
        processing_status: "queued"
      });
    }
  });

  assert.equal(requestUrl, "https://api.example.test/v1/meetings/meeting-id/analyze");
  assert.equal(authorization, "Bearer session-token");
  assert.equal(job.job_id, "analysis-job-id");
});

test("no false analyzing state is shown without an active analysis job", () => {
  assert.equal(shouldShowAnalyzing(null), false);
  assert.equal(shouldShowAnalyzing("failed"), false);
  assert.equal(shouldShowAnalyzing("analyzed"), false);
  assert.equal(shouldShowAnalyzing("queued"), true);
  assert.equal(shouldShowAnalyzing("analyzing"), true);
});

test("the manual Meeting Intelligence button is enabled when a transcript exists", () => {
  assert.equal(
    canStartAnalysis({
      transcriptSegmentCount: 3,
      ownsMeeting: true,
      analysisStatus: null,
      hasCompletedInsights: false,
      requestPending: false
    }),
    true
  );
});

test("duplicate analysis requests are prevented", () => {
  assert.equal(analysisJobBlocksRequest("queued"), true);
  assert.equal(analysisJobBlocksRequest("analyzing"), true);
  assert.equal(analysisJobBlocksRequest("analyzed", true), true);
  assert.equal(analysisJobBlocksRequest("analyzed", false), false);
  assert.equal(shouldAutomaticallyStartAnalysis("transcribed", "queued"), false);
});

test("a failed analysis restores the Retry Analysis action", () => {
  assert.equal(
    canStartAnalysis({
      transcriptSegmentCount: 1,
      ownsMeeting: true,
      analysisStatus: "failed",
      hasCompletedInsights: false,
      requestPending: false
    }),
    true
  );
  assert.equal(shouldShowAnalyzing("failed"), false);
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
