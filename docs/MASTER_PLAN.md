# MeetingVA AI Master Plan

This document is the single source of truth for MeetingVA AI product direction,
architecture, development phases, milestones, and future enhancements.

## Vision

MeetingVA AI is a meeting intelligence workspace that helps people capture,
organize, understand, and act on conversations. The product turns live or
uploaded meeting audio into durable meeting records with transcripts, summaries,
decisions, questions, action items, searchable history, and exports.

The goal is to reduce the manual work that follows every meeting while keeping
the source conversation auditable. Users should be able to record or upload a
meeting, let AI extract the important structure, review and correct the output,
and return later to find exactly what was discussed, decided, assigned, or left
unanswered.

## Architecture

### Frontend

The frontend is a Next.js 15 App Router application built with React,
TypeScript, and Tailwind CSS. It owns the browser experience for authentication,
dashboard navigation, recording and upload workflows, meeting detail views,
transcript editing, progress tracking, search, exports, and AI chat surfaces.

### Backend

The backend is a FastAPI service running on Python 3.12. It provides API
endpoints for server-side workflows that should not live directly in the browser:
AI orchestration, transcription job management, file-processing callbacks,
export generation, integration webhooks, and operational health checks.

### Database

Supabase PostgreSQL is the system of record. The initial schema includes
meetings, participants, transcript segments, action items, decisions, questions,
tags, meeting-tag relationships, and attachments. Row-level security policies
scope records to the authenticated meeting owner.

### Storage

Supabase Storage stores meeting-related files such as uploaded audio, generated
transcripts, exported documents, images, and other attachments. Database
attachment records track bucket paths, content types, file sizes, ownership, and
meeting associations.

### Authentication

Supabase Auth provides user identity, sessions, and token-based access from the
frontend. Backend services validate Supabase-issued credentials before accessing
protected resources or running user-scoped workflows.

### AI

AI services will power transcription, speaker detection, summarization, action
item extraction, decision extraction, question detection, semantic search, and
meeting chat. AI outputs should be stored with links back to source transcript
segments wherever possible so users can review and correct the record.

### Deployment

The local development architecture runs with Docker and docker-compose. The
production architecture should support independent deployment of the frontend
and backend, managed Supabase services, environment-specific configuration,
health checks, logging, and future background workers for long-running AI and
export tasks.

### Integrations

Initial integrations focus on Supabase Auth, PostgreSQL, and Storage. Future
integrations may include calendar providers, conferencing platforms, cloud file
storage, notification tools, document export services, and payment or team
workspace infrastructure.

## Development Phases

- [x] Project Scaffold - completed
- [ ] Supabase Configuration - not started
- [ ] Authentication - not started
- [ ] Dashboard - not started
- [ ] Progress Tracker - not started
- [ ] Browser Audio Recording - not started
- [ ] Audio Upload - not started
- [ ] Meeting Storage - not started
- [ ] AI Transcription - not started
- [ ] Speaker Detection - not started
- [ ] Meeting Summary - not started
- [ ] Action Items - not started
- [ ] Decisions - not started
- [ ] Questions - not started
- [ ] Meeting Detail Page - not started
- [ ] Transcript Editor - not started
- [ ] Speaker Editor - not started
- [ ] Search - not started
- [ ] Calendar - not started
- [ ] Export PDF - not started
- [ ] Export DOCX - not started
- [ ] AI Chat - not started
- [ ] Mobile Support - not started
- [ ] Deployment - not started

## Milestones

### MVP

- Supabase configuration
- Authentication
- Dashboard
- Progress tracker
- Browser audio recording
- Audio upload
- Meeting storage
- AI transcription
- Meeting detail page
- Basic meeting summary
- Action items
- Decisions
- Questions

### Version 1.1

- Speaker detection
- Transcript editor
- Speaker editor
- Search
- Export PDF
- Export DOCX

### Version 2.0

- Calendar integration
- AI chat
- Improved semantic search
- Team-ready sharing model
- Production deployment hardening

### Version 3.0

- Mobile support
- Advanced integrations
- Multi-workspace support
- Automation workflows
- Enterprise administration features

## Future Ideas

Future enhancements will be evaluated after the MVP proves the core meeting
capture, transcription, review, and retrieval workflow. Candidates include
calendar-based meeting preparation, agenda generation, recurring meeting memory,
CRM/task-manager integrations, custom AI prompts, collaborative review, meeting
analytics, offline mobile capture, and organization-level knowledge search.
