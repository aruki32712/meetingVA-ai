from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _preflight(origin: str):
    return client.options(
        "/v1/meetings/00000000-0000-0000-0000-000000000000/transcribe",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )


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


def test_cors_allows_localhost_development_origin() -> None:
    origin = "http://localhost:3000"

    response = _preflight(origin)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_rejects_unrelated_vercel_project() -> None:
    response = _preflight("https://unrelated-project.vercel.app")

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
