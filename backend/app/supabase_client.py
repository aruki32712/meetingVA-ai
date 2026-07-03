from functools import lru_cache

from supabase import Client, create_client

from app.settings import get_settings


def _require_configured(value: str, name: str) -> str:
    if not value or value.startswith("your-") or "your-" in value:
        raise RuntimeError(f"Missing or placeholder Supabase setting: {name}")

    return value


@lru_cache
def get_supabase_anon_client() -> Client:
    settings = get_settings()
    supabase_url = _require_configured(settings.supabase_url, "SUPABASE_URL")
    anon_key = _require_configured(settings.supabase_anon_key, "SUPABASE_ANON_KEY")

    return create_client(supabase_url, anon_key)


@lru_cache
def get_supabase_service_client() -> Client:
    settings = get_settings()
    supabase_url = _require_configured(settings.supabase_url, "SUPABASE_URL")
    service_key = _require_configured(
        settings.supabase_service_role_key,
        "SUPABASE_SERVICE_ROLE_KEY",
    )

    return create_client(supabase_url, service_key)
