from app.main import (
    _mark_processing_job_cancelled,
    _mark_processing_job_completed,
    _mark_processing_job_failed,
    _mark_processing_job_started,
)
from app.workers.celery_app import celery_app


class FakeTable:
    def __init__(self, table_name: str, client: "FakeSupabaseClient") -> None:
        self.table_name = table_name
        self.client = client
        self.pending_update: dict[str, object] | None = None
        self.filters: list[tuple[str, object]] = []

    def update(self, values: dict[str, object]) -> "FakeTable":
        self.pending_update = values
        return self

    def eq(self, column: str, value: object) -> "FakeTable":
        self.filters.append((column, value))
        return self

    def execute(self) -> object:
        self.client.updates.append(
            {
                "table": self.table_name,
                "values": self.pending_update,
                "filters": self.filters,
            }
        )
        return type("Response", (), {"data": []})()


class FakeSupabaseClient:
    def __init__(self) -> None:
        self.updates: list[dict[str, object]] = []

    def table(self, table_name: str) -> FakeTable:
        return FakeTable(table_name, self)


def test_celery_uses_redis_broker_and_result_backend() -> None:
    assert celery_app.conf.broker_url.startswith("redis://")
    assert celery_app.conf.result_backend.startswith("redis://")
    assert "app.workers.transcription_worker" in celery_app.conf.include
    assert "app.workers.analysis_worker" in celery_app.conf.include
    assert celery_app.conf.task_track_started is True


def test_processing_job_started_updates_job_and_meeting_status() -> None:
    client = FakeSupabaseClient()

    _mark_processing_job_started(
        client,
        job_id="job-id",
        meeting_id="meeting-id",
        status="transcribing",
        retry_count=2,
    )

    assert client.updates[0]["table"] == "processing_jobs"
    assert client.updates[0]["values"]["status"] == "transcribing"
    assert client.updates[0]["values"]["retry_count"] == 2
    assert client.updates[1]["table"] == "meetings"
    assert client.updates[1]["values"] == {"processing_status": "transcribing"}


def test_processing_job_terminal_helpers_update_job_and_meeting_status() -> None:
    completed_client = FakeSupabaseClient()
    failed_client = FakeSupabaseClient()
    cancelled_client = FakeSupabaseClient()

    _mark_processing_job_completed(
        completed_client,
        job_id="job-id",
        meeting_id="meeting-id",
        status="transcribed",
    )
    _mark_processing_job_failed(
        failed_client,
        job_id="job-id",
        meeting_id="meeting-id",
        error_message="OpenAI timeout",
    )
    _mark_processing_job_cancelled(
        cancelled_client,
        job_id="job-id",
        meeting_id="meeting-id",
    )

    assert completed_client.updates[0]["values"]["status"] == "transcribed"
    assert completed_client.updates[1]["values"] == {"processing_status": "transcribed"}
    assert failed_client.updates[0]["values"]["status"] == "failed"
    assert failed_client.updates[0]["values"]["error_message"] == "OpenAI timeout"
    assert failed_client.updates[1]["values"] == {"processing_status": "failed"}
    assert cancelled_client.updates[0]["values"]["status"] == "cancelled"
    assert cancelled_client.updates[1]["values"] == {"processing_status": "cancelled"}
