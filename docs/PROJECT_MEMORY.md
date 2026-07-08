# MeetingVA AI Project Memory

This file records major technical and operating decisions plus rationale. Add entries when a decision will matter to future maintainers or Codex sessions.

## Decisions

### Use Supabase For Auth, Data, And Storage

MeetingVA AI uses Supabase Auth, PostgreSQL, Storage, and RLS to reduce custom infrastructure while keeping user-owned meeting data secure. This keeps the MVP focused on meeting workflows instead of rebuilding identity, database hosting, and file storage.

### Keep AI Work On The Backend

OpenAI transcription, translation, and analysis calls run from the backend/worker layer so API keys stay out of the browser. This also allows the service role key to be used safely for private audio downloads.

### Use Celery And Redis For Long-Running Jobs

Transcription and analysis can take longer than normal HTTP requests. FastAPI validates ownership and enqueues work; Celery workers perform side effects and update `meetings.processing_status`.

### Track Background Jobs Durably

Celery and Redis provide queue execution state, but MeetingVA AI also stores `processing_jobs` rows in Supabase so the product can show queued, running, failed, cancelled, and completed state even when worker or result-backend state is incomplete.

### Store Processing State On Meetings

The app uses `meetings.processing_status` as the user-visible workflow state for upload, transcription, analysis, and failures. This keeps frontend polling straightforward and database-visible.

### Preserve Original And Translated Transcript Text

Multilingual transcription can produce original-language text and optional English text. The schema keeps `original_text`, `translated_text`, `transcript_kind`, and language metadata so later review workflows can show both.

### Represent Speakers As Participants

Speaker labels are normalized into `participants` rows and linked from transcript segments. Users can rename and merge speakers without losing the original provider label.

### Avoid Voice Biometric Recognition In MVP

The schema leaves room for future diarization references, but the current product does not store or compare voice biometric identities. This reduces privacy and compliance risk.

### Deploy Frontend And Backend Separately

Vercel hosts the Next.js frontend. Render hosts FastAPI, Celery, and Redis. This matches each platform's strengths and keeps worker processes independent from frontend deployment.

### Make PROJECT_STATUS.md The Source Of Truth

The project now has many supporting docs. `PROJECT_STATUS.md` remains the authority for current state, blockers, sprint focus, and next action. Supporting docs explain or operationalize that truth.

### Separate Business Operations From Technical Docs

Business strategy, pricing, launch, customer, competitor, KPI, and founder dashboard docs live in `business/`. Repeatable execution lives in `playbooks/`. Technical and product implementation docs remain in `docs/`.

### Add Security Foundation Before Public Launch

Meeting recordings, transcripts, summaries, and AI outputs are sensitive by default. The security foundation reasserts Supabase RLS, keeps audio buckets private, adds an audit log table, makes backend CORS origin-based, adds security headers, validates UUID path inputs, rate-limits AI enqueue endpoints, and documents that HIPAA is not supported until formal compliance review is complete.

## Lessons Learned

- Git history includes accidental `.env` commits that were later removed. Continue treating secrets as dashboard-only values and rotate exposed credentials if they were real.
- Docs can drift from implementation. Future feature work should update docs in the same commit as behavior changes.
- The in-app progress tracker is product data and can drift separately from repository docs. Its defaults need a refresh after major milestones.
- The project is viable as an MVP candidate, but release confidence depends on a deployed smoke test with real Supabase, Render, Vercel, Redis, Celery, and OpenAI services.
