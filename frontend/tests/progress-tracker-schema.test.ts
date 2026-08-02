import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../scripts/supabase/migrations/0021_create_project_progress_tracker.sql",
    import.meta.url
  ),
  "utf8"
);

test("progress migration defines the complete frontend table contract", () => {
  for (const column of [
    "id uuid primary key",
    "owner_id uuid not null",
    "title text not null",
    "description text not null",
    "status public.project_progress_status not null",
    "position integer not null",
    "created_at timestamptz not null",
    "updated_at timestamptz not null",
    "phase_id uuid not null",
    "label text not null",
    "is_complete boolean not null"
  ]) {
    assert.ok(migration.includes(column), `missing contract: ${column}`);
  }
});

test("progress migration is owner scoped and reloads the schema cache", () => {
  assert.ok(migration.includes("owner_id = auth.uid()"));
  assert.ok(migration.includes("to authenticated"));
  assert.ok(migration.includes("notify pgrst, 'reload schema';"));
});

test("progress migration seeds every current roadmap capability", () => {
  for (const label of [
    "Authentication",
    "Meeting creation",
    "Audio upload",
    "Delete meeting",
    "Automatic transcription",
    "Processing timeline",
    "OpenAI transcription",
    "Analysis",
    "Executive summary",
    "Meeting brief",
    "Action items",
    "Decisions",
    "Questions",
    "Speaker handling",
    "Diarization",
    "UI polish"
  ]) {
    assert.ok(migration.includes(`'${label}'`), `missing seed: ${label}`);
  }
});
