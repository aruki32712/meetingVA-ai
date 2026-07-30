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

    def select(self, columns: str) -> "FakeTable":
        return self

    def execute(self) -> object:
        self.client.updates.append(
            {
                "table": self.table_name,
                "values": self.pending_update,
                "filters": self.filters,
            }
        )
        data = []
        if self.client.match_updates and self.pending_update is not None:
            data = [{"id": "job-id", **self.pending_update}]
        return type("Response", (), {"data": data})()


class FakeSupabaseClient:
    def __init__(self, *, match_updates: bool = True) -> None:
        self.updates: list[dict[str, object]] = []
        self.match_updates = match_updates

    def table(self, table_name: str) -> FakeTable:
        return FakeTable(table_name, self)


def test_celery_uses_redis_broker_and_result_backend() -> None:
    assert celery_app.conf.broker_url.startswith("redis://")
    assert celery_app.conf.result_backend.startswith("redis://")
    assert "app.workers.transcription_worker" in celery_app.conf.include
    assert "app.workers.analysis_worker" in celery_app.conf.include
    assert celery_app.conf.task_track_started is True


def test_processing_job_started_updates_job_status() -> None:
    client = FakeSupabaseClient()

    _mark_processing_job_started(
        client,
        job_id="job-id",
        status="transcribing",
        retry_count=2,
    )

    assert client.updates[0]["table"] == "processing_jobs"
    assert client.updates[0]["values"]["status"] == "transcribing"
    assert client.updates[0]["values"]["retry_count"] == 2
    assert len(client.updates) == 1


def test_processing_job_terminal_helpers_update_job_status() -> None:
    completed_client = FakeSupabaseClient()
    failed_client = FakeSupabaseClient()
    cancelled_client = FakeSupabaseClient()

    _mark_processing_job_completed(
        completed_client,
        job_id="job-id",
        status="transcribed",
    )
    _mark_processing_job_failed(
        failed_client,
        job_id="job-id",
        error_message="OpenAI timeout",
    )
    _mark_processing_job_cancelled(
        cancelled_client,
        job_id="job-id",
    )

    assert completed_client.updates[0]["values"]["status"] == "transcribed"
    assert len(completed_client.updates) == 1
    assert failed_client.updates[0]["values"]["status"] == "failed"
    assert failed_client.updates[0]["values"]["error_message"] == "OpenAI timeout"
    assert len(failed_client.updates) == 1
    assert cancelled_client.updates[0]["values"]["status"] == "cancelled"
    assert len(cancelled_client.updates) == 1


def test_processing_job_update_raises_when_no_row_matches() -> None:
    client = FakeSupabaseClient(match_updates=False)

    try:
        _mark_processing_job_started(
            client,
            job_id="missing-job-id",
            status="transcribing",
        )
    except RuntimeError as exc:
        assert str(exc) == "Processing job update matched no row: missing-job-id"
    else:
        raise AssertionError("Expected a zero-row processing job update to fail")
