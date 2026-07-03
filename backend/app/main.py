from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.supabase_client import get_supabase_anon_client, get_supabase_service_client
from app.settings import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Initial MeetingVA AI API scaffold.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


def _coerce_segment_timestamp(value: Any) -> int:
    if value is None:
        return 0

    return max(0, round(float(value) * 1000))


def _build_transcript_rows(
    meeting_id: str,
    transcription: dict[str, Any],
    duration_seconds: int | None,
) -> list[dict[str, Any]]:
    segments = transcription.get("segments")

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

            rows.append(
                {
                    "meeting_id": meeting_id,
                    "speaker_label": None,
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "text": text,
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
            "confidence": None,
            "segment_index": 0,
        }
    ]


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


@app.post("/v1/meetings/{meeting_id}/transcribe", tags=["meetings"])
async def transcribe_meeting(
    meeting_id: str,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    token = _require_bearer_token(authorization)
    anon_client = get_supabase_anon_client()
    service_client = get_supabase_service_client()

    try:
        user_response = anon_client.auth.get_user(token)
        user_id = user_response.user.id
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid Supabase session.") from exc

    meeting_response = (
        service_client.table("meetings")
        .select("id,user_id,owner_id,audio_storage_path,duration_seconds")
        .eq("id", meeting_id)
        .or_(f"user_id.eq.{user_id},owner_id.eq.{user_id}")
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
        (
            service_client.table("meetings")
            .update({"processing_status": "transcribing"})
            .eq("id", meeting_id)
            .execute()
        )

        audio_bytes = service_client.storage.from_("meeting-audio").download(
            audio_storage_path
        )
        filename = Path(audio_storage_path).name or "meeting-audio.webm"
        transcription = await _transcribe_audio_with_openai(
            audio_bytes=audio_bytes,
            filename=filename,
            content_type="application/octet-stream",
        )
        rows = _build_transcript_rows(
            meeting_id=meeting_id,
            transcription=transcription,
            duration_seconds=meeting.get("duration_seconds"),
        )

        (
            service_client.table("transcript_segments")
            .delete()
            .eq("meeting_id", meeting_id)
            .execute()
        )
        service_client.table("transcript_segments").insert(rows).execute()
        (
            service_client.table("meetings")
            .update({"processing_status": "transcribed"})
            .eq("id", meeting_id)
            .execute()
        )
    except HTTPException:
        (
            service_client.table("meetings")
            .update({"processing_status": "transcription_failed"})
            .eq("id", meeting_id)
            .execute()
        )
        raise
    except Exception as exc:
        (
            service_client.table("meetings")
            .update({"processing_status": "transcription_failed"})
            .eq("id", meeting_id)
            .execute()
        )
        raise HTTPException(
            status_code=500,
            detail="Unable to transcribe meeting audio.",
        ) from exc

    return {
        "meeting_id": meeting_id,
        "processing_status": "transcribed",
        "segment_count": len(rows),
    }
