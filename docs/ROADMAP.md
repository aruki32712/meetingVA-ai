# MeetingVA AI Roadmap

This roadmap describes product direction. For live progress, blockers, sprint focus, and next task, use `docs/PROJECT_STATUS.md`.

## MVP

Goal: prove that a signed-in user can capture meeting audio, store it securely, generate transcripts, and receive structured meeting intelligence.

Status: mostly implemented; release smoke testing remains.

Included:

- Supabase Auth signup, login, logout, and protected dashboard.
- Browser meeting recording.
- Audio upload to private Supabase Storage.
- Meeting metadata and attachment storage.
- Meeting list and detail pages.
- Queued transcription through FastAPI, Celery, Redis, Supabase, and OpenAI.
- Timestamped transcript segments.
- Multilingual transcription metadata and optional English translation.
- Queued AI analysis.
- Executive summary, meeting brief, action items, decisions, and questions.
- Basic speaker review with rename, merge, assignment, and stats.
- Docker local runtime.
- Vercel and Render deployment configuration.
- Operating documentation for owner, AI sessions, release, deployment, and launch.

MVP exit criteria:

- Release checklist passes locally.
- Release checklist passes against deployed Vercel, Render, Supabase, Redis, Celery, and OpenAI services.
- Progress tracker seed data matches implemented features.
- `PROJECT_STATUS.md` blockers are resolved or explicitly accepted.

## v1.1

Goal: make AI output more reviewable, searchable, and useful after the meeting.

Planned:

- Transcript text editor.
- Better transcript segment correction workflow.
- Improved speaker editor for bulk assignment and review.
- Meeting search across titles, tags, transcripts, summaries, decisions, and action items.
- Export PDF.
- Export DOCX.
- Better failure recovery and retry controls for transcription and analysis.
- E2E test coverage for primary workflows.
- Product analytics for activation, processing success, and retention.
- Beta onboarding and feedback loop.

## v2.0

Goal: turn MeetingVA AI from a single-user meeting processor into a collaborative meeting memory product.

Planned:

- Team workspaces.
- Shared meetings and role-based permissions.
- AI chat over meetings.
- Calendar integration.
- Recurring meeting memory.
- Advanced search and filtering.
- Billing and subscription management.
- Production observability and cost monitoring.
- Hardened deployment and backup procedures.

## Future Vision

MeetingVA AI becomes the durable memory layer for knowledge-work meetings: capture what happened, preserve the source, identify decisions, route follow-up, and make meeting history searchable across people, teams, and tools.

Potential directions:

- Native mobile apps.
- Offline recording support.
- Conferencing platform integrations.
- CRM and task manager integrations.
- Custom AI prompts by workspace.
- Organization-wide knowledge search.
- Automated follow-up workflows.
- Meeting analytics and trends.
- Additional transcription and model providers.
- Compliance controls for regulated customers.

