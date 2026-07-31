import logging
from dataclasses import dataclass
from typing import Any

import httpx

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


async def diarize_audio(
    *,
    audio_bytes: bytes,
    filename: str,
    content_type: str,
    provider: str,
    api_key: str = "",
) -> list[DiarizedTurn]:
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
    *,
    audio_bytes: bytes,
    filename: str,
    content_type: str,
    provider: str,
    api_key: str = "",
) -> list[DiarizedTurn]:
    try:
        return await diarize_audio(
            audio_bytes=audio_bytes,
            filename=filename,
            content_type=content_type,
            provider=provider,
            api_key=api_key,
        )
    except Exception as exc:
        logger.exception(
            "Speaker diarization failed; continuing without provider labels",
            extra={
                "diarization_provider": provider,
                "audio_filename": filename,
                "exception_type": type(exc).__name__,
            },
        )
        return []


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

    return aligned_rows
