# MeetingVA AI Project Owner Guide

This is the plain-English operating guide for owning MeetingVA AI. Use `docs/PROJECT_STATUS.md` first for current truth, then use this guide to understand the tools and workflows.

## Daily Owner Workflow

1. Open `docs/PROJECT_STATUS.md`.
2. Check blockers, current sprint, and next recommended task.
3. Review any open deployment, customer, or validation risk.
4. Ask Codex to make one focused change.
5. Require validation before committing.
6. Update status, changelog, roadmap, and memory in the same commit when scope changes.

## GitHub

GitHub is the source-code home and audit trail. The `main` branch is the current production-intent branch. Commit history is also the source for `docs/CHANGELOG.md`.

Owner responsibilities:

- Keep secrets out of git.
- Review changes before deployment.
- Use clear commit messages that describe product-visible outcomes.
- Connect GitHub to Render and Vercel for deployments.
- Prefer pull requests once multiple contributors are involved.

## Codex

Codex is the AI engineering collaborator for repository inspection, implementation, documentation, validation, commits, and release preparation.

How to brief Codex:

- Point it to a concrete outcome.
- Tell it whether code changes are allowed.
- Ask it to review the repository before editing when context matters.
- Ask it to run validation before commit.
- Ask it to update `PROJECT_STATUS.md` when work changes project truth.

Future Codex sessions should read `docs/PROJECT_STATUS.md` and `docs/AI_CONTEXT.md` before changing files.

## Supabase

Supabase provides authentication, PostgreSQL, row-level security, and private storage.

Repository touchpoints:

- `frontend/lib/supabase.ts`
- `scripts/supabase/migrations/`
- `docs/SUPABASE_SETUP.md`

Owner responsibilities:

- Apply migrations in order.
- Enable email/password auth.
- Configure local and deployed redirect URLs.
- Keep service role keys backend-only.
- Verify private buckets `meeting-audio` and `meeting-attachments`.
- Inspect RLS policies after schema changes.

## Vercel

Vercel hosts the Next.js frontend from `frontend/`.

Required values:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Never add backend-only secrets to Vercel.

## Render

Render hosts the FastAPI backend, Celery worker, and Redis service using `render.yaml`.

Required backend and worker values:

- `FRONTEND_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DATABASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_TRANSCRIPTION_MODEL`
- `OPENAI_ANALYSIS_MODEL`
- `REDIS_URL`
- `CELERY_BROKER_URL`
- `CELERY_RESULT_BACKEND`

Backend and worker must share the same Supabase, Redis, and OpenAI settings.

## Docker

Docker provides the realistic local runtime:

```bash
docker compose -f docker/docker-compose.yml up --build
```

This starts the frontend, backend, Redis, and worker. Use it when testing cross-service behavior.

## Redis And Celery

Redis is the broker/result backend. Celery executes long-running jobs. The backend should enqueue AI work and return quickly; workers should perform transcription, translation, analysis, and database writes.

Owner checks:

- Worker is deployed whenever backend is deployed.
- Backend and worker point to the same Redis instance.
- Job status is visible through `processing_jobs.status`.
- Render worker logs are inspected when AI jobs fail.

## OpenAI

OpenAI is used for transcription, optional translation, and structured meeting analysis.

Current defaults:

- `OPENAI_TRANSCRIPTION_MODEL=whisper-1`
- `OPENAI_ANALYSIS_MODEL=gpt-4o-mini`

Owner responsibilities:

- Keep `OPENAI_API_KEY` server-side only.
- Use short test recordings during smoke tests.
- Track cost once beta usage begins.
- Expect live AI workflows to require network access and valid credentials.

## Documentation Workflow

Use these docs for operating the company and product:

- `business/BUSINESS_PLAN.md`: strategy and business model.
- `business/EXECUTIVE_SUMMARY.md`: company and product overview.
- `business/PRICING.md`: packaging and pricing proposal.
- `business/GO_TO_MARKET.md`: launch plan.
- `business/COMPETITOR_ANALYSIS.md`: market comparison.
- `business/CUSTOMER_PERSONAS.md`: target customers.
- `business/KPIS.md`: metrics.
- `business/FOUNDER_DASHBOARD.md`: CEO dashboard.
- `playbooks/`: repeatable operating procedures.

## Release Workflow

Use `playbooks/RELEASE_PLAYBOOK.md`.

Minimum release gates:

- Frontend lint passes.
- Frontend typecheck passes.
- Frontend build passes.
- Backend compile passes.
- Backend tests pass.
- Deployed smoke test passes or exceptions are documented in `PROJECT_STATUS.md`.
