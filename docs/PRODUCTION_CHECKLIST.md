# MeetingVA AI Production Checklist

Last updated: 2026-07-08

Complete this checklist for every production launch or material release. Record
the production commit SHA, migration level, deploy URLs, operator, and date in
the release notes. Do not use real customer audio for smoke testing.

## Release Record

- [ ] Release commit SHA:
- [ ] Release date and operator:
- [ ] Supabase migration level: `0012_meeting_activity_feed.sql`
- [ ] Render backend deploy:
- [ ] Render worker deploy:
- [ ] Vercel production deploy:
- [ ] Rollback commit/deploy:

## GitHub

- [ ] Production changes are reviewed and merged to `main`.
- [ ] Required checks pass for the exact production commit.
- [ ] Branch protection and required reviews are enabled for `main`.
- [ ] No secrets, local `.env` files, credentials, or generated build output are tracked.
- [ ] The release commit is tagged or otherwise recorded for rollback.
- [ ] Dependency and security alerts are reviewed.

## Supabase

- [ ] A dedicated production project is selected.
- [ ] Migrations `0001` through `0012` are applied in order.
- [ ] RLS is enabled and cross-user access tests pass.
- [ ] `meeting-audio` and `meeting-attachments` are private.
- [ ] Supabase Auth Site URL and Redirect URLs use the production frontend.
- [ ] The anon key is used only in public/RLS-constrained paths.
- [ ] The service-role key is stored only in Render backend and worker services.
- [ ] Backup, point-in-time recovery, and restore expectations are documented.
- [ ] A forward-fix plan exists for migrations that cannot safely be reversed.

## Render

- [ ] `render.yaml` validates and creates the backend, worker, and Key Value services.
- [ ] Backend and worker deploy from the intended production commit.
- [ ] Backend `healthCheckPath` is `/health` and returns HTTP 200.
- [ ] Backend and worker use the same production Supabase, OpenAI, and queue configuration.
- [ ] `CORS_ALLOWED_ORIGINS` contains only approved HTTPS frontend origins.
- [ ] Backend-only secrets are marked secret and absent from build logs.
- [ ] Deploy failure and service health notifications are enabled.
- [ ] A prior healthy deploy is available for rollback.

## Redis

- [ ] Render Key Value is private (`ipAllowList: []`) and in the same region as compute.
- [ ] Backend and worker connect through Render-provided internal connection strings.
- [ ] Celery broker and result-backend database selections do not conflict.
- [ ] Queue connectivity is confirmed from the worker.
- [ ] Memory policy, persistence posture, capacity, and connection limits are understood.
- [ ] Queue depth and connection failures have an alerting plan.

## Celery

- [ ] Worker starts with `app.workers.celery_app:celery_app`.
- [ ] Worker reaches Redis, Supabase Storage, and OpenAI.
- [ ] A synthetic transcription and analysis job completes.
- [ ] Failed jobs expose a safe error and can be retried.
- [ ] Duplicate enqueue and cancellation behavior are checked.
- [ ] Worker logs include job/meeting identifiers but no tokens, secrets, or transcript bodies.
- [ ] Worker shutdown and in-flight job behavior are understood before rollback.

## Vercel

- [ ] Project Root Directory is `frontend`.
- [ ] Framework is Next.js and `frontend/vercel.json` is detected.
- [ ] Install and production build commands complete successfully.
- [ ] Production tracks `main`; preview deployment access is restricted as appropriate.
- [ ] Only the four documented `NEXT_PUBLIC_*` variables are configured.
- [ ] `/api/health` returns HTTP 200 and the expected frontend service payload.
- [ ] Production and preview URLs are configured appropriately in Supabase Auth and CORS.
- [ ] A prior healthy deployment is available for instant rollback.

## OpenAI

- [ ] Production API key is stored only in Render.
- [ ] The configured transcription and analysis models are available to the project.
- [ ] Usage limits, budget alerts, and billing are configured.
- [ ] Provider errors do not expose API keys or raw provider payloads to users.
- [ ] Synthetic transcription and analysis requests succeed.
- [ ] No PHI is processed; MeetingVA AI makes no HIPAA compliance claim.

## Environment Variables

- [ ] Every variable in `frontend/.env.example` is configured in Vercel.
- [ ] Every variable in `backend/.env.example` is configured or intentionally defaulted in Render.
- [ ] `ENVIRONMENT=production` and `WORKER_VERSION` identifies the release.
- [ ] Public URLs use HTTPS and have no accidental localhost values.
- [ ] Secrets are not copied into `NEXT_PUBLIC_*` variables.
- [ ] Backend, worker, and frontend values reference the same production environment.
- [ ] Secret rotation ownership and procedure are documented.

## DNS (Future Custom Domain)

- [ ] Domain ownership and registrar access are confirmed.
- [ ] DNS records match Vercel/Render verification instructions.
- [ ] Production frontend and API hostnames are recorded.
- [ ] Supabase redirects and backend CORS are updated after DNS cutover.
- [ ] TTL is lowered before a planned migration and restored afterward.
- [ ] Rollback DNS records and propagation expectations are documented.

## SSL

- [ ] Every public endpoint redirects to or serves HTTPS.
- [ ] Vercel and Render certificates are issued and valid.
- [ ] No mixed-content browser errors occur.
- [ ] Backend responses over HTTPS include HSTS and expected security headers.
- [ ] Certificate renewal is provider-managed and monitored.

## Monitoring

- [ ] Frontend `/api/health` and backend `/health` are monitored externally.
- [ ] Alerts cover backend availability, worker crashes, queue backlog, and elevated failures.
- [ ] Supabase, Render, Vercel, Redis-compatible service, and OpenAI status pages are bookmarked.
- [ ] Alert recipients, severity levels, and escalation ownership are defined.
- [ ] A synthetic meeting workflow is run after every material deployment.

## Logging

- [ ] Render backend and worker logs are retained for the intended operational window.
- [ ] Vercel function/build logs are accessible to authorized operators.
- [ ] Logs exclude credentials, bearer tokens, private audio URLs, and transcript bodies.
- [ ] Correlation uses safe meeting/job identifiers.
- [ ] Error messages shown to users are safe while operator logs retain actionable context.
- [ ] Log access follows least privilege.

## Smoke Test

- [ ] Frontend and backend health endpoints pass.
- [ ] Signup/login and protected-route redirects work.
- [ ] A synthetic recording uploads to private storage.
- [ ] Transcription reaches `transcribed` and creates ordered segments.
- [ ] Analysis reaches `analyzed` and creates expected intelligence.
- [ ] Processing timeline and activity feed reflect the workflow.
- [ ] Speaker rename, merge, and segment reassignment work.
- [ ] Signed-out and cross-user access attempts fail.

## Rollback

- [ ] Current and previous healthy commit SHAs are recorded.
- [ ] Render backend and worker rollback targets are identified.
- [ ] Vercel rollback target is identified.
- [ ] Environment changes are recorded and reversible.
- [ ] Migration rollback or forward-fix decision is documented before deployment.
- [ ] Database backup/recovery posture is confirmed before risky migrations.
- [ ] Rollback preserves backend/worker/schema compatibility.
- [ ] Incident owner and customer communication path are identified.
