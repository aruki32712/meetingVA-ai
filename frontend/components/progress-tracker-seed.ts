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

export const CURRENT_WORKFLOW_LABELS = [
  "Meeting Created",
  "Audio Uploaded",
  "Queued (Transcription)",
  "Transcribing",
  "Transcript Complete",
  "Queued (Analysis)",
  "Analyzing",
  "Analysis Complete"
] as const;

type WorkflowLabel = (typeof CURRENT_WORKFLOW_LABELS)[number];

const workflowSeedContent: Record<
  WorkflowLabel,
  { description: string; checklistItems: string[] }
> = {
  "Meeting Created": {
    description: "The authenticated owner created the meeting record.",
    checklistItems: ["Meeting record created", "Meeting ownership recorded"]
  },
  "Audio Uploaded": {
    description: "The meeting audio was uploaded to secure storage.",
    checklistItems: ["Audio upload completed", "Audio storage path saved"]
  },
  "Queued (Transcription)": {
    description: "A transcription processing job was accepted and queued.",
    checklistItems: ["Transcription job created", "Queued event recorded"]
  },
  Transcribing: {
    description: "The worker is transcribing and diarizing the meeting audio.",
    checklistItems: ["Worker started", "Audio processing started"]
  },
  "Transcript Complete": {
    description: "Timestamped speaker turns are ready for review.",
    checklistItems: ["Transcript segments stored", "Participants attached"]
  },
  "Queued (Analysis)": {
    description: "A Meeting Intelligence analysis job was accepted and queued.",
    checklistItems: ["Analysis job created", "Queued event recorded"]
  },
  Analyzing: {
    description: "The worker is generating structured Meeting Intelligence.",
    checklistItems: ["Analysis worker started", "Transcript analysis started"]
  },
  "Analysis Complete": {
    description: "The complete Meeting Intelligence result is available.",
    checklistItems: [
      "Executive Summary",
      "Meeting Brief",
      "Action Items",
      "Decisions",
      "Questions"
    ]
  }
};

export function buildProgressTrackerSeed(
  currentStage: WorkflowLabel | null = null,
  seededAt = new Date()
): SeededProgressPhase[] {
  const currentIndex = currentStage
    ? CURRENT_WORKFLOW_LABELS.indexOf(currentStage)
    : -1;
  const firstTimestamp =
    seededAt.getTime() - (CURRENT_WORKFLOW_LABELS.length - 1) * 60_000;

  return CURRENT_WORKFLOW_LABELS.map((title, index) => {
    const isCompleted = currentStage === null || index < currentIndex;
    const isCurrent = index === currentIndex;
    const content = workflowSeedContent[title];

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
