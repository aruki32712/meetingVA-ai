import pytest
from fastapi import HTTPException

from app.main import (
    _attach_participants_to_transcript_rows,
    _build_analysis_rows,
    _build_transcript_rows,
    _format_transcript_for_analysis,
    _normalize_analysis_payload,
    _require_bearer_token,
)


class FakeTable:
    def __init__(self) -> None:
        self.rows: list[dict[str, str]] = []

    def insert(self, rows: list[dict[str, str]]) -> "FakeTable":
        self.rows = [
            {
                **row,
                "id": f"participant-{index + 1}",
            }
            for index, row in enumerate(rows)
        ]
        return self

    def execute(self) -> object:
        return type("Response", (), {"data": self.rows})()


class FakeSupabaseClient:
    def __init__(self) -> None:
        self.participants = FakeTable()

    def table(self, table_name: str) -> FakeTable:
        assert table_name == "participants"
        return self.participants


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


def test_build_transcript_rows_preserves_provider_speaker_label() -> None:
    rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={
            "segments": [
                {"start": 0, "end": 1, "text": "Hello.", "speaker_label": "spk_0"}
            ]
        },
        duration_seconds=12,
    )

    assert rows[0]["speaker_label"] == "spk_0"


def test_attach_participants_assigns_fallback_speaker() -> None:
    rows = _attach_participants_to_transcript_rows(
        FakeSupabaseClient(),
        meeting_id="meeting-id",
        rows=[
            {
                "meeting_id": "meeting-id",
                "speaker_label": None,
                "start_ms": 0,
                "end_ms": 1000,
                "text": "Hello.",
                "confidence": None,
                "segment_index": 0,
            }
        ],
    )

    assert rows[0]["speaker_label"] == "Speaker 1"
    assert rows[0]["participant_id"] == "participant-1"


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


def test_normalize_analysis_payload_requires_summary_and_brief() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _normalize_analysis_payload(
            {
                "executive_summary": "Summary",
                "meeting_brief": "",
                "action_items": [],
                "decisions": [],
                "open_questions": [],
            }
        )

    assert exc_info.value.status_code == 502


def test_build_analysis_rows_maps_structured_items() -> None:
    analysis = _normalize_analysis_payload(
        {
            "executive_summary": "Summary",
            "meeting_brief": "Brief",
            "action_items": [
                {
                    "title": "Send notes",
                    "description": "Share meeting notes.",
                    "due_date": "2026-07-10",
                },
                {
                    "title": "Pick date",
                    "description": "Ambiguous due date should be ignored.",
                    "due_date": "next Friday",
                },
            ],
            "decisions": [{"title": "Ship MVP", "description": "Proceed."}],
            "open_questions": [
                {"question": "Who owns launch?", "answer": "", "status": "unknown"}
            ],
        }
    )

    rows = _build_analysis_rows("meeting-id", analysis)

    assert rows["action_items"][0]["due_at"] == "2026-07-10"
    assert rows["action_items"][1]["due_at"] is None
    assert rows["decisions"][0]["title"] == "Ship MVP"
    assert rows["questions"][0]["status"] == "open"


def test_format_transcript_for_analysis_uses_speaker_labels() -> None:
    transcript = _format_transcript_for_analysis(
        [
            {"speaker_label": "Sam", "text": "We should launch."},
            {"speaker_label": None, "text": "Agreed."},
            {"speaker_label": "Empty", "text": "   "},
        ]
    )

    assert transcript == "Sam: We should launch.\nSpeaker: Agreed."
