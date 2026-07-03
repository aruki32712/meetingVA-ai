"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  tags: string[];
};

const futureFeatures = [
  "Transcript",
  "Summary",
  "Action Items",
  "Decisions",
  "Questions"
];

export function MeetingDetail({ meetingId }: { meetingId: string }) {
  const [meeting, setMeeting] = useState<MeetingDetailRow | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadMeeting() {
      const supabase = createBrowserSupabaseClient();
      const { data, error: meetingError } = await supabase
        .from("meetings")
        .select(
          "id,title,description,meeting_date,audio_storage_path,duration_seconds,processing_status,tags"
        )
        .eq("id", meetingId)
        .single();

      if (meetingError) {
        throw meetingError;
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

      return { meeting: data, audioUrl: signedAudioUrl };
    }

    async function hydrate() {
      setIsLoading(true);
      setError("");

      try {
        const result = await loadMeeting();

        if (isMounted) {
          setMeeting(result.meeting);
          setAudioUrl(result.audioUrl);
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
  }, [meetingId]);

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
          <div className="mt-6">
            <p className="mb-2 text-sm font-medium text-ink">Audio Player</p>
            <audio className="w-full" controls src={audioUrl} />
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {futureFeatures.map((feature) => (
          <article
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
            key={feature}
          >
            <h3 className="text-base font-semibold text-ink">{feature}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Waiting for AI processing.
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}
