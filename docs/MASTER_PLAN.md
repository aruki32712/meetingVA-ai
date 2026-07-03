# MeetingVA AI Master Plan

This document is the permanent project roadmap for MeetingVA AI. It is the
single source of truth for product direction, scope, milestones, and development
status.

## Project Vision

MeetingVA AI turns meetings into structured, searchable, actionable records. It
helps users record or upload meeting audio, produce accurate transcripts,
identify speakers, generate summaries, capture decisions and questions, and
track action items without losing the original source context.

The long-term vision is a meeting memory system that lets individuals and teams
understand what happened, what changed, who owns the next step, and where to
find the supporting evidence.

## Product Goals

- Capture meetings from the browser with a low-friction recording workflow.
- Support uploaded audio for meetings recorded elsewhere.
- Store meeting metadata, audio attachments, transcript segments, extracted
  insights, and exports in a secure user-owned data model.
- Provide clear progress feedback while recordings, uploads, transcription, and
  AI extraction jobs run.
- Let users review and correct transcript, speaker, summary, action item,
  decision, and question output.
- Make meetings searchable and exportable.
- Build a foundation for AI chat, team workspaces, calendar integrations, and
  mobile support.

## Tech Stack

- Frontend: Next.js 15 App Router, React, TypeScript, Tailwind CSS
- Backend: FastAPI, Python 3.12
- Authentication: Supabase Auth
- Database: Supabase PostgreSQL
- Storage: Supabase Storage
- AI processing: backend-orchestrated transcription, speaker identification,
  summarization, extraction, search, and chat services
- Local development: Docker and docker-compose
- Frontend package manager: pnpm
- Backend package management: pip and `requirements.txt`

## Repository Structure

```text
frontend/                     Next.js application
backend/                      FastAPI application
docker/                       Dockerfiles and docker-compose configuration
scripts/supabase/migrations/  Supabase database migrations
shared/                       Shared API contracts and notes
docs/                         Project roadmap, architecture, and planning docs
```

## MVP Scope

- Supabase project setup
- Supabase Auth integration
- Authenticated dashboard
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
- Deployment-ready local architecture

## Version 1.1 Scope

- Speaker identification
- Transcript editor
- Speaker editor
- Search
- Export PDF
- Export DOCX
- Improved meeting review workflow

## Version 2.0 Scope

- Calendar integration
- AI chat over meetings
- Team features
- Shared meeting workspaces
- Advanced search and filtering
- Production deployment hardening

## Future Ideas

- Native mobile apps
- Offline recording support
- Conferencing platform integrations
- CRM and task manager integrations
- Recurring meeting memory
- Custom AI prompts
- Organization-wide knowledge search
- Meeting analytics
- Automated follow-up workflows

## Development Phase Checklist

- [x] Project Scaffold
- [x] Supabase Configuration
- [x] User Authentication
- [ ] Dashboard
- [ ] Progress Tracker
- [ ] Browser Audio Recording
- [ ] Audio Upload
- [ ] Meeting Storage
- [ ] AI Transcription
- [ ] Speaker Identification
- [ ] Meeting Summary
- [ ] Action Items
- [ ] Decisions
- [ ] Questions
- [ ] Meeting Detail Page
- [ ] Transcript Editor
- [ ] Speaker Editor
- [ ] Search
- [ ] Calendar
- [ ] Export PDF
- [ ] Export DOCX
- [ ] AI Chat
- [ ] Mobile Support
- [ ] Deployment
