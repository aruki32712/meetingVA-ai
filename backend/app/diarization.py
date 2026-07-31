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


def _milliseconds(value: Any) -> int:
    return max(0, round(float(value) * 1000))


def _optional_confidence(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None

    return float(value)


def _deepgram_turns(payload: dict[str, Any]) -> list[DiarizedTurn]:
    channels = payload.get("results", {}).get("channels", [])
    alternatives = channels[0].get("alternatives", []) if channels else []
    words = alternatives[0].get("words", []) if alternatives else []
    turns: list[DiarizedTurn] = []
    confidence_values: list[list[float]] = []

    for word in words:
        if not isinstance(word, dict) or word.get("speaker") is None:
            continue

        speaker_id = f"deepgram:{word['speaker']}"
        start_ms = _milliseconds(word.get("start", 0))
        end_ms = max(start_ms, _milliseconds(word.get("end", 0)))
        confidence = _optional_confidence(word.get("speaker_confidence"))

        if turns and turns[-1].speaker_id == speaker_id:
            values = confidence_values[-1]
            if confidence is not None:
                values.append(confidence)
            turns[-1] = DiarizedTurn(
                speaker_id=speaker_id,
                start_ms=turns[-1].start_ms,
                end_ms=end_ms,
                confidence=sum(values) / len(values) if values else None,
            )
            continue

        confidence_values.append([confidence] if confidence is not None else [])
        turns.append(
            DiarizedTurn(
                speaker_id=speaker_id,
                start_ms=start_ms,
                end_ms=end_ms,
                confidence=confidence,
            )
        )

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

    async with httpx.AsyncClient(timeout=180) as client:
        response = await client.post(
            "https://api.deepgram.com/v1/listen",
            params={"diarize_model": "latest"},
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": content_type,
            },
            content=audio_bytes,
        )

    if response.status_code >= 400:
        raise RuntimeError(
            f"Deepgram diarization request failed with status {response.status_code}"
        )

    return _deepgram_turns(response.json())


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
        extra={**status, "diarization_attempted": True, "audio_filename": filename},
    )

    try:
        turns = await diarize_audio(audio_bytes, filename, content_type)
        logger.info(
            "Hosted speaker diarization completed",
            extra={
                **status,
                "diarization_attempted": True,
                "diarized_turn_count": len(turns),
                "diarized_speaker_count": len(
                    {turn.speaker_id for turn in turns}
                ),
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
                "speaker_label": turn.speaker_id,
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
            turn.speaker_id for _, turn in eligible_candidates
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
            and candidates[1][1].speaker_id != best_turn.speaker_id
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
            best_turn.speaker_id
            if best_turn is not None
            and not ambiguous
            and sufficient_overlap
            and sufficient_confidence
            else None
        )
        aligned_rows.append(aligned)

    for index, row in enumerate(aligned_rows):
        row["segment_index"] = index

    return aligned_rows
