# MeetingVA AI Architecture

This document describes the intended production architecture for MeetingVA AI.
It should evolve as implementation details become concrete.

## Frontend Architecture

The frontend is a Next.js 15 App Router application using React, TypeScript, and
Tailwind CSS. It owns the user experience for authentication, dashboard
navigation, recording, upload, meeting review, transcript editing, search,
exports, and AI chat.

Key responsibilities:

- Route-level app shell and authenticated layouts
- Supabase Auth session handling
- Dashboard navigation, project progress tracking, and meeting detail pages
- Browser audio recording and upload controls
- Progress tracker for processing jobs
- Transcript, speaker, summary, action item, decision, and question review UI
- Export and search workflows

## Backend Architecture

The backend is a FastAPI service running on Python 3.12. It handles workflows
that require secure server-side execution, integrations, long-running
processing, or service credentials.

Key responsibilities:

- Health and operational endpoints
- Supabase token validation for protected API calls
- Environment-driven CORS configuration
- Security headers and safe unexpected-error responses
- Basic rate limiting for AI enqueue endpoints
- AI job enqueueing and processing-status APIs
- Upload and processing job coordination
- Export generation
- Integration webhooks

Long-running AI work runs outside request handling through Celery workers.
Redis is the Celery broker and result backend. The FastAPI service validates
ownership, updates meeting status to a running state, enqueues jobs, and returns
quickly with a `job_id`; workers perform OpenAI and Supabase side effects and
write final success or failure statuses back to `meetings`.

## Supabase Database Architecture

Supabase PostgreSQL is the system of record. The first migration defines the
core meeting data model:

- `meetings`
- `participants`
- `transcript_segments`
- `action_items`
- `decisions`
- `questions`
- `tags`
- `meeting_tags`
- `attachments`

Row-level security should enforce owner-scoped access through Supabase Auth.
Application tables should keep source references wherever AI-generated records
come from transcript segments.

The security foundation migration reasserts RLS on user-owned tables, keeps
meeting storage buckets private, and creates `audit_logs` for backend-owned
security events. Users can read only audit rows tied to their own user or
meeting records; inserts should be performed by backend code using the service
role.

Speaker intelligence stores editable speakers in `participants` and links
transcript ownership through `transcript_segments.participant_id`. The
`speaker_label` field remains available as the provider or diarization label,
while `participants.display_name` is the user-facing name. Participant metadata
includes non-biometric reference fields for future diarization or voiceprint
systems; voice biometric recognition is not implemented.

Multilingual transcription metadata is stored on `meetings` with
`detected_language`, `transcript_language`, `translation_language`,
`translate_to_english`, and `transcript_kind`. Segment rows can preserve
`original_text` and `translated_text` while `text` remains the transcript shown
to users and passed into English-only meeting analysis. MVP transcription can
process non-English audio and optionally generate an English transcript, but
summaries, structured analysis, and the application UI remain English for now.

The dashboard progress tracker stores user-owned project planning state in:

- `project_progress_phases`
- `project_progress_checklist_items`

These tables are separate from future meeting processing progress so roadmap
tracking does not depend on recording, upload, or AI job infrastructure.

## Storage Architecture

Supabase Storage stores meeting files and generated artifacts. PostgreSQL stores
metadata and references to the storage bucket/path.

Expected stored assets:

- Source meeting audio
- Uploaded supporting files
- Generated transcript files
- Exported PDF documents
- Exported DOCX documents
- Future images or integration attachments

The `meeting-audio` bucket stores browser recordings and is private by default.
The `meeting-attachments` bucket stores supporting meeting files and generated
artifacts. Access should be mediated by Supabase Auth, row-level security, and
signed URLs where needed.

The frontend uses short-lived signed URLs for private meeting audio playback.
The worker uses the Supabase service role key to download private audio for
transcription; that key must remain backend-only.

## Authentication Flow

1. User signs up or signs in through Supabase Auth from the frontend.
2. Supabase returns a session and access token.
3. The frontend stores and refreshes session state using Supabase client
   utilities.
4. Protected frontend routes require an active session.
5. Backend API calls include the Supabase access token.
6. The backend validates the token before running protected workflows.
7. Database row-level security scopes user data by `auth.uid()`.

## Security Architecture

Security controls are layered:

- Supabase Auth establishes user identity.
- Supabase RLS scopes direct database access to owner-owned data.
- Backend endpoints validate bearer tokens and verify meeting ownership before side effects.
- Private Supabase Storage buckets protect raw audio and attachments.
- Signed URLs expose private audio playback temporarily.
- Backend-only secrets stay out of frontend code and Vercel.
- CORS allowed origins are configured through environment variables.
- Backend responses include basic security headers.
- Transcription and analysis enqueue endpoints have basic in-memory rate limiting for MVP abuse prevention.

MeetingVA AI is not HIPAA compliant today. HIPAA, SOC 2, or paid enterprise compliance must not be claimed until formal review and implementation are complete.

## AI Processing Pipeline

1. User records audio in the browser or uploads an existing file.
2. The frontend creates or updates the meeting record.
3. Audio is stored in Supabase Storage and referenced from `attachments`.
4. The meeting detail page calls the backend transcription endpoint with the
   user's Supabase access token and translation preference.
5. The backend validates the token, confirms the meeting belongs to the user,
   sets `meetings.processing_status` to `transcribing`, enqueues a Celery job,
   and returns `meeting_id`, `job_id`, and `processing_status`.
6. The frontend polls the protected job status endpoint and refreshes meeting
   data while processing continues.
7. The Celery worker downloads the private audio object from the
   `meeting-audio` bucket with the service role key and sends it to OpenAI
   transcription with language auto-detection.
8. Transcription produces timestamped transcript segments in
   `transcript_segments`.
9. If `translate_to_english` is requested for non-English audio, the worker
   also generates English transcript text and preserves original text where
   segment alignment is available.
10. Speaker identification creates or reuses participant records and links
   transcript segments through `participant_id`.
11. Analysis requests follow the same queue pattern: FastAPI validates
   ownership and enqueues, then the worker generates English summaries, action
   items, decisions, and questions.
12. Extracted records are stored with source transcript references.
13. The frontend updates progress and shows reviewable results.

The current transcription status flow uses `meetings.processing_status` values:

- `uploaded`
- `transcribing`
- `transcribed`
- `transcription_failed`
- `analyzing`
- `analyzed`
- `analysis_failed`

## API Endpoint Plan

Current scaffolded endpoints:

- `GET /health`
- `GET /api/health`

Planned backend endpoints:

- `GET /v1/me`
- `GET /v1/meetings`
- `POST /v1/meetings`
- `GET /v1/meetings/{meeting_id}`
- `PATCH /v1/meetings/{meeting_id}`
- `POST /v1/meetings/{meeting_id}/uploads`
- `POST /v1/meetings/{meeting_id}/transcribe`
  - Request body: `{ "translate_to_english": true | false }`
  - Response includes `meeting_id`, `job_id`, and `processing_status`.
- `POST /v1/meetings/{meeting_id}/analyze`
  - Response includes `meeting_id`, `job_id`, and `processing_status`.
- `GET /v1/meetings/{meeting_id}/jobs/{job_id}`
  - Protected job and meeting processing-status polling endpoint.
- `POST /v1/meetings/{meeting_id}/process`
- `PATCH /v1/meetings/{meeting_id}/participants/{participant_id}`
- `POST /v1/meetings/{meeting_id}/participants/merge`
- `POST /v1/meetings/{meeting_id}/transcript-segments/assign`
- `GET /v1/meetings/{meeting_id}/progress`
- `GET /v1/meetings/{meeting_id}/transcript`
- `PATCH /v1/transcript-segments/{segment_id}`
- `POST /v1/meetings/{meeting_id}/exports/pdf`
- `POST /v1/meetings/{meeting_id}/exports/docx`
- `POST /v1/search`
- `POST /v1/chat`

## Deployment Architecture

Local development runs through Docker and docker-compose. Production should
support independently deployable frontend and backend services, managed
Supabase services, environment-specific configuration, health checks, structured
logging, and background workers for long-running AI and export jobs.

Recommended production components:

- Hosted Next.js frontend
- Hosted FastAPI backend
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage
- Background processing worker
- AI provider credentials stored as secrets
- CI checks for frontend, backend, migrations, and Docker config
