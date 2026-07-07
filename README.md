# MeetingVA AI

## MeetingVA AI Command Center

Start here:

- [Project status](docs/PROJECT_STATUS.md): single source of truth for progress, blockers, current sprint, completion estimate, and next task.
- [Project owner guide](docs/PROJECT_OWNER_GUIDE.md): plain-English guide to GitHub, Codex, Supabase, Docker, Redis, Celery, Render, Vercel, and OpenAI.
- [AI context](docs/AI_CONTEXT.md): architecture and implementation guidance for future Codex sessions.
- [Project memory](docs/PROJECT_MEMORY.md): important technical decisions and rationale.
- [Changelog](docs/CHANGELOG.md): completed work summarized from git history.
- [Roadmap](docs/ROADMAP.md): MVP, v1.1, v2.0, and future direction.
- [Coding standards](docs/CODING_STANDARDS.md): repository conventions for future changes.
- [Testing checklist](docs/TESTING_CHECKLIST.md): release validation checklist.

MeetingVA AI is a meeting capture and intelligence application. It provides a
working local architecture, health checks, environment templates, Docker setup,
dashboard progress tracking, meeting capture, AI transcription, speaker
management, multilingual transcription metadata, queued AI meeting
intelligence, Supabase PostgreSQL migrations, and deployment configuration for
Vercel and Render.

Project planning docs:

- [Command Center status](docs/PROJECT_STATUS.md)
- [Master plan](docs/MASTER_PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Supabase setup](docs/SUPABASE_SETUP.md)
- [GitHub issues](docs/GITHUB_ISSUES.md)

## Stack

- Frontend: Next.js 15 App Router, React, TypeScript, Tailwind CSS
- Backend: FastAPI on Python 3.12
- Background jobs: Celery with Redis broker/result backend
- Data/auth/storage: Supabase Auth, Supabase PostgreSQL, Supabase Storage
- Local runtime: Docker and docker-compose

## Repository Layout

```text
frontend/                     Next.js app shell
backend/                      FastAPI service
scripts/supabase/migrations/  Supabase SQL migrations
docker/                       Docker compose and service Dockerfiles
shared/                       Shared API contracts and notes
```

## Prerequisites

- Node.js 20+
- pnpm 11+
- Python 3.12+
- Docker Desktop
- Supabase project or local Supabase CLI environment

## Environment Setup

Copy the example environment files before running services:

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

Fill in the Supabase values from your project dashboard. For local Docker
development, the backend URL defaults to `http://localhost:8000` and the
frontend runs on `http://localhost:3000`.

Required Supabase values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DATABASE_URL`

Required AI values:

- `OPENAI_API_KEY`
- `OPENAI_TRANSCRIPTION_MODEL` defaults to `whisper-1`
- `OPENAI_ANALYSIS_MODEL` defaults to `gpt-4o-mini`

Required job queue values:

- `REDIS_URL` defaults to `redis://redis:6379/0` in Docker
- `CELERY_BROKER_URL` defaults to `redis://redis:6379/0`
- `CELERY_RESULT_BACKEND` defaults to `redis://redis:6379/1`

See [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) for project creation,
API key lookup, database URL setup, migrations, storage buckets,
authentication, and troubleshooting.

## Run With Docker

```bash
docker compose -f docker/docker-compose.yml up --build
```

This starts four services: Next.js frontend, FastAPI backend, Redis, and a
Celery worker. The backend enqueues long-running AI jobs; the worker performs
OpenAI transcription, translation, and analysis.

Health checks:

- Frontend: `http://localhost:3000/api/health`
- Backend: `http://localhost:8000/health`

Authentication routes:

- Login: `http://localhost:3000/login`
- Signup: `http://localhost:3000/signup`
- Protected dashboard: `http://localhost:3000/dashboard`
- Meetings: `http://localhost:3000/dashboard/meetings`
- New meeting capture: `http://localhost:3000/dashboard/meetings/new`
- Progress tracker: `http://localhost:3000/dashboard/progress`

After a meeting recording is uploaded, open its meeting detail page and use
Generate Transcript. Optionally enable English translation for non-English
audio. The frontend sends the Supabase access token and translation preference
to the backend, which verifies meeting ownership, sets
`meetings.processing_status` to `transcribing`, enqueues a Celery job, and
returns a `job_id`. The frontend polls job status without freezing the page.
The Celery worker downloads the private audio object from Supabase Storage,
sends it to OpenAI transcription with language auto-detection, optionally
generates an English transcript, stores timestamped rows in
`transcript_segments`, creates editable speaker rows in `participants`, links
segments through `participant_id`, records detected/transcript/translation
language metadata on `meetings`, and updates final success or failure status.
After transcription completes, use Generate Analysis on the same detail page.
The backend verifies meeting ownership, sets the meeting to `analyzing`,
enqueues a Celery job, and returns a `job_id`. The worker sends the transcript
to OpenAI, stores the executive summary and meeting brief on `meetings`,
replaces generated `action_items`, `decisions`, and `questions`, and updates
`meetings.processing_status` through `analyzed` or `analysis_failed`.

The MVP supports multilingual transcription and optional English transcripts
for non-English audio while preserving original transcript text where possible.
Meeting summaries, structured analysis, and the app UI remain English-only for
now.

The meeting detail page includes a Speakers section for renaming speakers,
merging duplicate speakers, and assigning transcript segments to another
speaker. Speaker edits use authenticated backend endpoints and are scoped to
meetings owned by the signed-in user. The schema includes reference fields for
future diarization or voiceprint systems, but MeetingVA AI does not store or
compare voice biometric data.

Supabase Auth should allow `http://localhost:3000` as a local site/redirect URL.

## Run Without Docker

Frontend:

```bash
cd frontend
pnpm install
pnpm run dev
```

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Run Redis locally, then start the worker in a second backend shell:

```bash
celery -A app.worker:celery_app worker --loglevel=info
```

For non-Docker local development, set `REDIS_URL`, `CELERY_BROKER_URL`, and
`CELERY_RESULT_BACKEND` to your local Redis host, for example
`redis://localhost:6379/0` and `redis://localhost:6379/1`.

On Windows PowerShell, activate the backend environment with:

```powershell
.\.venv\Scripts\Activate.ps1
```

## Database Migrations

Schema migrations live in:

```text
scripts/supabase/migrations/
```

The initial migration defines the core production tables for meetings,
participants, transcript segments, action items, decisions, questions, tags,
attachments, and meeting-tag relationships. The progress tracker migration adds
owner-scoped project phases and checklist items. The meeting capture migration
adds browser-recording metadata fields and creates the private `meeting-audio`
Storage bucket. The transcription migration adds transcript-specific processing
statuses. The meeting intelligence migration adds meeting summary and brief
fields plus analysis-specific processing statuses. The speaker intelligence
migration adds participant metadata, speaker-label indexes, and participant
updated timestamps. The multilingual transcription migration adds meeting
language metadata, translation preference, transcript kind, and original versus
translated segment text storage. All application migrations enable row-level
security with Supabase Auth policies.

Apply it with the Supabase CLI from a linked project:

```bash
supabase db push --include-all
```

Or paste the migration into the Supabase SQL editor for a first bootstrap.
The migration creates the private `meeting-attachments` Storage bucket if it
does not already exist.

## Available Checks

Frontend:

```bash
cd frontend
pnpm run lint
pnpm run typecheck
pnpm run build
```

Backend:

```bash
cd backend
python -m compileall app
python -m pytest
```
