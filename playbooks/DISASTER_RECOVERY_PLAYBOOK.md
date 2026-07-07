# Disaster Recovery Playbook

## Purpose

Use this playbook when production data, deployment, secrets, or core workflows are at risk.

## First Response

1. Stop making unrelated changes.
2. Identify severity: P0, P1, P2, or P3.
3. Preserve logs and error messages.
4. Check whether secrets, customer data, or production availability are affected.
5. Update `docs/PROJECT_STATUS.md` with the incident if it affects release readiness.

## Common Incidents

### Secret Exposure

- Remove exposed values from code.
- Rotate affected keys immediately.
- Review git history and platform logs.
- Confirm secrets exist only in Supabase, Render, Vercel, or local untracked env files.

### Failed Deployment

- Check Vercel and Render build logs.
- Confirm environment variables.
- Roll back through platform controls if production is broken.
- Run health endpoints after recovery.

### Worker Or Queue Failure

- Confirm Redis is available.
- Confirm backend and worker share broker/result settings.
- Inspect Render worker logs.
- Verify `meetings.processing_status` for stuck jobs.

### Data Or Storage Issue

- Stop destructive changes.
- Inspect Supabase table and storage policies.
- Confirm migrations were applied in order.
- Use Supabase backups or point-in-time recovery if enabled.

## Recovery Criteria

- Core workflow is restored.
- Health endpoints pass.
- A short smoke test succeeds.
- Root cause and follow-up are documented.
- Any required secret rotation is complete.

