from typing import Any

import pytest
from fastapi import HTTPException

from app.workers import analysis_worker


class FakeResponse:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data


class FakeProcessingJobsTable:
    def __init__(self, client: "FakeServiceClient") -> None:
        self.client = client
        self.values: dict[str, Any] | None = None

    def select(self, columns: str) -> "FakeProcessingJobsTable":
        return self

    def update(self, values: dict[str, Any]) -> "FakeProcessingJobsTable":
        self.values = values
        return self

    def eq(self, column: str, value: object) -> "FakeProcessingJobsTable":
        assert column == "id"
        assert value == self.client.row["id"]
        return self

    def limit(self, count: int) -> "FakeProcessingJobsTable":
        assert count == 1
        return self

    def execute(self) -> FakeResponse:
        if self.values is not None:
            self.client.row.update(self.values)
            self.client.transitions.append(dict(self.client.row))
        return FakeResponse([dict(self.client.row)])


class FakeServiceClient:
    def __init__(self) -> None:
        self.row: dict[str, Any] = {
            "id": "22222222-2222-2222-2222-222222222222",
            "status": "queued",
            "started_at": None,
            "completed_at": None,
            "error_message": None,
        }
        self.transitions: list[dict[str, Any]] = []

    def table(self, table_name: str) -> FakeProcessingJobsTable:
        assert table_name == "processing_jobs"
        return FakeProcessingJobsTable(self)


def configure_worker(monkeypatch: pytest.MonkeyPatch, client: FakeServiceClient) -> None:
    monkeypatch.setattr(
        analysis_worker,
        "get_supabase_service_client",
        lambda: client,
    )


def run_analysis_task(client: FakeServiceClient) -> dict[str, Any]:
    return analysis_worker.analyze_meeting_task.run(
        meeting_id="11111111-1111-1111-1111-111111111111",
        processing_job_id=client.row["id"],
    )


def test_analysis_job_moves_from_queued_to_analyzing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = FakeServiceClient()
    configure_worker(monkeypatch, client)

    async def assert_started(**kwargs: Any) -> dict[str, Any]:
        assert client.row["status"] == "analyzing"
        assert client.row["started_at"] is not None
        return {"processing_status": "analyzed"}

    monkeypatch.setattr(analysis_worker, "_run_analyze_meeting_job", assert_started)

    run_analysis_task(client)

    assert client.transitions[0]["status"] == "analyzing"


def test_successful_analysis_job_moves_to_analyzed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = FakeServiceClient()
    configure_worker(monkeypatch, client)

    async def succeed(**kwargs: Any) -> dict[str, Any]:
        return {"processing_status": "analyzed"}

    monkeypatch.setattr(analysis_worker, "_run_analyze_meeting_job", succeed)

    run_analysis_task(client)

    assert [row["status"] for row in client.transitions] == [
        "analyzing",
        "analyzed",
    ]
    assert client.row["completed_at"] is not None
    assert client.row["error_message"] is None


def test_failed_analysis_job_moves_to_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = FakeServiceClient()
    configure_worker(monkeypatch, client)

    async def fail(**kwargs: Any) -> dict[str, Any]:
        raise ValueError("provider request failed")

    monkeypatch.setattr(analysis_worker, "_run_analyze_meeting_job", fail)

    with pytest.raises(RuntimeError, match="Unable to analyze meeting transcript"):
        run_analysis_task(client)

    assert [row["status"] for row in client.transitions] == [
        "analyzing",
        "failed",
    ]
    assert client.row["completed_at"] is not None


def test_failed_analysis_persists_user_safe_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = FakeServiceClient()
    configure_worker(monkeypatch, client)

    async def fail(**kwargs: Any) -> dict[str, Any]:
        raise RuntimeError(
            "request failed at https://internal.example/audio?token=signed "
            "Bearer secret-token"
        )

    monkeypatch.setattr(analysis_worker, "_run_analyze_meeting_job", fail)

    with pytest.raises(RuntimeError):
        run_analysis_task(client)

    assert client.row["error_message"] == analysis_worker.ANALYSIS_USER_SAFE_ERROR
    assert "https://" not in client.row["error_message"]
    assert "secret-token" not in client.row["error_message"]


def test_fastapi_http_exception_does_not_escape_celery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = FakeServiceClient()
    configure_worker(monkeypatch, client)

    async def fail(**kwargs: Any) -> dict[str, Any]:
        raise HTTPException(status_code=502, detail="provider unavailable")

    monkeypatch.setattr(analysis_worker, "_run_analyze_meeting_job", fail)

    with pytest.raises(RuntimeError) as raised:
        run_analysis_task(client)

    assert not isinstance(raised.value, HTTPException)
    assert client.row["status"] == "failed"
