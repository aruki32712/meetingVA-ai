export type AnalysisJobSummary = {
  id: string;
  status: string;
  error_message: string | null;
};

export type AnalysisJobResponse = {
  meeting_id: string;
  job_id: string;
  processing_status: string;
};

const activeAnalysisStatuses = new Set(["queued", "analyzing", "processing"]);
const completedAnalysisStatuses = new Set(["analyzed", "completed"]);

export function isAnalysisJobActive(status: string | null | undefined) {
  return Boolean(status && activeAnalysisStatuses.has(status));
}

export function analysisJobBlocksRequest(status: string | null | undefined) {
  return Boolean(
    status &&
      (activeAnalysisStatuses.has(status) || completedAnalysisStatuses.has(status))
  );
}

export function shouldAutomaticallyStartAnalysis(
  transcriptionStatus: string | null | undefined,
  analysisStatus: string | null | undefined
) {
  return (
    transcriptionStatus === "transcribed" &&
    !analysisStatus
  );
}

export function shouldShowAnalyzing(
  analysisStatus: string | null | undefined,
  requestAccepted: boolean
) {
  return requestAccepted || isAnalysisJobActive(analysisStatus);
}

export async function requestAnalysisJob({
  apiBaseUrl,
  meetingId,
  accessToken,
  fetcher = fetch,
  isDevelopment = process.env.NODE_ENV === "development"
}: {
  apiBaseUrl: string;
  meetingId: string;
  accessToken: string;
  fetcher?: typeof fetch;
  isDevelopment?: boolean;
}): Promise<AnalysisJobResponse> {
  if (isDevelopment) {
    console.info("Analyze request start", { meetingId });
  }

  const response = await fetcher(
    `${apiBaseUrl}/v1/meetings/${meetingId}/analyze`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (isDevelopment) {
    console.info("Analyze response", { meetingId, status: response.status });
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? payload.detail
        : null;
    throw new Error(
      typeof detail === "string" ? detail : "Unable to generate analysis."
    );
  }

  const payload = (await response.json()) as AnalysisJobResponse;

  if (isDevelopment) {
    console.info("Analyze request accepted", {
      meetingId,
      job_id: payload.job_id
    });
  }

  return payload;
}
