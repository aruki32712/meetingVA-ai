// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { MeetingDetail } from "../components/meeting-detail";

const originalSegment = {
  id: "original-segment",
  participant_id: "participant-1",
  speaker_label: "Speaker 1",
  start_ms: 0,
  end_ms: 10000,
  text: "First speaker words. Yes second speaker words.",
  original_text: null,
  translated_text: null,
  transcript_kind: "original" as const,
  segment_index: 0
};

const replacements = [
  { ...originalSegment, id: "replacement-1", end_ms: 5000, text: "First speaker words." },
  {
    ...originalSegment,
    id: "replacement-2",
    start_ms: 5000,
    segment_index: 1,
    text: "Yes second speaker words."
  }
];

let transcriptRows = [originalSegment];

function queryResult(table: string) {
  const meeting = {
    id: "meeting-1",
    owner_id: "user-1",
    title: "Split test",
    description: null,
    status: "completed",
    scheduled_at: null,
    audio_storage_path: null,
    duration_seconds: 10,
    summary: null,
    brief: null,
    summary_translated: null,
    brief_translated: null,
    analysis_stale: false,
    detected_language: "en",
    transcript_language: "en",
    translation_language: null,
    translation_status: "not_requested",
    translate_to_english: false,
    transcript_kind: "original",
    created_at: "2026-01-01T00:00:00Z"
  };
  const data =
    table === "meetings"
      ? meeting
      : table === "transcript_segments"
        ? transcriptRows
        : table === "participants"
          ? [
              {
                id: "participant-1",
                display_name: "Speaker 1",
                speaker_label: "Speaker 1",
                created_at: "2026-01-01T00:00:00Z"
              }
            ]
          : [];
  const result = { data, error: null };
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    single: async () => result,
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve)
  };
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      getSession: async () => ({
        data: { session: { access_token: "test-access-token" } },
        error: null
      })
    },
    from: (table: string) => queryResult(table),
    storage: { from: () => ({ createSignedUrl: vi.fn() }) }
  })
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })
}));

async function openAndConfigureSplit() {
  const user = userEvent.setup();
  render(createElement(MeetingDetail, { meetingId: "meeting-1" }));
  await screen.findByText(originalSegment.text);
  await user.click(screen.getByRole("button", { name: "Split Segment" }));
  await user.click(screen.getByRole("button", { name: "Split before Yes" }));
  return user;
}

async function expectCompletedSplit() {
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  expect(screen.queryByText(originalSegment.text)).toBeNull();
  expect(screen.getByText(replacements[0].text)).not.toBeNull();
  expect(screen.getByText(replacements[1].text)).not.toBeNull();
  expect(screen.getByText("Segment split saved")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Save Split" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
}

describe("live Split Segment editor", () => {
  beforeEach(() => {
    transcriptRows = [originalSegment];
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("a 200 response replaces the segment and closes the editor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            original_segment_id: originalSegment.id,
            segments: replacements,
            participants: [],
            analysis_stale: true
          })
      }))
    );
    const user = await openAndConfigureSplit();
    await user.click(screen.getByRole("button", { name: "Save Split" }));
    await expectCompletedSplit();
  });

  test("a 204 response refetches replacements and closes the editor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        transcriptRows = replacements;
        return { ok: true, status: 204, text: async () => "" };
      })
    );
    const user = await openAndConfigureSplit();
    await user.click(screen.getByRole("button", { name: "Save Split" }));
    await expectCompletedSplit();
  });
});
