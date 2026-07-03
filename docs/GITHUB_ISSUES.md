# GitHub Project Management Setup

GitHub issue writes were not available from the current connector session, so
this document is the copy-ready fallback for labels, milestones, and issues.

## Labels

- `frontend`
- `backend`
- `database`
- `ai`
- `auth`
- `storage`
- `enhancement`
- `bug`
- `documentation`
- `testing`
- `high-priority`
- `low-priority`

## Milestones

- `MVP`
- `Version 1.1`
- `Version 2.0`
- `Version 3.0`

## Issues

### Supabase Configuration

Suggested labels: `database`, `storage`, `auth`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Configure the Supabase project for MeetingVA AI, including Auth, PostgreSQL,
Storage, environment variables, and local development setup.

#### Acceptance Criteria

- Supabase project is created and connected to local environment files.
- Initial database migration applies successfully.
- Storage bucket for meeting attachments is configured.
- Auth settings are ready for frontend and backend integration.
- README setup instructions reflect the final Supabase workflow.

### User Authentication

Suggested labels: `auth`, `frontend`, `backend`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Implement Supabase Auth so users can sign up, sign in, sign out, and access
owner-scoped application data.

#### Acceptance Criteria

- Users can sign up, sign in, and sign out.
- Sessions persist across reloads.
- Protected routes redirect unauthenticated users.
- Backend can validate Supabase access tokens.
- Auth errors are displayed clearly.

### Dashboard

Suggested labels: `frontend`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Build the authenticated dashboard that shows meetings and entry points for
recording or uploading audio.

#### Acceptance Criteria

- Users see recent meetings with title, date, and status.
- Empty, loading, and error states are implemented.
- Users can start a new recording flow.
- Users can start a new upload flow.

### Progress Tracker

Suggested labels: `frontend`, `backend`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Create a reusable progress tracker for recording, upload, storage,
transcription, and AI extraction jobs.

#### Acceptance Criteria

- Tracker supports pending, active, completed, and failed states.
- Processing steps are visible to the user.
- Failures include recovery guidance.
- Dashboard and meeting detail pages can reuse the tracker.

### Browser Audio Recording

Suggested labels: `frontend`, `storage`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Implement browser-based microphone recording for capturing meetings directly in
MeetingVA AI.

#### Acceptance Criteria

- Users can request microphone permission.
- Users can start, pause, resume, stop, and discard recordings.
- Recording duration and status are visible.
- Completed recordings can be passed to the upload workflow.

### Audio Upload

Suggested labels: `frontend`, `backend`, `storage`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Allow users to upload meeting audio files recorded outside the browser.

#### Acceptance Criteria

- Users can choose supported audio files.
- File type and size validation are implemented.
- Upload progress is visible.
- Uploaded files create attachment records.
- Upload failures are handled clearly.

### Meeting Storage

Suggested labels: `database`, `storage`, `backend`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Implement the persistence layer for meetings, participants, transcript segments,
attachments, and extracted meeting intelligence.

#### Acceptance Criteria

- Meeting records can be created and updated.
- Attachments are linked to meetings.
- Database access respects row-level security.
- Backend and frontend use consistent meeting identifiers.

### AI Transcription

Suggested labels: `ai`, `backend`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Integrate AI transcription so stored meeting audio produces timestamped
transcript segments.

#### Acceptance Criteria

- Backend can submit audio for transcription.
- Transcript segments include text and timestamps.
- Transcription status is reflected in the progress tracker.
- Failed transcription jobs are recoverable or clearly reported.

### Speaker Identification

Suggested labels: `ai`, `backend`, `database`, `enhancement`
Suggested milestone: `Version 1.1`

#### Description

Identify and label speakers in transcript segments so users can understand who
said what.

#### Acceptance Criteria

- Transcript segments can store speaker labels.
- Speaker labels can be linked to participants.
- Unknown speakers are handled gracefully.
- Speaker data is visible on the meeting detail page.

### Meeting Summary

Suggested labels: `ai`, `backend`, `frontend`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Generate a concise AI meeting summary from transcript content.

#### Acceptance Criteria

- Summary generation runs after transcription.
- Summary is stored with the meeting.
- Summary is visible on the meeting detail page.
- Users can distinguish missing, processing, and completed summaries.

### Action Items

Suggested labels: `ai`, `backend`, `database`, `frontend`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Extract and display actionable follow-ups from meeting transcripts.

#### Acceptance Criteria

- AI extraction creates action item records.
- Action items include title, status, and optional assignee/due date.
- Source transcript references are preserved where possible.
- Users can view action items on the meeting detail page.

### Decisions

Suggested labels: `ai`, `backend`, `database`, `frontend`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Extract decisions made during a meeting and display them as structured records.

#### Acceptance Criteria

- AI extraction creates decision records.
- Decisions include title and optional description.
- Source transcript references are preserved where possible.
- Users can view decisions on the meeting detail page.

### Questions

Suggested labels: `ai`, `backend`, `database`, `frontend`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Extract open, answered, or deferred questions from meeting transcripts.

#### Acceptance Criteria

- AI extraction creates question records.
- Questions can track answer text and status.
- Source transcript references are preserved where possible.
- Users can view questions on the meeting detail page.

### Meeting Detail Page

Suggested labels: `frontend`, `database`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Build the meeting detail page where users review metadata, transcript,
attachments, summaries, action items, decisions, and questions.

#### Acceptance Criteria

- Users can open a meeting from the dashboard.
- Meeting metadata and processing state are visible.
- Transcript and extracted sections are displayed when available.
- Loading, empty, and error states are implemented.

### Transcript Editor

Suggested labels: `frontend`, `database`, `enhancement`
Suggested milestone: `Version 1.1`

#### Description

Allow users to correct transcript segment text after AI transcription.

#### Acceptance Criteria

- Users can edit transcript segment text.
- Changes persist to the database.
- Editing states are clear and recoverable.
- Source timing metadata remains intact.

### Speaker Editor

Suggested labels: `frontend`, `database`, `enhancement`
Suggested milestone: `Version 1.1`

#### Description

Allow users to rename speakers and link speaker labels to participants.

#### Acceptance Criteria

- Users can rename speaker labels.
- Users can assign speaker labels to participants.
- Transcript display updates after speaker edits.
- Speaker changes persist to the database.

### Search

Suggested labels: `frontend`, `backend`, `database`, `ai`, `enhancement`
Suggested milestone: `Version 1.1`

#### Description

Implement search across meeting titles, transcripts, summaries, decisions,
questions, and action items.

#### Acceptance Criteria

- Users can search across their meetings.
- Results show relevant meeting context.
- Search respects authenticated ownership.
- Empty and no-result states are implemented.

### Calendar

Suggested labels: `backend`, `frontend`, `enhancement`
Suggested milestone: `Version 2.0`

#### Description

Add calendar integration for meeting context, preparation, and future scheduling
workflows.

#### Acceptance Criteria

- Calendar provider integration plan is documented.
- Users can connect a calendar provider.
- Calendar events can be associated with meetings.
- Calendar failures are handled safely.

### Export PDF

Suggested labels: `backend`, `frontend`, `enhancement`
Suggested milestone: `Version 1.1`

#### Description

Generate PDF exports for meeting records.

#### Acceptance Criteria

- Users can request a PDF export from a meeting.
- Export includes meeting metadata, summary, transcript, action items,
  decisions, and questions as available.
- Generated PDF is stored or downloaded reliably.
- Export failures are surfaced clearly.

### Export DOCX

Suggested labels: `backend`, `frontend`, `enhancement`
Suggested milestone: `Version 1.1`

#### Description

Generate DOCX exports for meeting records.

#### Acceptance Criteria

- Users can request a DOCX export from a meeting.
- Export includes meeting metadata, summary, transcript, action items,
  decisions, and questions as available.
- Generated DOCX is stored or downloaded reliably.
- Export failures are surfaced clearly.

### AI Chat

Suggested labels: `ai`, `backend`, `frontend`, `enhancement`
Suggested milestone: `Version 2.0`

#### Description

Add AI chat over individual meetings and eventually across meeting history.

#### Acceptance Criteria

- Users can ask questions about a meeting.
- Responses use meeting transcript and extracted records as context.
- Answers include source references where possible.
- Chat respects authenticated data boundaries.

### Mobile Support

Suggested labels: `frontend`, `enhancement`, `low-priority`
Suggested milestone: `Version 3.0`

#### Description

Improve the application for mobile usage and prepare for future native mobile
apps.

#### Acceptance Criteria

- Core pages work well on mobile screen sizes.
- Recording and upload workflows are usable on mobile browsers.
- Mobile app scope is documented.
- Priority mobile usability gaps are tracked.

### Deployment

Suggested labels: `backend`, `frontend`, `testing`, `enhancement`, `high-priority`
Suggested milestone: `MVP`

#### Description

Prepare MeetingVA AI for reliable deployment with environment configuration,
health checks, build checks, and deployment documentation.

#### Acceptance Criteria

- Frontend and backend deployment targets are documented.
- Required environment variables are documented.
- Health checks are available for deployed services.
- CI or manual deployment checks are documented.
- Production secrets are not committed.
