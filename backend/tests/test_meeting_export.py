from typing import Any
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import main
from app.meeting_export import CONTENT_TYPES, MAX_TRANSCRIPT_CHARACTERS, build_export_document, render_export, safe_export_filename

def sample_data() -> dict[str, Any]:
    return {"meeting": {"title": "Plan / Q3", "description": "Descripción", "scheduled_at": "2026-08-02T12:00:00Z", "duration_seconds": 60, "status": "completed", "detected_language": "spanish", "transcript_language": "spanish", "summary": "Resumen", "summary_translated": "Summary", "brief": "Breve", "brief_translated": "Brief"}, "transcript": [{"segment_index": 0, "start_ms": 0, "end_ms": 15000, "display_name": "Chris", "text": "Hola", "original_text": "Hola", "translated_text": "Hello"}], "speakers": [{"display_name": "Chris", "speaker_label": "speaker_0", "speaking_time_ms": 15000, "speaking_percentage": 100}], "action_items": [{"title": "Enviar", "translated_title": "Send", "description": None, "translated_description": None, "status": "open", "assignee": "Chris", "due_at": None}], "decisions": [], "questions": [], "tags": ["planning"], "processing_timeline": []}

def selected(**overrides: bool) -> dict[str, bool]:
    values = {key: False for key in ("meeting_details", "executive_summary", "meeting_brief", "speakers", "transcript", "timestamps", "action_items", "decisions", "questions", "tags", "processing_timeline")}; values.update(overrides); return values

@pytest.mark.parametrize("export_format", ["pdf", "docx", "md", "txt", "json"])
def test_each_export_format_has_expected_content_type(export_format: str) -> None:
    assert render_export(build_export_document(sample_data(), selected(meeting_details=True), "original"), export_format)
    assert export_format in CONTENT_TYPES

def test_only_selected_sections_are_exported() -> None:
    document = build_export_document(sample_data(), selected(transcript=True, timestamps=True), "original")
    assert "transcript" in document and "executive_summary" not in document and document["transcript"][0]["start_ms"] == 0

def test_original_and_translated_exports_remain_separate() -> None:
    original = build_export_document(sample_data(), selected(executive_summary=True, transcript=True), "original")
    english = build_export_document(sample_data(), selected(executive_summary=True, transcript=True), "english")
    assert (original["executive_summary"], english["executive_summary"]) == ("Resumen", "Summary")
    assert (original["transcript"][0]["text"], english["transcript"][0]["text"]) == ("Hola", "Hello")

def test_missing_translation_is_explicitly_reported() -> None:
    data = sample_data(); data["meeting"]["brief_translated"] = None
    document = build_export_document(data, selected(meeting_brief=True), "english")
    assert document["meeting_brief"] == "Breve" and document["translation_fallback_sections"] == ["meeting_brief"]

def test_safe_filename_prevents_path_traversal() -> None:
    filename = safe_export_filename("../../Board / Plan", "2026-08-02T12:00:00Z", "pdf")
    assert filename == "Board-Plan-2026-08-02.pdf" and ".." not in filename and "/" not in filename

def test_large_transcript_is_rejected() -> None:
    data = sample_data(); data["transcript"][0]["text"] = "x" * (MAX_TRANSCRIPT_CHARACTERS + 1); data["transcript"][0]["original_text"] = None
    with pytest.raises(ValueError, match="too large"): build_export_document(data, selected(transcript=True), "original")

def test_non_owner_export_is_denied(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "get_supabase_service_client", lambda: object()); monkeypatch.setattr(main, "_require_user_id", lambda token: "other-user"); monkeypatch.setattr(main, "_enforce_export_rate_limit", lambda *args: None)
    def deny(*args: Any, **kwargs: Any) -> None: raise HTTPException(status_code=404, detail="Meeting was not found.")
    monkeypatch.setattr(main, "_require_owned_meeting", deny)
    response = TestClient(main.app).post("/v1/meetings/11111111-1111-1111-1111-111111111111/export", headers={"Authorization": "Bearer token"}, json={"format": "json", "language": "original", "sections": selected(meeting_details=True)})
    assert response.status_code == 404

def test_owner_export_endpoint_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "get_supabase_service_client", lambda: object()); monkeypatch.setattr(main, "_require_user_id", lambda token: "owner"); monkeypatch.setattr(main, "_enforce_export_rate_limit", lambda *args: None)
    monkeypatch.setattr(main, "_require_owned_meeting", lambda *args: {"id": "meeting", "owner_id": "owner"})
    monkeypatch.setattr(main, "_fetch_meeting_export_data", lambda *args: sample_data())
    response = TestClient(main.app).post("/v1/meetings/11111111-1111-1111-1111-111111111111/export", headers={"Authorization": "Bearer token"}, json={"format": "json", "language": "original", "sections": selected(meeting_details=True)})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert "Plan-Q3-2026-08-02.json" in response.headers["content-disposition"]
