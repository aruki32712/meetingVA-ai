export const MEETING_DELETION_CONFIRMATION = "DELETE";
export const MEETING_DELETED_NOTICE = "Meeting deleted";
export const MEETING_DELETED_EVENT = "meetingva:meeting-deleted";

type DeleteResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

export function isMeetingDeletionConfirmed(value: string) {
  return value.trim() === MEETING_DELETION_CONFIRMATION;
}

export function completeMeetingDeletion({
  closeModal,
  clearLoading,
  clearLocalState,
  removeFromMeetingLists,
  storeNotice,
  navigate
}: {
  closeModal: () => void;
  clearLoading: () => void;
  clearLocalState: () => void;
  removeFromMeetingLists: () => void;
  storeNotice: (message: string) => void;
  navigate: (path: string) => void;
}) {
  closeModal();
  clearLoading();
  clearLocalState();
  removeFromMeetingLists();
  storeNotice(MEETING_DELETED_NOTICE);
  navigate("/dashboard");
}

export async function requestMeetingDeletion(
  request: () => Promise<DeleteResponse>
) {
  try {
    const response = await request();

    if (response.ok) {
      return { status: "success" as const, httpStatus: response.status };
    }

    const body = await response.text();
    let message = "Unable to delete this meeting.";

    if (body.trim()) {
      try {
        const payload = JSON.parse(body) as { detail?: unknown };
        if (typeof payload.detail === "string" && payload.detail.trim()) {
          message = payload.detail;
        }
      } catch {
        message = body;
      }
    }

    return {
      status: "http-error" as const,
      httpStatus: response.status,
      message
    };
  } catch (error) {
    return { status: "network-error" as const, error };
  }
}

export function tryBeginMeetingDeletion(guard: { current: boolean }) {
  if (guard.current) {
    return false;
  }

  guard.current = true;
  return true;
}

export function removeDeletedMeetingFromList<T extends { id: string }>(
  meetings: T[],
  deletedMeetingId: string
) {
  return meetings.filter((meeting) => meeting.id !== deletedMeetingId);
}
