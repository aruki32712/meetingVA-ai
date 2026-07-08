# MeetingVA AI Context For Future Codex Sessions

Start every future Codex session here, then read `docs/PROJECT_STATUS.md`. Treat `PROJECT_STATUS.md` as the live source of truth.

Every future Codex task must check `docs/QUALITY_GATE.md` and update it if the definition of done changes.

## Product Intent

MeetingVA AI records or uploads meeting audio, stores it securely, turns it into timestamped transcripts, generates structured meeting intelligence, and helps users review speakers, summaries, action items, decisions, and questions.

Walter Labs AI is the operating company context for this repository. The operating system docs now include engineering, business, launch, and playbook layers.

## Architecture

- Frontend: Next.js 15 App Router, React, TypeScript, Tailwind CSS.
- Backend: FastAPI on Python 3.12.
- Auth/data/storage: Supabase Auth, PostgreSQL, Storage, and RLS.
- Jobs: Celery worker with Redis broker/result backend.
- AI: backend-side OpenAI calls for transcription, translation, and analysis.
- Local runtime: Docker Compose.
- Deployment: Vercel for frontend; Render for backend, worker, and Redis.

## Repository Map

- `frontend/`: Next.js app, dashboard routes, auth UI, meeting UI, Supabase browser client.
- `backend/`: FastAPI app, settings, Supabase clients, worker package, Celery app, worker tasks, tests.
- `scripts/supabase/migrations/`: ordered database and storage migrations.
- `docker/`: local Dockerfiles and compose stack.
- `docs/`: project command center, architecture, deployment, setup, roadmap, testing, standards.
- `business/`: company, pricing, GTM, competitor, customer, KPI, and founder operating docs.
- `playbooks/`: release, deployment, feature, bug fix, marketing, onboarding, and disaster recovery workflows.
- `shared/`: shared API notes.

## Implemented Flow

1. User signs up or signs in with Supabase Auth.
2. Protected dashboard routes require an active browser session.
3. User records meeting audio in the browser.
4. Frontend uploads audio to the private `meeting-audio` Supabase Storage bucket.
5. Frontend creates `meetings` and `attachments` records.
6. Meeting detail requests transcription from FastAPI with the Supabase access token.
7. FastAPI validates the token, checks meeting ownership, creates a durable `processing_jobs` row, updates status to `queued`, and enqueues a Celery task.
8. Worker downloads audio with the Supabase service role key and calls OpenAI transcription.
9. Worker stores transcript segments, language metadata, participants, and status.
10. Meeting detail can request analysis through the same durable queue pattern.
11. Worker calls OpenAI chat completions for structured JSON and stores summaries, action items, decisions, and questions.
12. Speaker UI can rename speakers, merge speakers, and assign transcript segments.
13. Search UI calls the authenticated `search_meetings` Supabase RPC, which
    searches only the current user's RLS-visible meetings and returns ranked
    excerpts.
14. Meeting detail shows a permanent activity feed from `meeting_activity_events`
    for meeting creation, upload, processing, retry, speaker detection, and owner
    speaker corrections.

## Current Backend Endpoints

- `GET /health`
- `POST /v1/meetings/{meeting_id}/transcribe`
- `POST /v1/meetings/{meeting_id}/analyze`
- `GET /v1/meetings/{meeting_id}/jobs/{job_id}`
- `POST /v1/meetings/{meeting_id}/jobs/{job_id}/cancel`
- `PATCH /v1/meetings/{meeting_id}/participants/{participant_id}`
- `POST /v1/meetings/{meeting_id}/participants/merge`
- `POST /v1/meetings/{meeting_id}/transcript-segments/assign`

## Important Data Concepts

- `meetings.processing_status` drives user-visible workflow state.
- `processing_jobs` stores durable background job lifecycle state for transcription and analysis.
- `processing_events` powers the visual processing timeline.
- `meeting_activity_events` stores the permanent owner-scoped meeting history/audit feed.
- `meetings.owner_id` and `meetings.user_id` are both used for ownership compatibility.
- `audio_storage_path` points to the private source recording in `meeting-audio`.
- `participants.display_name` is the editable human-facing speaker name.
- `participants.speaker_label` preserves provider or generated labels.
- `transcript_segments.participant_id` links transcript rows to speakers.
- `transcript_segments.text` is the display/analysis text.
- `original_text` and `translated_text` preserve multilingual context when available.
- `search_meetings` uses PostgreSQL full-text search plus `auth.uid()` ownership
  filtering and remains subject to RLS because it is `security invoker`.
- Activity feed speaker metadata may include `confidence_score`,
  `original_label`, `new_label`, `affected_segment_count`, and
  `detection_method`.

## Development Rules

- Read `PROJECT_STATUS.md` first.
- Keep secrets out of git.
- Keep Supabase service role usage backend-only.
- Use RLS-compatible owner-scoped data access.
- Preserve private `meeting-audio` playback through signed URLs.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DATABASE_URL`, or `OPENAI_API_KEY` to frontend code.
- Keep long-running AI work in Celery, not request handlers.
- Use `backend/app/workers/` for Celery configuration and task modules.
- Preserve direct user ownership checks before backend side effects.
- Do not claim HIPAA compliance or process PHI until formal compliance review is complete.
- Match existing code style and file organization.
- Add or update tests when changing backend behavior.
- Run validation before committing.
- Update docs when implementation, deployment, strategy, or operating procedure changes.
- Update `docs/QUALITY_GATE.md` whenever the definition of done changes.

## Known Gaps

- Transcript editing, exports, calendar, chat, sharing, teams, and mobile are not implemented.
- Production smoke test status is unknown until run against real deployed services.
- The in-app progress tracker seed data is stale relative to implemented features.
- No E2E browser automation exists yet.
- Billing, analytics, customer lifecycle tooling, and support workflows are not implemented.
