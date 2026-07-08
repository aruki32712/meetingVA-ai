import asyncio
import logging
from typing import Any

from app.main import (
    _mark_processing_job_completed,
    _mark_processing_job_failed,
    _mark_processing_job_started,
    _processing_job_is_cancelled,
    _run_transcribe_meeting_job,
)
from app.supabase_client import get_supabase_service_client
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="meetingva.transcribe_meeting", bind=True)
def transcribe_meeting_task(
    self: Any,
    *,
    meeting_id: str,
    translate_to_english: bool = False,
    processing_job_id: str | None = None,
) -> dict[str, Any]:
    job_id = processing_job_id or self.request.id
    service_client = get_supabase_service_client()

    if _processing_job_is_cancelled(service_client, job_id):
        logger.info("transcription job cancelled before start", extra={"job_id": job_id})
        return {"meeting_id": meeting_id, "job_id": job_id, "processing_status": "cancelled"}

    if getattr(self.request, "retries", 0):
        logger.warning(
            "retrying transcription job",
            extra={"job_id": job_id, "retry_count": self.request.retries},
        )

    logger.info("transcription job started", extra={"job_id": job_id})
    _mark_processing_job_started(
        service_client,
        job_id=job_id,
        meeting_id=meeting_id,
        status="transcribing",
        retry_count=getattr(self.request, "retries", 0),
    )

    try:
        result = asyncio.run(
            _run_transcribe_meeting_job(
                meeting_id=meeting_id,
                translate_to_english=translate_to_english,
                job_id=job_id,
            )
        )
    except Exception as exc:
        logger.exception("transcription job failed", extra={"job_id": job_id})
        _mark_processing_job_failed(
            service_client,
            job_id=job_id,
            meeting_id=meeting_id,
            error_message=str(exc),
        )
        raise

    if result.get("processing_status") == "cancelled":
        logger.info("transcription job cancelled", extra={"job_id": job_id})
        return result

    logger.info("transcription job completed", extra={"job_id": job_id})
    _mark_processing_job_completed(
        service_client,
        job_id=job_id,
        meeting_id=meeting_id,
        status="transcribed",
    )
    return result
