export function formatDuration(totalSeconds: number | null) {
  if (!totalSeconds) {
    return "0:00";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatDate(dateValue: string | null | undefined) {
  if (!dateValue) {
    return "Date unavailable";
  }

  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
      ? `${dateValue}T00:00:00`
      : dateValue
  );

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

export function getTodayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function parseExpectedSpeakerCount(value: string) {
  if (value === "auto" || value.trim() === "") {
    return null;
  }

  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error("Expected number of speakers must be between 1 and 20.");
  }

  return count;
}

export function countDetectedSpeakers(labels: Array<string | null>) {
  return labels.filter(
    (label) => label !== null && label !== "Unknown Speaker"
  ).length;
}
