"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { formatDate, formatDuration } from "./meeting-utils";

type MeetingRow = {
  id: string;
  title: string;
  meeting_date: string;
  duration_seconds: number | null;
  processing_status: string;
};

export function MeetingsList() {
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadMeetings() {
      const supabase = createBrowserSupabaseClient();
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const userId = sessionData.session?.user.id;

      if (!userId) {
        return [];
      }

      const { data, error: meetingsError } = await supabase
        .from("meetings")
        .select("id,title,meeting_date,duration_seconds,processing_status")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (meetingsError) {
        throw meetingsError;
      }

      return data ?? [];
    }

    async function hydrate() {
      setIsLoading(true);
      setError("");

      try {
        const loadedMeetings = await loadMeetings();

        if (isMounted) {
          setMeetings(loadedMeetings);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load meetings."
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
  }, []);

  if (isLoading) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">Loading meetings...</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-meadow">Meeting capture</p>
          <h2 className="mt-2 text-2xl font-semibold text-ink">Meetings</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            Review captured meetings and open the latest recordings.
          </p>
        </div>
        <Link
          className="inline-flex rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          href="/dashboard/meetings/new"
        >
          New meeting
        </Link>
      </section>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {meetings.length === 0 ? (
          <div className="p-6">
            <h3 className="text-base font-semibold text-ink">
              No meetings yet
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Create a meeting to record audio and store meeting metadata.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Title</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Duration</th>
                  <th className="px-5 py-3">Processing Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {meetings.map((meeting) => (
                  <tr key={meeting.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 font-medium text-ink">
                      <Link
                        className="text-signal hover:text-ink"
                        href={`/dashboard/meetings/${meeting.id}`}
                      >
                        {meeting.title}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatDate(meeting.meeting_date)}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {formatDuration(meeting.duration_seconds)}
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded-full border border-meadow bg-emerald-50 px-3 py-1 text-xs font-medium capitalize text-meadow">
                        {meeting.processing_status.replace("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
