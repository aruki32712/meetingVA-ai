import asyncio
import logging
from typing import Any

from app.main import (
    _mark_processing_job_completed,
    _mark_processing_job_failed,
    _mark_processing_job_started,
    _processing_job_is_cancelled,
    _run_analyze_meeting_job,
    _sanitize_processing_error_message,
)
from app.supabase_client import get_supabase_service_client
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)
ANALYSIS_USER_SAFE_ERROR = "Unable to analyze meeting transcript."


def _root_failure(error: BaseException) -> BaseException:
    return error.__cause__ or error


@celery_app.task(name="meetingva.analyze_meeting", bind=True)
def analyze_meeting_task(
    self: Any,
    *,
    meeting_id: str,
    processing_job_id: str | None = None,
) -> dict[str, Any]:
    job_id = processing_job_id or self.request.id
    service_client = get_supabase_service_client()

    if _processing_job_is_cancelled(service_client, job_id):
        logger.info("analysis job cancelled before start", extra={"job_id": job_id})
        return {"meeting_id": meeting_id, "job_id": job_id, "processing_status": "cancelled"}

    if getattr(self.request, "retries", 0):
        logger.warning(
            "retrying analysis job",
            extra={"job_id": job_id, "retry_count": self.request.retries},
        )

    logger.info("analysis job started", extra={"job_id": job_id})
    _mark_processing_job_started(
        service_client,
        job_id=job_id,
        status="analyzing",
        retry_count=getattr(self.request, "retries", 0),
    )

    try:
        result = asyncio.run(
            _run_analyze_meeting_job(
                meeting_id=meeting_id,
                job_id=job_id,
            )
        )
    except Exception as exc:
        original_error = _root_failure(exc)
        sanitized_error = _sanitize_processing_error_message(original_error)
        try:
            original_error.args = (sanitized_error,)
        except (AttributeError, TypeError):
            pass
        if hasattr(original_error, "detail"):
            original_error.detail = sanitized_error
        logger.exception(
            "analysis job failed",
            extra={
                "processing_job_id": job_id,
                "meeting_id": meeting_id,
                "exception_type": type(original_error).__name__,
                "exception_message": sanitized_error,
            },
        )
        _mark_processing_job_failed(
            service_client,
            job_id=job_id,
            error_message=ANALYSIS_USER_SAFE_ERROR,
        )
        raise RuntimeError("Unable to analyze meeting transcript") from exc

    if result.get("processing_status") == "cancelled":
        logger.info("analysis job cancelled", extra={"job_id": job_id})
        return result

    logger.info("analysis job completed", extra={"job_id": job_id})
    _mark_processing_job_completed(
        service_client,
        job_id=job_id,
        status="analyzed",
    )
    return result
