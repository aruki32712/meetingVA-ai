import asyncio
from typing import Any

import pytest
from fastapi import HTTPException

from app import main

MEETING_ID = "11111111-1111-1111-1111-111111111111"
OWNER_ID = "22222222-2222-2222-2222-222222222222"


class Response:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data


class FakeStorageBucket:
    def __init__(self, *, failure_message: str | None = None) -> None:
        self.failure_message = failure_message
        self.removed: list[str] = []

    def remove(self, paths: list[str]) -> list[dict[str, str]]:
        if self.failure_message:
            raise RuntimeError(self.failure_message)

        self.removed.extend(paths)
        return [{"name": path} for path in paths]


class FakeStorage:
    def __init__(self, bucket: FakeStorageBucket) -> None:
        self.bucket = bucket

    def from_(self, bucket_name: str) -> FakeStorageBucket:
        assert bucket_name == "meeting-audio"
        return self.bucket


class FakeQuery:
    def __init__(self, client: "FakeServiceClient", table_name: str) -> None:
        self.client = client
        self.table_name = table_name
        self.filters: list[tuple[str, str, Any]] = []
        self.operation = "select"
        self.limit_count: int | None = None

    def select(self, _columns: str) -> "FakeQuery":
        self.operation = "select"
        return self

    def delete(self) -> "FakeQuery":
        self.operation = "delete"
        return self

    def eq(self, column: str, value: Any) -> "FakeQuery":
        self.filters.append(("eq", column, value))
        return self

    def in_(self, column: str, values: list[str]) -> "FakeQuery":
        self.filters.append(("in", column, values))
        return self

    def limit(self, count: int) -> "FakeQuery":
        self.limit_count = count
        return self

    def _matches(self, row: dict[str, Any]) -> bool:
        return all(
            row.get(column) == value
            if operation == "eq"
            else row.get(column) in value
            for operation, column, value in self.filters
        )

    def execute(self) -> Response:
        rows = self.client.rows[self.table_name]
        matched = [row for row in rows if self._matches(row)]

        if self.operation == "delete":
            self.client.rows[self.table_name] = [
                row for row in rows if not self._matches(row)
            ]

            if self.table_name == "meetings" and matched:
                self.client.meeting_deleted = True
                meeting_ids = {row["id"] for row in matched}

                for table_name in main.MEETING_CASCADE_TABLES:
                    self.client.rows[table_name] = [
                        row
                        for row in self.client.rows[table_name]
                        if row.get("meeting_id") not in meeting_ids
                    ]

                for row in self.client.rows["audit_logs"]:
                    if row.get("meeting_id") in meeting_ids:
                        row["meeting_id"] = None

        if self.limit_count is not None:
            matched = matched[: self.limit_count]

        return Response(matched)


class FakeServiceClient:
    def __init__(
        self,
        *,
        active_status: str | None = None,
        storage_failure_message: str | None = None,
        verification_failure: bool = False,
    ):
        meeting = {
            "id": MEETING_ID,
            "owner_id": OWNER_ID,
            "title": "Customer discovery",
            "audio_storage_path": f"{OWNER_ID}/{MEETING_ID}/recording.webm",
            "duration_seconds": 120,
        }
        self.rows: dict[str, list[dict[str, Any]]] = {
            "meetings": [meeting],
            "audit_logs": [{"id": "audit-1", "meeting_id": MEETING_ID}],
        }

        for table_name in main.MEETING_CASCADE_TABLES:
            self.rows[table_name] = [
                {
                    "id": f"{table_name}-1",
                    "meeting_id": MEETING_ID,
                    **(
                        {"status": active_status or "completed"}
                        if table_name == "processing_jobs"
                        else {}
                    ),
                }
            ]

        self.verification_failure = verification_failure
        self.meeting_deleted = False
        self.bucket = FakeStorageBucket(failure_message=storage_failure_message)
        self.storage = FakeStorage(self.bucket)

    def table(self, table_name: str) -> FakeQuery:
        if self.verification_failure and self.meeting_deleted and table_name == "audit_logs":
            raise RuntimeError("verification unavailable")
        return FakeQuery(self, table_name)


def configure_endpoint(monkeypatch: pytest.MonkeyPatch, client: FakeServiceClient, user_id: str):
    monkeypatch.setattr(main, "get_supabase_service_client", lambda: client)
    monkeypatch.setattr(main, "_require_user_id", lambda _token: user_id)


def test_owner_deletes_meeting_audio_and_all_dependent_rows(monkeypatch) -> None:
    client = FakeServiceClient()
    configure_endpoint(monkeypatch, client, OWNER_ID)

    result = asyncio.run(
        main.delete_meeting(MEETING_ID, authorization="Bearer test-token")
    )

    assert result == {"meeting_id": MEETING_ID, "deleted": True}
    assert client.rows["meetings"] == []
    assert all(client.rows[table_name] == [] for table_name in main.MEETING_CASCADE_TABLES)
    assert client.rows["audit_logs"][0]["meeting_id"] is None
    assert client.bucket.removed == [f"{OWNER_ID}/{MEETING_ID}/recording.webm"]


def test_non_owner_cannot_delete_meeting(monkeypatch) -> None:
    client = FakeServiceClient()
    configure_endpoint(
        monkeypatch,
        client,
        "33333333-3333-3333-3333-333333333333",
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(main.delete_meeting(MEETING_ID, authorization="Bearer test-token"))

    assert exc_info.value.status_code == 404
    assert len(client.rows["meetings"]) == 1
    assert client.bucket.removed == []


@pytest.mark.parametrize("status", ["queued", "transcribing", "analyzing"])
def test_active_job_blocks_meeting_deletion(monkeypatch, status: str) -> None:
    client = FakeServiceClient(active_status=status)
    configure_endpoint(monkeypatch, client, OWNER_ID)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(main.delete_meeting(MEETING_ID, authorization="Bearer test-token"))

    assert exc_info.value.status_code == 409
    assert "active" in str(exc_info.value.detail).lower()
    assert len(client.rows["meetings"]) == 1
    assert client.bucket.removed == []


def test_storage_failure_keeps_meeting_record(monkeypatch) -> None:
    client = FakeServiceClient(storage_failure_message="storage unavailable")
    configure_endpoint(monkeypatch, client, OWNER_ID)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(main.delete_meeting(MEETING_ID, authorization="Bearer test-token"))

    assert exc_info.value.status_code == 502
    assert len(client.rows["meetings"]) == 1


def test_missing_audio_object_does_not_prevent_meeting_deletion(monkeypatch) -> None:
    client = FakeServiceClient(storage_failure_message="Object not found")
    configure_endpoint(monkeypatch, client, OWNER_ID)

    result = asyncio.run(
        main.delete_meeting(MEETING_ID, authorization="Bearer test-token")
    )

    assert result == {"meeting_id": MEETING_ID, "deleted": True}
    assert client.rows["meetings"] == []


def test_post_delete_verification_failure_still_returns_success(monkeypatch) -> None:
    client = FakeServiceClient(verification_failure=True)
    configure_endpoint(monkeypatch, client, OWNER_ID)

    result = asyncio.run(
        main.delete_meeting(MEETING_ID, authorization="Bearer test-token")
    )

    assert result == {"meeting_id": MEETING_ID, "deleted": True}
    assert client.rows["meetings"] == []
