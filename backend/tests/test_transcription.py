import pytest
from fastapi import HTTPException

from app.main import _build_transcript_rows, _require_bearer_token


def test_require_bearer_token_accepts_valid_header() -> None:
    assert _require_bearer_token("Bearer test-token") == "test-token"


@pytest.mark.parametrize("header", [None, "", "Basic test-token", "Bearer"])
def test_require_bearer_token_rejects_invalid_header(header: str | None) -> None:
    with pytest.raises(HTTPException) as exc_info:
        _require_bearer_token(header)

    assert exc_info.value.status_code == 401


def test_build_transcript_rows_maps_openai_segments_to_milliseconds() -> None:
    rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={
            "segments": [
                {"start": 0.25, "end": 2.5, "text": " First segment. "},
                {"start": 2.5, "end": 4.75, "text": "Second segment."},
            ]
        },
        duration_seconds=12,
    )

    assert rows == [
        {
            "meeting_id": "meeting-id",
            "speaker_label": None,
            "start_ms": 250,
            "end_ms": 2500,
            "text": "First segment.",
            "confidence": None,
            "segment_index": 0,
        },
        {
            "meeting_id": "meeting-id",
            "speaker_label": None,
            "start_ms": 2500,
            "end_ms": 4750,
            "text": "Second segment.",
            "confidence": None,
            "segment_index": 1,
        },
    ]


def test_build_transcript_rows_falls_back_to_single_text_segment() -> None:
    rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={"text": "Full transcript."},
        duration_seconds=3,
    )

    assert rows[0]["text"] == "Full transcript."
    assert rows[0]["start_ms"] == 0
    assert rows[0]["end_ms"] == 3000


def test_build_transcript_rows_rejects_empty_transcript() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _build_transcript_rows(
            meeting_id="meeting-id",
            transcription={"text": "   "},
            duration_seconds=None,
        )

    assert exc_info.value.status_code == 502
