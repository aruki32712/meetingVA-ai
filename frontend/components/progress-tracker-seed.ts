export type SeededProgressStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "complete";

export type SeededProgressPhase = {
  title: string;
  description: string;
  status: SeededProgressStatus;
  createdAt: string;
  checklistItems: Array<{ label: string; isComplete: boolean }>;
};

export const CURRENT_ROADMAP_LABELS = [
  "Platform Foundation",
  "Meeting Capture",
  "Transcription Pipeline",
  "Meeting Intelligence",
  "Speaker Experience",
  "Product Experience"
] as const;

type RoadmapLabel = (typeof CURRENT_ROADMAP_LABELS)[number];

const roadmapSeedContent: Record<
  RoadmapLabel,
  { description: string; checklistItems: string[] }
> = {
  "Platform Foundation": {
    description: "Secure account access and user-owned MeetingVA data.",
    checklistItems: ["Authentication"]
  },
  "Meeting Capture": {
    description: "Create, record, store, and safely remove meetings.",
    checklistItems: ["Meeting creation", "Audio upload", "Delete meeting"]
  },
  "Transcription Pipeline": {
    description: "Automatically process uploaded audio into a transcript.",
    checklistItems: [
      "Automatic transcription",
      "Processing timeline",
      "OpenAI transcription"
    ]
  },
  "Meeting Intelligence": {
    description: "Generate structured insights from completed transcripts.",
    checklistItems: [
      "Analysis",
      "Executive summary",
      "Meeting brief",
      "Action items",
      "Decisions",
      "Questions"
    ]
  },
  "Speaker Experience": {
    description: "Present stable speaker turns without fabricated identities.",
    checklistItems: ["Speaker handling", "Diarization"]
  },
  "Product Experience": {
    description: "Polish the end-to-end MeetingVA user experience.",
    checklistItems: ["UI polish"]
  }
};

export function buildProgressTrackerSeed(
  currentStage: RoadmapLabel | null = null,
  seededAt = new Date()
): SeededProgressPhase[] {
  const currentIndex = currentStage
    ? CURRENT_ROADMAP_LABELS.indexOf(currentStage)
    : -1;
  const firstTimestamp =
    seededAt.getTime() - (CURRENT_ROADMAP_LABELS.length - 1) * 60_000;

  return CURRENT_ROADMAP_LABELS.map((title, index) => {
    const isCompleted = currentStage === null || index < currentIndex;
    const isCurrent = index === currentIndex;
    const content = roadmapSeedContent[title];

    return {
      title,
      description: content.description,
      status: isCompleted
        ? "complete"
        : isCurrent
          ? "in_progress"
          : "not_started",
      createdAt: new Date(firstTimestamp + index * 60_000).toISOString(),
      checklistItems: content.checklistItems.map((label) => ({
        label,
        isComplete: isCompleted
      }))
    };
  });
}
