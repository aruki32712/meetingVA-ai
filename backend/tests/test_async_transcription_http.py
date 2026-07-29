import asyncio

import httpx

from app import main


def test_transcription_request_uses_async_compatible_multipart(monkeypatch):
    request_details: dict[str, bytes | str] = {}

    async def handle_request(request: httpx.Request) -> httpx.Response:
        request_details["content_type"] = request.headers["content-type"]
        request_details["body"] = await request.aread()
        return httpx.Response(
            200,
            json={
                "text": "Test transcript",
                "language": "en",
                "segments": [],
            },
        )

    real_async_client = httpx.AsyncClient
    transport = httpx.MockTransport(handle_request)

    def create_async_client(*args, **kwargs):
        return real_async_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(main.httpx, "AsyncClient", create_async_client)
    monkeypatch.setattr(main.settings, "openai_api_key", "test-api-key")

    result = asyncio.run(
        main._transcribe_audio_with_openai(
            audio_bytes=b"test audio",
            filename="recording.webm",
            content_type="audio/webm",
        )
    )

    assert result["text"] == "Test transcript"
    assert str(request_details["content_type"]).startswith("multipart/form-data;")
    body = request_details["body"]
    assert isinstance(body, bytes)
    assert b'name="model"' in body
    assert main.settings.openai_transcription_model.encode() in body
    assert b'name="timestamp_granularities[]"' in body
    assert b'name="file"; filename="recording.webm"' in body


def test_transcription_preserves_and_logs_openai_error(monkeypatch, caplog):
    async def handle_request(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={
                "error": {
                    "type": "invalid_request_error",
                    "code": "invalid_audio",
                    "message": "Unsupported audio format",
                }
            },
        )

    real_async_client = httpx.AsyncClient
    transport = httpx.MockTransport(handle_request)

    def create_async_client(*args, **kwargs):
        return real_async_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(main.httpx, "AsyncClient", create_async_client)
    monkeypatch.setattr(main.settings, "openai_api_key", "test-api-key")

    try:
        asyncio.run(
            main._transcribe_audio_with_openai(
                audio_bytes=b"invalid audio",
                filename="recording.webm",
                content_type="audio/webm",
            )
        )
    except RuntimeError as exc:
        assert (
            "OpenAI transcription failed "
            "(HTTP 400, type=invalid_request_error, code=invalid_audio): "
            "Unsupported audio format"
        ) == str(exc)
        assert isinstance(exc.__cause__, httpx.HTTPStatusError)
    else:
        raise AssertionError("Expected the OpenAI transcription request to fail")

    error_record = next(
        record
        for record in caplog.records
        if record.message == "OpenAI transcription request failed"
    )
    assert error_record.exc_info is not None
    assert error_record.openai_status_code == 400
    assert error_record.openai_error_type == "invalid_request_error"
    assert error_record.openai_error_code == "invalid_audio"
    assert error_record.openai_error_message == "Unsupported audio format"
    assert "Unsupported audio format" in error_record.openai_response_body
    assert "test-api-key" not in error_record.openai_response_body


def test_transcription_does_not_retry_quota_error(monkeypatch):
    request_count = 0
    sleep_delays: list[int] = []

    async def handle_request(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(
            429,
            json={
                "error": {
                    "type": "insufficient_quota",
                    "code": "insufficient_quota",
                    "message": "You exceeded your current quota.",
                }
            },
        )

    async def record_sleep(delay: int) -> None:
        sleep_delays.append(delay)

    real_async_client = httpx.AsyncClient
    transport = httpx.MockTransport(handle_request)

    def create_async_client(*args, **kwargs):
        return real_async_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(main.httpx, "AsyncClient", create_async_client)
    monkeypatch.setattr(main.asyncio, "sleep", record_sleep)
    monkeypatch.setattr(main.settings, "openai_api_key", "test-api-key")

    try:
        asyncio.run(
            main._transcribe_audio_with_openai(
                audio_bytes=b"test audio",
                filename="recording.webm",
                content_type="audio/webm",
            )
        )
    except RuntimeError as exc:
        assert "type=insufficient_quota" in str(exc)
        assert "You exceeded your current quota." in str(exc)
    else:
        raise AssertionError("Expected quota exhaustion to fail")

    assert request_count == 1
    assert sleep_delays == []


def test_transcription_retries_temporary_rate_limit(monkeypatch):
    request_count = 0
    sleep_delays: list[int] = []

    async def handle_request(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        if request_count < 3:
            return httpx.Response(
                429,
                json={
                    "error": {
                        "type": "rate_limit_exceeded",
                        "code": "rate_limit_exceeded",
                        "message": "Please retry after a brief delay.",
                    }
                },
            )
        return httpx.Response(
            200,
            json={"text": "Recovered transcript", "language": "en", "segments": []},
        )

    async def record_sleep(delay: int) -> None:
        sleep_delays.append(delay)

    real_async_client = httpx.AsyncClient
    transport = httpx.MockTransport(handle_request)

    def create_async_client(*args, **kwargs):
        return real_async_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(main.httpx, "AsyncClient", create_async_client)
    monkeypatch.setattr(main.asyncio, "sleep", record_sleep)
    monkeypatch.setattr(main.settings, "openai_api_key", "test-api-key")

    result = asyncio.run(
        main._transcribe_audio_with_openai(
            audio_bytes=b"test audio",
            filename="recording.webm",
            content_type="audio/webm",
        )
    )

    assert result["text"] == "Recovered transcript"
    assert request_count == 3
    assert sleep_delays == [1, 2]
