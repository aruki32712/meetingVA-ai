export const EXPORT_SECTION_KEYS = [
  "meeting_details", "executive_summary", "meeting_brief", "speakers", "transcript",
  "timestamps", "action_items", "decisions", "questions", "tags", "processing_timeline"
] as const;
export type ExportSectionKey = (typeof EXPORT_SECTION_KEYS)[number];
export type ExportFormat = "pdf" | "docx" | "md" | "txt" | "json";
export type ExportSelections = Record<ExportSectionKey, boolean>;

export const DEFAULT_EXPORT_SELECTIONS: ExportSelections = {
  meeting_details: true, executive_summary: true, meeting_brief: true, speakers: false,
  transcript: true, timestamps: false, action_items: true, decisions: true, questions: true,
  tags: false, processing_timeline: false
};

export function canSubmitExport(format: string, selections: ExportSelections, running: boolean) {
  return !running && ["pdf", "docx", "md", "txt", "json"].includes(format) &&
    EXPORT_SECTION_KEYS.some((key) => key !== "timestamps" && selections[key]);
}

export function setAllAvailableSections(
  available: Partial<Record<ExportSectionKey, boolean>>,
  selected: boolean
): ExportSelections {
  return Object.fromEntries(EXPORT_SECTION_KEYS.map((key) => [key, key === "timestamps" ? selected && Boolean(available.transcript) : selected && available[key] !== false])) as ExportSelections;
}

export function tryBeginExport(guard: { current: boolean }) {
  if (guard.current) return false;
  guard.current = true;
  return true;
}

export async function requestMeetingExport(options: {
  url: string;
  token: string;
  body: unknown;
  fetcher?: typeof fetch;
}) {
  const response = await (options.fetcher ?? fetch)(options.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(options.body)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail ?? "Unable to prepare the meeting export.");
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  return {
    blob: await response.blob(),
    filename: disposition.match(/filename="([^"]+)"/)?.[1] ?? null
  };
}
