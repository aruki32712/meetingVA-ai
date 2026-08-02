import logging
from dataclasses import dataclass
from typing import Any

import httpx

from app.settings import get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class DiarizedTurn:
    speaker_id: str
    start_ms: int
    end_ms: int
    confidence: float | None = None
    provider: str = "deepgram"

    @property
    def stable_label(self) -> str:
        return self.speaker_id if ":" in self.speaker_id else f"{self.provider}:{self.speaker_id}"


def _milliseconds(value: Any) -> int:
    return max(0, round(float(value) * 1000))


def _optional_confidence(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None

    return float(value)


def _valid_turn(speaker: Any, start: Any, end: Any, confidence: Any) -> DiarizedTurn | None:
    if speaker is None or isinstance(speaker, bool):
        return None
    try:
        start_ms = _milliseconds(start)
        end_ms = _milliseconds(end)
    except (TypeError, ValueError):
        return None
    if end_ms <= start_ms:
        return None
    return DiarizedTurn(str(speaker), start_ms, end_ms, _optional_confidence(confidence))


def _deepgram_units(payload: dict[str, Any]) -> tuple[list[DiarizedTurn], str]:
    results = payload.get("results", {})
    utterances = results.get("utterances", [])
    units = [
        turn for item in utterances if isinstance(item, dict)
        if (turn := _valid_turn(item.get("speaker"), item.get("start"), item.get("end"), item.get("confidence"))) is not None
    ]
    channels = results.get("channels", [])
    words: list[Any] = []
    for channel in channels if isinstance(channels, list) else []:
        alternatives = channel.get("alternatives", []) if isinstance(channel, dict) else []
        if alternatives and isinstance(alternatives[0], dict):
            words.extend(alternatives[0].get("words", []) or [])
    word_units = [
        turn for word in words if isinstance(word, dict)
        if (turn := _valid_turn(word.get("speaker"), word.get("start"), word.get("end"), word.get("speaker_confidence"))) is not None
    ]
    return (word_units, "results.channels[*].alternatives[*].words[*].speaker") if word_units else (units, "results.utterances[*].speaker")


def _deepgram_turns(payload: dict[str, Any], *, maximum_gap_ms: int = 750) -> list[DiarizedTurn]:
    units, _ = _deepgram_units(payload)
    turns: list[DiarizedTurn] = []
    confidence_values: list[list[float]] = []

    for unit in sorted(units, key=lambda turn: (turn.start_ms, turn.end_ms)):
        if turns and turns[-1].speaker_id == unit.speaker_id and unit.start_ms - turns[-1].end_ms <= maximum_gap_ms:
            values = confidence_values[-1]
            if unit.confidence is not None:
                values.append(unit.confidence)
            turns[-1] = DiarizedTurn(
                speaker_id=unit.speaker_id,
                start_ms=turns[-1].start_ms,
                end_ms=max(turns[-1].end_ms, unit.end_ms),
                confidence=sum(values) / len(values) if values else None,
            )
            continue

        confidence_values.append([unit.confidence] if unit.confidence is not None else [])
        turns.append(unit)

    return turns


async def _diarize_with_deepgram(
    *,
    audio_bytes: bytes,
    filename: str,
    content_type: str,
    api_key: str,
) -> list[DiarizedTurn]:
    if not api_key:
        raise RuntimeError("Deepgram diarization API key is not configured")

    settings = get_settings()
    model = settings.diarization_model
    logger.info("Sending audio to Deepgram diarization", extra={"audio_filename": filename, "audio_content_type": content_type, "audio_byte_count": len(audio_bytes), "diarization_model": model, "diarization_requested": True})
    async with httpx.AsyncClient(timeout=180) as client:
        response = await client.post(
            "https://api.deepgram.com/v1/listen",
            params={"diarize": "true", "utterances": "true", "punctuate": "true", "smart_format": "true", "model": model},
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": content_type,
            },
            content=audio_bytes,
        )

    logger.info("Deepgram diarization response received", extra={"deepgram_http_status": response.status_code, "diarization_model": model})
    if response.status_code >= 400:
        raise RuntimeError(
            f"Deepgram diarization request failed with status {response.status_code}"
        )

    payload = response.json()
    turns = _deepgram_turns(payload, maximum_gap_ms=settings.diarization_maximum_turn_gap_ms)
    units, response_path = _deepgram_units(payload)
    results = payload.get("results", {})
    channels = results.get("channels", []) or []
    paragraphs = sum(len(((channel.get("alternatives") or [{}])[0].get("paragraphs") or {}).get("paragraphs", []) or []) for channel in channels if isinstance(channel, dict))
    utterances = results.get("utterances", []) or []
    words = sum(len((channel.get("alternatives") or [{}])[0].get("words", []) or []) for channel in channels if isinstance(channel, dict))
    logger.info("Deepgram diarization payload parsed", extra={"deepgram_channel_count": len(channels), "deepgram_paragraph_count": paragraphs, "deepgram_utterance_count": len(utterances), "deepgram_word_count": words, "diarized_turn_count": len(turns), "diarized_unit_count": len(units), "diarized_unique_speaker_ids": sorted({turn.speaker_id for turn in turns}), "diarized_speaker_count": len({turn.speaker_id for turn in turns}), "diarized_first_timestamp_ms": turns[0].start_ms if turns else None, "diarized_last_timestamp_ms": turns[-1].end_ms if turns else None, "deepgram_speaker_response_path": response_path})
    return turns


def diarization_status() -> dict[str, str | bool]:
    settings = get_settings()
    provider = settings.diarization_provider.strip().casefold()
    enabled = provider not in {"", "none", "disabled"}
    credentials_configured = bool(settings.diarization_api_key.strip())
    return {
        "diarization_provider": provider or "none",
        "diarization_enabled": enabled,
        "diarization_credentials_configured": credentials_configured,
    }


async def diarize_audio(
    audio_bytes: bytes,
    filename: str,
    content_type: str,
) -> list[DiarizedTurn]:
    settings = get_settings()
    provider = settings.diarization_provider
    api_key = settings.diarization_api_key
    normalized_provider = provider.strip().casefold()

    if normalized_provider in {"", "none", "disabled"}:
        return []

    if normalized_provider == "deepgram":
        return await _diarize_with_deepgram(
            audio_bytes=audio_bytes,
            filename=filename,
            content_type=content_type,
            api_key=api_key,
        )

    raise RuntimeError(f"Unsupported diarization provider: {provider}")


async def diarize_audio_safely(
    audio_bytes: bytes,
    filename: str,
    content_type: str,
) -> list[DiarizedTurn]:
    status = diarization_status()

    if not status["diarization_enabled"]:
        logger.info(
            "Speaker diarization disabled; using Unknown Speaker fallback.",
            extra={
                **status,
                "diarization_attempted": False,
                "diarized_turn_count": 0,
                "diarized_speaker_count": 0,
            },
        )
        return []

    logger.info(
        "Attempting hosted speaker diarization",
        extra={**status, "diarization_attempted": True, "audio_filename": filename, "audio_content_type": content_type, "audio_byte_count": len(audio_bytes)},
    )

    try:
        turns = await diarize_audio(audio_bytes, filename, content_type)
        logger.info(
            "Hosted speaker diarization completed",
            extra={
                **status,
                "diarization_attempted": True,
                "diarized_turn_count": len(turns),
                "diarized_speaker_count": len({turn.speaker_id for turn in turns}),
                "diarized_unique_speaker_ids": sorted({turn.speaker_id for turn in turns}),
            },
        )
        return turns
    except Exception as exc:
        logger.exception(
            "Speaker diarization failed; continuing without provider labels",
            extra={
                **status,
                "audio_filename": filename,
                "diarization_attempted": True,
                "diarized_turn_count": 0,
                "diarized_speaker_count": 0,
                "exception_type": type(exc).__name__,
            },
        )
        return []


def _split_text_by_weights(text: Any, weights: list[int]) -> list[str | None]:
    normalized = " ".join(str(text or "").split())

    if not normalized:
        return [None] * len(weights)

    words = normalized.split(" ")
    total_weight = max(1, sum(weights))
    boundaries = [0]
    cumulative_weight = 0

    for weight in weights[:-1]:
        cumulative_weight += weight
        boundaries.append(round(len(words) * cumulative_weight / total_weight))

    boundaries.append(len(words))
    return [
        " ".join(words[boundaries[index] : boundaries[index + 1]]) or None
        for index in range(len(weights))
    ]


def _split_row_at_diarized_turns(
    row: dict[str, Any],
    candidates: list[tuple[int, DiarizedTurn]],
) -> list[dict[str, Any]] | None:
    ordered = sorted(candidates, key=lambda candidate: candidate[1].start_ms)

    if any(
        current[1].end_ms > following[1].start_ms
        and current[1].speaker_id != following[1].speaker_id
        for current, following in zip(ordered, ordered[1:])
    ):
        return None

    pieces = [
        (
            max(int(row.get("start_ms") or 0), turn.start_ms),
            min(int(row.get("end_ms") or 0), turn.end_ms),
            turn,
            overlap,
        )
        for overlap, turn in ordered
    ]
    weights = [piece[3] for piece in pieces]
    split_values = {
        field: _split_text_by_weights(row.get(field), weights)
        for field in ("text", "original_text", "translated_text")
    }
    split_rows: list[dict[str, Any]] = []

    for index, (start_ms, end_ms, turn, _) in enumerate(pieces):
        split_row = dict(row)
        split_row.update(
            {
                "speaker_label": turn.stable_label,
                "diarization_confidence": turn.confidence,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "text": split_values["text"][index] or "",
                "original_text": split_values["original_text"][index],
                "translated_text": split_values["translated_text"][index],
            }
        )

        if split_row["text"]:
            split_rows.append(split_row)

    return split_rows or None


def align_transcript_rows_to_turns(
    rows: list[dict[str, Any]],
    turns: list[DiarizedTurn],
    *,
    minimum_confidence: float,
    minimum_overlap: float,
) -> list[dict[str, Any]]:
    aligned_rows: list[dict[str, Any]] = []

    for row in rows:
        aligned = dict(row)
        start_ms = int(row.get("start_ms") or 0)
        end_ms = max(start_ms, int(row.get("end_ms") or 0))
        duration_ms = max(1, end_ms - start_ms)
        candidates: list[tuple[int, DiarizedTurn]] = []

        for turn in turns:
            overlap_ms = max(
                0,
                min(end_ms, turn.end_ms) - max(start_ms, turn.start_ms),
            )

            if overlap_ms:
                candidates.append((overlap_ms, turn))

        candidates.sort(key=lambda candidate: candidate[0], reverse=True)
        eligible_candidates = [
            candidate
            for candidate in candidates
            if candidate[1].confidence is None
            or candidate[1].confidence >= minimum_confidence
        ]
        distinct_speakers = {
            turn.stable_label for _, turn in eligible_candidates
        }
        covered_duration = sum(overlap for overlap, _ in eligible_candidates)

        if (
            len(distinct_speakers) > 1
            and covered_duration / duration_ms >= minimum_overlap
        ):
            split_rows = _split_row_at_diarized_turns(row, eligible_candidates)

            if split_rows is not None:
                aligned_rows.extend(split_rows)
                continue

        best_overlap, best_turn = candidates[0] if candidates else (0, None)
        ambiguous = (
            len(candidates) > 1
            and candidates[1][0] == best_overlap
            and best_turn is not None
            and candidates[1][1].stable_label != best_turn.stable_label
        )
        sufficient_overlap = best_overlap / duration_ms >= minimum_overlap
        sufficient_confidence = (
            best_turn is not None
            and (
                best_turn.confidence is None
                or best_turn.confidence >= minimum_confidence
            )
        )

        aligned["speaker_label"] = (
            best_turn.stable_label
            if best_turn is not None
            and not ambiguous
            and sufficient_overlap
            and sufficient_confidence
            else None
        )
        aligned["diarization_confidence"] = (
            best_turn.confidence if aligned["speaker_label"] else None
        )
        aligned["provider_speaker_id"] = best_turn.speaker_id if aligned["speaker_label"] else None
        aligned["diarization_available"] = bool(turns)
        aligned_rows.append(aligned)

    for index, row in enumerate(aligned_rows):
        row["segment_index"] = index

    return aligned_rows


def align_words_to_diarization(
    transcript_words: list[dict[str, Any]],
    diarized_turns: list[DiarizedTurn],
    *,
    minimum_confidence: float,
    minimum_overlap: float,
    nearest_turn_tolerance_ms: int = 250,
) -> list[dict[str, Any]]:
    """Assign each timestamped transcript word to a provider speaker turn.

    Text remains authoritative from the transcription provider. Diarization only
    supplies speaker identity; it never causes words to be invented or reordered.
    """
    aligned_words: list[dict[str, Any]] = []
    ordered_turns = sorted(diarized_turns, key=lambda turn: (turn.start_ms, turn.end_ms))

    for word in sorted(transcript_words, key=lambda item: (int(item.get("start_ms") or 0), int(item.get("end_ms") or 0))):
        aligned = dict(word)
        start_ms = int(word.get("start_ms") or 0)
        end_ms = max(start_ms, int(word.get("end_ms") or 0))
        duration_ms = max(1, end_ms - start_ms)
        midpoint_ms = start_ms + duration_ms / 2
        candidates: list[tuple[int, DiarizedTurn]] = []

        for turn in ordered_turns:
            if turn.confidence is not None and turn.confidence < minimum_confidence:
                continue
            overlap_ms = max(0, min(end_ms, turn.end_ms) - max(start_ms, turn.start_ms))
            if overlap_ms > 0:
                candidates.append((overlap_ms, turn))

        candidates.sort(key=lambda item: item[0], reverse=True)
        selected: DiarizedTurn | None = None
        ambiguous = False
        if candidates:
            best_overlap, best_turn = candidates[0]
            midpoint_turns = [turn for _, turn in candidates if turn.start_ms <= midpoint_ms < turn.end_ms]
            overlapping_speakers = any(
                first_turn.stable_label != second_turn.stable_label
                and max(first_turn.start_ms, second_turn.start_ms) < min(first_turn.end_ms, second_turn.end_ms)
                for _, first_turn in candidates
                for _, second_turn in candidates
            )
            ambiguous = (
                len({turn.stable_label for turn in midpoint_turns}) > 1
                or overlapping_speakers
            )
            if not ambiguous and (
                best_overlap / duration_ms >= minimum_overlap
                or best_turn.start_ms <= midpoint_ms < best_turn.end_ms
            ):
                selected = best_turn
        elif nearest_turn_tolerance_ms:
            distances = [
                (min(abs(start_ms - turn.end_ms), abs(end_ms - turn.start_ms)), turn)
                for turn in ordered_turns
                if turn.confidence is None or turn.confidence >= minimum_confidence
            ]
            distances.sort(key=lambda item: item[0])
            if distances and distances[0][0] <= nearest_turn_tolerance_ms:
                tied = len(distances) > 1 and distances[1][0] == distances[0][0]
                if not tied:
                    selected = distances[0][1]

        aligned["speaker_label"] = selected.stable_label if selected else None
        aligned["provider_speaker_id"] = selected.speaker_id if selected else None
        aligned["diarization_confidence"] = selected.confidence if selected else None
        aligned["diarization_ambiguous"] = ambiguous
        aligned["diarization_available"] = bool(ordered_turns)
        aligned_words.append(aligned)

    return aligned_words


def development_diarization_diagnostics(
    turns: list[DiarizedTurn],
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Return abbreviated diagnostics for development logs and test utilities."""
    return {
        "provider_turns": [
            [turn.start_ms, turn.end_ms, turn.speaker_id] for turn in turns
        ],
        "aligned_transcript_turns": [
            [
                row.get("start_ms"),
                row.get("end_ms"),
                row.get("speaker_label") or "Unknown Speaker",
                (_normalize_diagnostic_text(row.get("text")))[:48],
            ]
            for row in rows
        ],
    }


def _normalize_diagnostic_text(value: Any) -> str:
    return " ".join(str(value or "").split())
