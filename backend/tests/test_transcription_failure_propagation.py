import logging

import pytest

from app.main import TRANSCRIPTION_QUOTA_ERROR
from app.workers import transcription_worker


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeProcessingJobsTable:
    def __init__(self, client):
        self.client = client
        self.values = None

    def select(self, columns):
        return self

    def update(self, values):
        self.values = values
        return self

    def eq(self, column, value):
        assert column == "id"
        assert value == self.client.row["id"]
        return self

    def limit(self, count):
        assert count == 1
        return self

    def execute(self):
        if self.values is not None:
            self.client.row.update(self.values)
            self.client.transitions.append(dict(self.client.row))
        return FakeResponse([dict(self.client.row)])


class FakeServiceClient:
    def __init__(self):
        self.row = {
            "id": "22222222-2222-2222-2222-222222222222",
            "status": "queued",
            "started_at": None,
            "completed_at": None,
            "error_message": None,
        }
        self.transitions = []

    def table(self, table_name):
        assert table_name == "processing_jobs"
        return FakeProcessingJobsTable(self)


def test_worker_requires_database_processing_job_id(monkeypatch):
    monkeypatch.setattr(
        transcription_worker,
        "get_supabase_service_client",
        lambda: object(),
    )

    transcription_worker.transcribe_meeting_task.push_request(id="celery-task-id")
    try:
        with pytest.raises(RuntimeError, match="processing_job_id is required"):
            transcription_worker.transcribe_meeting_task.run(
                meeting_id="11111111-1111-1111-1111-111111111111",
            )
    finally:
        transcription_worker.transcribe_meeting_task.pop_request()


def test_worker_persists_failed_job_before_reraising(monkeypatch):
    calls: list[tuple[str, object]] = []
    provider_error = RuntimeError(
        "OpenAI transcription failed "
        "(HTTP 429, type=insufficient_quota, code=insufficient_quota): quota reached"
    )

    async def fail_transcription(**kwargs):
        calls.append(("run", kwargs["job_id"]))
        raise provider_error

    monkeypatch.setattr(
        transcription_worker,
        "get_supabase_service_client",
        lambda: object(),
    )
    monkeypatch.setattr(
        transcription_worker,
        "_processing_job_is_cancelled",
        lambda service_client, job_id: False,
    )
    monkeypatch.setattr(
        transcription_worker,
        "_mark_processing_job_started",
        lambda service_client, **kwargs: (
            calls.append(("started", kwargs["status"]))
            or {
                "id": kwargs["job_id"],
                "status": kwargs["status"],
                "started_at": "2026-07-31T12:00:00+00:00",
            }
        ),
    )
    monkeypatch.setattr(
        transcription_worker,
        "_run_transcribe_meeting_job",
        fail_transcription,
    )
    monkeypatch.setattr(
        transcription_worker,
        "_mark_processing_job_failed",
        lambda service_client, **kwargs: calls.append(
            ("failed", kwargs["error_message"])
        ),
    )

    with pytest.raises(RuntimeError):
        transcription_worker.transcribe_meeting_task.run(
            meeting_id="11111111-1111-1111-1111-111111111111",
            processing_job_id="22222222-2222-2222-2222-222222222222",
        )

    assert calls == [
        ("started", "transcribing"),
        ("run", "22222222-2222-2222-2222-222222222222"),
        ("failed", TRANSCRIPTION_QUOTA_ERROR),
    ]


def test_worker_moves_queued_job_to_transcribing_then_failed_on_429(
    monkeypatch,
    caplog,
):
    caplog.set_level(logging.INFO, logger=transcription_worker.__name__)
    client = FakeServiceClient()

    async def fail_transcription(**kwargs):
        assert kwargs["job_id"] == client.row["id"]
        raise RuntimeError(
            "OpenAI transcription failed "
            "(HTTP 429, type=insufficient_quota, code=insufficient_quota): quota reached"
        )

    monkeypatch.setattr(
        transcription_worker,
        "get_supabase_service_client",
        lambda: client,
    )
    monkeypatch.setattr(
        transcription_worker,
        "_run_transcribe_meeting_job",
        fail_transcription,
    )

    transcription_worker.transcribe_meeting_task.push_request(
        id="different-celery-task-id"
    )
    try:
        with pytest.raises(RuntimeError):
            transcription_worker.transcribe_meeting_task.run(
                meeting_id="11111111-1111-1111-1111-111111111111",
                processing_job_id=client.row["id"],
            )
    finally:
        transcription_worker.transcribe_meeting_task.pop_request()

    assert [row["status"] for row in client.transitions] == [
        "transcribing",
        "failed",
    ]
    assert client.row["started_at"] is not None
    assert client.row["completed_at"] is not None
    assert client.row["error_message"] == TRANSCRIPTION_QUOTA_ERROR

    before_update = next(
        record
        for record in caplog.records
        if record.message == "updating transcription job to started"
    )
    assert before_update.processing_job_id == client.row["id"]
    assert before_update.resolved_job_id == client.row["id"]
    assert before_update.celery_task_id == "different-celery-task-id"
    assert before_update.meeting_id == "11111111-1111-1111-1111-111111111111"

    after_update = next(
        record
        for record in caplog.records
        if record.message == "transcription job updated to started"
    )
    assert after_update.processing_job_id == client.row["id"]
    assert after_update.processing_job_status == "transcribing"
    assert after_update.processing_job_started_at is not None
