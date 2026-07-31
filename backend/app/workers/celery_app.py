import logging
import sys
from urllib.parse import urlsplit

from celery import Celery
from celery.signals import worker_ready

from app.settings import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def _safe_redis_target(url: str) -> dict[str, str | int | None]:
    parsed = urlsplit(url)
    return {
        "scheme": parsed.scheme,
        "host": parsed.hostname,
        "port": parsed.port,
        "database": parsed.path.lstrip("/") or "0",
    }

celery_app = Celery(
    "meetingva_ai",
    broker=settings.celery_broker_url or settings.redis_url,
    backend=settings.celery_result_backend or settings.redis_url,
    include=[
        "app.workers.transcription_worker",
        "app.workers.analysis_worker",
    ],
)

celery_app.conf.update(
    task_track_started=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
)


@worker_ready.connect
def log_worker_configuration(sender: object | None = None, **_: object) -> None:
    """Log enough safe routing detail to diagnose publisher/worker mismatches."""
    broker_url = settings.celery_broker_url or settings.redis_url
    result_backend = settings.celery_result_backend or settings.redis_url
    logger.info(
        "celery worker ready",
        extra={
            "worker_startup_command": " ".join(sys.argv),
            "celery_broker": _safe_redis_target(broker_url),
            "celery_result_backend": _safe_redis_target(result_backend),
            "celery_queue": celery_app.conf.task_default_queue,
            "registered_celery_tasks": sorted(
                name for name in celery_app.tasks if name.startswith("meetingva.")
            ),
        },
    )
