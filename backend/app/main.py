import asyncio
import json
import logging
import mimetypes
import re
import time
from collections import Counter, defaultdict, deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator, model_validator

from app.diarization import (
    align_words_to_diarization,
    align_transcript_rows_to_turns,
    development_diarization_diagnostics,
    diarize_audio_safely,
)
from app.supabase_client import get_supabase_anon_client, get_supabase_service_client
from app.settings import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)
RateLimitKey = tuple[str, str]
ai_rate_limit_events: dict[RateLimitKey, deque[float]] = defaultdict(deque)
CORS_ORIGIN_REGEX = (
    r"https://[a-z0-9-]+-aruki32712-1048s-projects\.vercel\.app"
)
CORS_ALLOWED_ORIGINS = list(
    dict.fromkeys(
        [
            *settings.allowed_cors_origins,
            "http://localhost:3000",
            "https://meetingva-ai.vercel.app",
            "https://aruki32712-meetingva-ai.vercel.app",
            "https://meeting-va-ai.vercel.app",
        ]
    )
)

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Initial MeetingVA AI API scaffold.",
)

@app.middleware("http")
async def add_security_headers(request: Request, call_next: Any) -> Response:
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault(
        "Permissions-Policy",
        "microphone=(), camera=(), geolocation=()",
    )

    if request.url.scheme == "https":
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )

    return response


@app.exception_handler(HTTPException)
async def safe_http_exception_handler(
    request: Request,
    exc: HTTPException,
) -> Response:
    return await http_exception_handler(request, exc)


@app.exception_handler(Exception)
async def safe_unhandled_exception_handler(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    logger.exception("Unhandled backend error for %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error."},
    )


class UpdateParticipantRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)

    @field_validator("display_name")
    @classmethod
    def display_name_must_have_text(cls, value: str) -> str:
        display_name = value.strip()

        if not display_name:
            raise ValueError("Speaker name cannot be empty.")

        return display_name


class UpdateTranscriptSegmentRequest(BaseModel):
    text: str = Field(min_length=1)

    @field_validator("text")
    @classmethod
    def text_must_have_content(cls, value: str) -> str:
        text = " ".join(value.split())
        if not text:
            raise ValueError("Transcript text cannot be empty.")
        return text


class MergeParticipantsRequest(BaseModel):
    source_participant_id: str
    target_participant_id: str


class AssignTranscriptSegmentsRequest(BaseModel):
    segment_ids: list[str] = Field(min_length=1)
    target_participant_id: str | None = None
    display_name: str | None = Field(default=None, max_length=120)


class SplitParticipantRequest(BaseModel):
    segment_ids: list[str] = Field(min_length=1)
    display_name: str | None = Field(default=None, max_length=120)


class SplitTranscriptPartRequest(BaseModel):
    text: str = Field(min_length=1)
    participant_id: str | None = None
    display_name: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def validate_speaker_assignment(self) -> "SplitTranscriptPartRequest":
        self.text = self.text.strip()
        self.display_name = _coerce_optional_text(self.display_name)
        if not self.text:
            raise ValueError("Split parts cannot be empty.")
        if bool(self.participant_id) == bool(self.display_name):
            raise ValueError(
                "Every split part requires exactly one speaker assignment."
            )
        return self


class SplitTranscriptSegmentRequest(BaseModel):
    parts: list[SplitTranscriptPartRequest] = Field(min_length=2)


class TranscribeMeetingRequest(BaseModel):
    translate_to_english: bool = False


TranslationSection = Literal[
    "transcript", "summary", "brief", "action_items", "decisions", "questions"
]


class TranslateMeetingRequest(BaseModel):
    target_language: str = Field(default="english", min_length=2, max_length=40)
    sections: list[TranslationSection] = Field(min_length=1)

    @field_validator("target_language")
    @classmethod
    def normalize_target_language(cls, value: str) -> str:
        return value.strip().lower()


class ExportSections(BaseModel):
    meeting_details: bool = True
    executive_summary: bool = True
    meeting_brief: bool = True
    speakers: bool = False
    transcript: bool = True
    timestamps: bool = False
    action_items: bool = True
    decisions: bool = True
    questions: bool = True
    tags: bool = False
    processing_timeline: bool = False


class ExportMeetingRequest(BaseModel):
    format: Literal["pdf", "docx", "md", "txt", "json"]
    language: Literal["original", "english"] = "original"
    sections: ExportSections

    @model_validator(mode="after")
    def require_export_content(self) -> "ExportMeetingRequest":
        values = self.sections.model_dump(exclude={"timestamps"})
        if not any(values.values()):
            raise ValueError("Select at least one section to export.")
        return self


class JobResponse(BaseModel):
    meeting_id: str
    job_id: str
    processing_status: str


ACTIVE_PROCESSING_STATUSES = {"queued", "transcribing", "analyzing"}
TERMINAL_PROCESSING_STATUSES = {"transcribed", "analyzed", "failed", "cancelled"}
TRANSCRIPTION_ACTIVE_STATUSES = {"queued", "transcribing"}
TRANSCRIPTION_COMPLETED_STATUSES = {"transcribed"}

TRANSCRIPTION_QUOTA_ERROR = (
    "Transcription is temporarily unavailable because the AI service quota has "
    "been reached. Please try again later or contact the administrator."
)
TRANSCRIPTION_RATE_LIMIT_ERROR = (
    "The transcription service is busy. Please try again in a few minutes."
)
TRANSCRIPTION_AUDIO_ERROR = (
    "This audio file could not be processed. Please upload a supported audio "
    "format and try again."
)
TRANSCRIPTION_MISSING_AUDIO_ERROR = "No audio file was found for this meeting."
TRANSCRIPTION_CONFIGURATION_ERROR = (
    "Transcription is currently unavailable due to a service configuration issue."
)
TRANSCRIPTION_UNKNOWN_ERROR = (
    "We couldn’t generate the transcript. Please try again."
)


MEETING_CASCADE_TABLES = (
    "processing_jobs",
    "processing_events",
    "transcript_segments",
    "participants",
    "action_items",
    "decisions",
    "questions",
    "attachments",
    "meeting_tags",
)
MEETING_DETACHED_TABLES = ("audit_logs",)
MAX_SAME_SPEAKER_PAUSE_MS = 1500
MAX_MERGED_TRANSCRIPT_CHARACTERS = 1000
MAX_MERGED_TRANSCRIPT_DURATION_MS = 45000
MAX_SPEAKER_TURN_WORD_GAP_MS = 1500
MAX_SPEAKER_TURN_DURATION_MS = 60000
MAX_SPEAKER_TURN_CHARACTERS = 1500
UNKNOWN_SPEAKER_LABEL = "Unknown Speaker"


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "meetingva-ai-backend",
        "environment": settings.environment,
    }


def _require_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header.")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Invalid authorization header.")

    return token


def _require_configured(value: str, name: str) -> str:
    if not value or value.startswith("your-") or "your-" in value:
        raise HTTPException(status_code=500, detail=f"Missing server setting: {name}")

    return value


def _validate_uuid(value: str, field_name: str) -> str:
    try:
        return str(UUID(value))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid {field_name}.") from exc


def _enforce_ai_rate_limit(user_id: str, action: str) -> None:
    limit = max(1, settings.ai_rate_limit_requests)
    window_seconds = max(1, settings.ai_rate_limit_window_seconds)
    now = time.monotonic()
    events = ai_rate_limit_events[(user_id, action)]

    while events and now - events[0] >= window_seconds:
        events.popleft()

    if len(events) >= limit:
        raise HTTPException(
            status_code=429,
            detail="Too many AI requests. Please wait before trying again.",
        )

    events.append(now)


def _enforce_export_rate_limit(user_id: str) -> None:
    limit = 5
    window_seconds = 60
    now = time.monotonic()
    events = ai_rate_limit_events[(user_id, "export")]
    while events and now - events[0] >= window_seconds:
        events.popleft()
    if len(events) >= limit:
        raise HTTPException(
            status_code=429,
            detail="Too many export requests. Please wait before trying again.",
        )
    events.append(now)


def _coerce_segment_timestamp(value: Any) -> int:
    if value is None:
        return 0

    return max(0, round(float(value) * 1000))


def _extract_speaker_label(segment: dict[str, Any]) -> str | None:
    for key in ("speaker_label", "speaker", "speaker_id"):
        raw_value = segment.get(key)

        if raw_value is None or isinstance(raw_value, bool):
            continue

        value = str(raw_value).strip()

        if value:
            return value

    return None


def _normalize_speaker_label(value: Any) -> str | None:
    label = _coerce_optional_text(value)
    return " ".join(label.split()).casefold() if label else None


def _normalize_transcript_spacing(value: Any) -> str | None:
    text = _coerce_optional_text(value)
    return " ".join(text.split()) if text else None


def _join_transcript_tokens(left: Any, right: Any) -> str | None:
    left_text = _coerce_optional_text(left)
    right_text = _coerce_optional_text(right)
    if (
        left_text
        and right_text in {",", ".", ";", ":", "!", "?"}
        and left_text.endswith(right_text)
    ):
        right_text = None
    combined = " ".join(value for value in (left_text, right_text) if value)
    if not combined:
        return None
    combined = re.sub(r"\s+([,.;:!?%\)\]\}])", r"\1", combined)
    combined = re.sub(r"([\(\[\{])\s+", r"\1", combined)
    combined = re.sub(
        r"\b(\w+)\s+(['\u2019](?:s|t|re|ve|ll|d|m))\b",
        r"\1\2",
        combined,
        flags=re.IGNORECASE,
    )
    return " ".join(combined.split())


def _segment_confidence(segment: dict[str, Any]) -> float | None:
    value = segment.get("confidence")

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None

    return float(value)


def _normalize_provider_speaker_id(value: Any) -> str | None:
    if value is None or isinstance(value, bool):
        return None
    normalized = str(value).strip()
    if not normalized:
        return None
    return normalized.split(":", 1)[1] if normalized.startswith("deepgram:") else normalized


def _normalize_word_speaker_label(
    value: Any, provider_speaker_id: str | None
) -> str | None:
    label = _coerce_optional_text(value)
    if provider_speaker_id is None and (
        label is None or label.casefold() == UNKNOWN_SPEAKER_LABEL.casefold()
    ):
        return None
    return label


def _word_grouping_identity(word: dict[str, Any]) -> tuple[str, str, str | int]:
    provider_speaker_id = _normalize_provider_speaker_id(
        word.get("provider_speaker_id")
    )
    turn_identity: str | int = (
        str(word["diarization_turn_id"])
        if word.get("diarization_turn_id")
        else int(word.get("diarization_boundary_index") or 0)
    )
    if provider_speaker_id is not None:
        return ("provider", provider_speaker_id, turn_identity)
    return ("unknown", "anonymous", turn_identity)


def build_speaker_turn_rows(
    aligned_words: list[dict[str, Any]],
    *,
    maximum_word_gap_ms: int = MAX_SPEAKER_TURN_WORD_GAP_MS,
    maximum_turn_duration_ms: int = MAX_SPEAKER_TURN_DURATION_MS,
    maximum_turn_characters: int = MAX_SPEAKER_TURN_CHARACTERS,
    diagnostics: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Rebuild timestamped, speaker-aligned words into readable turns."""
    turns: list[dict[str, Any]] = []
    confidence_values: list[float] = []
    split_by_pause = 0
    split_by_size_limit = 0
    speaker_transitions = 0
    adjacent_pair_count = 0

    def start_turn(word: dict[str, Any]) -> dict[str, Any]:
        nonlocal confidence_values
        confidence = _segment_confidence(word)
        confidence_values = [confidence] if confidence is not None else []
        provider_speaker_id = _normalize_provider_speaker_id(
            word.get("provider_speaker_id")
        )
        return {
            "meeting_id": word.get("meeting_id"),
            "speaker_label": _normalize_word_speaker_label(
                word.get("speaker_label"), provider_speaker_id
            ),
            "provider_speaker_id": provider_speaker_id,
            "diarization_turn_id": word.get("diarization_turn_id"),
            "_grouping_identity": _word_grouping_identity(word),
            "start_ms": int(word.get("start_ms") or 0),
            "end_ms": int(word.get("end_ms") or 0),
            "text": _normalize_transcript_spacing(word.get("text")) or "",
            "original_text": _normalize_transcript_spacing(word.get("original_text")),
            "translated_text": _normalize_transcript_spacing(word.get("translated_text")),
            "transcript_kind": word.get("transcript_kind"),
            "confidence": confidence,
            "diarization_available": bool(word.get("diarization_available")),
            "diarization_ambiguous": bool(word.get("diarization_ambiguous")),
            "diarization_assignment_sources": [
                str(word.get("diarization_assignment_source") or "unknown")
            ],
            "diarization_raw_speaker_ids": sorted(
                {str(value) for value in word.get("diarization_raw_speaker_ids", [])}
            ),
            "diarization_raw_word_speaker_ids": sorted(
                {str(value) for value in word.get("diarization_raw_word_speaker_ids", [])}
            ),
            "diarization_raw_utterance_speaker_ids": sorted(
                {str(value) for value in word.get("diarization_raw_utterance_speaker_ids", [])}
            ),
            "diarization_parsed_turn_speaker_ids": sorted(
                {str(value) for value in word.get("diarization_parsed_turn_speaker_ids", [])}
            ),
            "diarization_aligned_word_speaker_ids": (
                [provider_speaker_id] if provider_speaker_id is not None else []
            ),
            "source_word_count": 1,
            "segment_index": len(turns),
        }

    current: dict[str, Any] | None = None
    ordered_words = sorted(
        aligned_words,
        key=lambda word: (
            int(word.get("start_ms") or 0),
            int(word.get("end_ms") or 0),
            int(word.get("segment_index") or 0),
        ),
    )
    for raw_word in ordered_words:
        word = dict(raw_word)
        word["provider_speaker_id"] = _normalize_provider_speaker_id(
            word.get("provider_speaker_id")
        )
        word["speaker_label"] = _normalize_word_speaker_label(
            word.get("speaker_label"), word["provider_speaker_id"]
        )
        if current is None:
            current = start_turn(word)
            continue

        word_start_ms = int(word.get("start_ms") or 0)
        word_end_ms = int(word.get("end_ms") or 0)
        word_gap_ms = word_start_ms - int(current.get("end_ms") or 0)
        joined = {
            field: _join_transcript_tokens(current.get(field), word.get(field))
            for field in ("text", "original_text", "translated_text")
        }
        same_speaker = (
            current.get("_grouping_identity") == _word_grouping_identity(word)
            and current.get("speaker_label") == word.get("speaker_label")
        )
        compatible_kind = current.get("transcript_kind") == word.get(
            "transcript_kind"
        )
        within_size = all(
            value is None or len(value) <= maximum_turn_characters
            for value in joined.values()
        )
        within_duration = (
            word_end_ms - int(current.get("start_ms") or 0)
            <= maximum_turn_duration_ms
        )
        unknown_pair = (
            current.get("provider_speaker_id") is None
            and word.get("provider_speaker_id") is None
        )
        grouping_is_safe = (
            unknown_pair
            or not current.get("diarization_ambiguous")
            and not word.get("diarization_ambiguous")
        )
        can_merge = (
            same_speaker
            and compatible_kind
            and word_gap_ms <= maximum_word_gap_ms
            and within_duration
            and within_size
            and grouping_is_safe
        )
        if adjacent_pair_count < 10:
            logger.info(
                "speaker pair index=%s left_provider=%s right_provider=%s left_label=%s right_label=%s pause_ms=%s same_provider=%s same_label=%s ambiguous=%s same_kind=%s within_pause=%s within_duration=%s within_characters=%s can_merge=%s",
                adjacent_pair_count,
                current.get("provider_speaker_id"),
                word.get("provider_speaker_id"),
                current.get("speaker_label"),
                word.get("speaker_label"),
                word_gap_ms,
                current.get("provider_speaker_id")
                == word.get("provider_speaker_id"),
                current.get("speaker_label") == word.get("speaker_label"),
                bool(
                    current.get("diarization_ambiguous")
                    or word.get("diarization_ambiguous")
                ),
                compatible_kind,
                word_gap_ms <= maximum_word_gap_ms,
                within_duration,
                within_size,
                can_merge,
            )
        adjacent_pair_count += 1
        if can_merge:
            current.update(joined)
            current["end_ms"] = max(int(current.get("end_ms") or 0), word_end_ms)
            confidence = _segment_confidence(word)
            if confidence is not None:
                confidence_values.append(confidence)
            current["confidence"] = (
                sum(confidence_values) / len(confidence_values)
                if confidence_values
                else None
            )
            assignment_source = str(
                word.get("diarization_assignment_source") or "unknown"
            )
            if assignment_source not in current["diarization_assignment_sources"]:
                current["diarization_assignment_sources"].append(assignment_source)
            current["diarization_raw_speaker_ids"] = sorted(
                set(current["diarization_raw_speaker_ids"])
                | {
                    str(value)
                    for value in word.get("diarization_raw_speaker_ids", [])
                }
            )
            for metadata_field in (
                "diarization_raw_word_speaker_ids",
                "diarization_raw_utterance_speaker_ids",
                "diarization_parsed_turn_speaker_ids",
            ):
                current[metadata_field] = sorted(
                    set(current[metadata_field])
                    | {str(value) for value in word.get(metadata_field, [])}
                )
            word_provider_id = _normalize_provider_speaker_id(
                word.get("provider_speaker_id")
            )
            if (
                word_provider_id is not None
                and word_provider_id
                not in current["diarization_aligned_word_speaker_ids"]
            ):
                current["diarization_aligned_word_speaker_ids"].append(
                    word_provider_id
                )
                current["diarization_aligned_word_speaker_ids"].sort()
            current["source_word_count"] += 1
            continue

        if same_speaker and word_gap_ms > maximum_word_gap_ms:
            split_by_pause += 1
        elif same_speaker and (not within_size or not within_duration):
            split_by_size_limit += 1
        elif current.get("provider_speaker_id") != word.get("provider_speaker_id"):
            speaker_transitions += 1
        turns.append(current)
        current = start_turn(word)

    if current is not None:
        turns.append(current)
    for index, turn in enumerate(turns):
        turn["segment_index"] = index
        turn.pop("_grouping_identity", None)

    if diagnostics is not None:
        durations = [
            max(0, int(turn["end_ms"]) - int(turn["start_ms"])) for turn in turns
        ]
        diagnostics.update(
            {
                "input_word_count": len(aligned_words),
                "aligned_word_count": len(ordered_words),
                "final_transcript_row_count": len(turns),
                "average_words_per_row": (
                    round(len(ordered_words) / len(turns), 2) if turns else 0
                ),
                "average_row_duration_ms": (
                    round(sum(durations) / len(durations)) if durations else 0
                ),
                "speaker_transition_count": speaker_transitions,
                "rows_split_by_pause": split_by_pause,
                "rows_split_by_size_limit": split_by_size_limit,
            }
        )
    return turns


def _align_and_build_speaker_turn_rows(
    word_rows: list[dict[str, Any]],
    diarized_turns: list[Any],
    *,
    minimum_confidence: float,
    minimum_overlap: float,
    nearest_turn_tolerance_ms: int,
    diagnostics: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    aligned_words = align_words_to_diarization(
        word_rows,
        diarized_turns,
        minimum_confidence=minimum_confidence,
        minimum_overlap=minimum_overlap,
        nearest_turn_tolerance_ms=nearest_turn_tolerance_ms,
    )
    assignment_sources = Counter(
        str(word.get("diarization_assignment_source") or "unknown")
        for word in aligned_words
    )
    ambiguous_word_count = sum(
        bool(word.get("diarization_ambiguous")) for word in aligned_words
    )
    rejected_by_overlap = sum(
        bool(word.get("diarization_rejected_by_overlap")) for word in aligned_words
    )
    rejected_by_confidence = sum(
        bool(word.get("diarization_rejected_by_confidence")) for word in aligned_words
    )
    current_assignments = sum(
        word.get("provider_speaker_id") is not None for word in aligned_words
    )
    before_confidence_filtering = current_assignments + rejected_by_confidence
    raw_provider_speaker_count = len(
        {
            str(turn.speaker_id)
            for turn in diarized_turns
            if turn.speaker_id is not None
        }
    )
    post_filter_speaker_count = len(
        {
            str(word["provider_speaker_id"])
            for word in aligned_words
            if word.get("provider_speaker_id") is not None
        }
    )
    recovered_neighbor_words = sum(
        bool(word.get("diarization_recovered_from_neighbors"))
        for word in aligned_words
    )
    unknown_duration_after_ms = sum(
        max(0, int(word.get("end_ms") or 0) - int(word.get("start_ms") or 0))
        for word in aligned_words
        if word.get("provider_speaker_id") is None
    )
    recovered_duration_ms = sum(
        max(0, int(word.get("end_ms") or 0) - int(word.get("start_ms") or 0))
        for word in aligned_words
        if word.get("diarization_recovered_from_neighbors")
    )
    logger.info(
        "diarization assignment diagnostics raw_provider_speaker_count=%s post_filter_speaker_count=%s current_assignments=%s assignments_before_confidence_filtering=%s rejected_solely_by_overlap=%s rejected_solely_by_confidence=%s ambiguous_word_count=%s recovered_neighbor_words=%s unknown_duration_before_ms=%s unknown_duration_after_ms=%s assignment_sources=%s",
        raw_provider_speaker_count,
        post_filter_speaker_count,
        current_assignments,
        before_confidence_filtering,
        rejected_by_overlap,
        rejected_by_confidence,
        ambiguous_word_count,
        recovered_neighbor_words,
        unknown_duration_after_ms + recovered_duration_ms,
        unknown_duration_after_ms,
        dict(sorted(assignment_sources.items())),
    )
    safe_context = {
        "input_word_row_count": len(aligned_words),
        "first_input_keys": sorted(aligned_words[0].keys()) if aligned_words else [],
        "unique_provider_speaker_ids": sorted(
            {
                provider_id
                for word in aligned_words
                if (
                    provider_id := _normalize_provider_speaker_id(
                        word.get("provider_speaker_id")
                    )
                )
            }
        ),
        "unique_speaker_labels": sorted(
            {str(word["speaker_label"]) for word in aligned_words if word.get("speaker_label")}
        ),
    }
    grouped_rows = build_speaker_turn_rows(
        aligned_words,
        diagnostics=diagnostics,
    )
    logger.info(
        "speaker turn grouping input_word_count=%s output_turn_count=%s unique_provider_speakers=%s unique_labels=%s",
        len(aligned_words),
        len(grouped_rows),
        safe_context["unique_provider_speaker_ids"],
        safe_context["unique_speaker_labels"],
    )
    detected_word_count = sum(
        _normalize_provider_speaker_id(word.get("provider_speaker_id")) is not None
        for word in aligned_words
    )
    unknown_word_count = len(aligned_words) - detected_word_count
    unknown_run_count = 0
    longest_unknown_word_run = 0
    current_unknown_run = 0
    previous_unknown_identity: tuple[str, str, str | int] | None = None
    previous_unknown_end_ms: int | None = None
    for word in aligned_words:
        identity = _word_grouping_identity(word)
        if identity[0] != "unknown":
            current_unknown_run = 0
            previous_unknown_identity = None
            previous_unknown_end_ms = None
            continue
        word_start_ms = int(word.get("start_ms") or 0)
        begins_run = (
            previous_unknown_identity != identity
            or previous_unknown_end_ms is None
            or word_start_ms - previous_unknown_end_ms
            > MAX_SPEAKER_TURN_WORD_GAP_MS
        )
        if begins_run:
            unknown_run_count += 1
            current_unknown_run = 1
        else:
            current_unknown_run += 1
        longest_unknown_word_run = max(
            longest_unknown_word_run, current_unknown_run
        )
        previous_unknown_identity = identity
        previous_unknown_end_ms = int(word.get("end_ms") or 0)
    detected_turn_count = sum(
        row.get("provider_speaker_id") is not None for row in grouped_rows
    )
    unknown_turn_count = len(grouped_rows) - detected_turn_count
    logger.info(
        "speaker unknown grouping detected_word_count=%s unknown_word_count=%s detected_turn_count=%s unknown_turn_count=%s longest_unknown_word_run=%s unknown_run_count=%s",
        detected_word_count,
        unknown_word_count,
        detected_turn_count,
        unknown_turn_count,
        longest_unknown_word_run,
        unknown_run_count,
    )
    anonymous_provider_turns = {
        turn.turn_id
        for turn in diarized_turns
        if turn.speaker_id is None and turn.turn_id is not None
    }
    logger.info(
        "diarization boundary preservation raw_provider_turn_count=%s raw_utterance_count=%s raw_speaker_id_count=%s anonymous_turn_count=%s final_transcript_turn_count=%s number_of_boundaries_preserved_without_speaker_id=%s",
        len(diarized_turns),
        len(
            {
                turn.turn_id.rsplit(":", 1)[0]
                for turn in diarized_turns
                if turn.boundary_source == "utterance" and turn.turn_id
            }
        ),
        len(
            {
                turn.speaker_id
                for turn in diarized_turns
                if turn.speaker_id is not None
            }
        ),
        len(anonymous_provider_turns),
        len(grouped_rows),
        len(anonymous_provider_turns),
    )
    return aligned_words, grouped_rows


def _merge_adjacent_speaker_segments(
    rows: list[dict[str, Any]],
    *,
    maximum_pause_ms: int = MAX_SAME_SPEAKER_PAUSE_MS,
    maximum_characters: int = MAX_MERGED_TRANSCRIPT_CHARACTERS,
    maximum_duration_ms: int = MAX_MERGED_TRANSCRIPT_DURATION_MS,
    diagnostics: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    merged_rows: list[dict[str, Any]] = []
    confidence_values: list[list[float]] = []
    split_by_pause = 0
    split_by_size_limit = 0
    speaker_transitions = 0

    for row in rows:
        candidate = dict(row)
        candidate["text"] = _normalize_transcript_spacing(candidate.get("text")) or ""
        candidate["original_text"] = _normalize_transcript_spacing(
            candidate.get("original_text")
        )
        candidate["translated_text"] = _normalize_transcript_spacing(
            candidate.get("translated_text")
        )
        confidence = candidate.get("confidence")
        candidate_confidences = (
            [float(confidence)]
            if isinstance(confidence, (int, float)) and not isinstance(confidence, bool)
            else []
        )

        if merged_rows:
            current = merged_rows[-1]
            current_label = _normalize_speaker_label(current.get("speaker_label"))
            candidate_label = _normalize_speaker_label(candidate.get("speaker_label"))
            pause_ms = int(candidate.get("start_ms") or 0) - int(
                current.get("end_ms") or 0
            )
            joined_values = {
                key: _join_transcript_tokens(current.get(key), candidate.get(key))
                for key in ("text", "original_text", "translated_text")
            }
            within_character_limit = all(
                value is None or len(value) <= maximum_characters
                for value in joined_values.values()
            )
            same_speaker = (
                current_label == candidate_label
                and current.get("provider_speaker_id")
                == candidate.get("provider_speaker_id")
            )
            within_duration_limit = (
                int(candidate.get("end_ms") or 0)
                - int(current.get("start_ms") or 0)
                <= maximum_duration_ms
            )
            can_merge = (
                same_speaker
                and (
                    current_label is not None
                    or not current.get("diarization_available")
                    and not candidate.get("diarization_available")
                )
                and pause_ms < maximum_pause_ms
                and current.get("transcript_kind") == candidate.get("transcript_kind")
                and within_character_limit
                and within_duration_limit
                and not current.get("diarization_ambiguous")
                and not candidate.get("diarization_ambiguous")
            )

            if can_merge:
                current.update(joined_values)
                current["end_ms"] = max(
                    int(current.get("end_ms") or 0),
                    int(candidate.get("end_ms") or 0),
                )
                confidence_values[-1].extend(candidate_confidences)
                current["confidence"] = (
                    sum(confidence_values[-1]) / len(confidence_values[-1])
                    if confidence_values[-1]
                    else None
                )
                continue

            if same_speaker and pause_ms >= maximum_pause_ms:
                split_by_pause += 1
            elif same_speaker and (
                not within_character_limit or not within_duration_limit
            ):
                split_by_size_limit += 1
            elif current.get("provider_speaker_id") != candidate.get(
                "provider_speaker_id"
            ):
                speaker_transitions += 1

        merged_rows.append(candidate)
        confidence_values.append(candidate_confidences)

    for index, row in enumerate(merged_rows):
        row["segment_index"] = index

    if diagnostics is not None:
        durations = [
            max(0, int(row.get("end_ms") or 0) - int(row.get("start_ms") or 0))
            for row in merged_rows
        ]
        diagnostics.update(
            {
                "input_word_count": len(rows),
                "aligned_word_count": len(rows),
                "final_transcript_row_count": len(merged_rows),
                "average_words_per_row": (
                    round(len(rows) / len(merged_rows), 2) if merged_rows else 0
                ),
                "average_row_duration_ms": (
                    round(sum(durations) / len(durations)) if durations else 0
                ),
                "speaker_transition_count": speaker_transitions,
                "rows_split_by_pause": split_by_pause,
                "rows_split_by_size_limit": split_by_size_limit,
            }
        )

    return merged_rows


def _build_transcript_rows(
    meeting_id: str,
    transcription: dict[str, Any],
    duration_seconds: int | None,
    *,
    original_transcription: dict[str, Any] | None = None,
    transcript_kind: str = "original",
    merge_adjacent: bool = True,
) -> list[dict[str, Any]]:
    segments = transcription.get("segments")
    original_segments = (
        original_transcription.get("segments")
        if isinstance(original_transcription, dict)
        else None
    )

    if isinstance(segments, list) and segments:
        rows = []

        for index, segment in enumerate(segments):
            if not isinstance(segment, dict):
                continue

            text = str(segment.get("text") or "").strip()

            if not text:
                continue

            start_ms = _coerce_segment_timestamp(segment.get("start"))
            end_ms = max(start_ms, _coerce_segment_timestamp(segment.get("end")))
            original_segment = (
                original_segments[index]
                if isinstance(original_segments, list)
                and index < len(original_segments)
                and isinstance(original_segments[index], dict)
                else None
            )

            rows.append(
                {
                    "meeting_id": meeting_id,
                    "speaker_label": _extract_speaker_label(segment)
                    or (
                        _extract_speaker_label(original_segment)
                        if original_segment
                        else None
                    ),
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "text": text,
                    "original_text": _extract_parallel_segment_text(
                        original_segments,
                        index,
                        fallback_text=text if transcript_kind == "original" else None,
                    ),
                    "translated_text": text
                    if transcript_kind in {"translated", "both"}
                    else None,
                    "transcript_kind": transcript_kind,
                    "confidence": _segment_confidence(segment),
                    "segment_index": index,
                }
            )

        if rows:
            return _merge_adjacent_speaker_segments(rows) if merge_adjacent else rows

    transcript_text = str(transcription.get("text") or "").strip()

    if not transcript_text:
        raise HTTPException(status_code=502, detail="OpenAI returned an empty transcript.")

    return [
        {
            "meeting_id": meeting_id,
            "speaker_label": None,
            "start_ms": 0,
            "end_ms": max(0, (duration_seconds or 0) * 1000),
            "text": transcript_text,
            "original_text": _coerce_optional_text(
                original_transcription.get("text")
                if isinstance(original_transcription, dict)
                else transcript_text
            ),
            "translated_text": transcript_text
            if transcript_kind in {"translated", "both"}
            else None,
            "transcript_kind": transcript_kind,
            "confidence": None,
            "segment_index": 0,
        }
    ]


def _build_word_timestamp_rows(
    meeting_id: str,
    transcription: dict[str, Any],
    *,
    transcript_kind: str = "original",
) -> list[dict[str, Any]]:
    words = transcription.get("words")
    if not isinstance(words, list):
        return []
    rows: list[dict[str, Any]] = []
    for word in words:
        if not isinstance(word, dict):
            continue
        text = _normalize_transcript_spacing(word.get("word") or word.get("text"))
        if not text:
            continue
        start_ms = _coerce_segment_timestamp(word.get("start"))
        end_ms = _coerce_segment_timestamp(word.get("end"))
        if end_ms <= start_ms:
            continue
        rows.append({
            "meeting_id": meeting_id,
            "speaker_label": None,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "text": text,
            "original_text": text if transcript_kind == "original" else None,
            "translated_text": text if transcript_kind in {"translated", "both"} else None,
            "transcript_kind": transcript_kind,
            "confidence": _segment_confidence(word),
            "segment_index": len(rows),
        })
    return rows


def _coerce_text(value: Any) -> str:
    return str(value or "").strip()


def _coerce_optional_text(value: Any) -> str | None:
    text = _coerce_text(value)
    return text or None


def _extract_parallel_segment_text(
    segments: Any,
    index: int,
    *,
    fallback_text: str | None = None,
) -> str | None:
    if isinstance(segments, list) and index < len(segments):
        segment = segments[index]

        if isinstance(segment, dict):
            return _coerce_optional_text(segment.get("text")) or fallback_text

    return fallback_text


def _fallback_speaker_label(index: int) -> str:
    return f"Speaker {index + 1}"


def _speaker_label_for_row(row: dict[str, Any]) -> str:
    return _coerce_optional_text(row.get("speaker_label")) or UNKNOWN_SPEAKER_LABEL


def _speaker_label_source(row: dict[str, Any]) -> str:
    return (
        "provider_detected"
        if _coerce_optional_text(row.get("speaker_label"))
        else "fallback_unknown"
    )


def _require_user_id(token: str) -> str:
    anon_client = get_supabase_anon_client()

    try:
        user_response = anon_client.auth.get_user(token)
        return user_response.user.id
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid Supabase session.") from exc


def _require_owned_meeting(service_client: Any, meeting_id: str, user_id: str) -> dict[str, Any]:
    meeting_response = (
        service_client.table("meetings")
        .select("id,owner_id,title,audio_storage_path,duration_seconds")
        .eq("id", meeting_id)
        .eq("owner_id", user_id)
        .limit(1)
        .execute()
    )
    meeting = meeting_response.data[0] if meeting_response.data else None

    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting was not found.")

    return meeting


def _create_processing_job(
    service_client: Any,
    *,
    job_id: str,
    meeting_id: str,
    job_type: str,
    transcript_revision: int | None = None,
) -> None:
    values = {
        "id": job_id,
        "meeting_id": meeting_id,
        "job_type": job_type,
        "status": "queued",
        "worker_version": settings.worker_version,
    }
    if transcript_revision is not None:
        values["transcript_revision"] = transcript_revision
    (
        service_client.table("processing_jobs")
        .insert(values)
        .execute()
    )


def _mark_transcript_manually_edited(
    service_client: Any, *, meeting_id: str, owner_id: str
) -> int:
    response = service_client.rpc(
        "mark_transcript_manually_edited",
        {"p_meeting_id": meeting_id, "p_owner_id": owner_id},
    ).execute()
    value = response.data
    if isinstance(value, list):
        value = value[0] if value else None
    if not isinstance(value, int):
        raise RuntimeError("Transcript revision was not updated.")
    return value


def _get_processing_job(
    service_client: Any,
    *,
    job_id: str,
    meeting_id: str,
) -> dict[str, Any] | None:
    response = (
        service_client.table("processing_jobs")
        .select(
            "id,meeting_id,job_type,status,started_at,completed_at,error_message,retry_count,worker_version"
        )
        .eq("id", job_id)
        .eq("meeting_id", meeting_id)
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def _get_latest_transcription_job(
    service_client: Any,
    *,
    meeting_id: str,
) -> dict[str, Any] | None:
    response = (
        service_client.table("processing_jobs")
        .select("id,meeting_id,job_type,status,error_message,created_at")
        .eq("meeting_id", meeting_id)
        .eq("job_type", "transcription")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def _processing_job_is_cancelled(service_client: Any, job_id: str | None) -> bool:
    if not job_id:
        return False

    response = (
        service_client.table("processing_jobs")
        .select("status")
        .eq("id", job_id)
        .limit(1)
        .execute()
    )
    job = response.data[0] if response.data else None
    return bool(job and job.get("status") == "cancelled")


def _update_processing_job(
    service_client: Any,
    *,
    job_id: str,
    values: dict[str, Any],
) -> dict[str, Any]:
    (
        service_client.table("processing_jobs")
        .update(values)
        .eq("id", job_id)
        .execute()
    )
    response = (
        service_client.table("processing_jobs")
        .select(
            "id,meeting_id,job_type,status,started_at,completed_at,error_message,retry_count,worker_version"
        )
        .eq("id", job_id)
        .limit(1)
        .execute()
    )
    if not response.data:
        message = f"Processing job update matched no row: {job_id}"
        logger.error(message, extra={"processing_job_id": job_id})
        raise RuntimeError(message)

    return response.data[0]


def _sanitize_processing_error_message(error: BaseException | str) -> str:
    message = str(error).strip() or type(error).__name__
    message = re.sub(r"https?://\S+", "[redacted-url]", message)
    message = re.sub(r"(?i)\bbearer\s+\S+", "Bearer [redacted]", message)
    message = re.sub(
        r"(?i)\b(api[_-]?key|authorization|token|secret)\b\s*[:=]\s*\S+",
        r"\1=[redacted]",
        message,
    )
    return message[:1000]


def _user_safe_transcription_error(error: BaseException | str) -> str:
    message = _sanitize_processing_error_message(error).lower()

    if "rate_limit_exceeded" in message:
        return TRANSCRIPTION_RATE_LIMIT_ERROR

    if (
        "http 429" in message
        or "429 too many requests" in message
        or "insufficient_quota" in message
        or "billing_hard_limit_reached" in message
    ):
        return TRANSCRIPTION_QUOTA_ERROR

    if (
        "no audio file" in message
        or "meeting has no audio" in message
        or "audio_storage_path" in message and "missing" in message
    ):
        return TRANSCRIPTION_MISSING_AUDIO_ERROR

    if any(
        marker in message
        for marker in (
            "invalid_audio",
            "unsupported audio",
            "unsupported_audio",
            "invalid file format",
            "audio format",
            "could not decode",
        )
    ):
        return TRANSCRIPTION_AUDIO_ERROR

    if any(
        marker in message
        for marker in (
            "http 401",
            "http 403",
            "401 unauthorized",
            "403 forbidden",
            "openai_api_key",
            "invalid api key",
            "authentication",
            "not configured",
            "configuration",
        )
    ):
        return TRANSCRIPTION_CONFIGURATION_ERROR

    return TRANSCRIPTION_UNKNOWN_ERROR


def _mark_processing_job_started(
    service_client: Any,
    *,
    job_id: str,
    status: str,
    retry_count: int = 0,
) -> dict[str, Any]:
    return _update_processing_job(
        service_client,
        job_id=job_id,
        values={
            "status": status,
            "started_at": _utc_now_iso(),
            "retry_count": retry_count,
            "worker_version": settings.worker_version,
        },
    )


def _mark_processing_job_completed(
    service_client: Any,
    *,
    job_id: str,
    status: str,
) -> dict[str, Any]:
    return _update_processing_job(
        service_client,
        job_id=job_id,
        values={
            "status": status,
            "completed_at": _utc_now_iso(),
            "error_message": None,
        },
    )


def _mark_processing_job_failed(
    service_client: Any,
    *,
    job_id: str,
    error_message: str,
) -> dict[str, Any]:
    safe_error = _sanitize_processing_error_message(error_message or "Job failed.")
    return _update_processing_job(
        service_client,
        job_id=job_id,
        values={
            "status": "failed",
            "completed_at": _utc_now_iso(),
            "error_message": safe_error,
        },
    )


def _mark_processing_job_cancelled(
    service_client: Any,
    *,
    job_id: str,
) -> None:
    logger.info("processing job cancelled", extra={"job_id": job_id})
    _update_processing_job(
        service_client,
        job_id=job_id,
        values={
            "status": "cancelled",
            "completed_at": _utc_now_iso(),
            "error_message": None,
        },
    )


def _ensure_not_processing(service_client: Any, meeting_id: str) -> None:
    response = (
        service_client.table("processing_jobs")
        .select("id")
        .eq("meeting_id", meeting_id)
        .in_("status", sorted(ACTIVE_PROCESSING_STATUSES))
        .limit(1)
        .execute()
    )

    if response.data:
        raise HTTPException(status_code=409, detail="Meeting is already processing.")


def _is_missing_storage_object_error(exc: Exception) -> bool:
    status_code = getattr(exc, "status_code", None)
    if status_code == 404:
        return True

    message = str(exc).lower()
    return any(
        marker in message
        for marker in ("object not found", "not found", "no such object", "404")
    )


def _delete_owned_meeting_data(
    service_client: Any,
    *,
    meeting: dict[str, Any],
    owner_id: str,
) -> None:
    meeting_id = str(meeting["id"])
    active_jobs = (
        service_client.table("processing_jobs")
        .select("id,status")
        .eq("meeting_id", meeting_id)
        .in_("status", sorted(ACTIVE_PROCESSING_STATUSES))
        .limit(1)
        .execute()
    )

    if active_jobs.data:
        raise HTTPException(
            status_code=409,
            detail=(
                "This meeting cannot be deleted while transcription or analysis "
                "is active. Cancel processing and try again."
            ),
        )

    audio_storage_path = meeting.get("audio_storage_path")

    if audio_storage_path:
        try:
            service_client.storage.from_("meeting-audio").remove(
                [audio_storage_path]
            )
        except Exception as exc:
            if _is_missing_storage_object_error(exc):
                logger.info(
                    "Meeting audio was already absent during deletion",
                    extra={
                        "meeting_id": meeting_id,
                        "exception_type": type(exc).__name__,
                    },
                )
            else:
                logger.exception(
                    "Unable to remove meeting audio during deletion",
                    extra={
                        "meeting_id": meeting_id,
                        "exception_type": type(exc).__name__,
                    },
                )
                raise HTTPException(
                    status_code=502,
                    detail=(
                        "The meeting audio could not be removed. The meeting was not "
                        "deleted. Please try again."
                    ),
                ) from exc

    try:
        (
            service_client.table("meetings")
            .delete()
            .eq("id", meeting_id)
            .eq("owner_id", owner_id)
            .execute()
        )
    except Exception as exc:
        logger.exception(
            "Unable to delete owned meeting record",
            extra={"meeting_id": meeting_id, "exception_type": type(exc).__name__},
        )
        raise HTTPException(
            status_code=500,
            detail="The meeting could not be deleted. Please try again.",
        ) from exc

    try:
        remaining_meeting = (
            service_client.table("meetings")
            .select("id")
            .eq("id", meeting_id)
            .limit(1)
            .execute()
        )

        if remaining_meeting.data:
            raise HTTPException(
                status_code=500,
                detail="The meeting could not be deleted. Please try again.",
            )

        remaining_relations = []
        for table_name in (*MEETING_CASCADE_TABLES, *MEETING_DETACHED_TABLES):
            response = (
                service_client.table(table_name)
                .select("meeting_id")
                .eq("meeting_id", meeting_id)
                .limit(1)
                .execute()
            )

            if response.data:
                remaining_relations.append(table_name)

        if remaining_relations:
            logger.error(
                "Meeting deletion left dependent rows after the meeting was removed",
                extra={
                    "meeting_id": meeting_id,
                    "remaining_relation_tables": remaining_relations,
                },
            )
    except HTTPException:
        raise
    except Exception as exc:
        # The meeting is already gone at this point. Do not turn successful,
        # irreversible deletion into a client-visible failure merely because a
        # best-effort cascade verification query failed.
        logger.exception(
            "Unable to verify meeting deletion cleanup",
            extra={
                "meeting_id": meeting_id,
                "exception_type": type(exc).__name__,
            },
        )


def _enqueue_transcription_job_if_needed(
    service_client: Any,
    *,
    meeting: dict[str, Any],
    translate_to_english: bool,
) -> dict[str, Any]:
    meeting_id = str(meeting["id"])

    if not meeting.get("audio_storage_path"):
        raise HTTPException(
            status_code=400,
            detail=TRANSCRIPTION_MISSING_AUDIO_ERROR,
        )

    existing_job = _get_latest_transcription_job(
        service_client,
        meeting_id=meeting_id,
    )
    if existing_job and existing_job.get("status") in (
        TRANSCRIPTION_ACTIVE_STATUSES | TRANSCRIPTION_COMPLETED_STATUSES
    ):
        return {
            "meeting_id": meeting_id,
            "job_id": existing_job["id"],
            "processing_status": existing_job["status"],
        }

    _ensure_not_processing(service_client, meeting_id)
    job_id = str(uuid4())
    try:
        _create_processing_job(
            service_client,
            job_id=job_id,
            meeting_id=meeting_id,
            job_type="transcription",
        )
    except Exception:
        concurrent_job = _get_latest_transcription_job(
            service_client,
            meeting_id=meeting_id,
        )
        if concurrent_job and concurrent_job.get("status") in (
            TRANSCRIPTION_ACTIVE_STATUSES | TRANSCRIPTION_COMPLETED_STATUSES
        ):
            return {
                "meeting_id": meeting_id,
                "job_id": concurrent_job["id"],
                "processing_status": concurrent_job["status"],
            }
        raise

    from app.workers.transcription_worker import transcribe_meeting_task

    try:
        logger.info(
            "dispatching transcription task",
            extra={
                "processing_job_id": job_id,
                "meeting_id": meeting_id,
                "celery_task_name": "meetingva.transcribe_meeting",
            },
        )
        transcribe_meeting_task.apply_async(
            kwargs={
                "meeting_id": meeting_id,
                "translate_to_english": translate_to_english,
                "processing_job_id": job_id,
            },
            task_id=job_id,
        )
    except Exception as exc:
        logger.exception(
            "Unable to enqueue transcription job",
            extra={"job_id": job_id, "meeting_id": meeting_id},
        )
        _mark_processing_job_failed(
            service_client,
            job_id=job_id,
            error_message=TRANSCRIPTION_UNKNOWN_ERROR,
        )
        raise HTTPException(
            status_code=503,
            detail=TRANSCRIPTION_UNKNOWN_ERROR,
        ) from exc

    return {
        "meeting_id": meeting_id,
        "job_id": job_id,
        "processing_status": "queued",
    }


def _require_participant(
    service_client: Any,
    *,
    meeting_id: str,
    participant_id: str,
) -> dict[str, Any]:
    participant_response = (
        service_client.table("participants")
        .select("id,meeting_id,display_name,speaker_label")
        .eq("id", participant_id)
        .eq("meeting_id", meeting_id)
        .limit(1)
        .execute()
    )
    participant = participant_response.data[0] if participant_response.data else None

    if not participant:
        raise HTTPException(status_code=404, detail="Participant was not found.")

    return participant


def _create_participant(
    service_client: Any,
    *,
    meeting_id: str,
    display_name: str,
    speaker_label: str | None = None,
    source: str = "owner",
) -> dict[str, Any]:
    created = (
        service_client.table("participants")
        .insert(
            {
                "meeting_id": meeting_id,
                "display_name": display_name,
                "speaker_label": speaker_label,
                "source": source,
                "metadata": {
                    "detection_method": "owner_correction",
                    "speaker_label_source": "user_assigned",
                },
            }
        )
        .execute()
    )

    return created.data[0]


def _attach_participants_to_transcript_rows(
    service_client: Any,
    *,
    meeting_id: str,
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    labels: list[str] = []
    label_sources: dict[str, str] = {}
    label_confidences: dict[str, list[float]] = defaultdict(list)
    label_assignment_sources: dict[str, set[str]] = defaultdict(set)
    raw_speaker_ids = {
        str(value)
        for row in rows
        for value in row.get("diarization_raw_speaker_ids", [])
    }
    raw_word_speaker_ids = {
        str(value)
        for row in rows
        for value in row.get("diarization_raw_word_speaker_ids", [])
    }
    raw_utterance_speaker_ids = {
        str(value)
        for row in rows
        for value in row.get("diarization_raw_utterance_speaker_ids", [])
    }
    parsed_turn_speaker_ids = {
        str(value)
        for row in rows
        for value in row.get("diarization_parsed_turn_speaker_ids", [])
    }
    aligned_word_speaker_ids = {
        str(value)
        for row in rows
        for value in row.get("diarization_aligned_word_speaker_ids", [])
    }
    final_turn_speaker_ids = {
        provider_id
        for row in rows
        if (
            provider_id := _normalize_provider_speaker_id(
                row.get("provider_speaker_id")
            )
        )
    }
    unknown_word_count = sum(
        int(row.get("source_word_count") or 1)
        for row in rows
        if _normalize_provider_speaker_id(row.get("provider_speaker_id")) is None
    )
    unknown_turn_count = sum(
        _normalize_provider_speaker_id(row.get("provider_speaker_id")) is None
        for row in rows
    )

    for row in rows:
        label = _speaker_label_for_row(row)

        if label not in labels:
            labels.append(label)
            label_sources[label] = _speaker_label_source(row)
        confidence = row.get("diarization_confidence")
        if isinstance(confidence, (int, float)) and not isinstance(confidence, bool):
            label_confidences[label].append(float(confidence))
        label_assignment_sources[label].update(
            str(source)
            for source in row.get("diarization_assignment_sources", [])
            if source
        )

    if not labels:
        return rows

    detected_display_names: dict[str, str] = {}
    for index, label in enumerate(
        label
        for label in labels
        if label_sources[label] == "provider_detected"
    ):
        provider_id = label.split(":", 1)[1] if label.startswith("deepgram:") else ""
        display_index = (
            int(provider_id)
            if provider_id.isdigit() and int(provider_id) >= 0
            else index
        )
        detected_display_names[label] = _fallback_speaker_label(display_index)
    participant_rows = [
        {
            "meeting_id": meeting_id,
            "display_name": (
                UNKNOWN_SPEAKER_LABEL
                if label_sources[label] == "fallback_unknown"
                else detected_display_names[label]
            ),
            "speaker_label": label,
            "source": "transcript",
            "metadata": {
                "detection_method": (
                    "diarization"
                    if label_sources[label] == "provider_detected"
                    else "no_diarization"
                ),
                "speaker_label_source": label_sources[label],
                "provider": "deepgram" if label.startswith("deepgram:") else None,
                "provider_speaker_id": label.split(":", 1)[1] if label.startswith("deepgram:") else None,
                "confidence": (sum(label_confidences[label]) / len(label_confidences[label])) if label_confidences[label] else None,
                "assignment_sources": sorted(label_assignment_sources[label]) or ["unknown"],
            },
        }
        for label in labels
    ]
    created = service_client.table("participants").insert(participant_rows).execute()
    final_participant_speaker_ids = {
        str(participant.get("metadata", {}).get("provider_speaker_id"))
        for participant in created.data
        if participant.get("metadata", {}).get("provider_speaker_id") is not None
    }
    log_method = logger.info
    if not (
        raw_speaker_ids
        == parsed_turn_speaker_ids
        == aligned_word_speaker_ids
        == final_turn_speaker_ids
        == final_participant_speaker_ids
    ):
        log_method = logger.error
    log_method(
        "Deepgram speaker pipeline raw_word_speakers=%s raw_utterance_speakers=%s parsed_turn_speakers=%s aligned_word_speakers=%s final_turn_speakers=%s participant_provider_speakers=%s unknown_word_count=%s unknown_turn_count=%s",
        sorted(raw_word_speaker_ids),
        sorted(raw_utterance_speaker_ids),
        sorted(parsed_turn_speaker_ids),
        sorted(aligned_word_speaker_ids),
        sorted(final_turn_speaker_ids),
        sorted(final_participant_speaker_ids),
        unknown_word_count,
        unknown_turn_count,
    )
    participants_by_label = {
        participant["speaker_label"]: participant["id"]
        for participant in created.data
        if participant.get("speaker_label")
    }

    for row in rows:
        label = _speaker_label_for_row(row)
        row["speaker_label"] = label
        row["participant_id"] = participants_by_label[label]
        row.pop("diarization_confidence", None)
        row.pop("diarization_ambiguous", None)
        row.pop("diarization_available", None)
        row.pop("diarization_boundary_index", None)
        row.pop("diarization_turn_id", None)
        row.pop("provider_speaker_id", None)
        row.pop("diarization_assignment_sources", None)
        row.pop("diarization_raw_speaker_ids", None)
        row.pop("diarization_raw_word_speaker_ids", None)
        row.pop("diarization_raw_utterance_speaker_ids", None)
        row.pop("diarization_parsed_turn_speaker_ids", None)
        row.pop("diarization_aligned_word_speaker_ids", None)
        row.pop("source_word_count", None)

    return rows


def _coerce_due_at(value: Any) -> str | None:
    text = _coerce_text(value)

    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text

    return None


def _coerce_analysis_items(value: Any, required_field: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    rows = []

    for item in value:
        if not isinstance(item, dict):
            continue

        required_value = _coerce_text(item.get(required_field))

        if not required_value:
            continue

        normalized = {required_field: required_value}

        for key in ("title", "description", "assignee", "due_date", "answer", "status"):
            if key != required_field:
                normalized[key] = _coerce_optional_text(item.get(key))

        rows.append(normalized)

    return rows


def _normalize_analysis_payload(payload: dict[str, Any]) -> dict[str, Any]:
    executive_summary = _coerce_text(payload.get("executive_summary"))
    meeting_brief = _coerce_text(payload.get("meeting_brief"))

    if not executive_summary or not meeting_brief:
        raise HTTPException(
            status_code=502,
            detail="OpenAI returned incomplete meeting analysis.",
        )

    action_items = _coerce_analysis_items(payload.get("action_items"), "title")
    decisions = _coerce_analysis_items(payload.get("decisions"), "title")
    open_questions = _coerce_analysis_items(payload.get("open_questions"), "question")

    return {
        "executive_summary": executive_summary,
        "meeting_brief": meeting_brief,
        "action_items": action_items,
        "decisions": decisions,
        "open_questions": open_questions,
    }


def _build_analysis_rows(
    meeting_id: str,
    analysis: dict[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    action_items = [
        {
            "meeting_id": meeting_id,
            "title": item["title"],
            "description": item.get("description"),
            "status": "open",
            "due_at": _coerce_due_at(item.get("due_date")),
        }
        for item in analysis["action_items"]
    ]
    decisions = [
        {
            "meeting_id": meeting_id,
            "title": item["title"],
            "description": item.get("description"),
        }
        for item in analysis["decisions"]
    ]
    questions = []

    for item in analysis["open_questions"]:
        status = item.get("status") or "open"

        if status not in {"open", "answered", "deferred"}:
            status = "open"

        questions.append(
            {
                "meeting_id": meeting_id,
                "question": item["question"],
                "answer": item.get("answer"),
                "status": status,
            }
        )

    return {
        "action_items": action_items,
        "decisions": decisions,
        "questions": questions,
    }


def _format_transcript_for_analysis(segments: list[dict[str, Any]]) -> str:
    lines = []

    for segment in segments:
        participant = segment.get("participants")
        speaker = ""

        if isinstance(participant, dict):
            speaker = _coerce_text(participant.get("display_name"))

        speaker = speaker or _coerce_text(segment.get("speaker_label")) or "Speaker"
        text = _coerce_text(segment.get("text"))

        if text:
            lines.append(f"{speaker}: {text}")

    return "\n".join(lines)


def _normalize_language(value: Any) -> str | None:
    language = _coerce_optional_text(value)

    if not language:
        return None

    normalized = language.lower().replace("_", "-")
    aliases = {
        "en": "english",
        "eng": "english",
        "english": "english",
    }

    return aliases.get(normalized, normalized)


def _is_english_language(language: str | None) -> bool:
    return _normalize_language(language) == "english"


def _transcript_kind(
    *,
    detected_language: str | None,
    translate_to_english: bool,
    translated: bool,
) -> str:
    if translated:
        return "both" if detected_language else "translated"

    return "original"


def _translation_status(
    *,
    detected_language: str | None,
    translate_to_english: bool,
    translated: bool,
) -> str:
    if not translate_to_english:
        return "not_requested"

    if translated:
        return "translated"

    if _is_english_language(detected_language):
        return "not_needed"

    return "failed"


def _openai_error_details(
    exc: Exception,
) -> tuple[int | None, str | None, str | None, str, str | None]:
    response = getattr(exc, "response", None)
    status_code = getattr(exc, "status_code", None) or getattr(
        response, "status_code", None
    )
    response_body = getattr(exc, "body", None)
    if response_body is None and response is not None:
        response_body = getattr(response, "text", None)

    error_type = None
    error_code = None
    error_message = str(exc)
    if response is not None:
        try:
            payload = response.json()
        except (TypeError, ValueError):
            payload = None
        if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
            error = payload["error"]
            error_type = str(error["type"]) if error.get("type") is not None else None
            error_code = str(error["code"]) if error.get("code") is not None else None
            if error.get("message"):
                error_message = str(error["message"])

    return (
        status_code,
        error_type,
        error_code,
        _sanitize_processing_error_message(error_message),
        _sanitize_processing_error_message(str(response_body))
        if response_body is not None
        else None,
    )


def _is_temporary_openai_rate_limit(
    *,
    status_code: int | None,
    error_type: str | None,
    error_code: str | None,
) -> bool:
    return status_code == 429 and "rate_limit_exceeded" in {
        error_type,
        error_code,
    }


async def _transcribe_audio_with_openai(
    *,
    audio_bytes: bytes,
    filename: str,
    content_type: str,
) -> dict[str, Any]:
    openai_api_key = _require_configured(settings.openai_api_key, "OPENAI_API_KEY")

    form_data = {
        "model": settings.openai_transcription_model,
        "response_format": "verbose_json",
        "timestamp_granularities[]": ["segment", "word"],
    }
    files = {"file": (filename, audio_bytes, content_type)}

    async with httpx.AsyncClient(timeout=120) as client:
        for attempt in range(3):
            try:
                response = await client.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {openai_api_key}"},
                    data=form_data,
                    files=files,
                )
                response.raise_for_status()
                break
            except Exception as exc:
                (
                    status_code,
                    error_type,
                    error_code,
                    error_message,
                    response_body,
                ) = _openai_error_details(exc)
                retryable = _is_temporary_openai_rate_limit(
                    status_code=status_code,
                    error_type=error_type,
                    error_code=error_code,
                )

                logger.exception(
                    "OpenAI transcription request failed",
                    extra={
                        "openai_status_code": status_code,
                        "openai_error_type": error_type,
                        "openai_error_code": error_code,
                        "openai_error_message": error_message,
                        "openai_response_body": response_body,
                        "openai_request_attempt": attempt + 1,
                        "openai_will_retry": retryable and attempt < 2,
                    },
                )

                if retryable and attempt < 2:
                    await asyncio.sleep(2**attempt)
                    continue

                identifiers = ", ".join(
                    value
                    for value in (
                        f"HTTP {status_code}" if status_code is not None else None,
                        f"type={error_type}" if error_type else None,
                        f"code={error_code}" if error_code else None,
                    )
                    if value
                )
                detail = f" ({identifiers})" if identifiers else ""
                raise RuntimeError(
                    f"OpenAI transcription failed{detail}: {error_message}"
                ) from exc

    return response.json()


async def _translate_audio_with_openai(
    *,
    audio_bytes: bytes,
    filename: str,
    content_type: str,
) -> dict[str, Any]:
    openai_api_key = _require_configured(settings.openai_api_key, "OPENAI_API_KEY")

    form_data = {
        "model": settings.openai_transcription_model,
        "response_format": "verbose_json",
        "timestamp_granularities[]": "segment",
    }
    files = {"file": (filename, audio_bytes, content_type)}

    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            "https://api.openai.com/v1/audio/translations",
            headers={"Authorization": f"Bearer {openai_api_key}"},
            data=form_data,
            files=files,
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail="OpenAI translation request failed.",
        )

    return response.json()


async def _analyze_transcript_with_openai(
    *,
    meeting_title: str,
    transcript: str,
    transcript_language: str | None = None,
) -> dict[str, Any]:
    openai_api_key = _require_configured(settings.openai_api_key, "OPENAI_API_KEY")

    payload = {
        "model": settings.openai_analysis_model,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You generate structured meeting intelligence from transcripts. "
                    "Return only valid JSON with keys executive_summary, meeting_brief, "
                    "action_items, decisions, and open_questions. action_items must be "
                    "an array of objects with title, description, assignee, and due_date. "
                    "Use YYYY-MM-DD due_date values only when the transcript states a "
                    "specific date; otherwise use null. "
                    "decisions must be an array of objects with title and description. "
                    "open_questions must be an array of objects with question, answer, "
                    "and status, where status is open, answered, or deferred. "
                    + _analysis_language_instruction(transcript_language)
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Meeting title: {meeting_title}\n\n"
                    "Transcript:\n"
                    f"{transcript}"
                ),
            },
        ],
    }

    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {openai_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail="OpenAI analysis request failed.",
        )

    content = (
        response.json()
        .get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail="OpenAI returned invalid meeting analysis JSON.",
        ) from exc

    return _normalize_analysis_payload(parsed)


def _analysis_language_instruction(transcript_language: str | None) -> str:
    return (
        f"Respond in the transcript language ({transcript_language or 'unknown'}). "
        "Preserve names and proper nouns. Do not translate unless an explicit "
        "target language is supplied."
    )


async def _translate_sections_with_openai(
    *, content: dict[str, Any], target_language: str
) -> dict[str, Any]:
    """Translate JSON string values while preserving its structure and identifiers."""
    openai_api_key = _require_configured(settings.openai_api_key, "OPENAI_API_KEY")
    payload = {
        "model": settings.openai_analysis_model,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    f"Translate user-visible JSON string values to {target_language}. "
                    "Return only valid JSON with exactly the same keys, arrays, IDs, nulls, "
                    "and structure. Preserve names and proper nouns."
                ),
            },
            {"role": "user", "content": json.dumps(content, ensure_ascii=False)},
        ],
    }
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {openai_api_key}"},
            json=payload,
        )
    if response.status_code >= 400:
        raise RuntimeError("Translation provider request failed.")
    try:
        return json.loads(response.json()["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Translation provider returned an invalid response.") from exc


async def _run_transcribe_meeting_job(
    *,
    meeting_id: str,
    translate_to_english: bool = False,
    job_id: str | None = None,
) -> dict[str, Any]:
    service_client = get_supabase_service_client()

    if _processing_job_is_cancelled(service_client, job_id):
        return {
            "meeting_id": meeting_id,
            "job_id": job_id,
            "processing_status": "cancelled",
        }

    meeting_response = (
        service_client.table("meetings")
        .select("id,title,audio_storage_path,duration_seconds,expected_speaker_count")
        .eq("id", meeting_id)
        .limit(1)
        .execute()
    )
    meeting = meeting_response.data[0] if meeting_response.data else None

    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting was not found.")

    audio_storage_path = meeting.get("audio_storage_path")

    if not audio_storage_path:
        raise HTTPException(status_code=400, detail="Meeting has no audio file.")

    try:
        audio_bytes = service_client.storage.from_("meeting-audio").download(
            audio_storage_path
        )

        if _processing_job_is_cancelled(service_client, job_id):
            return {
                "meeting_id": meeting_id,
                "job_id": job_id,
                "processing_status": "cancelled",
            }

        filename = Path(audio_storage_path).name or "meeting-audio.webm"
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        transcription = await _transcribe_audio_with_openai(
            audio_bytes=audio_bytes,
            filename=filename,
            content_type=content_type,
        )
        detected_language = _normalize_language(transcription.get("language"))
        # Transcription always persists the original language. Translation is a
        # separate, on-demand operation and must never replace this payload.
        transcript_payload = transcription
        translated = False
        transcript_language = detected_language
        translation_language = None
        translation_status = _translation_status(
            detected_language=detected_language,
            translate_to_english=False,
            translated=translated,
        )
        transcript_kind = _transcript_kind(
            detected_language=detected_language,
            translate_to_english=translate_to_english,
            translated=translated,
        )
        rows = _build_transcript_rows(
            meeting_id=meeting_id,
            transcription=transcript_payload,
            duration_seconds=meeting.get("duration_seconds"),
            original_transcription=None,
            transcript_kind=transcript_kind,
            merge_adjacent=False,
        )
        diarized_turns = await diarize_audio_safely(
            audio_bytes,
            filename,
            content_type,
            meeting.get("expected_speaker_count"),
        )
        word_rows = _build_word_timestamp_rows(
            meeting_id,
            transcription,
            transcript_kind=transcript_kind,
        )
        aligned_word_rows: list[dict[str, Any]] = []
        grouping_diagnostics: dict[str, Any] = {}
        word_level_alignment_was_used = bool(diarized_turns and word_rows)
        if word_level_alignment_was_used:
            aligned_word_rows, grouped_rows = _align_and_build_speaker_turn_rows(
                word_rows,
                diarized_turns,
                minimum_confidence=settings.diarization_minimum_confidence,
                minimum_overlap=settings.diarization_minimum_timestamp_overlap,
                nearest_turn_tolerance_ms=settings.diarization_nearest_turn_tolerance_ms,
                diagnostics=grouping_diagnostics,
            )
        else:
            aligned_rows = align_transcript_rows_to_turns(
                rows,
                diarized_turns,
                minimum_confidence=settings.diarization_minimum_confidence,
                minimum_overlap=settings.diarization_minimum_timestamp_overlap,
            )
            grouped_rows = _merge_adjacent_speaker_segments(
                aligned_rows,
                diagnostics=grouping_diagnostics,
            )
            grouping_diagnostics["input_word_count"] = len(word_rows)
            grouping_diagnostics["aligned_word_count"] = 0
        if (
            word_level_alignment_was_used
            and len(aligned_word_rows) > 1
            and len(grouped_rows) >= len(aligned_word_rows)
        ):
            logger.error(
                "word grouping did not reduce transcript rows",
                extra={
                    "meeting_id": meeting_id,
                    "aligned_word_row_count": len(aligned_word_rows),
                    "grouped_turn_row_count": len(grouped_rows),
                    "unique_provider_speaker_ids": sorted(
                        {
                            str(word["provider_speaker_id"])
                            for word in aligned_word_rows
                            if word.get("provider_speaker_id") is not None
                        }
                    ),
                },
            )
        rows = grouped_rows
        unknown_row_count = sum(not row.get("speaker_label") for row in rows)
        logger.info(
            "Transcript diarization alignment completed",
            extra={
                "meeting_id": meeting_id,
                "openai_word_timestamp_count": len(word_rows),
                "diarized_turn_count": len(diarized_turns),
                "aligned_transcript_row_count": len(rows),
                "unknown_transcript_row_count": unknown_row_count,
                "aligned_unique_speaker_ids": sorted({str(row["speaker_label"]) for row in rows if row.get("speaker_label")}),
                "aligned_word_counts_by_speaker": {
                    label: sum(1 for word in aligned_word_rows if word.get("speaker_label") == label)
                    for label in sorted({str(word["speaker_label"]) for word in aligned_word_rows if word.get("speaker_label")})
                },
                "provider_speaker_transitions": [
                    [turn.start_ms, turn.end_ms, turn.stable_label]
                    for turn in diarized_turns
                ],
                "transcript_row_boundaries": [
                    [row.get("start_ms"), row.get("end_ms"), row.get("speaker_label") or "Unknown Speaker"]
                    for row in rows
                ],
                **grouping_diagnostics,
            },
        )
        if settings.environment.casefold() != "production":
            logger.debug(
                "Development diarization diagnostics",
                extra=development_diarization_diagnostics(diarized_turns, rows),
            )

        (
            service_client.table("transcript_segments")
            .delete()
            .eq("meeting_id", meeting_id)
            .execute()
        )
        (
            service_client.table("participants")
            .delete()
            .eq("meeting_id", meeting_id)
            .is_("email", "null")
            .execute()
        )
        insert_rows = _attach_participants_to_transcript_rows(
            service_client,
            meeting_id=meeting_id,
            rows=rows,
        )
        logger.info(
            "Transcript participants created",
            extra={
                "meeting_id": meeting_id,
                "participant_count": len({row.get("participant_id") for row in insert_rows if row.get("participant_id")}),
            },
        )
        if any("provider_speaker_id" in row for row in insert_rows):
            raise RuntimeError(
                "Provider-only speaker fields were not removed before transcript insert"
            )
        service_client.table("transcript_segments").insert(insert_rows).execute()
        (
            service_client.table("meetings")
            .update(
                {
                    "detected_language": detected_language,
                    "transcript_language": transcript_language,
                    "translation_language": translation_language,
                    "translation_status": translation_status,
                    "transcript_kind": transcript_kind,
                    "translate_to_english": False,
                }
            )
            .eq("id", meeting_id)
            .execute()
        )
    except Exception as exc:
        safe_error = _sanitize_processing_error_message(exc)
        try:
            exc.args = (safe_error,)
        except (AttributeError, TypeError):
            pass
        logger.exception(
            "Meeting audio transcription failed",
            extra={
                "job_id": job_id,
                "meeting_id": meeting_id,
                "exception_type": type(exc).__name__,
                "exception_message": str(exc),
            },
        )
        raise RuntimeError("Unable to transcribe meeting audio") from exc

    return {
        "meeting_id": meeting_id,
        "job_id": job_id,
        "processing_status": "transcribed",
        "segment_count": len(rows),
        "detected_language": detected_language,
        "transcript_language": transcript_language,
        "translation_language": translation_language,
        "translation_status": translation_status,
        "transcript_kind": transcript_kind,
    }


async def _run_analyze_meeting_job(
    *,
    meeting_id: str,
    job_id: str | None = None,
    transcript_revision: int | None = None,
) -> dict[str, Any]:
    service_client = get_supabase_service_client()

    if _processing_job_is_cancelled(service_client, job_id):
        return {
            "meeting_id": meeting_id,
            "job_id": job_id,
            "processing_status": "cancelled",
        }

    meeting_response = (
        service_client.table("meetings")
        .select("id,title,transcript_language,detected_language,transcript_revision")
        .eq("id", meeting_id)
        .limit(1)
        .execute()
    )
    meeting = meeting_response.data[0] if meeting_response.data else None

    if not meeting:
        raise RuntimeError("Meeting was not found.")

    current_revision = int(meeting.get("transcript_revision") or 1)
    expected_revision = transcript_revision or current_revision
    if current_revision != expected_revision:
        return {
            "meeting_id": meeting_id,
            "job_id": job_id,
            "processing_status": "cancelled",
            "transcript_revision": expected_revision,
        }

    transcript_response = (
        service_client.table("transcript_segments")
        .select("id,speaker_label,text,segment_index,participants(display_name)")
        .eq("meeting_id", meeting_id)
        .order("segment_index")
        .execute()
    )
    transcript_segments = transcript_response.data or []
    transcript = _format_transcript_for_analysis(transcript_segments)

    if not transcript:
        raise RuntimeError("Meeting has no transcript.")

    try:
        analysis = await _analyze_transcript_with_openai(
            meeting_title=meeting.get("title") or "Untitled meeting",
            transcript=transcript,
            transcript_language=(
                meeting.get("transcript_language") or meeting.get("detected_language")
            ),
        )
        rows = _build_analysis_rows(meeting_id, analysis)

        commit = service_client.rpc(
            "commit_meeting_analysis",
            {
                "p_meeting_id": meeting_id,
                "p_transcript_revision": expected_revision,
                "p_summary": analysis["executive_summary"],
                "p_brief": analysis["meeting_brief"],
                "p_action_items": rows["action_items"],
                "p_decisions": rows["decisions"],
                "p_questions": rows["questions"],
            },
        ).execute()
        committed = commit.data
        if isinstance(committed, list):
            committed = committed[0] if committed else False
        if committed is not True:
            return {
                "meeting_id": meeting_id,
                "job_id": job_id,
                "processing_status": "cancelled",
                "transcript_revision": expected_revision,
            }
    except Exception as exc:
        safe_error = _sanitize_processing_error_message(exc)
        try:
            exc.args = (safe_error,)
        except (AttributeError, TypeError):
            pass
        if hasattr(exc, "detail"):
            exc.detail = safe_error
        logger.exception(
            "Meeting transcript analysis failed",
            extra={
                "processing_job_id": job_id,
                "meeting_id": meeting_id,
                "exception_type": type(exc).__name__,
                "exception_message": str(exc),
            },
        )
        raise RuntimeError("Unable to analyze meeting transcript") from exc

    return {
        "meeting_id": meeting_id,
        "job_id": job_id,
        "processing_status": "analyzed",
        "transcript_revision": expected_revision,
        "action_item_count": len(rows["action_items"]),
        "decision_count": len(rows["decisions"]),
        "question_count": len(rows["questions"]),
    }


@app.delete("/v1/meetings/{meeting_id}", tags=["meetings"])
async def delete_meeting(
    meeting_id: str,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    token = _require_bearer_token(authorization)
    service_client = get_supabase_service_client()
    user_id = _require_user_id(token)
    meeting = _require_owned_meeting(service_client, meeting_id, user_id)
    _delete_owned_meeting_data(
        service_client,
        meeting=meeting,
        owner_id=user_id,
    )
    return {"meeting_id": meeting_id, "deleted": True}


@app.post(
    "/v1/meetings/{meeting_id}/transcribe",
    tags=["meetings"],
    response_model=JobResponse,
)
async def transcribe_meeting(
    meeting_id: str,
    payload: TranscribeMeetingRequest | None = None,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    token = _require_bearer_token(authorization)
    service_client = get_supabase_service_client()
    user_id = _require_user_id(token)
    _enforce_ai_rate_limit(user_id, "transcribe")
    meeting = _require_owned_meeting(service_client, meeting_id, user_id)
    return _enqueue_transcription_job_if_needed(
        service_client,
        meeting=meeting,
        translate_to_english=bool(payload and payload.translate_to_english),
    )


@app.post(
    "/v1/meetings/{meeting_id}/analyze",
    tags=["meetings"],
    response_model=JobResponse,
)
async def analyze_meeting(
    meeting_id: str,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    token = _require_bearer_token(authorization)
    service_client = get_supabase_service_client()
    user_id = _require_user_id(token)
    _enforce_ai_rate_limit(user_id, "analyze")
    meeting = _require_owned_meeting(service_client, meeting_id, user_id)

    active_analysis = (
        service_client.table("processing_jobs")
        .select("id,status,transcript_revision")
        .eq("meeting_id", meeting_id)
        .eq("job_type", "analysis")
        .in_("status", ["queued", "analyzing"])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if active_analysis.data:
        job = active_analysis.data[0]
        return {
            "meeting_id": meeting_id,
            "job_id": job["id"],
            "processing_status": job["status"],
        }

    _ensure_not_processing(service_client, meeting_id)

    transcript_response = (
        service_client.table("transcript_segments")
        .select("id")
        .eq("meeting_id", meeting_id)
        .limit(1)
        .execute()
    )

    if not transcript_response.data:
        raise HTTPException(status_code=400, detail="Meeting has no transcript.")

    job_id = str(uuid4())
    transcript_revision = int(meeting.get("transcript_revision") or 1)
    _create_processing_job(
        service_client,
        job_id=job_id,
        meeting_id=meeting_id,
        job_type="analysis",
        transcript_revision=transcript_revision,
    )
    from app.workers.analysis_worker import analyze_meeting_task

    try:
        analyze_meeting_task.apply_async(
            kwargs={
                "meeting_id": meeting_id,
                "processing_job_id": job_id,
                "transcript_revision": transcript_revision,
            },
            task_id=job_id,
        )
    except Exception as exc:
        _mark_processing_job_failed(
            service_client,
            job_id=job_id,
            error_message="Unable to enqueue analysis job.",
        )
        raise HTTPException(
            status_code=503,
            detail="Unable to enqueue analysis job.",
        ) from exc

    return {
        "meeting_id": meeting_id,
        "job_id": job_id,
        "processing_status": "queued",
    }


@app.post("/v1/meetings/{meeting_id}/translate", tags=["meetings"])
async def translate_meeting_sections(
    meeting_id: str,
    payload: TranslateMeetingRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    token = _require_bearer_token(authorization)
    client = get_supabase_service_client()
    user_id = _require_user_id(token)
    _require_owned_meeting(client, meeting_id, user_id)
    sections = list(dict.fromkeys(payload.sections))
    target = _normalize_language(payload.target_language) or payload.target_language
    meeting_rows = (
        client.table("meetings")
        .select("id,summary,brief,summary_translated,brief_translated,translation_language")
        .eq("id", meeting_id).limit(1).execute().data or []
    )
    meeting = meeting_rows[0]
    table_contract = {
        "action_items": ("id,title,description,translated_title,translated_description", ("title", "description")),
        "decisions": ("id,title,description,translated_title,translated_description", ("title", "description")),
        "questions": ("id,question,answer,translated_question,translated_answer", ("question", "answer")),
        "transcript": ("id,text,original_text,translated_text", ("original_text", "text")),
    }
    result: dict[str, Any] = {}
    source: dict[str, Any] = {}
    cache_matches = meeting.get("translation_language") == target

    for section in sections:
        if section in {"summary", "brief"}:
            translated_key = f"{section}_translated"
            if cache_matches and meeting.get(translated_key):
                result[section] = meeting[translated_key]
            elif meeting.get(section):
                source[section] = meeting[section]
            continue
        columns, original_keys = table_contract[section]
        table_name = "transcript_segments" if section == "transcript" else section
        rows = client.table(table_name).select(columns).eq("meeting_id", meeting_id).execute().data or []
        field_pairs = (
            (("original_text", "translated_text"), ("text", "translated_text"))
            if section == "transcript"
            else (("question", "translated_question"), ("answer", "translated_answer"))
            if section == "questions"
            else (("title", "translated_title"), ("description", "translated_description"))
        )
        rows_are_cached = all(
            all(not row.get(original) or row.get(translated) for original, translated in field_pairs)
            for row in rows
        )
        if cache_matches and rows and rows_are_cached:
            result[section] = rows
        elif rows:
            source[section] = [
                {"id": row["id"], **{key: row.get(key) for key in original_keys}}
                for row in rows
            ]

    if source:
        try:
            translated = await _translate_sections_with_openai(
                content=source, target_language=target
            )
            for section, value in translated.items():
                if section in {"summary", "brief"}:
                    client.table("meetings").update({f"{section}_translated": value}).eq("id", meeting_id).execute()
                    result[section] = value
                    continue
                table_name = "transcript_segments" if section == "transcript" else section
                for row in value:
                    row_id = row.pop("id")
                    if section == "transcript":
                        values = {"translated_text": row.get("original_text") or row.get("text")}
                    elif section == "questions":
                        values = {"translated_question": row.get("question"), "translated_answer": row.get("answer")}
                    else:
                        values = {"translated_title": row.get("title"), "translated_description": row.get("description")}
                    client.table(table_name).update(values).eq("id", row_id).eq("meeting_id", meeting_id).execute()
                result[section] = value
            client.table("meetings").update({
                "translation_language": target, "translation_status": "translated"
            }).eq("id", meeting_id).execute()
        except Exception as exc:
            logger.exception("Optional meeting translation failed", extra={"meeting_id": meeting_id, "sections": sections})
            raise HTTPException(status_code=502, detail="Unable to translate this content. Please try again.") from exc

    return {"meeting_id": meeting_id, "target_language": target, "sections": result, "cached": not bool(source)}


def _fetch_meeting_export_data(client: Any, meeting_id: str) -> dict[str, Any]:
    meeting_rows = (
        client.table("meetings")
        .select(
            "id,title,description,status,scheduled_at,duration_seconds,detected_language,"
            "transcript_language,translation_language,summary,brief,summary_translated,brief_translated"
        ).eq("id", meeting_id).limit(1).execute().data or []
    )
    meeting = meeting_rows[0]
    participants = client.table("participants").select("id,display_name,speaker_label").eq("meeting_id", meeting_id).execute().data or []
    participant_names = {row["id"]: row.get("display_name") for row in participants}
    transcript = client.table("transcript_segments").select("participant_id,speaker_label,start_ms,end_ms,text,original_text,translated_text,segment_index").eq("meeting_id", meeting_id).order("segment_index").execute().data or []
    speaking_ms: dict[str, int] = defaultdict(int)
    for row in transcript:
        row["display_name"] = participant_names.get(row.get("participant_id"))
        if row.get("participant_id"):
            speaking_ms[row["participant_id"]] += max(0, int(row.get("end_ms") or 0) - int(row.get("start_ms") or 0))
    total_speaking_ms = sum(speaking_ms.values())
    speakers = [{
        "display_name": row.get("display_name"), "speaker_label": row.get("speaker_label"),
        "speaking_time_ms": speaking_ms.get(row["id"], 0),
        "speaking_percentage": round((speaking_ms.get(row["id"], 0) / total_speaking_ms * 100), 1) if total_speaking_ms else 0,
    } for row in participants]
    action_items = client.table("action_items").select("title,description,translated_title,translated_description,assignee_participant_id,due_at,status").eq("meeting_id", meeting_id).order("created_at").execute().data or []
    for row in action_items:
        row["assignee"] = participant_names.get(row.get("assignee_participant_id"))
    decisions = client.table("decisions").select("title,description,translated_title,translated_description").eq("meeting_id", meeting_id).order("created_at").execute().data or []
    questions = client.table("questions").select("question,answer,translated_question,translated_answer,status").eq("meeting_id", meeting_id).order("created_at").execute().data or []
    tag_links = client.table("meeting_tags").select("tags(name)").eq("meeting_id", meeting_id).execute().data or []
    tags = [row["tags"]["name"] for row in tag_links if isinstance(row.get("tags"), dict) and row["tags"].get("name")]
    timeline = client.table("processing_events").select("event_type,status,message,created_at,event_order").eq("meeting_id", meeting_id).order("created_at").order("event_order").execute().data or []
    return {"meeting": meeting, "transcript": transcript, "speakers": speakers, "action_items": action_items, "decisions": decisions, "questions": questions, "tags": tags, "processing_timeline": timeline}


@app.post("/v1/meetings/{meeting_id}/export", tags=["meetings"])
async def export_meeting(
    meeting_id: str,
    payload: ExportMeetingRequest,
    authorization: str | None = Header(default=None),
) -> Response:
    from app.meeting_export import CONTENT_TYPES, build_export_document, render_export, safe_export_filename

    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    token = _require_bearer_token(authorization)
    client = get_supabase_service_client()
    user_id = _require_user_id(token)
    _enforce_export_rate_limit(user_id)
    _require_owned_meeting(client, meeting_id, user_id)
    try:
        data = _fetch_meeting_export_data(client, meeting_id)
        document = build_export_document(data, payload.sections.model_dump(), payload.language)
        content = render_export(document, payload.format)
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Meeting export generation failed", extra={"meeting_id": meeting_id, "format": payload.format})
        raise HTTPException(status_code=500, detail="Unable to prepare the meeting export.") from exc
    filename = safe_export_filename(data["meeting"].get("title") or "meeting", data["meeting"].get("scheduled_at"), payload.format)
    return Response(
        content=content,
        media_type=CONTENT_TYPES[payload.format].split(";", 1)[0],
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/v1/meetings/{meeting_id}/jobs/{job_id}", tags=["meetings"])
async def get_meeting_job_status(
    meeting_id: str,
    job_id: str,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    job_id = _validate_uuid(job_id, "job_id")
    token = _require_bearer_token(authorization)
    service_client = get_supabase_service_client()
    user_id = _require_user_id(token)
    _require_owned_meeting(service_client, meeting_id, user_id)
    processing_job = _get_processing_job(
        service_client,
        job_id=job_id,
        meeting_id=meeting_id,
    )

    if not processing_job:
        raise HTTPException(status_code=404, detail="Processing job was not found.")

    from celery.result import AsyncResult

    from app.workers.celery_app import celery_app

    try:
        job = AsyncResult(job_id, app=celery_app)
        job_state = job.state
        celery_ready = job.ready()
    except Exception:
        logger.exception("Unable to read Celery result state for job %s", job_id)
        job_state = "UNKNOWN"
        celery_ready = False

    processing_status = processing_job.get("status")
    ready = processing_status in TERMINAL_PROCESSING_STATUSES
    successful = processing_status in {"transcribed", "analyzed"}
    failed = processing_status == "failed"

    return {
        "meeting_id": meeting_id,
        "job_id": job_id,
        "job_type": processing_job.get("job_type"),
        "job_state": job_state,
        "job_status": processing_status,
        "ready": ready,
        "successful": successful,
        "failed": failed,
        "error_message": processing_job.get("error_message"),
        "processing_status": processing_status,
        "celery_ready": celery_ready,
    }


@app.post("/v1/meetings/{meeting_id}/jobs/{job_id}/cancel", tags=["meetings"])
async def cancel_meeting_job(
    meeting_id: str,
    job_id: str,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    job_id = _validate_uuid(job_id, "job_id")
    token = _require_bearer_token(authorization)
    service_client = get_supabase_service_client()
    user_id = _require_user_id(token)
    _require_owned_meeting(service_client, meeting_id, user_id)
    processing_job = _get_processing_job(
        service_client,
        job_id=job_id,
        meeting_id=meeting_id,
    )

    if not processing_job:
        raise HTTPException(status_code=404, detail="Processing job was not found.")

    if processing_job.get("status") in TERMINAL_PROCESSING_STATUSES:
        return {
            "meeting_id": meeting_id,
            "job_id": job_id,
            "processing_status": processing_job.get("status"),
        }

    from app.workers.celery_app import celery_app

    try:
        celery_app.control.revoke(job_id, terminate=False)
    except Exception:
        logger.exception("Unable to revoke Celery job %s", job_id)

    _mark_processing_job_cancelled(
        service_client,
        job_id=job_id,
    )

    return {
        "meeting_id": meeting_id,
        "job_id": job_id,
        "processing_status": "cancelled",
    }


@app.patch("/v1/meetings/{meeting_id}/participants/{participant_id}", tags=["speakers"])
async def update_participant_name(
    meeting_id: str,
    participant_id: str,
    payload: UpdateParticipantRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    participant_id = _validate_uuid(participant_id, "participant_id")
    token = _require_bearer_token(authorization)
    service_client = get_supabase_service_client()
    user_id = _require_user_id(token)
    _require_owned_meeting(service_client, meeting_id, user_id)
    display_name = payload.display_name.strip()

    participant = _require_participant(
        service_client,
        meeting_id=meeting_id,
        participant_id=participant_id,
    )
    updated = (
        service_client.table("participants")
        .update({"display_name": display_name})
        .eq("id", participant["id"])
        .eq("meeting_id", meeting_id)
        .execute()
    )
    transcript_revision = _mark_transcript_manually_edited(
        service_client, meeting_id=meeting_id, owner_id=user_id
    )
    return {
        "participant": updated.data[0],
        "analysis_stale": True,
        "transcript_revision": transcript_revision,
    }


@app.post("/v1/meetings/{meeting_id}/participants/merge", tags=["speakers"])
async def merge_participants(
    meeting_id: str,
    payload: MergeParticipantsRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    payload.source_participant_id = _validate_uuid(
        payload.source_participant_id,
        "source_participant_id",
    )
    payload.target_participant_id = _validate_uuid(
        payload.target_participant_id,
        "target_participant_id",
    )

    if payload.source_participant_id == payload.target_participant_id:
        raise HTTPException(status_code=400, detail="Choose two different speakers.")

    token = _require_bearer_token(authorization)
    service_client = get_supabase_service_client()
    user_id = _require_user_id(token)
    _require_owned_meeting(service_client, meeting_id, user_id)
    source = _require_participant(
        service_client,
        meeting_id=meeting_id,
        participant_id=payload.source_participant_id,
    )
    target = _require_participant(
        service_client,
        meeting_id=meeting_id,
        participant_id=payload.target_participant_id,
    )

    updated = (
        service_client.table("transcript_segments")
        .update(
            {
                "participant_id": target["id"],
                "speaker_label": target.get("speaker_label") or target["display_name"],
            }
        )
        .eq("meeting_id", meeting_id)
        .eq("participant_id", source["id"])
        .execute()
    )
    updated_segment_count = len(updated.data or [])
    (
        service_client.table("participants")
        .delete()
        .eq("id", source["id"])
        .eq("meeting_id", meeting_id)
        .execute()
    )
    transcript_revision = _mark_transcript_manually_edited(
        service_client, meeting_id=meeting_id, owner_id=user_id
    )
    return {
        "target_participant_id": target["id"],
        "merged_participant_id": source["id"],
        "updated_segment_count": updated_segment_count,
        "analysis_stale": True,
        "transcript_revision": transcript_revision,
    }


def _next_available_speaker_name(participants: list[dict[str, Any]]) -> str:
    existing_names = {
        _coerce_text(participant.get("display_name")).casefold()
        for participant in participants
    }
    speaker_number = 1
    while f"speaker {speaker_number}".casefold() in existing_names:
        speaker_number += 1
    return f"Speaker {speaker_number}"


@app.post(
    "/v1/meetings/{meeting_id}/participants/{participant_id}/split",
    tags=["speakers"],
)
async def split_participant(
    meeting_id: str,
    participant_id: str,
    payload: SplitParticipantRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    participant_id = _validate_uuid(participant_id, "participant_id")
    unique_segment_ids = list(
        dict.fromkeys(
            _validate_uuid(segment_id, "segment_id")
            for segment_id in payload.segment_ids
        )
    )
    token = _require_bearer_token(authorization)
    service_client = get_supabase_service_client()
    user_id = _require_user_id(token)
    _require_owned_meeting(service_client, meeting_id, user_id)
    source_participant = _require_participant(
        service_client,
        meeting_id=meeting_id,
        participant_id=participant_id,
    )

    selected_response = (
        service_client.table("transcript_segments")
        .select(
            "id,participant_id,speaker_label,start_ms,end_ms,text,"
            "original_text,translated_text,segment_index"
        )
        .eq("meeting_id", meeting_id)
        .eq("participant_id", source_participant["id"])
        .in_("id", unique_segment_ids)
        .execute()
    )
    selected_segments = selected_response.data or []
    selected_ids = {segment["id"] for segment in selected_segments}
    if selected_ids != set(unique_segment_ids):
        raise HTTPException(
            status_code=404,
            detail="One or more selected transcript turns do not belong to this speaker.",
        )

    display_name = _coerce_optional_text(payload.display_name)
    if not display_name:
        participant_response = (
            service_client.table("participants")
            .select("display_name")
            .eq("meeting_id", meeting_id)
            .execute()
        )
        display_name = _next_available_speaker_name(
            participant_response.data or []
        )
    participant = _create_participant(
        service_client,
        meeting_id=meeting_id,
        display_name=display_name,
        speaker_label=display_name,
        source="owner",
    )
    updated = (
        service_client.table("transcript_segments")
        .update(
            {
                "participant_id": participant["id"],
                "speaker_label": participant.get("speaker_label")
                or participant["display_name"],
            }
        )
        .eq("meeting_id", meeting_id)
        .eq("participant_id", source_participant["id"])
        .in_("id", unique_segment_ids)
        .execute()
    )
    if len(updated.data or []) != len(unique_segment_ids):
        (
            service_client.table("participants")
            .delete()
            .eq("id", participant["id"])
            .eq("meeting_id", meeting_id)
            .execute()
        )
        raise HTTPException(
            status_code=409,
            detail="The transcript changed before the speaker could be split. Please retry.",
        )
    transcript_revision = _mark_transcript_manually_edited(
        service_client, meeting_id=meeting_id, owner_id=user_id
    )
    return {
        "participant": participant,
        "source_participant_id": source_participant["id"],
        "segment_ids": unique_segment_ids,
        "updated_segment_count": len(updated.data or []),
        "analysis_stale": True,
        "transcript_revision": transcript_revision,
    }


def _normalize_split_text(value: str) -> str:
    return " ".join(value.split())


@app.post(
    "/v1/meetings/{meeting_id}/transcript-segments/{segment_id}/split",
    tags=["speakers"],
)
async def split_transcript_segment(
    meeting_id: str,
    segment_id: str,
    payload: SplitTranscriptSegmentRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    segment_id = _validate_uuid(segment_id, "segment_id")
    token = _require_bearer_token(authorization)
    service_client = get_supabase_service_client()
    user_id = _require_user_id(token)
    _require_owned_meeting(service_client, meeting_id, user_id)

    segment_response = (
        service_client.table("transcript_segments")
        .select("id,meeting_id,text")
        .eq("id", segment_id)
        .eq("meeting_id", meeting_id)
        .limit(1)
        .execute()
    )
    segment = segment_response.data[0] if segment_response.data else None
    if not segment:
        raise HTTPException(status_code=404, detail="Transcript segment was not found.")

    combined_text = " ".join(part.text for part in payload.parts)
    if _normalize_split_text(combined_text) != _normalize_split_text(segment["text"]):
        raise HTTPException(
            status_code=400,
            detail="Split parts must reconstruct the original transcript text.",
        )

    rpc_parts: list[dict[str, Any]] = []
    for part in payload.parts:
        participant_id = part.participant_id
        if participant_id:
            participant_id = _validate_uuid(participant_id, "participant_id")
            _require_participant(
                service_client,
                meeting_id=meeting_id,
                participant_id=participant_id,
            )
        rpc_parts.append(
            {
                "text": part.text,
                "participant_id": participant_id,
                "display_name": part.display_name,
            }
        )

    try:
        result = (
            service_client.rpc(
                "split_transcript_segment_revisioned",
                {
                    "p_meeting_id": meeting_id,
                    "p_segment_id": segment_id,
                    "p_owner_id": user_id,
                    "p_parts": rpc_parts,
                },
            ).execute()
        )
    except Exception as exc:
        logger.exception(
            "Unable to split transcript segment meeting_id=%s segment_id=%s",
            meeting_id,
            segment_id,
        )
        raise HTTPException(
            status_code=409,
            detail="Unable to split this transcript segment. Please refresh and try again.",
        ) from exc

    data = result.data
    if isinstance(data, list):
        data = data[0] if data else None
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=500,
            detail="The transcript split did not return a valid result.",
        )
    created_segments = data.get("segments")
    if not isinstance(created_segments, list) or not created_segments:
        raise HTTPException(
            status_code=500,
            detail="The transcript split did not return the created segments.",
        )
    created_segments.sort(
        key=lambda item: (
            int(item.get("segment_index", 0)),
            int(item.get("start_ms", 0)),
        )
    )
    if any(item.get("id") == segment_id for item in created_segments):
        raise HTTPException(
            status_code=500,
            detail="The transcript split returned an invalid segment result.",
        )
    return {
        **data,
        "meeting_id": meeting_id,
        "original_segment_id": segment_id,
        "segments": created_segments,
        "analysis_stale": bool(data.get("analysis_stale")),
        "transcript_revision": int(data.get("transcript_revision") or 1),
    }


@app.patch(
    "/v1/meetings/{meeting_id}/transcript-segments/{segment_id}",
    tags=["speakers"],
)
async def update_transcript_segment_text(
    meeting_id: str,
    segment_id: str,
    payload: UpdateTranscriptSegmentRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    segment_id = _validate_uuid(segment_id, "segment_id")
    token = _require_bearer_token(authorization)
    service_client = get_supabase_service_client()
    user_id = _require_user_id(token)
    _require_owned_meeting(service_client, meeting_id, user_id)
    updated = (
        service_client.table("transcript_segments")
        .update({"text": payload.text})
        .eq("id", segment_id)
        .eq("meeting_id", meeting_id)
        .execute()
    )
    if not updated.data:
        raise HTTPException(status_code=404, detail="Transcript segment was not found.")
    transcript_revision = _mark_transcript_manually_edited(
        service_client, meeting_id=meeting_id, owner_id=user_id
    )
    return {
        "segment": updated.data[0],
        "analysis_stale": True,
        "transcript_revision": transcript_revision,
    }


@app.post("/v1/meetings/{meeting_id}/transcript-segments/assign", tags=["speakers"])
async def assign_transcript_segments(
    meeting_id: str,
    payload: AssignTranscriptSegmentsRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    meeting_id = _validate_uuid(meeting_id, "meeting_id")
    payload.segment_ids = [
        _validate_uuid(segment_id, "segment_id")
        for segment_id in payload.segment_ids
    ]

    if payload.target_participant_id:
        payload.target_participant_id = _validate_uuid(
            payload.target_participant_id,
            "target_participant_id",
        )

    token = _require_bearer_token(authorization)
    service_client = get_supabase_service_client()
    user_id = _require_user_id(token)
    _require_owned_meeting(service_client, meeting_id, user_id)
    unique_segment_ids = list(dict.fromkeys(payload.segment_ids))

    segments_response = (
        service_client.table("transcript_segments")
        .select("id")
        .eq("meeting_id", meeting_id)
        .in_("id", unique_segment_ids)
        .execute()
    )
    matched_segment_ids = [segment["id"] for segment in segments_response.data or []]

    if len(matched_segment_ids) != len(unique_segment_ids):
        raise HTTPException(
            status_code=404,
            detail="One or more transcript segments were not found.",
        )

    if payload.target_participant_id:
        participant = _require_participant(
            service_client,
            meeting_id=meeting_id,
            participant_id=payload.target_participant_id,
        )
    else:
        display_name = _coerce_optional_text(payload.display_name)

        if not display_name:
            raise HTTPException(
                status_code=400,
                detail="Provide a target participant or a new speaker name.",
            )

        participant = _create_participant(
            service_client,
            meeting_id=meeting_id,
            display_name=display_name,
            speaker_label=display_name,
        )

    updated = (
        service_client.table("transcript_segments")
        .update(
            {
                "participant_id": participant["id"],
                "speaker_label": participant.get("speaker_label")
                or participant["display_name"],
            }
        )
        .eq("meeting_id", meeting_id)
        .in_("id", matched_segment_ids)
        .execute()
    )
    updated_segment_count = len(updated.data or [])
    updated_segments = (
        service_client.table("transcript_segments")
        .select(
            "id,participant_id,speaker_label,start_ms,end_ms,text,original_text,"
            "translated_text,transcript_kind,segment_index"
        )
        .eq("meeting_id", meeting_id)
        .in_("id", matched_segment_ids)
        .order("segment_index")
        .execute()
    ).data or []
    transcript_revision = _mark_transcript_manually_edited(
        service_client, meeting_id=meeting_id, owner_id=user_id
    )
    return {
        "participant": participant,
        "segments": updated_segments,
        "updated_segment_count": updated_segment_count,
        "analysis_stale": True,
        "transcript_revision": transcript_revision,
    }


# CORSMiddleware intentionally wraps the fully constructed FastAPI application,
# including Starlette's error middleware. This keeps CORS headers on sanitized
# 500 responses as well as normal and HTTPException responses.
fastapi_app = app
app = CORSMiddleware(
    app=fastapi_app,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
