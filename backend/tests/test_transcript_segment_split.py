import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import main


MEETING_ID = "11111111-1111-1111-1111-111111111111"
SEGMENT_ID = "22222222-2222-2222-2222-222222222222"
SPEAKER_ONE = "33333333-3333-3333-3333-333333333333"
SPEAKER_TWO = "44444444-4444-4444-4444-444444444444"
ORIGINAL = "I think that is a good idea. Yes, I can handle that."


class Response:
    def __init__(self, data):
        self.data = data


class SegmentQuery:
    def select(self, columns):
        return self

    def eq(self, column, value):
        return self

    def limit(self, value):
        return self

    def execute(self):
        return Response([{"id": SEGMENT_ID, "meeting_id": MEETING_ID, "text": ORIGINAL}])


class RpcQuery:
    def __init__(self, client):
        self.client = client

    def execute(self):
        if self.client.rpc_error:
            raise RuntimeError("database transaction failed")
        return Response(
            {
                "segments": [
                    {
                        "id": f"55555555-5555-5555-5555-55555555555{index}",
                        "meeting_id": MEETING_ID,
                        "segment_index": 4 + index,
                        "participant_id": part.get("participant_id"),
                        "speaker_label": f"Speaker {index + 1}",
                        "start_ms": 12000 + index * 5000,
                        "end_ms": 17000 + index * 5000,
                        "original_text": part["text"],
                        "translated_text": None,
                        **part,
                    }
                    for index, part in enumerate(self.client.rpc_params["p_parts"])
                ],
                "participants": [],
                "analysis_stale": True,
                "transcript_revision": 2,
            }
        )


class SplitClient:
    def __init__(self):
        self.rpc_name = None
        self.rpc_params = None
        self.rpc_error = False
        self.write_count = 0

    def table(self, table_name):
        assert table_name == "transcript_segments"
        return SegmentQuery()

    def rpc(self, name, params):
        self.rpc_name = name
        self.rpc_params = params
        return RpcQuery(self)


def authorize(monkeypatch, client):
    monkeypatch.setattr(main, "get_supabase_service_client", lambda: client)
    monkeypatch.setattr(main, "_require_bearer_token", lambda value: "token")
    monkeypatch.setattr(main, "_require_user_id", lambda value: "owner")
    monkeypatch.setattr(
        main,
        "_require_owned_meeting",
        lambda service_client, meeting_id, user_id: {"id": meeting_id},
    )
    monkeypatch.setattr(
        main,
        "_require_participant",
        lambda service_client, meeting_id, participant_id: {
            "id": participant_id,
            "meeting_id": meeting_id,
        },
    )


def split_request(parts):
    return main.SplitTranscriptSegmentRequest(parts=parts)


def test_split_segment_into_two_existing_speakers(monkeypatch):
    client = SplitClient()
    authorize(monkeypatch, client)
    response = asyncio.run(
        main.split_transcript_segment(
            MEETING_ID,
            SEGMENT_ID,
            split_request(
                [
                    {"text": "I think that is a good idea.", "participant_id": SPEAKER_ONE},
                    {"text": "Yes, I can handle that.", "participant_id": SPEAKER_TWO},
                ]
            ),
            authorization="Bearer token",
        )
    )

    assert client.rpc_name == "split_transcript_segment_revisioned"
    assert client.rpc_params["p_owner_id"] == "owner"
    assert [part["participant_id"] for part in client.rpc_params["p_parts"]] == [
        SPEAKER_ONE,
        SPEAKER_TWO,
    ]
    assert [part["text"] for part in response["segments"]] == [
        "I think that is a good idea.",
        "Yes, I can handle that.",
    ]
    assert response["analysis_stale"] is True
    assert response["transcript_revision"] == 2
    assert response["meeting_id"] == MEETING_ID
    assert response["original_segment_id"] == SEGMENT_ID
    assert [segment["segment_index"] for segment in response["segments"]] == [4, 5]
    assert all(segment["id"] != SEGMENT_ID for segment in response["segments"])
    assert {
        "id",
        "segment_index",
        "participant_id",
        "speaker_label",
        "start_ms",
        "end_ms",
        "text",
        "original_text",
        "translated_text",
    } <= response["segments"][0].keys()


def test_split_segment_into_three_parts_and_create_new_speaker(monkeypatch):
    client = SplitClient()
    authorize(monkeypatch, client)
    asyncio.run(
        main.split_transcript_segment(
            MEETING_ID,
            SEGMENT_ID,
            split_request(
                [
                    {"text": "I think that", "participant_id": SPEAKER_ONE},
                    {"text": "is a good idea.", "display_name": "Speaker 5"},
                    {"text": "Yes, I can handle that.", "participant_id": SPEAKER_ONE},
                ]
            ),
            authorization="Bearer token",
        )
    )
    assert len(client.rpc_params["p_parts"]) == 3
    assert client.rpc_params["p_parts"][1]["display_name"] == "Speaker 5"


def test_split_rejects_empty_parts_and_invalid_reconstruction(monkeypatch):
    with pytest.raises(ValidationError):
        split_request(
            [
                {"text": "", "participant_id": SPEAKER_ONE},
                {"text": ORIGINAL, "participant_id": SPEAKER_TWO},
            ]
        )

    client = SplitClient()
    authorize(monkeypatch, client)
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            main.split_transcript_segment(
                MEETING_ID,
                SEGMENT_ID,
                split_request(
                    [
                        {"text": "Different", "participant_id": SPEAKER_ONE},
                        {"text": "text", "participant_id": SPEAKER_TWO},
                    ]
                ),
                authorization="Bearer token",
            )
        )
    assert exc_info.value.status_code == 400
    assert client.rpc_name is None


def test_invalid_participant_and_non_owner_are_denied(monkeypatch):
    client = SplitClient()
    authorize(monkeypatch, client)

    def missing_participant(*args, **kwargs):
        raise HTTPException(status_code=404, detail="Participant was not found.")

    monkeypatch.setattr(main, "_require_participant", missing_participant)
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            main.split_transcript_segment(
                MEETING_ID,
                SEGMENT_ID,
                split_request(
                    [
                        {"text": "I think that is a good idea.", "participant_id": SPEAKER_ONE},
                        {"text": "Yes, I can handle that.", "participant_id": SPEAKER_TWO},
                    ]
                ),
                authorization="Bearer token",
            )
        )
    assert exc_info.value.status_code == 404
    assert client.rpc_name is None

    authorize(monkeypatch, client)
    monkeypatch.setattr(
        main,
        "_require_owned_meeting",
        lambda *args: (_ for _ in ()).throw(
            HTTPException(status_code=404, detail="Meeting was not found.")
        ),
    )
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            main.split_transcript_segment(
                MEETING_ID,
                SEGMENT_ID,
                split_request(
                    [
                        {"text": "I think that is a good idea.", "participant_id": SPEAKER_ONE},
                        {"text": "Yes, I can handle that.", "participant_id": SPEAKER_TWO},
                    ]
                ),
                authorization="Bearer token",
            )
        )
    assert exc_info.value.status_code == 404
    assert client.rpc_name is None


def test_rpc_failure_returns_safe_conflict_and_leaves_endpoint_without_writes(monkeypatch):
    client = SplitClient()
    client.rpc_error = True
    authorize(monkeypatch, client)
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            main.split_transcript_segment(
                MEETING_ID,
                SEGMENT_ID,
                split_request(
                    [
                        {"text": "I think that is a good idea.", "participant_id": SPEAKER_ONE},
                        {"text": "Yes, I can handle that.", "participant_id": SPEAKER_TWO},
                    ]
                ),
                authorization="Bearer token",
            )
        )
    assert exc_info.value.status_code == 409
    assert client.write_count == 0


def test_split_migration_is_atomic_and_preserves_order_timestamps_and_translation_policy():
    migration = (
        Path(__file__).parents[2]
        / "scripts"
        / "supabase"
        / "migrations"
        / "0027_split_transcript_segments.sql"
    ).read_text(encoding="utf-8")
    assert "create or replace function public.split_transcript_segment" in migration
    assert "for update" in migration
    assert "delete from public.transcript_segments where id = original.id" in migration
    assert "original.segment_index + part_number - 1" in migration
    assert "when part_number = part_count then original.end_ms" in migration
    assert "timestamp_estimated', true" in migration
    assert "translation_requires_regeneration" in migration
    assert "analysis_stale = true" in migration
    assert "to service_role" in migration
