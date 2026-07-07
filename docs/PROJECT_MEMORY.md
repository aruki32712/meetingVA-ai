# MeetingVA AI Project Memory

This file records important technical decisions and why they were made.

## Decisions

### Use Supabase For Auth, Data, And Storage

MeetingVA AI uses Supabase Auth, PostgreSQL, Storage, and RLS to reduce custom infrastructure while still keeping user-owned meeting data secure. This keeps the MVP focused on product workflows instead of building identity, database hosting, and file storage from scratch.

### Keep AI Work On The Backend

OpenAI transcription and analysis calls run from the backend/worker layer so API keys stay out of the browser. This also allows the app to use the Supabase service role key safely for private audio downloads.

### Use Celery And Redis For Long-Running Jobs

Transcription and analysis can take longer than a normal HTTP request. FastAPI validates ownership and enqueues work, while Celery workers perform the AI side effects and update `meetings.processing_status`.

### Store Processing State On Meetings

The app uses `meetings.processing_status` as the simple workflow state source for upload, transcription, analysis, and failures. This keeps the frontend polling model straightforward and visible in the database.

### Preserve Original And Translated Transcript Text

Multilingual transcription can produce original-language text and optional English text. The schema keeps `original_text`, `translated_text`, `transcript_kind`, and language metadata so the app can support richer review workflows later.

### Represent Speakers As Participants

Speaker labels are normalized into `participants` rows and linked from transcript segments. Users can rename and merge speakers without losing the original provider label.

### Avoid Voice Biometric Recognition For Now

The schema leaves room for future diarization references, but the current app does not store or compare voice biometric identities. This avoids privacy and compliance risk in the MVP.

### Deploy Frontend And Backend Separately

Vercel is used for the Next.js frontend. Render is used for FastAPI, Celery, and Redis. This matches each platform's strengths and keeps the worker process independent from the frontend.

### Keep Documentation Operational

The Command Center docs are designed for project ownership and future Codex sessions. `PROJECT_STATUS.md` is the status authority; roadmap, changelog, testing, standards, and memory files support it.

## Lessons Learned

- Git history includes accidental `.env` commits that were later removed. Continue treating secrets as dashboard-only values and rotate exposed credentials if they were real.
- Project docs can drift from implementation. Future work should update docs in the same commit as feature changes.
- The app progress tracker is product data and can drift separately from repository docs. Its defaults need a refresh after major milestones.
