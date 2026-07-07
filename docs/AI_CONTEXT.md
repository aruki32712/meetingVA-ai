# MeetingVA AI Context For Future Codex Sessions

Start here before changing the repository. Then read `docs/PROJECT_STATUS.md`.

## Product Intent

MeetingVA AI records or uploads meeting audio, stores it securely, turns it into timestamped transcripts, generates structured meeting intelligence, and helps users review speakers, summaries, action items, decisions, and questions.

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
- `backend/`: FastAPI app, settings, Supabase clients, Celery app, worker tasks, tests.
- `scripts/supabase/migrations/`: ordered database and storage migrations.
- `docker/`: local Dockerfiles and compose stack.
- `docs/`: project command center, architecture, deployment, setup, roadmap, testing.
- `shared/`: shared API notes.

## Implemented Flow

1. User signs up or signs in with Supabase Auth.
2. Protected dashboard routes require an active browser session.
3. User records meeting audio in the browser.
4. Frontend uploads audio to the private `meeting-audio` Supabase Storage bucket.
5. Frontend creates `meetings` and `attachments` records.
6. Meeting detail requests transcription from FastAPI with the Supabase access token.
7. FastAPI validates the token, checks meeting ownership, updates status, and enqueues a Celery task.
8. Worker downloads audio with the Supabase service role key and calls OpenAI transcription.
9. Worker stores transcript segments, language metadata, participants, and status.
10. Meeting detail can request analysis, which follows the same queue pattern.
11. Worker calls OpenAI chat completions for structured JSON and stores summaries, action items, decisions, and questions.
12. Speaker UI can rename speakers, merge speakers, and assign transcript segments.

## Important Data Concepts

- `meetings.processing_status` drives user-visible workflow state.
- `meetings.owner_id` and `meetings.user_id` are both used for ownership compatibility.
- `audio_storage_path` points to the private source recording in `meeting-audio`.
- `participants.display_name` is the editable human-facing speaker name.
- `participants.speaker_label` preserves provider or generated labels.
- `transcript_segments.participant_id` links transcript rows to speakers.
- `transcript_segments.text` is the display/analysis text.
- `original_text` and `translated_text` preserve multilingual context when available.

## Current Backend Endpoints

- `GET /health`
- `POST /v1/meetings/{meeting_id}/transcribe`
- `POST /v1/meetings/{meeting_id}/analyze`
- `GET /v1/meetings/{meeting_id}/jobs/{job_id}`
- `PATCH /v1/meetings/{meeting_id}/participants/{participant_id}`
- `POST /v1/meetings/{meeting_id}/participants/merge`
- `POST /v1/meetings/{meeting_id}/transcript-segments/assign`

## Development Rules

- Treat `docs/PROJECT_STATUS.md` as the status authority.
- Keep secrets out of git.
- Keep Supabase service role usage backend-only.
- Use RLS-compatible owner-scoped data access.
- Keep long-running AI work in Celery, not request handlers.
- Preserve direct user ownership checks before backend side effects.
- Prefer small, focused changes that match existing code style.
- Add or update tests when changing backend behavior.
- Run validation before committing.

## Known Gaps To Respect

- Transcript editing, search, exports, calendar, chat, sharing, teams, and mobile are not implemented.
- Production smoke test status is unknown until run against real deployed services.
- The in-app progress tracker seed data is stale relative to implemented features.
- No E2E browser automation exists yet.
