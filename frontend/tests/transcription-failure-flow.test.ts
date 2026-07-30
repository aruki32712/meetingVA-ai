import assert from "node:assert/strict";
import test from "node:test";

import {
  getTranscriptionUiState,
  unknownTranscriptionError
} from "../components/transcription-job-state.ts";

test("queued to processing to failed displays the sanitized transcription error", () => {
  const safeError =
    "Transcription is temporarily unavailable because the AI service quota has been reached. Please try again later or contact the administrator.";

  const queued = getTranscriptionUiState("queued", null, false);
  assert.equal(queued.showSpinner, true);
  assert.equal(queued.actionLabel, "Processing…");
  assert.equal(queued.errorMessage, "");

  const processing = getTranscriptionUiState("transcribing", null, false);
  assert.equal(processing.showSpinner, true);
  assert.equal(processing.actionLabel, "Processing…");

  const failed = getTranscriptionUiState("failed", safeError, false);
  assert.equal(failed.showSpinner, false);
  assert.equal(failed.errorMessage, safeError);
  assert.equal(failed.actionLabel, "Retry transcription");
});

test("raw provider errors are replaced before rendering", () => {
  const failed = getTranscriptionUiState(
    "failed",
    "OpenAI HTTP 429 raw response body and internal URL",
    false
  );

  assert.equal(failed.showSpinner, false);
  assert.equal(failed.errorMessage, unknownTranscriptionError);
  assert.equal(failed.actionLabel, "Retry transcription");
});
