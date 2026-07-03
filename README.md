# MeetingVA AI

Initial full-stack scaffold for MeetingVA AI, a meeting capture and intelligence
application. This repository is intentionally thin right now: it provides a
working local architecture, health checks, environment templates, Docker setup,
dashboard progress tracking, meeting capture, AI transcription, AI meeting
intelligence, and Supabase PostgreSQL migrations.

Project planning docs:

- [Master plan](docs/MASTER_PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Supabase setup](docs/SUPABASE_SETUP.md)
- [GitHub issues](docs/GITHUB_ISSUES.md)

## Stack

- Frontend: Next.js 15 App Router, React, TypeScript, Tailwind CSS
- Backend: FastAPI on Python 3.12
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

See [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) for project creation,
API key lookup, database URL setup, migrations, storage buckets,
authentication, and troubleshooting.

## Run With Docker

```bash
docker compose -f docker/docker-compose.yml up --build
```

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
Generate Transcript. The frontend sends the Supabase access token to the
backend, which verifies meeting ownership, downloads the private audio object
from Supabase Storage, sends it to OpenAI transcription, stores timestamped
rows in `transcript_segments`, and updates `meetings.processing_status`.
After transcription completes, use Generate Analysis on the same detail page.
The backend verifies meeting ownership, sends the transcript to OpenAI, stores
the executive summary and meeting brief on `meetings`, replaces generated
`action_items`, `decisions`, and `questions`, and updates
`meetings.processing_status` through `analyzing`, `analyzed`, or
`analysis_failed`.

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
fields plus analysis-specific processing statuses. All application migrations
enable row-level security with Supabase Auth policies.

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
