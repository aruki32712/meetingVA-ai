from app.main import _sanitize_processing_error_message
from app.workers.transcription_worker import _root_failure


def test_processing_error_sanitizer_redacts_sensitive_values() -> None:
    error = RuntimeError(
        "request failed at https://example.test/audio?token=signed "
        "Authorization=top-secret Bearer access-token API_KEY=provider-key"
    )

    message = _sanitize_processing_error_message(error)

    assert "https://" not in message
    assert "top-secret" not in message
    assert "access-token" not in message
    assert "provider-key" not in message
    assert "[redacted-url]" in message


def test_root_failure_returns_original_chained_error() -> None:
    original = RuntimeError("provider transcription failed")
    wrapped = RuntimeError("Unable to transcribe meeting audio")
    wrapped.__cause__ = original

    assert _root_failure(wrapped) is original
