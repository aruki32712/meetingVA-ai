# Supabase Setup

This guide configures Supabase for MeetingVA AI. It covers project creation,
API keys, database connection details, migrations, Storage, Auth, and common
troubleshooting.

## Required Environment Variables

Frontend values in `frontend/.env.local`:

```text
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Backend values in `backend/.env`:

```text
APP_NAME=MeetingVA AI API
ENVIRONMENT=local
FRONTEND_URL=http://localhost:3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_DATABASE_URL=postgresql://postgres.your-project-ref:your-database-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

Never commit real Supabase keys, database passwords, or production URLs in
`.env` files. The frontend may only use public `NEXT_PUBLIC_*` values and the
anon key. The service role key and database URL are backend-only secrets.

## Create A Supabase Project

1. Sign in to Supabase.
2. Create a new project.
3. Choose an organization, project name, region, and database password.
4. Save the database password in a secure password manager.
5. Wait for the project status to become active.

Use one Supabase project per environment when possible:

- Local development
- Staging
- Production

## Find API Keys

1. Open the Supabase project dashboard.
2. Go to Project Settings.
3. Open API.
4. Copy the Project URL into:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_URL`
5. Copy the anon public key into:
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_ANON_KEY`
6. Copy the service role key into:
   - `SUPABASE_SERVICE_ROLE_KEY`

The service role key bypasses row-level security. Keep it server-side only and
never expose it to the browser.

## Configure Database URL

1. Open Project Settings.
2. Open Database.
3. Find Connection string.
4. Use the pooled connection string for app/server access unless direct
   database access is required.
5. Replace the password placeholder with the database password saved during
   project creation.
6. Store the final value in `SUPABASE_DATABASE_URL`.

The current scaffold does not connect directly to PostgreSQL yet, but the
database URL is documented now so backend jobs and future migration tooling can
use one consistent environment contract.

## Run Migrations

The initial migration is:

```text
scripts/supabase/migrations/0001_initial_schema.sql
```

Preferred CLI workflow:

```bash
supabase login
supabase link --project-ref your-project-ref
supabase db push --include-all
```

Manual SQL editor workflow:

1. Open the Supabase SQL editor.
2. Open `scripts/supabase/migrations/0001_initial_schema.sql`.
3. Paste the full migration into the SQL editor.
4. Run it once against a fresh project.
5. Confirm the tables, policies, indexes, triggers, and Storage bucket exist.

The migration is intended for a new project. It creates the core public tables,
row-level security policies, indexes, updated-at triggers, and the private
`meeting-attachments` Storage bucket. If a migration fails partway through,
review the failed statement before rerunning because PostgreSQL objects such as
types, tables, triggers, and policies may already exist.

## Migration Safety Notes

The initial migration has been reviewed for the Supabase Configuration phase:

- It creates all MVP data tables required by the current architecture.
- It enables row-level security on every application table.
- It scopes user-managed rows through `auth.uid()`.
- It creates indexes for owner and meeting lookup paths.
- It creates updated-at triggers for mutable records.
- It creates the `meeting-attachments` bucket as private.
- It does not contain destructive `drop`, `truncate`, or data-deleting
  statements.

Run it once against a fresh project or through the Supabase migration workflow.
Do not rerun it manually against a database where the objects already exist
unless you have inspected the current schema and understand the expected
conflicts.

## Create Or Verify Storage Buckets

The migration inserts this private bucket:

```text
meeting-attachments
```

To verify it:

1. Open Storage in the Supabase dashboard.
2. Confirm `meeting-attachments` exists.
3. Confirm the bucket is private.
4. Confirm Storage policies exist for authenticated object reads, uploads, and
   deletes under user-owned paths.

Expected upload paths should begin with the authenticated user id, for example:

```text
{user_id}/{meeting_id}/source-audio.webm
```

## Enable Authentication

1. Open Authentication in the Supabase dashboard.
2. Confirm email/password sign-in is enabled for local MVP development.
3. Add `http://localhost:3000` to allowed redirect URLs.
4. Add deployed frontend URLs before production release.
5. Configure email templates and SMTP before inviting real users.

Authentication pages are intentionally not implemented yet. This setup only
prepares the Supabase project and environment contract for the authentication
phase.

## Verification Checklist

- `frontend/.env.local` contains only public frontend values.
- `backend/.env` contains service role and database secrets.
- No real secrets are committed to Git.
- `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` point to the same project.
- `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` use the same anon key.
- `SUPABASE_SERVICE_ROLE_KEY` is never referenced from frontend code.
- Migration `0001_initial_schema.sql` has been applied.
- Bucket `meeting-attachments` exists and is private.
- Row-level security is enabled on application tables.

## Troubleshooting

### Missing Supabase environment variable

Copy the relevant `.env.example` file and replace every placeholder value.

### Frontend cannot connect to Supabase

Check `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Restart
the Next.js dev server after changing `.env.local`.

### Backend Supabase client raises a placeholder error

The backend client refuses empty or placeholder Supabase settings. Replace
`your-*` values in `backend/.env`.

### Migration fails because an object already exists

The migration is designed for a fresh project. If it partially ran already,
inspect which table, type, trigger, policy, or bucket exists before rerunning.
For a disposable local project, reset the database and rerun the migration.

### Storage upload is denied

Confirm the user is authenticated and the object path starts with that user's
id. Also confirm the `meeting-attachments` bucket is private and the Storage
policies from the migration exist.

### Rows are invisible after insert

Confirm `owner_id` columns are set to the authenticated user id and that row
level security policies match `auth.uid()`.
