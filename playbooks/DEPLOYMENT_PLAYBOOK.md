# Deployment Playbook

## Purpose

Use this playbook to deploy MeetingVA AI to Supabase, Render, and Vercel.

## Order

1. Configure Supabase.
2. Apply migrations in order.
3. Verify private storage buckets.
4. Deploy Render Redis, backend, and worker.
5. Deploy Vercel frontend.
6. Connect URLs and environment variables.
7. Run deployed smoke test.

## Supabase

- Enable email/password auth.
- Apply all files in `scripts/supabase/migrations/` in order.
- Verify `meeting-audio` and `meeting-attachments` are private.
- Add local and deployed frontend URLs to auth settings.

## Render

- Use `render.yaml`.
- Configure backend and worker with matching Supabase, Redis, and OpenAI values.
- Confirm backend `/health` returns ok.
- Inspect backend and worker logs during AI jobs.

## Vercel

- Set project root to `frontend`.
- Configure only `NEXT_PUBLIC_*` frontend values.
- Confirm `/api/health` returns ok.

## Smoke Test

- Sign up or log in.
- Record a short meeting.
- Save it.
- Generate transcript.
- Generate analysis.
- Rename or merge a speaker.
- Confirm data appears in Supabase.

