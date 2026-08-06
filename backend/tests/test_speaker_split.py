import asyncio
from copy import deepcopy

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import main


MEETING_ID = "11111111-1111-1111-1111-111111111111"
SOURCE_ID = "22222222-2222-2222-2222-222222222222"
SEGMENT_ONE = "33333333-3333-3333-3333-333333333333"
SEGMENT_TWO = "44444444-4444-4444-4444-444444444444"
SEGMENT_THREE = "55555555-5555-5555-5555-555555555555"
NEW_ID = "66666666-6666-6666-6666-666666666666"


class MemoryQuery:
    def __init__(self, client, table_name):
        self.client = client
        self.table_name = table_name
        self.filters = []
        self.operation = "select"
        self.values = None

    def select(self, columns):
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def in_(self, column, values):
        self.filters.append(("in", column, set(values)))
        return self

    def limit(self, value):
        return self

    def insert(self, values):
        self.operation = "insert"
        self.values = deepcopy(values)
        return self

    def update(self, values):
        self.operation = "update"
        self.values = deepcopy(values)
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def _matches(self, row):
        return all(
            row.get(column) == value
            if operation == "eq"
            else row.get(column) in value
            for operation, column, value in self.filters
        )

    def execute(self):
        rows = self.client.rows[self.table_name]
        if self.operation == "insert":
            inserted = {**self.values, "id": self.values.get("id", NEW_ID)}
            rows.append(inserted)
            return type("Response", (), {"data": [deepcopy(inserted)]})()
        matching = [row for row in rows if self._matches(row)]
        if self.operation == "update":
            for row in matching:
                row.update(self.values)
            return type("Response", (), {"data": deepcopy(matching)})()
        if self.operation == "delete":
            self.client.rows[self.table_name] = [
                row for row in rows if not self._matches(row)
            ]
            return type("Response", (), {"data": deepcopy(matching)})()
        return type("Response", (), {"data": deepcopy(matching)})()


class MemoryClient:
    def __init__(self):
        self.rows = {
            "participants": [
                {
                    "id": SOURCE_ID,
                    "meeting_id": MEETING_ID,
                    "display_name": "Speaker 1",
                    "speaker_label": "deepgram:0",
                    "metadata": {},
                }
            ],
            "transcript_segments": [
                {
                    "id": SEGMENT_ONE,
                    "meeting_id": MEETING_ID,
                    "participant_id": SOURCE_ID,
                    "speaker_label": "deepgram:0",
                    "start_ms": 0,
                    "end_ms": 1000,
                    "text": "First",
                    "original_text": "First original",
                    "translated_text": "First translated",
                    "segment_index": 0,
                },
                {
                    "id": SEGMENT_TWO,
                    "meeting_id": MEETING_ID,
                    "participant_id": SOURCE_ID,
                    "speaker_label": "deepgram:0",
                    "start_ms": 1000,
                    "end_ms": 4000,
                    "text": "Second",
                    "original_text": "Second original",
                    "translated_text": "Second translated",
                    "segment_index": 1,
                },
                {
                    "id": SEGMENT_THREE,
                    "meeting_id": MEETING_ID,
                    "participant_id": SOURCE_ID,
                    "speaker_label": "deepgram:0",
                    "start_ms": 4000,
                    "end_ms": 5000,
                    "text": "Third",
                    "original_text": "Third original",
                    "translated_text": "Third translated",
                    "segment_index": 2,
                },
            ],
        }

    def table(self, table_name):
        return MemoryQuery(self, table_name)


def authorize(monkeypatch, client):
    monkeypatch.setattr(main, "get_supabase_service_client", lambda: client)
    monkeypatch.setattr(main, "_require_bearer_token", lambda value: "token")
    monkeypatch.setattr(main, "_require_user_id", lambda value: "owner")
    monkeypatch.setattr(
        main,
        "_require_owned_meeting",
        lambda service_client, meeting_id, user_id: {"id": meeting_id},
    )


def test_split_selected_turns_creates_participant_and_preserves_content(monkeypatch):
    client = MemoryClient()
    authorize(monkeypatch, client)
    before = deepcopy(client.rows["transcript_segments"])

    response = asyncio.run(
        main.split_participant(
            MEETING_ID,
            SOURCE_ID,
            main.SplitParticipantRequest(
                segment_ids=[SEGMENT_TWO], display_name="Alex"
            ),
            authorization="Bearer token",
        )
    )

    assert response["updated_segment_count"] == 1
    assert len(client.rows["participants"]) == 2
    segments = sorted(
        client.rows["transcript_segments"], key=lambda row: row["segment_index"]
    )
    assert [row["id"] for row in segments] == [
        SEGMENT_ONE,
        SEGMENT_TWO,
        SEGMENT_THREE,
    ]
    assert [row["participant_id"] for row in segments] == [
        SOURCE_ID,
        NEW_ID,
        SOURCE_ID,
    ]
    assert segments[1]["translated_text"] == before[1]["translated_text"]
    assert segments[1]["original_text"] == before[1]["original_text"]
    assert segments[1]["text"] == before[1]["text"]
    assert sum(
        row["end_ms"] - row["start_ms"]
        for row in segments
        if row["participant_id"] == SOURCE_ID
    ) == 2000
    assert sum(
        row["end_ms"] - row["start_ms"]
        for row in segments
        if row["participant_id"] == NEW_ID
    ) == 3000


def test_split_rejects_turn_not_owned_by_source_before_creating_participant(monkeypatch):
    client = MemoryClient()
    client.rows["transcript_segments"][1]["participant_id"] = "77777777-7777-7777-7777-777777777777"
    authorize(monkeypatch, client)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            main.split_participant(
                MEETING_ID,
                SOURCE_ID,
                main.SplitParticipantRequest(segment_ids=[SEGMENT_TWO]),
                authorization="Bearer token",
            )
        )

    assert exc_info.value.status_code == 404
    assert len(client.rows["participants"]) == 1


def test_non_owner_cannot_split_speaker(monkeypatch):
    client = MemoryClient()
    authorize(monkeypatch, client)

    def deny(*args):
        raise HTTPException(status_code=404, detail="Meeting was not found.")

    monkeypatch.setattr(main, "_require_owned_meeting", deny)
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            main.split_participant(
                MEETING_ID,
                SOURCE_ID,
                main.SplitParticipantRequest(segment_ids=[SEGMENT_ONE]),
                authorization="Bearer token",
            )
        )
    assert exc_info.value.status_code == 404
    assert len(client.rows["participants"]) == 1


def test_empty_speaker_split_is_rejected_by_request_validation():
    with pytest.raises(ValidationError):
        main.SplitParticipantRequest(segment_ids=[])
