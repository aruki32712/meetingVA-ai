import pytest
from fastapi import HTTPException

from app.main import (
    _attach_participants_to_transcript_rows,
    _build_analysis_rows,
    _build_transcript_rows,
    _enforce_ai_rate_limit,
    _format_transcript_for_analysis,
    _is_english_language,
    _normalize_analysis_payload,
    _normalize_language,
    _require_bearer_token,
    _transcript_kind,
    _translation_status,
    _validate_uuid,
    ai_rate_limit_events,
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


def test_validate_uuid_accepts_uuid() -> None:
    assert (
        _validate_uuid("11111111-1111-1111-1111-111111111111", "meeting_id")
        == "11111111-1111-1111-1111-111111111111"
    )


def test_validate_uuid_rejects_invalid_value() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _validate_uuid("not-a-uuid", "meeting_id")

    assert exc_info.value.status_code == 422


def test_ai_rate_limit_rejects_excess_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    ai_rate_limit_events.clear()
    monkeypatch.setattr("app.main.settings.ai_rate_limit_requests", 2)
    monkeypatch.setattr("app.main.settings.ai_rate_limit_window_seconds", 60)

    _enforce_ai_rate_limit("user-id", "transcribe")
    _enforce_ai_rate_limit("user-id", "transcribe")

    with pytest.raises(HTTPException) as exc_info:
        _enforce_ai_rate_limit("user-id", "transcribe")

    assert exc_info.value.status_code == 429


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
            "end_ms": 4750,
            "text": "First segment. Second segment.",
            "original_text": "First segment. Second segment.",
            "translated_text": None,
            "transcript_kind": "original",
            "confidence": None,
            "segment_index": 0,
        }
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


def test_build_transcript_rows_groups_consecutive_same_speaker_sentences() -> None:
    rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={
            "segments": [
                {
                    "start": 0,
                    "end": 1,
                    "text": "First sentence.",
                    "speaker_label": "Speaker A",
                    "confidence": 0.8,
                },
                {
                    "start": 1.4,
                    "end": 2.5,
                    "text": "  Second   sentence! ",
                    "speaker_label": " speaker   a ",
                    "confidence": 1.0,
                },
                {
                    "start": 2.7,
                    "end": 3.2,
                    "text": "Third?",
                    "speaker_label": "SPEAKER A",
                },
            ]
        },
        duration_seconds=4,
    )

    assert len(rows) == 1
    assert rows[0]["start_ms"] == 0
    assert rows[0]["end_ms"] == 3200
    assert rows[0]["text"] == "First sentence. Second sentence! Third?"
    assert rows[0]["original_text"] == rows[0]["text"]
    assert rows[0]["confidence"] == pytest.approx(0.9)
    assert rows[0]["segment_index"] == 0


def test_build_transcript_rows_starts_new_turn_when_speaker_changes() -> None:
    rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={
            "segments": [
                {"start": 0, "end": 1, "text": "From A.", "speaker": "A"},
                {"start": 1.1, "end": 2, "text": "From B.", "speaker": "B"},
            ]
        },
        duration_seconds=2,
    )

    assert [row["speaker_label"] for row in rows] == ["A", "B"]
    assert [row["text"] for row in rows] == ["From A.", "From B."]


def test_build_transcript_rows_starts_new_turn_after_long_pause() -> None:
    rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={
            "segments": [
                {"start": 0, "end": 1, "text": "Before pause.", "speaker": "A"},
                {"start": 2.5, "end": 3, "text": "After pause.", "speaker": "A"},
            ]
        },
        duration_seconds=3,
    )

    assert len(rows) == 2
    assert [row["segment_index"] for row in rows] == [0, 1]


def test_build_transcript_rows_merges_original_and_translated_text() -> None:
    rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={
            "segments": [
                {"start": 0, "end": 1, "text": "Hello.", "speaker": "A"},
                {"start": 1.2, "end": 2, "text": "How are you?", "speaker": "A"},
                {"start": 2.1, "end": 3, "text": "Good.", "speaker": "B"},
            ]
        },
        original_transcription={
            "segments": [
                {"text": "Hola.", "speaker": "A"},
                {"text": "¿Cómo estás?", "speaker": "A"},
                {"text": "Bien.", "speaker": "B"},
            ]
        },
        duration_seconds=3,
        transcript_kind="both",
    )

    assert [row["segment_index"] for row in rows] == [0, 1]
    assert rows[0]["text"] == "Hello. How are you?"
    assert rows[0]["translated_text"] == "Hello. How are you?"
    assert rows[0]["original_text"] == "Hola. ¿Cómo estás?"
    assert " ".join(row["text"] for row in rows) == "Hello. How are you? Good."


def test_unlabeled_rows_share_one_unknown_speaker_participant() -> None:
    client = FakeSupabaseClient()
    rows = _attach_participants_to_transcript_rows(
        client,
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
            },
            {
                "meeting_id": "meeting-id",
                "speaker_label": None,
                "start_ms": 5000,
                "end_ms": 6000,
                "text": "Later words.",
                "confidence": None,
                "segment_index": 1,
            },
        ],
    )

    assert {row["speaker_label"] for row in rows} == {"Unknown Speaker"}
    assert {row["participant_id"] for row in rows} == {"participant-1"}
    assert len(client.participants.rows) == 1
    assert client.participants.rows[0]["display_name"] == "Unknown Speaker"
    assert client.participants.rows[0]["metadata"]["speaker_label_source"] == (
        "fallback_unknown"
    )
    assert all(
        row["speaker_label"] not in {"Speaker 1", "Speaker 2"} for row in rows
    )


def test_provider_speaker_ids_create_participants_for_unique_labels_only() -> None:
    client = FakeSupabaseClient()
    built_rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={
            "segments": [
                {"start": 0, "end": 1, "text": "A one.", "speaker_id": "spk_a"},
                {"start": 1.2, "end": 2, "text": "A two.", "speaker_id": "spk_a"},
                {"start": 2.1, "end": 3, "text": "B one.", "speaker_id": "spk_b"},
            ]
        },
        duration_seconds=3,
    )
    rows = _attach_participants_to_transcript_rows(
        client,
        meeting_id="meeting-id",
        rows=built_rows,
    )

    assert len(rows) == 2
    assert rows[0]["text"] == "A one. A two."
    assert {row["speaker_label"] for row in rows} == {"spk_a", "spk_b"}
    assert len(client.participants.rows) == 2
    assert all(
        participant["metadata"]["speaker_label_source"] == "provider_detected"
        for participant in client.participants.rows
    )


def test_build_transcript_rows_falls_back_to_single_text_segment() -> None:
    rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={"text": "Full transcript."},
        duration_seconds=3,
    )

    assert rows[0]["text"] == "Full transcript."
    assert rows[0]["original_text"] == "Full transcript."
    assert rows[0]["translated_text"] is None
    assert rows[0]["transcript_kind"] == "original"
    assert rows[0]["start_ms"] == 0
    assert rows[0]["end_ms"] == 3000


def test_build_transcript_rows_preserves_original_text_for_translation() -> None:
    rows = _build_transcript_rows(
        meeting_id="meeting-id",
        transcription={
            "segments": [
                {"start": 0, "end": 1, "text": "Hello team."},
            ]
        },
        original_transcription={
            "segments": [
                {
                    "start": 0,
                    "end": 1,
                    "text": "Hola equipo.",
                    "speaker_label": "spk_0",
                },
            ]
        },
        duration_seconds=12,
        transcript_kind="both",
    )

    assert rows[0]["speaker_label"] == "spk_0"
    assert rows[0]["text"] == "Hello team."
    assert rows[0]["original_text"] == "Hola equipo."
    assert rows[0]["translated_text"] == "Hello team."
    assert rows[0]["transcript_kind"] == "both"


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


def test_format_transcript_for_analysis_prefers_participant_names() -> None:
    transcript = _format_transcript_for_analysis(
        [
            {
                "speaker_label": "spk_0",
                "participants": {"display_name": "Jordan"},
                "text": "We should launch.",
            }
        ]
    )

    assert transcript == "Jordan: We should launch."


def test_language_helpers_normalize_english_aliases() -> None:
    assert _normalize_language("EN") == "english"
    assert _is_english_language("eng")
    assert not _is_english_language("spanish")


def test_transcript_kind_tracks_translation_state() -> None:
    assert (
        _transcript_kind(
            detected_language="spanish",
            translate_to_english=True,
            translated=True,
        )
        == "both"
    )
    assert (
        _transcript_kind(
            detected_language="english",
            translate_to_english=True,
            translated=False,
        )
        == "original"
    )


def test_translation_status_tracks_request_and_language_state() -> None:
    assert (
        _translation_status(
            detected_language="spanish",
            translate_to_english=False,
            translated=False,
        )
        == "not_requested"
    )
    assert (
        _translation_status(
            detected_language="english",
            translate_to_english=True,
            translated=False,
        )
        == "not_needed"
    )
    assert (
        _translation_status(
            detected_language="spanish",
            translate_to_english=True,
            translated=True,
        )
        == "translated"
    )
    assert (
        _translation_status(
            detected_language="spanish",
            translate_to_english=True,
            translated=False,
        )
        == "failed"
    )
