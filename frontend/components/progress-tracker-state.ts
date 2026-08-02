export type ProgressChecklistCarrier = {
  checklistItems: Array<{ is_complete: boolean }>;
};

export type ProgressTrackerView = "loading" | "error" | "empty" | "ready";

export function getProgressErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }

  return "Unable to load progress tracker.";
}

export function getCompletionPercentage(
  phases: ProgressChecklistCarrier[]
) {
  const items = phases.flatMap((phase) => phase.checklistItems);

  if (items.length === 0) {
    return 0;
  }

  const completed = items.filter((item) => item.is_complete).length;
  return Math.round((completed / items.length) * 100);
}

export function getProgressTrackerView(
  isLoading: boolean,
  error: string,
  phaseCount: number
): ProgressTrackerView {
  if (isLoading) {
    return "loading";
  }

  if (error) {
    return "error";
  }

  return phaseCount === 0 ? "empty" : "ready";
}

export async function resolveProgressLoad<T>(load: () => Promise<T>) {
  try {
    return { status: "success" as const, data: await load() };
  } catch (error) {
    return {
      status: "error" as const,
      error,
      message: getProgressErrorMessage(error)
    };
  }
}
