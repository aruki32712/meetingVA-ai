# Release Playbook

## Purpose

Use this playbook to prepare, validate, document, and ship a MeetingVA AI release.

## Steps

1. Read `docs/PROJECT_STATUS.md`.
2. Confirm release scope and known blockers.
3. Run local validation:
   - `cd frontend && pnpm run lint`
   - `cd frontend && pnpm run typecheck`
   - `cd frontend && pnpm run build`
   - `cd backend && python -m compileall app`
   - `cd backend && python -m pytest`
4. Run Docker integration when service behavior changed:
   - `docker compose -f docker/docker-compose.yml up --build`
5. Update docs:
   - `docs/PROJECT_STATUS.md`
   - `docs/CHANGELOG.md`
   - `docs/ROADMAP.md` if scope changed
   - `docs/PROJECT_MEMORY.md` if decisions changed
6. Commit with a clear message.
7. Push to the production-intent branch.
8. Run deployed smoke tests.
9. Record results and blockers in `docs/PROJECT_STATUS.md`.

## Release Criteria

- All local checks pass.
- Health endpoints pass.
- Main user workflow passes locally or on deployment.
- Known failures are documented and accepted.
- No secrets are committed.

