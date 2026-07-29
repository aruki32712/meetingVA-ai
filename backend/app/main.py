import json
import logging
import re
import time
from collections import defaultdict, deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


class MergeParticipantsRequest(BaseModel):
    source_participant_id: str
    target_participant_id: str


class AssignTranscriptSegmentsRequest(BaseModel):
    segment_ids: list[str] = Field(min_length=1)
    target_participant_id: str | None = None
    display_name: str | None = Field(default=None, max_length=120)


class TranscribeMeetingRequest(BaseModel):
    translate_to_english: bool = False


class JobResponse(BaseModel):
    meeting_id: str
    job_id: str
    processing_status: str


ACTIVE_PROCESSING_STATUSES = {"queued", "transcribing", "analyzing"}
TERMINAL_PROCESSING_STATUSES = {"transcribed", "analyzed", "failed", "cancelled"}


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


def _coerce_segment_timestamp(value: Any) -> int:
    if value is None:
        return 0

    return max(0, round(float(value) * 1000))


def _extract_speaker_label(segment: dict[str, Any], fallback_index: int) -> str | None:
    for key in ("speaker_label", "speaker", "speaker_id"):
        value = _coerce_optional_text(segment.get(key))

        if value:
            return value

    if segment.get("speaker") is not None:
        return f"Speaker {fallback_index + 1}"

    return None


def _build_transcript_rows(
    meeting_id: str,
    transcription: dict[str, Any],
    duration_seconds: int | None,
    *,
    original_transcription: dict[str, Any] | None = None,
    transcript_kind: str = "original",
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
                    "speaker_label": _extract_speaker_label(segment, index)
                    or (
                        _extract_speaker_label(original_segment, index)
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
                    "confidence": None,
                    "segment_index": index,
                }
            )

        if rows:
            return rows

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


def _speaker_label_for_row(row: dict[str, Any], fallback_index: int) -> str:
    return _coerce_optional_text(row.get("speaker_label")) or _fallback_speaker_label(
        fallback_index
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
) -> None:
    (
        service_client.table("processing_jobs")
        .insert(
            {
                "id": job_id,
                "meeting_id": meeting_id,
                "job_type": job_type,
                "status": "queued",
                "worker_version": settings.worker_version,
            }
        )
        .execute()
    )


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
) -> None:
    service_client.table("processing_jobs").update(values).eq("id", job_id).execute()


def _mark_processing_job_started(
    service_client: Any,
    *,
    job_id: str,
    status: str,
    retry_count: int = 0,
) -> None:
    _update_processing_job(
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
) -> None:
    _update_processing_job(
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
) -> None:
    safe_error = error_message[:1000] if error_message else "Job failed."
    _update_processing_job(
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
                "metadata": {"detection_method": "owner_correction"},
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

    for index, row in enumerate(rows):
        label = _speaker_label_for_row(row, index)

        if label not in labels:
            labels.append(label)

    if not labels:
        return rows

    participant_rows = [
        {
            "meeting_id": meeting_id,
            "display_name": _fallback_speaker_label(index),
            "speaker_label": label,
            "source": "transcript",
            "metadata": {"detection_method": "transcription_diarization"},
        }
        for index, label in enumerate(labels)
    ]
    created = service_client.table("participants").insert(participant_rows).execute()
    participants_by_label = {
        participant["speaker_label"]: participant["id"]
        for participant in created.data
        if participant.get("speaker_label")
    }

    for index, row in enumerate(rows):
        label = _speaker_label_for_row(row, index)
        row["speaker_label"] = label
        row["participant_id"] = participants_by_label[label]

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


async def _transcribe_audio_with_openai(
    *,
    audio_bytes: bytes,
    filename: str,
    content_type: str,
) -> dict[str, Any]:
    openai_api_key = _require_configured(settings.openai_api_key, "OPENAI_API_KEY")

    form_data = [
        ("model", settings.openai_transcription_model),
        ("response_format", "verbose_json"),
        ("timestamp_granularities[]", "segment"),
    ]
    files = {"file": (filename, audio_bytes, content_type)}

    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {openai_api_key}"},
            data=form_data,
            files=files,
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail="OpenAI transcription request failed.",
        )

    return response.json()


async def _translate_audio_with_openai(
    *,
    audio_bytes: bytes,
    filename: str,
    content_type: str,
) -> dict[str, Any]:
    openai_api_key = _require_configured(settings.openai_api_key, "OPENAI_API_KEY")

    form_data = [
        ("model", settings.openai_transcription_model),
        ("response_format", "verbose_json"),
        ("timestamp_granularities[]", "segment"),
    ]
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
                    "and status, where status is open, answered, or deferred."
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
        .select("id,title,audio_storage_path,duration_seconds")
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
        transcription = await _transcribe_audio_with_openai(
            audio_bytes=audio_bytes,
            filename=filename,
            content_type="application/octet-stream",
        )
        detected_language = _normalize_language(transcription.get("language"))
        should_translate = translate_to_english and not _is_english_language(
            detected_language
        )
        transcript_payload = transcription
        translated = False

        if should_translate:
            transcript_payload = await _translate_audio_with_openai(
                audio_bytes=audio_bytes,
                filename=filename,
                content_type="application/octet-stream",
            )
            translated = True

        transcript_language = "english" if translated else detected_language
        translation_language = "english" if translated else None
        transcript_kind = _transcript_kind(
            detected_language=detected_language,
            translate_to_english=translate_to_english,
            translated=translated,
        )
        rows = _build_transcript_rows(
            meeting_id=meeting_id,
            transcription=transcript_payload,
            duration_seconds=meeting.get("duration_seconds"),
            original_transcription=transcription,
            transcript_kind=transcript_kind,
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
        rows = _attach_participants_to_transcript_rows(
            service_client,
            meeting_id=meeting_id,
            rows=rows,
        )
        service_client.table("transcript_segments").insert(rows).execute()
        (
            service_client.table("meetings")
            .update(
                {
                    "detected_language": detected_language,
                    "transcript_language": transcript_language,
                    "translation_language": translation_language,
                    "transcript_kind": transcript_kind,
                    "translate_to_english": translate_to_english,
                }
            )
            .eq("id", meeting_id)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Unable to transcribe meeting audio.",
        ) from exc

    return {
        "meeting_id": meeting_id,
        "job_id": job_id,
        "processing_status": "transcribed",
        "segment_count": len(rows),
        "detected_language": detected_language,
        "transcript_language": transcript_language,
        "translation_language": translation_language,
        "transcript_kind": transcript_kind,
    }


async def _run_analyze_meeting_job(
    *,
    meeting_id: str,
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
        .select("id,title")
        .eq("id", meeting_id)
        .limit(1)
        .execute()
    )
    meeting = meeting_response.data[0] if meeting_response.data else None

    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting was not found.")

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
        raise HTTPException(status_code=400, detail="Meeting has no transcript.")

    try:
        analysis = await _analyze_transcript_with_openai(
            meeting_title=meeting.get("title") or "Untitled meeting",
            transcript=transcript,
        )
        rows = _build_analysis_rows(meeting_id, analysis)

        for table_name in ("action_items", "decisions", "questions"):
            (
                service_client.table(table_name)
                .delete()
                .eq("meeting_id", meeting_id)
                .execute()
            )

            if rows[table_name]:
                service_client.table(table_name).insert(rows[table_name]).execute()

        (
            service_client.table("meetings")
            .update(
                {
                    "summary": analysis["executive_summary"],
                    "brief": analysis["meeting_brief"],
                }
            )
            .eq("id", meeting_id)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Unable to analyze meeting transcript.",
        ) from exc

    return {
        "meeting_id": meeting_id,
        "job_id": job_id,
        "processing_status": "analyzed",
        "action_item_count": len(rows["action_items"]),
        "decision_count": len(rows["decisions"]),
        "question_count": len(rows["questions"]),
    }


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
    _ensure_not_processing(service_client, meeting_id)

    if not meeting.get("audio_storage_path"):
        raise HTTPException(status_code=400, detail="Meeting has no audio file.")

    job_id = str(uuid4())
    _create_processing_job(
        service_client,
        job_id=job_id,
        meeting_id=meeting_id,
        job_type="transcription",
    )
    from app.workers.transcription_worker import transcribe_meeting_task

    try:
        transcribe_meeting_task.apply_async(
            kwargs={
                "meeting_id": meeting_id,
                "translate_to_english": bool(payload and payload.translate_to_english),
                "processing_job_id": job_id,
            },
            task_id=job_id,
        )
    except Exception as exc:
        _mark_processing_job_failed(
            service_client,
            job_id=job_id,
            error_message="Unable to enqueue transcription job.",
        )
        raise HTTPException(
            status_code=503,
            detail="Unable to enqueue transcription job.",
        ) from exc

    return {
        "meeting_id": meeting_id,
        "job_id": job_id,
        "processing_status": "queued",
    }


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
    _require_owned_meeting(service_client, meeting_id, user_id)
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
    _create_processing_job(
        service_client,
        job_id=job_id,
        meeting_id=meeting_id,
        job_type="analysis",
    )
    from app.workers.analysis_worker import analyze_meeting_task

    try:
        analyze_meeting_task.apply_async(
            kwargs={"meeting_id": meeting_id, "processing_job_id": job_id},
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
        ready = job.ready()
        successful = job.successful() if ready else False
        failed = job.failed()
    except Exception:
        logger.exception("Unable to read Celery result state for job %s", job_id)
        job_state = "UNKNOWN"
        ready = processing_job.get("status") in TERMINAL_PROCESSING_STATUSES
        successful = processing_job.get("status") in {"transcribed", "analyzed"}
        failed = processing_job.get("status") == "failed"

    return {
        "meeting_id": meeting_id,
        "job_id": job_id,
        "job_type": processing_job.get("job_type"),
        "job_state": job_state,
        "job_status": processing_job.get("status"),
        "ready": ready,
        "successful": successful,
        "failed": failed or processing_job.get("status") == "failed",
        "error_message": processing_job.get("error_message"),
        "processing_status": processing_job.get("status"),
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
    return {"participant": updated.data[0]}


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
    return {
        "target_participant_id": target["id"],
        "merged_participant_id": source["id"],
        "updated_segment_count": updated_segment_count,
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
    return {
        "participant": participant,
        "updated_segment_count": updated_segment_count,
    }
