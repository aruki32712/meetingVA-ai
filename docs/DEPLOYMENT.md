# MeetingVA AI Deployment

This guide prepares a production deployment with:

- Supabase for PostgreSQL, Auth, and Storage
- Render for the FastAPI backend, Redis, and Celery worker
- Vercel for the Next.js frontend

Do not commit real secrets. Store production values only in the Supabase,
Render, and Vercel dashboards.

## Deployment Order

1. Create and configure the Supabase project.
2. Apply Supabase migrations in order.
3. Create or verify Supabase Storage buckets.
4. Deploy Render Redis, backend, and worker from `render.yaml`.
5. Deploy the Vercel frontend from `frontend/`.
6. Add final deployed URLs to Supabase Auth and service environment variables.
7. Run the post-deployment smoke tests.

## Supabase Setup

Create a dedicated production Supabase project. Do not reuse local or staging
projects for production customer data.

Required Supabase dashboard values:

- Project URL
- Anon public key
- Service role key
- Pooled PostgreSQL connection string

Required Auth settings:

- Enable email/password sign-in.
- Add the Vercel frontend URL to Site URL after the first Vercel deploy.
- Add the Vercel frontend URL to Redirect URLs.
- Keep `http://localhost:3000` only if local testing still needs it.

### Migration Order

Apply migrations from oldest to newest:

1. `scripts/supabase/migrations/0001_initial_schema.sql`
2. `scripts/supabase/migrations/0002_project_progress_tracker.sql`
3. `scripts/supabase/migrations/0003_meeting_capture_pipeline.sql`
4. `scripts/supabase/migrations/0004_transcription_pipeline_statuses.sql`
5. `scripts/supabase/migrations/0005_ai_meeting_intelligence.sql`
6. `scripts/supabase/migrations/0006_speaker_intelligence.sql`
7. `scripts/supabase/migrations/0007_multilingual_transcription.sql`
8. `scripts/supabase/migrations/0008_security_foundation.sql`
9. `scripts/supabase/migrations/0009_background_processing_jobs.sql`
10. `scripts/supabase/migrations/0010_meeting_search.sql`
11. `scripts/supabase/migrations/0011_processing_timeline.sql`
12. `scripts/supabase/migrations/0012_meeting_activity_feed.sql`

Preferred CLI flow:

```bash
supabase login
supabase link --project-ref your-project-ref
supabase db push --include-all
```

For a manual SQL editor bootstrap, run each migration file in the order above.
Do not skip migrations; later migrations expect objects created by earlier
files.

### Storage Buckets

Verify these private buckets exist after migrations:

- `meeting-attachments`
- `meeting-audio`

The application stores browser recordings in `meeting-audio`. Supporting files
and generated artifacts belong in `meeting-attachments`.

## Render Deployment

`render.yaml` defines:

- `meetingva-redis`: private Render Key Value (Redis-compatible) broker/result backend
- `meetingva-backend`: FastAPI web service
- `meetingva-worker`: Celery worker

Deploy through Render Blueprints from the repository root. Render will prompt
for every `sync: false` value.

Backend start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Worker start command:

```bash
celery -A app.workers.celery_app:celery_app worker --loglevel=info
```

### Render Environment Variables

Set these on both `meetingva-backend` and `meetingva-worker`:

```text
APP_NAME=MeetingVA AI API
ENVIRONMENT=production
FRONTEND_URL=https://your-vercel-app.vercel.app
CORS_ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_DATABASE_URL=postgresql://...
OPENAI_API_KEY=your-openai-api-key
OPENAI_TRANSCRIPTION_MODEL=whisper-1
OPENAI_ANALYSIS_MODEL=gpt-4o-mini
WORKER_VERSION=render
REDIS_URL=<from Render Redis connectionString>
CELERY_BROKER_URL=<from Render Redis connectionString>
CELERY_RESULT_BACKEND=<from Render Redis connectionString>
AI_RATE_LIMIT_REQUESTS=10
AI_RATE_LIMIT_WINDOW_SECONDS=60
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DATABASE_URL`, and `OPENAI_API_KEY`
  are backend-only secrets.
- `FRONTEND_URL` must exactly match the deployed Vercel origin because the
  backend uses it as a fallback CORS origin.
- `CORS_ALLOWED_ORIGINS` should contain only approved frontend origins,
  separated by commas when more than one origin is needed.
- The Render blueprint wires Redis values automatically for new services.
- Render now calls new Redis-compatible instances Key Value services; the
  blueprint uses `type: keyvalue` and keeps the instance private.
- Configure Render deploy notifications and review backend and worker logs after
  every production release.

## Vercel Deployment

Create a Vercel project with:

- Root Directory: `frontend`
- Framework Preset: Next.js
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm run build`

`frontend/vercel.json` records those commands for the frontend project.
The file must remain inside `frontend/` because Vercel treats the configured
Root Directory as the project root.

### Vercel Environment Variables

Set these values in Vercel:

```text
NEXT_PUBLIC_APP_URL=https://your-vercel-app.vercel.app
NEXT_PUBLIC_API_BASE_URL=https://your-render-backend.onrender.com
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Only `NEXT_PUBLIC_*` values are available to browser code. Never add
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DATABASE_URL`, or `OPENAI_API_KEY` to
Vercel.

Enable Vercel deployment protection for preview deployments when available.
Production deployments should track `main`, and the production domain must be
added to Supabase Auth redirect URLs and Render CORS configuration.

## Environment Variable Inventory

Frontend/Vercel:

- `NEXT_PUBLIC_APP_URL`: canonical production frontend origin.
- `NEXT_PUBLIC_API_BASE_URL`: Render backend origin, without a trailing path.
- `NEXT_PUBLIC_SUPABASE_URL`: public Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: public, RLS-constrained Supabase anon key.

Backend and worker/Render:

- `APP_NAME`: service display name.
- `ENVIRONMENT`: set to `production`.
- `FRONTEND_URL`: canonical frontend origin and CORS fallback.
- `CORS_ALLOWED_ORIGINS`: comma-separated approved frontend origins.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_ANON_KEY`: Supabase anon key used for authenticated user requests.
- `SUPABASE_SERVICE_ROLE_KEY`: backend-only privileged key.
- `SUPABASE_DATABASE_URL`: backend-only pooled database URL.
- `OPENAI_API_KEY`: backend-only OpenAI API key.
- `OPENAI_TRANSCRIPTION_MODEL`: transcription model identifier.
- `OPENAI_ANALYSIS_MODEL`: analysis model identifier.
- `REDIS_URL`: Redis-compatible service connection URL.
- `CELERY_BROKER_URL`: Celery broker connection URL.
- `CELERY_RESULT_BACKEND`: Celery result backend connection URL.
- `WORKER_VERSION`: release identifier stored with processing jobs.
- `AI_RATE_LIMIT_REQUESTS`: allowed enqueue requests per rate-limit window.
- `AI_RATE_LIMIT_WINDOW_SECONDS`: rate-limit window length.

All backend settings are read through `backend/app/settings.py` from environment
variables (with `.env` supported only as a local-development convenience).
Production secrets belong in Render, never in git, Vercel, or browser-visible
variables.

## Health Checks

Local:

- Frontend: `http://localhost:3000/api/health`
- Backend: `http://localhost:8000/health`

Test deployment:

- Frontend: `https://your-vercel-app.vercel.app/api/health`
- Backend: `https://your-render-backend.onrender.com/health`

Expected backend response:

```json
{
  "status": "ok",
  "service": "meetingva-ai-backend",
  "environment": "production"
}
```

Expected frontend response:

```json
{
  "status": "ok",
  "service": "meetingva-ai-frontend"
}
```

## Post-Deployment Smoke Test

Use a production test account and a short synthetic audio recording. Avoid real
customer data during deployment validation.

1. Login:
   - Open `https://your-vercel-app.vercel.app/login`.
   - Sign in with a Supabase Auth test user.
   - Confirm the app redirects to `/dashboard`.
2. Dashboard:
   - Open `/dashboard`.
   - Confirm authenticated navigation loads without console auth errors.
   - Open `/dashboard/progress` and confirm progress data can load.
3. Recording:
   - Open `/dashboard/meetings/new`.
   - Record a short browser audio clip.
   - Save the meeting.
   - Confirm a row appears in Supabase `meetings`.
4. Upload and storage:
   - Confirm the audio object exists in the private `meeting-audio` bucket.
   - Confirm the meeting row has an `audio_storage_path`.
5. Transcription:
   - Open the created meeting detail page.
   - Click Generate Transcript.
   - Confirm the backend returns a `job_id` and the meeting status becomes
     `queued`, then `transcribing`.
   - Watch Render worker logs for the Celery task.
   - Confirm the final status becomes `transcribed`.
   - Confirm a `processing_jobs` row records the job lifecycle.
   - Confirm `transcript_segments` rows are created.
6. Analysis:
   - Click Generate Analysis after transcription completes.
   - Confirm the meeting status becomes `queued`, then `analyzing`, then
     `analyzed`.
   - Confirm summary or brief text appears.
   - Confirm generated `action_items`, `decisions`, or `questions` rows exist
     when the transcript supports them.
   - Confirm cancellation moves an active test job to `cancelled` when safe to
     test.
7. Failure visibility:
   - If transcription or analysis fails, check Render backend logs, Render
     worker logs, the `processing_jobs` row, and the meeting
     `processing_status`.
8. Operational readiness:
   - Confirm the activity feed and processing timeline show the completed test.
   - Confirm frontend and backend health endpoints are monitored.
   - Confirm a previous Render and Vercel deploy can be selected for rollback.
   - Record the deployed commit SHA and migration level.

The full release gate is in
[`docs/PRODUCTION_CHECKLIST.md`](PRODUCTION_CHECKLIST.md).

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
