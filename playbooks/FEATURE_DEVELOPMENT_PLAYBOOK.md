# Feature Development Playbook

## Purpose

Use this playbook to build a new feature without losing product, data, or release context.

## Steps

1. Read `docs/PROJECT_STATUS.md` and `docs/AI_CONTEXT.md`.
2. Define the user outcome and success criteria.
3. Identify affected surfaces:
   - Frontend route or component.
   - Backend endpoint or task.
   - Supabase migration.
   - Documentation.
   - Tests.
4. Make the smallest coherent implementation.
5. Add or update tests for changed behavior.
6. Run relevant validation.
7. Update documentation in the same commit.
8. Add changelog entry.
9. Record major decisions in `docs/PROJECT_MEMORY.md`.

## Quality Bar

- User has clear loading, success, empty, and error states.
- Protected operations verify ownership.
- Secrets stay server-side.
- Long-running work uses Celery.
- Schema changes are migrations, not dashboard-only edits.

