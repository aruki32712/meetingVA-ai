# MeetingVA AI Coding Standards

## General

- Keep changes scoped to the requested behavior.
- Match existing file structure, naming, and style.
- Do not commit secrets or local environment files.
- Prefer clear, boring code over clever abstractions.
- Update docs when behavior, setup, architecture, strategy, or release steps change.
- Treat `docs/PROJECT_STATUS.md` as the current truth source.

## Frontend

- Use TypeScript and React function components.
- Keep route files thin and place reusable UI in `frontend/components/`.
- Use the existing Supabase browser client from `frontend/lib/supabase.ts`.
- Keep authenticated data access owner-scoped.
- Preserve current Tailwind utility style and visual language.
- Surface loading, empty, success, and error states for user workflows.
- Keep browser-only APIs inside client components.
- Avoid adding new UI libraries without a clear product reason.

## Backend

- Use FastAPI, Pydantic models, and typed helper functions.
- Validate Supabase bearer tokens before protected side effects.
- Confirm meeting ownership before mutating meeting-related data.
- Keep OpenAI and Supabase service role credentials server-side.
- Keep long-running work in Celery tasks.
- Set clear `processing_status` values before and after queued work.
- Raise useful HTTP errors without leaking secrets or provider internals.
- Add tests for helper logic and endpoint behavior when backend behavior changes.

## Database And Supabase

- Add schema changes as ordered SQL migrations in `scripts/supabase/migrations/`.
- Keep RLS enabled on user-owned application tables.
- Preserve backward compatibility for existing `owner_id` and `user_id` usage unless a migration fully removes one.
- Store files in private buckets and expose them through authenticated or signed access.
- Document migration order and any manual dashboard setup.

## AI And Privacy

- Keep prompts and AI outputs structured, auditable, and failure-tolerant.
- Preserve original transcript text when translation is requested.
- Do not introduce biometric speaker recognition without explicit product, legal, and privacy review.
- Avoid sending unnecessary customer data to external services.

## Tests And Validation

- Run frontend lint, typecheck, and build after frontend changes.
- Run backend compile and pytest after backend changes.
- For deployment-related changes, run the release checklist in `docs/TESTING_CHECKLIST.md`.
- Document any skipped validation in `docs/PROJECT_STATUS.md` and the final handoff.

## Git

- Keep commits focused and descriptive.
- Check `git status --short` before committing.
- Do not revert unrelated user changes.
- Use `main` as the current production-intent branch unless the owner changes the workflow.

