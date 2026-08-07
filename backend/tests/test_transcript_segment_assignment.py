import asyncio

from app import main


MEETING_ID = "11111111-1111-1111-1111-111111111111"
SEGMENT_ID = "22222222-2222-2222-2222-222222222222"
PARTICIPANT_ID = "33333333-3333-3333-3333-333333333333"
NEW_PARTICIPANT_ID = "44444444-4444-4444-4444-444444444444"


class Response:
    def __init__(self, data):
        self.data = data


class TranscriptQuery:
    def __init__(self, client):
        self.client = client
        self.columns = ""
        self.updates = None

    def select(self, columns):
        self.columns = columns
        return self

    def update(self, updates):
        self.updates = updates
        return self

    def eq(self, column, value):
        return self

    def in_(self, column, values):
        return self

    def order(self, column):
        return self

    def execute(self):
        if self.updates is not None:
            self.client.updates = self.updates
            return Response([{"id": SEGMENT_ID}])
        if self.columns == "id":
            return Response([{"id": SEGMENT_ID}])
        return Response(
            [
                {
                    "id": SEGMENT_ID,
                    "participant_id": self.client.updates["participant_id"],
                    "speaker_label": self.client.updates["speaker_label"],
                    "start_ms": 1000,
                    "end_ms": 2000,
                    "text": "Preserved text",
                    "original_text": "Preserved original",
                    "translated_text": "Preserved translation",
                    "transcript_kind": "both",
                    "segment_index": 7,
                }
            ]
        )


class AssignmentClient:
    def __init__(self):
        self.updates = None

    def table(self, table_name):
        assert table_name == "transcript_segments"
        return TranscriptQuery(self)


def authorize(monkeypatch, client):
    monkeypatch.setattr(main, "get_supabase_service_client", lambda: client)
    monkeypatch.setattr(main, "_require_bearer_token", lambda value: "token")
    monkeypatch.setattr(main, "_require_user_id", lambda value: "owner")
    monkeypatch.setattr(main, "_require_owned_meeting", lambda *args: {"id": MEETING_ID})


def participant(participant_id, display_name):
    return {
        "id": participant_id,
        "display_name": display_name,
        "speaker_label": display_name,
        "created_at": "2026-01-01T00:00:00Z",
    }


def test_assign_existing_speaker_returns_complete_preserved_segment(monkeypatch):
    client = AssignmentClient()
    authorize(monkeypatch, client)
    selected = participant(PARTICIPANT_ID, "Speaker 2")
    monkeypatch.setattr(main, "_require_participant", lambda *args, **kwargs: selected)

    result = asyncio.run(
        main.assign_transcript_segments(
            MEETING_ID,
            main.AssignTranscriptSegmentsRequest(
                segment_ids=[SEGMENT_ID], target_participant_id=PARTICIPANT_ID
            ),
            authorization="Bearer token",
        )
    )

    assert result["participant"] == selected
    assert result["updated_segment_count"] == 1
    assert result["segments"][0] == {
        "id": SEGMENT_ID,
        "participant_id": PARTICIPANT_ID,
        "speaker_label": "Speaker 2",
        "start_ms": 1000,
        "end_ms": 2000,
        "text": "Preserved text",
        "original_text": "Preserved original",
        "translated_text": "Preserved translation",
        "transcript_kind": "both",
        "segment_index": 7,
    }


def test_assign_new_and_unknown_speakers_creates_one_participant_each(monkeypatch):
    for display_name in ("Speaker 3", "Unknown Speaker"):
        client = AssignmentClient()
        authorize(monkeypatch, client)
        created = []

        def create_participant(*args, **kwargs):
            created.append(kwargs["display_name"])
            return participant(NEW_PARTICIPANT_ID, kwargs["display_name"])

        monkeypatch.setattr(main, "_create_participant", create_participant)
        result = asyncio.run(
            main.assign_transcript_segments(
                MEETING_ID,
                main.AssignTranscriptSegmentsRequest(
                    segment_ids=[SEGMENT_ID], display_name=display_name
                ),
                authorization="Bearer token",
            )
        )

        assert created == [display_name]
        assert result["participant"]["display_name"] == display_name
        assert result["segments"][0]["participant_id"] == NEW_PARTICIPANT_ID
