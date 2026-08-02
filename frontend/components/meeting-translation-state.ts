export type TranslationSection =
  | "transcript"
  | "summary"
  | "brief"
  | "action_items"
  | "decisions"
  | "questions";

export function isEnglishLanguage(language: string | null | undefined) {
  return ["en", "eng", "english"].includes((language ?? "").toLowerCase());
}

export function originalTranscriptText(segment: {
  text: string;
  original_text: string | null;
}) {
  return segment.original_text ?? segment.text;
}

export function displayedTranscriptText(
  segment: { text: string; original_text: string | null; translated_text: string | null },
  showEnglish: boolean
) {
  return showEnglish
    ? segment.translated_text ?? segment.text
    : originalTranscriptText(segment);
}
