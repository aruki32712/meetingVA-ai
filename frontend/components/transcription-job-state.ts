export const unknownTranscriptionError =
  "We couldn’t generate the transcript. Please try again.";

const safeTranscriptionErrors = new Set([
  "Transcription is temporarily unavailable because the AI service quota has been reached. Please try again later or contact the administrator.",
  "The transcription service is busy. Please try again in a few minutes.",
  "This audio file could not be processed. Please upload a supported audio format and try again.",
  "No audio file was found for this meeting.",
  "Transcription is currently unavailable due to a service configuration issue.",
  unknownTranscriptionError
]);

export function getSafeTranscriptionError(
  message: string | null | undefined
) {
  return message && safeTranscriptionErrors.has(message)
    ? message
    : unknownTranscriptionError;
}

export function isActiveTranscriptionStatus(status: string | null | undefined) {
  return status === "queued" || status === "transcribing";
}

export function getTranscriptionUiState(
  status: string | null | undefined,
  errorMessage: string | null | undefined,
  hasTranscript: boolean
) {
  const isProcessing = isActiveTranscriptionStatus(status);
  const failed = status === "failed";

  return {
    isProcessing,
    showSpinner: isProcessing,
    errorMessage: failed ? getSafeTranscriptionError(errorMessage) : "",
    showAction: !hasTranscript,
    actionLabel: isProcessing
      ? "Processing…"
      : failed
        ? "Retry transcription"
        : "Generate transcript"
  };
}
