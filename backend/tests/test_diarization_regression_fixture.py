import json
from pathlib import Path

from app.main import _attach_participants_to_transcript_rows, _build_transcript_rows
from tests.test_transcription import FakeSupabaseClient


FIXTURE = json.loads(
    (
        Path(__file__).parents[2]
        / "shared"
        / "test-fixtures"
        / "four-speaker-transcript.json"
    ).read_text(encoding="utf-8")
)


def normalized_source_text() -> str:
    return " ".join(
        " ".join(segment["text"].split()) for segment in FIXTURE["provider_segments"]
    )


def test_realistic_multi_speaker_fixture_preserves_turn_boundaries_and_all_text():
    rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={"segments": FIXTURE["provider_segments"]},
        duration_seconds=21,
    )

    assert [row["speaker_label"] for row in rows] == [
        "deepgram:0",
        "deepgram:1",
        "deepgram:2",
        None,
        "deepgram:0",
        "deepgram:3",
        "deepgram:1",
    ]
    assert [row["text"] for row in rows] == [
        turn["text"] for turn in FIXTURE["expected_turns"]
    ]
    assert all(len(row["text"].split()) > 1 for row in rows)
    assert " ".join(row["text"] for row in rows) == normalized_source_text()


def test_realistic_fixture_keeps_four_provider_speakers_distinct_and_unknown_available():
    client = FakeSupabaseClient()
    built_rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={"segments": FIXTURE["provider_segments"]},
        duration_seconds=21,
    )
    rows = _attach_participants_to_transcript_rows(
        client, meeting_id="meeting-id", rows=built_rows
    )

    provider_labels = {
        row["speaker_label"] for row in rows if row["speaker_label"] != "Unknown Speaker"
    }
    assert provider_labels == {"deepgram:0", "deepgram:1", "deepgram:2", "deepgram:3"}
    assert len({row["participant_id"] for row in rows}) == 5
    assert [row["speaker_label"] for row in rows].count("Unknown Speaker") == 1
    assert any(
        participant["display_name"] == "Unknown Speaker"
        and participant["metadata"]["speaker_label_source"] == "fallback_unknown"
        for participant in client.participants.rows
    )
