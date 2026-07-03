create extension if not exists pgcrypto;

create type public.meeting_status as enum ('draft', 'recording', 'processing', 'completed', 'archived');
create type public.action_item_status as enum ('open', 'in_progress', 'completed', 'cancelled');
create type public.question_status as enum ('open', 'answered', 'deferred');
create type public.attachment_kind as enum ('audio', 'transcript', 'document', 'image', 'other');

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  status public.meeting_status not null default 'draft',
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  display_name text not null,
  email text,
  role text,
  speaker_label text,
  created_at timestamptz not null default now(),
  unique (meeting_id, email)
);

create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  speaker_label text,
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms >= start_ms),
  text text not null,
  confidence numeric(5, 4) check (confidence >= 0 and confidence <= 1),
  segment_index integer not null,
  created_at timestamptz not null default now(),
  unique (meeting_id, segment_index)
);

create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  assignee_participant_id uuid references public.participants(id) on delete set null,
  title text not null,
  description text,
  status public.action_item_status not null default 'open',
  due_at timestamptz,
  source_segment_id uuid references public.transcript_segments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  title text not null,
  description text,
  source_segment_id uuid references public.transcript_segments(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  question text not null,
  answer text,
  status public.question_status not null default 'open',
  source_segment_id uuid references public.transcript_segments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table public.meeting_tags (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (meeting_id, tag_id)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  kind public.attachment_kind not null default 'other',
  file_name text not null,
  storage_bucket text not null default 'meeting-attachments',
  storage_path text not null,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create index meetings_owner_id_idx on public.meetings(owner_id);
create index participants_meeting_id_idx on public.participants(meeting_id);
create index transcript_segments_meeting_id_idx on public.transcript_segments(meeting_id);
create index action_items_meeting_id_idx on public.action_items(meeting_id);
create index decisions_meeting_id_idx on public.decisions(meeting_id);
create index questions_meeting_id_idx on public.questions(meeting_id);
create index meeting_tags_tag_id_idx on public.meeting_tags(tag_id);
create index attachments_meeting_id_idx on public.attachments(meeting_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_meetings_updated_at
before update on public.meetings
for each row execute function public.set_updated_at();

create trigger set_action_items_updated_at
before update on public.action_items
for each row execute function public.set_updated_at();

create trigger set_questions_updated_at
before update on public.questions
for each row execute function public.set_updated_at();

alter table public.meetings enable row level security;
alter table public.participants enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.action_items enable row level security;
alter table public.decisions enable row level security;
alter table public.questions enable row level security;
alter table public.tags enable row level security;
alter table public.meeting_tags enable row level security;
alter table public.attachments enable row level security;

create policy "Users manage own meetings"
on public.meetings
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "Users manage own tags"
on public.tags
for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "Users manage meeting participants"
on public.participants
for all
using (exists (
  select 1 from public.meetings
  where meetings.id = participants.meeting_id
    and meetings.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.meetings
  where meetings.id = participants.meeting_id
    and meetings.owner_id = auth.uid()
));

create policy "Users manage transcript segments"
on public.transcript_segments
for all
using (exists (
  select 1 from public.meetings
  where meetings.id = transcript_segments.meeting_id
    and meetings.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.meetings
  where meetings.id = transcript_segments.meeting_id
    and meetings.owner_id = auth.uid()
));

create policy "Users manage action items"
on public.action_items
for all
using (exists (
  select 1 from public.meetings
  where meetings.id = action_items.meeting_id
    and meetings.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.meetings
  where meetings.id = action_items.meeting_id
    and meetings.owner_id = auth.uid()
));

create policy "Users manage decisions"
on public.decisions
for all
using (exists (
  select 1 from public.meetings
  where meetings.id = decisions.meeting_id
    and meetings.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.meetings
  where meetings.id = decisions.meeting_id
    and meetings.owner_id = auth.uid()
));

create policy "Users manage questions"
on public.questions
for all
using (exists (
  select 1 from public.meetings
  where meetings.id = questions.meeting_id
    and meetings.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.meetings
  where meetings.id = questions.meeting_id
    and meetings.owner_id = auth.uid()
));

create policy "Users manage meeting tags"
on public.meeting_tags
for all
using (
  exists (
    select 1 from public.meetings
    where meetings.id = meeting_tags.meeting_id
      and meetings.owner_id = auth.uid()
  )
  and exists (
    select 1 from public.tags
    where tags.id = meeting_tags.tag_id
      and tags.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.meetings
    where meetings.id = meeting_tags.meeting_id
      and meetings.owner_id = auth.uid()
  )
  and exists (
    select 1 from public.tags
    where tags.id = meeting_tags.tag_id
      and tags.owner_id = auth.uid()
  )
);

create policy "Users manage attachments"
on public.attachments
for all
using (exists (
  select 1 from public.meetings
  where meetings.id = attachments.meeting_id
    and meetings.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.meetings
  where meetings.id = attachments.meeting_id
    and meetings.owner_id = auth.uid()
));

insert into storage.buckets (id, name, public)
values ('meeting-attachments', 'meeting-attachments', false)
on conflict (id) do nothing;

create policy "Users read own meeting attachment objects"
on storage.objects
for select
using (
  bucket_id = 'meeting-attachments'
  and exists (
    select 1
    from public.attachments
    join public.meetings on meetings.id = attachments.meeting_id
    where attachments.storage_bucket = storage.objects.bucket_id
      and attachments.storage_path = storage.objects.name
      and meetings.owner_id = auth.uid()
  )
);

create policy "Users upload own meeting attachment objects"
on storage.objects
for insert
with check (
  bucket_id = 'meeting-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users delete own meeting attachment objects"
on storage.objects
for delete
using (
  bucket_id = 'meeting-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);
