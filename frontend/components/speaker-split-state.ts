export type SpeakerSplitSegment = {
  id: string;
  participant_id: string | null;
  start_ms: number;
  end_ms: number;
  segment_index: number;
};

export function nextAvailableSpeakerName(
  participants: Array<{ display_name: string }>
): string {
  const names = new Set(
    participants.map((participant) => participant.display_name.trim().toLowerCase())
  );
  let speakerNumber = 1;

  while (names.has(`speaker ${speakerNumber}`)) {
    speakerNumber += 1;
  }

  return `Speaker ${speakerNumber}`;
}

export function selectedSpeakerTurns<T extends SpeakerSplitSegment>(
  segments: T[],
  participantId: string
): T[] {
  return segments
    .filter((segment) => segment.participant_id === participantId)
    .sort((left, right) => left.segment_index - right.segment_index);
}

export function calculateSpeakerStatistics(
  segments: SpeakerSplitSegment[],
  participantIds: string[]
): Record<string, { segmentCount: number; speakingMs: number; percentage: number }> {
  const totalSpeakingMs = segments.reduce(
    (total, segment) => total + Math.max(0, segment.end_ms - segment.start_ms),
    0
  );

  return Object.fromEntries(
    participantIds.map((participantId) => {
      const participantSegments = segments.filter(
        (segment) => segment.participant_id === participantId
      );
      const speakingMs = participantSegments.reduce(
        (total, segment) => total + Math.max(0, segment.end_ms - segment.start_ms),
        0
      );
      return [
        participantId,
        {
          segmentCount: participantSegments.length,
          speakingMs,
          percentage:
            totalSpeakingMs > 0
              ? Math.round((speakingMs / totalSpeakingMs) * 100)
              : 0
        }
      ];
    })
  );
}
