import asyncio
import logging
import httpx

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
        DiarizedTurn("0", 0, 800, 0.9),
        DiarizedTurn("1", 800, 1200, 0.9),
    ]


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


def test_fifty_consecutive_provider_words_become_one_turn() -> None:
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
    assert len(turns) == 1
    assert {turn.speaker_id for turn in turns} == {"0"}


def test_deepgram_request_enables_diarization_and_sends_original_audio(monkeypatch) -> None:
    observed: dict[str, object] = {}
    async def handler(request: httpx.Request) -> httpx.Response:
        observed["query"] = dict(request.url.params)
        observed["content_type"] = request.headers.get("content-type")
        observed["body"] = await request.aread()
        return httpx.Response(200, json={"results": {"channels": [{"alternatives": [{"words": [{"speaker": 0, "start": 0, "end": 1}]}]}]}})
    real_client = httpx.AsyncClient
    monkeypatch.setattr(diarization.httpx, "AsyncClient", lambda *args, **kwargs: real_client(*args, transport=httpx.MockTransport(handler), **kwargs))
    monkeypatch.setattr(diarization, "get_settings", lambda: type("Settings", (), {"diarization_model": "nova-3", "diarization_maximum_turn_gap_ms": 750})())
    turns = asyncio.run(diarization._diarize_with_deepgram(audio_bytes=b"original-audio", filename="recording.webm", content_type="audio/webm", api_key="secret"))
    assert observed["query"] == {"diarize": "true", "utterances": "true", "punctuate": "true", "smart_format": "true", "model": "nova-3"}
    assert observed["content_type"] == "audio/webm"
    assert observed["body"] == b"original-audio"
    assert turns[0].speaker_id == "0"
