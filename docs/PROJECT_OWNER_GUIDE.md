# MeetingVA AI Project Owner Guide

This guide explains the services used by MeetingVA AI and what the project owner should know about each one.

## GitHub

GitHub is the source-code home for MeetingVA AI. The `main` branch is the current production-intent branch, and commit history is the record used to build the changelog. Use GitHub to review changes, open pull requests if the workflow expands, track issues, and connect deployments.

Owner responsibilities:

- Keep real secrets out of git.
- Review changes before merging or deploying.
- Use clear commit messages that describe product-visible changes.
- Confirm GitHub is connected to Render and Vercel for deployments.

## Codex

Codex is the AI engineering collaborator used to inspect the repo, implement changes, maintain docs, run validation, and prepare commits. Future Codex sessions should start with `docs/PROJECT_STATUS.md` and `docs/AI_CONTEXT.md`.

Owner responsibilities:

- Give Codex specific outcomes, not just vague intent.
- Ask Codex to run validation before committing.
- Keep `PROJECT_STATUS.md` current so Codex has fresh context.
- Ask Codex to avoid reverting unrelated user changes.

## Supabase

Supabase provides authentication, PostgreSQL, row-level security, and private file storage. The app uses Supabase Auth for login/signup, Supabase PostgreSQL for meetings and AI outputs, and Supabase Storage for meeting audio and attachments.

Important repository files:

- `frontend/lib/supabase.ts`
- `scripts/supabase/migrations/`
- `docs/SUPABASE_SETUP.md`

Owner responsibilities:

- Apply migrations in order.
- Enable email/password auth.
- Configure allowed site and redirect URLs.
- Keep service role keys backend-only.
- Verify private buckets `meeting-audio` and `meeting-attachments` exist.

## Docker

Docker provides the local multi-service runtime. `docker/docker-compose.yml` starts Redis, the Next.js frontend, the FastAPI backend, and a Celery worker.

Primary command:

```bash
docker compose -f docker/docker-compose.yml up --build
```

Owner responsibilities:

- Use Docker for realistic local integration testing.
- Confirm health checks pass for frontend and backend.
- Keep `.env` files local and untracked.

## Redis

Redis is the Celery broker and result backend. It lets the backend enqueue long-running transcription and analysis work without blocking HTTP requests.

Owner responsibilities:

- Run Redis locally through Docker or another local Redis service.
- Use Render Redis for deployed backend and worker services.
- Make sure backend and worker use the same broker/result configuration.

## Celery

Celery runs background AI jobs. The backend enqueues work, then the worker downloads audio, calls OpenAI, and writes results back to Supabase.

Important repository files:

- `backend/app/celery_app.py`
- `backend/app/tasks.py`
- `backend/app/worker.py`

Owner responsibilities:

- Always deploy a worker alongside the backend.
- Check worker logs when transcription or analysis fails.
- Keep job status visible through `meetings.processing_status`.

## Render

Render hosts the FastAPI backend, Celery worker, and Redis service for test or production deployment. `render.yaml` defines the current blueprint.

Owner responsibilities:

- Configure all `sync: false` secrets in the Render dashboard.
- Set `FRONTEND_URL` to the deployed Vercel origin.
- Confirm `/health` returns `environment: production`.
- Check backend and worker logs during smoke tests.

## Vercel

Vercel hosts the Next.js frontend from the `frontend/` directory. `frontend/vercel.json` defines install and build commands.

Owner responsibilities:

- Set the project root to `frontend`.
- Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL`, and `NEXT_PUBLIC_APP_URL`.
- Never add backend-only secrets to Vercel.
- Confirm `/api/health` works after deployment.

## OpenAI

OpenAI provides audio transcription, optional translation, and structured meeting analysis.

Current defaults:

- `OPENAI_TRANSCRIPTION_MODEL=whisper-1`
- `OPENAI_ANALYSIS_MODEL=gpt-4o-mini`

Owner responsibilities:

- Store `OPENAI_API_KEY` only in backend and worker environments.
- Monitor usage and costs during testing.
- Use short test recordings for smoke tests.
- Expect live AI workflows to fail if credentials, network access, or service availability are missing.
