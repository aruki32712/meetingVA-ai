# MeetingVA AI Security

Last updated: 2026-07-07

This document describes the current security foundation for MeetingVA AI. It does not claim HIPAA compliance, SOC 2 compliance, or paid enterprise compliance.

## Security Goals

- Protect meeting recordings, transcripts, summaries, users, and AI-generated data.
- Keep private service credentials out of browser code.
- Scope all meeting data to the authenticated owner.
- Keep meeting audio in private Supabase Storage.
- Use short-lived signed URLs for private audio playback.
- Run long-running AI work on backend workers, not in the browser.
- Document compliance boundaries clearly.

## Authentication

Supabase Auth is the identity provider. The frontend stores a Supabase browser session and sends the access token to protected backend endpoints. The backend validates bearer tokens before protected side effects.

Protected backend workflows currently include:

- Transcription enqueueing.
- Analysis enqueueing.
- Job polling.
- Speaker rename.
- Speaker merge.
- Transcript segment assignment.

## Authorization

User-owned database access is enforced in two layers:

- Supabase Row Level Security policies on application tables.
- Backend ownership checks before protected mutations and AI job enqueueing.

The backend accepts a meeting only when the authenticated user matches `meetings.owner_id` or `meetings.user_id`.

## Supabase RLS

RLS is enabled for the user-owned tables:

- `meetings`
- `participants`
- `transcript_segments`
- `action_items`
- `decisions`
- `questions`
- `tags`
- `meeting_tags`
- `attachments`
- `project_progress_phases`
- `project_progress_checklist_items`

The security foundation migration also reasserts RLS and adds `audit_logs` with RLS. Authenticated users can read only their own audit rows; inserts should be backend/service-role owned.

## Storage Security

The `meeting-audio` and `meeting-attachments` buckets are private. The frontend uploads audio to a user-prefixed path in `meeting-audio`. Meeting detail playback uses `createSignedUrl` with a one-hour expiry.

The Celery worker downloads private audio with the Supabase service role key from the backend environment only.

## Secrets

Frontend code may only use `NEXT_PUBLIC_*` values:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Backend-only secrets must never be added to Vercel or frontend code:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DATABASE_URL`
- `OPENAI_API_KEY`

## Backend Security Controls

Implemented controls:

- Environment-based CORS origins through `CORS_ALLOWED_ORIGINS` with `FRONTEND_URL` fallback.
- Restricted CORS methods and headers.
- Security response headers on backend responses.
- UUID validation for path identifiers.
- Safe generic handling for unexpected backend errors.
- Basic in-memory rate limiting for transcription and analysis enqueue endpoints.
- Owner checks before meeting side effects.

The current rate limiter is process-local and appropriate for MVP hardening. Production scale should move rate limiting to Redis or an edge/API gateway.

## HIPAA Boundary

MeetingVA AI is not HIPAA compliant today. Do not market, sell, or operate it as a HIPAA-compliant product until Walter Labs AI completes a formal compliance review, signs required vendor agreements, implements compliance controls, and validates operational procedures.

Do not process protected health information in MeetingVA AI during the current MVP stage.

## Open Security Work

- Add production-grade distributed rate limiting.
- Add full audit logging writes from backend workflows.
- Add E2E security tests for cross-user access attempts.
- Add deletion/export workflows and retention enforcement.
- Add formal incident response and compliance review before regulated use cases.

