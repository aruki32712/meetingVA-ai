export type MeetingSearchRpcResult = {
  meeting_id: string;
  meeting_title: string;
  scheduled_at: string | null;
  meeting_status: string;
  matching_excerpt: string;
  match_type: string;
  match_anchor: string | null;
  rank: number;
  additional_match_types: string[];
};

export function normalizeMeetingSearchTerm(value: string) {
  return value.trim();
}

export function validateMeetingSearchTerm(value: string) {
  const normalized = normalizeMeetingSearchTerm(value);

  if (normalized.length === 1) {
    return "Enter at least 2 characters to search meeting content.";
  }

  return "";
}

export function meetingSearchResultHref(result: MeetingSearchRpcResult) {
  const anchor = result.match_anchor?.startsWith("#")
    ? result.match_anchor
    : "";
  return `/dashboard/meetings/${result.meeting_id}${anchor}`;
}
