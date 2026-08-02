from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "MeetingVA AI API"
    environment: str = "local"
    frontend_url: str = "http://localhost:3000"
    cors_allowed_origins: str = ""
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_database_url: str = ""
    openai_api_key: str = ""
    openai_transcription_model: str = "whisper-1"
    openai_analysis_model: str = "gpt-4o-mini"
    diarization_provider: str = "none"
    diarization_api_key: str = ""
    diarization_model: str = "nova-3"
    diarization_maximum_turn_gap_ms: int = Field(default=750, ge=0, le=10000)
    diarization_minimum_confidence: float = Field(default=0.5, ge=0, le=1)
    diarization_minimum_timestamp_overlap: float = Field(default=0.5, ge=0, le=1)
    redis_url: str = "redis://redis:6379/0"
    celery_broker_url: str = "redis://redis:6379/0"
    celery_result_backend: str = "redis://redis:6379/1"
    worker_version: str = "local"
    ai_rate_limit_requests: int = 10
    ai_rate_limit_window_seconds: int = 60

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_cors_origins(self) -> list[str]:
        origins = [
            origin.strip()
            for origin in self.cors_allowed_origins.split(",")
            if origin.strip()
        ]

        if self.frontend_url and self.frontend_url not in origins:
            origins.append(self.frontend_url)

        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
