"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { formatDate } from "./meeting-utils";
import {
  meetingSearchResultHref,
  normalizeMeetingSearchTerm,
  validateMeetingSearchTerm,
  type MeetingSearchRpcResult
} from "./meeting-search-state";

type FilterOptions = {
  participants: string[];
  tags: string[];
};

const processingStatuses = [
  "draft",
  "recording",
  "processing",
  "completed",
  "archived"
] as const;

type MeetingStatusFilter = (typeof processingStatuses)[number];

export function MeetingSearch() {
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState<MeetingStatusFilter | "">("");
  const [participant, setParticipant] = useState("");
  const [tag, setTag] = useState("");
  const [options, setOptions] = useState<FilterOptions>({
    participants: [],
    tags: []
  });
  const [results, setResults] = useState<MeetingSearchRpcResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadFilterOptions() {
      const supabase = createBrowserSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;

      if (!userId) {
        return;
      }

      const { data: meetings, error: meetingsError } = await supabase
        .from("meetings")
        .select("id")
        .eq("owner_id", userId);

      if (meetingsError) {
        throw meetingsError;
      }

      const meetingIds = (meetings ?? []).map((meeting) => meeting.id);
      const participantNames: string[] = [];

      if (meetingIds.length > 0) {
        const { data: participants, error: participantsError } = await supabase
          .from("participants")
          .select("display_name")
          .in("meeting_id", meetingIds)
          .order("display_name");

        if (participantsError) {
          throw participantsError;
        }

        participantNames.push(
          ...(participants ?? []).map((item) => item.display_name)
        );
      }

      if (isMounted) {
        setOptions({
          participants: [...new Set(participantNames)],
          tags: []
        });
      }
    }

    loadFilterOptions().catch(() => {
      // Search remains usable when optional filter suggestions cannot be loaded.
    });

    return () => {
      isMounted = false;
    };
  }, []);

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    setHasSearched(true);

    try {
      const normalizedQuery = normalizeMeetingSearchTerm(query);
      const validationError = validateMeetingSearchTerm(normalizedQuery);

      if (validationError) {
        throw new Error(validationError);
      }

      const supabase = createBrowserSupabaseClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError || !userData.user) {
        throw userError ?? new Error("You must be signed in to search meetings.");
      }

      const { data, error: searchError } = await supabase.rpc(
        "search_meetings",
        {
          search_text: normalizedQuery,
          date_from: dateFrom || null,
          date_to: dateTo || null,
          status_filter: status || null,
          participant_filter: participant.trim() || null,
          tag_filter: tag.trim() || null,
          result_limit: 50
        }
      );

      if (searchError) {
        throw searchError;
      }

      setResults((data ?? []) as MeetingSearchRpcResult[]);
    } catch (searchError) {
      setResults([]);
      setError(
        searchError instanceof Error
          ? searchError.message
          : typeof searchError === "object" &&
              searchError !== null &&
              "message" in searchError &&
              typeof searchError.message === "string"
            ? searchError.message
            : "Unable to search meetings."
      );
    } finally {
      setIsLoading(false);
    }
  }

  function clearSearch() {
    setQuery("");
    setDateFrom("");
    setDateTo("");
    setStatus("");
    setParticipant("");
    setTag("");
    setResults([]);
    setHasSearched(false);
    setError("");
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-meadow">Meeting library</p>
        <h2 className="mt-2 text-2xl font-semibold text-ink">Search meetings</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Search titles, descriptions, transcripts, summaries, briefs, action
          items, decisions, questions, participants, and tags.
        </p>

        <form className="mt-6 space-y-5" onSubmit={runSearch}>
          <div>
            <label className="text-sm font-medium text-ink" htmlFor="search-query">
              Search
            </label>
            <input
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-ink outline-none transition focus:border-signal focus:ring-2 focus:ring-blue-100"
              id="search-query"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try a topic, decision, speaker, or action item"
              type="search"
              value={query}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <FilterField label="From" htmlFor="date-from">
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                id="date-from"
                onChange={(event) => setDateFrom(event.target.value)}
                type="date"
                value={dateFrom}
              />
            </FilterField>
            <FilterField label="To" htmlFor="date-to">
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                id="date-to"
                min={dateFrom || undefined}
                onChange={(event) => setDateTo(event.target.value)}
                type="date"
                value={dateTo}
              />
            </FilterField>
            <FilterField label="Status" htmlFor="status-filter">
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                id="status-filter"
                onChange={(event) =>
                  setStatus(event.target.value as MeetingStatusFilter | "")
                }
                value={status}
              >
                <option value="">Any status</option>
                {processingStatuses.map((item) => (
                  <option key={item} value={item}>
                    {item.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Participant" htmlFor="participant-filter">
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                id="participant-filter"
                list="participant-options"
                onChange={(event) => setParticipant(event.target.value)}
                placeholder="Any participant"
                value={participant}
              />
              <datalist id="participant-options">
                {options.participants.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </FilterField>
            <FilterField label="Tag" htmlFor="tag-filter">
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                id="tag-filter"
                list="tag-options"
                onChange={(event) => setTag(event.target.value)}
                placeholder="Any tag"
                value={tag}
              />
              <datalist id="tag-options">
                {options.tags.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </FilterField>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLoading}
              type="submit"
            >
              {isLoading ? "Searching..." : "Search"}
            </button>
            <button
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-ink"
              onClick={clearSearch}
              type="button"
            >
              Clear
            </button>
          </div>
        </form>
      </section>

      {error ? (
        <section
          className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700"
          role="alert"
        >
          <h3 className="font-semibold">Search failed</h3>
          <p className="mt-1">{error}</p>
        </section>
      ) : null}

      {isLoading ? (
        <section
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
          aria-live="polite"
        >
          <p className="text-sm text-slate-600">Searching your meetings...</p>
        </section>
      ) : null}

      {!isLoading && !error && !hasSearched ? (
        <SearchMessage
          title="Find anything from your meetings"
          body="Enter a search term or use one or more filters to explore your saved meetings."
        />
      ) : null}

      {!isLoading && !error && hasSearched && results.length === 0 ? (
        <SearchMessage
          title="No matching meetings found"
          body="Try a broader search term, remove a filter, or choose a wider date range."
        />
      ) : null}

      {!isLoading && !error && results.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h3 className="font-semibold text-ink">
              {results.length} {results.length === 1 ? "result" : "results"}
            </h3>
          </div>
          <ul className="divide-y divide-slate-200">
            {results.map((result) => (
              <li className="p-6" key={result.meeting_id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <Link
                      className="text-lg font-semibold text-signal hover:text-ink"
                      href={meetingSearchResultHref(result)}
                    >
                      {result.meeting_title}
                    </Link>
                    <p className="mt-1 text-sm text-slate-500">
                      {formatDate(result.scheduled_at ?? "")}
                    </p>
                  </div>
                  <span className="w-fit rounded-full border border-meadow bg-emerald-50 px-3 py-1 text-xs font-medium capitalize text-meadow">
                    {result.meeting_status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-signal">
                    {result.match_type}
                  </span>
                  {result.additional_match_types.map((matchType) => (
                    <span
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600"
                      key={matchType}
                    >
                      Also: {matchType}
                    </span>
                  ))}
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-700">
                  {renderHighlightedExcerpt(result.matching_excerpt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function FilterField({
  children,
  htmlFor,
  label
}: {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-ink" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

function SearchMessage({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
    </section>
  );
}

function renderHighlightedExcerpt(excerpt: string) {
  let isHighlighted = false;

  return excerpt.split(/(<mark>|<\/mark>)/).map((part, index) => {
    if (part === "<mark>") {
      isHighlighted = true;
      return null;
    }

    if (part === "</mark>") {
      isHighlighted = false;
      return null;
    }

    return isHighlighted ? (
      <mark
        className="rounded-sm bg-amber-200 px-0.5 text-ink"
        key={`${part}-${index}`}
      >
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    );
  });
}
