from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.settings import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Initial MeetingVA AI API scaffold.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "meetingva-ai-backend",
        "environment": settings.environment,
    }
