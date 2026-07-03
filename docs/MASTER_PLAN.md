# MeetingVA AI Master Plan

This document is the permanent project roadmap for MeetingVA AI. It should be
updated whenever the product direction, architecture, scope, or development
status changes.

## Project Vision

MeetingVA AI helps people turn meetings into organized, searchable, actionable
records. The product captures or accepts meeting audio, produces transcripts,
identifies speakers, extracts summaries and decisions, tracks questions and
action items, and preserves the source material so users can review and trust
the final meeting record.

## Product Goals

- Make meeting capture simple from the browser.
- Store every meeting with reliable ownership, metadata, transcript segments,
  attachments, and extracted intelligence.
- Give users a clear progress tracker while recordings, uploads, and AI jobs are
  being processed.
- Let users review, edit, search, and export meeting records.
- Build a foundation that can grow into team workspaces, mobile apps, calendar
  integrations, and AI chat over meeting history.

## Technology Stack

- Frontend: Next.js 15 App Router, React, TypeScript, Tailwind CSS
- Backend: FastAPI, Python 3.12
- Authentication: Supabase Auth
- Database: Supabase PostgreSQL
- Storage: Supabase Storage
- AI: transcription, speaker identification, summarization, extraction, search,
  and chat services orchestrated through the backend
- Local runtime: Docker and docker-compose
- Package/runtime tooling: pnpm for the frontend, pip for the backend

## Repository Structure

```text
frontend/                     Next.js application
backend/                      FastAPI application
docker/                       Dockerfiles and docker-compose configuration
scripts/supabase/migrations/  Supabase database migrations
shared/                       Shared API notes and contracts
docs/                         Product and engineering documentation
```

## Database Overview

Supabase PostgreSQL is the system of record. The initial schema includes:

- `meetings`
- `participants`
- `transcript_segments`
- `action_items`
- `decisions`
- `questions`
- `tags`
- `meeting_tags`
- `attachments`

Row-level security should keep user-owned records isolated through Supabase Auth
identity. Meeting attachments are tracked in PostgreSQL while their files live
in Supabase Storage.

## API Overview

The frontend talks to the FastAPI backend for server-side workflows and to
Supabase for authenticated client-side data access where appropriate.

Current scaffolded endpoints:

- Frontend health: `GET /api/health`
- Backend health: `GET /health`

Future API areas:

- Authentication/session validation
- Meeting creation and updates
- Recording and upload coordination
- AI processing job lifecycle
- Transcript, speaker, summary, action item, decision, and question APIs
- Search and export APIs
- Team and integration APIs

## AI Processing Pipeline

1. User records audio in the browser or uploads an existing audio file.
2. The frontend stores metadata and sends the file through the configured upload
   path.
3. Supabase Storage keeps the source audio and related attachments.
4. The backend creates or receives a processing job.
5. AI transcription produces timestamped transcript segments.
6. Speaker identification links segments to participant or speaker records.
7. AI extraction generates summaries, action items, decisions, and questions.
8. Results are stored in Supabase PostgreSQL with references back to source
   transcript segments.
9. The frontend shows processing progress and lets users review, edit, search,
   export, and chat with meeting records.

## Development Phases

✅ Project Scaffold
⬜ Supabase Project Setup
⬜ Authentication
⬜ Dashboard
⬜ Progress Tracker
⬜ Browser Audio Recording
⬜ Audio Upload
⬜ Meeting Storage
⬜ AI Transcription
⬜ Speaker Identification
⬜ Meeting Summary
⬜ Action Items
⬜ Decisions
⬜ Questions
⬜ Meeting Detail Page
⬜ Transcript Editor
⬜ Speaker Editor
⬜ Search
⬜ Export
⬜ Team Features
⬜ Mobile Apps
⬜ Deployment

## MVP Scope

- Supabase project setup
- Authentication
- Dashboard
- Progress tracker
- Browser audio recording
- Audio upload
- Meeting storage
- AI transcription
- Meeting detail page
- Meeting summary
- Action items
- Decisions
- Questions

## Version 1.1

- Speaker identification
- Transcript editor
- Speaker editor
- Search
- Export
- Improved meeting detail review workflows

## Version 2.0

- Team features
- AI chat over meetings
- Calendar integration
- Shared meeting workspaces
- More advanced search and filtering

## Future Ideas

- Mobile apps
- Offline recording support
- Conferencing platform integrations
- CRM and task manager integrations
- Recurring meeting memory
- Custom AI prompts
- Organization-wide knowledge search
- Analytics for decisions, action items, and meeting load
