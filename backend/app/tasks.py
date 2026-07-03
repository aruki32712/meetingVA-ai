import asyncio
from typing import Any

from app.celery_app import celery_app
from app.main import _run_analyze_meeting_job, _run_transcribe_meeting_job


@celery_app.task(name="meetingva.transcribe_meeting", bind=True)
def transcribe_meeting_task(
    self: Any,
    *,
    meeting_id: str,
    translate_to_english: bool = False,
) -> dict[str, Any]:
    return asyncio.run(
        _run_transcribe_meeting_job(
            meeting_id=meeting_id,
            translate_to_english=translate_to_english,
            job_id=self.request.id,
        )
    )


@celery_app.task(name="meetingva.analyze_meeting", bind=True)
def analyze_meeting_task(self: Any, *, meeting_id: str) -> dict[str, Any]:
    return asyncio.run(
        _run_analyze_meeting_job(
            meeting_id=meeting_id,
            job_id=self.request.id,
        )
    )
