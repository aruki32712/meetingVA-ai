import re

from fastapi.testclient import TestClient
from fastapi import HTTPException
from fastapi.routing import APIRoute
import pytest

from app.main import CORS_ORIGIN_REGEX, app, fastapi_app


client = TestClient(app)
PRODUCTION_ORIGIN = "https://meeting-va-ai.vercel.app"
ANALYZE_PATH = "/v1/meetings/{meeting_id}/analyze"
ANALYZE_URL = "/v1/meetings/00000000-0000-0000-0000-000000000000/analyze"


def _preflight(origin: str):
    return client.options(
        "/v1/meetings/00000000-0000-0000-0000-000000000000/transcribe",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )


def _analyze_route() -> APIRoute:
    return next(
        route
        for route in fastapi_app.routes
        if isinstance(route, APIRoute) and route.path == ANALYZE_PATH
    )


def _assert_production_cors(response, expected_status: int) -> None:
    assert response.status_code == expected_status
    assert response.headers["access-control-allow-origin"] == PRODUCTION_ORIGIN
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cors_allows_project_vercel_preview_origin() -> None:
    origin = (
        "https://meeting-va-8u8jhxnai-aruki32712-1048s-projects.vercel.app"
    )

    response = _preflight(origin)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "authorization" in response.headers["access-control-allow-headers"].lower()
    assert "content-type" in response.headers["access-control-allow-headers"].lower()


def test_preview_regex_matches_entire_origin() -> None:
    origin = (
        "https://meeting-va-8u8jhxnai-aruki32712-1048s-projects.vercel.app"
    )

    assert re.fullmatch(CORS_ORIGIN_REGEX, origin)
    assert not re.fullmatch(CORS_ORIGIN_REGEX, f"{origin}.example.com")


@pytest.mark.parametrize(
    "origin",
    [
        "https://meetingva-ai.vercel.app",
        "https://aruki32712-meetingva-ai.vercel.app",
        "https://meeting-va-ai.vercel.app",
    ],
)
def test_cors_allows_stable_vercel_origins(origin: str) -> None:
    response = _preflight(origin)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_allows_localhost_development_origin() -> None:
    origin = "http://localhost:3000"

    response = _preflight(origin)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_rejects_unrelated_vercel_project() -> None:
    response = _preflight("https://unrelated-project.vercel.app")

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_production_origin_preflights_analyze_with_required_contract() -> None:
    response = client.options(
        ANALYZE_URL,
        headers={
            "Origin": PRODUCTION_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )

    _assert_production_cors(response, 200)
    methods = response.headers["access-control-allow-methods"]
    for method in ("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"):
        assert method in methods
    allowed_headers = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed_headers
    assert "content-type" in allowed_headers


def test_production_origin_receives_cors_on_successful_analyze(monkeypatch) -> None:
    async def successful_analyze(**kwargs):
        return {
            "meeting_id": kwargs["meeting_id"],
            "job_id": "11111111-1111-1111-1111-111111111111",
            "processing_status": "queued",
        }

    monkeypatch.setattr(_analyze_route().dependant, "call", successful_analyze)
    response = client.post(
        ANALYZE_URL,
        headers={"Origin": PRODUCTION_ORIGIN, "Authorization": "Bearer test"},
    )

    _assert_production_cors(response, 200)


def test_production_origin_receives_cors_on_analyze_conflict(monkeypatch) -> None:
    async def conflicting_analyze(**kwargs):
        raise HTTPException(status_code=409, detail="Meeting is already processing.")

    monkeypatch.setattr(_analyze_route().dependant, "call", conflicting_analyze)
    response = client.post(
        ANALYZE_URL,
        headers={"Origin": PRODUCTION_ORIGIN, "Authorization": "Bearer test"},
    )

    _assert_production_cors(response, 409)


@pytest.mark.parametrize("status_code", [400, 401, 403, 404])
def test_production_origin_receives_cors_on_analyze_http_errors(
    monkeypatch, status_code: int
) -> None:
    async def rejected_analyze(**kwargs):
        raise HTTPException(status_code=status_code, detail="Safe request error.")

    monkeypatch.setattr(_analyze_route().dependant, "call", rejected_analyze)
    response = client.post(
        ANALYZE_URL,
        headers={"Origin": PRODUCTION_ORIGIN, "Authorization": "Bearer test"},
    )

    _assert_production_cors(response, status_code)


def test_production_origin_receives_cors_on_unhandled_analyze_error(monkeypatch) -> None:
    async def broken_analyze(**kwargs):
        raise RuntimeError("private backend failure")

    monkeypatch.setattr(_analyze_route().dependant, "call", broken_analyze)
    error_client = TestClient(app, raise_server_exceptions=False)
    response = error_client.post(
        ANALYZE_URL,
        headers={"Origin": PRODUCTION_ORIGIN, "Authorization": "Bearer test"},
    )

    _assert_production_cors(response, 500)
    assert response.json() == {"detail": "Internal server error."}
