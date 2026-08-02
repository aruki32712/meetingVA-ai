export const MEETING_DELETION_CONFIRMATION = "DELETE";
export const MEETING_DELETED_NOTICE = "Meeting deleted";

export function isMeetingDeletionConfirmed(value: string) {
  return value.trim() === MEETING_DELETION_CONFIRMATION;
}

export function completeMeetingDeletion({
  clearLocalState,
  storeNotice,
  navigate
}: {
  clearLocalState: () => void;
  storeNotice: (message: string) => void;
  navigate: (path: string) => void;
}) {
  clearLocalState();
  storeNotice(MEETING_DELETED_NOTICE);
  navigate("/dashboard");
}
