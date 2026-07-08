# MeetingVA AI Quality Gate

Last updated: 2026-07-08

This checklist is required before any MeetingVA AI feature, release, or deployment is considered complete. It is a process gate only; it does not change application behavior.

Every future Codex task must update this file if the definition of done changes.

## Required Validation Commands

- [ ] Frontend typecheck passes: `cd frontend && pnpm run typecheck`
- [ ] Frontend lint passes: `cd frontend && pnpm run lint`
- [ ] Frontend build passes: `cd frontend && pnpm run build`
- [ ] Backend tests pass: `cd backend && python -m pytest`
- [ ] Backend compile check passes: `cd backend && python -m compileall app`

## 1. Definition Of Done

- [ ] Requested scope is implemented or the remaining gap is explicitly documented.
- [ ] Application behavior is unchanged unless the task intentionally required a behavior change.
- [ ] User-facing workflows affected by the change have been reviewed.
- [ ] Relevant automated validation commands have passed.
- [ ] Manual testing has covered the changed surface area.
- [ ] Security, privacy, data, and AI impacts have been reviewed.
- [ ] Documentation and project status files are current.
- [ ] Known risks, blockers, and follow-up tasks are documented.
- [ ] Chris has approved product-owner completion when required.

## 2. Code Quality

- [ ] Change follows existing repository structure and naming patterns.
- [ ] TypeScript and Python code remain readable, focused, and scoped to the task.
- [ ] No unrelated refactors or formatting churn are included.
- [ ] Error handling is explicit for expected failure modes.
- [ ] Tests are added or updated when behavior changes.
- [ ] Shared contracts, API shapes, and status values remain consistent across frontend, backend, and docs.
- [ ] No dead code, debug logging, or temporary test fixtures are left behind.

## 3. Frontend Validation

- [ ] `cd frontend && pnpm run typecheck`
- [ ] `cd frontend && pnpm run lint`
- [ ] `cd frontend && pnpm run build`
- [ ] Protected routes still require authentication.
- [ ] Meeting list, meeting detail, new meeting capture, and progress tracker screens still load.
- [ ] Long-running transcript or analysis jobs do not block the UI.
- [ ] Loading, success, empty, and failure states remain clear.
- [ ] Search loading, initial empty, no-results, error, and results states remain clear.
- [ ] Search filters cover date range, processing status, participant, and tag.
- [ ] Processing timeline and activity feed render clear current, completed, failed, system, worker, and owner states.
- [ ] Speaker correction activity clearly shows original label, new label, confidence, and affected segment metadata when present.
- [ ] Private audio playback still uses signed URLs.
- [ ] No backend-only secrets are exposed through frontend code, logs, bundles, or environment variables.

## 4. Backend Validation

- [ ] `cd backend && python -m pytest`
- [ ] `cd backend && python -m compileall app`
- [ ] Health endpoints still return ok.
- [ ] Protected endpoints validate Supabase bearer tokens.
- [ ] Meeting ownership checks run before protected side effects.
- [ ] Transcription and analysis endpoints enqueue background work and return quickly.
- [ ] Job polling reflects current meeting processing status.
- [ ] Cancellation endpoint moves cancellable jobs to `cancelled` safely.
- [ ] Durable `processing_jobs` rows are created for background jobs.
- [ ] Meeting activity events are recorded for processing lifecycle, retry, and owner speaker correction actions.
- [ ] Expected OpenAI, Supabase, Redis, and worker failures are handled safely.
- [ ] Unexpected errors return safe generic responses.

## 5. Database Validation

- [ ] New or changed schema is represented by an ordered migration.
- [ ] Migrations can be applied in order from a fresh Supabase project.
- [ ] Background job schema tracks `meeting_id`, `job_type`, `status`, timestamps, errors, retries, and worker version.
- [ ] Owner-scoped tables preserve `owner_id` or compatible ownership fields.
- [ ] Foreign keys, indexes, and status constraints match current application usage.
- [ ] Seed or default data matches the implemented feature set.
- [ ] No migration weakens existing user-data isolation.
- [ ] Search indexes cover the searchable meeting and related-record text.
- [ ] Search RPC remains `security invoker`, requires `auth.uid()`, and returns only owned meetings.
- [ ] `meeting_activity_events` is owner-scoped, RLS-enabled, indexed by meeting/user/time, and write-restricted to trusted backend/service paths.

## 6. Supabase/RLS Validation

- [ ] RLS is enabled for user-owned application tables.
- [ ] RLS policies allow users to access only their own rows.
- [ ] Cross-user reads and writes are rejected.
- [ ] Users can read only activity events for their own meetings.
- [ ] Authenticated browser clients cannot directly insert system or worker activity events.
- [ ] `meeting-audio` bucket is private.
- [ ] `meeting-attachments` bucket is private.
- [ ] Private storage access uses signed URLs only for frontend playback or download.
- [ ] Worker storage access uses the backend-only Supabase service role key.
- [ ] Supabase service role key is never available to browser code.

## 7. Security Validation

- [ ] No exposed secrets are present in git, docs, logs, frontend bundles, or environment examples.
- [ ] RLS remains enabled for user-owned data.
- [ ] Supabase Storage buckets for meeting files are private.
- [ ] Signed URLs are used for private meeting assets.
- [ ] Supabase service role key is backend-only.
- [ ] `OPENAI_API_KEY` is backend-only.
- [ ] `SUPABASE_DATABASE_URL` is backend-only.
- [ ] CORS is restricted by environment and does not allow arbitrary origins in production.
- [ ] Backend security headers remain present.
- [ ] Rate limiting remains active for AI enqueue endpoints.
- [ ] No HIPAA compliance claims are made.
- [ ] Product is not used for PHI until formal compliance review is complete.

## 8. AI Feature Validation

- [ ] Transcript jobs do not block UI rendering or navigation.
- [ ] Analysis jobs do not block UI rendering or navigation.
- [ ] Meeting status updates correctly through `uploaded`, `queued`, `transcribing`, `transcribed`, `analyzing`, `analyzed`, `failed`, and `cancelled` as applicable.
- [ ] Failed AI jobs are recoverable or clearly retryable.
- [ ] Cancelled AI jobs stop polling and do not enqueue duplicate work.
- [ ] OpenAI errors are handled safely without leaking secrets or raw provider internals.
- [ ] Worker failures write a failure status users can understand.
- [ ] Transcript segments remain ordered and tied to the correct meeting.
- [ ] AI-generated summaries, action items, decisions, and questions preserve source context when available.
- [ ] Non-English transcription and optional English translation behavior remains documented.

## 9. Documentation Validation

- [ ] `docs/PROJECT_STATUS.md` is updated.
- [ ] `docs/CHANGELOG.md` is updated.
- [ ] `docs/ROADMAP.md` is updated if scope, sequencing, or feature status changed.
- [ ] `docs/MASTER_PLAN.md` is updated if scope changed.
- [ ] `docs/SECURITY.md` is updated if security changed.
- [ ] `docs/TESTING_CHECKLIST.md` is updated if release validation changed.
- [ ] `docs/AI_CONTEXT.md` is updated if future Codex guidance changed.
- [ ] `docs/QUALITY_GATE.md` is updated if the definition of done changed.
- [ ] README links remain accurate.

## 10. Manual Testing

- [ ] Signup works for a test user.
- [ ] Login works for a test user.
- [ ] Signed-out users cannot access `/dashboard`.
- [ ] Dashboard navigation loads.
- [ ] New meeting capture loads.
- [ ] Browser recording can start, pause, resume, stop, play back, delete, and save.
- [ ] Meeting row and attachment row are created after upload.
- [ ] Generate Transcript enqueues a job and updates status.
- [ ] Generate Analysis enqueues a job and updates status.
- [ ] Speaker rename, merge, and segment assignment work for the meeting owner.
- [ ] Activity feed records meeting creation, audio upload, queued/started/completed/failed processing, retries, speaker detection, and owner corrections.
- [ ] Activity feed oldest-first toggle works and defaults to newest-first.
- [ ] Meeting detail displays detected language, transcript language, translation status, and speaker statistics.
- [ ] Search returns relevant excerpts and match types across all documented content types.
- [ ] Search date, processing status, participant, and tag filters work independently and together.
- [ ] Signed-out and cross-user search access is rejected.
- [ ] Unauthorized users cannot access or mutate another user's meeting data.

## 11. Deployment Readiness

- [ ] Vercel frontend configuration is current.
- [ ] Render backend, worker, and Redis configuration is current.
- [ ] Supabase migrations are applied in the target environment.
- [ ] Required environment variables are present in the correct service environments.
- [ ] Backend-only secrets are not configured in Vercel.
- [ ] `CORS_ALLOWED_ORIGINS` includes only approved frontend origins.
- [ ] Frontend health check passes.
- [ ] Backend health check passes.
- [ ] Worker can connect to Redis, Supabase, and OpenAI.
- [ ] Worker command uses `app.workers.celery_app:celery_app`.
- [ ] Deployed smoke test covers recording, upload, transcription, analysis, and speaker edits.

## 12. Rollback Readiness

- [ ] The current production branch and commit are known before deployment.
- [ ] Database migration rollback or forward-fix approach is documented for risky changes.
- [ ] Environment variable changes are documented and reversible.
- [ ] Render and Vercel previous deploys are available for rollback.
- [ ] Supabase backup or recovery posture is understood before schema changes.
- [ ] User-visible incident notes are drafted for high-risk releases.

## 13. Founder Review Checklist

- [ ] Chris has reviewed the completed scope against the original request.
- [ ] Chris has reviewed known limitations, blockers, and follow-up work.
- [ ] Chris has confirmed no unsupported compliance claims are present.
- [ ] Chris has confirmed the feature or release is acceptable for the intended audience.
- [ ] Chris has approved deployment or release when the change is production-bound.
- [ ] Chris has confirmed `docs/PROJECT_STATUS.md` reflects the current state.
