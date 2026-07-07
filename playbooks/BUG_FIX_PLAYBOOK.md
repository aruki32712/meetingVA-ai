# Bug Fix Playbook

## Purpose

Use this playbook to diagnose and fix defects quickly while preserving trust in the repo.

## Steps

1. Reproduce the issue or identify why it cannot be reproduced.
2. Capture affected user workflow, route, endpoint, table, or service.
3. Check recent commits and `docs/PROJECT_STATUS.md` for related context.
4. Write or update a focused test when feasible.
5. Fix the narrowest cause.
6. Run relevant validation.
7. Update `docs/CHANGELOG.md` and `docs/PROJECT_STATUS.md` if the issue affected release readiness.

## Triage Questions

- Is user data at risk?
- Is a secret exposed?
- Is production down?
- Is the issue local, deployed, or both?
- Is it frontend, backend, worker, Supabase, Redis, OpenAI, or deployment configuration?

## Severity

- P0: data loss, secret exposure, production unavailable.
- P1: core workflow broken.
- P2: important workflow degraded with workaround.
- P3: polish, copy, or non-blocking defect.

