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
  tags: string[];
};

type TranscriptSegment = {
  id: string;
  speaker_label: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  segment_index: number;
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

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

function formatTranscriptTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function MeetingDetail({ meetingId }: { meetingId: string }) {
  const [meeting, setMeeting] = useState<MeetingDetailRow | null>(null);
  const [transcriptSegments, setTranscriptSegments] = useState<
    TranscriptSegment[]
  >([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [audioUrl, setAudioUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [transcriptionError, setTranscriptionError] = useState("");
  const [analysisError, setAnalysisError] = useState("");

  const loadMeeting = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data, error: meetingError } = await supabase
      .from("meetings")
      .select(
        "id,title,description,meeting_date,audio_storage_path,duration_seconds,processing_status,summary,brief,tags"
      )
      .eq("id", meetingId)
      .single();

    if (meetingError) {
      throw meetingError;
    }

    const { data: segments, error: transcriptError } = await supabase
      .from("transcript_segments")
      .select("id,speaker_label,start_ms,end_ms,text,segment_index")
      .eq("meeting_id", meetingId)
      .order("segment_index", { ascending: true });

    if (transcriptError) {
      throw transcriptError;
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
      actionItems: actionItemRows ?? [],
      decisions: decisionRows ?? [],
      questions: questionRows ?? []
    };
  }, [meetingId]);

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
          setActionItems(result.actionItems);
          setDecisions(result.decisions);
          setQuestions(result.questions);
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

  async function generateTranscript() {
    setIsTranscribing(true);
    setTranscriptionError("");

    try {
      const supabase = createBrowserSupabaseClient();
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        throw new Error("You must be signed in to generate a transcript.");
      }

      setMeeting((current) =>
        current ? { ...current, processing_status: "transcribing" } : current
      );

      const response = await fetch(
        `${apiBaseUrl}/v1/meetings/${meetingId}/transcribe`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to generate transcript.");
      }

      const result = await loadMeeting();
      setMeeting(result.meeting);
      setAudioUrl(result.audioUrl);
      setTranscriptSegments(result.transcriptSegments);
      setActionItems(result.actionItems);
      setDecisions(result.decisions);
      setQuestions(result.questions);
    } catch (transcribeError) {
      setMeeting((current) =>
        current
          ? { ...current, processing_status: "transcription_failed" }
          : current
      );
      setTranscriptionError(
        transcribeError instanceof Error
          ? transcribeError.message
          : "Unable to generate transcript."
      );
    } finally {
      setIsTranscribing(false);
    }
  }

  async function generateAnalysis() {
    setIsAnalyzing(true);
    setAnalysisError("");

    try {
      const supabase = createBrowserSupabaseClient();
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        throw new Error("You must be signed in to generate analysis.");
      }

      setMeeting((current) =>
        current ? { ...current, processing_status: "analyzing" } : current
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

      const result = await loadMeeting();
      setMeeting(result.meeting);
      setAudioUrl(result.audioUrl);
      setTranscriptSegments(result.transcriptSegments);
      setActionItems(result.actionItems);
      setDecisions(result.decisions);
      setQuestions(result.questions);
    } catch (analyzeError) {
      setMeeting((current) =>
        current ? { ...current, processing_status: "analysis_failed" } : current
      );
      setAnalysisError(
        analyzeError instanceof Error
          ? analyzeError.message
          : "Unable to generate analysis."
      );
    } finally {
      setIsAnalyzing(false);
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

  const isMeetingTranscribing =
    isTranscribing || meeting.processing_status === "transcribing";
  const isMeetingAnalyzing =
    isAnalyzing || meeting.processing_status === "analyzing";
  const canAnalyze =
    transcriptSegments.length > 0 && !isMeetingTranscribing && !isMeetingAnalyzing;

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
          <span className="rounded-full border border-meadow bg-emerald-50 px-3 py-1 text-xs font-medium capitalize text-meadow">
            {meeting.processing_status.replace("_", " ")}
          </span>
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
            <dd className="mt-1 text-sm font-semibold capitalize text-ink">
              {meeting.processing_status.replace("_", " ")}
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
              <p className="text-sm font-medium text-ink">Audio Player</p>
              <button
                className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                type="button"
                onClick={generateTranscript}
                disabled={isMeetingTranscribing}
              >
                {isMeetingTranscribing ? "Generating..." : "Generate Transcript"}
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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink">
              Meeting Intelligence
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {isMeetingAnalyzing
                ? "Analysis is in progress."
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
            {isMeetingAnalyzing ? "Analyzing..." : "Generate Analysis"}
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
                  {segment.speaker_label ? (
                    <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600">
                      {segment.speaker_label}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm leading-6 text-ink">
                  {segment.text}
                </p>
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
