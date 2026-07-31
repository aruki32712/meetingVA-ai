import asyncio

from app import diarization
from app.diarization import DiarizedTurn, align_transcript_rows_to_turns
from app.main import (
    _attach_participants_to_transcript_rows,
    _build_transcript_rows,
    _merge_adjacent_speaker_segments,
)


class FakeParticipantTable:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def insert(self, rows: list[dict]) -> "FakeParticipantTable":
        self.rows = [
            {**row, "id": f"participant-{index + 1}"}
            for index, row in enumerate(rows)
        ]
        return self

    def execute(self) -> object:
        return type("Response", (), {"data": self.rows})()


class FakeSupabaseClient:
    def __init__(self) -> None:
        self.participants = FakeParticipantTable()

    def table(self, table_name: str) -> FakeParticipantTable:
        assert table_name == "participants"
        return self.participants


def _row(index: int, start_ms: int, end_ms: int, text: str) -> dict:
    return {
        "meeting_id": "meeting-id",
        "speaker_label": None,
        "start_ms": start_ms,
        "end_ms": end_ms,
        "text": text,
        "original_text": text,
        "translated_text": None,
        "transcript_kind": "original",
        "confidence": None,
        "segment_index": index,
    }


def _align(rows: list[dict], turns: list[DiarizedTurn]) -> list[dict]:
    return align_transcript_rows_to_turns(
        rows,
        turns,
        minimum_confidence=0.5,
        minimum_overlap=0.5,
    )


def test_three_diarized_speakers_create_three_participants() -> None:
    rows = [_row(0, 0, 1000, "A"), _row(1, 1000, 2000, "B"), _row(2, 2000, 3000, "C")]
    turns = [
        DiarizedTurn("deepgram:0", 0, 1000, 0.9),
        DiarizedTurn("deepgram:1", 1000, 2000, 0.9),
        DiarizedTurn("deepgram:2", 2000, 3000, 0.9),
    ]
    client = FakeSupabaseClient()

    attached = _attach_participants_to_transcript_rows(
        client,
        meeting_id="meeting-id",
        rows=_merge_adjacent_speaker_segments(_align(rows, turns)),
    )

    assert len(client.participants.rows) == 3
    assert len({row["participant_id"] for row in attached}) == 3


def test_repeated_speaker_turns_reuse_the_same_participant() -> None:
    rows = [_row(0, 0, 1000, "A1"), _row(1, 1000, 2000, "B"), _row(2, 2000, 3000, "A2")]
    turns = [
        DiarizedTurn("deepgram:0", 0, 1000, 0.9),
        DiarizedTurn("deepgram:1", 1000, 2000, 0.9),
        DiarizedTurn("deepgram:0", 2000, 3000, 0.9),
    ]
    client = FakeSupabaseClient()
    attached = _attach_participants_to_transcript_rows(
        client,
        meeting_id="meeting-id",
        rows=_align(rows, turns),
    )

    assert len(client.participants.rows) == 2
    assert attached[0]["participant_id"] == attached[2]["participant_id"]


def test_greatest_timestamp_overlap_assigns_the_speaker() -> None:
    aligned = _align(
        [_row(0, 500, 2000, "Mostly speaker two")],
        [
            DiarizedTurn("deepgram:0", 0, 800, 0.9),
            DiarizedTurn("deepgram:1", 800, 2200, 0.9),
        ],
    )

    assert aligned[0]["speaker_label"] == "deepgram:1"


def test_ambiguous_timestamp_overlap_remains_unknown() -> None:
    aligned = _align(
        [_row(0, 0, 1000, "Ambiguous")],
        [
            DiarizedTurn("deepgram:0", 0, 500, 0.9),
            DiarizedTurn("deepgram:1", 500, 1000, 0.9),
        ],
    )

    assert aligned[0]["speaker_label"] is None


def test_diarization_failure_returns_no_turns(monkeypatch) -> None:
    async def fail_diarization(**kwargs):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(diarization, "diarize_audio", fail_diarization)

    turns = asyncio.run(
        diarization.diarize_audio_safely(
            audio_bytes=b"audio",
            filename="recording.webm",
            content_type="audio/webm",
            provider="deepgram",
            api_key="secret",
        )
    )

    assert turns == []


def test_no_diarization_never_uses_row_indexes_as_speaker_labels() -> None:
    rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={
            "segments": [
                {"start": 0, "end": 1, "text": "First."},
                {"start": 3, "end": 4, "text": "Second."},
            ]
        },
        duration_seconds=4,
    )
    client = FakeSupabaseClient()
    attached = _attach_participants_to_transcript_rows(
        client,
        meeting_id="meeting-id",
        rows=rows,
    )

    assert {row["speaker_label"] for row in attached} == {"Unknown Speaker"}
    assert len(client.participants.rows) == 1


def test_deepgram_words_are_collapsed_into_stable_speaker_turns() -> None:
    turns = diarization._deepgram_turns(
        {
            "results": {
                "channels": [
                    {
                        "alternatives": [
                            {
                                "words": [
                                    {"speaker": 0, "start": 0, "end": 0.4, "speaker_confidence": 0.8},
                                    {"speaker": 0, "start": 0.4, "end": 0.8, "speaker_confidence": 1.0},
                                    {"speaker": 1, "start": 0.8, "end": 1.2, "speaker_confidence": 0.9},
                                ]
                            }
                        ]
                    }
                ]
            }
        }
    )

    assert turns == [
        DiarizedTurn("deepgram:0", 0, 800, 0.9),
        DiarizedTurn("deepgram:1", 800, 1200, 0.9),
    ]
