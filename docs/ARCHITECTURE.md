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
- AI processing orchestration
- Upload and processing job coordination
- Export generation
- Integration webhooks
- Future background job dispatch

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

## Authentication Flow

1. User signs up or signs in through Supabase Auth from the frontend.
2. Supabase returns a session and access token.
3. The frontend stores and refreshes session state using Supabase client
   utilities.
4. Protected frontend routes require an active session.
5. Backend API calls include the Supabase access token.
6. The backend validates the token before running protected workflows.
7. Database row-level security scopes user data by `auth.uid()`.

## AI Processing Pipeline

1. User records audio in the browser or uploads an existing file.
2. The frontend creates or updates the meeting record.
3. Audio is stored in Supabase Storage and referenced from `attachments`.
4. The backend creates a processing job.
5. Transcription produces timestamped transcript segments.
6. Speaker identification links transcript segments to speakers or participants.
7. AI extraction generates summaries, action items, decisions, and questions.
8. Extracted records are stored with source transcript references.
9. The frontend updates progress and shows reviewable results.

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
- `POST /v1/meetings/{meeting_id}/process`
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
