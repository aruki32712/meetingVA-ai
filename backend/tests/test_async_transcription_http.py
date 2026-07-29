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
