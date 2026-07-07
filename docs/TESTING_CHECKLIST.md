# MeetingVA AI Release Testing Checklist

Use this checklist before declaring a release or deployed test complete.

## Local Validation

- [ ] `cd frontend && pnpm run lint`
- [ ] `cd frontend && pnpm run typecheck`
- [ ] `cd frontend && pnpm run build`
- [ ] `cd backend && python -m compileall app`
- [ ] `cd backend && python -m pytest`
- [ ] `docker compose -f docker/docker-compose.yml up --build`
- [ ] Frontend health returns ok at `http://localhost:3000/api/health`.
- [ ] Backend health returns ok at `http://localhost:8000/health`.

## Supabase

- [ ] Migrations are applied in order from `0001` through latest.
- [ ] Email/password auth is enabled.
- [ ] Site URL and redirect URLs include local and deployed frontend origins.
- [ ] `meeting-audio` private bucket exists.
- [ ] `meeting-attachments` private bucket exists.
- [ ] RLS policies allow users to access only their own meetings and project progress data.

## Frontend Smoke Test

- [ ] Signup works for a test user.
- [ ] Login works for a test user.
- [ ] Signed-out users cannot access `/dashboard`.
- [ ] Dashboard navigation loads.
- [ ] Meetings list loads.
- [ ] New meeting page loads.
- [ ] Progress tracker loads.

## Meeting Capture

- [ ] Browser requests microphone permission.
- [ ] Start recording works.
- [ ] Pause and resume work.
- [ ] Stop produces playable audio.
- [ ] Delete clears the recording.
- [ ] Save meeting uploads audio.
- [ ] Meeting row is created with title, date, duration, tags, and `uploaded` status.
- [ ] Attachment row is created for the audio file.
- [ ] Audio object exists in the private `meeting-audio` bucket.

## AI Processing

- [ ] Generate Transcript enqueues a Celery job.
- [ ] Meeting status changes to `transcribing`.
- [ ] Worker downloads audio successfully.
- [ ] OpenAI transcription completes.
- [ ] Transcript segments are stored in order.
- [ ] Participants are created or linked.
- [ ] Meeting status changes to `transcribed`.
- [ ] Non-English test audio records detected language.
- [ ] Optional English translation preserves original text when available.
- [ ] Generate Analysis enqueues a Celery job.
- [ ] Meeting status changes to `analyzing`.
- [ ] Summary and brief are stored.
- [ ] Action items, decisions, and questions are stored when present.
- [ ] Meeting status changes to `analyzed`.

## Speaker Review

- [ ] Speaker rename works.
- [ ] Speaker merge updates transcript segments.
- [ ] Segment assignment works.
- [ ] Speaker stats update after changes.
- [ ] Unauthorized users cannot edit another user's meeting speakers.

## Deployment Smoke Test

- [ ] Vercel frontend deploy succeeds.
- [ ] Render backend deploy succeeds.
- [ ] Render worker deploy succeeds.
- [ ] Render Redis is connected to both backend and worker.
- [ ] Vercel `/api/health` returns ok.
- [ ] Render `/health` returns ok.
- [ ] Vercel environment variables point to the correct Supabase and Render services.
- [ ] Render backend and worker have matching Supabase, Redis, and OpenAI settings.
- [ ] End-to-end recording, transcription, analysis, and speaker edit workflow passes on deployed URLs.

## Release Notes

- [ ] `docs/PROJECT_STATUS.md` is updated.
- [ ] `docs/CHANGELOG.md` includes the release summary.
- [ ] `docs/ROADMAP.md` reflects any scope changes.
- [ ] Known blockers are documented.
