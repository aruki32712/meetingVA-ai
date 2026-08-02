# MeetingVA AI

## Walter Labs AI Command Center

Start here:

- [Project status](docs/PROJECT_STATUS.md): single source of truth for progress, blockers, current sprint, completion estimate, and next task.
- [Project owner guide](docs/PROJECT_OWNER_GUIDE.md): plain-English guide to GitHub, Codex, Supabase, Docker, Redis, Celery, Render, Vercel, and OpenAI.
- [AI context](docs/AI_CONTEXT.md): architecture and implementation guidance for future Codex sessions.
- [Project memory](docs/PROJECT_MEMORY.md): important technical decisions and rationale.
- [Changelog](docs/CHANGELOG.md): completed work summarized from git history.
- [Roadmap](docs/ROADMAP.md): MVP, v1.1, v2.0, and future direction.
- [Coding standards](docs/CODING_STANDARDS.md): repository conventions for future changes.
- [Testing checklist](docs/TESTING_CHECKLIST.md): release validation checklist.
- [Quality gate](docs/QUALITY_GATE.md): required definition-of-done checklist for features, releases, deployments, and future Codex tasks.
- [Security](docs/SECURITY.md): security model, controls, secrets, RLS, storage, and HIPAA boundary.
- [Security checklist](docs/SECURITY_CHECKLIST.md): release checklist for access control, storage, secrets, and compliance claims.
- [Deployment guide](docs/DEPLOYMENT.md): production configuration and deployment flow for Supabase, Render, and Vercel.
- [Production checklist](docs/PRODUCTION_CHECKLIST.md): provider-by-provider release, monitoring, and rollback gate.
- [Business plan](business/BUSINESS_PLAN.md): strategy, revenue model, target market, and risks.
- [Founder dashboard](business/FOUNDER_DASHBOARD.md): CEO-level status, priorities, metrics, and risks.
- [Playbooks](playbooks/RELEASE_PLAYBOOK.md): repeatable workflows for release, deployment, feature work, bugs, marketing, onboarding, and disaster recovery.

MeetingVA AI is a meeting capture and intelligence application. It provides a
working local architecture, health checks, environment templates, Docker setup,
dashboard progress tracking, meeting capture, AI transcription, speaker
management, multilingual transcription metadata, queued AI meeting
intelligence, Supabase PostgreSQL migrations, and deployment configuration for
Vercel and Render.

Project planning docs:

- [Command Center status](docs/PROJECT_STATUS.md)
- [Executive summary](business/EXECUTIVE_SUMMARY.md)
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

Optional speaker diarization values:

- `DIARIZATION_PROVIDER` supports `none` (default) and `deepgram`.
- `DIARIZATION_API_KEY` is required when the provider is `deepgram`.
- `DIARIZATION_MODEL` selects the prerecorded Deepgram model and defaults to
  `nova-3`.
- `DIARIZATION_MAXIMUM_TURN_GAP_MS` controls when adjacent words from the same
  provider speaker are combined and defaults to `750`.
- `DIARIZATION_MINIMUM_CONFIDENCE` defaults to `0.5`.
- `DIARIZATION_MINIMUM_TIMESTAMP_OVERLAP` is the minimum fraction of a
  transcript segment that must overlap its best diarized turn and defaults to
  `0.5`.

The Render blueprint enables `deepgram` for both services. Configure
`DIARIZATION_API_KEY` in Render, especially on the worker service that processes
audio. Worker startup logs report the selected provider and whether credentials
are present without printing the credential itself. Each transcription job logs
whether diarization was attempted, Deepgram response counts, unique provider
speaker IDs, timestamp bounds, aligned and unknown transcript rows, and the
participant count. OpenAI word timestamps split long transcript segments at
provider turn boundaries. Speaker data is read from
`results.channels[*].alternatives[*].words[*].speaker`, with
`results.utterances[*].speaker` as a fallback.

Deepgram diarization runs against the original meeting audio and supplies only
anonymous, recording-local speaker IDs. It does not identify a person's voice.
If the provider is disabled, unconfigured, or unavailable, transcription still
completes with one Unknown Speaker.

Required job queue values:

- `REDIS_URL` defaults to `redis://redis:6379/0` in Docker
- `CELERY_BROKER_URL` defaults to `redis://redis:6379/0`
- `CELERY_RESULT_BACKEND` defaults to `redis://redis:6379/1`

Security configuration:

- `CORS_ALLOWED_ORIGINS` accepts a comma-separated list of allowed frontend origins.
- `FRONTEND_URL` is still used as a fallback allowed origin.
- `AI_RATE_LIMIT_REQUESTS` and `AI_RATE_LIMIT_WINDOW_SECONDS` control basic backend rate limiting for AI enqueue endpoints.
- Backend-only secrets such as `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DATABASE_URL`, and `OPENAI_API_KEY` must never be exposed to frontend code or Vercel.

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
to the backend, which verifies meeting ownership, creates a durable queued
`processing_jobs` row, enqueues
a Celery job, and returns a `job_id`. The frontend polls job status every 5
seconds without freezing the page.
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
`processing_jobs.status` through `analyzed` or `failed`.

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

Standard OpenAI Whisper transcription does not provide reliable speaker
diarization in the current implementation. When the provider returns no stable
speaker identifier, MeetingVA groups adjacent speech under one Unknown Speaker
that users can split or reassign manually; transcript row order is never used
as a speaker identity.

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
celery -A app.workers.celery_app:celery_app worker --loglevel=info
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
translated segment text storage. The security foundation migration reasserts
RLS, keeps meeting storage buckets private, and adds an `audit_logs` table for
security-relevant events. All application migrations enable row-level security
with Supabase Auth policies.

Apply it with the Supabase CLI from a linked project:

```bash
supabase db push --include-all
```

Or paste the migration into the Supabase SQL editor for a first bootstrap.
The migration creates the private `meeting-attachments` Storage bucket if it
does not already exist.

## Meeting Exports

Meeting owners can generate private, in-memory exports from the meeting detail
page in PDF, Word (`.docx`), Markdown, plain text, or JSON format. The export
dialog supports original-language or available English content and lets users
choose meeting details, summaries, speakers, transcript and timestamps, action
items, decisions, questions, tags, and the processing timeline. Exports never
include storage paths, credentials, participant email addresses, or worker
metadata, and no public storage URL is created.

## Available Checks

Every feature, release, deployment, and future Codex task must use
[docs/QUALITY_GATE.md](docs/QUALITY_GATE.md). Update it whenever the
definition of done changes.

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

## Production Deployment

Production uses Supabase for Auth, PostgreSQL, and private Storage; Render for
the FastAPI backend, private Redis-compatible Key Value service, and Celery
worker; and Vercel for the Next.js frontend. Deploy from `main`, apply all
ordered migrations through `0012_meeting_activity_feed.sql`, and keep privileged
Supabase and OpenAI credentials in Render only.

Follow [the deployment guide](docs/DEPLOYMENT.md), then complete every item in
the [production checklist](docs/PRODUCTION_CHECKLIST.md). A release is not
production-ready until both health endpoints and the synthetic meeting smoke
test pass.
