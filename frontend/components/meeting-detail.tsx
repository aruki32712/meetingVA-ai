"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { countDetectedSpeakers, formatDate, formatDuration } from "./meeting-utils";
import {
  completeMeetingDeletion,
  isMeetingDeletionConfirmed,
  MEETING_DELETED_EVENT,
  requestMeetingDeletion,
  tryBeginMeetingDeletion
} from "./meeting-deletion-state";
import {
  normalizeTimelineVisualStates,
  timelineStatusPresentation,
  type TimelineVisualStatus
} from "./processing-timeline-state";
import {
  getSafeTranscriptionError,
  getTranscriptionUiState
} from "./transcription-job-state";
import {
  analysisJobBlocksRequest,
  canStartAnalysis,
  isAnalysisJobActive,
  requestAnalysisJob,
  shouldAutomaticallyStartAnalysis,
  shouldShowAnalyzing,
  type AnalysisJobSummary
} from "./analysis-job-state";
import {
  displayedTranscriptText,
  isEnglishLanguage,
  type TranslationSection
} from "./meeting-translation-state";
import { MeetingExportDialog } from "./meeting-export-dialog";
import {
  nextAvailableSpeakerName,
  selectedSpeakerTurns
} from "./speaker-split-state";
import {
  buildTranscriptSplitParts,
  replaceTranscriptSegment,
  splitCanBeSaved,
  transcriptSpeakerStats,
  transcriptWordBoundaries
} from "./transcript-segment-split-state";

type MeetingDetailRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  scheduled_at: string | null;
  audio_storage_path: string | null;
  duration_seconds: number | null;
  status: string;
  summary: string | null;
  brief: string | null;
  summary_translated: string | null;
  brief_translated: string | null;
  analysis_stale: boolean;
  detected_language: string | null;
  transcript_language: string | null;
  translation_language: string | null;
  translation_status: "not_requested" | "not_needed" | "translated" | "failed";
  translate_to_english: boolean;
  transcript_kind: "original" | "translated" | "both";
  tags: string[];
  created_at: string | null;
};

type ProcessingEvent = {
  id: string;
  event_order: number;
  job_type: "transcription" | "analysis" | null;
  event_type: string;
  status: TimelineVisualStatus;
  message: string;
  error_message: string | null;
  created_at: string | null;
};

type TimelineStep = {
  key: string;
  label: string;
  description: string;
  status: TimelineVisualStatus;
  timestamp: string | null;
  errorMessage: string | null;
  retryType?: "transcription" | "analysis";
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

type TranscriptSegmentSplitResponse = {
  meeting_id: string;
  original_segment_id: string;
  segments: TranscriptSegment[];
  participants?: Participant[];
  analysis_stale: boolean;
};

type TranscriptSegmentAssignmentResponse = {
  participant: Participant;
  segments: TranscriptSegment[];
  updated_segment_count: number;
};

type ActionItem = {
  id: string;
  title: string;
  description: string | null;
  translated_title: string | null;
  translated_description: string | null;
  status: string;
  due_at: string | null;
};

type Decision = {
  id: string;
  title: string;
  description: string | null;
  translated_title: string | null;
  translated_description: string | null;
};

type Question = {
  id: string;
  question: string;
  answer: string | null;
  translated_question: string | null;
  translated_answer: string | null;
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

type TranscriptionJob = {
  id: string;
  status: string;
  error_message: string | null;
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

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return fallback;
}

function toMeetingStatus(processingStatus: string) {
  if (isActiveProcessingStatus(processingStatus)) {
    return "processing";
  }

  return "completed";
}

function isActiveProcessingStatus(status: string) {
  return ["queued", "transcribing", "analyzing", "processing"].includes(status);
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

function getValidTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) {
    return null;
  }

  const date = new Date(timestamp);

  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function formatTimelineTimestamp(timestamp: string | null | undefined) {
  const time = getValidTimestamp(timestamp);

  if (time === null) {
    return "Time unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(time));
}

function buildProcessingTimeline(
  meeting: MeetingDetailRow,
  events: ProcessingEvent[]
): TimelineStep[] {
  const labels: Record<string, string> = {
    meeting_created: "Meeting Created",
    audio_uploaded: "Audio Uploaded",
    queued: "Queued",
    transcription_started: "Transcribing",
    transcription_completed: "Transcript Complete",
    transcription_failed: "Transcription Failed",
    transcription_cancelled: "Transcription Cancelled",
    analysis_started: "Analyzing",
    analysis_completed: "Analysis Complete",
    analysis_failed: "Analysis Failed",
    analysis_cancelled: "Analysis Cancelled"
  };
  const timelineEvents = normalizeTimelineVisualStates(
    events.filter((event) => event.event_type in labels)
  );
  const steps = timelineEvents.map((event): TimelineStep => ({
    key: event.id,
    label: labels[event.event_type],
    description: event.message,
    status: event.status,
    timestamp: event.created_at,
    errorMessage:
      event.event_type === "transcription_failed"
        ? getSafeTranscriptionError(event.error_message)
        : event.error_message,
    retryType:
      event.event_type === "transcription_failed"
        ? "transcription"
        : event.event_type === "analysis_failed"
          ? "analysis"
          : undefined
  }));

  if (!timelineEvents.some((event) => event.event_type === "meeting_created")) {
    steps.unshift({
      key: "created",
      label: "Meeting Created",
      description: "Meeting record created.",
      status: "completed",
      timestamp: meeting.created_at,
      errorMessage: null
    });
  }

  return steps;
}

export function MeetingDetail({ meetingId }: { meetingId: string }) {
  const router = useRouter();
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
  const [segmentNewSpeakerNames, setSegmentNewSpeakerNames] = useState<
    Record<string, string>
  >({});
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [processingEvents, setProcessingEvents] = useState<ProcessingEvent[]>([]);
  const [audioUrl, setAudioUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRequestingAnalysis, setIsRequestingAnalysis] = useState(false);
  const [isOwnedMeeting, setIsOwnedMeeting] = useState(false);
  const [transcriptionJob, setTranscriptionJob] =
    useState<TranscriptionJob | null>(null);
  const [analysisJob, setAnalysisJob] = useState<AnalysisJobSummary | null>(null);
  const analysisRequestInFlight = useRef(false);
  const [activeJobId, setActiveJobId] = useState("");
  const [activeJobType, setActiveJobType] = useState<
    "transcription" | "analysis" | ""
  >("");
  const [isCancellingJob, setIsCancellingJob] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isDeletingMeeting, setIsDeletingMeeting] = useState(false);
  const deleteRequestInFlightRef = useRef(false);
  const [deletionError, setDeletionError] = useState("");
  const [englishSections, setEnglishSections] = useState<Set<TranslationSection>>(new Set());
  const [translatingSection, setTranslatingSection] = useState<TranslationSection | null>(null);
  const [translationError, setTranslationError] = useState("");
  const [error, setError] = useState("");
  const [transcriptionError, setTranscriptionError] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [speakerError, setSpeakerError] = useState("");
  const [isSavingSpeaker, setIsSavingSpeaker] = useState(false);
  const [splitParticipantId, setSplitParticipantId] = useState("");
  const [splitSegmentIds, setSplitSegmentIds] = useState<Set<string>>(new Set());
  const [splitDisplayName, setSplitDisplayName] = useState("");
  const [isSplittingSpeaker, setIsSplittingSpeaker] = useState(false);
  const [splitUndo, setSplitUndo] = useState<{
    originalParticipantId: string;
    newParticipantId: string;
  } | null>(null);
  const [segmentSplitId, setSegmentSplitId] = useState("");
  const [segmentSplitOffset, setSegmentSplitOffset] = useState<number | null>(null);
  const [segmentSplitAssignments, setSegmentSplitAssignments] = useState<
    Array<{ participantId: string; displayName: string }>
  >([]);
  const [isSplittingSegment, setIsSplittingSegment] = useState(false);
  const [segmentSplitMessage, setSegmentSplitMessage] = useState("");
  const [segmentSplitRefreshWarning, setSegmentSplitRefreshWarning] = useState("");

  const loadMeeting = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      throw userError ?? new Error("You must be signed in to view this meeting.");
    }

    const { data, error: meetingError } = await supabase
      .from("meetings")
      .select(
        "id,owner_id,title,description,status,scheduled_at,audio_storage_path,duration_seconds,summary,brief,summary_translated,brief_translated,analysis_stale,detected_language,transcript_language,translation_language,translation_status,translate_to_english,transcript_kind,created_at"
      )
      .eq("id", meetingId)
      .eq("owner_id", userData.user.id)
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
      .select("id,title,description,translated_title,translated_description,status,due_at")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true });

    if (actionItemError) {
      throw actionItemError;
    }

    const { data: decisionRows, error: decisionError } = await supabase
      .from("decisions")
      .select("id,title,description,translated_title,translated_description")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true });

    if (decisionError) {
      throw decisionError;
    }

    const { data: questionRows, error: questionError } = await supabase
      .from("questions")
      .select("id,question,answer,translated_question,translated_answer,status")
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

    const { data: transcriptionJobs, error: transcriptionJobError } =
      await supabase
        .from("processing_jobs")
        .select("id,status,error_message")
        .eq("meeting_id", meetingId)
        .eq("job_type", "transcription")
        .order("created_at", { ascending: false })
        .limit(1);

    if (transcriptionJobError) {
      throw transcriptionJobError;
    }

    const { data: analysisJobs, error: analysisJobError } = await supabase
      .from("processing_jobs")
      .select("id,status,error_message")
      .eq("meeting_id", meetingId)
      .eq("job_type", "analysis")
      .order("created_at", { ascending: false })
      .limit(1);

    if (analysisJobError) {
      throw analysisJobError;
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
      meeting: {
        ...data,
        tags: []
      },
      audioUrl: signedAudioUrl,
      transcriptSegments: segments ?? [],
      participants: participantRows ?? [],
      actionItems: actionItemRows ?? [],
      decisions: decisionRows ?? [],
      questions: questionRows ?? [],
      processingEvents: eventRows ?? [],
      transcriptionJob: (transcriptionJobs?.[0] ?? null) as TranscriptionJob | null,
      analysisJob: (analysisJobs?.[0] ?? null) as AnalysisJobSummary | null,
      isOwnedMeeting: data.owner_id === userData.user.id
    };
  }, [meetingId]);

  const getAccessToken = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    const accessToken = sessionData.session?.access_token;

    if (!accessToken) {
      throw new Error("You must be signed in to continue.");
    }

    return accessToken;
  }, []);

  const refreshMeetingData = useCallback(async () => {
    const result = await loadMeeting();
    const transcriptionJob = result.transcriptionJob;
    const analysisJob = result.analysisJob;
    const transcriptionIsActive = Boolean(
      transcriptionJob && isActiveProcessingStatus(transcriptionJob.status)
    );
    const analysisIsActive = isAnalysisJobActive(analysisJob?.status);
    const hasSettledProcessingJob = Boolean(
      transcriptionJob && isTerminalProcessingStatus(transcriptionJob.status)
    ) || Boolean(
      analysisJob && isTerminalProcessingStatus(analysisJob.status)
    );

    setMeeting({
      ...result.meeting,
      status:
        transcriptionIsActive || analysisIsActive
          ? "processing"
          : hasSettledProcessingJob
            ? "completed"
            : result.meeting.status
    });
    setIsOwnedMeeting(result.isOwnedMeeting);
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
    setActionItems(result.actionItems);
    setDecisions(result.decisions);
    setQuestions(result.questions);
    setProcessingEvents(result.processingEvents);
    setTranscriptionJob(transcriptionJob);
    setAnalysisJob(analysisJob);
    if (analysisIsActive && analysisJob) {
      setActiveJobId(analysisJob.id);
      setActiveJobType("analysis");
      setAnalysisError("");
    } else if (transcriptionIsActive && transcriptionJob) {
      setActiveJobId(transcriptionJob.id);
      setActiveJobType("transcription");
      setTranscriptionError("");
    } else {
      setActiveJobId("");
      setActiveJobType("");
      if (transcriptionJob?.status === "failed") {
        setTranscriptionError(
          getSafeTranscriptionError(transcriptionJob.error_message)
        );
      } else if (transcriptionJob?.status === "transcribed") {
        setTranscriptionError("");
      }
    }
    if (analysisJob?.status === "failed") {
      setAnalysisError(
        analysisJob.error_message ?? "Unable to generate analysis."
      );
    } else if (analysisJob?.status === "analyzed") {
      setAnalysisError("");
    }
    return result;
  }, [loadMeeting]);

  useEffect(() => {
    let isMounted = true;

    async function hydrate() {
      setIsLoading(true);
      setError("");

      try {
        const result = await loadMeeting();

        if (isMounted) {
          const transcriptionJob = result.transcriptionJob;
          const analysisJob = result.analysisJob;
          const transcriptionIsActive = Boolean(
            transcriptionJob && isActiveProcessingStatus(transcriptionJob.status)
          );
          const analysisIsActive = isAnalysisJobActive(analysisJob?.status);
          const hasSettledProcessingJob = Boolean(
            transcriptionJob && isTerminalProcessingStatus(transcriptionJob.status)
          ) || Boolean(
            analysisJob && isTerminalProcessingStatus(analysisJob.status)
          );
          setMeeting({
            ...result.meeting,
            status:
              transcriptionIsActive || analysisIsActive
                ? "processing"
                : hasSettledProcessingJob
                  ? "completed"
                  : result.meeting.status
          });
          setIsOwnedMeeting(result.isOwnedMeeting);
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
          setActionItems(result.actionItems);
          setDecisions(result.decisions);
          setQuestions(result.questions);
          setProcessingEvents(result.processingEvents);
          setTranscriptionJob(transcriptionJob);
          setAnalysisJob(analysisJob);
          if (analysisIsActive && analysisJob) {
            setActiveJobId(analysisJob.id);
            setActiveJobType("analysis");
            setAnalysisError("");
          } else if (transcriptionIsActive && transcriptionJob) {
            setActiveJobId(transcriptionJob.id);
            setActiveJobType("transcription");
            setTranscriptionError("");
          } else if (transcriptionJob?.status === "failed") {
            setTranscriptionError(
              getSafeTranscriptionError(transcriptionJob.error_message)
            );
          } else {
            const savedError = window.sessionStorage.getItem(
              `meeting-transcription-error:${meetingId}`
            );
            if (savedError) {
              setTranscriptionError(savedError);
              window.sessionStorage.removeItem(
                `meeting-transcription-error:${meetingId}`
              );
            }
          }
          if (analysisJob?.status === "failed") {
            setAnalysisError(
              analysisJob.error_message ?? "Unable to generate analysis."
            );
          } else if (analysisJob?.status === "analyzed") {
            setAnalysisError("");
          }
        }
      } catch (loadError) {
        if (process.env.NODE_ENV === "development") {
          console.error("Unable to load meeting", loadError);
        }

        if (isMounted) {
          setError(getErrorMessage(loadError, "Unable to load meeting."));
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
  }, [loadMeeting, meetingId]);

  useEffect(() => {
    const processingStatus = meeting?.status;

    if (!processingStatus || !isActiveProcessingStatus(processingStatus)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshMeetingData();
    }, jobPollIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [meeting?.status, refreshMeetingData]);

  const pollJobUntilSettled = useCallback(async (jobId: string) => {
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
          ? { ...current, status: toMeetingStatus(status.processing_status) }
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
  }, [getAccessToken, meetingId, refreshMeetingData]);

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
        current ? { ...current, status: "processing" } : current
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

  async function deleteMeeting() {
    if (
      !meeting ||
      !isMeetingDeletionConfirmed(deleteConfirmation) ||
      !tryBeginMeetingDeletion(deleteRequestInFlightRef)
    ) {
      return;
    }

    setIsDeletingMeeting(true);
    setDeletionError("");

    let deletionCompleted = false;

    const finishDeletion = () => {
      deletionCompleted = true;
      completeMeetingDeletion({
        closeModal: () => setIsDeleteDialogOpen(false),
        clearLoading: () => {
          deleteRequestInFlightRef.current = false;
          setIsDeletingMeeting(false);
        },
        clearLocalState: () => {
          setMeeting(null);
          setTranscriptSegments([]);
          setParticipants([]);
          setActionItems([]);
          setDecisions([]);
          setQuestions([]);
          setProcessingEvents([]);
          setAudioUrl("");
        },
        removeFromMeetingLists: () => {
          window.dispatchEvent(
            new CustomEvent(MEETING_DELETED_EVENT, {
              detail: { meetingId }
            })
          );
        },
        storeNotice: (message) => {
          window.sessionStorage.setItem("meetingva:notice", message);
        },
        navigate: (path) => router.replace(path)
      });
    };

    try {
      const accessToken = await getAccessToken();
      const result = await requestMeetingDeletion(() =>
        fetch(`${apiBaseUrl}/v1/meetings/${meetingId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        })
      );

      if (result.status === "success") {
        finishDeletion();
        return;
      }

      if (result.status === "http-error") {
        setDeletionError(result.message);
        return;
      }

      const supabase = createBrowserSupabaseClient();
      const { data: remainingMeeting, error: verificationError } = await supabase
        .from("meetings")
        .select("id")
        .eq("id", meetingId)
        .eq("owner_id", meeting.owner_id)
        .maybeSingle();

      if (!verificationError && !remainingMeeting) {
        finishDeletion();
        return;
      }

      setDeletionError(
        getErrorMessage(result.error, "A network error prevented deletion.")
      );
    } catch (deleteError) {
      setDeletionError(getErrorMessage(deleteError, "Unable to delete this meeting."));
    } finally {
      if (!deletionCompleted) {
        deleteRequestInFlightRef.current = false;
        setIsDeletingMeeting(false);
      }
    }
  }

  async function generateTranscript() {
    setIsTranscribing(true);
    setTranscriptionError("");

    try {
      const accessToken = await getAccessToken();

      setMeeting((current) =>
        current ? { ...current, status: "processing" } : current
      );

      const response = await fetch(
        `${apiBaseUrl}/v1/meetings/${meetingId}/transcribe`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ translate_to_english: false })
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
          ? { ...current, status: toMeetingStatus(payload.processing_status) }
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
        current ? { ...current, status: "completed" } : current
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

  async function toggleTranslation(section: TranslationSection) {
    if (englishSections.has(section)) {
      setEnglishSections((current) => {
        const next = new Set(current);
        next.delete(section);
        return next;
      });
      return;
    }
    setTranslatingSection(section);
    setTranslationError("");
    try {
      const accessToken = await getAccessToken();
      const response = await fetch(`${apiBaseUrl}/v1/meetings/${meetingId}/translate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ target_language: "english", sections: [section] })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to translate this content.");
      await refreshMeetingData();
      setEnglishSections((current) => new Set(current).add(section));
    } catch (translationFailure) {
      setTranslationError(translationFailure instanceof Error ? translationFailure.message : "Unable to translate this content.");
    } finally {
      setTranslatingSection(null);
    }
  }

  function translationButton(section: TranslationSection) {
    if (isEnglishLanguage(meeting?.transcript_language ?? meeting?.detected_language)) return null;
    const showingEnglish = englishSections.has(section);
    return (
      <button className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-ink disabled:text-slate-400" type="button" disabled={translatingSection === section} onClick={() => void toggleTranslation(section)}>
        {translatingSection === section ? "Translating…" : showingEnglish ? "Show Original" : "Show English"}
      </button>
    );
  }

  const generateAnalysis = useCallback(async () => {
    if (
      analysisRequestInFlight.current ||
      analysisJobBlocksRequest(
        analysisJob?.status,
        Boolean(meeting?.summary || meeting?.brief)
      )
    ) {
      return;
    }

    analysisRequestInFlight.current = true;
    setIsRequestingAnalysis(true);
    setAnalysisError("");

    try {
      const accessToken = await getAccessToken();
      const payload = await requestAnalysisJob({
        apiBaseUrl,
        meetingId,
        accessToken
      });
      const acceptedJob: AnalysisJobSummary = {
        id: payload.job_id,
        status: payload.processing_status,
        error_message: null
      };
      setAnalysisJob(acceptedJob);
      setIsAnalyzing(true);
      setActiveJobId(payload.job_id);
      setActiveJobType("analysis");
      setMeeting((current) =>
        current
          ? { ...current, status: toMeetingStatus(payload.processing_status) }
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
      setAnalysisError(
        analyzeError instanceof Error
          ? analyzeError.message
          : "Unable to generate analysis."
      );
    } finally {
      setActiveJobId("");
      setActiveJobType("");
      setIsAnalyzing(false);
      setIsRequestingAnalysis(false);
      analysisRequestInFlight.current = false;
    }
  }, [
    analysisJob?.status,
    getAccessToken,
    meeting?.brief,
    meeting?.summary,
    meetingId,
    pollJobUntilSettled
  ]);

  useEffect(() => {
    if (
      !shouldAutomaticallyStartAnalysis(
        transcriptionJob?.status,
        analysisJob?.status
      )
    ) {
      return;
    }

    void generateAnalysis();
  }, [analysisJob?.status, generateAnalysis, transcriptionJob?.status]);

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

  async function assignSegment(
    segmentId: string,
    assignment: { participantId?: string; displayName?: string }
  ) {
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
            target_participant_id: assignment.participantId || null,
            display_name: assignment.displayName?.trim() || null
          })
        }
      );
      const payload = (await response.json().catch(() => null)) as
        | TranscriptSegmentAssignmentResponse
        | { detail?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Unable to assign transcript segment."
        );
      }
      if (
        !payload ||
        !("participant" in payload) ||
        !("segments" in payload) ||
        !Array.isArray(payload.segments)
      ) {
        throw new Error("The speaker update did not return the updated segment.");
      }
      const updatedById = new Map(payload.segments.map((segment) => [segment.id, segment]));
      setTranscriptSegments((current) =>
        current.map((segment) => updatedById.get(segment.id) ?? segment)
      );
      setParticipants((current) => {
        const byId = new Map(current.map((participant) => [participant.id, participant]));
        byId.set(payload.participant.id, payload.participant);
        return [...byId.values()].sort((left, right) =>
          left.created_at.localeCompare(right.created_at)
        );
      });
      setSegmentAssignTargets((current) => ({
        ...current,
        [segmentId]: payload.participant.id
      }));
      setSegmentNewSpeakerNames((current) => ({ ...current, [segmentId]: "" }));
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

  function openSpeakerSplit(participantId: string) {
    setSpeakerError("");
    setSplitParticipantId(participantId);
    setSplitSegmentIds(new Set());
    setSplitDisplayName(nextAvailableSpeakerName(participants));
  }

  function closeSpeakerSplit() {
    if (isSplittingSpeaker) {
      return;
    }
    setSplitParticipantId("");
    setSplitSegmentIds(new Set());
    setSplitDisplayName("");
  }

  async function splitSpeaker() {
    if (!splitParticipantId || splitSegmentIds.size === 0) {
      setSpeakerError("Select at least one transcript turn to create a new speaker.");
      return;
    }
    setIsSplittingSpeaker(true);
    setSpeakerError("");
    try {
      const accessToken = await getAccessToken();
      const response = await fetch(
        `${apiBaseUrl}/v1/meetings/${meetingId}/participants/${splitParticipantId}/split`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            segment_ids: [...splitSegmentIds],
            display_name: splitDisplayName.trim() || null
          })
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail ?? "Unable to split speaker.");
      }
      setSplitUndo({
        originalParticipantId: splitParticipantId,
        newParticipantId: payload.participant.id
      });
      setSplitParticipantId("");
      setSplitSegmentIds(new Set());
      setSplitDisplayName("");
      await refreshMeetingData();
    } catch (splitError) {
      setSpeakerError(
        splitError instanceof Error ? splitError.message : "Unable to split speaker."
      );
    } finally {
      setIsSplittingSpeaker(false);
    }
  }

  async function undoSpeakerSplit() {
    if (!splitUndo) {
      return;
    }
    setIsSplittingSpeaker(true);
    setSpeakerError("");
    try {
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
            source_participant_id: splitUndo.newParticipantId,
            target_participant_id: splitUndo.originalParticipantId
          })
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to undo speaker split.");
      }
      setSplitUndo(null);
      await refreshMeetingData();
    } catch (undoError) {
      setSpeakerError(
        undoError instanceof Error
          ? undoError.message
          : "Unable to undo speaker split."
      );
    } finally {
      setIsSplittingSpeaker(false);
    }
  }

  function openSegmentSplit(segment: TranscriptSegment) {
    setSpeakerError("");
    setSegmentSplitMessage("");
    setSegmentSplitRefreshWarning("");
    setSegmentSplitId(segment.id);
    setSegmentSplitOffset(null);
    setSegmentSplitAssignments([]);
  }

  function closeSegmentSplit() {
    if (isSplittingSegment) {
      return;
    }
    setSegmentSplitId("");
    setSegmentSplitOffset(null);
    setSegmentSplitAssignments([]);
  }

  function chooseSegmentSplitBoundary(
    segment: TranscriptSegment,
    offset: number
  ) {
    const defaultParticipantId =
      segment.participant_id ??
      participants.find(
        (participant) =>
          participant.speaker_label === "Unknown Speaker" ||
          participant.display_name === "Unknown Speaker"
      )?.id ??
      "";
    setSegmentSplitOffset(offset);
    setSegmentSplitAssignments([
      { participantId: defaultParticipantId, displayName: "" },
      { participantId: defaultParticipantId, displayName: "" }
    ]);
  }

  async function saveSegmentSplit() {
    const segment = transcriptSegments.find((item) => item.id === segmentSplitId);
    if (!segment || segmentSplitOffset === null) {
      return;
    }
    const parts = buildTranscriptSplitParts(segment.text, [segmentSplitOffset]);
    if (!splitCanBeSaved(parts, segmentSplitAssignments)) {
      setSpeakerError("Choose a valid boundary and speaker for every part.");
      return;
    }

    setIsSplittingSegment(true);
    setSpeakerError("");
    setSegmentSplitMessage("");
    setSegmentSplitRefreshWarning("");
    if (process.env.NODE_ENV === "development") {
      console.log("[split] save clicked", { originalSegmentId: segment.id });
    }
    try {
      const accessToken = await getAccessToken();
      const splitRequestUrl = `${apiBaseUrl}/v1/meetings/${meetingId}/transcript-segments/${segment.id}/split`;
      if (process.env.NODE_ENV === "development") {
        console.log("[split] request url", splitRequestUrl);
      }
      const response = await fetch(
        splitRequestUrl,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            parts: parts.map((text, index) => ({
              text,
              participant_id:
                segmentSplitAssignments[index].participantId || null,
              display_name:
                segmentSplitAssignments[index].displayName.trim() || null
            }))
          })
        }
      );
      let payload: TranscriptSegmentSplitResponse | { detail?: string } | null = null;
      if (response.status !== 204) {
        const responseBody = await response.text();
        if (responseBody) {
          try {
            payload = JSON.parse(responseBody) as
              | TranscriptSegmentSplitResponse
              | { detail?: string };
          } catch {
            payload = null;
          }
        }
      }
      const returnedPayload =
        payload &&
        "segments" in payload &&
        Array.isArray(payload.segments) &&
        payload.segments.length >= 2 &&
        payload.original_segment_id === segment.id
          ? payload
          : null;
      if (process.env.NODE_ENV === "development") {
        console.log("[split] response status", response.status);
        console.log("[split] response ok", response.ok);
        console.log("[split] response payload keys", Object.keys(payload ?? {}));
      }
      if (!response.ok) {
        throw new Error(
          payload && "detail" in payload && payload.detail
            ? payload.detail
            : "Unable to split transcript segment."
        );
      }
      if (process.env.NODE_ENV === "development") {
        console.log("[split] success branch entered");
      }

      let firstCreatedSegmentId = "";
      const needsSecondaryRefresh =
        !returnedPayload ||
        segmentSplitAssignments.some((assignment) => assignment.displayName.trim()) &&
        !returnedPayload?.participants?.length;
      if (returnedPayload) {
        if (process.env.NODE_ENV === "development") {
          console.log("[split] transcript refresh started", {
            source: "split response"
          });
        }
        const updatedSegments = replaceTranscriptSegment(
          transcriptSegments,
          segment.id,
          returnedPayload.segments
        );
        if (
          updatedSegments.some((item) => item.id === segment.id) ||
          returnedPayload.segments.some(
            (item) => !updatedSegments.some((row) => row.id === item.id)
          )
        ) {
          throw new Error("The saved split could not be applied to the transcript.");
        }
        setTranscriptSegments(updatedSegments);
        setMeeting((current) =>
          current
            ? { ...current, analysis_stale: returnedPayload.analysis_stale }
            : current
        );
        if (returnedPayload.participants?.length) {
          setParticipants((current) => {
            const byId = new Map(
              current.map((participant) => [participant.id, participant])
            );
            returnedPayload.participants?.forEach((participant) => {
              byId.set(participant.id, participant);
            });
            return [...byId.values()].sort((left, right) =>
              left.created_at.localeCompare(right.created_at)
            );
          });
        }
        firstCreatedSegmentId = returnedPayload.segments[0]?.id ?? "";
        if (process.env.NODE_ENV === "development") {
          console.log("[split] transcript refresh finished", {
            source: "split response",
            returnedNewSegmentIds: returnedPayload.segments.map((item) => item.id)
          });
        }
      }

      if (process.env.NODE_ENV === "development") {
        console.log("[split] closing editor", { originalSegmentId: segment.id });
      }
      setSegmentSplitId("");
      setSegmentSplitOffset(null);
      setSegmentSplitAssignments([]);
      setIsSplittingSegment(false);
      setSegmentSplitMessage("Segment split saved");

      if (needsSecondaryRefresh) {
        if (process.env.NODE_ENV === "development") {
          console.log("[split] transcript refresh started", {
            source: "supabase refetch"
          });
        }
        try {
          const priorSegmentIds = new Set(transcriptSegments.map((item) => item.id));
          const refreshed = await refreshMeetingData();
          const replacementSegments = refreshed.transcriptSegments
            .filter(
              (item) =>
                !priorSegmentIds.has(item.id) &&
                item.segment_index >= segment.segment_index &&
                item.segment_index < segment.segment_index + parts.length
            )
            .sort(
              (left, right) =>
                left.segment_index - right.segment_index || left.start_ms - right.start_ms
            );
          if (
            refreshed.transcriptSegments.some((item) => item.id === segment.id) ||
            replacementSegments.length < parts.length
          ) {
            throw new Error("The refreshed transcript is not available yet.");
          }
          firstCreatedSegmentId = replacementSegments[0]?.id ?? firstCreatedSegmentId;
          if (process.env.NODE_ENV === "development") {
            console.log("[split] transcript refresh finished", {
              source: "supabase refetch",
              returnedNewSegmentIds: replacementSegments.map((item) => item.id)
            });
          }
        } catch (refreshError) {
          setSegmentSplitRefreshWarning(
            "Segment split saved, but the transcript could not refresh. Refresh the page to load the latest transcript."
          );
          if (process.env.NODE_ENV === "development") {
            console.warn("[split] transcript refresh failed", {
              message:
                refreshError instanceof Error
                  ? refreshError.message
                  : "Unknown refresh error"
            });
          }
        }
      }

      requestAnimationFrame(() => {
        const firstCreatedSegment = firstCreatedSegmentId
          ? document.getElementById(`transcript-segment-${firstCreatedSegmentId}`)
          : null;
        firstCreatedSegment?.scrollIntoView({ behavior: "smooth", block: "center" });
        firstCreatedSegment?.focus({ preventScroll: true });
        if (
          process.env.NODE_ENV === "development" &&
          document.querySelector(`[data-split-editor-id="${segment.id}"]`)
        ) {
          console.error("BUG: split editor remained open after successful save");
        }
      });
    } catch (splitError) {
      setSpeakerError(
        splitError instanceof Error
          ? splitError.message
          : "Unable to split transcript segment."
      );
    } finally {
      setIsSplittingSegment(false);
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

  const isProcessingActive = meeting.status === "processing";
  const isMeetingTranscribing =
    isTranscribing ||
    meeting.status === "processing" && activeJobType !== "analysis";
  const isMeetingAnalyzing =
    shouldShowAnalyzing(analysisJob?.status);
  const analysisFailed = analysisJob?.status === "failed";
  const hasCompletedAnalysis =
    !analysisFailed &&
    (analysisJob?.status === "analyzed" || Boolean(meeting.summary || meeting.brief));
  const canAnalyze = canStartAnalysis({
    transcriptSegmentCount: transcriptSegments.length,
    ownsMeeting: isOwnedMeeting,
    analysisStatus: analysisJob?.status,
    hasCompletedInsights: Boolean(meeting.summary || meeting.brief),
    requestPending: isRequestingAnalysis
  });
  const analysisButtonLabel =
    isMeetingAnalyzing
      ? "Analyzing…"
      : Boolean(analysisError) || analysisFailed
      ? "Retry Analysis"
      : isRequestingAnalysis
        ? "Starting analysis..."
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
  const transcriptStatsByParticipant =
    transcriptSpeakerStats(transcriptSegments);
  const speakerStats = participants.map((participant, index) => {
    const participantStats = transcriptStatsByParticipant[participant.id] ?? {
      segmentCount: 0,
      speakingMs: 0
    };
    const speakingMs = participantStats.speakingMs;

    return {
      ...participant,
      fallbackName: fallbackSpeakerName(index),
      segmentCount: participantStats.segmentCount,
      speakingMs,
      conversationPercent:
        totalSpeakingMs > 0 ? Math.round((speakingMs / totalSpeakingMs) * 100) : 0
    };
  });
  const detectedSpeakerCount = countDetectedSpeakers(
    speakerStats.map((speaker) => speaker.speaker_label)
  );
  const hasUnassignedSpeech = speakerStats.some(
    (speaker) => speaker.speaker_label === "Unknown Speaker"
  );
  const splitTurns = splitParticipantId
    ? selectedSpeakerTurns(transcriptSegments, splitParticipantId)
    : [];
  const segmentBeingSplit = transcriptSegments.find(
    (segment) => segment.id === segmentSplitId
  );
  const segmentSplitBoundaries = segmentBeingSplit
    ? transcriptWordBoundaries(segmentBeingSplit.text)
    : [];
  const segmentSplitParts =
    segmentBeingSplit && segmentSplitOffset !== null
      ? buildTranscriptSplitParts(segmentBeingSplit.text, [segmentSplitOffset])
      : [];
  const processingTimeline = buildProcessingTimeline(meeting, processingEvents);
  const latestTranscriptionEvent = [...processingEvents]
    .reverse()
    .find(
      (event) =>
        event.job_type === "transcription" &&
        ["queued", "transcription_started", "transcription_completed", "transcription_failed"].includes(
          event.event_type
        )
    );
  const transcriptionUi = getTranscriptionUiState(
    isMeetingTranscribing
      ? "transcribing"
      : transcriptionError
        ? "failed"
        : latestTranscriptionEvent?.event_type === "transcription_completed"
          ? "transcribed"
          : null,
    transcriptionError,
    transcriptSegments.length > 0
  );

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

      <section
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        id="meeting-overview"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-meadow">
              {formatDate(meeting.scheduled_at ?? meeting.created_at)}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">
              {meeting.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {meeting.description || "No description provided."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MeetingExportDialog
              meetingId={meetingId}
              meetingTitle={meeting.title}
              apiBaseUrl={apiBaseUrl}
              accessToken={getAccessToken}
              englishTranslationAvailable={Boolean(
                meeting.translation_language === "english" ||
                meeting.summary_translated || meeting.brief_translated ||
                transcriptSegments.some((segment) => segment.translated_text)
              )}
              availability={{
                meeting_details: true,
                executive_summary: Boolean(meeting.summary),
                meeting_brief: Boolean(meeting.brief),
                speakers: participants.length > 0,
                transcript: transcriptSegments.length > 0,
                timestamps: transcriptSegments.length > 0,
                action_items: actionItems.length > 0,
                decisions: decisions.length > 0,
                questions: questions.length > 0,
                tags: true,
                processing_timeline: processingEvents.length > 0
              }}
            />
            <span className="rounded-full border border-meadow bg-emerald-50 px-3 py-1 text-xs font-medium text-meadow">
              {formatProcessingStatus(meeting.status)}
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
              {formatProcessingStatus(meeting.status)}
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
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Current Display Language
            </dt>
            <dd className="mt-1 text-sm font-semibold text-ink">
              Original ({formatLanguage(meeting.transcript_language ?? meeting.detected_language)})
              {meeting.translation_language
                ? ` · Translation target: ${formatLanguage(meeting.translation_language)}`
                : ""}
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
                <p className="mt-2 text-sm text-slate-600">Transcript output: Original language</p>
              </div>
              {transcriptionUi.showAction ? (
                <button
                  className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  type="button"
                  onClick={generateTranscript}
                  disabled={isProcessingActive}
                >
                  {transcriptionUi.actionLabel}
                </button>
              ) : null}
            </div>
            <audio className="w-full" controls src={audioUrl} />
          </div>
        ) : null}
      </section>

      <section
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        id="processing-timeline"
      >
        <div>
          <h3 className="text-lg font-semibold text-ink">Processing Timeline</h3>
          <p className="mt-1 text-sm text-slate-600">
            Follow each stage from upload through meeting intelligence.
          </p>
        </div>
        <ol className="mt-6">
          {processingTimeline.map((step, index) => {
            const presentation = timelineStatusPresentation[step.status];

            return (
              <li className="relative flex gap-4 pb-6 last:pb-0" key={step.key}>
                {index < processingTimeline.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className={`absolute left-[0.6875rem] top-6 h-[calc(100%-0.5rem)] w-0.5 ${presentation.connectorClass}`}
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${presentation.markerClass}`}
                >
                  {presentation.marker ?? index + 1}
                </span>
                <div
                  className={`min-w-0 flex-1 rounded-lg border p-4 ${presentation.cardClass}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-ink">{step.label}</h4>
                      <p className="mt-1 text-sm text-slate-600">{step.description}</p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${presentation.badgeClass}`}
                    >
                      {presentation.label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatTimelineTimestamp(step.timestamp)}
                  </p>
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

      <section
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        id="meeting-intelligence"
      >
        {translationError ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{translationError}</div>
        ) : null}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink">
              Meeting Intelligence
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {isMeetingAnalyzing
                ? "Analysis is queued or processing."
                : meeting.status === "completed"
                  ? "AI-generated summary and structured meeting records."
                  : "Generate analysis after the transcript is ready."}
            </p>
          </div>
          {!hasCompletedAnalysis ? (
            <button
              className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              type="button"
              onClick={generateAnalysis}
              disabled={isMeetingAnalyzing || !canAnalyze}
            >
              {analysisButtonLabel}
            </button>
          ) : null}
        </div>

        {meeting.analysis_stale ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Analysis may be outdated because the transcript was edited.
          </div>
        ) : null}

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
            <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-ink">Executive Summary</h4>{translationButton("summary")}</div>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {(englishSections.has("summary") ? meeting.summary_translated : meeting.summary) || "No summary has been generated yet."}
            </p>
          </article>

          <article className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-ink">Meeting Brief</h4>{translationButton("brief")}</div>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {(englishSections.has("brief") ? meeting.brief_translated : meeting.brief) || "No brief has been generated yet."}
            </p>
          </article>
        </div>
      </section>

      <section
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        id="participants"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink">Speakers</h3>
            <p className="mt-1 text-sm text-slate-600">
              {speakerStats.length > 0
                ? `${detectedSpeakerCount} speaker${detectedSpeakerCount === 1 ? "" : "s"} detected`
                : "No speakers have been identified yet."}
            </p>
            {hasUnassignedSpeech ? (
              <p className="mt-1 text-xs font-medium text-amber-700">
                Some speech could not be assigned to a speaker
              </p>
            ) : null}
            <p className="mt-2 text-xs text-slate-500">
              Use Split speaker when multiple people were grouped under one detected speaker.
            </p>
          </div>
        </div>

        {speakerError ? (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {speakerError}
          </div>
        ) : null}

        {splitUndo ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <span>Speaker split created.</span>
            <button
              className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
              type="button"
              disabled={isSplittingSpeaker}
              onClick={() => void undoSpeakerSplit()}
            >
              Undo
            </button>
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
                <button
                  className="mt-3 w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                  type="button"
                  disabled={isSplittingSpeaker || speaker.segmentCount === 0}
                  onClick={() => openSpeakerSplit(speaker.id)}
                >
                  Split speaker
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {splitParticipantId ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-ink">Split speaker</h3>
            <p className="mt-1 text-sm text-slate-600">
              Select the transcript turns that belong to the new speaker. Unselected turns will not change.
            </p>
            <label className="mt-5 block text-sm font-medium text-ink" htmlFor="split-speaker-name">
              New speaker name
            </label>
            <input
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-ink outline-none focus:border-signal focus:ring-2 focus:ring-blue-100"
              id="split-speaker-name"
              value={splitDisplayName}
              onChange={(event) => setSplitDisplayName(event.target.value)}
            />
            <fieldset className="mt-5 grid gap-2">
              <legend className="mb-2 text-sm font-medium text-ink">Transcript turns</legend>
              {splitTurns.map((segment) => (
                <label
                  className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
                  key={segment.id}
                >
                  <input
                    checked={splitSegmentIds.has(segment.id)}
                    className="mt-1 h-4 w-4"
                    type="checkbox"
                    onChange={(event) => {
                      setSplitSegmentIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) {
                          next.add(segment.id);
                        } else {
                          next.delete(segment.id);
                        }
                        return next;
                      });
                    }}
                  />
                  <span>
                    <span className="block text-xs font-medium text-slate-500">
                      {formatTranscriptTime(segment.start_ms)}–{formatTranscriptTime(segment.end_ms)}
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-ink">
                      {displayedTranscriptText(segment, englishSections.has("transcript"))}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-slate-100 disabled:opacity-60"
                type="button"
                disabled={isSplittingSpeaker}
                onClick={closeSpeakerSplit}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                type="button"
                disabled={
                  isSplittingSpeaker ||
                  splitSegmentIds.size === 0 ||
                  !splitDisplayName.trim()
                }
                onClick={() => void splitSpeaker()}
              >
                {isSplittingSpeaker ? "Splitting…" : "Create new speaker"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {segmentBeingSplit ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          data-split-editor-id={segmentBeingSplit.id}
          role="dialog"
        >
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-ink">Split transcript segment</h3>
            <p className="mt-1 text-sm text-slate-600">
              Choose the word where the next speaker begins, preview both parts, and assign a speaker to each.
            </p>
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-ink">
              {segmentBeingSplit.text}
            </div>
            <div className="mt-4">
              <p className="text-sm font-medium text-ink">Choose a split boundary</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {segmentSplitBoundaries.map((boundary, index) => (
                  <button
                    aria-label={`Split before ${boundary.beforeWord}`}
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                      segmentSplitOffset === boundary.offset
                        ? "border-signal bg-blue-50 text-signal ring-2 ring-blue-100"
                        : "border-slate-300 bg-white text-ink hover:bg-slate-100"
                    }`}
                    data-split-boundary
                    key={`${boundary.offset}-${boundary.beforeWord}`}
                    type="button"
                    onClick={() =>
                      chooseSegmentSplitBoundary(segmentBeingSplit, boundary.offset)
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                        return;
                      }
                      event.preventDefault();
                      const buttons = Array.from(
                        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                          "button[data-split-boundary]"
                        ) ?? []
                      );
                      const nextIndex = Math.max(
                        0,
                        Math.min(
                          buttons.length - 1,
                          index + (event.key === "ArrowRight" ? 1 : -1)
                        )
                      );
                      buttons[nextIndex]?.focus();
                    }}
                  >
                    Before “{boundary.beforeWord}”
                  </button>
                ))}
              </div>
            </div>

            {segmentSplitParts.length >= 2 ? (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {segmentSplitParts.map((part, index) => {
                  const assignment = segmentSplitAssignments[index] ?? {
                    participantId: "",
                    displayName: ""
                  };
                  return (
                    <article className="rounded-lg border border-slate-200 p-4" key={`${index}-${part}`}>
                      <h4 className="text-sm font-semibold text-ink">Part {index + 1}</h4>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{part}</p>
                      <label
                        className="mt-4 block text-xs font-medium uppercase tracking-wide text-slate-500"
                        htmlFor={`split-part-speaker-${index}`}
                      >
                        Speaker for part {index + 1}
                      </label>
                      <select
                        className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-ink"
                        id={`split-part-speaker-${index}`}
                        value={assignment.participantId || "__new__"}
                        onChange={(event) => {
                          const value = event.target.value;
                          setSegmentSplitAssignments((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? value === "__new__"
                                  ? {
                                      participantId: "",
                                      displayName: nextAvailableSpeakerName(participants)
                                    }
                                  : { participantId: value, displayName: "" }
                                : item
                            )
                          );
                        }}
                      >
                        {participants.map((participant, participantIndex) => (
                          <option key={participant.id} value={participant.id}>
                            {participant.display_name || fallbackSpeakerName(participantIndex)}
                          </option>
                        ))}
                        <option value="__new__">Create a new speaker…</option>
                      </select>
                      {!assignment.participantId ? (
                        <input
                          aria-label={`New speaker name for part ${index + 1}`}
                          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-ink"
                          placeholder="New speaker name"
                          value={assignment.displayName}
                          onChange={(event) =>
                            setSegmentSplitAssignments((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, displayName: event.target.value }
                                  : item
                              )
                            )
                          }
                        />
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-slate-100 disabled:opacity-60"
                type="button"
                disabled={isSplittingSegment}
                onClick={closeSegmentSplit}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                type="button"
                disabled={
                  isSplittingSegment ||
                  !splitCanBeSaved(segmentSplitParts, segmentSplitAssignments)
                }
                onClick={() => void saveSegmentSplit()}
              >
                {isSplittingSegment ? "Saving…" : "Save Split"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        id="transcript"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3"><h3 className="text-base font-semibold text-ink">Transcript</h3>{translationButton("transcript")}</div>
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

        {transcriptionUi.showSpinner ? (
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-signal" />
          </div>
        ) : null}

        {transcriptionUi.errorMessage ? (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {transcriptionUi.errorMessage}
          </div>
        ) : null}

        {segmentSplitMessage ? (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            {segmentSplitMessage}
          </div>
        ) : null}

        {segmentSplitRefreshWarning ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <span>{segmentSplitRefreshWarning}</span>
            <button
              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100"
              type="button"
              onClick={() => window.location.reload()}
            >
              Refresh page
            </button>
          </div>
        ) : null}

        {transcriptSegments.length > 0 ? (
          <div className="mt-5 grid gap-3">
            {transcriptSegments.map((segment) => (
              <article
                className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                id={`transcript-segment-${segment.id}`}
                key={segment.id}
                tabIndex={-1}
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
                  {displayedTranscriptText(segment, englishSections.has("transcript"))}
                </p>
                <button
                  className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                  type="button"
                  disabled={
                    isSplittingSegment ||
                    transcriptWordBoundaries(segment.text).length === 0
                  }
                  onClick={() => openSegmentSplit(segment)}
                >
                  Split Segment
                </button>
                <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
                    <label
                      className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                      htmlFor={`assign-segment-${segment.id}`}
                    >
                      Change Speaker
                    </label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
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

                        if (participantId === "__unknown__") {
                          void assignSegment(segment.id, {
                            displayName: "Unknown Speaker"
                          });
                        } else if (participantId && participantId !== "__new__") {
                          void assignSegment(segment.id, { participantId });
                        }
                      }}
                    >
                      {participants.map((participant, index) => (
                        <option key={participant.id} value={participant.id}>
                          {participant.display_name || fallbackSpeakerName(index)}
                        </option>
                      ))}
                      {!participants.some(
                        (participant) =>
                          participant.display_name === "Unknown Speaker" ||
                          participant.speaker_label === "Unknown Speaker"
                      ) ? (
                        <option value="__unknown__">Unknown Speaker</option>
                      ) : null}
                      <option value="__new__">Create a new speaker…</option>
                    </select>
                    {segmentAssignTargets[segment.id] === "__new__" ? (
                      <>
                        <input
                          aria-label="New speaker name"
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-signal focus:ring-2 focus:ring-blue-100 sm:w-auto sm:flex-1"
                          disabled={isSavingSpeaker}
                          placeholder="New speaker name"
                          value={segmentNewSpeakerNames[segment.id] ?? ""}
                          onChange={(event) =>
                            setSegmentNewSpeakerNames((current) => ({
                              ...current,
                              [segment.id]: event.target.value
                            }))
                          }
                        />
                        <button
                          className="rounded-md bg-signal px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                          type="button"
                          disabled={
                            isSavingSpeaker ||
                            !(segmentNewSpeakerNames[segment.id] ?? "").trim()
                          }
                          onClick={() =>
                            void assignSegment(segment.id, {
                              displayName: segmentNewSpeakerNames[segment.id]
                            })
                          }
                        >
                          Add speaker
                        </button>
                      </>
                    ) : null}
                    </div>
                  </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          id="action-items"
        >
          <div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold text-ink">Action Items</h3>{translationButton("action_items")}</div>
          {actionItems.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {actionItems.map((item) => (
                <div
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  id={`action-item-${item.id}`}
                  key={item.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">{englishSections.has("action_items") ? item.translated_title ?? item.title : item.title}</p>
                    <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium capitalize text-slate-600">
                      {item.status.replace("_", " ")}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {englishSections.has("action_items") ? item.translated_description ?? item.description : item.description}
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

        <article
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          id="decisions"
        >
          <div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold text-ink">Decisions</h3>{translationButton("decisions")}</div>
          {decisions.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {decisions.map((decision) => (
                <div
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  id={`decision-${decision.id}`}
                  key={decision.id}
                >
                  <p className="text-sm font-semibold text-ink">
                    {englishSections.has("decisions") ? decision.translated_title ?? decision.title : decision.title}
                  </p>
                  {decision.description ? (
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {englishSections.has("decisions") ? decision.translated_description ?? decision.description : decision.description}
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

        <article
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          id="questions"
        >
          <div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold text-ink">Questions</h3>{translationButton("questions")}</div>
          {questions.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {questions.map((question) => (
                <div
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  id={`question-${question.id}`}
                  key={question.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {englishSections.has("questions") ? question.translated_question ?? question.question : question.question}
                    </p>
                    <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium capitalize text-slate-600">
                      {question.status}
                    </span>
                  </div>
                  {question.answer ? (
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {englishSections.has("questions") ? question.translated_answer ?? question.answer : question.answer}
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

      <section className="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-red-800">Danger zone</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Permanently remove this meeting and all of its associated data.
        </p>
        <button
          className="mt-4 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
          type="button"
          onClick={() => {
            setDeleteConfirmation("");
            setDeletionError("");
            setIsDeleteDialogOpen(true);
          }}
          disabled={isProcessingActive}
        >
          Delete Meeting
        </button>
        {isProcessingActive ? (
          <p className="mt-2 text-sm text-amber-700">
            Cancel active processing before deleting this meeting.
          </p>
        ) : null}
      </section>

      {isDeleteDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="presentation"
        >
          <section
            aria-labelledby="delete-meeting-title"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 shadow-xl"
            role="dialog"
          >
            <h3
              className="text-xl font-semibold text-red-800"
              id="delete-meeting-title"
            >
              Delete “{meeting.title}”?
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              This deletion is permanent and cannot be undone. It removes the
              transcript, participants, Meeting Intelligence analysis,
              processing history, attachments, and stored audio.
            </p>
            <label className="mt-5 block text-sm font-medium text-ink">
              Type <span className="font-bold">DELETE</span> to confirm
              <input
                autoComplete="off"
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </label>
            {deletionError ? (
              <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {deletionError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                type="button"
                onClick={() => setIsDeleteDialogOpen(false)}
                disabled={isDeletingMeeting}
              >
                Keep Meeting
              </button>
              <button
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                type="button"
                onClick={deleteMeeting}
                disabled={
                  isDeletingMeeting ||
                  isProcessingActive ||
                  !isMeetingDeletionConfirmed(deleteConfirmation)
                }
              >
                {isDeletingMeeting ? "Deleting…" : "Permanently Delete Meeting"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
