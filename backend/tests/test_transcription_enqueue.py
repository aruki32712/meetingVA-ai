from typing import Any

import pytest

from app.main import (
    TRANSCRIPTION_QUOTA_ERROR,
    TRANSCRIPTION_RATE_LIMIT_ERROR,
    _enqueue_transcription_job_if_needed,
    _user_safe_transcription_error,
)
from app.workers.transcription_worker import transcribe_meeting_task


class FakeResponse:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data


class FakeProcessingJobsTable:
    def __init__(self, client: "FakeServiceClient") -> None:
        self.client = client
        self.operation = "select"
        self.values: dict[str, Any] | None = None
        self.filters: list[tuple[str, Any]] = []
        self.status_filter: list[str] | None = None

    def select(self, columns: str) -> "FakeProcessingJobsTable":
        self.operation = "select"
        return self

    def insert(self, values: dict[str, Any]) -> "FakeProcessingJobsTable":
        self.operation = "insert"
        self.values = values
        return self

    def update(self, values: dict[str, Any]) -> "FakeProcessingJobsTable":
        self.operation = "update"
        self.values = values
        return self

    def eq(self, column: str, value: Any) -> "FakeProcessingJobsTable":
        self.filters.append((column, value))
        return self

    def in_(self, column: str, values: list[str]) -> "FakeProcessingJobsTable":
        assert column == "status"
        self.status_filter = values
        return self

    def order(self, column: str, *, desc: bool) -> "FakeProcessingJobsTable":
        assert column == "created_at"
        assert desc is True
        return self

    def limit(self, count: int) -> "FakeProcessingJobsTable":
        assert count == 1
        return self

    def execute(self) -> FakeResponse:
        if self.operation == "insert":
            assert self.values is not None
            self.client.inserted_jobs.append(self.values)
            return FakeResponse([self.values])

        if self.operation == "update":
            assert self.values is not None
            self.client.updated_jobs.append(self.values)
            return FakeResponse([])

        if self.status_filter is not None:
            active = (
                self.client.latest_job
                if self.client.latest_job
                and self.client.latest_job["status"] in self.status_filter
                else None
            )
            return FakeResponse([active] if active else [])

        return FakeResponse([self.client.latest_job] if self.client.latest_job else [])


class FakeServiceClient:
    def __init__(self, latest_job: dict[str, Any] | None = None) -> None:
        self.latest_job = latest_job
        self.inserted_jobs: list[dict[str, Any]] = []
        self.updated_jobs: list[dict[str, Any]] = []

    def table(self, table_name: str) -> FakeProcessingJobsTable:
        assert table_name == "processing_jobs"
        return FakeProcessingJobsTable(self)


def meeting_with_audio() -> dict[str, str]:
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "audio_storage_path": "user-id/meeting-id/recording.webm",
    }


def test_audio_ready_meeting_automatically_enqueues_transcription(monkeypatch):
    client = FakeServiceClient()
    enqueued: list[dict[str, Any]] = []

    monkeypatch.setattr(
        transcribe_meeting_task,
        "apply_async",
        lambda **kwargs: enqueued.append(kwargs),
    )

    result = _enqueue_transcription_job_if_needed(
        client,
        meeting=meeting_with_audio(),
        translate_to_english=False,
    )

    assert result["processing_status"] == "queued"
    assert len(client.inserted_jobs) == 1
    assert client.inserted_jobs[0]["job_type"] == "transcription"
    assert enqueued[0]["task_id"] == result["job_id"]
    assert enqueued[0]["kwargs"]["processing_job_id"] == result["job_id"]


@pytest.mark.parametrize("status", ["queued", "transcribing", "transcribed"])
def test_existing_active_or_completed_transcription_is_not_enqueued(
    monkeypatch,
    status: str,
):
    existing = {
        "id": "22222222-2222-2222-2222-222222222222",
        "status": status,
    }
    client = FakeServiceClient(existing)
    enqueued: list[dict[str, Any]] = []
    monkeypatch.setattr(
        transcribe_meeting_task,
        "apply_async",
        lambda **kwargs: enqueued.append(kwargs),
    )

    result = _enqueue_transcription_job_if_needed(
        client,
        meeting=meeting_with_audio(),
        translate_to_english=False,
    )

    assert result == {
        "meeting_id": meeting_with_audio()["id"],
        "job_id": existing["id"],
        "processing_status": status,
    }
    assert client.inserted_jobs == []
    assert enqueued == []


def test_failed_transcription_can_be_retried(monkeypatch):
    client = FakeServiceClient(
        {
            "id": "33333333-3333-3333-3333-333333333333",
            "status": "failed",
        }
    )
    enqueued: list[dict[str, Any]] = []
    monkeypatch.setattr(
        transcribe_meeting_task,
        "apply_async",
        lambda **kwargs: enqueued.append(kwargs),
    )

    result = _enqueue_transcription_job_if_needed(
        client,
        meeting=meeting_with_audio(),
        translate_to_english=True,
    )

    assert result["processing_status"] == "queued"
    assert len(client.inserted_jobs) == 1
    assert enqueued[0]["kwargs"]["translate_to_english"] is True


def test_openai_429_messages_are_safe_and_actionable():
    assert (
        _user_safe_transcription_error(
            "OpenAI transcription failed (HTTP 429, "
            "type=insufficient_quota, code=insufficient_quota): raw provider detail"
        )
        == TRANSCRIPTION_QUOTA_ERROR
    )
    assert (
        _user_safe_transcription_error(
            "OpenAI transcription failed (HTTP 429, "
            "type=rate_limit_exceeded, code=rate_limit_exceeded): retry later"
        )
        == TRANSCRIPTION_RATE_LIMIT_ERROR
    )
