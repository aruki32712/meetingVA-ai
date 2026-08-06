import asyncio
import io
import logging
import wave
import httpx
import pytest
from pydantic import ValidationError

from app import diarization
from app.diarization import DiarizedTurn, align_transcript_rows_to_turns, align_words_to_diarization
from app.main import (
    _align_and_build_speaker_turn_rows,
    _attach_participants_to_transcript_rows,
    _build_transcript_rows,
    _merge_adjacent_speaker_segments,
    _build_word_timestamp_rows,
    build_speaker_turn_rows,
)
from app.settings import Settings


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


def _align_words(rows: list[dict], turns: list[DiarizedTurn], *, tolerance: int = 250) -> list[dict]:
    return align_words_to_diarization(
        rows,
        turns,
        minimum_confidence=0.5,
        minimum_overlap=0.5,
        nearest_turn_tolerance_ms=tolerance,
    )


def test_six_diarized_speakers_create_six_participants_from_long_row() -> None:
    rows = [
        _row(
            0,
            0,
            6000,
            "one two three four five six seven eight nine ten eleven twelve",
        )
    ]
    turns = [
        DiarizedTurn(f"deepgram:{index}", index * 1000, (index + 1) * 1000, 0.9)
        for index in range(6)
    ]
    client = FakeSupabaseClient()

    attached = _attach_participants_to_transcript_rows(
        client,
        meeting_id="meeting-id",
        rows=_merge_adjacent_speaker_segments(_align(rows, turns)),
    )

    assert len(client.participants.rows) == 6
    assert len({row["participant_id"] for row in attached}) == 6
    assert " ".join(row["text"] for row in attached) == rows[0]["text"]


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
            DiarizedTurn("deepgram:0", 0, 900, 0.9),
            DiarizedTurn("deepgram:1", 800, 2200, 0.9),
        ],
    )

    assert aligned[0]["speaker_label"] == "deepgram:1"


def test_ambiguous_timestamp_overlap_remains_unknown() -> None:
    aligned = _align(
        [_row(0, 0, 1000, "Ambiguous")],
        [
            DiarizedTurn("deepgram:0", 0, 700, 0.9),
            DiarizedTurn("deepgram:1", 300, 1000, 0.9),
        ],
    )

    assert aligned[0]["speaker_label"] is None


def test_diarization_failure_returns_no_turns(monkeypatch) -> None:
    async def fail_diarization(*args):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(
        diarization,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {"diarization_provider": "deepgram", "diarization_api_key": "secret"},
        )(),
    )
    monkeypatch.setattr(diarization, "diarize_audio", fail_diarization)

    turns = asyncio.run(
        diarization.diarize_audio_safely(
            b"audio",
            "recording.webm",
            "audio/webm",
        )
    )

    assert turns == []


def test_disabled_provider_logs_unknown_speaker_fallback(monkeypatch, caplog) -> None:
    caplog.set_level(logging.INFO)
    monkeypatch.setattr(
        diarization,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {"diarization_provider": "none", "diarization_api_key": ""},
        )(),
    )

    turns = asyncio.run(
        diarization.diarize_audio_safely(b"audio", "recording.webm", "audio/webm")
    )

    assert turns == []
    assert "Speaker diarization disabled; using Unknown Speaker fallback." in caplog.text


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
        DiarizedTurn("0", 0, 800, 0.9, turn_id="word-turn-1"),
        DiarizedTurn("1", 800, 1200, 0.9, turn_id="word-turn-2"),
    ]


def test_five_anonymous_utterance_turns_produce_five_transcript_rows() -> None:
    payload = {
        "results": {
            "utterances": [
                {"id": f"turn-{index + 1}", "start": index, "end": index + 1}
                for index in range(5)
            ],
            "channels": [{"alternatives": [{"words": []}]}],
        }
    }
    turns = diarization._deepgram_turns(payload)
    words = [
        _row(index, index * 1000, index * 1000 + 800, f"word{index}")
        for index in range(5)
    ]
    aligned = _align_words(words, turns)
    grouped = build_speaker_turn_rows(aligned)
    assert len(turns) == 5
    assert len({turn.turn_id for turn in turns}) == 5
    assert all(turn.speaker_id is None for turn in turns)
    assert len(grouped) == 5
    assert all(row["speaker_label"] is None for row in grouped)


def test_nine_unreliable_provider_turns_remain_nine_anonymous_rows() -> None:
    payload = {
        "results": {
            "utterances": [
                {
                    "id": f"voice-change-{index + 1}",
                    "start": index * 2,
                    "end": index * 2 + 2,
                    "speaker": index % 5,
                    "confidence": 0.1,
                }
                for index in range(9)
            ],
            "channels": [{"alternatives": [{"words": []}]}],
        }
    }
    turns = diarization._deepgram_turns(payload)
    words = [
        _row(index, index * 2000, index * 2000 + 1500, f"word{index}")
        for index in range(9)
    ]
    aligned = _align_words(words, turns)
    grouped = build_speaker_turn_rows(aligned)
    assert len(grouped) == 9
    assert all(row["provider_speaker_id"] is None for row in grouped)
    assert " ".join(row["text"] for row in grouped).split() == [
        word["text"] for word in words
    ]
    assert [row["segment_index"] for row in grouped] == list(range(9))


def test_words_merge_inside_one_anonymous_turn_but_not_across_turns() -> None:
    turns = [
        DiarizedTurn(None, 0, 2000, turn_id="turn-1", boundary_source="utterance"),
        DiarizedTurn(None, 2000, 4000, turn_id="turn-2", boundary_source="utterance"),
    ]
    words = [
        _row(index, index * 1000, index * 1000 + 800, f"word{index}")
        for index in range(4)
    ]
    grouped = build_speaker_turn_rows(_align_words(words, turns))
    assert [row["text"] for row in grouped] == ["word0 word1", "word2 word3"]


def test_recurring_stable_speaker_reuses_participant_without_merging_boundaries() -> None:
    turns = [
        DiarizedTurn("0", 0, 1000, 0.9, turn_id="turn-1"),
        DiarizedTurn("1", 1000, 2000, 0.9, turn_id="turn-2"),
        DiarizedTurn("0", 2000, 3000, 0.9, turn_id="turn-3"),
    ]
    words = [
        _row(index, index * 1000, index * 1000 + 800, f"word{index}")
        for index in range(3)
    ]
    grouped = build_speaker_turn_rows(_align_words(words, turns))
    client = FakeSupabaseClient()
    attached = _attach_participants_to_transcript_rows(
        client, meeting_id="meeting-id", rows=grouped
    )
    assert len(attached) == 3
    assert len(client.participants.rows) == 2
    assert attached[0]["participant_id"] == attached[2]["participant_id"]


def test_deepgram_speaker_zero_is_retained() -> None:
    turns = diarization._deepgram_turns({"results": {"utterances": [{"speaker": 0, "start": 1.0, "end": 2.0, "confidence": 0.8}]}})
    assert turns[0].speaker_id == "0"
    assert turns[0].stable_label == "deepgram:0"


def test_timestamp_conversion_occurs_exactly_once() -> None:
    turns = diarization._deepgram_turns({"results": {"utterances": [{"speaker": 2, "start": 1.25, "end": 2.5}]}})
    assert (turns[0].start_ms, turns[0].end_ms) == (1250, 2500)


def test_different_speakers_are_never_merged() -> None:
    turns = diarization._deepgram_turns({"results": {"utterances": [{"speaker": 0, "start": 0, "end": 1}, {"speaker": 1, "start": 1, "end": 2}]}})
    assert [turn.speaker_id for turn in turns] == ["0", "1"]


def test_word_timestamps_split_long_openai_segment_by_real_boundaries() -> None:
    rows = _build_word_timestamp_rows("meeting-id", {"words": [
        {"word": "Hello", "start": 0.0, "end": 0.5},
        {"word": "there", "start": 0.5, "end": 1.0},
        {"word": "Bonjour", "start": 1.0, "end": 1.5},
    ]})
    aligned = _merge_adjacent_speaker_segments(_align_words(rows, [
        DiarizedTurn("0", 0, 1000, 0.9), DiarizedTurn("1", 1000, 1500, 0.9)
    ]))
    assert [(row["speaker_label"], row["text"]) for row in aligned] == [
        ("deepgram:0", "Hello there"), ("deepgram:1", "Bonjour")
    ]
    assert [row["segment_index"] for row in aligned] == [0, 1]
    assert [row["original_text"] for row in aligned] == ["Hello there", "Bonjour"]


def test_three_speakers_inside_one_openai_segment_follow_word_boundaries() -> None:
    words = _build_word_timestamp_rows("meeting-id", {"words": [
        {"word": "One", "start": 0.0, "end": 0.5},
        {"word": "two", "start": 0.5, "end": 1.0},
        {"word": "Three", "start": 1.0, "end": 1.5},
        {"word": "four", "start": 1.5, "end": 2.0},
        {"word": "Five", "start": 2.0, "end": 2.5},
    ]})
    turns = [
        DiarizedTurn("0", 0, 1000, 0.9),
        DiarizedTurn("1", 1000, 2000, 0.9),
        DiarizedTurn("2", 2000, 2500, 0.9),
    ]
    rows = _merge_adjacent_speaker_segments(_align_words(words, turns))
    assert [(row["speaker_label"], row["text"], row["start_ms"], row["end_ms"]) for row in rows] == [
        ("deepgram:0", "One two", 0, 1000),
        ("deepgram:1", "Three four", 1000, 2000),
        ("deepgram:2", "Five", 2000, 2500),
    ]
    assert [row["segment_index"] for row in rows] == [0, 1, 2]


def test_mocked_provider_fixture_has_three_speakers_and_a_returning_turn() -> None:
    provider_payload = {"results": {"channels": [{"alternatives": [{"words": [
        {"word": "alpha", "speaker": 0, "start": 0.0, "end": 0.4, "speaker_confidence": 0.95},
        {"word": "beta", "speaker": 1, "start": 0.4, "end": 0.8, "speaker_confidence": 0.95},
        {"word": "gamma", "speaker": 2, "start": 0.8, "end": 1.2, "speaker_confidence": 0.95},
        {"word": "again", "speaker": 0, "start": 1.2, "end": 1.6, "speaker_confidence": 0.95},
    ]}]}]}}
    openai_response = {"segments": [{"text": "alpha beta gamma again", "start": 0.0, "end": 1.6}], "words": [
        {"word": "alpha", "start": 0.0, "end": 0.4},
        {"word": "beta", "start": 0.4, "end": 0.8},
        {"word": "gamma", "start": 0.8, "end": 1.2},
        {"word": "again", "start": 1.2, "end": 1.6},
    ]}
    turns = diarization._deepgram_turns(provider_payload)
    words = _build_word_timestamp_rows("meeting-id", openai_response)
    rows = _merge_adjacent_speaker_segments(_align_words(words, turns))
    client = FakeSupabaseClient()
    attached = _attach_participants_to_transcript_rows(client, meeting_id="meeting-id", rows=rows)
    assert [row["text"] for row in attached] == ["alpha", "beta", "gamma", "again"]
    assert len(client.participants.rows) == 3
    assert attached[0]["participant_id"] == attached[3]["participant_id"]
    assert " ".join(row["text"] for row in attached) == openai_response["segments"][0]["text"]


def test_recurring_speaker_creates_separate_turn_and_reuses_participant() -> None:
    words = [_row(i, i * 500, (i + 1) * 500, text) for i, text in enumerate(("A", "B", "C", "A again"))]
    turns = [
        DiarizedTurn("0", 0, 500, 0.9), DiarizedTurn("1", 500, 1000, 0.9),
        DiarizedTurn("2", 1000, 1500, 0.9), DiarizedTurn("0", 1500, 2000, 0.9),
    ]
    rows = _merge_adjacent_speaker_segments(_align_words(words, turns))
    client = FakeSupabaseClient()
    attached = _attach_participants_to_transcript_rows(client, meeting_id="meeting-id", rows=rows)
    assert len(attached) == 4
    assert attached[0]["participant_id"] == attached[3]["participant_id"]
    assert len(client.participants.rows) == 3


def test_word_grouping_preserves_punctuation_and_contractions() -> None:
    words = [_row(i, i * 100, (i + 1) * 100, text) for i, text in enumerate(("Hello", ",", "I", "'m", "ready.", "."))]
    for word in words:
        word["speaker_label"] = "deepgram:0"
        word["provider_speaker_id"] = "0"
    assert _merge_adjacent_speaker_segments(words)[0]["text"] == "Hello, I'm ready."


def _aligned_word(
    index: int,
    *,
    speaker: str,
    start_ms: int,
    end_ms: int,
    text: str | None = None,
) -> dict:
    row = _row(index, start_ms, end_ms, text or f"word{index}")
    row.update(
        {
            "speaker_label": f"deepgram:{speaker}",
            "provider_speaker_id": speaker,
            "diarization_available": True,
            "diarization_ambiguous": False,
        }
    )
    return row


def _unknown_word(
    index: int,
    *,
    start_ms: int,
    end_ms: int,
    boundary_index: int = 0,
) -> dict:
    row = _row(index, start_ms, end_ms, f"unknown{index}")
    row.update(
        {
            "speaker_label": None,
            "provider_speaker_id": None,
            "diarization_available": True,
            "diarization_ambiguous": True,
            "diarization_boundary_index": boundary_index,
        }
    )
    return row


def test_one_hundred_consecutive_unknown_words_become_one_turn() -> None:
    words = [
        _unknown_word(
            index,
            start_ms=index * 300,
            end_ms=index * 300 + 325,
        )
        for index in range(100)
    ]
    rows = build_speaker_turn_rows(words)
    assert len(rows) == 1
    assert rows[0]["provider_speaker_id"] is None
    assert rows[0]["speaker_label"] is None
    assert rows[0]["text"].split() == [word["text"] for word in words]


def test_unknown_detected_unknown_produces_three_turns() -> None:
    words = [
        *[
            _unknown_word(index, start_ms=index * 300, end_ms=index * 300 + 325)
            for index in range(20)
        ],
        *[
            _aligned_word(
                index,
                speaker="0",
                start_ms=index * 300,
                end_ms=index * 300 + 325,
            )
            for index in range(20, 35)
        ],
        *[
            _unknown_word(index, start_ms=index * 300, end_ms=index * 300 + 325)
            for index in range(35, 55)
        ],
    ]
    rows = build_speaker_turn_rows(words)
    assert [row["provider_speaker_id"] for row in rows] == [None, "0", None]


def test_detected_unknown_detected_creates_at_most_three_participants() -> None:
    words = [
        *[
            _aligned_word(index, speaker="0", start_ms=index * 300, end_ms=index * 300 + 325)
            for index in range(10)
        ],
        *[
            _unknown_word(index, start_ms=index * 300, end_ms=index * 300 + 325)
            for index in range(10, 30)
        ],
        *[
            _aligned_word(index, speaker="1", start_ms=index * 300, end_ms=index * 300 + 325)
            for index in range(30, 40)
        ],
    ]
    client = FakeSupabaseClient()
    attached = _attach_participants_to_transcript_rows(
        client,
        meeting_id="meeting-id",
        rows=build_speaker_turn_rows(words),
    )
    assert len(attached) == 3
    assert len(client.participants.rows) == 3
    assert {row["display_name"] for row in client.participants.rows} == {
        "Speaker 1",
        "Unknown Speaker",
        "Speaker 2",
    }


def test_unknown_words_split_on_long_pause_and_keep_all_words() -> None:
    words = [
        _unknown_word(0, start_ms=0, end_ms=300),
        _unknown_word(1, start_ms=300, end_ms=600),
        _unknown_word(2, start_ms=2500, end_ms=2800),
        _unknown_word(3, start_ms=2800, end_ms=3100),
    ]
    rows = build_speaker_turn_rows(words)
    assert len(rows) == 2
    assert [row["segment_index"] for row in rows] == [0, 1]
    assert " ".join(row["text"] for row in rows).split() == [
        word["text"] for word in words
    ]


def test_unknown_words_do_not_cross_explicit_diarization_boundary() -> None:
    words = [
        _unknown_word(0, start_ms=0, end_ms=300, boundary_index=0),
        _unknown_word(1, start_ms=300, end_ms=600, boundary_index=0),
        _unknown_word(2, start_ms=600, end_ms=900, boundary_index=1),
        _unknown_word(3, start_ms=900, end_ms=1200, boundary_index=1),
    ]
    assert len(build_speaker_turn_rows(words)) == 2


def test_one_hundred_overlapping_words_become_one_readable_turn() -> None:
    words = [
        _aligned_word(
            index,
            speaker="0",
            start_ms=index * 400,
            end_ms=index * 400 + 425,
        )
        for index in range(100)
    ]
    rows = _merge_adjacent_speaker_segments(words)
    assert len(rows) == 1
    assert rows[0]["start_ms"] == 0
    assert rows[0]["end_ms"] == 40025
    assert rows[0]["text"].split() == [word["text"] for word in words]


def test_short_pause_merges_but_long_pause_splits_same_speaker() -> None:
    words = [
        _aligned_word(0, speaker="0", start_ms=0, end_ms=500, text="first"),
        _aligned_word(1, speaker="0", start_ms=1400, end_ms=1800, text="second"),
        _aligned_word(2, speaker="0", start_ms=3500, end_ms=3900, text="third"),
    ]
    diagnostics: dict = {}
    rows = _merge_adjacent_speaker_segments(words, diagnostics=diagnostics)
    assert [row["text"] for row in rows] == ["first second", "third"]
    assert diagnostics["rows_split_by_pause"] == 1


def test_speaker_change_starts_new_row_immediately() -> None:
    words = [
        _aligned_word(0, speaker="0", start_ms=0, end_ms=500),
        _aligned_word(1, speaker="1", start_ms=450, end_ms=900),
    ]
    rows = _merge_adjacent_speaker_segments(words)
    assert len(rows) == 2
    assert [row["provider_speaker_id"] for row in rows] == ["0", "1"]


def test_same_speaker_splits_by_duration_and_keeps_sequential_indexes() -> None:
    words = [
        _aligned_word(
            index,
            speaker="0",
            start_ms=index * 500,
            end_ms=index * 500 + 525,
        )
        for index in range(120)
    ]
    diagnostics: dict = {}
    rows = _merge_adjacent_speaker_segments(words, diagnostics=diagnostics)
    assert len(rows) == 2
    assert [row["segment_index"] for row in rows] == [0, 1]
    assert diagnostics["rows_split_by_size_limit"] == 1
    assert " ".join(row["text"] for row in rows).split() == [
        word["text"] for word in words
    ]


def test_two_minute_word_fixture_rebuilds_200_tokens_into_five_turns() -> None:
    # The 25 ms token overlap reproduces the production regression where the
    # former non-negative pause requirement emitted one row per word.
    speaker_blocks = ["0", "1", "2", "0", "1"]
    words = [
        _aligned_word(
            index,
            speaker=speaker_blocks[index // 40],
            start_ms=index * 600,
            end_ms=index * 600 + 625,
        )
        for index in range(200)
    ]
    diagnostics: dict = {}
    legacy_row_count = 1 + sum(
        int(word["start_ms"]) - int(previous["end_ms"]) < 0
        for previous, word in zip(words, words[1:])
    )
    rows = _merge_adjacent_speaker_segments(words, diagnostics=diagnostics)
    client = FakeSupabaseClient()
    attached = _attach_participants_to_transcript_rows(
        client,
        meeting_id="meeting-id",
        rows=rows,
    )
    assert len(words) == 200
    assert legacy_row_count == 200
    assert len(attached) == 5
    assert diagnostics["final_transcript_row_count"] == 5
    assert diagnostics["average_words_per_row"] == 40
    assert diagnostics["speaker_transition_count"] == 4
    assert len(client.participants.rows) == 3
    assert attached[0]["participant_id"] == attached[3]["participant_id"]
    assert " ".join(row["text"] for row in attached).split() == [
        word["text"] for word in words
    ]


def test_fifty_consecutive_provider_words_become_one_turn(caplog) -> None:
    caplog.set_level(logging.INFO)
    words = [
        _aligned_word(
            index,
            speaker="0",
            start_ms=index * 300,
            end_ms=index * 300 + 325,
        )
        for index in range(50)
    ]
    rows = build_speaker_turn_rows(words)
    assert len(rows) == 1
    assert rows[0]["provider_speaker_id"] == "0"
    assert rows[0]["text"].split() == [word["text"] for word in words]
    pair_records = [
        record
        for record in caplog.records
        if record.getMessage().startswith("speaker pair index=")
    ]
    assert len(pair_records) == 10
    assert all(record.args[6] for record in pair_records)
    assert all(record.args[7] for record in pair_records)
    assert all(record.args[13] for record in pair_records)


def test_returning_speaker_words_create_three_turns_and_two_participants() -> None:
    speaker_ids = ["0"] * 20 + ["1"] * 15 + ["0"] * 20
    words = [
        _aligned_word(
            index,
            speaker=speaker,
            start_ms=index * 300,
            end_ms=index * 300 + 325,
        )
        for index, speaker in enumerate(speaker_ids)
    ]
    rows = build_speaker_turn_rows(words)
    client = FakeSupabaseClient()
    attached = _attach_participants_to_transcript_rows(
        client,
        meeting_id="meeting-id",
        rows=rows,
    )
    assert len(attached) == 3
    assert len(client.participants.rows) == 2
    assert attached[0]["participant_id"] == attached[2]["participant_id"]


def test_provider_speaker_id_is_normalized_once_before_grouping() -> None:
    words = [
        _aligned_word(0, speaker="0", start_ms=0, end_ms=300),
        _aligned_word(1, speaker="0", start_ms=300, end_ms=600),
        _aligned_word(2, speaker="0", start_ms=600, end_ms=900),
    ]
    words[0]["provider_speaker_id"] = 0
    words[1]["provider_speaker_id"] = "0"
    words[2]["provider_speaker_id"] = "deepgram:0"
    assert len(build_speaker_turn_rows(words)) == 1


def test_production_word_orchestration_rebuilds_281_words_into_seven_turns() -> None:
    block_sizes = [50, 40, 35, 45, 30, 41, 40]
    block_speakers = ["0", "1", "2", "3", "0", "2", "1"]
    speaker_ids = [
        speaker
        for size, speaker in zip(block_sizes, block_speakers)
        for _ in range(size)
    ]
    word_rows = _build_word_timestamp_rows(
        "meeting-id",
        {
            "words": [
                {
                    "word": f"token{index}",
                    "start": index * 0.35,
                    "end": index * 0.35 + 0.375,
                }
                for index in range(281)
            ]
        },
    )
    turns: list[DiarizedTurn] = []
    first_word = 0
    for size, speaker in zip(block_sizes, block_speakers):
        is_final_block = first_word + size == len(word_rows)
        turns.append(
            DiarizedTurn(
                speaker,
                round(first_word * 350),
                round(
                    (first_word + size - 1) * 350 + 375
                    if is_final_block
                    else (first_word + size) * 350
                ),
                0.95,
            )
        )
        first_word += size
    diagnostics: dict = {}
    aligned_words, grouped_rows = _align_and_build_speaker_turn_rows(
        word_rows,
        turns,
        minimum_confidence=0.5,
        minimum_overlap=0.5,
        nearest_turn_tolerance_ms=250,
        diagnostics=diagnostics,
    )
    client = FakeSupabaseClient()
    attached = _attach_participants_to_transcript_rows(
        client,
        meeting_id="meeting-id",
        rows=grouped_rows,
    )
    assert len(aligned_words) == 281
    assert len(attached) == 7
    assert len(client.participants.rows) == 4
    assert diagnostics["final_transcript_row_count"] == 7
    assert [row["segment_index"] for row in attached] == list(range(7))
    assert " ".join(row["text"] for row in attached).split() == [
        row["text"] for row in word_rows
    ]
    assert all(
        previous["speaker_label"] != following["speaker_label"]
        for previous, following in zip(attached, attached[1:])
    )


def test_production_path_groups_196_unknown_words_around_four_detected_turns() -> None:
    detected_indexes = {49: "0", 99: "1", 149: "2", 199: "3"}
    word_rows = _build_word_timestamp_rows(
        "meeting-id",
        {
            "words": [
                {
                    "word": f"token{index}",
                    "start": index * 0.4,
                    "end": index * 0.4 + 0.3,
                }
                for index in range(200)
            ]
        },
    )
    diarized_turns = [
        DiarizedTurn(
            speaker,
            index * 400,
            index * 400 + 300,
            0.95,
        )
        for index, speaker in detected_indexes.items()
    ]
    diagnostics: dict = {}
    aligned_words, grouped_rows = _align_and_build_speaker_turn_rows(
        word_rows,
        diarized_turns,
        minimum_confidence=0.5,
        minimum_overlap=0.5,
        nearest_turn_tolerance_ms=0,
        diagnostics=diagnostics,
    )
    assert sum(word["provider_speaker_id"] is None for word in aligned_words) == 196
    assert len(grouped_rows) == 8
    assert sum(row["provider_speaker_id"] is None for row in grouped_rows) == 4
    assert len(grouped_rows) < len(aligned_words) / 10
    assert [row["segment_index"] for row in grouped_rows] == list(range(8))
    assert " ".join(row["text"] for row in grouped_rows).split() == [
        row["text"] for row in word_rows
    ]


def test_long_same_speaker_splits_without_changing_identity() -> None:
    words = [_row(0, 0, 1000, "first"), _row(1, 1000, 2000, "second")]
    for word in words:
        word.update({"speaker_label": "deepgram:0", "provider_speaker_id": "0"})
    rows = _merge_adjacent_speaker_segments(words, maximum_characters=8)
    assert len(rows) == 2
    assert {row["speaker_label"] for row in rows} == {"deepgram:0"}


def test_ambiguous_overlapping_speakers_and_timestamp_gap_are_unknown() -> None:
    overlapping = _row(0, 400, 600, "overlap")
    gap = _row(1, 2000, 2100, "gap")
    turns = [DiarizedTurn("0", 0, 700, 0.9), DiarizedTurn("1", 300, 1000, 0.9)]
    aligned = _align_words([overlapping, gap], turns, tolerance=100)
    assert [word["speaker_label"] for word in aligned] == [None, None]


def test_translated_text_stays_on_original_word_turn() -> None:
    words = [_row(0, 0, 500, "hola"), _row(1, 500, 1000, "mundo")]
    words[0]["translated_text"] = "hello"
    words[1]["translated_text"] = "world"
    rows = _merge_adjacent_speaker_segments(_align_words(words, [DiarizedTurn("0", 0, 1000, 0.9)]))
    assert rows[0]["original_text"] == "hola mundo"
    assert rows[0]["translated_text"] == "hello world"


def test_five_speaker_fixture_creates_five_stable_participants() -> None:
    payload = {"results": {"channels": [{"alternatives": [{"words": [
        {"word": f"word-{speaker}", "speaker": speaker, "start": speaker, "end": speaker + 0.8, "speaker_confidence": 0.95}
        for speaker in range(5)
    ]}]}]}}
    turns = diarization._deepgram_turns(payload)
    rows = [_row(index, index * 1000, index * 1000 + 800, f"word-{index}") for index in range(5)]
    client = FakeSupabaseClient()
    attached = _attach_participants_to_transcript_rows(client, meeting_id="meeting-id", rows=_align(rows, turns))
    assert {turn.speaker_id for turn in turns} == {"0", "1", "2", "3", "4"}
    assert len(client.participants.rows) == 5
    assert len({row["participant_id"] for row in attached}) == 5
    assert {row["metadata"]["provider_speaker_id"] for row in client.participants.rows} == {"0", "1", "2", "3", "4"}


def test_one_provider_speaker_is_reported_honestly() -> None:
    turns = diarization._deepgram_turns({"results": {"utterances": [{"speaker": 0, "start": 0, "end": 1}, {"speaker": 0, "start": 1.1, "end": 2}]}})
    assert len(turns) == 2
    assert {turn.speaker_id for turn in turns} == {"0"}


def test_deepgram_request_enables_diarization_and_sends_original_audio(monkeypatch) -> None:
    observed: dict[str, object] = {}
    async def handler(request: httpx.Request) -> httpx.Response:
        observed["request_count"] = int(observed.get("request_count", 0)) + 1
        observed["query"] = dict(request.url.params)
        observed["content_type"] = request.headers.get("content-type")
        observed["body"] = await request.aread()
        return httpx.Response(200, json={"results": {
            "utterances": [{"id": "utterance-1", "speaker": 0, "start": 0, "end": 1}],
            "channels": [{"alternatives": [{"words": [{"speaker": 0, "start": 0, "end": 1}]}]}],
        }})
    real_client = httpx.AsyncClient
    monkeypatch.setattr(diarization.httpx, "AsyncClient", lambda *args, **kwargs: real_client(*args, transport=httpx.MockTransport(handler), **kwargs))
    monkeypatch.setattr(diarization, "get_settings", lambda: type("Settings", (), {"diarization_model": "nova-3", "diarization_model_version": "latest", "diarization_maximum_turn_gap_ms": 750, "diarization_minimum_confidence": 0.5})())
    turns = asyncio.run(diarization._diarize_with_deepgram(audio_bytes=b"original-audio", filename="recording.webm", content_type="audio/webm", api_key="secret", expected_speakers=5))
    assert observed["query"] == {"diarize_model": "latest", "utterances": "true", "punctuate": "true", "smart_format": "true", "model": "nova-3"}
    for unsupported_parameter in (
        "diarize",
        "expected_speaker_count",
        "expected_speakers",
        "min_speakers",
        "max_speakers",
        "num_speakers",
    ):
        assert unsupported_parameter not in observed["query"]
    assert observed["content_type"] == "audio/webm"
    assert observed["body"] == b"original-audio"
    assert turns[0].speaker_id == "0"
    assert turns[0].turn_id == "utterance-1:1"
    assert observed["request_count"] == 1


@pytest.mark.parametrize("version", ["latest", "v2", "v1"])
def test_diarization_model_version_setting_accepts_supported_values(version) -> None:
    assert Settings(diarization_model_version=version).diarization_model_version == version


def test_diarization_model_version_setting_rejects_unknown_value() -> None:
    with pytest.raises(ValidationError):
        Settings(diarization_model_version="experimental")


def test_explicit_comparison_runs_each_supported_model_once(monkeypatch) -> None:
    observed: list[str] = []

    async def fake_diarize(**kwargs):
        observed.append(kwargs["model_version"])
        return [DiarizedTurn("0", 0, 100, 0.9)]

    monkeypatch.setattr(diarization, "_diarize_with_deepgram", fake_diarize)
    summaries = asyncio.run(
        diarization.compare_deepgram_diarization_models(
            audio_bytes=b"audio",
            filename="recording.webm",
            content_type="audio/webm",
            api_key="secret",
        )
    )

    assert observed == ["latest", "v2", "v1"]
    assert [summary["model_version"] for summary in summaries] == observed
    assert all(summary["request_status"] == 200 for summary in summaries)


def test_safe_wav_audio_diagnostics_include_format_and_peak() -> None:
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(16_000)
        audio.writeframes((1000).to_bytes(2, "little", signed=True) * 200)

    metadata = diarization._safe_audio_metadata(output.getvalue(), "audio/wav")

    assert metadata["channel_count"] == 2
    assert metadata["sample_rate_hz"] == 16_000
    assert metadata["codec"] == "pcm_s16le"
    assert metadata["bitrate_bps"] == 512_000
    assert metadata["peak_amplitude_ratio"] == pytest.approx(1000 / 32768, abs=0.0001)
    assert metadata["clipped_sample_ratio"] == 0


def test_single_provider_speaker_emits_clear_diagnostic(monkeypatch, caplog) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": {"channels": [{"alternatives": [{"words": [
            {"speaker": 0, "word": "one", "start": 0, "end": 0.5},
            {"speaker": 0, "word": "two", "start": 0.5, "end": 1},
        ]}]}], "utterances": [{"speaker": 0, "start": 0, "end": 1}]}})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        diarization.httpx,
        "AsyncClient",
        lambda *args, **kwargs: real_client(
            *args, transport=httpx.MockTransport(handler), **kwargs
        ),
    )
    monkeypatch.setattr(
        diarization,
        "get_settings",
        lambda: type("Settings", (), {
            "diarization_model": "nova-3",
            "diarization_model_version": "latest",
            "diarization_maximum_turn_gap_ms": 750,
            "diarization_minimum_confidence": 0.5,
        })(),
    )

    with caplog.at_level(logging.INFO):
        asyncio.run(diarization._diarize_with_deepgram(
            audio_bytes=b"audio",
            filename="recording.webm",
            content_type="audio/webm",
            api_key="secret",
        ))

    assert "The diarization provider classified this recording as one speaker." in caplog.text
    assert "raw_word_speaker_ids=['0']" in caplog.text
    assert "raw_utterance_speaker_ids=['0']" in caplog.text
    assert "combined_raw_speaker_ids=['0']" in caplog.text
    assert "word_count_by_speaker={'0': 2}" in caplog.text
    assert "utterance_count_by_speaker={'0': 1}" in caplog.text


def test_deepgram_400_logs_sanitized_provider_response(monkeypatch, caplog) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            text='{"err_code":"INVALID_QUERY","err_msg":"diarize and diarize_model conflict","api_key":"provider-secret"}',
        )

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        diarization.httpx,
        "AsyncClient",
        lambda *args, **kwargs: real_client(
            *args, transport=httpx.MockTransport(handler), **kwargs
        ),
    )
    monkeypatch.setattr(
        diarization,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "diarization_model": "nova-3",
                "diarization_model_version": "latest",
                "diarization_maximum_turn_gap_ms": 750,
                "diarization_minimum_confidence": 0.5,
            },
        )(),
    )

    with caplog.at_level(logging.ERROR), pytest.raises(
        RuntimeError, match="status 400"
    ):
        asyncio.run(
            diarization._diarize_with_deepgram(
                audio_bytes=b"original-audio",
                filename="recording.webm",
                content_type="audio/webm",
                api_key="request-secret",
            )
        )

    assert "status=400" in caplog.text
    assert "INVALID_QUERY" in caplog.text
    assert "diarize and diarize_model conflict" in caplog.text
    assert "provider-secret" not in caplog.text
    assert "request-secret" not in caplog.text
    assert "[REDACTED]" in caplog.text


def test_confidence_comparison_preserves_five_raw_speaker_ids() -> None:
    units = [
        DiarizedTurn(str(speaker), speaker * 1000, speaker * 1000 + 800, confidence)
        for speaker, confidence in enumerate((0.2, 0.4, 0.6, 0.8, 0.95))
    ]
    comparison = diarization._confidence_filter_comparison(units, 0.5)
    assert comparison["current"] == {"remaining_words": 3, "remaining_speakers": 3}
    assert comparison["lower"] == {"remaining_words": 4, "remaining_speakers": 4}
    assert comparison["none"] == {"remaining_words": 5, "remaining_speakers": 5}
    assert {unit.speaker_id for unit in units} == {"0", "1", "2", "3", "4"}

    high_confidence_units = [
        DiarizedTurn(str(speaker), speaker * 1000, speaker * 1000 + 800, 0.9)
        for speaker in range(5)
    ]
    assert diarization._confidence_filter_comparison(
        high_confidence_units, 0.5
    )["current"]["remaining_speakers"] == 5


def test_five_raw_provider_ids_are_not_renumbered_by_turn_order() -> None:
    payload = {"results": {"channels": [{"alternatives": [{"words": [
        {"speaker": speaker, "start": index, "end": index + 0.5, "speaker_confidence": 0.9}
        for index, speaker in enumerate((4, 0, 3, 1, 2, 4))
    ]}]}]}}
    turns = diarization._deepgram_turns(payload)
    assert [turn.speaker_id for turn in turns] == ["4", "0", "3", "1", "2", "4"]
    client = FakeSupabaseClient()
    rows = [
        {**_row(index, index * 1000, index * 1000 + 500, f"word{index}"), "speaker_label": turn.stable_label, "provider_speaker_id": turn.speaker_id}
        for index, turn in enumerate(turns)
    ]
    attached = _attach_participants_to_transcript_rows(client, meeting_id="meeting-id", rows=rows)
    assert len(client.participants.rows) == 5
    assert attached[0]["participant_id"] == attached[5]["participant_id"]
    assert {row["metadata"]["provider_speaker_id"] for row in client.participants.rows} == {"0", "1", "2", "3", "4"}


def test_word_without_speaker_inherits_containing_utterance_speaker() -> None:
    payload = {
        "results": {
            "utterances": [
                {"id": "utterance-1", "speaker": 0, "start": 0, "end": 1, "confidence": 0.9}
            ],
            "channels": [
                {"alternatives": [{"words": [{"word": "hello", "start": 0.1, "end": 0.5}]}]}
            ],
        }
    }
    turns = diarization._deepgram_turns(payload)
    aligned = _align_words([_row(0, 100, 500, "hello")], turns)

    assert aligned[0]["provider_speaker_id"] == "0"
    assert aligned[0]["speaker_label"] == "deepgram:0"
    assert aligned[0]["diarization_assignment_source"] == "utterance_provider"
    assert aligned[0]["diarization_turn_id"] == "utterance-1:1"


def test_short_unknown_run_between_same_speaker_is_recovered_without_merging_boundaries() -> None:
    words = [
        _row(0, 0, 100, "left"),
        _row(1, 100, 200, "middle"),
        _row(2, 200, 300, "right"),
    ]
    turns = [
        DiarizedTurn("0", 0, 100, 0.9, turn_id="turn-1"),
        DiarizedTurn(None, 100, 200, None, turn_id="turn-2", identity_source="unknown"),
        DiarizedTurn("0", 200, 300, 0.9, turn_id="turn-3"),
    ]
    aligned = _align_words(words, turns)
    grouped = build_speaker_turn_rows(aligned)

    assert [word["provider_speaker_id"] for word in aligned] == ["0", "0", "0"]
    assert aligned[1]["diarization_assignment_source"] == "nearest_turn"
    assert len(grouped) == 3
    assert [row["diarization_turn_id"] for row in grouped] == ["turn-1", "turn-2", "turn-3"]


def test_unknown_run_between_different_speakers_stays_unknown() -> None:
    words = [
        _row(0, 0, 100, "left"),
        _row(1, 100, 200, "middle"),
        _row(2, 200, 300, "right"),
    ]
    turns = [
        DiarizedTurn("0", 0, 100, 0.9, turn_id="turn-1"),
        DiarizedTurn(None, 100, 200, None, turn_id="turn-2", identity_source="unknown"),
        DiarizedTurn("1", 200, 300, 0.9, turn_id="turn-3"),
    ]
    aligned = _align_words(words, turns)

    assert [word["provider_speaker_id"] for word in aligned] == ["0", None, "1"]
    assert aligned[1]["diarization_assignment_source"] == "unknown"


def test_overlapping_competing_speakers_stay_unknown() -> None:
    words = [_row(0, 100, 300, "overlap")]
    aligned = _align_words(
        words,
        [
            DiarizedTurn("0", 0, 300, 0.9, turn_id="turn-1"),
            DiarizedTurn("1", 100, 400, 0.9, turn_id="turn-2"),
        ],
    )

    assert aligned[0]["provider_speaker_id"] is None
    assert aligned[0]["diarization_ambiguous"] is True
    assert aligned[0]["diarization_assignment_source"] == "unknown"


def test_production_shaped_assignment_keeps_eighteen_boundaries() -> None:
    speaker_pattern = ["0", None, "1", "1", None, "2", "2", None, "0", "0", None, "1", "1", "2", None, "2", "0", "0"]
    utterance_derived = {3, 8, 13}
    words = [
        _row(index, index * 400, index * 400 + 300, f"word{index}")
        for index in range(18)
    ]
    turns = [
        DiarizedTurn(
            speaker,
            index * 400,
            index * 400 + 300,
            0.9 if speaker is not None else None,
            turn_id=f"turn-{index + 1}",
            boundary_source="utterance",
            identity_source=(
                "utterance_provider"
                if index in utterance_derived
                else "word_provider"
                if speaker is not None
                else "unknown"
            ),
        )
        for index, speaker in enumerate(speaker_pattern)
    ]
    aligned, grouped = _align_and_build_speaker_turn_rows(
        words,
        turns,
        minimum_confidence=0.5,
        minimum_overlap=0.5,
        nearest_turn_tolerance_ms=250,
    )

    assert len(grouped) == 18
    assert {word["provider_speaker_id"] for word in aligned if word["provider_speaker_id"] is not None} == {"0", "1", "2"}
    assert sum(word["provider_speaker_id"] is None for word in aligned) == 4
    assert sum(bool(word.get("diarization_recovered_from_neighbors")) for word in aligned) == 1
    assert sum(word["diarization_assignment_source"] == "utterance_provider" for word in aligned) == 3
    assert [row["segment_index"] for row in grouped] == list(range(18))
    assert " ".join(row["text"] for row in grouped).split() == [word["text"] for word in words]


def test_all_nested_deepgram_speakers_survive_parsing_and_participant_creation() -> None:
    payload = {
        "results": {
            "channels": [
                {
                    "alternatives": [
                        {
                            "words": [
                                {"word": "zero-a", "speaker": 0, "start": 0.0, "end": 0.4, "speaker_confidence": 0.95},
                                {"word": "one-a", "speaker": 1, "start": 0.4, "end": 0.8, "speaker_confidence": 0.95},
                                {"word": "zero-b", "speaker": 0, "start": 0.8, "end": 1.2, "speaker_confidence": 0.95},
                                {"word": "one-b", "speaker": 1, "start": 1.2, "end": 1.6, "speaker_confidence": 0.95},
                            ]
                        },
                        {
                            "words": [
                                {"word": "two", "speaker": 2, "start": 2.0, "end": 2.4, "speaker_confidence": 0.95}
                            ]
                        },
                    ]
                },
                {
                    "alternatives": [
                        {
                            "words": [
                                {"word": "one-c", "speaker": 1, "start": 2.8, "end": 3.2, "speaker_confidence": 0.95},
                                {"word": "three", "speaker": 3, "start": 3.6, "end": 4.0, "speaker_confidence": 0.95},
                            ]
                        }
                    ]
                },
            ],
            "utterances": [
                {"id": f"utterance-{index + 1}", "speaker": speaker, "start": start, "end": end}
                for index, (speaker, start, end) in enumerate(
                    ((0, 0.0, 0.4), (1, 0.4, 0.8), (0, 0.8, 1.2), (1, 1.2, 1.6), (2, 2.0, 2.4), (1, 2.8, 3.2), (3, 3.6, 4.0))
                )
            ],
        }
    }
    diagnostics = diarization._deepgram_raw_speaker_diagnostics(payload)
    turns = diarization._deepgram_turns(payload)
    word_rows = [
        _row(index, round(start * 1000), round(end * 1000), text)
        for index, (text, start, end) in enumerate(
            (("zero-a", 0.0, 0.4), ("one-a", 0.4, 0.8), ("zero-b", 0.8, 1.2), ("one-b", 1.2, 1.6), ("two", 2.0, 2.4), ("one-c", 2.8, 3.2), ("three", 3.6, 4.0))
        )
    ]
    aligned = _align_words(word_rows, turns)
    grouped = build_speaker_turn_rows(aligned)
    client = FakeSupabaseClient()
    attached = _attach_participants_to_transcript_rows(
        client, meeting_id="meeting-id", rows=grouped
    )

    assert diagnostics["raw_word_speaker_ids"] == ["0", "1", "2", "3"]
    assert diagnostics["raw_utterance_speaker_ids"] == ["0", "1", "2", "3"]
    assert diagnostics["combined_raw_speaker_ids"] == ["0", "1", "2", "3"]
    assert {turn.speaker_id for turn in turns} == {"0", "1", "2", "3"}
    assert len(client.participants.rows) == 4
    assert [row["display_name"] for row in client.participants.rows] == [
        "Speaker 1", "Speaker 2", "Speaker 3", "Speaker 4"
    ]
    assert attached[1]["participant_id"] == attached[3]["participant_id"] == attached[5]["participant_id"]
    assert [row["speaker_label"] for row in attached] == [
        "deepgram:0", "deepgram:1", "deepgram:0", "deepgram:1", "deepgram:2", "deepgram:1", "deepgram:3"
    ]


def test_missing_deepgram_speaker_remains_unknown_instead_of_zero() -> None:
    payload = {
        "results": {
            "channels": [{"alternatives": [{"words": [{"word": "unknown", "start": 0, "end": 0.5}]}]}],
            "utterances": [{"id": "utterance-1", "start": 0, "end": 0.5}],
        }
    }
    turns = diarization._deepgram_turns(payload)
    aligned = _align_words([_row(0, 0, 500, "unknown")], turns)

    assert turns[0].speaker_id is None
    assert aligned[0]["provider_speaker_id"] is None
    assert aligned[0]["speaker_label"] is None


def test_turn_merging_never_changes_any_of_four_speaker_identities() -> None:
    payload = {"results": {"channels": [{"alternatives": [{"words": [
        {"speaker": speaker, "start": index * 0.4, "end": index * 0.4 + 0.3}
        for index, speaker in enumerate((0, 0, 1, 1, 2, 2, 3, 3))
    ]}]}]}}
    turns = diarization._deepgram_turns(payload)

    assert [turn.speaker_id for turn in turns] == ["0", "1", "2", "3"]
    assert {turn.speaker_id for turn in turns} == {"0", "1", "2", "3"}
