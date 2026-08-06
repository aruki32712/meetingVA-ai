export type WordBoundary = {
  offset: number;
  beforeWord: string;
};

export function transcriptWordBoundaries(text: string): WordBoundary[] {
  const words = [...text.matchAll(/\S+/g)];
  return words.slice(1).map((word) => ({
    offset: word.index ?? 0,
    beforeWord: word[0]
  }));
}

export function buildTranscriptSplitParts(
  text: string,
  offsets: number[]
): string[] {
  const boundaries = [
    0,
    ...[...new Set(offsets)]
      .filter((offset) => offset > 0 && offset < text.length)
      .sort((left, right) => left - right),
    text.length
  ];
  return boundaries
    .slice(0, -1)
    .map((start, index) => text.slice(start, boundaries[index + 1]).trim());
}

export function splitCanBeSaved(
  parts: string[],
  assignments: Array<{ participantId: string; displayName: string }>
): boolean {
  return (
    parts.length >= 2 &&
    parts.every((part) => part.trim().length > 0) &&
    assignments.length === parts.length &&
    assignments.every(
      (assignment) =>
        Boolean(assignment.participantId) || Boolean(assignment.displayName.trim())
    )
  );
}
