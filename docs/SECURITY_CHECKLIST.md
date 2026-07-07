# MeetingVA AI Security Checklist

Use this checklist before production releases and after security-sensitive changes.

## Repository

- [ ] No `.env` files are tracked.
- [ ] No real secrets appear in code, docs, tests, logs, or examples.
- [ ] Frontend code references only `NEXT_PUBLIC_*` environment values.
- [ ] Backend-only secrets are documented as backend/worker-only.

## Supabase Database

- [ ] RLS is enabled on `meetings`.
- [ ] RLS is enabled on `participants`.
- [ ] RLS is enabled on `transcript_segments`.
- [ ] RLS is enabled on `action_items`.
- [ ] RLS is enabled on `decisions`.
- [ ] RLS is enabled on `questions`.
- [ ] RLS is enabled on `tags`.
- [ ] RLS is enabled on `meeting_tags`.
- [ ] RLS is enabled on `attachments`.
- [ ] RLS is enabled on progress tracker tables.
- [ ] Users can access only their own meeting data.
- [ ] Cross-user meeting, transcript, participant, and attachment access is rejected.

## Supabase Storage

- [ ] `meeting-audio` bucket is private.
- [ ] `meeting-attachments` bucket is private.
- [ ] Audio object paths are user-prefixed.
- [ ] Private playback uses signed URLs.
- [ ] Signed URL expiry is short enough for playback.

## Backend

- [ ] CORS origins are set from environment variables.
- [ ] Backend allows only expected frontend origins.
- [ ] Protected endpoints require bearer tokens.
- [ ] Protected endpoints verify meeting ownership.
- [ ] AI enqueue endpoints are rate-limited.
- [ ] Path IDs are validated as UUIDs.
- [ ] Unexpected errors return safe generic messages.
- [ ] Security headers are present.

## Compliance Boundary

- [ ] Product materials do not claim HIPAA compliance.
- [ ] Product materials do not claim enterprise compliance.
- [ ] Health or regulated data use is blocked until formal review.
- [ ] Privacy policy draft is reviewed before public launch.
- [ ] Data retention policy is reviewed before public launch.

## Validation

- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run build`
- [ ] `python -m compileall app`
- [ ] `python -m pytest`
- [ ] `docker compose -f docker/docker-compose.yml config`

