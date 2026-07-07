-- Security foundation hardening for MeetingVA AI.
-- Reasserts RLS on user-owned tables, verifies private storage buckets, and
-- adds an audit log table for backend-owned security events.

alter table public.meetings enable row level security;
alter table public.participants enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.action_items enable row level security;
alter table public.decisions enable row level security;
alter table public.questions enable row level security;
alter table public.tags enable row level security;
alter table public.meeting_tags enable row level security;
alter table public.attachments enable row level security;
alter table public.project_progress_phases enable row level security;
alter table public.project_progress_checklist_items enable row level security;

update storage.buckets
set public = false
where id in ('meeting-audio', 'meeting-attachments');

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  meeting_id uuid references public.meetings(id) on delete set null,
  actor_type text not null default 'system'
    check (actor_type in ('user', 'system', 'worker', 'admin')),
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_user_id_created_at_idx
on public.audit_logs(user_id, created_at desc);

create index if not exists audit_logs_meeting_id_created_at_idx
on public.audit_logs(meeting_id, created_at desc);

create index if not exists audit_logs_action_created_at_idx
on public.audit_logs(action, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists "Users read own audit logs" on public.audit_logs;

create policy "Users read own audit logs"
on public.audit_logs
for select
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.meetings
    where meetings.id = audit_logs.meeting_id
      and (meetings.owner_id = auth.uid() or meetings.user_id = auth.uid())
  )
);

comment on table public.audit_logs is
  'Backend-owned audit log for security-relevant events. Authenticated users can read their own rows; application inserts should use the service role.';

