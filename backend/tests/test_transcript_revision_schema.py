from pathlib import Path


MIGRATION = (
    Path(__file__).parents[2]
    / "scripts"
    / "supabase"
    / "migrations"
    / "0030_transcript_revision_schema.sql"
).read_text(encoding="utf-8").lower()


def test_revision_schema_contains_every_live_revision_column():
    assert "add column if not exists analysis_stale boolean not null default false" in MIGRATION
    assert "add column if not exists transcript_revision integer not null default 1" in MIGRATION
    assert "add column if not exists analysis_revision integer" in MIGRATION
    assert "alter table public.processing_jobs" in MIGRATION
    assert "add column if not exists transcript_revision integer" in MIGRATION


def test_revision_schema_enforces_only_referenced_revision_invariants():
    assert "meetings_transcript_revision_check" in MIGRATION
    assert "meetings_analysis_revision_check" in MIGRATION
    assert "processing_jobs_transcript_revision_check" in MIGRATION
    assert "processing_jobs_one_active_analysis_idx" in MIGRATION
    assert "analysis_revision <= transcript_revision" in MIGRATION


def test_revision_schema_is_idempotent_and_reloads_postgrest():
    assert MIGRATION.count("add column if not exists") == 4
    assert "create unique index if not exists" in MIGRATION
    assert MIGRATION.rstrip().endswith("notify pgrst, 'reload schema';")

