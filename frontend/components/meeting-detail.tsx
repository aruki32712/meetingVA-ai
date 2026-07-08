"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { formatDate, formatDuration } from "./meeting-utils";

type MeetingDetailRow = {
  id: string;
  title: string;
  description: string | null;
  meeting_date: string;
  audio_storage_path: string | null;
  duration_seconds: number | null;
  processing_status: string;
  summary: string | null;
  brief: string | null;
  detected_language: string | null;
  transcript_language: string | null;
  translation_language: string | null;
  translate_to_english: boolean;
  transcript_kind: "original" | "translated" | "both";
  tags: string[];
  created_at: string;
};

type ProcessingEvent = {
  id: string;
  event_order: number;
  job_type: "transcription" | "analysis" | null;
  event_type: string;
  status: "pending" | "current" | "completed" | "failed";
  message: string;
  error_message: string | null;
  created_at: string;
};

type TimelineStepStatus = "pending" | "current" | "completed" | "failed";

type TimelineStep = {
  key: string;
  label: string;
  description: string;
  status: TimelineStepStatus;
  timestamp: string | null;
  errorMessage: string | null;
  retryType?: "transcription" | "analysis";
};

type MeetingActivityEvent = {
  id: string;
  event_type: string;
  actor_type: "system" | "owner" | "worker";
  actor_label: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type TranscriptSegment = {
  id: string;
  participant_id: string | null;
  speaker_label: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  original_text: string | null;
  translated_text: string | null;
  transcript_kind: "original" | "translated" | "both";
  segment_index: number;
};

type Participant = {
  id: string;
  display_name: string;
  speaker_label: string | null;
  created_at: string;
};

type ActionItem = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
};

type Decision = {
  id: string;
  title: string;
  description: string | null;
};

type Question = {
  id: string;
  question: string;
  answer: string | null;
  status: string;
};

type JobEnqueueResponse = {
  meeting_id: string;
  job_id: string;
  processing_status: string;
};

type JobStatusResponse = {
  meeting_id: string;
  job_id: string;
  job_type: "transcription" | "analysis";
  job_state: string;
  job_status: string;
  ready: boolean;
  successful: boolean;
  failed: boolean;
  error_message: string | null;
  processing_status: string;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const jobPollIntervalMs = 5000;

function formatTranscriptTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatSpeakingTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function fallbackSpeakerName(index: number) {
  return `Speaker ${index + 1}`;
}

function formatLanguage(language: string | null) {
  if (!language) {
    return "Auto-detect";
  }

  return language
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function isActiveProcessingStatus(status: string) {
  return ["queued", "transcribing", "analyzing"].includes(status);
}

function isTerminalProcessingStatus(status: string) {
  return [
    "transcribed",
    "transcription_failed",
    "analyzed",
    "analysis_failed",
    "failed",
    "cancelled"
  ].includes(status);
}

function formatProcessingStatus(status: string) {
  if (status === "queued") {
    return "Queued";
  }

  if (status === "transcribing" || status === "analyzing") {
    return "Processing";
  }

  if (status === "transcribed" || status === "analyzed") {
    return "Completed";
  }

  if (status === "failed" || status.endsWith("_failed")) {
    return "Failed";
  }

  if (status === "cancelled") {
    return "Cancelled";
  }

  return status.replace("_", " ");
}

function formatTimelineTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function formatActivityTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function activityMetadataText(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }

  return null;
}

function isFailureActivity(event: MeetingActivityEvent) {
  return event.event_type.endsWith("_failed");
}

function isSpeakerCorrectionActivity(event: MeetingActivityEvent) {
  return [
    "speaker_uncertain",
    "speaker_renamed",
    "speakers_merged",
    "transcript_segment_reassigned"
  ].includes(event.event_type);
}

function buildProcessingTimeline(
  meeting: MeetingDetailRow,
  events: ProcessingEvent[]
): TimelineStep[] {
  const orderedEvents = [...events].sort((left, right) => {
    const timeDiff =
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime();

    if (timeDiff !== 0) {
      return timeDiff;
    }

    return left.event_order - right.event_order;
  });
  const latest = (
    predicate: (event: ProcessingEvent) => boolean,
    afterEvent?: ProcessingEvent
  ) =>
    [...orderedEvents]
      .reverse()
      .find((event) => {
        if (!predicate(event)) {
          return false;
        }

        if (!afterEvent) {
          return true;
        }

        const eventTime = new Date(event.created_at).getTime();
        const afterTime = new Date(afterEvent.created_at).getTime();

        return (
          eventTime > afterTime ||
          (eventTime === afterTime && event.event_order >= afterEvent.event_order)
        );
      });
  const queued = latest((event) => event.event_type === "queued");
  const transcriptionQueued = latest(
    (event) => event.event_type === "queued" && event.job_type === "transcription"
  );
  const analysisQueued = latest(
    (event) => event.event_type === "queued" && event.job_type === "analysis"
  );
  const transcriptionStarted = latest(
    (event) => event.event_type === "transcription_started",
    transcriptionQueued
  );
  const transcriptionResult = latest(
    (event) =>
      event.event_type === "transcription_completed" ||
      event.event_type === "transcription_failed",
    transcriptionQueued
  );
  const analysisStarted = latest(
    (event) => event.event_type === "analysis_started",
    analysisQueued
  );
  const analysisResult = latest(
    (event) =>
      event.event_type === "analysis_completed" ||
      event.event_type === "analysis_failed",
    analysisQueued
  );
  const uploaded = latest((event) => event.event_type === "audio_uploaded");
  const created = latest((event) => event.event_type === "meeting_created");

  const eventStatus = (
    event: ProcessingEvent | undefined,
    fallback: TimelineStepStatus = "pending"
  ): TimelineStepStatus => event?.status ?? fallback;
  const isLatestQueuedJobStartedOrSettled =
    queued?.job_type === "transcription"
      ? Boolean(transcriptionStarted || transcriptionResult)
      : queued?.job_type === "analysis"
        ? Boolean(analysisStarted || analysisResult)
        : Boolean(transcriptionStarted || analysisStarted);

  return [
    {
      key: "created",
      label: "Meeting Created",
      description: created?.message ?? "Meeting record created.",
      status: "completed",
      timestamp: created?.created_at ?? meeting.created_at,
      errorMessage: null
    },
    {
      key: "uploaded",
      label: "Audio Uploaded",
      description:
        uploaded?.message ?? "Audio will be securely stored for processing.",
      status: uploaded ? "completed" : "pending",
      timestamp: uploaded?.created_at ?? null,
      errorMessage: null
    },
    {
      key: "queued",
      label: "Queued",
      description: queued?.message ?? "Processing will begin after a job is queued.",
      status: queued
        ? isLatestQueuedJobStartedOrSettled
          ? "completed"
          : "current"
        : "pending",
      timestamp: queued?.created_at ?? null,
      errorMessage: null
    },
    {
      key: "transcribing",
      label: "Transcribing",
      description:
        transcriptionStarted?.message ?? "Audio will be converted into a transcript.",
      status: transcriptionResult
        ? "completed"
        : eventStatus(transcriptionStarted),
      timestamp: transcriptionStarted?.created_at ?? null,
      errorMessage: null
    },
    {
      key: "transcript-complete",
      label: "Transcript Complete",
      description:
        transcriptionResult?.message ?? "The transcript will be ready for review.",
      status: eventStatus(transcriptionResult),
      timestamp: transcriptionResult?.created_at ?? null,
      errorMessage: transcriptionResult?.error_message ?? null,
      retryType:
        transcriptionResult?.event_type === "transcription_failed"
          ? "transcription"
          : undefined
    },
    {
      key: "analyzing",
      label: "Analyzing",
      description:
        analysisStarted?.message ?? "The transcript will be analyzed for insights.",
      status: analysisResult ? "completed" : eventStatus(analysisStarted),
      timestamp: analysisStarted?.created_at ?? null,
      errorMessage: null
    },
    {
      key: "analysis-complete",
      label: "Analysis Complete",
      description:
        analysisResult?.message ?? "Structured meeting insights will appear here.",
      status: eventStatus(analysisResult),
      timestamp: analysisResult?.created_at ?? null,
      errorMessage: analysisResult?.error_message ?? null,
      retryType:
        analysisResult?.event_type === "analysis_failed" ? "analysis" : undefined
    }
  ];
}

export function MeetingDetail({ meetingId }: { meetingId: string }) {
  const [meeting, setMeeting] = useState<MeetingDetailRow | null>(null);
  const [transcriptSegments, setTranscriptSegments] = useState<
    TranscriptSegment[]
  >([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantNameDrafts, setParticipantNameDrafts] = useState<
    Record<string, string>
  >({});
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [segmentAssignTargets, setSegmentAssignTargets] = useState<
    Record<string, string>
  >({});
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [processingEvents, setProcessingEvents] = useState<ProcessingEvent[]>([]);
  const [activityEvents, setActivityEvents] = useState<MeetingActivityEvent[]>([]);
  const [showOldestActivityFirst, setShowOldestActivityFirst] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeJobId, setActiveJobId] = useState("");
  const [activeJobType, setActiveJobType] = useState<
    "transcription" | "analysis" | ""
  >("");
  const [isCancellingJob, setIsCancellingJob] = useState(false);
  const [translateToEnglish, setTranslateToEnglish] = useState(false);
  const [error, setError] = useState("");
  const [transcriptionError, setTranscriptionError] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [speakerError, setSpeakerError] = useState("");
  const [isSavingSpeaker, setIsSavingSpeaker] = useState(false);

  const loadMeeting = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data, error: meetingError } = await supabase
      .from("meetings")
      .select(
        "id,title,description,meeting_date,audio_storage_path,duration_seconds,processing_status,summary,brief,detected_language,transcript_language,translation_language,translate_to_english,transcript_kind,tags,created_at"
      )
      .eq("id", meetingId)
      .single();

    if (meetingError) {
      throw meetingError;
    }

    const { data: segments, error: transcriptError } = await supabase
      .from("transcript_segments")
      .select(
        "id,participant_id,speaker_label,start_ms,end_ms,text,original_text,translated_text,transcript_kind,segment_index"
      )
      .eq("meeting_id", meetingId)
      .order("segment_index", { ascending: true });

    if (transcriptError) {
      throw transcriptError;
    }

    const { data: participantRows, error: participantError } = await supabase
      .from("participants")
      .select("id,display_name,speaker_label,created_at")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true });

    if (participantError) {
      throw participantError;
    }

    const { data: actionItemRows, error: actionItemError } = await supabase
      .from("action_items")
      .select("id,title,description,status,due_at")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true });

    if (actionItemError) {
      throw actionItemError;
    }

    const { data: decisionRows, error: decisionError } = await supabase
      .from("decisions")
      .select("id,title,description")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true });

    if (decisionError) {
      throw decisionError;
    }

    const { data: questionRows, error: questionError } = await supabase
      .from("questions")
      .select("id,question,answer,status")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true });

    if (questionError) {
      throw questionError;
    }

    const { data: eventRows, error: eventError } = await supabase
      .from("processing_events")
      .select(
        "id,event_order,job_type,event_type,status,message,error_message,created_at"
      )
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true })
      .order("event_order", { ascending: true });

    if (eventError) {
      throw eventError;
    }

    const { data: activityRows, error: activityError } = await supabase
      .from("meeting_activity_events")
      .select(
        "id,event_type,actor_type,actor_label,title,description,metadata,created_at"
      )
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: false });

    if (activityError) {
      throw activityError;
    }

    let signedAudioUrl = "";

    if (data.audio_storage_path) {
      const { data: signedUrlData, error: signedUrlError } =
        await supabase.storage
          .from("meeting-audio")
          .createSignedUrl(data.audio_storage_path, 60 * 60);

      if (signedUrlError) {
        throw signedUrlError;
      }

      signedAudioUrl = signedUrlData.signedUrl;
    }

    return {
      meeting: data,
      audioUrl: signedAudioUrl,
      transcriptSegments: segments ?? [],
      participants: participantRows ?? [],
      actionItems: actionItemRows ?? [],
      decisions: decisionRows ?? [],
      questions: questionRows ?? [],
      processingEvents: eventRows ?? [],
      activityEvents: activityRows ?? []
    };
  }, [meetingId]);

  async function getAccessToken() {
    const supabase = createBrowserSupabaseClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    const accessToken = sessionData.session?.access_token;

    if (!accessToken) {
      throw new Error("You must be signed in to edit speakers.");
    }

    return accessToken;
  }

  const refreshMeetingData = useCallback(async () => {
    const result = await loadMeeting();

    setMeeting(result.meeting);
    setAudioUrl(result.audioUrl);
    setTranscriptSegments(result.transcriptSegments);
    setParticipants(result.participants);
    setParticipantNameDrafts(
      Object.fromEntries(
        result.participants.map((participant) => [
          participant.id,
          participant.display_name
        ])
      )
    );
    setTranslateToEnglish(result.meeting.translate_to_english ?? false);
    setActionItems(result.actionItems);
    setDecisions(result.decisions);
    setQuestions(result.questions);
    setProcessingEvents(result.processingEvents);
    setActivityEvents(result.activityEvents);
  }, [loadMeeting]);

  useEffect(() => {
    let isMounted = true;

    async function hydrate() {
      setIsLoading(true);
      setError("");

      try {
        const result = await loadMeeting();

        if (isMounted) {
          setMeeting(result.meeting);
          setAudioUrl(result.audioUrl);
          setTranscriptSegments(result.transcriptSegments);
          setParticipants(result.participants);
          setParticipantNameDrafts(
            Object.fromEntries(
              result.participants.map((participant) => [
                participant.id,
                participant.display_name
              ])
            )
          );
          setTranslateToEnglish(result.meeting.translate_to_english ?? false);
          setActionItems(result.actionItems);
          setDecisions(result.decisions);
          setQuestions(result.questions);
          setProcessingEvents(result.processingEvents);
          setActivityEvents(result.activityEvents);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load meeting."
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    hydrate();

    return () => {
      isMounted = false;
    };
  }, [loadMeeting]);

  useEffect(() => {
    const processingStatus = meeting?.processing_status;

    if (!processingStatus || !isActiveProcessingStatus(processingStatus)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshMeetingData();
    }, jobPollIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [meeting?.processing_status, refreshMeetingData]);

  async function pollJobUntilSettled(jobId: string) {
    const accessToken = await getAccessToken();

    while (true) {
      await sleep(jobPollIntervalMs);

      const response = await fetch(
        `${apiBaseUrl}/v1/meetings/${meetingId}/jobs/${jobId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to check job status.");
      }

      const status = (await response.json()) as JobStatusResponse;
      setActiveJobType(status.job_type);

      setMeeting((current) =>
        current
          ? { ...current, processing_status: status.processing_status }
          : current
      );

      if (
        status.ready ||
        status.failed ||
        isTerminalProcessingStatus(status.processing_status)
      ) {
        await refreshMeetingData();
        return status;
      }
    }
  }

  async function cancelProcessing() {
    if (!activeJobId) {
      return;
    }

    setIsCancellingJob(true);
    setTranscriptionError("");
    setAnalysisError("");

    try {
      const accessToken = await getAccessToken();
      const response = await fetch(
        `${apiBaseUrl}/v1/meetings/${meetingId}/jobs/${activeJobId}/cancel`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to cancel processing.");
      }

      setMeeting((current) =>
        current ? { ...current, processing_status: "cancelled" } : current
      );
      setActiveJobId("");
      setActiveJobType("");
      await refreshMeetingData();
    } catch (cancelError) {
      const message =
        cancelError instanceof Error
          ? cancelError.message
          : "Unable to cancel processing.";
      setTranscriptionError(message);
      setAnalysisError(message);
    } finally {
      setIsCancellingJob(false);
      setIsTranscribing(false);
      setIsAnalyzing(false);
    }
  }

  async function generateTranscript() {
    setIsTranscribing(true);
    setTranscriptionError("");

    try {
      const accessToken = await getAccessToken();

      setMeeting((current) =>
        current ? { ...current, processing_status: "queued" } : current
      );

      const response = await fetch(
        `${apiBaseUrl}/v1/meetings/${meetingId}/transcribe`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ translate_to_english: translateToEnglish })
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to generate transcript.");
      }

      const payload = (await response.json()) as JobEnqueueResponse;
      setActiveJobId(payload.job_id);
      setActiveJobType("transcription");
      setMeeting((current) =>
        current
          ? { ...current, processing_status: payload.processing_status }
          : current
      );

      const status = await pollJobUntilSettled(payload.job_id);

      if (
        status.failed ||
        status.processing_status === "failed" ||
        status.processing_status === "transcription_failed"
      ) {
        throw new Error(status.error_message ?? "Unable to generate transcript.");
      }
    } catch (transcribeError) {
      setMeeting((current) =>
        current ? { ...current, processing_status: "failed" } : current
      );
      setTranscriptionError(
        transcribeError instanceof Error
          ? transcribeError.message
          : "Unable to generate transcript."
      );
    } finally {
      setActiveJobId("");
      setActiveJobType("");
      setIsTranscribing(false);
    }
  }

  async function generateAnalysis() {
    setIsAnalyzing(true);
    setAnalysisError("");

    try {
      const accessToken = await getAccessToken();

      setMeeting((current) =>
        current ? { ...current, processing_status: "queued" } : current
      );

      const response = await fetch(
        `${apiBaseUrl}/v1/meetings/${meetingId}/analyze`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to generate analysis.");
      }

      const payload = (await response.json()) as JobEnqueueResponse;
      setActiveJobId(payload.job_id);
      setActiveJobType("analysis");
      setMeeting((current) =>
        current
          ? { ...current, processing_status: payload.processing_status }
          : current
      );

      const status = await pollJobUntilSettled(payload.job_id);

      if (
        status.failed ||
        status.processing_status === "failed" ||
        status.processing_status === "analysis_failed"
      ) {
        throw new Error(status.error_message ?? "Unable to generate analysis.");
      }
    } catch (analyzeError) {
      setMeeting((current) =>
        current ? { ...current, processing_status: "failed" } : current
      );
      setAnalysisError(
        analyzeError instanceof Error
          ? analyzeError.message
          : "Unable to generate analysis."
      );
    } finally {
      setActiveJobId("");
      setActiveJobType("");
      setIsAnalyzing(false);
    }
  }

  async function saveParticipantName(participantId: string) {
    setIsSavingSpeaker(true);
    setSpeakerError("");

    try {
      const accessToken = await getAccessToken();
      const displayName = participantNameDrafts[participantId]?.trim();

      if (!displayName) {
        throw new Error("Speaker name cannot be empty.");
      }

      const response = await fetch(
        `${apiBaseUrl}/v1/meetings/${meetingId}/participants/${participantId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ display_name: displayName })
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to rename speaker.");
      }

      await refreshMeetingData();
    } catch (renameError) {
      setSpeakerError(
        renameError instanceof Error
          ? renameError.message
          : "Unable to rename speaker."
      );
    } finally {
      setIsSavingSpeaker(false);
    }
  }

  async function mergeParticipant(participantId: string) {
    setIsSavingSpeaker(true);
    setSpeakerError("");

    try {
      const targetParticipantId = mergeTargets[participantId];

      if (!targetParticipantId) {
        throw new Error("Choose a speaker to merge into.");
      }

      const accessToken = await getAccessToken();
      const response = await fetch(
        `${apiBaseUrl}/v1/meetings/${meetingId}/participants/merge`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            source_participant_id: participantId,
            target_participant_id: targetParticipantId
          })
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to merge speakers.");
      }

      await refreshMeetingData();
      setMergeTargets((current) => {
        const next = { ...current };
        delete next[participantId];
        return next;
      });
    } catch (mergeError) {
      setSpeakerError(
        mergeError instanceof Error
          ? mergeError.message
          : "Unable to merge speakers."
      );
    } finally {
      setIsSavingSpeaker(false);
    }
  }

  async function assignSegment(segmentId: string, participantId: string) {
    setIsSavingSpeaker(true);
    setSpeakerError("");

    try {
      const accessToken = await getAccessToken();
      const response = await fetch(
        `${apiBaseUrl}/v1/meetings/${meetingId}/transcript-segments/assign`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            segment_ids: [segmentId],
            target_participant_id: participantId
          })
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to assign transcript segment.");
      }

      await refreshMeetingData();
    } catch (assignError) {
      setSpeakerError(
        assignError instanceof Error
          ? assignError.message
          : "Unable to assign transcript segment."
      );
    } finally {
      setIsSavingSpeaker(false);
    }
  }

  if (isLoading) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">Loading meeting...</p>
      </section>
    );
  }

  if (error || !meeting) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error || "Meeting was not found."}
      </section>
    );
  }

  const isProcessingActive = isActiveProcessingStatus(meeting.processing_status);
  const isMeetingTranscribing =
    isTranscribing ||
    (meeting.processing_status === "queued" && activeJobType !== "analysis") ||
    meeting.processing_status === "transcribing";
  const isMeetingAnalyzing =
    isAnalyzing ||
    (meeting.processing_status === "queued" && activeJobType === "analysis") ||
    meeting.processing_status === "analyzing";
  const canAnalyze =
    transcriptSegments.length > 0 && !isProcessingActive;
  const transcriptButtonLabel =
    meeting.processing_status === "failed" ||
    meeting.processing_status === "transcription_failed"
      ? "Retry Transcript"
      : isMeetingTranscribing
        ? "Processing..."
        : "Generate Transcript";
  const analysisButtonLabel =
    meeting.processing_status === "failed" ||
    meeting.processing_status === "analysis_failed"
      ? "Retry Analysis"
      : isMeetingAnalyzing
        ? "Processing..."
        : "Generate Analysis";
  const participantById = new Map(
    participants.map((participant, index) => [
      participant.id,
      {
        ...participant,
        fallbackName: fallbackSpeakerName(index)
      }
    ])
  );
  const totalSpeakingMs = transcriptSegments.reduce(
    (sum, segment) => sum + Math.max(0, segment.end_ms - segment.start_ms),
    0
  );
  const speakerStats = participants.map((participant, index) => {
    const segments = transcriptSegments.filter(
      (segment) => segment.participant_id === participant.id
    );
    const speakingMs = segments.reduce(
      (sum, segment) => sum + Math.max(0, segment.end_ms - segment.start_ms),
      0
    );

    return {
      ...participant,
      fallbackName: fallbackSpeakerName(index),
      segmentCount: segments.length,
      speakingMs,
      conversationPercent:
        totalSpeakingMs > 0 ? Math.round((speakingMs / totalSpeakingMs) * 100) : 0
    };
  });
  const processingTimeline = buildProcessingTimeline(meeting, processingEvents);
  const sortedActivityEvents = [...activityEvents].sort((left, right) => {
    const timeDiff =
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime();

    return showOldestActivityFirst ? timeDiff : -timeDiff;
  });

  function getSegmentSpeakerName(segment: TranscriptSegment) {
    if (segment.participant_id) {
      const participant = participantById.get(segment.participant_id);

      if (participant) {
        return participant.display_name || participant.fallbackName;
      }
    }

    return segment.speaker_label || fallbackSpeakerName(0);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          className="text-sm font-medium text-signal hover:text-ink"
          href="/dashboard/meetings"
        >
          Back to meetings
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-meadow">
              {formatDate(meeting.meeting_date)}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">
              {meeting.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {meeting.description || "No description provided."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-meadow bg-emerald-50 px-3 py-1 text-xs font-medium text-meadow">
              {formatProcessingStatus(meeting.processing_status)}
            </span>
            {isProcessingActive && activeJobId ? (
              <button
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-ink transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                type="button"
                onClick={cancelProcessing}
                disabled={isCancellingJob}
              >
                {isCancellingJob ? "Cancelling..." : "Cancel Processing"}
              </button>
            ) : null}
          </div>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Duration
            </dt>
            <dd className="mt-1 text-sm font-semibold text-ink">
              {formatDuration(meeting.duration_seconds)}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Status
            </dt>
            <dd className="mt-1 text-sm font-semibold text-ink">
              {formatProcessingStatus(meeting.processing_status)}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Detected Language
            </dt>
            <dd className="mt-1 text-sm font-semibold text-ink">
              {formatLanguage(meeting.detected_language)}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Transcript Language
            </dt>
            <dd className="mt-1 text-sm font-semibold text-ink">
              {formatLanguage(meeting.transcript_language)}
              {meeting.transcript_kind === "both" ? " (translated)" : ""}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Tags
            </dt>
            <dd className="mt-1 text-sm font-semibold text-ink">
              {meeting.tags.length > 0 ? meeting.tags.join(", ") : "None"}
            </dd>
          </div>
        </dl>

        {audioUrl ? (
          <div className="mt-6 grid gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-ink">Audio Player</p>
                <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                  <input
                    className="h-4 w-4 rounded border-slate-300 text-signal focus:ring-signal"
                    type="checkbox"
                    checked={translateToEnglish}
                    onChange={(event) =>
                      setTranslateToEnglish(event.target.checked)
                    }
                  />
                  Translate non-English audio to English
                </label>
              </div>
              <button
                className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                type="button"
                onClick={generateTranscript}
                disabled={isProcessingActive}
              >
                {transcriptButtonLabel}
              </button>
            </div>
            <audio className="w-full" controls src={audioUrl} />
            {transcriptionError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {transcriptionError}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h3 className="text-lg font-semibold text-ink">Processing Timeline</h3>
          <p className="mt-1 text-sm text-slate-600">
            Follow each stage from upload through meeting intelligence.
          </p>
        </div>
        <ol className="mt-6">
          {processingTimeline.map((step, index) => {
            const isFailed = step.status === "failed";
            const isCurrent = step.status === "current";
            const isCompleted = step.status === "completed";

            return (
              <li className="relative flex gap-4 pb-6 last:pb-0" key={step.key}>
                {index < processingTimeline.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={`absolute left-[0.6875rem] top-6 h-[calc(100%-0.5rem)] w-0.5 ${
                      isCompleted ? "bg-emerald-300" : "bg-slate-200"
                    }`}
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                    isFailed
                      ? "border-red-500 bg-red-100 text-red-700"
                      : isCurrent
                        ? "border-blue-500 bg-blue-100 text-blue-700"
                        : isCompleted
                          ? "border-emerald-500 bg-emerald-100 text-emerald-700"
                          : "border-slate-300 bg-white text-slate-400"
                  }`}
                >
                  {isFailed ? "!" : isCompleted ? "✓" : index + 1}
                </span>
                <div
                  className={`min-w-0 flex-1 rounded-lg border p-4 ${
                    isFailed
                      ? "border-red-200 bg-red-50"
                      : isCurrent
                        ? "border-blue-200 bg-blue-50"
                        : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-ink">{step.label}</h4>
                      <p className="mt-1 text-sm text-slate-600">{step.description}</p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                        isFailed
                          ? "bg-red-100 text-red-700"
                          : isCurrent
                            ? "bg-blue-100 text-blue-700"
                            : isCompleted
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {step.status}
                    </span>
                  </div>
                  {formatTimelineTimestamp(step.timestamp) ? (
                    <p className="mt-2 text-xs text-slate-500">
                      {formatTimelineTimestamp(step.timestamp)}
                    </p>
                  ) : null}
                  {step.errorMessage ? (
                    <p className="mt-3 rounded-md border border-red-200 bg-white p-3 text-sm text-red-700">
                      {step.errorMessage}
                    </p>
                  ) : null}
                  {step.retryType ? (
                    <button
                      className="mt-3 rounded-md bg-red-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                      type="button"
                      onClick={
                        step.retryType === "transcription"
                          ? generateTranscript
                          : generateAnalysis
                      }
                      disabled={isProcessingActive || isTranscribing || isAnalyzing}
                    >
                      Retry {step.retryType === "transcription" ? "Transcript" : "Analysis"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-ink">Activity Feed</h3>
            <p className="mt-1 text-sm text-slate-600">
              Permanent meeting history, including processing events and speaker corrections.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              className="h-4 w-4 rounded border-slate-300 text-signal focus:ring-signal"
              type="checkbox"
              checked={showOldestActivityFirst}
              onChange={(event) => setShowOldestActivityFirst(event.target.checked)}
            />
            Show oldest first
          </label>
        </div>

        {sortedActivityEvents.length > 0 ? (
          <ol className="mt-6 grid gap-3">
            {sortedActivityEvents.map((activity) => {
              const isFailure = isFailureActivity(activity);
              const isSpeakerCorrection = isSpeakerCorrectionActivity(activity);
              const originalLabel = activityMetadataText(
                activity.metadata.original_label
              );
              const newLabel = activityMetadataText(activity.metadata.new_label);
              const affectedSegmentCount = activityMetadataText(
                activity.metadata.affected_segment_count
              );
              const confidenceScore = activityMetadataText(
                activity.metadata.confidence_score
              );
              const errorMessage = activityMetadataText(
                activity.metadata.error_message
              );

              return (
                <li
                  className={`rounded-lg border p-4 ${
                    isFailure
                      ? "border-red-200 bg-red-50"
                      : isSpeakerCorrection
                        ? "border-amber-200 bg-amber-50"
                        : activity.actor_type === "owner"
                          ? "border-blue-200 bg-blue-50"
                          : "border-slate-200 bg-slate-50"
                  }`}
                  key={activity.id}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-ink">
                          {activity.title}
                        </h4>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                            isFailure
                              ? "bg-red-100 text-red-700"
                              : isSpeakerCorrection
                                ? "bg-amber-100 text-amber-800"
                                : activity.actor_type === "owner"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {activity.actor_type}
                        </span>
                        {isFailure ? (
                          <span className="rounded-full bg-red-700 px-2.5 py-1 text-xs font-semibold text-white">
                            Failed
                          </span>
                        ) : null}
                        {isSpeakerCorrection ? (
                          <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-900">
                            Speaker review
                          </span>
                        ) : null}
                      </div>
                      {activity.description ? (
                        <p className="mt-1 text-sm text-slate-600">
                          {activity.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-left text-xs text-slate-500 sm:text-right">
                      <p>{formatActivityTimestamp(activity.created_at)}</p>
                      <p className="mt-1 font-medium">{activity.actor_label}</p>
                    </div>
                  </div>

                  {errorMessage ? (
                    <p className="mt-3 rounded-md border border-red-200 bg-white p-3 text-sm text-red-700">
                      {errorMessage}
                    </p>
                  ) : null}

                  {isSpeakerCorrection ? (
                    <dl className="mt-3 grid gap-2 rounded-md border border-white/70 bg-white/70 p-3 text-xs text-slate-600 sm:grid-cols-2">
                      {originalLabel ? (
                        <div>
                          <dt className="font-semibold uppercase tracking-wide text-slate-500">
                            Original
                          </dt>
                          <dd className="mt-1 text-slate-800">{originalLabel}</dd>
                        </div>
                      ) : null}
                      {newLabel ? (
                        <div>
                          <dt className="font-semibold uppercase tracking-wide text-slate-500">
                            New
                          </dt>
                          <dd className="mt-1 text-slate-800">{newLabel}</dd>
                        </div>
                      ) : null}
                      {affectedSegmentCount ? (
                        <div>
                          <dt className="font-semibold uppercase tracking-wide text-slate-500">
                            Segments affected
                          </dt>
                          <dd className="mt-1 text-slate-800">
                            {affectedSegmentCount}
                          </dd>
                        </div>
                      ) : null}
                      {confidenceScore ? (
                        <div>
                          <dt className="font-semibold uppercase tracking-wide text-slate-500">
                            Confidence
                          </dt>
                          <dd className="mt-1 text-slate-800">{confidenceScore}</dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            No activity has been recorded for this meeting yet.
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink">
              Meeting Intelligence
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {isMeetingAnalyzing
                ? "Analysis is queued or processing."
                : meeting.processing_status === "analyzed"
                  ? "AI-generated summary and structured meeting records."
                  : "Generate analysis after the transcript is ready."}
            </p>
          </div>
          <button
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            type="button"
            onClick={generateAnalysis}
            disabled={!canAnalyze}
          >
            {analysisButtonLabel}
          </button>
        </div>

        {isMeetingAnalyzing ? (
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-ink" />
          </div>
        ) : null}

        {analysisError ? (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {analysisError}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <article className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h4 className="text-sm font-semibold text-ink">Executive Summary</h4>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {meeting.summary || "No summary has been generated yet."}
            </p>
          </article>

          <article className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h4 className="text-sm font-semibold text-ink">Meeting Brief</h4>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {meeting.brief || "No brief has been generated yet."}
            </p>
          </article>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink">Speakers</h3>
            <p className="mt-1 text-sm text-slate-600">
              {speakerStats.length > 0
                ? `${speakerStats.length} speaker${
                    speakerStats.length === 1 ? "" : "s"
                  } identified`
                : "No speakers have been identified yet."}
            </p>
          </div>
        </div>

        {speakerError ? (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {speakerError}
          </div>
        ) : null}

        {speakerStats.length > 0 ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {speakerStats.map((speaker) => (
              <article
                className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                key={speaker.id}
              >
                <div className="flex flex-col gap-3">
                  <label
                    className="text-xs font-medium uppercase tracking-wide text-slate-500"
                    htmlFor={`speaker-${speaker.id}`}
                  >
                    {speaker.fallbackName}
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-signal focus:ring-2 focus:ring-blue-100"
                      id={`speaker-${speaker.id}`}
                      type="text"
                      value={
                        participantNameDrafts[speaker.id] ?? speaker.display_name
                      }
                      onChange={(event) =>
                        setParticipantNameDrafts((current) => ({
                          ...current,
                          [speaker.id]: event.target.value
                        }))
                      }
                    />
                    <button
                      className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      type="button"
                      disabled={isSavingSpeaker}
                      onClick={() => saveParticipantName(speaker.id)}
                    >
                      Save
                    </button>
                  </div>
                </div>

                <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Transcript
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-ink">
                      {speaker.segmentCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Time
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-ink">
                      {formatSpeakingTime(speaker.speakingMs)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Share
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-ink">
                      {speaker.conversationPercent}%
                    </dd>
                  </div>
                </dl>

                {participants.length > 1 ? (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <select
                      className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-signal focus:ring-2 focus:ring-blue-100"
                      value={mergeTargets[speaker.id] ?? ""}
                      onChange={(event) =>
                        setMergeTargets((current) => ({
                          ...current,
                          [speaker.id]: event.target.value
                        }))
                      }
                    >
                      <option value="">Merge into...</option>
                      {participants
                        .filter((participant) => participant.id !== speaker.id)
                        .map((participant, optionIndex) => (
                          <option key={participant.id} value={participant.id}>
                            {participant.display_name ||
                              fallbackSpeakerName(optionIndex)}
                          </option>
                        ))}
                    </select>
                    <button
                      className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                      type="button"
                      disabled={isSavingSpeaker || !mergeTargets[speaker.id]}
                      onClick={() => mergeParticipant(speaker.id)}
                    >
                      Merge
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink">Transcript</h3>
            <p className="mt-1 text-sm text-slate-600">
              {isMeetingTranscribing
                ? "Transcription is in progress."
                : transcriptSegments.length > 0
                  ? `${transcriptSegments.length} transcript segment${
                      transcriptSegments.length === 1 ? "" : "s"
                    }`
                  : "No transcript has been generated yet."}
            </p>
          </div>
        </div>

        {isMeetingTranscribing ? (
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-signal" />
          </div>
        ) : null}

        {transcriptSegments.length > 0 ? (
          <div className="mt-5 grid gap-3">
            {transcriptSegments.map((segment) => (
              <article
                className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                key={segment.id}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                  <span>{formatTranscriptTime(segment.start_ms)}</span>
                  <span>-</span>
                  <span>{formatTranscriptTime(segment.end_ms)}</span>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600">
                    {getSegmentSpeakerName(segment)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-ink">
                  {segment.text}
                </p>
                {segment.transcript_kind === "both" && segment.original_text ? (
                  <p className="mt-2 border-l-2 border-slate-300 pl-3 text-sm leading-6 text-slate-600">
                    Original: {segment.original_text}
                  </p>
                ) : null}
                {participants.length > 1 ? (
                  <div className="mt-3">
                    <label
                      className="sr-only"
                      htmlFor={`assign-segment-${segment.id}`}
                    >
                      Assign transcript segment
                    </label>
                    <select
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-signal focus:ring-2 focus:ring-blue-100 sm:w-auto"
                      id={`assign-segment-${segment.id}`}
                      value={
                        segmentAssignTargets[segment.id] ??
                        segment.participant_id ??
                        ""
                      }
                      disabled={isSavingSpeaker}
                      onChange={(event) => {
                        const participantId = event.target.value;
                        setSegmentAssignTargets((current) => ({
                          ...current,
                          [segment.id]: participantId
                        }));

                        if (participantId) {
                          void assignSegment(segment.id, participantId);
                        }
                      }}
                    >
                      {participants.map((participant, index) => (
                        <option key={participant.id} value={participant.id}>
                          {participant.display_name || fallbackSpeakerName(index)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-ink">Action Items</h3>
          {actionItems.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {actionItems.map((item) => (
                <div
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  key={item.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">{item.title}</p>
                    <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium capitalize text-slate-600">
                      {item.status.replace("_", " ")}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {item.description}
                    </p>
                  ) : null}
                  {item.due_at ? (
                    <p className="mt-2 text-xs font-medium text-slate-500">
                      Due {formatDate(item.due_at)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-600">
              No action items have been generated yet.
            </p>
          )}
        </article>

        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-ink">Decisions</h3>
          {decisions.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {decisions.map((decision) => (
                <div
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  key={decision.id}
                >
                  <p className="text-sm font-semibold text-ink">
                    {decision.title}
                  </p>
                  {decision.description ? (
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {decision.description}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-600">
              No decisions have been generated yet.
            </p>
          )}
        </article>

        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-ink">Questions</h3>
          {questions.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {questions.map((question) => (
                <div
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  key={question.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {question.question}
                    </p>
                    <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium capitalize text-slate-600">
                      {question.status}
                    </span>
                  </div>
                  {question.answer ? (
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {question.answer}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-600">
              No questions have been generated yet.
            </p>
          )}
        </article>
      </section>
    </div>
  );
}
