export type TimelineEventOrder = {
  created_at: string | null;
  event_order: number;
};

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
