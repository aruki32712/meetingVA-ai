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

type OrderedTranscriptSegment = {
  id: string;
  participant_id: string | null;
  segment_index: number;
  start_ms: number;
  end_ms: number;
};

export function replaceTranscriptSegment<T extends OrderedTranscriptSegment>(
  segments: T[],
  originalSegmentId: string,
  replacementSegments: T[]
): T[] {
  return segments
    .filter((segment) => segment.id !== originalSegmentId)
    .concat(replacementSegments)
    .sort(
      (left, right) =>
        left.segment_index - right.segment_index || left.start_ms - right.start_ms
    );
}

export function transcriptSpeakerStats(
  segments: OrderedTranscriptSegment[]
): Record<string, { segmentCount: number; speakingMs: number }> {
  return segments.reduce<Record<string, { segmentCount: number; speakingMs: number }>>(
    (stats, segment) => {
      if (!segment.participant_id) {
        return stats;
      }
      const current = stats[segment.participant_id] ?? {
        segmentCount: 0,
        speakingMs: 0
      };
      stats[segment.participant_id] = {
        segmentCount: current.segmentCount + 1,
        speakingMs:
          current.speakingMs + Math.max(0, segment.end_ms - segment.start_ms)
      };
      return stats;
    },
    {}
  );
}
