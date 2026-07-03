"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { formatDuration, getTodayInputValue, parseTags } from "./meeting-utils";

type RecordingStatus =
  | "idle"
  | "recording"
  | "paused"
  | "stopped"
  | "unsupported"
  | "error";

function getSupportedMimeType() {
  const options = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];

  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return options.find((option) => MediaRecorder.isTypeSupported(option)) ?? "";
}

function getFileExtension(mimeType: string) {
  if (mimeType.includes("mp4")) {
    return "mp4";
  }

  if (mimeType.includes("ogg")) {
    return "ogg";
  }

  return "webm";
}

export function NewMeetingRecorder() {
  const router = useRouter();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const discardRecordingRef = useRef(false);
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(getTodayInputValue());
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus>("idle");
  const [recordingError, setRecordingError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saveStatus, setSaveStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const statusLabel = useMemo(() => {
    switch (recordingStatus) {
      case "recording":
        return "Recording";
      case "paused":
        return "Paused";
      case "stopped":
        return "Recording ready";
      case "unsupported":
        return "Unsupported browser";
      case "error":
        return "Recording error";
      case "idle":
        return "Ready";
    }
  }, [recordingStatus]);

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setRecordingStatus("unsupported");
      setRecordingError("This browser does not support audio recording.");
    }
  }, []);

  useEffect(() => {
    if (recordingStatus !== "recording") {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [recordingStatus]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());

      if (playbackUrl) {
        URL.revokeObjectURL(playbackUrl);
      }
    };
  }, [playbackUrl]);

  async function startRecording() {
    setRecordingError("");
    setSaveError("");
    setSaveStatus("");
    setRecordingBlob(null);
    setUploadProgress(0);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setRecordingStatus("unsupported");
      setRecordingError("This browser does not support audio recording.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );

      discardRecordingRef.current = false;
      chunksRef.current = [];
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      setElapsedSeconds(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setRecordingStatus("error");
        setRecordingError("The recorder reported an audio capture error.");
      };

      recorder.onstop = () => {
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          chunksRef.current = [];
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const audioBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm"
        });

        if (playbackUrl) {
          URL.revokeObjectURL(playbackUrl);
        }

        setRecordingBlob(audioBlob);
        setPlaybackUrl(URL.createObjectURL(audioBlob));
        setRecordingStatus("stopped");
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setRecordingStatus("recording");
    } catch (error) {
      setRecordingStatus("error");
      setRecordingError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : "Unable to start audio recording."
      );
    }
  }

  function pauseRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setRecordingStatus("paused");
    }
  }

  function resumeRecording() {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setRecordingStatus("recording");
    }
  }

  function stopRecording() {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      discardRecordingRef.current = true;
      mediaRecorderRef.current.stop();
    }
  }

  function deleteRecording() {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    chunksRef.current = [];
    mediaRecorderRef.current = null;
    streamRef.current = null;
    setRecordingBlob(null);
    setRecordingStatus("idle");
    setElapsedSeconds(0);
    setUploadProgress(0);
    setSaveStatus("");
    setSaveError("");

    if (playbackUrl) {
      URL.revokeObjectURL(playbackUrl);
      setPlaybackUrl("");
    }
  }

  async function saveMeeting() {
    setSaveError("");
    setSaveStatus("");

    if (!title.trim()) {
      setSaveError("Meeting title is required.");
      return;
    }

    if (!recordingBlob) {
      setSaveError("Record audio before saving this meeting.");
      return;
    }

    setIsSaving(true);
    setUploadProgress(5);

    try {
      const supabase = createBrowserSupabaseClient();
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const userId = sessionData.session?.user.id;

      if (!userId) {
        throw new Error("You must be signed in to save a meeting.");
      }

      const meetingId = crypto.randomUUID();
      const mimeType = recordingBlob.type || "audio/webm";
      const extension = getFileExtension(mimeType);
      const storagePath = `${userId}/${meetingId}/recording.${extension}`;

      setSaveStatus("Uploading recording...");
      setUploadProgress(35);

      const { error: uploadError } = await supabase.storage
        .from("meeting-audio")
        .upload(storagePath, recordingBlob, {
          contentType: mimeType,
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      setUploadProgress(75);
      setSaveStatus("Saving meeting metadata...");

      const { error: insertError } = await supabase.from("meetings").insert({
        id: meetingId,
        owner_id: userId,
        user_id: userId,
        title: title.trim(),
        description: description.trim() || null,
        meeting_date: meetingDate,
        audio_storage_path: storagePath,
        duration_seconds: elapsedSeconds,
        processing_status: "uploaded",
        status: "completed",
        source: "browser_recording",
        tags: parseTags(tags)
      });

      if (insertError) {
        throw insertError;
      }

      const { error: attachmentError } = await supabase
        .from("attachments")
        .insert({
          meeting_id: meetingId,
          uploaded_by: userId,
          kind: "audio",
          file_name: `recording.${extension}`,
          storage_bucket: "meeting-audio",
          storage_path: storagePath,
          content_type: mimeType,
          size_bytes: recordingBlob.size
        });

      if (attachmentError) {
        throw attachmentError;
      }

      setUploadProgress(100);
      setSaveStatus("Meeting saved.");
      router.push(`/dashboard/meetings/${meetingId}`);
    } catch (error) {
      setUploadProgress(0);
      setSaveError(
        error instanceof Error ? error.message : "Unable to save meeting."
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-meadow">New meeting</p>
        <h2 className="mt-2 text-2xl font-semibold text-ink">
          Capture meeting audio
        </h2>

        <div className="mt-6 grid gap-4">
          <label className="grid gap-2 text-sm font-medium text-ink">
            Meeting Title
            <input
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-signal focus:ring-2 focus:ring-blue-100"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Weekly product review"
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-ink">
            Meeting Date
            <input
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-signal focus:ring-2 focus:ring-blue-100"
              type="date"
              value={meetingDate}
              onChange={(event) => setMeetingDate(event.target.value)}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-ink">
            Description
            <textarea
              className="min-h-28 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-signal focus:ring-2 focus:ring-blue-100"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional notes about the meeting"
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-ink">
            Tags
            <input
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-signal focus:ring-2 focus:ring-blue-100"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="planning, customer, sales"
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-meadow">Recorder</p>
            <h3 className="mt-2 text-xl font-semibold text-ink">
              {formatDuration(elapsedSeconds)}
            </h3>
            <p className="mt-1 text-sm text-slate-600">{statusLabel}</p>
          </div>
          <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
            {recordingStatus}
          </span>
        </div>

        <div className="mt-6 flex h-24 items-center gap-1 rounded-lg border border-slate-200 bg-mist px-4">
          {Array.from({ length: 36 }).map((_, index) => (
            <span
              className={`w-full rounded-full ${
                recordingStatus === "recording" ? "bg-signal" : "bg-slate-300"
              }`}
              key={index}
              style={{
                height: `${18 + ((index * 13) % 48)}px`,
                opacity: recordingStatus === "recording" ? 0.45 + (index % 4) * 0.12 : 0.8
              }}
            />
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            type="button"
            onClick={startRecording}
            disabled={
              recordingStatus === "recording" ||
              recordingStatus === "paused" ||
              recordingStatus === "unsupported" ||
              isSaving
            }
          >
            Start Recording
          </button>
          <button
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-ink disabled:cursor-not-allowed disabled:text-slate-400"
            type="button"
            onClick={pauseRecording}
            disabled={recordingStatus !== "recording" || isSaving}
          >
            Pause
          </button>
          <button
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-ink disabled:cursor-not-allowed disabled:text-slate-400"
            type="button"
            onClick={resumeRecording}
            disabled={recordingStatus !== "paused" || isSaving}
          >
            Resume
          </button>
          <button
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-ink disabled:cursor-not-allowed disabled:text-slate-400"
            type="button"
            onClick={stopRecording}
            disabled={
              (recordingStatus !== "recording" &&
                recordingStatus !== "paused") ||
              isSaving
            }
          >
            Stop
          </button>
          <button
            className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:border-red-300 disabled:cursor-not-allowed disabled:text-red-300"
            type="button"
            onClick={deleteRecording}
            disabled={
              (!recordingBlob &&
                recordingStatus !== "recording" &&
                recordingStatus !== "paused") ||
              isSaving
            }
          >
            Delete Recording
          </button>
        </div>

        {recordingError ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {recordingError}
          </div>
        ) : null}

        {playbackUrl ? (
          <div className="mt-5">
            <p className="mb-2 text-sm font-medium text-ink">Audio playback</p>
            <audio className="w-full" controls src={playbackUrl} />
          </div>
        ) : null}

        <div className="mt-6 border-t border-slate-200 pt-5">
          <button
            className="rounded-md bg-meadow px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            type="button"
            onClick={saveMeeting}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Meeting"}
          </button>

          {(isSaving || uploadProgress > 0) && (
            <div className="mt-4">
              <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-meadow transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {saveStatus || `Upload progress: ${uploadProgress}%`}
              </p>
            </div>
          )}

          {saveError ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {saveError}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
