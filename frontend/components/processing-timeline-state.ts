export type TimelineEventOrder = {
  created_at: string | null;
  event_order: number;
};

export type TimelineVisualStatus =
  | "pending"
  | "current"
  | "completed"
  | "failed"
  | "cancelled";

export type TimelineStatusEvent = TimelineEventOrder & {
  status: TimelineVisualStatus;
};

export const timelineStatusPresentation = {
  pending: {
    label: "Pending",
    marker: null,
    connectorClass: "bg-slate-200",
    markerClass: "border-slate-300 bg-white text-slate-400",
    cardClass: "border-slate-200 bg-slate-50",
    badgeClass: "bg-slate-200 text-slate-600"
  },
  current: {
    label: "Current",
    marker: null,
    connectorClass: "bg-slate-200",
    markerClass: "border-blue-500 bg-blue-100 text-blue-700",
    cardClass: "border-blue-200 bg-blue-50",
    badgeClass: "bg-blue-100 text-blue-700"
  },
  completed: {
    label: "Completed",
    marker: "✓",
    connectorClass: "bg-emerald-300",
    markerClass: "border-emerald-500 bg-emerald-100 text-emerald-700",
    cardClass: "border-emerald-200 bg-emerald-50",
    badgeClass: "bg-emerald-100 text-emerald-700"
  },
  failed: {
    label: "Failed",
    marker: "!",
    connectorClass: "bg-red-300",
    markerClass: "border-red-500 bg-red-100 text-red-700",
    cardClass: "border-red-200 bg-red-50",
    badgeClass: "bg-red-100 text-red-700"
  },
  cancelled: {
    label: "Cancelled",
    marker: "×",
    connectorClass: "bg-amber-300",
    markerClass: "border-amber-500 bg-amber-100 text-amber-800",
    cardClass: "border-amber-200 bg-amber-50",
    badgeClass: "bg-amber-100 text-amber-800"
  }
} as const;

function timestamp(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function sortTimelineEventsChronologically<T extends TimelineEventOrder>(
  events: T[]
) {
  return [...events].sort((left, right) => {
    const leftTime = timestamp(left.created_at);
    const rightTime = timestamp(right.created_at);

    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    if (leftTime === null && rightTime !== null) {
      return 1;
    }

    if (leftTime !== null && rightTime === null) {
      return -1;
    }

    return left.event_order - right.event_order;
  });
}

export function normalizeTimelineVisualStates<T extends TimelineStatusEvent>(
  events: T[]
): T[] {
  const ordered = sortTimelineEventsChronologically(events);
  const latestProgressedIndex = ordered.findLastIndex(
    (event) => event.status !== "pending"
  );
  const currentIndex =
    latestProgressedIndex >= 0 &&
    ordered[latestProgressedIndex].status === "current"
      ? latestProgressedIndex
      : -1;

  return ordered.map((event, index) => ({
    ...event,
    status:
      event.status === "current" && index !== currentIndex
        ? "completed"
        : event.status
  }));
}
